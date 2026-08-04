const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();
  console.log("->", await F.next(page));
  console.log("->", await F.next(page));
  await L.sleep(1500);
  await L.clickInPage(page, "button", /^Edit Loan Details$/);
  await L.sleep(4000);
  await L.shot(page, "probe26-edit-loan-details");

  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  process.exit(0);
})().catch(async (e) => {
  console.error("FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "probe26-FAILURE"); } catch {}
  process.exit(1);
});
