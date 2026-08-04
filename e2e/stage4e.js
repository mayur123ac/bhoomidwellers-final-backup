const L = require("./_lib");

(async () => {
  const { page } = await L.connect();

  // The T&C panel must be scrolled to the bottom before the consent
  // checkboxes are enabled.
  const scrolled = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("div")].filter(
      (d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 60 &&
             /Cheques to be made in Favor|Terms and Conditions/i.test(d.innerText || "")
    );
    const target = boxes[boxes.length - 1];
    if (!target) return "no scrollable T&C box";
    target.scrollTop = target.scrollHeight;
    target.dispatchEvent(new Event("scroll", { bubbles: true }));
    return `scrolled ${target.scrollHeight}px (client ${target.clientHeight})`;
  });
  console.log("  [t&c]", scrolled);
  await L.sleep(1500);

  const decl = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    const info = boxes.map((c) => ({ disabled: c.disabled, checked: c.checked }));
    boxes.forEach((c) => { if (!c.disabled && !c.checked) c.click(); });
    return { count: boxes.length, before: info, after: boxes.map((c) => c.checked) };
  });
  console.log("  [declaration]", JSON.stringify(decl));
  await L.sleep(800);
  await L.shot(page, "stage4-step5-checked");
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4e FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4e-FAILURE"); } catch {}
  process.exit(1);
});
