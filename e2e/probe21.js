const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickInPage(page, "button", /^View Booking$/);
  await L.sleep(4000);
  await L.shot(page, "probe21-booking-view");
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 3000));
  console.log("BODY:", body);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
