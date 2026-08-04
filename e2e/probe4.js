const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const info = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("div,li,button,span,p").forEach((e) => {
      const t = (e.innerText || "").trim().replace(/\s+/g, " ");
      if (/Megha/.test(t) && t.length < 120) {
        out.push({
          tag: e.tagName,
          cls: (e.className || "").toString().slice(0, 90),
          kids: e.children.length,
          text: t,
        });
      }
    });
    return out;
  });
  console.log("ELEMENTS CONTAINING 'Megha':");
  info.forEach((i) => console.log("  " + JSON.stringify(i)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
