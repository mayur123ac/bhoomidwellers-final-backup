const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.dismissToasts(page);
  await L.clickInPage(page, "button", /^Track Loan$/);
  await L.sleep(4000);
  await L.shot(page, "probe20-loan-overview");

  const body = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.search(/DEAL QUALIFICATION|LENDER APPLICATIONS|Financial Position/i);
    return t.slice(i, i + 2600);
  });
  console.log("BODY:", body);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
