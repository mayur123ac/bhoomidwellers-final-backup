const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.shot(page, "probe19-booking-step1");
  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.search(/Booking Application|Applicant Details|STEP 1/i);
    return i >= 0 ? t.slice(i, i + 1600) : "(marker not found) " + t.slice(0, 600);
  });
  console.log("MODAL BODY:", body);
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
