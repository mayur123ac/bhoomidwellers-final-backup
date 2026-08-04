/* ══════════════════════════════════════════════════════════════════════════
   financial-integrity-audit.ts — Phase 5.

   Runs the Financial Obligation Engine over every live booking and reports what
   contradicts what. The gates added in Phase 2 stop NEW breaches; this finds the
   ones already sitting in the data.

   STRICTLY READ ONLY. Every statement here is a SELECT. It never fixes, never
   writes, never migrates — a flagged booking is for a human to review through
   the (future) Phase 6 adjustment workflow. If you ever feel tempted to add an
   UPDATE here, that is a different script with a different review.

   Usage:
     npm run audit:financials
     DATABASE_URL=<other-db> npm run audit:financials

   Runs outside Next.js, so the env is loaded through @next/env exactly as the
   app would load it — same .env.local, same precedence. An explicit
   DATABASE_URL in the environment wins over the file, which is what makes the
   "point it at Neon" invocation above work.
   ══════════════════════════════════════════════════════════════════════════ */

import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import { buildFinancialSnapshot, fmtINR } from "../src/lib/buildFinancialSnapshot";
import { computeFinancialObligation } from "../src/lib/financialObligationEngine";

loadEnvConfig(process.cwd());

// Every run writes its own file. A single fixed path meant a Neon run silently
// overwrote the local one, leaving a report whose contents didn't match the
// database anybody thought they were looking at. The db label is in the name for
// the same reason — two audits of different databases must not look alike.
const REPORT_DIR = "/tmp";
const reportPath = (dbLabel: string) =>
  `${REPORT_DIR}/financial-audit-${dbLabel}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

interface Issue {
  code: string;
  severity: "critical" | "error" | "warning";
  detail: string;
}

interface AuditRow {
  booking_id: number;
  booking_number: string | null;
  lead_id: number | null;
  customer_name: string | null;
  status: string | null;
  financials: {
    agreementValue: number;
    disbursedAmount: number;
    sanctionedAmount: number;
    totalOCRPaid: number;
    totalPaid: number;
    totalCustomerLiability: number;
    overallStatus: string;
    requiresAdminOverride: string[];
  } | null;
  overrides?: {
    adjustmentId: number;
    type: string;
    performedBy: string;
    performedByRole: string;
    performedAt: string;
    gateOverridden: string;
    amount: number;
    reason: string;
    resultingTrancheId: number | null;
  }[];
  issues: Issue[];
  clean: boolean;
}

// booking_status is the real column (there is no `status`), and live values are
// title-cased ('Confirmed'). Compared lower-case so a future 'CANCELLED' or
// 'Draft' is excluded too. cancelled_at is set by the cancellation flow.
const BOOKINGS_SQL = `
  SELECT
    b.id            AS booking_id,
    b.booking_number,
    b.lead_id,
    b.booking_status AS status,
    we.name          AS customer_name
  FROM booking_applications b
  LEFT JOIN walkin_enquiries we ON we.id = b.lead_id
  WHERE b.cancelled_at IS NULL
    AND LOWER(COALESCE(b.booking_status, '')) NOT IN ('cancelled', 'draft')
  ORDER BY b.id ASC
`;

// booking_applications and booking_financials both carry these columns. Phase 2
// was built reading the wrong one and computed ₹0 of customer contribution for
// every booking on Neon, where the booking_applications copies are NULL. Where
// BOTH are populated and disagree, one screen is showing a number no other
// screen agrees with — worth a human look even though the engine now has a
// defined precedence.
const DRIFT_SQL = `
  SELECT b.token_amount AS b_token, b.ocr_amount AS b_ocr,
         f.token_amount AS f_token, f.ocr_amount AS f_ocr
    FROM booking_applications b
    LEFT JOIN booking_financials f ON f.booking_id = b.id
   WHERE b.id = $1
`;

// Phase 6 audit trail. Left-joined per booking rather than up-front so a
// database without the table (pre-migration) fails one booking, not the run.
const OVERRIDES_SQL = `
  SELECT id, adjustment_type, performed_by, performed_by_role, performed_at,
         gate_code, approved_amount, reason, resulting_tranche_id
    FROM financial_adjustments
   WHERE booking_id = $1
   ORDER BY performed_at ASC
`;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set (checked environment and .env files).");
    process.exit(1);
  }

  // Own pool, passed explicitly into buildFinancialSnapshot, so the audit can
  // never silently read a different database than the one requested.
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 15_000 });
  const host = (() => { try { return new URL(connectionString).host; } catch { return "unknown"; } })();
  const dbLabel = /localhost|127\.0\.0\.1/.test(host)
    ? "local"
    : /neon\.tech/.test(host)
      ? "neon"
      : host.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);

  const { rows: bookings } = await pool.query(BOOKINGS_SQL);
  const results: AuditRow[] = [];

  // Schema-level observations, keyed by code. These describe the data model, not
  // a booking, so they are collected once and reported at the top — see
  // nullDrift() below.
  const schemaObservations = new Map<string, {
    code: string; column: string; emptyTable: string; populatedTable: string; bookingIds: number[];
  }>();
  const recordSchemaFinding = (
    code: string, column: string, emptyTable: string, populatedTable: string, bookingId: number
  ) => {
    const existing = schemaObservations.get(code);
    if (existing) existing.bookingIds.push(bookingId);
    else schemaObservations.set(code, { code, column, emptyTable, populatedTable, bookingIds: [bookingId] });
  };

  // Sequential on purpose: an audit is not latency-sensitive, and fanning out
  // over every booking would starve the pool on a large database.
  for (const booking of bookings) {
    const base = {
      booking_id: booking.booking_id,
      booking_number: booking.booking_number,
      lead_id: booking.lead_id,
      customer_name: booking.customer_name,
      status: booking.status,
    };

    try {
      const snapshot = await buildFinancialSnapshot({ bookingId: booking.booking_id }, pool);
      const obligation = computeFinancialObligation(snapshot);

      const issues: Issue[] = obligation.validationErrors.map(e => ({
        code: e.code,
        severity: e.severity,
        detail: e.message,
      }));
      const seen = new Set(issues.map(i => i.code));

      // The engine already raises DISBURSED_EXCEEDS_SANCTION and
      // AGREEMENT_VALUE_MISSING. These stay as a safety net for the case where
      // the engine's thresholds change, but must not double-report.
      if (!seen.has("DISBURSED_EXCEEDS_SANCTION")
          && obligation.sanctionedAmount > 0
          && obligation.disbursedAmount > obligation.sanctionedAmount) {
        issues.push({
          code: "DISBURSED_EXCEEDS_SANCTION",
          severity: "critical",
          detail: `Disbursed ₹${fmtINR(obligation.disbursedAmount)} exceeds sanctioned ₹${fmtINR(obligation.sanctionedAmount)}`,
        });
      }
      if (!seen.has("AGREEMENT_VALUE_MISSING") && !(snapshot.agreementValue > 0)) {
        issues.push({
          code: "MISSING_AGREEMENT_VALUE",
          severity: "error",
          detail: "Agreement value is zero or null — all ceiling calculations are meaningless",
        });
      }

      const { rows: driftRows } = await pool.query(DRIFT_SQL, [booking.booking_id]);
      const d = driftRows[0];

      // NULL drift: one table holds a figure, the other holds nothing. This is
      // the shape the Phase 2 bug actually took — booking_applications NULL,
      // booking_financials populated.
      //
      // Recorded at SCHEMA level, never as a per-booking issue. It fires on every
      // row in both databases because it describes the write path, not any one
      // booking: bookings persist these amounts to booking_financials and leave
      // the booking_applications copies empty. Counting it per booking made the
      // "clean" tally read 0 everywhere and buried the records that genuinely
      // need a human.
      const nullDrift = (
        col: "token_amount" | "ocr_amount",
        code: string,
        bVal: string | null,
        fVal: string | null
      ) => {
        if ((bVal === null) !== (fVal === null)) {
          const empty = bVal === null ? "booking_applications" : "booking_financials";
          const populated = bVal === null ? "booking_financials" : "booking_applications";
          recordSchemaFinding(code, col, empty, populated, booking.booking_id);
        }
      };
      if (d) {
        nullDrift("token_amount", "TOKEN_AMOUNT_NULL_DRIFT", d.b_token, d.f_token);
        nullDrift("ocr_amount", "OCR_AMOUNT_NULL_DRIFT", d.b_ocr, d.f_ocr);
      }

      if (d && d.b_token !== null && d.f_token !== null && Number(d.b_token) !== Number(d.f_token)) {
        issues.push({
          code: "TOKEN_AMOUNT_DRIFT",
          severity: "warning",
          detail: `booking_applications.token_amount ₹${fmtINR(Number(d.b_token))} differs from booking_financials.token_amount ₹${fmtINR(Number(d.f_token))}`,
        });
      }
      if (d && d.b_ocr !== null && d.f_ocr !== null && Number(d.b_ocr) !== Number(d.f_ocr)) {
        issues.push({
          code: "OCR_AMOUNT_DRIFT",
          severity: "warning",
          detail: `booking_applications.ocr_amount ₹${fmtINR(Number(d.b_ocr))} differs from booking_financials.ocr_amount ₹${fmtINR(Number(d.f_ocr))}`,
        });
      }

      // Phase 6: what a human already decided about this breach. A booking can
      // stay flagged forever and still be correct — the override explains why.
      const { rows: overrideRows } = await pool.query(OVERRIDES_SQL, [booking.booking_id]);
      const overrides = overrideRows.map(o => ({
        adjustmentId: o.id,
        type: o.adjustment_type,
        performedBy: o.performed_by,
        performedByRole: o.performed_by_role,
        performedAt: o.performed_at,
        gateOverridden: o.gate_code,
        amount: Number(o.approved_amount) || 0,
        reason: o.reason,
        resultingTrancheId: o.resulting_tranche_id,
      }));

      results.push({
        ...base,
        overrides,
        financials: {
          agreementValue: snapshot.agreementValue,
          disbursedAmount: obligation.disbursedAmount,
          sanctionedAmount: obligation.sanctionedAmount,
          totalOCRPaid: obligation.totalOCRPaid,
          totalPaid: obligation.totalPaid,
          totalCustomerLiability: obligation.totalCustomerLiability,
          overallStatus: obligation.overallStatus,
          requiresAdminOverride: obligation.requiresAdminOverride,
        },
        issues,
        clean: issues.length === 0,
      });
    } catch (err) {
      // One unreadable booking must not cost the other 200 their audit.
      results.push({
        ...base,
        financials: null,
        issues: [{
          code: "AUDIT_ERROR",
          severity: "critical",
          detail: err instanceof Error ? err.message : String(err),
        }],
        clean: false,
      });
    }
  }

  const rank = (r: AuditRow) =>
    r.issues.some(i => i.severity === "critical") ? 0
      : r.issues.some(i => i.severity === "error") ? 1
        : r.issues.some(i => i.severity === "warning") ? 2
          : 3;

  const allIssues = results.flatMap(r => r.issues);

  // "all_bookings" only when it genuinely is all of them — a finding that
  // affects 3 of 7 must not claim the schema is uniformly broken.
  const schemaFindings = [...schemaObservations.values()].map(o => ({
    code: o.code,
    scope: o.bookingIds.length === results.length
      ? "all_bookings"
      : `${o.bookingIds.length}_of_${results.length}_bookings`,
    detail: `${o.emptyTable}.${o.column} is NULL on ${o.bookingIds.length === results.length ? "all" : o.bookingIds.length} booking(s). ${o.populatedTable} is the authoritative source. The ${o.emptyTable} columns are dead weight — consider dropping them in a future migration.`,
    affectedBookingIds: o.bookingIds,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    database: host,
    // Reported once, above the per-booking results: these are properties of the
    // data model and are deliberately excluded from every booking's issue list
    // and from the clean/flagged tallies below.
    schema_findings: schemaFindings,
    totalBookings: results.length,
    cleanBookings: results.filter(r => r.clean).length,
    flaggedBookings: results.filter(r => !r.clean).length,
    criticalCount: allIssues.filter(i => i.severity === "critical").length,
    errorCount: allIssues.filter(i => i.severity === "error").length,
    warningCount: allIssues.filter(i => i.severity === "warning").length,
    results: [...results].sort((a, b) => rank(a) - rank(b) || a.booking_id - b.booking_id),
  };

  // "/tmp/..." resolves per-platform (D:\tmp on this Windows setup). Create the
  // directory rather than failing with ENOENT on a machine that has no /tmp.
  const outPath = path.resolve(reportPath(dbLabel));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n═══════════════════════════════════════");
  console.log("  FINANCIAL INTEGRITY AUDIT");
  console.log(`  ${report.generatedAt}`);
  console.log(`  db: ${report.database}`);
  console.log("═══════════════════════════════════════");
  console.log(`  Total bookings audited : ${report.totalBookings}`);
  console.log(`  Clean                  : ${report.cleanBookings}`);
  console.log(`  Flagged                : ${report.flaggedBookings}`);
  console.log(`  Critical issues        : ${report.criticalCount}`);
  console.log(`  Errors                 : ${report.errorCount}`);
  console.log(`  Warnings               : ${report.warningCount}`);
  if (schemaFindings.length) {
    console.log("───────────────────────────────────────");
    console.log("  SCHEMA FINDINGS (not counted per booking)");
    for (const f of schemaFindings) {
      console.log(`  🔵 [${f.code}] (${f.scope})`);
      console.log(`     ${f.detail}`);
    }
  }
  console.log("───────────────────────────────────────");

  for (const r of report.results.filter(x => !x.clean)) {
    console.log(`\n  ${r.booking_number || "(no number)"} — ${r.customer_name || "(unknown)"}`);
    console.log(`  Lead #${r.lead_id} · Status: ${r.status}`);
    if (r.financials) {
      console.log(`  Agreement: ₹${fmtINR(r.financials.agreementValue)}`);
      console.log(`  Disbursed: ₹${fmtINR(r.financials.disbursedAmount)}`);
      console.log(`  Overall:   ${r.financials.overallStatus}`);
    }
    for (const issue of r.issues) {
      const icon = issue.severity === "critical" ? "🔴" : issue.severity === "error" ? "🟠" : "🟡";
      console.log(`  ${icon} [${issue.code}] ${issue.detail}`);
    }
    for (const o of r.overrides ?? []) {
      console.log(`  🛡️ [ADMIN_OVERRIDE #${o.adjustmentId}] ${o.gateOverridden} bypassed by ${o.performedBy} (${o.performedByRole}) for ₹${fmtINR(o.amount)} — "${o.reason}"`);
    }
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`  Report saved: ${outPath}`);
  console.log("═══════════════════════════════════════\n");

  await pool.end();
}

main().catch(err => {
  console.error("[financial-integrity-audit] fatal:", err);
  process.exit(1);
});
