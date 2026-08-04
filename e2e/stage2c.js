const L = require("./_lib");

async function setNative(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error("no element " + sel);
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, value);
}

// Selects an option in whichever <select> carries it, matched by label text.
async function pick(page, labelRe, optionText) {
  const ok = await page.evaluate((lre, opt) => {
    const re = new RegExp(lre, "i");
    for (const sel of document.querySelectorAll("select")) {
      let lbl = "";
      let p = sel.closest("div");
      for (let i = 0; i < 4 && p; i++) {
        const l = p.querySelector("label");
        if (l && l.innerText.trim()) { lbl = l.innerText.trim(); break; }
        p = p.parentElement;
      }
      if (!re.test(lbl)) continue;
      const o = [...sel.options].find((x) => x.text.trim() === opt);
      if (!o) return "option-missing:" + [...sel.options].map((x) => x.text).join("|");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(sel, o.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return "ok";
    }
    return "label-not-found";
  }, labelRe.source || labelRe, optionText);
  if (ok !== "ok") throw new Error(`pick(${labelRe}, ${optionText}) -> ${ok}`);
}

(async () => {
  const { page } = await L.connect();

  await setNative(page, 'input[placeholder="e.g. 1BHK, 2BHK"]', "2 BHK");
  await setNative(page, 'input[placeholder="e.g. Dombivali, Kalyan"]', "Mumbai");
  await setNative(page, 'input[placeholder="e.g. 5 cr"]', "75,00,000");
  await pick(page, /Self-use or Investment/, "Investment");
  await pick(page, /Planning to Purchase/, "Immediate");
  // No "Negotiation" state exists in this CRM; "Interested" is the equivalent
  // forward step before Closing.
  await pick(page, /Lead Interest Status/, "Interested");
  await pick(page, /Loan Planned/, "Yes");
  await L.sleep(600);
  await L.shot(page, "stage2-salesform-filled");

  await L.clickByText(page, "button", /Submit Salesform/i);
  await L.sleep(5000);
  await L.shot(page, "stage2-site-visit");

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  console.log("  [salesform] form closed:", !/Lead Interest Status/.test(body));
  const m = body.match(/Lead Interest ([A-Za-z ()]+?) Loan Status/);
  console.log("  [salesform] Lead Interest now:", m ? m[1].trim() : "(not parsed)");
  const s = body.match(/Status ([A-Za-z ()]+?) OTHERS DATA/);
  console.log("  [salesform] Status now:", s ? s[1].trim() : "(not parsed)");
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE2c FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage2c-FAILURE"); } catch {}
  process.exit(1);
});
