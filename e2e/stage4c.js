const L = require("./_lib");
const F = require("./_form");

// The cost-breakdown rows are unlabelled inputs; locate each by the row text
// that sits next to it.
async function setByRowText(page, phrase, value) {
  const r = await page.evaluate((ph, val) => {
    const inputs = [...document.querySelectorAll("input")];
    for (const el of inputs) {
      let p = el.parentElement;
      for (let i = 0; i < 4 && p; i++) {
        const txt = (p.innerText || "").replace(/\s+/g, " ");
        if (txt.includes(ph) && txt.length < 160) {
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return "ok";
        }
        p = p.parentElement;
      }
    }
    return "not-found";
  }, phrase, value);
  if (r !== "ok") throw new Error(`setByRowText(${phrase}) -> ${r}`);
}

(async () => {
  const { page } = await L.connect();
  const today = new Date().toISOString().slice(0, 10);

  await F.setByPlaceholder(page, "1,00,000", "1,50,000");          // Booking Amount
  await setByRowText(page, "Legal Charges", "25,000");
  await setByRowText(page, "Maintenance Deposit", "35,000");
  await L.sleep(800);

  // GST 5% is already applied; click the button anyway as the spec asks.
  await L.clickInPage(page, "button", /^5%$/);
  await L.sleep(600);

  // Additional OCR payment.
  await F.setByLabel(page, /Additional Own Payment/, "5,00,000");
  await F.setByLabel(page, /Received Date/, today);
  await F.setByLabel(page, /OCR Payment Mode/, "Cheque");
  await F.setByPlaceholder(page, "Remarks", "E2E test OCR payment");
  await L.sleep(1500);
  await L.shot(page, "stage4-step3-filled");

  // ── OCR lock / allocatable-hint assertions ────────────────────────────────
  const ocr = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("OWN CONTRIBUTION");
    const seg = t.slice(i, i + 700);
    const addl = [...document.querySelectorAll("input")].find((el) => {
      let p = el.closest("div");
      for (let k = 0; k < 5 && p; k++) {
        const l = p.querySelector("label");
        if (l && /Additional Own Payment/i.test(l.innerText)) return true;
        p = p.parentElement;
      }
      return false;
    });
    return {
      segment: seg,
      addlDisabled: addl ? addl.disabled || addl.readOnly : "input-missing",
      allocatableHint: (t.match(/[₹0-9,\.]+ remaining allocatable/i) || [null])[0],
      hasLockBanner: /locked|cannot allocate|exceeds/i.test(seg),
    };
  });
  console.log("  [ocr] addl input disabled/readonly:", ocr.addlDisabled);
  console.log("  [ocr] allocatable hint:", ocr.allocatableHint);
  console.log("  [ocr] lock/exceed wording present:", ocr.hasLockBanner);
  console.log("  [ocr] segment:", ocr.segment);

  console.log("step3 ->", await F.next(page));
  await L.sleep(1200);
  await L.shot(page, "stage4-step4-source");
  console.log("\nSTEP 4 FIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  const b4 = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("Source & Notes");
    return t.slice(i, i + 900);
  });
  console.log("\nSTEP 4 BODY:", b4);
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4c FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4c-FAILURE"); } catch {}
  process.exit(1);
});
