const L = require("./_lib");

(async () => {
  const { page } = await L.connect();

  const seen = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/api/booking-applications")) return;
    let b = ""; try { b = (await r.text()).slice(0, 600); } catch {}
    seen.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:3000","")} :: ${b}`);
  });

  await L.clickInPage(page, "button", /^Save Booking$/);
  await L.sleep(9000);
  await L.shot(page, "stage4-booking-created");

  console.log("BOOKING API CALLS:");
  seen.forEach((s) => console.log("  " + s));

  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const bk = body.match(/BK-?[A-Za-z0-9\-\/]+/);
  console.log("  [booking] number on screen:", bk ? bk[0] : "(none found)");
  console.log("  [booking] modal closed:", !/Step \d of 6/.test(body));

  const st = L.loadState();
  const rec = await page.evaluate(async (leadId) => {
    const r = await fetch(`/api/booking-applications?lead_id=${leadId}`, { credentials: "include" });
    const j = await r.json().catch(() => null);
    const arr = j && (Array.isArray(j) ? j : j.data) || [];
    return arr.map((b) => ({
      id: b.id, booking_number: b.booking_number, status: b.status,
      agreement_value: b.agreement_value, booking_amount: b.booking_amount,
      token_amount: b.token_amount, gst_rate: b.gst_rate,
      stamp_duty_amount: b.stamp_duty_amount, registration_fee_amount: b.registration_fee_amount,
      legal_charges: b.legal_charges, maintenance_deposit: b.maintenance_deposit,
      flat_number: b.flat_number, project_name: b.project_name,
    }));
  }, st.leadId);
  console.log("  [booking] records:", JSON.stringify(rec, null, 2));
  if (rec[0]) L.saveState({ bookingId: rec[0].id, bookingNumber: rec[0].booking_number });
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE4h FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage4h-FAILURE"); } catch {}
  process.exit(1);
});
