const L = require("./_lib");

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
  await pick(page, /Loan Required/, "Yes");
  await L.sleep(2500);
  await L.shot(page, "probe14-loan-expanded");
  console.log("FIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("DEAL QUALIFICATION");
    return t.slice(i, i + 2500);
  });
  console.log("\nSECTIONS:", body);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
