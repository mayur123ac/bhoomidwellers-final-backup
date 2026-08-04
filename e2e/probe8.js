const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  await L.login(page, "sales");
  await L.sleep(4000);
  await L.shot(page, "probe8-sales-dash");

  // Is our lead in Megha's list?
  const found = await page.evaluate((phone) => {
    const rows = [...document.querySelectorAll("tr,div")].filter((r) =>
      (r.innerText || "").includes(phone)
    );
    return rows.length;
  }, st.phone);
  console.log("elements containing phone:", found);

  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).slice(0, 40).forEach((b) => console.log("  " + JSON.stringify(b)));
  const f = await L.dumpFields(page);
  console.log("\nFIELDS:");
  f.forEach((x) => console.log("  " + JSON.stringify(x)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
