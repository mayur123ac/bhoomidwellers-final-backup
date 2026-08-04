const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  if (!page.url().includes("/dashboard/receptionist")) await L.login(page, "receptionist");
  await L.clickByText(page, "button", /New Entry/i);
  await L.sleep(2500);
  await L.shot(page, "probe2-new-entry-form");
  const f = await L.dumpFields(page);
  console.log("FIELDS (" + f.length + "):");
  f.forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
