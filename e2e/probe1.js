const L = require("./_lib");

(async () => {
  const { page } = await L.connect();
  await L.login(page, "receptionist");
  await L.sleep(2000);
  await L.shot(page, "probe1-receptionist-dash");
  console.log("URL:", page.url());
  const btns = await L.dumpButtons(page);
  console.log("BUTTONS/LINKS:");
  btns.forEach((b) => console.log("  -", JSON.stringify(b)));
  process.exit(0);
})().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
