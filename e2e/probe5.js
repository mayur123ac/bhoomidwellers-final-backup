const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  L.saveState({ leadId: 1654, srNo: 144 });
  const st = L.loadState();

  await page.goto(L.BASE + "/dashboard/receptionist", { waitUntil: "networkidle2" });
  await L.sleep(3000);

  // Search for the lead by phone in the list search box.
  const searchSel = 'input[placeholder="Search leads..."]';
  await page.waitForSelector(searchSel, { timeout: 15000 });
  await page.click(searchSel, { clickCount: 3 });
  await page.type(searchSel, st.phone, { delay: 20 });
  await L.sleep(2500);
  await L.shot(page, "probe5-search-result");

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("tr")]
      .map((r) => (r.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => t)
      .slice(0, 12)
  );
  console.log("ROWS:");
  rows.forEach((r) => console.log("  " + r.slice(0, 200)));

  // Open the matching row.
  const opened = await page.evaluate((phone) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(phone));
    if (!row) return "no row";
    const btn = row.querySelector("button,a");
    (btn || row).click();
    return "clicked:" + (btn ? btn.innerText.trim() : "row");
  }, st.phone);
  console.log("OPEN:", opened);
  await L.sleep(3000);
  await L.shot(page, "probe5-lead-open");

  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
