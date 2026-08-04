const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const r = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("Closed or Lost leads cannot be modified");
    return {
      messageShown: i >= 0,
      context: i >= 0 ? t.slice(Math.max(0, i - 200), i + 120) : null,
      unsavedBanner: /Unsaved changes/.test(t),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
