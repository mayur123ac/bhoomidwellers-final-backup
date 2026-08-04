const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const r = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Save Loan & Deal Tracker/.test(b.innerText)
    );
    const form = btn.closest("form");
    const invalid = [...form.querySelectorAll("input,select,textarea")]
      .filter((el) => !el.checkValidity())
      .map((el) => ({
        tag: el.tagName,
        type: el.type,
        ph: el.placeholder || "",
        required: el.required,
        value: el.value,
        msg: el.validationMessage,
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      }));
    return {
      formValid: form.checkValidity(),
      btnText: btn.innerText.trim(),
      invalidCount: invalid.length,
      invalid,
    };
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
