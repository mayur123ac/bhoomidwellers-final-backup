// Logs in as admin and opens the E2E lead's detail view.
const L = require("./_lib");

async function gotoLead(page) {
  const st = L.loadState();
  await L.login(page, "admin");
  await L.sleep(6000);
  await L.dismissToasts(page);
  const s = 'input[placeholder="Search by Lead No, Name, Contact, Project..."]';
  await page.waitForSelector(s, { timeout: 25000 });
  await page.click(s, { clickCount: 3 });
  await page.type(s, st.phone, { delay: 25 });
  await L.sleep(3000);
  const ok = await page.evaluate((phone) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(phone));
    if (!row) return false;
    const cells = [...row.querySelectorAll("td")];
    (cells[1] || row).click();
    return true;
  }, st.phone);
  if (!ok) throw new Error("lead row not found for phone " + st.phone);
  await L.sleep(4500);
  await L.dismissToasts(page);
  return true;
}

module.exports = { gotoLead };

if (require.main === module) {
  (async () => {
    const { page } = await L.connect();
    await gotoLead(page);
    await L.shot(page, "gotolead");
    console.log("BUTTONS:");
    (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
    process.exit(0);
  })().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
