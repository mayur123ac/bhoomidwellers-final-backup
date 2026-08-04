const L = require("./_lib");

(async () => {
  const { page } = await L.connect();

  const info = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Save Loan & Deal Tracker/.test(b.innerText)
    );
    if (!btn) return "no button";
    const r = btn.getBoundingClientRect();
    // What element actually receives a click at the button's centre?
    const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      type: btn.type,
      disabled: btn.disabled,
      inForm: !!btn.closest("form"),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      topElAtCentre: topEl ? topEl.tagName + "." + String(topEl.className).slice(0, 60) : null,
      topIsButton: topEl === btn || (topEl && btn.contains(topEl)),
    };
  });
  console.log("BUTTON:", JSON.stringify(info, null, 2));

  page.on("response", async (r) => {
    if (r.url().includes("/api/loan") || r.url().includes("/api/walkin_enquiries/")) {
      let b = ""; try { b = (await r.text()).slice(0, 300); } catch {}
      console.log(`  [net] ${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:3000","")} :: ${b}`);
    }
  });

  // Submit the form directly, the way the button is meant to.
  const fired = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Save Loan & Deal Tracker/.test(b.innerText)
    );
    const form = btn.closest("form");
    if (!form) return "no form";
    form.requestSubmit ? form.requestSubmit(btn) : form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return "submitted";
  });
  console.log("FIRED:", fired);
  await L.sleep(7000);
  await L.shot(page, "debug4-after-requestSubmit");
  const t = await page.evaluate(() => /Unsaved changes/.test(document.body.innerText));
  console.log("still unsaved:", t);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
