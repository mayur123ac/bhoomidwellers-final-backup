// Launches a long-lived headful Chrome with a fixed remote-debugging port.
// Keep this running in the background; every stage script attaches to it.
const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1600, height: 950 },
    args: [
      "--remote-debugging-port=9222",
      "--window-size=1600,1000",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const [page] = await browser.pages();
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  console.log("BROWSER_READY " + browser.wsEndpoint());
  // Park forever — the stage scripts drive this instance.
  await new Promise(() => {});
})();
