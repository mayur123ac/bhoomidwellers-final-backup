const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const reqs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/loan") || u.includes("/api/walkin_enquiries/") || u.includes("/api/booking-applications/"))
      reqs.push(r.method() + " " + u.replace("http://localhost:3000", ""));
  });

  // This button only submits on a genuine mouse click at real coordinates.
  await L.clickByText(page, "button", /^Save Loan & Deal Tracker$/);
  await L.sleep(8000);
  await L.shot(page, "stage5-tracker-saved");

  console.log("REQUESTS:");
  reqs.forEach((r) => console.log("  " + r));
  console.log("  [save] unsaved banner:",
    await page.evaluate(() => /Unsaved changes/.test(document.body.innerText)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE5f FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage5f-FAILURE"); } catch {}
  process.exit(1);
});
