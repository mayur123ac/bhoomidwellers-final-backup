const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();
  const today = new Date().toISOString().slice(0, 10);

  // Re-assert the sanction fields, then confirm what is actually in them.
  await F.setByPlaceholder(page, "38,00,000", "65,00,000");
  await F.setByLabel(page, /Sanction Date/, today);
  await F.setByLabel(page, /^Status$/, "Sanctioned", -1);
  await L.sleep(800);

  const vals = await page.evaluate(() => {
    const grab = (lre) => {
      const re = new RegExp(lre, "i");
      const hits = [];
      document.querySelectorAll("input,select").forEach((el) => {
        let lbl = "", p = el.closest("div");
        for (let i = 0; i < 5 && p; i++) {
          const l = p.querySelector("label");
          if (l && l.innerText.trim()) { lbl = l.innerText.trim(); break; }
          p = p.parentElement;
        }
        if (re.test(lbl)) hits.push(el.value);
      });
      return hits;
    };
    return {
      sanctioned: grab("Amount Sanctioned"),
      sanctionDate: grab("Sanction Date"),
      status: grab("^Status$"),
    };
  });
  console.log("  [sanction] field values:", JSON.stringify(vals));

  await L.clickInPage(page, "button", /^Update Lender$/);
  await L.sleep(3000);
  const lender = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("LENDER APPLICATIONS (");
    return t.slice(i, i + 300);
  });
  console.log("  [lender]", lender);

  try {
    await L.clickInPage(page, "button", /^Select this lender$/);
    await L.sleep(2500);
    console.log("  [lender] marked as selected");
  } catch (e) { console.log("  [lender] select unavailable:", e.message); }

  await L.clickInPage(page, "button", /^Save Loan & Deal Tracker$/);
  await L.sleep(6000);
  await L.shot(page, "stage5-sanction-saved");
  console.log("  [save] unsaved banner:",
    await page.evaluate(() => /Unsaved changes/.test(document.body.innerText)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE5a2 FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage5a2-FAILURE"); } catch {}
  process.exit(1);
});
