const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  console.log("URL:", page.url());
  await L.shot(page, "probe10-state");
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1500));
  console.log("BODY:", t);
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).slice(0, 50).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
