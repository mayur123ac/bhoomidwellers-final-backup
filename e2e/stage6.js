const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  await L.login(page, "sourcing");
  await L.sleep(5000);
  await L.shot(page, "stage6-sourcing-view");
  console.log("URL:", page.url());

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1500));
  console.log("BODY:", body);

  // Is our lead reachable from the sourcing panel at all?
  const visible = await page.evaluate((phone, name) => {
    const t = document.body.innerText;
    return { byPhone: t.includes(phone), byName: t.includes(name) };
  }, st.phone, st.leadName);
  console.log("  [visibility] lead on screen:", JSON.stringify(visible));

  // And via the APIs this role can reach?
  const api = await page.evaluate(async (phone) => {
    const probe = async (u) => {
      try {
        const r = await fetch(u, { credentials: "include" });
        const txt = await r.text();
        return { url: u, status: r.status, hasLead: txt.includes(phone), len: txt.length };
      } catch (e) { return { url: u, error: String(e) }; }
    };
    return [
      await probe("/api/walkin_enquiries"),
      await probe("/api/channel-partners"),
      await probe("/api/cp-enquiries"),
    ];
  }, st.phone);
  api.forEach((a) => console.log("  [api]", JSON.stringify(a)));

  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).slice(0, 30).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE6 FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage6-FAILURE"); } catch {}
  process.exit(1);
});
