const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const errs = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const out = [];
    [/Failed to save[^.]*/gi, /error[^.]{0,120}/gi, /Loan tracking saved[^.]*/gi].forEach((re) => {
      const m = t.match(re);
      if (m) out.push(...m.slice(0, 3));
    });
    return out;
  });
  console.log("ERROR TEXT ON PAGE:", JSON.stringify(errs, null, 2));

  // Replay the save and capture the /api/loan response body verbatim.
  page.on("response", async (r) => {
    if (!r.url().includes("/api/")) return;
    if (!/loan|booking-applications|walkin_enquiries/.test(r.url())) return;
    let b = ""; try { b = (await r.text()).slice(0, 500); } catch {}
    console.log(`  [net] ${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:3000","")} :: ${b}`);
  });
  await L.clickByText(page, "button", /^Save Loan & Deal Tracker$/);
  await L.sleep(9000);
  const after = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.search(/Failed|error/i);
    return i >= 0 ? t.slice(Math.max(0, i - 150), i + 250) : "(no error text)";
  });
  console.log("AFTER:", after);
  await L.shot(page, "debug9-save-error");
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
