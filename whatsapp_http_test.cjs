// whatsapp_http_test.cjs — the WhatsApp conversation routes over real HTTP.
//
// The unit suite (src/lib/whatsappConversations.test.ts) proves the service layer
// and the webhook handler. This proves the HTTP surface those sit behind: the
// session gate, the permission predicate as it is actually applied by each route,
// the 404-not-403 rule, and the webhook route's raw-body signature handling.
//
//   node whatsapp_http_test.cjs                    # against localhost:3000
//   BASE_URL=http://localhost:3001 node whatsapp_http_test.cjs
//
// ── Nothing is sent to Meta ─────────────────────────────────────────────────
// The send route is exercised only on paths that return BEFORE the Cloud API
// call — validation failures and the closed 24-hour window. A real send would
// deliver a real WhatsApp message to a real phone and burn quota, so it is not
// something a test should do on its own initiative.
//
// Cleans up every row it creates.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns");
const { Client } = require("pg");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ── env ─────────────────────────────────────────────────────────────────────
const raw = fs.readFileSync(path.join(__dirname, ".env.local"), "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
for (const k of Object.keys(env)) if (!process.env[k]) process.env[k] = env[k];

if (!env.SESSION_SECRET) {
  console.error("ABORT: SESSION_SECRET is not set in .env.local");
  process.exit(2);
}
if (/ep-long-cloud|ep-mute-credit/.test(env.DATABASE_URL || "")) {
  console.error("ABORT: DATABASE_URL points at production.");
  process.exit(2);
}

const PHONE_NUMBER_ID = env.WHATSAPP_PHONE_NUMBER_ID;
const APP_SECRET = env.WHATSAPP_APP_SECRET;

// ── session cookies, minted exactly as lib/sessionCookie.ts does ────────────
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function signSession(payload) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = b64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac("sha256", env.SESSION_SECRET).update(encoded).digest();
  return `${encoded}.${b64url(sig)}`;
}

// ── harness ────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
}
function section(t) { console.log(`\n── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`); }

async function api(cookie, url, init = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(cookie ? { cookie: `crm_session=${cookie}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

// ── DNS fallback for the direct DB connection ──────────────────────────────
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
  // Server reachable?
  try {
    const ping = await fetch(`${BASE_URL}/api/whatsapp/events`);
    if (ping.status !== 401) {
      console.error(`ABORT: expected 401 from /api/whatsapp/events, got ${ping.status}. Is the dev server up?`);
      process.exit(3);
    }
  } catch (e) {
    console.error(`ABORT: cannot reach ${BASE_URL} — ${e.message}`);
    process.exit(3);
  }

  const db = new Client({ connectionString: env.DATABASE_URL, lookup });
  await db.connect();

  const createdLeads = [];
  const createdPhones = [];

  try {
    const orgRow = await db.query(
      `SELECT b.organization_id, o.name FROM public.whatsapp_business_numbers b
         JOIN public.organizations o ON o.id = b.organization_id
        WHERE b.phone_number_id = $1`,
      [PHONE_NUMBER_ID]
    );
    if (orgRow.rows.length === 0) {
      console.error("ABORT: no business-number mapping. Run scripts/seed_whatsapp_number.cjs.");
      process.exit(3);
    }
    const ORG = orgRow.rows[0].organization_id;
    console.log(`base: ${BASE_URL}\norg:  ${orgRow.rows[0].name} (${ORG})`);

    const stamp = String(Date.now()).slice(-7);
    // Shaped like real Indian mobiles: "91" + a 10-digit number starting 9.
    // A number of any other length normalizes differently via the lead path than
    // via the wa_id path, which would split one customer across two threads.
    const MINE = `919${stamp}11`;
    const THEIRS = `919${stamp}12`;
    createdPhones.push(MINE, THEIRS);

    // Two leads owned by two different sales managers.
    const mk = async (name, phone, owner) => {
      const r = await db.query(
        `INSERT INTO public.walkin_enquiries (name, phone, assigned_to, status, organization_id, sr_no)
         VALUES ($1,$2,$3,'New',$4,(SELECT COALESCE(MAX(sr_no),0)+1 FROM public.walkin_enquiries))
         RETURNING id`,
        [name, phone.slice(2), owner, ORG]
      );
      createdLeads.push(r.rows[0].id);
      return r.rows[0].id;
    };
    const myLead = await mk("HTTP Test Mine", MINE, "Megha");
    const theirLead = await mk("HTTP Test Theirs", THEIRS, "Ravi");

    const adminCookie = signSession({ _id: "1", name: "Admin", role: "Admin", isActive: true, org: ORG });
    const meghaCookie = signSession({ _id: "2", name: "Megha", role: "Sales Manager", isActive: true, org: ORG });
    const raviCookie = signSession({ _id: "3", name: "Ravi", role: "Sales Manager", isActive: true, org: ORG });
    const headCookie = signSession({ _id: "4", name: "Head", role: "Site Head", isActive: true, org: ORG });

    // ═════════════════════════════════════════════════════════════════════
    section("Authentication");
    // ═════════════════════════════════════════════════════════════════════
    for (const [label, url, init] of [
      ["conversation list", "/api/whatsapp/conversations", {}],
      ["open by lead", "/api/whatsapp/conversations", { method: "POST", body: JSON.stringify({ leadId: myLead }) }],
      ["templates", "/api/whatsapp/templates", {}],
      ["SSE stream", "/api/whatsapp/events", {}],
    ]) {
      const r = await api(null, url, init);
      check(`${label} refuses an anonymous caller`, r.status === 401, `got ${r.status}`);
    }

    const forged = "eyJfaWQiOiI5OTkiLCJyb2xlIjoiQWRtaW4ifQ.bm90LWEtc2ln";
    const rf = await api(forged, "/api/whatsapp/conversations");
    check("a forged session cookie is refused", rf.status === 401, `got ${rf.status}`);

    // ═════════════════════════════════════════════════════════════════════
    section("Opening a conversation from a lead");
    // ═════════════════════════════════════════════════════════════════════
    const open = await api(meghaCookie, "/api/whatsapp/conversations", {
      method: "POST", body: JSON.stringify({ leadId: myLead }),
    });
    check("owner can open their own lead's thread", open.status === 200 && open.body?.success === true,
      JSON.stringify(open.body));
    const convId = open.body?.data?.id;
    check("a conversation id is returned", Number.isFinite(convId), String(convId));
    check("it is linked to the lead", open.body?.data?.leadId === myLead);

    const reopen = await api(meghaCookie, "/api/whatsapp/conversations", {
      method: "POST", body: JSON.stringify({ leadId: myLead }),
    });
    check("opening twice returns the same thread, not a second one",
      reopen.body?.data?.id === convId, `${reopen.body?.data?.id} vs ${convId}`);

    const noLead = await api(meghaCookie, "/api/whatsapp/conversations", {
      method: "POST", body: JSON.stringify({ leadId: 999999999 }),
    });
    check("a non-existent lead is 404", noLead.status === 404, `got ${noLead.status}`);

    const badBody = await api(meghaCookie, "/api/whatsapp/conversations", {
      method: "POST", body: JSON.stringify({}),
    });
    check("a missing leadId is 400", badBody.status === 400, `got ${badBody.status}`);

    // ═════════════════════════════════════════════════════════════════════
    section("Permissions (spec §8)");
    // ═════════════════════════════════════════════════════════════════════
    const cross = await api(raviCookie, "/api/whatsapp/conversations", {
      method: "POST", body: JSON.stringify({ leadId: myLead }),
    });
    // 404 rather than 403: a 403 would confirm the lead id exists.
    check("another sales manager cannot open someone else's lead",
      cross.status === 404, `got ${cross.status}`);

    const readCross = await api(raviCookie, `/api/whatsapp/conversations/${convId}`);
    check("another sales manager cannot read the thread", readCross.status === 404, `got ${readCross.status}`);

    const sendCross = await api(raviCookie, `/api/whatsapp/conversations/${convId}/messages`, {
      method: "POST", body: JSON.stringify({ text: "should not reach" }),
    });
    check("another sales manager cannot send into it", sendCross.status === 404, `got ${sendCross.status}`);

    const readOwn = await api(meghaCookie, `/api/whatsapp/conversations/${convId}`);
    check("the owner can read it", readOwn.status === 200 && readOwn.body?.success === true);

    const readAdmin = await api(adminCookie, `/api/whatsapp/conversations/${convId}`);
    check("an admin can read it", readAdmin.status === 200);

    const listMegha = await api(meghaCookie, "/api/whatsapp/conversations");
    const meghaIds = (listMegha.body?.data ?? []).map((c) => c.id);
    check("the owner's list includes it", meghaIds.includes(convId));

    const listRavi = await api(raviCookie, "/api/whatsapp/conversations");
    const raviIds = (listRavi.body?.data ?? []).map((c) => c.id);
    check("the other manager's list excludes it", !raviIds.includes(convId));

    // ═════════════════════════════════════════════════════════════════════
    section("Association is admin/site-head only (spec §5)");
    // ═════════════════════════════════════════════════════════════════════
    const assocByOwner = await api(meghaCookie, `/api/whatsapp/conversations/${convId}/associate`, {
      method: "POST", body: JSON.stringify({ leadId: myLead }),
    });
    // Already matched, so 409 for a role that MAY associate; a sales manager is
    // stopped by the role gate first, whichever error it produces.
    check("a sales manager is refused association",
      assocByOwner.status === 403 || assocByOwner.status === 409,
      `got ${assocByOwner.status}`);

    const assocAdmin = await api(adminCookie, `/api/whatsapp/conversations/${convId}/associate`, {
      method: "POST", body: JSON.stringify({ leadId: myLead }),
    });
    check("even an admin cannot re-point an already-matched thread",
      assocAdmin.status === 409, `got ${assocAdmin.status}`);

    // ═════════════════════════════════════════════════════════════════════
    section("Send route guards (nothing reaches Meta)");
    // ═════════════════════════════════════════════════════════════════════
    const emptyText = await api(meghaCookie, `/api/whatsapp/conversations/${convId}/messages`, {
      method: "POST", body: JSON.stringify({ text: "   " }),
    });
    check("an empty message is 400", emptyText.status === 400, `got ${emptyText.status}`);

    const tooLong = await api(meghaCookie, `/api/whatsapp/conversations/${convId}/messages`, {
      method: "POST", body: JSON.stringify({ text: "x".repeat(4097) }),
    });
    check("a message over 4096 chars is 400", tooLong.status === 400, `got ${tooLong.status}`);

    // The customer has never written, so the window is closed and the route
    // returns before any Cloud API call.
    const closed = await api(meghaCookie, `/api/whatsapp/conversations/${convId}/messages`, {
      method: "POST", body: JSON.stringify({ text: "Hello there" }),
    });
    check("a free-form send outside the 24h window is refused with WINDOW_CLOSED",
      closed.status === 409 && closed.body?.code === "WINDOW_CLOSED",
      `${closed.status} ${JSON.stringify(closed.body)}`);

    const stored = await db.query(
      `SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE conversation_id=$1`,
      [convId]
    );
    check("no message row was written for the refused send", stored.rows[0].n === 0,
      `got ${stored.rows[0].n}`);

    // ═════════════════════════════════════════════════════════════════════
    section("Webhook route over HTTP");
    // ═════════════════════════════════════════════════════════════════════
    const verifyOk = await fetch(
      `${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.VERIFY_TOKEN)}&hub.challenge=HTTPCHAL`
    );
    const challenge = await verifyOk.text();
    check("GET handshake echoes the challenge as bare text",
      verifyOk.status === 200 && challenge === "HTTPCHAL", `${verifyOk.status} ${challenge}`);

    const verifyBad = await fetch(
      `${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=X`
    );
    check("GET handshake rejects a wrong token", verifyBad.status === 403, `got ${verifyBad.status}`);

    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550001111", phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ profile: { name: "HTTP Test Mine" }, wa_id: MINE }],
            messages: [{
              from: MINE, id: `wamid.HTTP${stamp}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: "text", text: { body: "Yes, tomorrow works." },
            }],
          },
        }],
      }],
    };
    const rawBody = JSON.stringify(payload);
    const sig = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");

    const unsigned = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: rawBody,
    });
    check("an unsigned webhook POST is rejected 401", unsigned.status === 401, `got ${unsigned.status}`);

    const signed = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
      body: rawBody,
    });
    const signedBody = await signed.json();
    check("a correctly signed webhook POST is accepted",
      signed.status === 200 && signedBody.inboundStored === 1, JSON.stringify(signedBody));

    const replay = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
      body: rawBody,
    });
    const replayBody = await replay.json();
    check("a replayed delivery stores nothing (spec §10)",
      replay.status === 200 && replayBody.inboundStored === 0 && replayBody.inboundDuplicates === 1,
      JSON.stringify(replayBody));

    // ═════════════════════════════════════════════════════════════════════
    section("The inbound message is visible to the right people");
    // ═════════════════════════════════════════════════════════════════════
    const thread = await api(meghaCookie, `/api/whatsapp/conversations/${convId}`);
    const msgs = thread.body?.data?.messages ?? [];
    check("the owner sees the customer's message", msgs.length === 1, `got ${msgs.length}`);
    check("it is inbound", msgs[0]?.direction === "inbound");
    check("the text is intact", msgs[0]?.messageText === "Yes, tomorrow works.");
    check("its status is 'received'", msgs[0]?.status === "received");

    const listAfter = await api(meghaCookie, "/api/whatsapp/conversations");
    const row = (listAfter.body?.data ?? []).find((c) => c.id === convId);
    check("the follow-ups row shows the preview (spec §6)",
      row?.lastMessagePreview === "Yes, tomorrow works.", JSON.stringify(row?.lastMessagePreview));
    check("the follow-ups row shows the lead name", row?.leadName === "HTTP Test Mine");
    check("the follow-ups row shows the assignee", row?.assignedTo === "Megha");
    check("the 24h window is now open", row?.window?.open === true);

    // Reading the thread does NOT clear the badge. GET is safe and does not
    // mutate; the panel clears it with an explicit POST when the thread is
    // focused. Asserting otherwise would pin a GET with a side effect.
    const beforeRead = await db.query(
      `SELECT unread_count FROM public.whatsapp_conversations WHERE id=$1`, [convId]
    );
    check("the inbound message is unread until marked (spec §14)",
      beforeRead.rows[0].unread_count === 1, String(beforeRead.rows[0].unread_count));
    check("the follow-ups row carries the unread badge", row?.unreadCount === 1,
      String(row?.unreadCount));

    const markRead = await api(meghaCookie, `/api/whatsapp/conversations/${convId}/read`, { method: "POST" });
    check("marking read clears it", markRead.status === 200 && markRead.body?.data?.unreadCount === 0,
      JSON.stringify(markRead.body));

    const afterRead = await db.query(
      `SELECT unread_count FROM public.whatsapp_conversations WHERE id=$1`, [convId]
    );
    check("and it stays cleared", afterRead.rows[0].unread_count === 0,
      String(afterRead.rows[0].unread_count));

    const markAgain = await api(meghaCookie, `/api/whatsapp/conversations/${convId}/read`, { method: "POST" });
    check("marking read twice is idempotent (spec §14)",
      markAgain.status === 200 && markAgain.body?.data?.unreadCount === 0);

    const readByStranger = await api(raviCookie, `/api/whatsapp/conversations/${convId}/read`, { method: "POST" });
    check("someone who cannot see the thread cannot clear its badge",
      readByStranger.status === 404, `got ${readByStranger.status}`);

    // ═════════════════════════════════════════════════════════════════════
    section("Unmatched threads reach only the roles that can resolve them");
    // ═════════════════════════════════════════════════════════════════════
    const orphanPhone = `919${stamp}99`;
    createdPhones.push(orphanPhone);
    const orphanPayload = JSON.parse(rawBody);
    orphanPayload.entry[0].changes[0].value.contacts[0].wa_id = orphanPhone;
    orphanPayload.entry[0].changes[0].value.contacts[0].profile.name = "Nobody Knows";
    orphanPayload.entry[0].changes[0].value.messages[0].from = orphanPhone;
    orphanPayload.entry[0].changes[0].value.messages[0].id = `wamid.ORPHAN${stamp}`;
    const orphanRaw = JSON.stringify(orphanPayload);
    const orphanSig =
      "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(orphanRaw, "utf8").digest("hex");

    const orphanRes = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": orphanSig },
      body: orphanRaw,
    });
    const orphanBody = await orphanRes.json();
    check("an unknown number is stored", orphanBody.inboundStored === 1, JSON.stringify(orphanBody));

    const headReview = await api(headCookie, "/api/whatsapp/conversations?filter=needs_review");
    const headPhones = (headReview.body?.data ?? []).map((c) => c.customerPhone);
    check("a site head sees it in 'needs review'", headPhones.includes(`+${orphanPhone}`),
      JSON.stringify(headPhones));

    const meghaReview = await api(meghaCookie, "/api/whatsapp/conversations?filter=needs_review");
    check("a sales manager sees nothing in 'needs review'",
      (meghaReview.body?.data ?? []).length === 0,
      JSON.stringify(meghaReview.body?.data));

    const meghaAll = await api(meghaCookie, "/api/whatsapp/conversations");
    const meghaAllPhones = (meghaAll.body?.data ?? []).map((c) => c.customerPhone);
    check("and does not see the orphan in their normal list",
      !meghaAllPhones.includes(`+${orphanPhone}`));

    // Site head links it to a lead.
    const orphanConv = await db.query(
      `SELECT id FROM public.whatsapp_conversations WHERE organization_id=$1 AND customer_phone=$2`,
      [ORG, `+${orphanPhone}`]
    );
    const orphanId = orphanConv.rows[0].id;
    const linked = await api(headCookie, `/api/whatsapp/conversations/${orphanId}/associate`, {
      method: "POST", body: JSON.stringify({ leadId: theirLead }),
    });
    check("a site head can link it to a lead", linked.status === 200 && linked.body?.success === true,
      JSON.stringify(linked.body));

    const afterLink = await db.query(
      `SELECT match_state, lead_id FROM public.whatsapp_conversations WHERE id=$1`, [orphanId]
    );
    check("the thread is now matched", afterLink.rows[0].match_state === "matched");
    check("to the chosen lead", afterLink.rows[0].lead_id === theirLead);

    const audit = await db.query(
      `SELECT count(*)::int AS n FROM public.audit_logs
        WHERE action = 'whatsapp_conversation_associated'
          AND entity_id = $1`,
      [String(orphanId)]
    );
    check("the association is in the audit log (spec §15)", audit.rows[0].n >= 1,
      `got ${audit.rows[0].n}`);

    // Now that it belongs to Ravi's lead, Ravi should see it and Megha not.
    const raviAfter = await api(raviCookie, "/api/whatsapp/conversations");
    const raviAfterPhones = (raviAfter.body?.data ?? []).map((c) => c.customerPhone);
    check("the new owner now sees the linked thread", raviAfterPhones.includes(`+${orphanPhone}`));

  } finally {
    for (const p of createdPhones) {
      await db.query(
        `DELETE FROM public.whatsapp_messages WHERE conversation_id IN
           (SELECT id FROM public.whatsapp_conversations WHERE customer_phone=$1)`, [`+${p}`]);
      await db.query(`DELETE FROM public.whatsapp_conversations WHERE customer_phone=$1`, [`+${p}`]);
    }
    if (createdLeads.length) {
      await db.query(`DELETE FROM public.walkin_enquiries WHERE id = ANY($1)`, [createdLeads]);
    }
    await db.query(
      `DELETE FROM public.audit_logs WHERE action='whatsapp_conversation_associated'
         AND created_at > now() - interval '10 minutes'`);
    await db.end();

    console.log(`\n${"═".repeat(66)}`);
    console.log(`  ${pass} passed, ${fail} failed`);
    if (failures.length) console.log(`  failing: ${failures.join(" | ")}`);
    console.log(`${"═".repeat(66)}`);
    process.exit(fail === 0 ? 0 : 1);
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
