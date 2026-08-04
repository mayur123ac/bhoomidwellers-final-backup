const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  const s = 'input[placeholder="Search by Lead No, Name, Contact, Project..."]';
  await page.waitForSelector(s, { timeout: 20000 });
  await page.click(s, { clickCount: 3 });
  await page.type(s, st.phone, { delay: 25 });
  await L.sleep(3000);
  await L.shot(page, "probe16-admin-search");

  const opened = await page.evaluate((phone) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(phone));
    if (!row) return "NO ROW";
    // Prefer a cell that opens the detail rather than the tel: link.
    const cells = [...row.querySelectorAll("td")];
    const target = cells[1] || cells[0] || row;
    target.click();
    return "clicked td: " + target.innerText.replace(/\s+/g, " ").slice(0, 60);
  }, st.phone);
  console.log("OPEN:", opened);
  await L.sleep(3500);
  await L.shot(page, "probe16-admin-lead");

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1200));
  console.log("BODY:", body);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).slice(0, 40).forEach((b) => console.log("  " + JSON.stringify(b)));
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
