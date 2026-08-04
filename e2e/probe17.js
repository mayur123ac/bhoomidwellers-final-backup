const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickByText(page, "button", /^Mark Closing$/i);
  await L.sleep(3000);
  await L.shot(page, "probe17-mark-closing");
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1500));
  console.log("BODY:", body);
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
