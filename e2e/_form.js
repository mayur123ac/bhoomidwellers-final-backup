// Form helpers shared by the booking-form stage scripts.
const L = require("./_lib");

async function setByPlaceholder(page, placeholder, value) {
  const ok = await page.evaluate((ph, val) => {
    const el = document.querySelector(`input[placeholder="${ph}"], textarea[placeholder="${ph}"]`);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, placeholder, value);
  if (!ok) throw new Error("no field with placeholder: " + placeholder);
}

// Matches a control by its nearest <label>, optionally the nth such match.
async function setByLabel(page, labelRe, value, nth = 0) {
  const r = await page.evaluate((lre, val, n) => {
    const re = new RegExp(lre, "i");
    const hits = [];
    document.querySelectorAll("input,textarea,select").forEach((el) => {
      let lbl = "";
      let p = el.closest("div");
      for (let i = 0; i < 5 && p; i++) {
        const l = p.querySelector("label");
        if (l && l.innerText.trim()) { lbl = l.innerText.trim(); break; }
        p = p.parentElement;
      }
      if (re.test(lbl)) hits.push(el);
    });
    const el = n < 0 ? hits[hits.length + n] : hits[n];
    if (!el) return "no-match(" + hits.length + ")";
    if (el.tagName === "SELECT") {
      const o = [...el.options].find((x) => x.text.trim() === val || x.value === val);
      if (!o) return "option-missing:" + [...el.options].map((x) => x.text).join("|").slice(0, 200);
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, o.value);
    } else {
      const proto = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  }, labelRe.source || labelRe, value, nth);
  if (r !== "ok") throw new Error(`setByLabel(${labelRe}, ${value}, ${nth}) -> ${r}`);
}

async function stepInfo(page) {
  return page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const m = t.match(/Step (\d) of (\d)/);
    return m ? m[0] : "(no step marker)";
  });
}

async function next(page) {
  await L.clickInPage(page, "button", /^Next$/);
  await L.sleep(2200);
  return stepInfo(page);
}

module.exports = { setByPlaceholder, setByLabel, stepInfo, next };
