// Reopens the embedded Loan & Deal form for the booked lead:
// lead detail -> View Booking Form -> Edit Booking Form -> step 3 -> Edit Loan Details
const L = require("./_lib");
const F = require("./_form");

async function openLoanForm(page) {
  await L.dismissToasts(page);
  const has = async (re) => !!(await L.findByText(page, "button", re));

  if (await has(/^View Booking Form$/)) {
    await L.clickInPage(page, "button", /^View Booking Form$/);
    await L.sleep(3500);
  }
  if (await has(/^Edit Booking Form$/)) {
    await L.clickInPage(page, "button", /^Edit Booking Form$/);
    await L.sleep(3500);
  }
  let step = await F.stepInfo(page);
  for (let i = 0; i < 4 && !/Step 3 of 6/.test(step); i++) step = await F.next(page);
  console.log("  [nav]", step);
  if (await has(/^Edit Loan Details$/)) {
    await L.clickInPage(page, "button", /^Edit Loan Details$/);
    await L.sleep(3500);
  }
  return step;
}

module.exports = { openLoanForm };

if (require.main === module) {
  (async () => {
    const { page } = await L.connect();
    await openLoanForm(page);
    await L.shot(page, "openloanform");
    const t = await page.evaluate(() => {
      const s = document.body.innerText.replace(/\s+/g, " ");
      const i = s.indexOf("7. DISBURSEMENT");
      return s.slice(i, i + 900);
    });
    console.log("SECTION 7:", t);
    console.log("\nBUTTONS:");
    (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
    console.log("\nFIELDS:");
    (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
    process.exit(0);
  })().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
