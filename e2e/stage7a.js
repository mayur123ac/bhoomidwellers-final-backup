const L = require("./_lib");
const F = require("./_form");

(async () => {
  const { page } = await L.connect();
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const reg = d(30), poss = d(365);
  console.log("  [dates] registration:", reg, " possession:", poss);

  await L.clickInPage(page, "button", /^View Booking Form$/);
  await L.sleep(3500);
  await L.clickInPage(page, "button", /^Edit Booking Form$/);
  await L.sleep(3500);
  let step = await F.stepInfo(page);
  for (let i = 0; i < 4 && !/Step 3 of 6/.test(step); i++) step = await F.next(page);
  console.log("  [nav]", step);

  await F.setByPlaceholder(page, "Registration No.", "E2ETEST123456");
  await F.setByLabel(page, /Expected Registration Date/, reg);
  await F.setByLabel(page, /Actual Registration Date/, reg);
  await F.setByLabel(page, /Registration Remarks/, "E2E test registration");
  await F.setByLabel(page, /Expected Possession Date/, poss);

  // Registration status: the only Pending/Scheduled/Completed select on this step.
  const rs = await page.evaluate(() => {
    const sels = [...document.querySelectorAll("select")].filter((s) => {
      const o = [...s.options].map((x) => x.text.trim()).join(",");
      return o === "Pending,Scheduled,Completed";
    });
    if (!sels.length) return "no registration-status select";
    const s = sels[0];
    const o = [...s.options].find((x) => x.text.trim() === "Completed");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(s, o.value);
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return `set (${sels.length} candidate select(s))`;
  });
  console.log("  [registration status]", rs);

  // "Upcoming" is not a possession state in this CRM; the pre-possession value
  // is Pre-Construction.
  await F.setByLabel(page, /Possession Status/, "Pre-Construction");
  await L.sleep(1000);
  await L.shot(page, "stage7-registration-filled");

  const seg = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const i = t.indexOf("REGISTRATION Fee (auto)");
    return t.slice(i, i + 400);
  });
  console.log("  [reg block]", seg);

  // Walk to the last step and save.
  for (let i = 0; i < 4; i++) {
    step = await F.stepInfo(page);
    if (/Step 6 of 6/.test(step)) break;
    step = await F.next(page);
    console.log("  ->", step);
  }
  await L.sleep(1500);
  await L.shot(page, "stage7-review");
  console.log("BUTTONS:");
  (await L.dumpButtons(page)).filter((b) => /Save|Update|Submit/i.test(b.text))
    .forEach((b) => console.log("  " + JSON.stringify(b)));
  process.exit(0);
})().catch(async (e) => {
  console.error("STAGE7a FAILED:", e.message);
  try { const { page } = await L.connect(); await L.shot(page, "stage7a-FAILURE"); } catch {}
  process.exit(1);
});
