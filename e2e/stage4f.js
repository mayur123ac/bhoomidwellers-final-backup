const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();

  // Scroll the T&C panel to the bottom so the consent group is enabled.
  const scrolled = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("h-40") && d.className.includes("overflow-y-auto")
    );
    if (!el) return "T&C panel not found";
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    return `scrollTop=${el.scrollTop} client=${el.clientHeight} scrollHeight=${el.scrollHeight}`;
  });
  console.log("  [t&c]", scrolled);
  await L.sleep(1200);

  const enabled = await page.evaluate(() =>
    ![...document.querySelectorAll("div")].some(
      (d) => d.className.includes("pointer-events-none") && /irrevocable consent/i.test(d.innerText || "")
    )
  );
  console.log("  [t&c] consent group enabled:", enabled);

  // The consent controls are <div onClick> boxes inside <label>, not inputs.
  const clicked = await page.evaluate(() => {
    const wanted = [
      /All information provided is true/i,
      /read and accept all Terms/i,
      /irrevocable consent/i,
    ];
    const out = [];
    for (const re of wanted) {
      const lbl = [...document.querySelectorAll("label")].find((l) => re.test(l.innerText || ""));
      if (!lbl) { out.push("label-missing: " + re); continue; }
      const box = lbl.querySelector("div");
      if (!box) { out.push("box-missing: " + re); continue; }
      box.click();
      out.push("clicked: " + lbl.innerText.replace(/\s+/g, " ").slice(0, 45));
    }
    return out;
  });
  clicked.forEach((c) => console.log("  [decl]", c));
  await L.sleep(1000);

  // A ticked box renders a check icon inside it.
  const ticks = await page.evaluate(() =>
    [...document.querySelectorAll("label")]
      .filter((l) => /information provided is true|accept all Terms|irrevocable consent/i.test(l.innerText || ""))
      .map((l) => !!l.querySelector("svg"))
  );
  console.log("  [decl] ticked:", JSON.stringify(ticks));
  await L.shot(page, "stage4-step5-checked");

  console.log("step5 ->", await F.next(page));
  await L.sleep(1500);
  await L.shot(page, "stage4-step6-review");

  const b6 = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.lastIndexOf("Declaration Review");
    return t.slice(i, i + 1800);
  });
  console.log("\nSTEP 6 BODY:", b6);
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4f FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4f-FAILURE"); } catch {}
  process.exit(1);
});
