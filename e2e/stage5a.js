const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();
  const today = new Date().toISOString().slice(0, 10);

  await L.clickInPage(page, "button", /^Edit$/);
  await L.sleep(2500);
  await L.shot(page, "stage5-lender-editor");

  // Sanction fields live in the lender card.
  await F.setByPlaceholder(page, "38,00,000", "65,00,000");      // Amount Sanctioned
  // Two date inputs in the lender card: Application Date, Sanction Date.
  await F.setByLabel(page, /Sanction Date/, today);
  // The CRM's lender states are Submitted/Under Processing/Sanctioned/... —
  // "Sanctioned" is the equivalent of the spec's "Approved".
  await F.setByLabel(page, /^Status$/, "Sanctioned", -1);
  await L.sleep(800);
  await L.shot(page, "stage5-sanction-filled");

  await L.clickInPage(page, "button", /^Save Lender$/);
  await L.sleep(3000);

  const lender = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("LENDER APPLICATIONS (");
    return t.slice(i, i + 320);
  });
  console.log("  [lender]", lender);

  // Mark HDFC as the lender the buyer proceeds with — its sanction drives
  // disbursement.
  try {
    await L.clickInPage(page, "button", /^Select this lender$/);
    await L.sleep(2500);
    console.log("  [lender] selected as active lender");
  } catch (e) {
    console.log("  [lender] select-this-lender not available:", e.message);
  }

  await L.clickInPage(page, "button", /^Save Loan & Deal Tracker$/);
  await L.sleep(6000);
  await L.shot(page, "stage5-loan-saved");
  const unsaved = await page.evaluate(() => /Unsaved changes/.test(document.body.innerText));
  console.log("  [save] unsaved banner:", unsaved);
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE5a FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage5a-FAILURE"); } catch {}
  process.exit(1);
});
