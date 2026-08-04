const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();
  const out = await page.evaluate(async (phone) => {
    const who = JSON.parse(localStorage.getItem("crm_user") || "{}");
    const name = encodeURIComponent(who.name || "");
    const grab = async (u) => {
      const r = await fetch(u, { credentials: "include" });
      const j = await r.json().catch(() => null);
      const arr = j && (Array.isArray(j) ? j : j.data) || [];
      return { url: u, status: r.status, count: arr.length, hasOurLead: arr.some((x) => JSON.stringify(x).includes(phone)) };
    };
    return {
      user: who,
      assigned: await grab(`/api/receptionist/assigned?name=${name}`),
      self: await grab(`/api/receptionist/leads?name=${name}`),
    };
  }, st.phone);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
