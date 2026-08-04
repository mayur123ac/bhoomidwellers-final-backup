const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();
  const d7 = new Date();
  d7.setDate(d7.getDate() + 7);
  const plus7 = d7.toISOString().slice(0, 10);
  console.log("  [tranche] expected/receiving date:", plus7);

  // Planning fields.
  await F.setByLabel(page, /Expected Disbursement Date/, plus7);
  await F.setByLabel(page, /Expected Disbursement Amount/, "65,00,000");

  // Scope the tranche inputs to the NEW TRANCHE card so the several other
  // "Status" selects on this step are not touched.
  const r = await page.evaluate((date) => {
    const card = [...document.querySelectorAll("div")]
      .filter((d) => /NEW TRANCHE/.test(d.innerText || "") && d.querySelector("select"))
      .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!card) return "no NEW TRANCHE card";
    const setV = (el, v) => {
      const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const amt = card.querySelector('input[placeholder="Amount"]');
    if (amt) setV(amt, "65,00,000");
    const dt = card.querySelector('input[type="date"]');
    if (dt) setV(dt, date);
    const sel = card.querySelector("select");
    if (sel) {
      const o = [...sel.options].find((x) => x.text.trim() === "Completed");
      if (o) setV(sel, o.value);
    }
    const ref = card.querySelector('input[placeholder="e.g. NEFT/RTGS ref"]');
    if (ref) setV(ref, "E2E-HDFC-001");
    const rem = card.querySelector('input[placeholder="Any notes"]');
    if (rem) setV(rem, "E2E test disbursement");
    return {
      amount: amt ? amt.value : null,
      date: dt ? dt.value : null,
      status: sel ? sel.value : null,
    };
  }, plus7);
  console.log("  [tranche] card values:", JSON.stringify(r));
  await L.sleep(1200);
  await L.shot(page, "stage5-tranche-filled");

  const disabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Save Tranche/.test(x.innerText));
    return b ? b.disabled : "missing";
  });
  console.log("  [tranche] Save Tranche disabled:", disabled);
  if (disabled === true) throw new Error("Save Tranche still disabled — amount may exceed remaining");

  await L.clickInPage(page, "button", /Save Tranche/);
  await L.sleep(5000);
  await L.shot(page, "stage5-post-disbursement");

  const seg = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("7. DISBURSEMENT");
    return t.slice(i, i + 700);
  });
  console.log("  [disb]", seg);
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE5d FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage5d-FAILURE"); } catch {}
  process.exit(1);
});
