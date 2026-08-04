const L = require("./_lib");

// Live-activity toasts float over the top-right action bar and swallow clicks.
async function dismissToasts(page) {
  const n = await page.evaluate(() => {
    let closed = 0;
    document.querySelectorAll("button").forEach((b) => {
      const t = (b.innerText || "").trim();
      const r = b.getBoundingClientRect();
      if ((t === "×" || t === "✕" || t === "x") && r.top < 250 && r.left > window.innerWidth / 2) {
        b.click(); closed++;
      }
    });
    return closed;
  });
  console.log("  [toast] dismissed:", n);
  await L.sleep(800);
}

(async () => {
  const { page } = await L.connect();
  await dismissToasts(page);
  await L.clickByText(page, "button", /^Mark Closing$/i);
  await L.sleep(3500);
  await L.shot(page, "probe18-booking-form");
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1600));
  console.log("BODY:", body);
  console.log("\nFIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

module.exports = { dismissToasts };
