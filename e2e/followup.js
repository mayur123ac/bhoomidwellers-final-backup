// Adds a follow-up note through the on-screen composer and verifies it lands
// in the timeline. Exits non-zero if the note does not persist.
const L = require("./_lib");

// Sales panel says "Add follow-up note...", admin panel says "Add admin note...".
const SEL = 'input[placeholder="Add follow-up note..."], input[placeholder="Add admin note..."]';

async function addFollowUp(page, text) {
  await page.waitForSelector(SEL, { timeout: 20000 });
  await page.click(SEL, { clickCount: 3 });
  await page.type(SEL, text, { delay: 4 });
  await L.sleep(300);
  await page.keyboard.press("Enter");
  await L.sleep(3000);

  // The note must be visible in the timeline afterwards.
  const probe = text.slice(0, 45);
  const ok = await page.evaluate((p) => document.body.innerText.includes(p), probe);
  if (!ok) throw new Error("FOLLOW-UP DID NOT PERSIST: " + text);
  const cleared = await page.$eval(SEL, (el) => el.value === "");
  console.log(`  [followup] saved (composer cleared=${cleared}): ${text.slice(0, 70)}`);
  return true;
}

module.exports = { addFollowUp, SEL };

if (require.main === module) {
  (async () => {
    const { page } = await L.connect();
    const text = process.argv.slice(2).join(" ");
    await addFollowUp(page, text);
    process.exit(0);
  })().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
