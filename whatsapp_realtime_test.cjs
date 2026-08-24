// whatsapp_realtime_test.cjs — proves the "no refresh" claim (spec §4, §7).
//
// Opens a real SSE connection to /api/whatsapp/events as a signed-in employee,
// fires a signed webhook as if Meta had delivered a customer's reply, and asserts
// the event arrives on the already-open stream.
//
// It also opens a SECOND stream as a colleague who is not entitled to that lead
// and asserts they receive NOTHING — the property that distinguishes this from an
// organization-wide broadcast filtered in the browser. That is the part worth
// testing: a leak here is invisible in the UI, because the receiving dashboard
// simply chooses not to render what it was sent.
//
//   node whatsapp_realtime_test.cjs

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns");
const { Client } = require("pg");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const raw = fs.readFileSync(path.join(__dirname, ".env.local"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
if (/ep-long-cloud|ep-mute-credit/.test(env.DATABASE_URL || "")) {
  console.error("ABORT: DATABASE_URL points at production.");
  process.exit(2);
}

const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signSession(payload) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = b64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac("sha256", env.SESSION_SECRET).update(encoded).digest();
  return `${encoded}.${b64url(sig)}`;
}

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}

/**
 * Minimal SSE reader. Collects `data:` payloads until the caller stops it.
 * Node's fetch gives a web ReadableStream, which is enough — no EventSource
 * polyfill needed for a one-way text protocol.
 */
function openStream(cookie, label) {
  const controller = new AbortController();
  const events = [];
  const started = fetch(`${BASE_URL}/api/whatsapp/events`, {
    headers: { cookie: `crm_session=${cookie}`, accept: "text/event-stream" },
    signal: controller.signal,
  }).then(async (res) => {
    if (res.status !== 200) throw new Error(`${label}: stream returned ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) {
              try { events.push(JSON.parse(line.slice(6))); } catch { /* heartbeat */ }
            }
          }
        }
      }
    } catch { /* aborted */ }
  }).catch((e) => { if (e.name !== "AbortError") throw e; });

  return { events, stop: () => controller.abort(), started };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const resolver = new dns.Resolver();
resolver.setServers(["8.8.8.8", "1.1.1.1"]);
function lookup(h, o, cb) {
  if (typeof o === "function") { cb = o; o = {}; }
  dns.lookup(h, o, (e, a, f) =>
    e ? resolver.resolve4(h, (e2, ad) =>
      e2 || !ad || !ad.length ? cb(e)
        : o && o.all ? cb(null, ad.map((x) => ({ address: x, family: 4 })))
          : cb(null, ad[0], 4))
      : cb(null, a, f));
}

(async () => {
  const db = new Client({ connectionString: env.DATABASE_URL, lookup });
  await db.connect();

  const createdLeads = [];
  const createdPhones = [];
  let mine, theirs;

  try {
    const orgRow = await db.query(
      `SELECT organization_id FROM public.whatsapp_business_numbers WHERE phone_number_id=$1`,
      [env.WHATSAPP_PHONE_NUMBER_ID]
    );
    const ORG = orgRow.rows[0].organization_id;

    const stamp = String(Date.now()).slice(-7);
    const PHONE = `919${stamp}55`;
    createdPhones.push(PHONE);

    const lead = await db.query(
      `INSERT INTO public.walkin_enquiries (name, phone, assigned_to, status, organization_id, sr_no)
       VALUES ('Realtime Test', $1, 'Megha', 'New', $2,
               (SELECT COALESCE(MAX(sr_no),0)+1 FROM public.walkin_enquiries))
       RETURNING id`,
      [PHONE.slice(2), ORG]
    );
    createdLeads.push(lead.rows[0].id);

    const meghaCookie = signSession({ _id: "2", name: "Megha", role: "Sales Manager", isActive: true, org: ORG });
    const raviCookie = signSession({ _id: "3", name: "Ravi", role: "Sales Manager", isActive: true, org: ORG });

    console.log(`\n── Opening two SSE streams ${"─".repeat(38)}`);
    mine = openStream(meghaCookie, "megha");
    theirs = openStream(raviCookie, "ravi");
    await wait(1500);

    check("the owner's stream connected", mine.events.some((e) => e.type === "connected"),
      JSON.stringify(mine.events));
    check("the colleague's stream connected", theirs.events.some((e) => e.type === "connected"));

    const beforeMine = mine.events.length;
    const beforeTheirs = theirs.events.length;

    console.log(`\n── Meta delivers a customer reply ${"─".repeat(31)}`);
    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550001111", phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID },
            contacts: [{ profile: { name: "Realtime Test" }, wa_id: PHONE }],
            messages: [{
              from: PHONE, id: `wamid.RT${stamp}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: "text", text: { body: "Yes, tomorrow works." },
            }],
          },
        }],
      }],
    };
    const body = JSON.stringify(payload);
    const sig = "sha256=" + crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(body, "utf8").digest("hex");

    const res = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
      body,
    });
    const webhookBody = await res.json();
    check("the webhook stored the message", webhookBody.inboundStored === 1, JSON.stringify(webhookBody));

    // Give the push a moment to traverse the open connections.
    await wait(2000);

    const newMine = mine.events.slice(beforeMine);
    const newTheirs = theirs.events.slice(beforeTheirs);

    console.log(`\n── What arrived without a refresh ${"─".repeat(31)}`);
    const msgEvent = newMine.find((e) => e.type === "message_created");
    check("the owner received a message_created push", Boolean(msgEvent),
      JSON.stringify(newMine.map((e) => e.type)));
    check("it carries the message text",
      msgEvent?.message?.message_text === "Yes, tomorrow works.",
      JSON.stringify(msgEvent?.message?.message_text));
    check("it carries the unread count", msgEvent?.unreadCount === 1, String(msgEvent?.unreadCount));
    check("it names the lead", msgEvent?.leadId === lead.rows[0].id);

    const convEvent = newMine.find((e) => e.type === "conversation_updated");
    check("the owner also received a conversation_updated push for the list",
      Boolean(convEvent), JSON.stringify(newMine.map((e) => e.type)));
    check("with the preview for the follow-ups row",
      convEvent?.lastMessagePreview === "Yes, tomorrow works.");

    console.log(`\n── And what did NOT reach the colleague ${"─".repeat(25)}`);
    const leaked = newTheirs.filter((e) => e.type !== "connected");
    check("the unentitled colleague received nothing at all", leaked.length === 0,
      JSON.stringify(leaked));

  } finally {
    mine?.stop();
    theirs?.stop();
    await wait(300);

    for (const p of createdPhones) {
      await db.query(
        `DELETE FROM public.whatsapp_messages WHERE conversation_id IN
           (SELECT id FROM public.whatsapp_conversations WHERE customer_phone=$1)`, [`+${p}`]);
      await db.query(`DELETE FROM public.whatsapp_conversations WHERE customer_phone=$1`, [`+${p}`]);
    }
    if (createdLeads.length) {
      await db.query(`DELETE FROM public.walkin_enquiries WHERE id = ANY($1)`, [createdLeads]);
    }
    await db.end();

    console.log(`\n${"═".repeat(66)}`);
    console.log(`  ${pass} passed, ${fail} failed`);
    if (failures.length) console.log(`  failing: ${failures.join(" | ")}`);
    console.log(`${"═".repeat(66)}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
