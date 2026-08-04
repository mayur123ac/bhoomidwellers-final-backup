const L = require("./_lib");

const NAME = "E2E Test Lead " + Date.now();
const PHONE = "9000000001";

// Picks an <option> by its visible text across every select on the page.
async function selectOption(page, optionText) {
  const ok = await page.evaluate((txt) => {
    for (const sel of document.querySelectorAll("select")) {
      for (const o of sel.options) {
        if (o.text.trim().toLowerCase() === txt.toLowerCase()) {
          sel.value = o.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  }, optionText);
  if (!ok) throw new Error("no option matching: " + optionText);
}

async function fill(page, placeholder, value) {
  const sel = `input[placeholder="${placeholder}"]`;
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, value, { delay: 6 });
}

(async () => {
  const { page } = await L.connect();
  await L.login(page, "receptionist");
  await L.sleep(2500);

  await L.clickByText(page, "button", /New Entry/i);
  await L.sleep(2000);

  await fill(page, "e.g. Mayur Acharya", NAME);
  await fill(page, "Full residential address", "E2E Test Address, Mumbai");
  await fill(page, "8369787919", PHONE);
  await fill(page, "9876543210", "9000000002");
  await fill(page, "email@example.com", "e2etest@test.com");
  await fill(page, "e.g. 80 Lakhs, 1.5 Cr", "75,00,000");
  await fill(page, "e.g. 2 BHK, 3 BHK, Studio", "2 BHK");

  await selectOption(page, "Salaried");
  await selectOption(page, "Yes");
  await selectOption(page, "Investment");
  // The Source dropdown has no "Walk-in" option (this form IS the walk-in
  // intake), but picking "Others" reveals a required free-text "Specify Source"
  // box — that is where the literal "Walk-in" value goes.
  await selectOption(page, "Others");
  await L.sleep(800);
  await fill(page, "Please specify the lead source", "Walk-in");

  // Route to the sales manager (Megha) so Stage 2 can pick the lead up.
  await L.clickByText(page, "button", /Assign to Manager/i);
  await L.sleep(1200);
  const picked = await page.evaluate(() => {
    // Click the whole row ("Megha (Sales Manager)"), not the inner name span.
    const els = [...document.querySelectorAll("div,li,button")];
    const hit = els.find((e) => {
      const t = (e.innerText || "").trim().replace(/\s+/g, " ");
      return /^Megha\s*\(Sales Manager\)$/.test(t) &&
        /cursor-pointer/.test((e.className || "").toString());
    });
    if (hit) { hit.click(); return hit.innerText.trim(); }
    return null;
  });
  if (!picked) throw new Error("could not select Megha as sales manager");
  await L.sleep(1000);
  // Verify the picker actually committed the choice.
  const stillUnset = await page.evaluate(() =>
    /-- Select Sales Manager --/.test(document.body.innerText)
  );
  if (stillUnset) throw new Error("sales manager picker did not commit selection (still shows placeholder)");
  console.log("  [assign] picked:", picked.replace(/\s+/g, " "));
  await L.shot(page, "stage1-form-filled");

  await L.clickByText(page, "button", /^Submit$/i);
  await L.sleep(5000);
  await L.shot(page, "stage1-after-submit");

  // Any alert/toast text still on screen?
  const body = await page.evaluate(() => document.body.innerText);
  const modalStillOpen = /Client Enquiry Form/.test(body);
  console.log("  [submit] modal still open:", modalStillOpen);

  L.saveState({ leadName: NAME, phone: PHONE });
  console.log("LEAD_NAME=" + NAME);
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE1 FAILED:", e.message);
  try {
    const { page } = await L.connect();
    await L.shot(page, "stage1-FAILURE");
  } catch {}
  process.exit(1);
});
