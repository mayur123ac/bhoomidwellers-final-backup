const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickInPage(page, "button", /Add Tranche/);
  await L.sleep(2500);
  await L.shot(page, "stage5-add-tranche-form");
  console.log("FIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  const seg = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("7. DISBURSEMENT");
    return t.slice(i, i + 800);
  });
  console.log("\nDISBURSEMENT:", seg);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
