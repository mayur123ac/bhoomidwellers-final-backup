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

async function pick(page, labelRe, optionText) {
  const r = await page.evaluate((lre, opt) => {
    const re = new RegExp(lre, "i");
    for (const sel of document.querySelectorAll("select")) {
      let lbl = "";
      let p = sel.closest("div");
      for (let i = 0; i < 5 && p; i++) {
        const l = p.querySelector("label");
        if (l && l.innerText.trim()) { lbl = l.innerText.trim(); break; }
        p = p.parentElement;
      }
      if (!re.test(lbl)) continue;
      const o = [...sel.options].find((x) => x.text.trim() === opt);
      if (!o) return "option-missing";
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(sel, o.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return "ok";
    }
    return "label-not-found";
  }, labelRe.source, optionText);
  if (r !== "ok") throw new Error(`pick(${labelRe},${optionText}) -> ${r}`);
}

(async () => {
  const { page } = await L.connect();

  // ── 2. Customer financial profile ─────────────────────────────────────────
  await pick(page, /Employment/, "Salaried");
  await setNative(page, 'input[placeholder="Monthly Income"]', "1,20,000");
  await setNative(page, 'input[placeholder="Existing Emi"]', "15,000");
  await setNative(page, 'input[placeholder="e.g. 750"]', "780");

  // ── 3. Loan requirement ───────────────────────────────────────────────────
  await setNative(page, 'input[placeholder="60,00,000"]', "65,00,000");
  await pick(page, /Loan Type/, "Home Loan");
  await setNative(page, 'input[placeholder="e.g. HDFC"]', "HDFC");

  // ── 8. Registration & booking financials ──────────────────────────────────
  await setNative(page, 'input[placeholder="50,000"]', "25,000");
  await L.clickByText(page, "button", /^5%$/);
  await L.sleep(400);
  await setNative(page, 'input[placeholder="e.g. 50,00,000"]', "75,00,000");
  await L.sleep(1200);

  // Stamp duty + registration fee stay on Auto-Calculate (the default).
  const calc = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("STAMP DUTY");
    return t.slice(i, i + 320);
  });
  console.log("  [sec8] ", calc);

  await L.shot(page, "stage3-loanform-sec8");

  // ── 6. Lender application ─────────────────────────────────────────────────
  await L.clickByText(page, "button", /Add Lender/i);
  await L.sleep(2000);
  await L.shot(page, "stage3-add-lender");
  console.log("\nFIELDS AFTER ADD LENDER:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE3a FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage3a-FAILURE"); } catch {}
  process.exit(1);
});
