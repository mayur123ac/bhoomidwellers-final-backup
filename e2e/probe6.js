const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  console.log("URL:", page.url());
  await L.shot(page, "probe6-current");
  const f = await L.dumpFields(page);
  console.log("FIELDS:");
  f.forEach((x) => console.log("  " + JSON.stringify(x)));
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1200));
  console.log("\nBODY:", txt);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
