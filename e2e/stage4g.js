const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();

  await L.clickInPage(page, "button", /^Draw$/);
  await L.sleep(1200);

  // Bring the signature canvas fully into view, then sign with real mouse moves.
  const box = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    c.scrollIntoView({ block: "center", behavior: "instant" });
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) throw new Error("no signature canvas found");
  console.log("  [sign] canvas:", JSON.stringify(box));
  await L.sleep(600);

  const b2 = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  const midY = b2.y + b2.h / 2;
  await page.mouse.move(b2.x + 25, midY);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const x = b2.x + 25 + (b2.w - 60) * (i / 24);
    const y = midY + Math.sin(i / 2.2) * (b2.h / 5);
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
  await L.sleep(1200);
  await L.shot(page, "stage4-signature");

  const signed = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    return { inkPixels: ink, canvasPx: c.width * c.height };
  });
  console.log("  [sign] ink pixels:", JSON.stringify(signed));
  if (signed.inkPixels === 0) throw new Error("signature canvas is still blank");

  console.log("step5 ->", await F.next(page));
  await L.sleep(1500);
  await L.shot(page, "stage4-step6-review");
  const errs = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    return /Signature is required|Please accept all declarations/.test(t);
  });
  console.log("  [validation] blocking errors visible:", errs);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4g FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4g-FAILURE"); } catch {}
  process.exit(1);
});
