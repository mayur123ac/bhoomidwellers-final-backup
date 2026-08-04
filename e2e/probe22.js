const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const which = process.argv[2] || "Loan Tracking";
  await L.clickInPage(page, "button", new RegExp("^" + which + "$"));
  await L.sleep(4000);
  await L.shot(page, "probe22-" + which.replace(/\s+/g, "-").toLowerCase());
  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("Personal Information Loan Tracking");
    return t.slice(i, i + 3000);
  });
  console.log("BODY:", body);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
