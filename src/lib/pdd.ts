// lib/pdd.ts — Post-Disbursement Documents (PDD) checklist helpers.
// A bank requires original property documents submitted within a stipulated
// window after full disbursement; missing it triggers penalty interest. This is
// the single source of truth for the standard checklist and its seeding logic.
import { query } from "@/lib/db";

export const STANDARD_PDD_DOCS = [
  "Registered Sale Deed",
  "Society NOC / Share Certificate",
  "Property Tax Receipt",
  "Occupancy Certificate",
  "Original Payment Receipts",
];

// Default window (days) from full-disbursement date to PDD submission deadline.
export const PDD_DEFAULT_WINDOW_DAYS = 30;

function addDays(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

// Idempotent: seeds the standard checklist only if the booking has no PDD rows
// yet. Returns the number of rows inserted (0 if already seeded / no booking).
export async function seedPddChecklist(
  bookingId: number,
  loanApplicationId: number | null,
  baseDate?: string | null,
): Promise<number> {
  if (!bookingId) return 0;
  const existing = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM loan_pdd_tracking WHERE booking_id = $1`,
    [bookingId],
  );
  if (Number(existing[0]?.count) > 0) return 0;

  const base = baseDate ? new Date(baseDate) : new Date();
  const dueStr = addDays(isNaN(base.getTime()) ? new Date() : base, PDD_DEFAULT_WINDOW_DAYS);

  for (const doc of STANDARD_PDD_DOCS) {
    await query(
      `INSERT INTO loan_pdd_tracking (booking_id, loan_application_id, document_name, required_by_date)
       VALUES ($1, $2, $3, $4)`,
      [bookingId, loanApplicationId, doc, dueStr],
    );
  }
  return STANDARD_PDD_DOCS.length;
}

// Resolves the most recent booking for a lead (used to attach lead-scoped
// disbursement/PDD activity to the concrete booking once one exists).
export async function resolveLatestBookingId(leadId: number): Promise<number | null> {
  if (!leadId) return null;
  const rows = await query<{ id: number }>(
    `SELECT id FROM booking_applications WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leadId],
  );
  return rows[0]?.id ?? null;
}
