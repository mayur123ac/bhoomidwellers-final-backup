const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();

  await page.goto(L.BASE + "/dashboard", { waitUntil: "networkidle2" });
  await L.sleep(6000);
  await L.dismissToasts(page);

  const s = 'input[placeholder="Search by Lead No, Name, Contact, Project..."]';
  await page.waitForSelector(s, { timeout: 25000 });
  await page.click(s, { clickCount: 3 });
  await page.type(s, st.phone, { delay: 25 });
  await L.sleep(3000);
  await page.evaluate((phone) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(phone));
    const cells = [...row.querySelectorAll("td")];
    (cells[1] || row).click();
  }, st.phone);
  await L.sleep(4000);
  await L.dismissToasts(page);

  await L.clickInPage(page, "button", /^Loan Tracking$/);
  await L.sleep(4000);
  await L.shot(page, "stage5-financial-position-card");

  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("DEAL LOAN OVERVIEW");
    return t.slice(i, i + 2200);
  });
  console.log("LOAN OVERVIEW:", body);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
