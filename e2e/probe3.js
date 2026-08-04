const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickByText(page, "button", /Assign to Manager/i);
  await L.sleep(1500);
  await L.shot(page, "probe3-assign-manager");
  const f = await L.dumpFields(page);
  console.log("FIELDS after Assign to Manager:");
  f.forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
