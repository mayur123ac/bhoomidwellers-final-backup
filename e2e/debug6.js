const L = require("./_lib");

(async () => {
  const { page } = await L.connect();

  const reqs = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) reqs.push(r.method() + " " + r.url().replace("http://localhost:3000", "")); });

  // Scroll the button into view inside whatever container actually scrolls.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Save Loan & Deal Tracker/.test(b.innerText)
    );
    btn.scrollIntoView({ block: "center", behavior: "instant" });
  });
  await L.sleep(1200);

  const pos = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Save Loan & Deal Tracker/.test(b.innerText)
    );
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      topEl: top ? top.tagName + "|" + top.innerText.slice(0, 40) : null,
      isBtn: top === btn || (top && btn.contains(top)),
    };
  });
  console.log("POS:", JSON.stringify(pos));

  await L.shot(page, "debug6-scrolled");

  // Real mouse click at the button centre.
  await page.mouse.click(pos.rect.x + pos.rect.w / 2, pos.rect.y + pos.rect.h / 2);
  await L.sleep(1000);
  const btnTextDuring = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Save Loan|Saving/.test(x.innerText));
    return b ? b.innerText.trim() : "gone";
  });
  console.log("BUTTON DURING:", btnTextDuring);
  await L.sleep(6000);

  console.log("API REQUESTS SEEN:");
  reqs.forEach((r) => console.log("   " + r));
  const t = await page.evaluate(() => /Unsaved changes/.test(document.body.innerText));
  console.log("still unsaved:", t);
  await L.shot(page, "debug6-after-click");
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
