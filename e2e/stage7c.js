const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  const st = L.loadState();

  const lead = await page.evaluate(async (id) => {
    const r = await fetch(`/api/walkin_enquiries/${id}`, { credentials: "include" });
    const j = await r.json().catch(() => null);
    const d = j && (j.data || j);
    return d ? { id: d.id, status: d.status, closing_date: d.closing_date, is_lost_lead: d.is_lost_lead } : "not found";
  }, st.leadId);
  console.log("  [lead]", JSON.stringify(lead));

  const ui = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const names = [...document.querySelectorAll("button")]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => b.innerText.replace(/\s+/g, " ").trim());
    return {
      readOnlyBanner: /Lead Closed .? Read Only/.test(t),
      statusShown: (t.match(/Status ([A-Za-z ()]+?) (?:📍|OTHERS DATA)/) || [])[1] || null,
      editActionsPresent: names.filter((n) =>
        /Fill Salesform|Track Loan|Mark Closing|Lost Lead|^Transfer$|Schedule Visit|Re-Site Visit/.test(n)),
      followUpComposer: !!document.querySelector(
        'input[placeholder="Add admin note..."], input[placeholder="Add follow-up note..."]'
      ),
      reopenAvailable: names.some((n) => /Reopen Lead/.test(n)),
    };
  });
  console.log("  [ui]", JSON.stringify(ui, null, 2));
  await L.shot(page, "stage7-lead-closed");
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
