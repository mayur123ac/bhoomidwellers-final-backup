const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();

  // ── Step 4: source & notes ────────────────────────────────────────────────
  await L.clickInPage(page, "button,label,div", /^Direct$/);
  await L.sleep(600);
  await F.setByPlaceholder(page, "e.g. Advertisement, Exhibition, Website...", "Walk-in");
  await F.setByPlaceholder(page, "Any internal remarks, approvals, or context...",
    "E2E test booking — do not delete — audit reference");
  await L.sleep(600);
  await L.shot(page, "stage4-step4-filled");
  console.log("step4 ->", await F.next(page));
  await L.sleep(1200);
  await L.shot(page, "stage4-step5-declaration");

  // ── Step 5: declaration ───────────────────────────────────────────────────
  const decl = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const before = boxes.map((c) => c.checked);
    boxes.forEach((c) => { if (!c.checked) c.click(); });
    return { count: boxes.length, before, after: boxes.map((c) => c.checked) };
  });
  console.log("  [declaration] checkboxes:", JSON.stringify(decl));
  await L.sleep(800);
  await L.shot(page, "stage4-step5-checked");

  const b5 = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("Declaration Review");
    return t.slice(i, i + 1200);
  });
  console.log("STEP 5 BODY:", b5);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4d FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4d-FAILURE"); } catch {}
  process.exit(1);
});
