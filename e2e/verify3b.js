const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  const out = await page.evaluate(async (id) => {
    const r = await fetch(`/api/loan?lead_id=${id}`, { credentials: "include" });
    return { status: r.status, body: await r.json().catch(() => "non-json") };
  }, st.leadId);
  console.log(JSON.stringify(out, null, 2).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
