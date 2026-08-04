const L = require("./_lib");

// React tracks input value on the DOM node; assigning .value directly is ignored
// on the next render. Use the native setter so React's onChange actually fires.
async function setNative(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error("no element " + sel);
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, value);
}

(async () => {
  const { page } = await L.connect();

  // Tomorrow at 11:00, in the browser's local timezone.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const dt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T11:00`;
  console.log("  [visit] scheduling for", dt);

  await setNative(page, 'input[type="datetime-local"]', dt);
  await setNative(page, "textarea", "E2E test site visit");
  await L.sleep(800);

  const disabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Schedule");
    return b ? b.disabled : "missing";
  });
  console.log("  [visit] Schedule button disabled:", disabled);
  if (disabled === true) throw new Error("Schedule button still disabled after filling date");

  await L.shot(page, "stage2-visit-modal-filled");
  await L.clickByText(page, "button", /^Schedule$/);
  await L.sleep(4000);
  await L.shot(page, "stage2-visit-scheduled");

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  console.log("  [visit] modal closed:", !/Visit Date & Time/.test(body));
  const idx = body.indexOf("Site Visit History");
  console.log("  [visit] history section:", body.slice(idx, idx + 300));
  L.saveState({ visitDateTime: dt });
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE2a FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage2a-FAILURE"); } catch {}
  process.exit(1);
});
