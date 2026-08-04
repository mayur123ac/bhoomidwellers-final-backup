const L = require("./_lib");

(async () => {
  const { page } = await L.connect();

  page.on("console", (m) => console.log("  [console]", m.type(), m.text().slice(0, 300)));
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 300)));
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    let body = "";
    try { body = (await r.text()).slice(0, 400); } catch {}
    console.log(`  [net] ${r.status()} ${r.request().method()} ${u.replace("http://localhost:3000", "")} :: ${body}`);
  });

  // What does the form look like right now?
  const before = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    return {
      unsaved: /Unsaved changes/.test(t),
      hasSaveBtn: [...document.querySelectorAll("button")].some((b) => /Save Loan & Deal Tracker/.test(b.innerText)),
      agreement: (document.querySelector('input[placeholder="e.g. 50,00,000"]') || {}).value,
      token: (document.querySelector('input[placeholder="50,000"]') || {}).value,
      income: (document.querySelector('input[placeholder="Monthly Income"]') || {}).value,
    };
  });
  console.log("BEFORE:", JSON.stringify(before));

  await L.clickByText(page, "button", /Save Loan & Deal Tracker/i);
  await L.sleep(7000);
  await L.shot(page, "debug3-after-save");

  const after = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const errIdx = t.search(/error|failed|Failed/i);
    return {
      unsaved: /Unsaved changes/.test(t),
      nearError: errIdx >= 0 ? t.slice(Math.max(0, errIdx - 120), errIdx + 200) : null,
    };
  });
  console.log("AFTER:", JSON.stringify(after, null, 2));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
