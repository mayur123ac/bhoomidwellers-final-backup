const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => ({
      text: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
      disabled: b.disabled,
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    })).filter((b) => b.text)
  );
  console.log("ALL BUTTONS (incl. zero-size):");
  btns.forEach((b) => console.log("  " + JSON.stringify(b)));

  const lender = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("EDIT LENDER");
    return t.slice(i, i + 700);
  });
  console.log("\nEDIT LENDER PANEL:", lender);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
