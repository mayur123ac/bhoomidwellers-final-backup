const L = require("./_lib");
const { addFollowUp } = require("./followup");

(async () => {
  const { page } = await L.connect();
  const note = process.argv.slice(2).join(" ");
  try {
    await L.clickInPage(page, "button", /^Back to Lead Details$/);
    await L.sleep(3000);
  } catch { /* already on the lead view */ }
  await L.dismissToasts(page);
  if (note) await addFollowUp(page, note);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
