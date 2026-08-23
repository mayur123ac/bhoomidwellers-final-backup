// notification_tenant_isolation_test.cjs
//
// The cross-tenant test for the notification queue and the lead it points at.
//
//   node notification_tenant_isolation_test.cjs            # against localhost:3000
//   BASE_URL=https://... node notification_tenant_isolation_test.cjs
//
// ── How it authenticates, and why ───────────────────────────────────────────
// It mints `crm_session` cookies directly with SESSION_SECRET, exactly as
// lib/sessionCookie.ts does, instead of posting real passwords to /api/auth/login.
// Two reasons: a security test should not need production credentials on disk,
// and this proves the property that actually matters — that a VALID, correctly
// signed session for organization A cannot reach organization B's data. A
// forged-credential test would only prove the login form works.
//
// ── What it does NOT do ─────────────────────────────────────────────────────
// It creates no leads. "Create a Bhoomi lead → the notification appears only in
// Bhoomi" is asserted against leads that already exist and are inside the
// notification window, rather than by writing test rows into a live database
// (inserting a lead also triggers a full sr_no recalculation, which is not
// something to do to production for a test). Set ALLOW_WRITES=1 to run the
// creation half as well, against a database you are willing to write to.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ALLOW_WRITES = process.env.ALLOW_WRITES === "1";
const ENV_PATH = path.join(__dirname, ".env.local");

// ── env ─────────────────────────────────────────────────────────────────────
function readEnv() {
  const out = {};
  for (const raw of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnv();
if (!env.SESSION_SECRET) {
  console.error("ABORT: SESSION_SECRET is not set in .env.local");
  process.exit(2);
}

// ── cookie minting, byte-for-byte as lib/sessionCookie.ts does it ───────────
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function signSession(payload) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = b64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac("sha256", env.SESSION_SECRET).update(encoded).digest();
  return `${encoded}.${b64url(sig)}`;
}

// ── tiny test harness ───────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`);
  }
}

async function api(cookie, url, init = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      cookie: `crm_session=${cookie}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

(async () => {
  const dbUrl = new URL(env.DATABASE_URL);
  const db = new Client({
    host: dbUrl.hostname,
    database: dbUrl.pathname.replace(/^\//, "").split("?")[0],
    user: dbUrl.username,
    password: dbUrl.password,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  // ── Pick two real tenants and one admin from each ─────────────────────────
  const { rows: orgs } = await db.query(
    `SELECT o.id, o.name,
            (SELECT json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', u.role)
               FROM users u
              WHERE u.organization_id = o.id AND u.is_active = true
                AND LOWER(REPLACE(u.role, '_', ' ')) = 'admin'
              ORDER BY u.id LIMIT 1) AS admin
       FROM organizations o
      ORDER BY o.created_at`
  );
  let tenants = orgs.filter((o) => o.admin);
  if (tenants.length < 2) {
    console.error("ABORT: need at least two organizations that each have an active Admin.");
    process.exit(2);
  }

  // Which two tenants to pit against each other. Defaults to the two oldest, but
  // TENANT_A / TENANT_B name the pair you actually care about:
  //   TENANT_A=bhoomi TENANT_B=viraj node notification_tenant_isolation_test.cjs
  const pick = (needle) => {
    const n = String(needle).trim().toLowerCase();
    return tenants.find((o) => o.name.toLowerCase().includes(n) || o.id === needle);
  };
  if (process.env.TENANT_A || process.env.TENANT_B) {
    const a = process.env.TENANT_A ? pick(process.env.TENANT_A) : tenants[0];
    const b = process.env.TENANT_B ? pick(process.env.TENANT_B) : tenants[1];
    if (!a || !b || a.id === b.id) {
      console.error(
        `ABORT: could not resolve two distinct tenants from TENANT_A/TENANT_B. ` +
          `Available: ${tenants.map((o) => o.name).join(", ")}`
      );
      process.exit(2);
    }
    tenants = [a, b];
  }
  const [A, B] = tenants;

  console.log(`\nBase URL: ${BASE_URL}`);
  console.log(`Tenant A: ${A.name}  (admin: ${A.admin.name})`);
  console.log(`Tenant B: ${B.name}  (admin: ${B.admin.name})\n`);

  const cookieA = signSession({
    _id: String(A.admin.id), name: A.admin.name, email: A.admin.email,
    role: A.admin.role, isActive: true, org: A.id,
  });
  const cookieB = signSession({
    _id: String(B.admin.id), name: B.admin.name, email: B.admin.email,
    role: B.admin.role, isActive: true, org: B.id,
  });

  // ═════════════════════════════════════════════════════════════════════════
  console.log("── 1. Notification feed is scoped to the signed-in organization ──");
  // ═════════════════════════════════════════════════════════════════════════
  const feedA = await api(cookieA, "/api/notifications/feed");
  const feedB = await api(cookieB, "/api/notifications/feed");

  check("A: feed returns 200", feedA.status === 200, `status ${feedA.status}`);
  check("B: feed returns 200", feedB.status === 200, `status ${feedB.status}`);
  check("A: feed reports A's organization", feedA.body?.organizationId === A.id, feedA.body?.organizationId);
  check("B: feed reports B's organization", feedB.body?.organizationId === B.id, feedB.body?.organizationId);

  const allA = feedA.body?.data?.all ?? [];
  const allB = feedB.body?.data?.all ?? [];

  check(
    "A: every notification carries A's organization_id",
    allA.length === 0 || allA.every((n) => n.organizationId === A.id),
    `${allA.filter((n) => n.organizationId !== A.id).length} foreign of ${allA.length}`
  );
  check(
    "B: every notification carries B's organization_id",
    allB.length === 0 || allB.every((n) => n.organizationId === B.id),
    `${allB.filter((n) => n.organizationId !== B.id).length} foreign of ${allB.length}`
  );

  // The decisive assertion: the two feeds must not share a single lead.
  const leadsA = new Set(allA.map((n) => n.leadId));
  const leadsB = new Set(allB.map((n) => n.leadId));
  const shared = [...leadsA].filter((id) => leadsB.has(id));
  check("A and B feeds share no lead", shared.length === 0, `shared lead ids: ${shared.join(", ")}`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 2. Every notified lead really belongs to the viewing tenant ──");
  // ═════════════════════════════════════════════════════════════════════════
  for (const [label, feed, org] of [["A", allA, A], ["B", allB, B]]) {
    if (feed.length === 0) { check(`${label}: (no notifications to verify)`, true); continue; }
    const ids = [...new Set(feed.map((n) => n.leadId))];
    const { rows } = await db.query(
      `SELECT id, organization_id FROM walkin_enquiries WHERE id = ANY($1::int[])`,
      [ids]
    );
    const wrong = rows.filter((r) => r.organization_id !== org.id);
    check(
      `${label}: all ${ids.length} notified leads are in ${org.name}`,
      wrong.length === 0,
      wrong.map((r) => `lead ${r.id} -> ${r.organization_id}`).join(", ")
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 3. A lead in the notification window appears in ITS tenant only ──");
  // ═════════════════════════════════════════════════════════════════════════
  // Stands in for "create a lead in A, check it does not surface in B": any lead
  // already inside the New Lead window proves the same property without writing.
  for (const [label, org, ownFeed, otherFeed, otherLabel] of [
    ["A", A, allA, allB, "B"],
    ["B", B, allB, allA, "A"],
  ]) {
    const { rows } = await db.query(
      `SELECT id, name FROM walkin_enquiries
        WHERE organization_id = $1 AND created_at >= now() - interval '36 hours'
        ORDER BY id DESC LIMIT 1`,
      [org.id]
    );
    if (rows.length === 0) {
      console.log(`  SKIP  ${label}: ${org.name} has no lead inside the New Lead window`);
      continue;
    }
    const lead = rows[0];
    check(
      `${label}: recent lead #${lead.id} is in ${org.name}'s own feed`,
      ownFeed.some((n) => n.leadId === lead.id),
      `feed lead ids: ${[...new Set(ownFeed.map((n) => n.leadId))].join(", ")}`
    );
    check(
      `${label}: recent lead #${lead.id} is ABSENT from ${otherLabel}'s feed`,
      !otherFeed.some((n) => n.leadId === lead.id)
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 4. Opening another tenant's lead by id is refused ──");
  // ═════════════════════════════════════════════════════════════════════════
  const { rows: aLead } = await db.query(
    `SELECT id FROM walkin_enquiries WHERE organization_id = $1 ORDER BY id DESC LIMIT 1`, [A.id]
  );
  const { rows: bLead } = await db.query(
    `SELECT id FROM walkin_enquiries WHERE organization_id = $1 ORDER BY id DESC LIMIT 1`, [B.id]
  );

  if (aLead[0] && bLead[0]) {
    const crossed = await api(cookieB, "/api/notifications/feed", {
      method: "POST", body: JSON.stringify({ leadId: aLead[0].id }),
    });
    check(
      `B cannot resolve A's lead #${aLead[0].id} (expects 404)`,
      crossed.status === 404,
      `status ${crossed.status} body ${JSON.stringify(crossed.body)}`
    );
    check(
      "the refusal leaks no lead data",
      !crossed.body?.data,
      JSON.stringify(crossed.body)
    );

    const crossed2 = await api(cookieA, "/api/notifications/feed", {
      method: "POST", body: JSON.stringify({ leadId: bLead[0].id }),
    });
    check(
      `A cannot resolve B's lead #${bLead[0].id} (expects 404)`,
      crossed2.status === 404,
      `status ${crossed2.status}`
    );

    const own = await api(cookieB, "/api/notifications/feed", {
      method: "POST", body: JSON.stringify({ leadId: bLead[0].id }),
    });
    check(
      `B CAN resolve its own lead #${bLead[0].id} (expects 200)`,
      own.status === 200 && own.body?.data?.id === bLead[0].id,
      `status ${own.status}`
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 5. A supplied organization_id is ignored, not honoured ──");
  // ═════════════════════════════════════════════════════════════════════════
  // The classic mistake this guards against: trusting an organization id that
  // arrived in the request. B asks for A's lead while claiming to be A.
  if (aLead[0]) {
    const spoofBody = await api(cookieB, "/api/notifications/feed", {
      method: "POST",
      body: JSON.stringify({ leadId: aLead[0].id, organization_id: A.id, organizationId: A.id }),
    });
    check(
      "a spoofed organization_id in the body changes nothing (expects 404)",
      spoofBody.status === 404,
      `status ${spoofBody.status}`
    );

    const spoofQuery = await fetch(
      `${BASE_URL}/api/notifications/feed?organization_id=${A.id}&organizationId=${A.id}`,
      { headers: { cookie: `crm_session=${cookieB}` } }
    );
    const spoofFeed = await spoofQuery.json();
    check(
      "a spoofed organization_id in the query string changes nothing",
      spoofFeed?.organizationId === B.id,
      `got ${spoofFeed?.organizationId}`
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 6. The underlying lead and follow-up feeds are scoped too ──");
  // ═════════════════════════════════════════════════════════════════════════
  const leadsFeedB = await api(cookieB, "/api/walkin_enquiries?limit=10000&offset=0");
  const rowsB = leadsFeedB.body?.data ?? [];
  check(
    "B: /api/walkin_enquiries returns only B's leads",
    rowsB.every((l) => l.organization_id === B.id),
    `${rowsB.filter((l) => l.organization_id !== B.id).length} foreign of ${rowsB.length}`
  );

  const fupsB = await api(cookieB, "/api/followups");
  check("B: /api/followups returns 200", fupsB.status === 200, `status ${fupsB.status}`);
  if (Array.isArray(fupsB.body?.data) && fupsB.body.data.length > 0) {
    const fupLeadIds = [...new Set(fupsB.body.data.map((f) => Number(f.leadId)))];
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM walkin_enquiries
        WHERE id = ANY($1::int[]) AND organization_id <> $2`,
      [fupLeadIds, B.id]
    );
    check("B: every follow-up belongs to a B lead", rows[0].n === 0, `${rows[0].n} foreign`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 7. An unauthenticated caller gets nothing ──");
  // ═════════════════════════════════════════════════════════════════════════
  const anon = await fetch(`${BASE_URL}/api/notifications/feed`);
  check("anonymous GET is 401", anon.status === 401, `status ${anon.status}`);
  const forged = await api("not.a.real.signature", "/api/notifications/feed");
  check("forged cookie is 401", forged.status === 401, `status ${forged.status}`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n── 8. Site Head can mark a lead lost, and only in their tenant ──");
  // ═════════════════════════════════════════════════════════════════════════
  const { rows: siteHeads } = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.organization_id
       FROM users u
      WHERE u.is_active = true
        AND LOWER(REPLACE(u.role, '_', ' ')) = 'site head'
        AND u.organization_id = ANY($1::uuid[])
      ORDER BY u.organization_id`,
    [[A.id, B.id]]
  );

  if (siteHeads.length === 0) {
    console.log("  SKIP  no active Site Head in either tenant");
  } else {
    const sh = siteHeads[0];
    const shOrg = sh.organization_id;
    const otherOrg = shOrg === A.id ? B.id : A.id;
    const shCookie = signSession({
      _id: String(sh.id), name: sh.name, email: sh.email,
      role: sh.role, isActive: true, org: shOrg,
    });

    // Authorization only — the reason is deliberately too short, so the request
    // is refused at validation. A 400 proves the role got PAST the role gate;
    // a 403 would mean it never did. Nothing is written either way.
    const own = await api(shCookie, "/api/leads/lost", {
      method: "PATCH",
      body: JSON.stringify({
        leadId: shOrg === A.id ? aLead[0]?.id : bLead[0]?.id,
        is_lost_lead: true, lost_reason: "short", lost_marked_by: sh.name,
      }),
    });
    check(
      `Site Head (${sh.name}) is past the role gate on /api/leads/lost (expects 400, not 403)`,
      own.status !== 403,
      `status ${own.status} body ${JSON.stringify(own.body)}`
    );

    const { rows: foreign } = await db.query(
      `SELECT id FROM walkin_enquiries WHERE organization_id = $1 ORDER BY id DESC LIMIT 1`,
      [otherOrg]
    );
    if (foreign[0]) {
      const cross = await api(shCookie, "/api/leads/lost", {
        method: "PATCH",
        body: JSON.stringify({
          leadId: foreign[0].id, is_lost_lead: true,
          lost_reason: "a sufficiently long reason for the validator",
          lost_marked_by: sh.name,
        }),
      });
      check(
        `Site Head cannot mark another tenant's lead #${foreign[0].id} lost (expects 404)`,
        cross.status === 404,
        `status ${cross.status} body ${JSON.stringify(cross.body)}`
      );
      const { rows: after } = await db.query(
        `SELECT COALESCE(is_lost_lead, false) AS lost FROM walkin_enquiries WHERE id = $1`,
        [foreign[0].id]
      );
      check(`the other tenant's lead #${foreign[0].id} was not modified`, after[0].lost === false);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  if (ALLOW_WRITES) {
    console.log("\n── 9. Create a lead in each tenant; it must surface in one feed only ──");
    console.log("  (ALLOW_WRITES=1 — this writes to the database at DATABASE_URL)");
    for (const [label, org, cookie, otherCookie, otherLabel] of [
      ["A", A, cookieA, cookieB, "B"],
      ["B", B, cookieB, cookieA, "A"],
    ]) {
      const created = await api(cookie, "/api/walkin_enquiries", {
        method: "POST",
        body: JSON.stringify({
          name: `Isolation Test ${label} ${Date.now()}`,
          phone: `9${String(Date.now()).slice(-9)}`,
          assignedTo: org.admin.name,
          source: "Direct Walk-in",
        }),
      });
      if (created.status !== 201) {
        check(`${label}: test lead created`, false, `status ${created.status} ${JSON.stringify(created.body)}`);
        continue;
      }
      const newId = created.body.data.id;
      check(`${label}: test lead #${newId} created in ${org.name}`, true);

      const ownFeed = await api(cookie, "/api/notifications/feed");
      const theirFeed = await api(otherCookie, "/api/notifications/feed");
      check(
        `${label}: #${newId} appears in ${org.name}'s feed`,
        (ownFeed.body?.data?.newLeads ?? []).some((n) => n.leadId === newId)
      );
      check(
        `${label}: #${newId} is ABSENT from ${otherLabel}'s feed`,
        !(theirFeed.body?.data?.all ?? []).some((n) => n.leadId === newId)
      );

      await db.query(`DELETE FROM follow_ups WHERE lead_id = $1`, [newId]);
      await db.query(`DELETE FROM walkin_enquiries WHERE id = $1`, [newId]);
      console.log(`  ....  cleaned up test lead #${newId}`);
    }
  } else {
    console.log("\n── 9. Lead-creation half SKIPPED (set ALLOW_WRITES=1 to run it) ──");
  }

  await db.end();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`   - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }
  console.log(`${"═".repeat(60)}\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
