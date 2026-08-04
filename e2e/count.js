const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  const out = await page.evaluate(async (leadId) => {
    const r = await fetch("/api/followups", { credentials: "include" });
    const j = await r.json();
    const all = (j.data || []).filter((f) => String(f.leadId) === String(leadId));
    return {
      total: all.length,
      e2e: all.filter((f) => /E2E Test/i.test(f.message || "")).length,
      messages: all.map((f) => ({
        by: f.salesManagerName || f.createdBy,
        at: f.createdAt,
        msg: (f.message || "").replace(/\s+/g, " ").slice(0, 95),
      })),
    };
  }, st.leadId);
  console.log("TOTAL follow-ups on lead:", out.total, "| E2E-tagged:", out.e2e);
  out.messages.forEach((m, i) => console.log(`  ${String(i + 1).padStart(2)}. [${m.by}] ${m.msg}`));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
