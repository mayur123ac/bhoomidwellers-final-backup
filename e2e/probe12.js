const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.clickByText(page, "button", /Fill Salesform/i);
  await L.sleep(3000);
  await L.shot(page, "probe12-salesform");
  console.log("FIELDS:");
  (await L.dumpFields(page)).forEach((x) => console.log("  " + JSON.stringify(x)));
  console.log("\nBUTTONS:");
  (await L.dumpButtons(page)).forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
