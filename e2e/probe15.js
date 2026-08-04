const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  await L.login(page, "admin");
  await L.sleep(5000);
  await L.shot(page, "probe15-admin-dash");
  console.log("URL:", page.url());

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 900));
  console.log("BODY:", body);
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nNAV/BUTTONS:");
  (await L.dumpButtons(page)).slice(0, 45).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
