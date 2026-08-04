const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const info = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^Mark Closing$/.test(b.innerText.trim()));
    if (!btn) return "no button";
    btn.scrollIntoView({ block: "center", behavior: "instant" });
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    let e = top;
    for (let i = 0; i < 4 && e; i++) { chain.push(e.tagName + "|" + String(e.className).slice(0, 50) + "|" + (e.innerText || "").replace(/\s+/g," ").slice(0, 40)); e = e.parentElement; }
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, cx: Math.round(cx), cy: Math.round(cy), isBtn: top === btn || btn.contains(top), chain };
  });
  console.log(JSON.stringify(info, null, 2));

  // Click it directly in-page (bypasses any overlay hit-testing).
  page.on("response", (r) => { if (r.url().includes("/api/")) console.log("  [net]", r.status(), r.request().method(), r.url().replace("http://localhost:3000","")); });
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^Mark Closing$/.test(b.innerText.trim()));
    btn.click();
    return "in-page click sent";
  });
  console.log(clicked);
  await L.sleep(3500);
  await L.shot(page, "debug7-after-inpage-click");
  const has = await page.evaluate(() => {
    const t = document.body.innerText;
    return { bookingForm: /Booking Application|Applicant|Unit Details|Declaration/i.test(t), dialogs: document.querySelectorAll('[role="dialog"]').length };
  });
  console.log("MODAL?", JSON.stringify(has));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
