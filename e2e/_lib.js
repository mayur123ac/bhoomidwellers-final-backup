// Shared helpers for the CRM E2E lifecycle test.
// Scripts connect to a long-lived browser launched by launch.js so that
// session state survives across separate node invocations.
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SHOT_DIR = "d:\\tmp\\e2e-screenshots";
const STATE_FILE = path.join(__dirname, "state.json");
const BASE = "http://localhost:3000";

fs.mkdirSync(SHOT_DIR, { recursive: true });

const CREDS = {
  receptionist: { id: "receptionist@gmail.com", pw: "8369787919m@Y" },
  sales: { id: "megha@gmail.com", pw: "8369787919m@Y" },
  admin: { id: "admin@bhoomi.com", pw: "8369787919m@Y" },
  sourcing: { id: "sourcing@gmail.com", pw: "8369787919m@Y" },
};

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(patch) {
  const s = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  return s;
}

async function connect() {
  const browser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:9222",
    defaultViewport: { width: 1600, height: 950 },
  });
  const pages = await browser.pages();
  const page = pages.find((p) => !p.url().startsWith("devtools://")) || (await browser.newPage());
  await page.setViewport({ width: 1600, height: 950 });
  return { browser, page };
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, name.endsWith(".png") ? name : name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  console.log("  [shot] " + file);
  return file;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Logs out (clears cookie + localStorage) then signs in as `role`.
async function login(page, role) {
  const c = CREDS[role];
  if (!c) throw new Error("unknown role " + role);

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  // Hard reset any prior session: cookie + the localStorage copy the app keeps.
  const client = await page.createCDPSession();
  await client.send("Network.clearBrowserCookies");
  await client.detach();
  await page.evaluate(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle2" });

  await page.waitForSelector('input[type="text"]', { timeout: 20000 });
  await page.type('input[type="text"]', c.id, { delay: 8 });
  await page.type('input[type="password"]', c.pw, { delay: 8 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2500);

  const url = page.url();
  if (url.replace(/\/$/, "") === BASE) {
    const err = await page
      .$eval("form div.border", (el) => el.innerText)
      .catch(() => "(no error element found)");
    throw new Error(`LOGIN FAILED for ${role} (${c.id}) — still on login page. Page said: ${err}`);
  }
  console.log(`  [login] ${role} -> ${url}`);
  return url;
}

// Click the first element whose visible text matches `re`, retrying while the
// React tree re-renders (handles detach mid-click otherwise).
async function clickByText(page, selector, re, opts = {}) {
  const tries = opts.tries || 5;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await clickByTextOnce(page, selector, re, opts);
    } catch (e) {
      last = e;
      await sleep(1200);
    }
  }
  throw last;
}

async function clickByTextOnce(page, selector, re, opts = {}) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    // Collapse internal whitespace: labels often wrap across lines, so raw
    // innerText carries newlines that break multi-word patterns.
    const txt =
      (await h.evaluate((el) =>
        (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()
      )) || "";
    if (re.test(txt)) {
      const visible = await h.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!visible && !opts.allowHidden) continue;
      // These panels scroll internally, so a control can sit far below the
      // viewport. Centre it first, then click real coordinates — an
      // ElementHandle click on an off-screen point silently does nothing.
      await h.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await sleep(500);
      const box = await h.boundingBox();
      if (!box) continue;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const vp = page.viewport();
      if (cy < 0 || cy > vp.height || cx < 0 || cx > vp.width) {
        throw new Error(`clickByText: "${txt.slice(0, 40)}" still off-viewport at (${Math.round(cx)},${Math.round(cy)})`);
      }
      await page.mouse.click(cx, cy);
      return txt;
    }
  }
  throw new Error(`clickByText: no visible ${selector} matching ${re}`);
}

// Dispatches the click from inside the page, bypassing hit-testing. Needed for
// the admin action bar, which the live-activity toast (z-999) overlaps.
async function clickInPage(page, selector, reSource, opts = {}) {
  const res = await page.evaluate((sel, src) => {
    const re = new RegExp(src);
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const t = (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
      return re.test(t);
    });
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !e.disabled;
    });
    if (!el) return null;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.click();
    return (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60);
  }, selector, reSource instanceof RegExp ? reSource.source : reSource);
  if (res === null) throw new Error(`clickInPage: no enabled ${selector} matching ${reSource}`);
  return res;
}

// Closes the floating live-activity toasts that overlay the admin header.
async function dismissToasts(page) {
  const n = await page.evaluate(() => {
    let closed = 0;
    document.querySelectorAll('div[class*="z-[999]"]').forEach((d) => {
      const btn = d.querySelector("button");
      if (btn) { btn.click(); closed++; } else { d.remove(); closed++; }
    });
    return closed;
  });
  await sleep(600);
  return n;
}

async function findByText(page, selector, re) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const txt =
      (await h.evaluate((el) =>
        (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()
      )) || "";
    if (re.test(txt)) return h;
  }
  return null;
}

// Dumps a compact description of every form control currently on screen.
async function dumpFields(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll("input,select,textarea").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      let label = "";
      // nearest preceding label-ish text
      let p = el.closest("div");
      for (let i = 0; i < 4 && p; i++) {
        const l = p.querySelector("label");
        if (l && l.innerText.trim()) { label = l.innerText.trim(); break; }
        p = p.parentElement;
      }
      out.push({
        tag: el.tagName,
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        ph: el.placeholder || "",
        label: label.slice(0, 60),
        value: (el.value || "").slice(0, 40),
        opts: el.tagName === "SELECT" ? [...el.options].map((o) => o.text.trim()).slice(0, 25) : undefined,
      });
    });
    return out;
  });
}

async function dumpButtons(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button,a[href]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => ({
        tag: el.tagName,
        text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60),
        href: el.getAttribute("href") || "",
        disabled: el.disabled || false,
      }))
      .filter((b) => b.text)
  );
}

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

module.exports = {
  BASE, SHOT_DIR, CREDS,
  connect, login, shot, sleep, clickByText, clickInPage, dismissToasts, findByText,
  dumpFields, dumpButtons, loadState, saveState, stamp,
};
