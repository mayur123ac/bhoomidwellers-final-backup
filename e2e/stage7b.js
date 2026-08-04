const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const seen = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/api/booking-applications")) return;
    let b = ""; try { b = (await r.text()).slice(0, 300); } catch {}
    seen.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:3000","")} :: ${b}`);
  });

  await L.clickInPage(page, "button", /^Save Booking$/);
  await L.sleep(9000);
  await L.shot(page, "stage7-booking-saved");
  console.log("API:");
  seen.forEach((s) => console.log("  " + s));

  const st = L.loadState();
  const rec = await page.evaluate(async (bid) => {
    const r = await fetch(`/api/booking-applications/${bid}`, { credentials: "include" });
    const j = await r.json().catch(() => null);
    const b = j && (j.data || j);
    return b ? {
      booking_number: b.booking_number,
      registration_number: b.registration_number,
      registration_status: b.registration_status,
      expected_registration_date: b.expected_registration_date,
      actual_registration_date: b.actual_registration_date,
      expected_possession_date: b.expected_possession_date,
      possession_status: b.possession_status,
    } : "not found";
  }, st.bookingId);
  console.log("  [booking]", JSON.stringify(rec, null, 2));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE7b FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage7b-FAILURE"); } catch {}
  process.exit(1);
});
