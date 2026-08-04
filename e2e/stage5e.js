const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickInPage(page, "button", /^Save Loan & Deal Tracker$/);
  await L.sleep(7000);
  await L.shot(page, "stage5-tracker-saved");
  console.log("  [save] unsaved banner:",
    await page.evaluate(() => /Unsaved changes/.test(document.body.innerText)));

  const st = L.loadState();
  const tr = await page.evaluate(async (leadId) => {
    const r = await fetch(`/api/walkin_enquiries/${leadId}/tranches`, { credentials: "include" });
    return { status: r.status, body: await r.json().catch(() => "non-json") };
  }, st.leadId);
  console.log("  [tranches]", JSON.stringify(tr, null, 2).slice(0, 1800));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE5e FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage5e-FAILURE"); } catch {}
  process.exit(1);
});
