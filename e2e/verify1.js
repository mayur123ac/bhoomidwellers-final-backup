const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  console.log("looking for:", st.leadName, st.phone);

  // Pull the raw record so later stages have its real id / lead number.
  const res = await page.evaluate(async (phone) => {
    const r = await fetch("/api/walkin_enquiries", { credentials: "include" });
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch { return { error: "non-json", status: r.status, body: txt.slice(0, 300) }; }
    const arr = Array.isArray(data) ? data : (data.enquiries || data.data || data.leads || []);
    const hits = arr.filter((x) => JSON.stringify(x).includes(phone));
    return { status: r.status, total: arr.length, hits: hits.slice(0, 3), keys: arr[0] ? Object.keys(arr[0]) : [] };
  }, st.phone);

  console.log(JSON.stringify(res, null, 2).slice(0, 4000));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
