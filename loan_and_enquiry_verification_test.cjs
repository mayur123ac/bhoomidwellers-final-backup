// loan_and_enquiry_verification_test.cjs
//
// Verification for the Phase-1 performance sprint changes that touched tenant
// boundaries or API contracts:
//
//   1. GET /api/loan is organization-scoped (it was NOT — a lead_id from another
//      tenant returned that tenant's whole loan history), and `latest=1` returns
//      the same newest row every caller was already picking off the end.
//   2. GET /api/walkin_enquiries server-side search / sort / status filter stay
//      inside the caller's organization, and an unknown sort key cannot reach SQL.
//   3. The routes that used to run DDL on the request path no longer do, and the
//      schema they used to create is present anyway.
//
//   node loan_and_enquiry_verification_test.cjs
//   BASE_URL=http://localhost:3011 node loan_and_enquiry_verification_test.cjs
//
// Read-only. It creates nothing and modifies nothing; the database session runs
// inside BEGIN TRANSACTION READ ONLY.

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const BASE = process.env.BASE_URL || "http://localhost:3000";

const env = {};
for (const raw of fs.readFileSync(path.join(__dirname, ".env.local"), "utf8").split(/\r?\n/)) {
  const l = raw.replace(/^﻿/, "").trim();
  if (!l || l.startsWith("#")) continue;
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const b64 = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (p) => {
  const n = Math.floor(Date.now() / 1000);
  const e = b64(JSON.stringify({ ...p, iat: n, exp: n + 3600 }));
  return `${e}.${b64(crypto.createHmac("sha256", env.SESSION_SECRET).update(e).digest())}`;
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; failures.push(name + (detail ? ": " + detail : "")); console.log("  FAIL  " + name + (detail ? "  -- " + detail : "")); }
};

const api = async (cookie, url) => {
  const res = await fetch(BASE + url, { headers: { cookie: "crm_session=" + cookie } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, bytes: Buffer.byteLength(text) };
};

(async () => {
  const u = new URL(env.DATABASE_URL);
  const db = new Client({
    host: u.hostname, database: u.pathname.replace(/^\//, "").split("?")[0],
    user: u.username, password: u.password, ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  // Belt and braces: this script must never mutate production.
  await db.query("BEGIN TRANSACTION READ ONLY");

  const { rows: orgs } = await db.query(
    "SELECT o.id, o.name," +
    " (SELECT json_build_object('id', usr.id, 'name', usr.name, 'email', usr.email, 'role', usr.role)" +
    "    FROM users usr WHERE usr.organization_id = o.id AND usr.is_active = true" +
    "     AND LOWER(REPLACE(usr.role, '_', ' ')) = 'admin' ORDER BY usr.id LIMIT 1) AS admin," +
    " (SELECT count(*)::int FROM loan_updates lu WHERE lu.organization_id = o.id) AS loans," +
    " (SELECT count(*)::int FROM walkin_enquiries w WHERE w.organization_id = o.id) AS leads" +
    " FROM organizations o ORDER BY o.created_at");
  const withAdmin = orgs.filter((o) => o.admin);
  const A = withAdmin.find((o) => o.loans > 0) || withAdmin[0];
  const B = withAdmin.find((o) => o.id !== A.id);
  if (!A || !B) { console.error("ABORT: need two organizations with an active Admin."); process.exit(2); }

  console.log("\nBase URL: " + BASE);
  console.log("Tenant A: " + A.name + " (" + A.loans + " loan updates, " + A.leads + " leads)");
  console.log("Tenant B: " + B.name + " (" + B.loans + " loan updates, " + B.leads + " leads)\n");

  const ck = (o) => sign({ _id: String(o.admin.id), name: o.admin.name, email: o.admin.email, role: o.admin.role, isActive: true, org: o.id });
  const cookieA = ck(A), cookieB = ck(B);

  // ===========================================================================
  console.log("-- 1. GET /api/loan is tenant-scoped --");
  // ===========================================================================
  const { rows: ln } = await db.query(
    "SELECT lead_id, count(*)::int AS n FROM loan_updates" +
    " WHERE organization_id = $1 AND lead_id IS NOT NULL" +
    " GROUP BY lead_id ORDER BY n DESC, lead_id DESC LIMIT 1", [A.id]);
  if (!ln.length) { console.error("ABORT: tenant A has no loan_updates rows."); process.exit(2); }
  const loanLeadId = ln[0].lead_id, loanRowCount = ln[0].n;

  const ownLoans = await api(cookieA, "/api/loan?lead_id=" + loanLeadId);
  const fullRows = ownLoans.json?.data ?? [];
  check("owner reads its own loan history", ownLoans.status === 200 && Array.isArray(ownLoans.json?.data), "status " + ownLoans.status);
  check("owner gets all " + loanRowCount + " row(s)", fullRows.length === loanRowCount, "got " + fullRows.length);

  // The whole point of the fix: lead ids are GLOBAL integers, so before this
  // change any signed-in user of ANY tenant could read this history by guessing
  // an id. Row count is what is asserted, not the status code.
  const crossLoans = await api(cookieB, "/api/loan?lead_id=" + loanLeadId);
  const leaked = crossLoans.json?.data ?? [];
  check("B cannot read A's loan history via A's lead_id",
        crossLoans.status !== 200 || leaked.length === 0,
        "status " + crossLoans.status + ", " + leaked.length + " rows leaked");

  // The no-lead_id branch used to be SELECT * FROM loan_updates across every org.
  const allAsB = await api(cookieB, "/api/loan");
  const allBRows = allAsB.json?.data ?? [];
  const foreign = allBRows.filter((r) => r.organization_id && String(r.organization_id) !== String(B.id));
  check("B's unfiltered loan list contains only B's rows", foreign.length === 0, foreign.length + " foreign rows");
  check("B's unfiltered loan list matches B's row count (" + B.loans + ")", allBRows.length === B.loans, "got " + allBRows.length);

  // latest=1 must return the same row every caller already took off the end.
  const latest = await api(cookieA, "/api/loan?lead_id=" + loanLeadId + "&latest=1");
  const latestRows = latest.json?.data ?? [];
  check("latest=1 still returns an ARRAY (callers index into it)", Array.isArray(latestRows));
  check("latest=1 returns exactly one row", latestRows.length === 1, "got " + latestRows.length);
  check("latest=1 row === the row callers picked with rows[rows.length - 1]",
        latestRows[0]?.id === fullRows[fullRows.length - 1]?.id,
        latestRows[0]?.id + " vs " + fullRows[fullRows.length - 1]?.id);
  check("latest=1 payload is no larger (" + fullRows.length + " rows -> 1)",
        latest.bytes <= ownLoans.bytes, latest.bytes + " vs " + ownLoans.bytes + " bytes");

  // ===========================================================================
  console.log("\n-- 2. /api/walkin_enquiries search / sort / filter stay in-tenant --");
  // ===========================================================================
  const listB = await api(cookieB, "/api/walkin_enquiries?limit=10000");
  const rowsB = listB.json?.data ?? [];
  const foreignLeads = rowsB.filter((r) => r.organization_id && String(r.organization_id) !== String(B.id));
  check("B's unfiltered list contains only B's leads", foreignLeads.length === 0, foreignLeads.length + " foreign rows");
  check("B's list matches B's row count in the database (" + B.leads + ")", rowsB.length === B.leads, "got " + rowsB.length);

  // Search must narrow WITHIN the tenant, never widen across it.
  const searchB = await api(cookieB, "/api/walkin_enquiries?limit=10000&q=a");
  const searchRowsB = searchB.json?.data ?? [];
  check("search cannot return more than the tenant holds", searchRowsB.length <= B.leads,
        searchRowsB.length + " > " + B.leads);
  check("searched rows are all B's",
        searchRowsB.every((r) => !r.organization_id || String(r.organization_id) === String(B.id)));

  // An unknown sort key must be dropped, not interpolated into ORDER BY.
  const inject = await api(cookieB, "/api/walkin_enquiries?limit=50&sort=" + encodeURIComponent("id; DROP TABLE walkin_enquiries"));
  check("unknown sort key is ignored, not injected", inject.status === 200, "status " + inject.status);
  const { rows: stillThere } = await db.query("SELECT to_regclass('public.walkin_enquiries') IS NOT NULL AS ok");
  check("walkin_enquiries still exists after the injection attempt", stillThere[0].ok === true);

  // Whitelisted sorts execute.
  for (const key of ["lead_no", "name", "created_at"]) {
    const asc = await api(cookieB, "/api/walkin_enquiries?limit=50&sort=" + key + "&sortDir=asc");
    check("sort=" + key + " responds 200", asc.status === 200, "status " + asc.status);
  }

  // ===========================================================================
  console.log("\n-- 3. No DDL left on the request path --");
  // ===========================================================================
  const src = fs.readFileSync(path.join(__dirname, "src/app/api/revenue-intelligence/route.ts"), "utf8");
  check("revenue-intelligence/route.ts runs no DDL", !/query\(\s*`?\s*(CREATE INDEX|ALTER TABLE|CREATE TABLE)/i.test(src));
  const loanSrc = fs.readFileSync(path.join(__dirname, "src/app/api/loan/route.ts"), "utf8");
  check("loan/route.ts runs no DDL", !/query\(\s*`?\s*(CREATE INDEX|ALTER TABLE|CREATE TABLE)/i.test(loanSrc));

  const { rows: idx } = await db.query(
    "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx_rev_%'");
  check("all 7 idx_rev_* indexes exist without the route creating them", idx[0].n === 7, "found " + idx[0].n);
  const { rows: cols } = await db.query(
    "SELECT count(*)::int AS n FROM information_schema.columns" +
    " WHERE table_schema='public' AND table_name='loan_updates'" +
    "   AND column_name IN ('previous_status','new_status')");
  check("loan_updates audit columns exist without the route adding them", cols[0].n === 2, "found " + cols[0].n);

  const rev = await api(cookieA, "/api/revenue-intelligence");
  check("revenue-intelligence still responds", rev.status === 200, "status " + rev.status);

  console.log("\n" + "=".repeat(64));
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("=".repeat(64));
  if (failures.length) { console.log("\nFailures:"); failures.forEach((f) => console.log("  - " + f)); }

  await db.query("ROLLBACK");
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(3); });
