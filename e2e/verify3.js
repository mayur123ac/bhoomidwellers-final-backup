const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  const out = await page.evaluate(async (id) => {
    const r = await fetch(`/api/walkin_enquiries`, { credentials: "include" });
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.enquiries || j.data || []);
    const lead = arr.find((x) => String(x.id) === String(id));
    const la = await fetch(`/api/walkin_enquiries/${id}/loan-applications`, { credentials: "include" });
    let lenders = null;
    try { lenders = await la.json(); } catch { lenders = "non-json " + la.status; }
    return {
      loan_tracking_info: lead ? lead.loan_tracking_info : "LEAD NOT FOUND",
      status: lead ? lead.status : null,
      lenderStatus: la.status,
      lenders,
    };
  }, st.leadId);
  console.log(JSON.stringify(out, null, 2).slice(0, 4000));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
