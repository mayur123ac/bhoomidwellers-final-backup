const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();

  // ── Step 1: applicant ─────────────────────────────────────────────────────
  await F.setByPlaceholder(page, "ABCDE1234F", "ABCDE1234F");
  await F.setByPlaceholder(page, "12-digit Aadhaar", "123456789012");
  await F.setByPlaceholder(page, "400001", "400001");
  await F.setByPlaceholder(page, "Maharashtra", "Maharashtra");
  await L.sleep(500);
  await L.shot(page, "stage4-step1-applicant");
  console.log("step1 ->", await F.next(page));
  await L.shot(page, "stage4-step2-unit");

  console.log("\nSTEP 2 FIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("Applicant Unit Details");
    return t.slice(i, i + 1200);
  });
  console.log("\nSTEP 2 BODY:", body);
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4a FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4a-FAILURE"); } catch {}
  process.exit(1);
});
