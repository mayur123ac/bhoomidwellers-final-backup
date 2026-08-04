const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickByText(page, "button", /Mark Completed/i);
  await L.sleep(2500);
  await L.shot(page, "stage2-mark-completed-click");

  // A confirm dialog / extra modal may appear.
  const fields = await L.dumpFields(page);
  const btns = await L.dumpButtons(page);
  console.log("FIELDS:");
  fields.forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("BUTTONS:");
  btns.forEach((b) => console.log("  " + JSON.stringify(b)));

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const idx = body.indexOf("Site Visit History");
  console.log("HISTORY:", body.slice(idx, idx + 300));
  process.exit(0);
})().catch(async (e) => {
  console.error("FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage2b-FAILURE"); } catch {}
  process.exit(1);
});
