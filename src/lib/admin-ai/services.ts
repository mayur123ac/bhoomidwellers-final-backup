// admin-ai/services.ts — the tool handlers.
//
// ── Why every query here was rewritten ──────────────────────────────────────
// The previous handlers queried columns that do not exist on this database:
// `status`, `sales_manager`, `prop_type`, `customer_name`, `flat_no`,
// `own_contribution_received`, `disbursement_received`, `loan_planned`,
// `loan_amount_requested`, `loan_amount_approved` — ten of the thirteen columns
// they referenced. Every one of the five tools threw at runtime, was caught, and
// returned `{ error: "Failed to execute database query." }` to the model. The
// assistant was answering business questions with no working retrieval at all.
//
// The real columns (verified against information_schema) are booking_status,
// primary_name, flat_number, property_type, ocr_amount, disbursement_amount,
// loan_required, loan_amount, sanction_amount.
//
// ── Rules every handler obeys ───────────────────────────────────────────────
// • SQL is static text with bound parameters. No fragment is ever built from
//   model output — the model picks the tool and supplies filters, never SQL.
// • Money is summed in Postgres, not by the model. Section 10 of the brief:
//   retrieve authorized rows, compute deterministically, let the model explain.
// • Every result set is capped. An unbounded list is a token bill and a way to
//   push the real answer out of the context window.
// • `scope` is accepted by every handler even where an Admin scope adds no
//   predicate, so widening access to other roles later is a change inside these
//   functions rather than a change to their call sites.

import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import type { AiScope } from "./rbac";

/** Rows a single tool may return. Beyond this the model gets a truncation note. */
const MAX_ROWS = 25;

/** Bookings that never became revenue must not inflate any total. */
const ACTIVE_BOOKING = `COALESCE(booking_status,'') NOT IN ('Cancelled','Dropped','Rejected')`;

/**
 * Money lives in the detail tables, not on booking_applications.
 *
 * booking_applications carries denormalized copies of ocr_amount,
 * cash_component, sanction_amount and disbursement_amount — and on this database
 * every one of them is NULL, while booking_financials and booking_loan_details
 * hold the real figures. Summing the columns on booking_applications returns ₹0
 * for a book that has actually collected ₹41.5 L and disbursed ₹2 Cr.
 *
 * COALESCE(detail, denormalized) rather than the detail table alone: the copies
 * are what a future write path might populate, so preferring the detail table
 * while still falling back keeps this correct either way. This is the same join
 * /api/revenue-intelligence uses, which is why the totals agree with the
 * dashboard by construction.
 */
const MONEY_JOIN = `
  LEFT JOIN booking_financials   bf ON bf.booking_id = b.id
  LEFT JOIN booking_loan_details bl ON bl.booking_id = b.id`;

const OCR = `COALESCE(bf.ocr_amount,     b.ocr_amount,     0)`;
const CASH = `COALESCE(bf.cash_component, b.cash_component, 0)`;
const SDR = `COALESCE(bf.sdr_amount,     b.sdr_amount,     0)`;
const SANCTIONED = `COALESCE(bl.sanction_amount,     b.sanction_amount,     0)`;
const DISBURSED = `COALESCE(bl.disbursement_amount, b.disbursement_amount, 0)`;

const num = (v: any): number => {
  if (v === null || v === undefined) return 0;
  const parsed = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Optional YYYY-MM filter, validated here rather than trusted from the model. */
function monthBounds(month?: unknown): { from: string; to: string } | null {
  const raw = typeof month === "string" ? month.trim() : "";
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const [y, m] = raw.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  const from = `${raw}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to };
}

/* ─────────────────────────── revenue ─────────────────────────── */

export async function getRevenueSummary(args: any, _scope: AiScope) {
  const bounds = monthBounds(args?.month);
  const params: any[] = [];
  let dateClause = "";
  if (bounds) {
    params.push(bounds.from, bounds.to);
    dateClause = `AND COALESCE(b.booking_date, b.application_date, b.created_at::date) >= $1::date
                  AND COALESCE(b.booking_date, b.application_date, b.created_at::date) <  $2::date`;
  }

  const rows = await query<any>(
    `SELECT COUNT(*)::int                      AS bookings,
            COALESCE(SUM(b.agreement_value),0) AS agreement_value,
            COALESCE(SUM(${OCR}),0)            AS ocr_collected,
            COALESCE(SUM(${SDR}),0)            AS sdr_collected,
            COALESCE(SUM(${CASH}),0)           AS cash_collected,
            COALESCE(SUM(${DISBURSED}),0)      AS loan_disbursed,
            COALESCE(SUM(${SANCTIONED}),0)     AS loan_sanctioned
       FROM booking_applications b ${MONEY_JOIN}
      WHERE ${ACTIVE_BOOKING.replace(/booking_status/g, "b.booking_status")} ${dateClause}`,
    params
  );

  const r = rows[0] ?? {};
  const agreementValue = num(r.agreement_value);
  const collected = num(r.ocr_collected) + num(r.cash_collected) + num(r.loan_disbursed);

  return {
    period: bounds ? args.month : "all time",
    bookings: r.bookings ?? 0,
    agreementValue,
    ocrCollected: num(r.ocr_collected),
    cashCollected: num(r.cash_collected),
    loanSanctioned: num(r.loan_sanctioned),
    loanDisbursed: num(r.loan_disbursed),
    totalCollected: collected,
    balanceReceivable: agreementValue - collected,
    // Stated so the model reports the basis rather than inventing one. SDR is a
    // government charge collected on behalf of the state, not developer revenue.
    basis: "Collected = OCR + cash component + loan disbursed. SDR and GST are excluded as government charges.",
  };
}

/* ─────────────────────────── loans ─────────────────────────── */

export async function getLoanSummary(_args: any, _scope: AiScope) {
  // loan_required is BOOLEAN, not the 'Yes'/'No' text the previous version
  // compared against — and the copy on booking_applications reads false for
  // every row while booking_loan_details reads true, so the detail table wins.
  const rows = await query<any>(
    `SELECT COALESCE(NULLIF(TRIM(COALESCE(bl.loan_status, b.loan_status)),''),'Unknown') AS status,
            COUNT(*)::int                                    AS cases,
            COALESCE(SUM(COALESCE(bl.loan_amount, b.loan_amount, 0)),0) AS requested,
            COALESCE(SUM(${SANCTIONED}),0)                   AS sanctioned,
            COALESCE(SUM(${DISBURSED}),0)                    AS disbursed
       FROM booking_applications b ${MONEY_JOIN}
      WHERE ${ACTIVE_BOOKING.replace(/booking_status/g, "b.booking_status")}
        AND COALESCE(bl.loan_required, b.loan_required) IS TRUE
      GROUP BY 1
      ORDER BY sanctioned DESC`
  );

  const byStatus = rows.map((r) => ({
    status: r.status,
    cases: r.cases,
    requested: num(r.requested),
    sanctioned: num(r.sanctioned),
    disbursed: num(r.disbursed),
  }));

  const totals = byStatus.reduce(
    (acc, r) => ({
      cases: acc.cases + r.cases,
      requested: acc.requested + r.requested,
      sanctioned: acc.sanctioned + r.sanctioned,
      disbursed: acc.disbursed + r.disbursed,
    }),
    { cases: 0, requested: 0, sanctioned: 0, disbursed: 0 }
  );

  return { byStatus, totals, pendingDisbursement: totals.sanctioned - totals.disbursed };
}

export async function getPendingDisbursements(_args: any, _scope: AiScope) {
  const rows = await query<any>(
    `SELECT b.primary_name, b.flat_number,
            COALESCE(bl.bank_name, b.bank_name) AS bank_name,
            ${SANCTIONED} AS sanctioned,
            ${DISBURSED}  AS disbursed,
            COALESCE(bl.expected_disbursement_date, b.expected_disbursement_date) AS expected_disbursement_date
       FROM booking_applications b ${MONEY_JOIN}
      WHERE ${ACTIVE_BOOKING.replace(/booking_status/g, "b.booking_status")}
        AND ${SANCTIONED} > ${DISBURSED}
      ORDER BY (${SANCTIONED} - ${DISBURSED}) DESC
      LIMIT ${MAX_ROWS}`
  );
  return rows.map((r) => ({
    customer: r.primary_name,
    flat: r.flat_number,
    bank: r.bank_name,
    sanctioned: num(r.sanctioned),
    disbursed: num(r.disbursed),
    outstanding: num(r.sanctioned) - num(r.disbursed),
    expectedDate: r.expected_disbursement_date,
  }));
}

/* ─────────────────────── people & performance ─────────────────────── */

export async function getSalesManagerPerformance(_args: any, _scope: AiScope) {
  // The sales manager lives on the originating lead, not the booking — there is
  // no sales_manager column on booking_applications, which is what the previous
  // implementation assumed.
  const rows = await query<any>(
    `SELECT COALESCE(NULLIF(TRIM(w.assigned_to),''),'Unassigned') AS manager,
            COUNT(b.id)::int                   AS bookings,
            COALESCE(SUM(b.agreement_value),0) AS agreement_value,
            COALESCE(SUM(${OCR}),0)            AS ocr_collected
       FROM booking_applications b
       LEFT JOIN walkin_enquiries w
              ON w.id = b.lead_id AND w.organization_id = b.organization_id
       ${MONEY_JOIN}
      WHERE ${ACTIVE_BOOKING.replace(/booking_status/g, "b.booking_status")}
        AND b.organization_id = $1
      GROUP BY 1
      ORDER BY agreement_value DESC
      LIMIT ${MAX_ROWS}`,
    [await getOrganizationId()]
  );
  return rows.map((r) => ({
    manager: r.manager,
    bookings: r.bookings,
    agreementValue: num(r.agreement_value),
    ocrCollected: num(r.ocr_collected),
  }));
}

export async function getLeadsSummary(args: any, _scope: AiScope) {
  const bounds = monthBounds(args?.month);
  const params: any[] = [];
  let dateClause = "";
  if (bounds) {
    params.push(bounds.from, bounds.to);
    dateClause = `AND COALESCE(enquiry_date, created_at)::date >= $1::date
                  AND COALESCE(enquiry_date, created_at)::date <  $2::date`;
  }
  // Appended AFTER the optional date params so its index is whatever comes next,
  // whether or not a month filter was supplied.
  params.push(await getOrganizationId());
  const orgClause = `AND organization_id = $${params.length}`;

  const rows = await query<any>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(is_lost_lead,false))::int      AS lost,
            COUNT(*) FILTER (WHERE status = 'Closing')::int                AS closing,
            COUNT(DISTINCT source)::int                                    AS distinct_sources
       FROM walkin_enquiries
      WHERE 1=1 ${dateClause} ${orgClause}`,
    params
  );
  const bySource = await query<any>(
    `SELECT COALESCE(NULLIF(TRIM(source),''),'Unknown') AS source, COUNT(*)::int AS leads
       FROM walkin_enquiries
      WHERE 1=1 ${dateClause} ${orgClause}
      GROUP BY 1 ORDER BY leads DESC LIMIT ${MAX_ROWS}`,
    params
  );
  return { period: bounds ? args.month : "all time", ...rows[0], bySource };
}

/* ─────────────────────────── inventory ─────────────────────────── */

export async function getInventorySummary(_args: any, _scope: AiScope) {
  // inventory_units is the real inventory master; the previous version counted
  // booking rows by a non-existent `prop_type` column and called that inventory.
  const rows = await query<any>(
    `SELECT COALESCE(NULLIF(TRIM(project_name),''),'Unknown') AS project,
            COALESCE(NULLIF(TRIM(unit_type),''),'Unknown')    AS unit_type,
            COALESCE(NULLIF(TRIM(status),''),'unknown')       AS status,
            COUNT(*)::int                                     AS units
       FROM inventory_units
      WHERE deleted_at IS NULL
      GROUP BY 1,2,3
      ORDER BY project, unit_type, status`
  );
  const totals = await query<any>(
    `SELECT COALESCE(NULLIF(TRIM(status),''),'unknown') AS status, COUNT(*)::int AS units
       FROM inventory_units WHERE deleted_at IS NULL GROUP BY 1 ORDER BY units DESC`
  );
  return { byProject: rows.slice(0, MAX_ROWS), totalsByStatus: totals };
}

/* ─────────────────────────── registration ─────────────────────────── */

export async function getRegistrationSummary(_args: any, _scope: AiScope) {
  // Same denormalization trap as the money columns: booking_registration_details
  // is the populated table, booking_applications only mirrors it.
  const rows = await query<any>(
    `SELECT b.primary_name, b.flat_number,
            COALESCE(NULLIF(TRIM(COALESCE(r.registration_status, b.registration_status)),''),'Pending')
              AS registration_status,
            COALESCE(r.expected_registration_date, b.expected_registration_date) AS expected_registration_date,
            COALESCE(r.actual_registration_date,   b.actual_registration_date)   AS actual_registration_date
       FROM booking_applications b
       LEFT JOIN booking_registration_details r ON r.booking_id = b.id
      WHERE ${ACTIVE_BOOKING.replace(/booking_status/g, "b.booking_status")}
      ORDER BY expected_registration_date NULLS LAST
      LIMIT 200`
  );
  const done = rows.filter((r) => /complete|registered|done/i.test(r.registration_status));
  const pending = rows.filter((r) => !/complete|registered|done/i.test(r.registration_status));
  return {
    completed: done.length,
    pending: pending.length,
    pendingList: pending.slice(0, MAX_ROWS).map((r) => ({
      customer: r.primary_name,
      flat: r.flat_number,
      status: r.registration_status,
      expected: r.expected_registration_date,
    })),
    truncated: pending.length > MAX_ROWS ? pending.length - MAX_ROWS : 0,
  };
}

/* ─────────────────── unstructured retrieval (RAG) ─────────────────── */

export async function searchKnowledgeBase(args: any, _scope: AiScope) {
  const q = String(args?.q ?? "").trim().slice(0, 200);
  if (q.length < 3) return { matches: [], note: "Search term too short." };

  // Trigram similarity over follow-up text. pg_trgm rather than embeddings: the
  // `vector` extension is unavailable on this server, and at this corpus size
  // trigram ranking is faster and costs nothing per query. The signature is the
  // seam — swapping in a vector backend changes this function only.
  //
  // `q` is bound, never interpolated; a search term cannot become SQL.
  //
  // ILIKE OR trigram, not trigram alone. The `%` operator compares similarity
  // across the WHOLE string, so a short phrase inside a long note scores far
  // below the 0.3 default threshold — searching "loan" over real follow-ups
  // returned nothing at all. Substring matching catches those, while
  // word_similarity still ranks fuzzy and misspelled hits.
  const rows = await query<any>(
    `SELECT f.id, f.lead_id, f.message, f.created_by_name, f.created_at,
            w.name AS lead_name,
            GREATEST(
              word_similarity($1, f.message),
              CASE WHEN f.message ILIKE '%' || $1 || '%' THEN 1.0 ELSE 0 END
            ) AS score
       FROM follow_ups f
       LEFT JOIN walkin_enquiries w
         ON w.id = f.lead_id AND w.organization_id = f.organization_id
      -- The two search branches are PARENTHESISED before the tenant filter is
      -- applied. Written flat, SQL binds A OR B AND org as A OR (B AND org),
      -- and the ILIKE branch would then return every organization's follow-ups.
      WHERE (f.message ILIKE '%' || $1 || '%'
             OR word_similarity($1, f.message) > 0.5)
        AND f.organization_id = $3
      ORDER BY score DESC, f.created_at DESC
      LIMIT $2`,
    [q, MAX_ROWS, await getOrganizationId()]
  );

  return {
    query: q,
    matches: rows.map((r) => ({
      leadId: r.lead_id,
      lead: r.lead_name,
      note: String(r.message ?? "").slice(0, 500),
      author: r.created_by_name,
      at: r.created_at,
      score: Number(r.score?.toFixed?.(3) ?? 0),
    })),
    note: rows.length === 0 ? "No follow-up notes matched." : undefined,
  };
}

/* ─────────────────────────── registry ─────────────────────────── */

export interface AdminToolEntry {
  /** Audit label — which CRM module this reads, recorded in ai_audit_logs. */
  module: string;
  handler: (args: any, scope: AiScope) => Promise<unknown>;
}

export const adminToolRegistry: Record<string, AdminToolEntry> = {
  getRevenueSummary: { module: "revenue", handler: getRevenueSummary },
  getLoanSummary: { module: "loans", handler: getLoanSummary },
  getPendingDisbursements: { module: "loans", handler: getPendingDisbursements },
  getSalesManagerPerformance: { module: "performance", handler: getSalesManagerPerformance },
  getLeadsSummary: { module: "leads", handler: getLeadsSummary },
  getInventorySummary: { module: "inventory", handler: getInventorySummary },
  getRegistrationSummary: { module: "registration", handler: getRegistrationSummary },
  searchKnowledgeBase: { module: "follow-ups", handler: searchKnowledgeBase },
};
