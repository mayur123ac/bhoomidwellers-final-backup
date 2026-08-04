const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();

  // ── Step 2: unit details ──────────────────────────────────────────────────
  // These are free-text inputs, not inventory pickers, so there is no
  // "first available project/unit" to select.
  await F.setByPlaceholder(page, "Bhoomi Dwellers", "Bhoomi Dwellers");
  await F.setByPlaceholder(page, "A", "A");
  await F.setByPlaceholder(page, "North", "North");
  await F.setByPlaceholder(page, "12", "5");
  await F.setByPlaceholder(page, "A-1201", "A-0501");
  await F.setByPlaceholder(page, "1050", "850");
  await F.setByPlaceholder(page, "e.g. 1 covered parking", "1 covered parking");
  await L.sleep(600);

  const consideration = await page.$eval('input[placeholder="52,00,000"]', (e) => e.value);
  console.log("  [step2] Consideration Value (prefilled):", consideration);
  await L.shot(page, "stage4-step2-filled");

  console.log("step2 ->", await F.next(page));
  await L.sleep(1500);
  await L.shot(page, "stage4-step3-financials");

  console.log("\nSTEP 3 FIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nSTEP 3 BUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("Financials & Registration");
    return t.slice(i, i + 2200);
  });
  console.log("\nSTEP 3 BODY:", body);
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4b FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4b-FAILURE"); } catch {}
  process.exit(1);
});
