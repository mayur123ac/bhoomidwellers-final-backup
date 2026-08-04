const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const tab = process.argv[2];
  if (tab) {
    await L.clickInPage(page, "button", new RegExp("^" + tab + "$"));
    await L.sleep(3500);
  }
  await L.shot(page, "probe23-" + (tab || "summary").replace(/\s+/g, "-").toLowerCase());
  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("Back to Lead Details");
    return t.slice(i, i + 3000);
  });
  console.log("BODY:", body);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
