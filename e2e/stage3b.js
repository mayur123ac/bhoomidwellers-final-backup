const L = require("./_lib");

async function setNative(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error("no element " + sel);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, value);
}

// Section 3 and the lender card both have a "Loan Type" select, so address the
// match by index rather than by label alone.
async function pickNth(page, labelRe, optionText, nth) {
  const r = await page.evaluate((lre, opt, n) => {
    const re = new RegExp(lre, "i");
    const matches = [];
    for (const sel of document.querySelectorAll("select")) {
      let lbl = "";
      let p = sel.closest("div");
      for (let i = 0; i < 5 && p; i++) {
        const l = p.querySelector("label");
        if (l && l.innerText.trim()) { lbl = l.innerText.trim(); break; }
        p = p.parentElement;
      }
      if (re.test(lbl)) matches.push(sel);
    }
    const sel = n < 0 ? matches[matches.length + n] : matches[n];
    if (!sel) return "no-match(" + matches.length + ")";
    const o = [...sel.options].find((x) => x.text.trim() === opt);
    if (!o) return "option-missing";
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, o.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  }, labelRe.source, optionText, nth);
  if (r !== "ok") throw new Error(`pickNth(${labelRe},${optionText},${nth}) -> ${r}`);
}

(async () => {
  const { page } = await L.connect();
  const today = new Date().toISOString().slice(0, 10);

  await setNative(page, 'input[placeholder="e.g. HDFC Bank"]', "HDFC");
  await pickNth(page, /Loan Type/, "Home Loan", -1); // the lender card's select
  await setNative(page, 'input[placeholder="40,00,000"]', "65,00,000");
  await setNative(page, 'input[placeholder="8.5"]', "8.5");
  await setNative(page, 'input[placeholder="240"]', "240");
  await page.evaluate((d) => {
    const dates = [...document.querySelectorAll('input[type="date"]')];
    if (dates[0]) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(dates[0], d);
      dates[0].dispatchEvent(new Event("input", { bubbles: true }));
      dates[0].dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, today);
  await L.sleep(600);
  await L.shot(page, "stage3-lender-filled");

  await L.clickByText(page, "button", /Save Lender/i);
  await L.sleep(2500);

  const lenders = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("LENDER APPLICATIONS");
    return t.slice(i, i + 400);
  });
  console.log("  [lenders]", lenders);

  await L.clickByText(page, "button", /Save Loan & Deal Tracker/i);
  await L.sleep(5000);
  await L.shot(page, "stage3-loan-form");

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  console.log("  [save] unsaved-changes banner present:", /Unsaved changes/.test(body));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE3b FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage3b-FAILURE"); } catch {}
  process.exit(1);
});
