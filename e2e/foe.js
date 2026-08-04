const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  const out = await page.evaluate(async (bid) => {
    const g = async (u) => {
      const r = await fetch(u, { credentials: "include" });
      let j; try { j = await r.json(); } catch { j = "non-json"; }
      return { status: r.status, body: j };
    };
    return {
      financial: await g(`/api/booking-applications/${bid}/financial-status`),
      paymentSummary: await g(`/api/booking-applications/${bid}/payment-summary`),
    };
  }, st.bookingId);
  console.log(JSON.stringify(out, null, 2).slice(0, 6000));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
