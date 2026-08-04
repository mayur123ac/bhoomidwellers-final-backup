const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  const s = 'input[placeholder="Search leads..."]';
  await page.waitForSelector(s, { timeout: 20000 });
  await page.click(s, { clickCount: 3 });
  await page.type(s, st.phone, { delay: 25 });
  await L.sleep(2500);
  await L.shot(page, "probe9-sales-search");

  const rows = await page.evaluate((phone) =>
    [...document.querySelectorAll("tr")]
      .map((r) => (r.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => t)
      .slice(0, 10)
  , st.phone);
  console.log("ROWS:");
  rows.forEach((r) => console.log("  " + r.slice(0, 220)));

  const opened = await page.evaluate((phone) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(phone));
    if (!row) return "NO ROW";
    const clickable = row.querySelector("button,a") || row;
    clickable.click();
    return "clicked " + (clickable.tagName);
  }, st.phone);
  console.log("OPEN:", opened);
  await L.sleep(3500);
  await L.shot(page, "probe9-lead-detail");
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
