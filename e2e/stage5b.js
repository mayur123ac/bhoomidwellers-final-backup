const L = require("./_lib");

(async () => {
  const { page } = await L.connect();

  // "Select this lender" copies the lender's sanction onto the deal-level
  // sanction_amount, which is what gates the Add Tranche control.
  await L.clickInPage(page, "button", /^Select this lender$/);
  await L.sleep(3500);
  await L.shot(page, "stage5-lender-selected");

  const after = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("LENDER APPLICATIONS (");
    const j = t.indexOf("7. DISBURSEMENT");
    return { lenders: t.slice(i, i + 300), disb: t.slice(j, j + 500) };
  });
  console.log("  [lender]", after.lenders);
  console.log("  [disb]", after.disb);

  const hasAdd = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => /Add Tranche/.test(b.innerText))
  );
  console.log("  [tranche] Add Tranche visible:", hasAdd);
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE5b FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage5b-FAILURE"); } catch {}
  process.exit(1);
});
