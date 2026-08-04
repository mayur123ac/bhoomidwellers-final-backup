const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.dismissToasts(page);
  await L.clickInPage(page, "button", /^View Booking Form$/);
  await L.sleep(3500);
  await L.clickInPage(page, "button", /^Edit Booking Form$/);
  await L.sleep(4000);
  await L.shot(page, "probe25-edit-booking");

  const step = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const m = t.match(/Step (\d) of (\d)/);
    return m ? m[0] : "(no step)";
  });
  console.log("STEP:", step);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
