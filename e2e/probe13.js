const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickByText(page, "button", /Track Loan/i);
  await L.sleep(3500);
  await L.shot(page, "probe13-loan-form");
  console.log("FIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 2500));
  console.log("\nBODY:", body);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
