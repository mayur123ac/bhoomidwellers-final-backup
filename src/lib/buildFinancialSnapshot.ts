/* ══════════════════════════════════════════════════════════════════════════
   buildFinancialSnapshot.ts — the one place that reads a booking's financial
   position out of the database and shapes it for the Financial Obligation
   Engine (see financialObligationEngine.ts).

   Every FOE caller goes through here. If a route builds its own snapshot, the
   engine stops being a single source of truth and becomes a fifth opinion.

   ── Where each figure comes from, and why ───────────────────────────────────
   The schema keeps a booking's money in five places, so this file is mostly a
   map of that sprawl:

     agreement / token / booking amount / OCR / cash / GST / legal /
     maintenance / possession   → booking_applications
     stamp duty + registration  → booking_registration_details, falling back to
                                  the legacy booking_financials.sdr_amount —
                                  the same COALESCE chain booking_total_cost_view
                                  uses, so the two never disagree
     custom charges             → booking_custom_charges (the table, as the view
                                  reads it — not booking_applications.custom_charges)
     sanction                   → loan_applications, then booking_loan_details,
                                  then booking_applications (see below)
     disbursement               → disbursement_tranches (see below)

   ── DISBURSED: disbursement_tranches is AUTHORITATIVE ───────────────────────
   Do NOT "unify" this back to financial_ledger where received_from = 'Bank'.
   booking_total_cost_view.total_loan_disbursed takes the ledger path, and the
   two sources disagree in live data. The FOE sits UPSTREAM of that view and
   must not inherit its ambiguity: tranches are what the Loan & Deal screen
   writes and what operators actually reconcile against.

   Tranches are keyed by lead_id in practice — booking_id was added later and is
   populated on only a minority of rows (3 of 14 locally). Summing on booking_id
   alone would report ₹0 disbursed for a fully disbursed loan, which would make
   the engine *permit* more disbursement: the exact inversion of the gate this
   exists to enforce. Hence the booking_id-or-lead_id match below.

   'Received' is the legacy label for 'Completed'; both count, matching
   isTrancheCompleted() in components/LoanDealForm.tsx.

   ── PER-CHARGE PAID amounts ─────────────────────────────────────────────────
   The intended source was financial_accounts.account_type ('GST', 'Stamp Duty',
   …). That column is NULL on every row in the database, so keying off it would
   silently report every charge as Pending forever. Real sources are used
   instead: booking_applications.gst_paid (a genuine numeric), and the
   Paid/Pending status flags on booking_registration_details. Legal and
   maintenance have no payment tracking anywhere in the schema, so they are left
   undefined — the engine then reports Pending, which is the honest answer.

   ── ORG SETTINGS ────────────────────────────────────────────────────────────
   There is no `organizations` table and no financial_calc_settings column
   anywhere (organization_settings holds shift/attendance keys only). The engine
   defaults are used and nothing is queried. Adding that column is a migration,
   not this file's job.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Pool, PoolClient } from "pg";
import { query } from "./db";
import type { FinancialSnapshot } from "./financialObligationEngine";

/** Rupee formatting for API error messages. Whole rupees — paise never appear in this system. */
export function fmtINR(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/**
 * Thrown when the booking id does not resolve. Routes translate this to a 404
 * rather than letting it surface as a 500 — a missing booking is a client
 * addressing error, not a server fault.
 */
export class BookingNotFoundError extends Error {
  constructor(bookingId: number) {
    super(`Booking not found: ${bookingId}`);
    this.name = "BookingNotFoundError";
  }
}

/**
 * Thrown when a lead has no live booking. Distinct from BookingNotFoundError
 * because the caller's addressing was valid — the lead exists, the booking that
 * would carry an agreement value does not — and routes report it differently.
 */
export class NoActiveBookingForLeadError extends Error {
  constructor(leadId: number) {
    super(`No active booking for lead: ${leadId}`);
    this.name = "NoActiveBookingForLeadError";
  }
}

/**
 * How a caller names the booking it wants. Routes are addressed inconsistently
 * — tranches by lead_id, everything else by booking_id — so the resolution
 * lives here once instead of being re-implemented per route.
 */
export type SnapshotTarget = { bookingId: number } | { leadId: number };

/** Existing convention across every money read in this codebase. */
const n = (v: unknown) => Number(v) || 0;

/**
 * Anything that can run a query: the shared pool helper (default), or a
 * PoolClient when the caller is inside a transaction and needs to see its own
 * uncommitted writes.
 */
type Executor = Pool | PoolClient;

const SNAPSHOT_SQL = `
  SELECT
    b.id,
    b.lead_id,
    b.agreement_value,
    b.consideration_value,
    -- booking_financials is authoritative for these three. Both tables carry the
    -- columns, and on live data the booking_applications copies are NULL while
    -- booking_financials holds the real figures — which is also why the booking
    -- PUT selects f.token_amount/f.ocr_amount/f.cash_component over b.*.
    -- Reading b.* here reported ₹0 collected for a booking that had taken
    -- ₹11,60,000, so every OCR ceiling silently passed.
    COALESCE(f.token_amount,   b.token_amount,   0) AS token_amount,
    COALESCE(f.ocr_amount,     b.ocr_amount,     0) AS ocr_amount,
    COALESCE(f.cash_component, b.cash_component, 0) AS cash_component,
    -- booking_amount exists only on booking_applications.
    b.booking_amount,
    b.gst_rate,
    b.gst_paid,
    b.legal_charges,
    b.maintenance_deposit,
    b.possession_charges,
    b.sanction_amount                                   AS booking_sanction_amount,
    COALESCE(r.stamp_duty_amount, f.sdr_amount, 0)      AS stamp_duty_amount,
    r.stamp_duty_status,
    COALESCE(r.registration_fee_amount, 0)              AS registration_fee_amount,
    r.registration_fee_status,
    COALESCE(l.sanction_amount, 0)                      AS loan_details_sanction,
    (SELECT COALESCE(SUM(cc.amount), 0)
       FROM booking_custom_charges cc
      WHERE cc.booking_id = b.id)                       AS custom_charges_total,
    -- Preferred sanction: the lender the buyer actually proceeds with
    -- (is_selected), else the most recent live application. Rejected and
    -- Withdrawn applications never fund anything and must not set the ceiling.
    (SELECT la.amount_sanctioned
       FROM loan_applications la
      WHERE la.booking_id = b.id
        AND la.status NOT IN ('Rejected', 'Withdrawn')
      ORDER BY la.is_selected DESC NULLS LAST, la.created_at DESC
      LIMIT 1)                                          AS lender_sanctioned,
    (SELECT COALESCE(SUM(t.amount), 0)
       FROM disbursement_tranches t
      WHERE (t.booking_id = b.id OR (t.booking_id IS NULL AND t.lead_id = b.lead_id))
        AND LOWER(t.status) IN ('completed', 'received')) AS disbursed_amount
  FROM booking_applications b
  LEFT JOIN booking_financials f            ON f.booking_id = b.id
  LEFT JOIN booking_registration_details r  ON r.booking_id = b.id
  LEFT JOIN booking_loan_details l          ON l.booking_id = b.id
  WHERE b.id = $1
`;

/**
 * Reads everything the engine needs for one booking, in a single round trip.
 *
 * @param target  `{ bookingId }`, `{ leadId }` (resolves to the lead's latest
 *                live booking), or a bare booking id for older call sites
 * @param client  optional transaction client; defaults to the shared pool
 */
export async function buildFinancialSnapshot(
  target: number | SnapshotTarget,
  client?: Executor
): Promise<FinancialSnapshot> {
  let bookingId: number;
  if (typeof target === "number") {
    bookingId = target;
  } else if ("bookingId" in target) {
    bookingId = target.bookingId;
  } else {
    const resolved = await resolveBookingIdForLead(target.leadId);
    if (!resolved) throw new NoActiveBookingForLeadError(target.leadId);
    bookingId = resolved;
  }

  const rows = client
    ? (await client.query(SNAPSHOT_SQL, [bookingId])).rows
    : await query<any>(SNAPSHOT_SQL, [bookingId]);

  const row = rows[0];
  if (!row) throw new BookingNotFoundError(bookingId);

  // Sanction precedence: the lender record wins because it is what the Loan &
  // Deal screen maintains per bank; booking_loan_details and the booking's own
  // column are legacy mirrors kept for bookings raised before the multi-lender
  // tracker existed. Without these fallbacks an older booking would report a
  // sanction of 0 and no ceiling breach could ever be detected.
  const sanctionedAmount =
    n(row.lender_sanctioned) || n(row.loan_details_sanction) || n(row.booking_sanction_amount);

  const stampDutyAmount = n(row.stamp_duty_amount);
  const registrationFee = n(row.registration_fee_amount);

  return {
    agreementValue: n(row.agreement_value),
    considerationValue: row.consideration_value == null ? undefined : n(row.consideration_value),

    tokenPaid: n(row.token_amount),
    bookingAmountPaid: n(row.booking_amount),
    additionalOCRPaid: n(row.ocr_amount),

    sanctionedAmount,
    disbursedAmount: n(row.disbursed_amount),

    gstPercent: n(row.gst_rate),
    stampDutyAmount,
    registrationFee,
    legalCharges: n(row.legal_charges),
    maintenanceDeposit: n(row.maintenance_deposit),
    customCharges: n(row.custom_charges_total),
    cashComponent: n(row.cash_component),
    possessionCharges: n(row.possession_charges),

    // Only these two have a real paid-to-date signal (see header).
    gstPaid: n(row.gst_paid),
    stampDutyPaid: String(row.stamp_duty_status || "").toLowerCase() === "paid" ? stampDutyAmount : 0,
    registrationFeePaid:
      String(row.registration_fee_status || "").toLowerCase() === "paid" ? registrationFee : 0,

    // Engine defaults: tokenIsPivot true, registrationFeeCap 30000.
  };
}

/**
 * The lead a booking belongs to. Route A is addressed by lead_id, so it needs
 * the mapping in the other direction from resolveLatestBookingId() in lib/pdd.ts.
 */
export async function resolveBookingIdForLead(leadId: number): Promise<number | null> {
  if (!leadId) return null;
  // Cancelled bookings must not gate new financial activity. booking_status is
  // the real column ('Confirmed' in live data); cancelled_at is set by the
  // cancellation flow.
  const rows = await query<{ id: number }>(
    `SELECT id FROM booking_applications
      WHERE lead_id = $1
        AND cancelled_at IS NULL
        AND LOWER(COALESCE(booking_status, '')) <> 'cancelled'
      ORDER BY created_at DESC
      LIMIT 1`,
    [leadId]
  );
  return rows[0]?.id ?? null;
}
