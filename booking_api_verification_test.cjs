// booking_api_verification_test.cjs
//
// Post-refactor verification for the booking API:
//   1. the full response shape did not lose a single field (no UI regression)
//   2. view=summary really is lighter, and carries no identity documents
//   3. every booking endpoint is still organization-scoped
//   4. schema objects the deleted ensureTable() used to create all exist
//
//   node booking_api_verification_test.cjs
//   BASE_URL=https://... node booking_api_verification_test.cjs
//
// Read-only. It creates nothing and modifies nothing.

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
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`); }
};

const api = async (cookie, url) => {
  const res = await fetch(`${BASE}${url}`, { headers: { cookie: `crm_session=${cookie}` } });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body, bytes: Buffer.byteLength(text) };
};

// Everything the booking UI reads off the full response. Sourced from
// BookingFormModal / ClosedLeadBookingView / LoanDealForm / LoanDealView.
const REQUIRED_FULL_FIELDS = [
  "id", "booking_number", "lead_id", "booking_status", "booking_date", "application_date",
  "agreement_value", "booking_amount", "primary_name", "primary_email", "primary_mobile",
  "primary_pan", "primary_aadhaar", "joint_applicants", "address", "pin", "state", "country",
  "property_type", "floor_number", "flat_number", "carpet_area", "consideration_value",
  "project_name", "apartment_name", "tower", "wing",
  "lead_name", "lead_phone", "lead_email", "lead_address", "lead_sr_no", "lead_assigned_to",
  "token_amount", "ocr_amount", "ocr_received_date", "ocr_payment_mode", "ocr_remarks",
  "cash_component", "cash_component_date",
  "loan_required", "bank_name", "loan_executive", "loan_type", "loan_amount",
  "sanction_amount", "sanction_date", "sanction_status", "loan_status",
  "expected_disbursement_date", "actual_disbursement_date", "disbursement_amount",
  "interest_rate", "loan_tenure_months", "emi_start_date", "payment_type", "emi_amount",
  "expected_registration_date", "actual_registration_date", "registration_status",
  "registration_number", "stamp_duty_rate", "stamp_duty_amount", "stamp_duty_status",
  "registration_fee_rate", "registration_fee_amount", "registration_fee_status",
  "custom_charges", "financial_summary", "total_received", "balance_receivable",
  "gst_rate", "gst_amount",
];

// Fields the summary must carry.
const REQUIRED_SUMMARY_FIELDS = [
  "id", "booking_number", "lead_id", "booking_status", "booking_date", "application_date",
  "agreement_value", "project_name", "tower", "flat_number", "lead_name", "lead_phone", "created_at",
];

// Fields the summary must NOT carry — identity documents and signatures have no
// business in a list payload.
const FORBIDDEN_SUMMARY_FIELDS = [
  "primary_pan", "primary_aadhaar", "primary_pan_url", "primary_aadhaar_front_url",
  "primary_aadhaar_back_url", "signature_data", "internal_notes", "payment_details",
];

(async () => {
  const u = new URL(env.DATABASE_URL);
  const db = new Client({
    host: u.hostname, database: u.pathname.replace(/^\//, "").split("?")[0],
    user: u.username, password: u.password, ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const { rows: orgs } = await db.query(
    `SELECT o.id, o.name,
            (SELECT json_build_object('id', usr.id, 'name', usr.name, 'email', usr.email, 'role', usr.role)
               FROM users usr WHERE usr.organization_id = o.id AND usr.is_active = true
                AND LOWER(REPLACE(usr.role, '_', ' ')) = 'admin' ORDER BY usr.id LIMIT 1) AS admin,
            (SELECT count(*)::int FROM booking_applications ba WHERE ba.organization_id = o.id) AS bookings
       FROM organizations o ORDER BY o.created_at`);
  const withAdmin = orgs.filter((o) => o.admin);
  const A = withAdmin.find((o) => o.bookings > 0) || withAdmin[0];
  const B = withAdmin.find((o) => o.id !== A.id);
  if (!A || !B) { console.error("ABORT: need two organizations with an active Admin."); process.exit(2); }

  console.log(`\nBase URL: ${BASE}`);
  console.log(`Tenant A: ${A.name} (${A.bookings} bookings)`);
  console.log(`Tenant B: ${B.name} (${B.bookings} bookings)\n`);

  const ck = (o) => sign({ _id: String(o.admin.id), name: o.admin.name, email: o.admin.email, role: o.admin.role, isActive: true, org: o.id });
  const cookieA = ck(A), cookieB = ck(B);

  const { rows: bk } = await db.query(
    `SELECT id, lead_id FROM booking_applications WHERE organization_id = $1 ORDER BY id DESC LIMIT 1`, [A.id]);
  if (!bk.length) { console.error("ABORT: tenant A has no bookings to test against."); process.exit(2); }
  const bookingId = bk[0].id, leadId = bk[0].lead_id;

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("── 1. The full response still carries every field the UI reads ──");
  // ═══════════════════════════════════════════════════════════════════════════
  const full = await api(cookieA, `/api/booking-applications?lead_id=${leadId}`);
  check("full list responds 200", full.status === 200, `status ${full.status}`);
  const fullRow = full.body?.data?.[0];
  check("full list returns the booking", !!fullRow);
  if (fullRow) {
    const missing = REQUIRED_FULL_FIELDS.filter((f) => !(f in fullRow));
    check(`all ${REQUIRED_FULL_FIELDS.length} UI fields present on the full shape`,
      missing.length === 0, `missing: ${missing.join(", ")}`);
  }

  const detail = await api(cookieA, `/api/booking-applications/${bookingId}`);
  check("detail endpoint responds 200", detail.status === 200, `status ${detail.status}`);
  if (detail.body?.data && fullRow) {
    // The detail route has its own SELECT; it must not have drifted from the list's.
    const detailMissing = REQUIRED_FULL_FIELDS.filter((f) => !(f in detail.body.data));
    check("detail shape carries the same UI fields", detailMissing.length === 0,
      `missing: ${detailMissing.join(", ")}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── 2. view=summary is lighter and carries no identity documents ──");
  // ═══════════════════════════════════════════════════════════════════════════
  const summary = await api(cookieA, `/api/booking-applications?lead_id=${leadId}&view=summary`);
  check("summary responds 200", summary.status === 200, `status ${summary.status}`);
  const sumRow = summary.body?.data?.[0];
  check("summary returns the booking", !!sumRow);
  if (sumRow) {
    const missing = REQUIRED_SUMMARY_FIELDS.filter((f) => !(f in sumRow));
    check("summary carries every field its callers need", missing.length === 0, `missing: ${missing.join(", ")}`);
    const leaked = FORBIDDEN_SUMMARY_FIELDS.filter((f) => f in sumRow);
    check("summary carries NO PAN / Aadhaar / signature / notes", leaked.length === 0, `leaked: ${leaked.join(", ")}`);
    check(`summary has ${Object.keys(sumRow).length} keys vs full ${Object.keys(fullRow || {}).length}`,
      Object.keys(sumRow).length < Object.keys(fullRow || {}).length);
  }
  const listFull = await api(cookieA, `/api/booking-applications?limit=50`);
  const listSum = await api(cookieA, `/api/booking-applications?limit=50&view=summary`);
  const pct = listFull.bytes ? Math.round((1 - listSum.bytes / listFull.bytes) * 100) : 0;
  check(`list payload: ${(listFull.bytes / 1024).toFixed(1)} KB full -> ${(listSum.bytes / 1024).toFixed(1)} KB summary (-${pct}%)`,
    listSum.bytes < listFull.bytes);
  check("both list modes return the same number of rows",
    (listFull.body?.data?.length ?? -1) === (listSum.body?.data?.length ?? -2),
    `${listFull.body?.data?.length} vs ${listSum.body?.data?.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── 3. Tenant isolation across every booking endpoint ──");
  // ═══════════════════════════════════════════════════════════════════════════
  const endpoints = [
    ["booking detail", `/api/booking-applications/${bookingId}`],
    ["booking-details", `/api/booking-details/${bookingId}`],
    ["booking-documents", `/api/booking-documents/${bookingId}`],
    ["payment-summary", `/api/booking-applications/${bookingId}/payment-summary`],
    ["history", `/api/booking-applications/${bookingId}/history`],
    ["financial-status", `/api/booking-applications/${bookingId}/financial-status`],
    ["pdd", `/api/booking-applications/${bookingId}/pdd`],
    ["tds", `/api/booking-applications/${bookingId}/tds`],
    ["loan-applications", `/api/booking-applications/${bookingId}/loan-applications`],
  ];
  for (const [label, url] of endpoints) {
    const asB = await api(cookieB, url);
    // Either refuse outright, or return an empty/null payload — never A's data.
    const refused = asB.status === 404 || asB.status === 403;
    const emptied =
      asB.status === 200 &&
      (asB.body?.data == null ||
        (Array.isArray(asB.body.data) && asB.body.data.length === 0) ||
        (typeof asB.body.data === "object" &&
          Object.values(asB.body.data).every((v) => v == null || (Array.isArray(v) && v.length === 0))));
    check(`B cannot read A's ${label}`, refused || emptied,
      `status ${asB.status} body ${JSON.stringify(asB.body).slice(0, 160)}`);
  }

  // /milestones is write-only (POST). A GET returning 405 is the correct answer,
  // and its POST verifies booking ownership via assertParentOrganization() inside
  // the transaction — checked by reading the route, not by writing to production.
  const milestonesGet = await api(cookieB, `/api/booking-applications/${bookingId}/milestones`);
  check("A's milestones endpoint exposes no GET surface at all", milestonesGet.status === 405,
    `status ${milestonesGet.status}`);

  const listAsB = await api(cookieB, `/api/booking-applications?limit=200`);
  const bIds = (listAsB.body?.data || []).map((r) => r.id);
  const { rows: bOwned } = await db.query(
    `SELECT id FROM booking_applications WHERE organization_id = $1`, [B.id]);
  const owned = new Set(bOwned.map((r) => r.id));
  check("B's booking list contains only B's bookings",
    bIds.every((id) => owned.has(id)), `foreign ids: ${bIds.filter((id) => !owned.has(id)).join(", ")}`);

  const summaryAsB = await api(cookieB, `/api/booking-applications?limit=200&view=summary`);
  const bSumIds = (summaryAsB.body?.data || []).map((r) => r.id);
  check("B's summary list contains only B's bookings",
    bSumIds.every((id) => owned.has(id)), `foreign ids: ${bSumIds.filter((id) => !owned.has(id)).join(", ")}`);

  const byLeadAsB = await api(cookieB, `/api/booking-applications?lead_id=${leadId}`);
  check("B cannot reach A's booking via A's lead_id",
    (byLeadAsB.body?.data || []).length === 0,
    `returned ${(byLeadAsB.body?.data || []).length} rows`);

  const anon = await fetch(`${BASE}/api/booking-applications?limit=5`);
  check("anonymous list is 401", anon.status === 401, `status ${anon.status}`);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── 4. Schema the deleted ensureTable() used to create ──");
  // ═══════════════════════════════════════════════════════════════════════════
  const relations = ["booking_applications", "booking_financials", "booking_loan_details",
    "booking_registration_details", "booking_custom_charges", "booking_pipeline",
    "booking_stage_history", "financial_accounts", "financial_ledger", "booking_history",
    "customer_ledger_view", "booking_total_cost_view"];
  const { rows: rel } = await db.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`, [relations]);
  const have = new Set(rel.map((r) => r.relname));
  check(`all ${relations.length} relations exist without ensureTable()`,
    relations.every((r) => have.has(r)), `missing: ${relations.filter((r) => !have.has(r)).join(", ")}`);

  const { rows: idx } = await db.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1::text[])`,
    [["idx_booking_applications_org_created", "idx_booking_applications_org_lead",
      "idx_booking_custom_charges_booking_id", "idx_booking_documents_booking_id",
      "idx_booking_payment_milestones_booking_id", "idx_booking_history_booking_id"]]);
  check(`all 6 new indexes present`, idx.length === 6, `found ${idx.length}: ${idx.map((i) => i.indexname).join(", ")}`);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n── 5. No DDL remains on the booking request path ──");
  // ═══════════════════════════════════════════════════════════════════════════
  const routeFiles = [
    "src/app/api/booking-applications/route.ts",
    "src/app/api/booking-applications/[id]/route.ts",
    "src/app/api/booking-applications/[id]/history/route.ts",
    "src/app/api/booking-details/[bookingId]/route.ts",
    "src/app/api/booking-documents/[bookingId]/route.ts",
  ];
  for (const f of routeFiles) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    // Only count DDL that is actually executed — inside a query(`...`) template,
    // not the explanatory comments describing what was removed.
    const executed = (src.match(/query\(\s*`[^`]*(CREATE TABLE|ALTER TABLE|CREATE OR REPLACE VIEW|CREATE INDEX)/gi) || []).length;
    check(`${f.replace("src/app/api/", "")} runs no DDL`, executed === 0, `${executed} statement(s)`);
  }

  await db.end();
  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) { console.log("\n  Failures:"); failures.forEach((f) => console.log(`   - ${f}`)); }
  console.log(`${"═".repeat(64)}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
