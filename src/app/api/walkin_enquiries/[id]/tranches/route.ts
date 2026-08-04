import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveLatestBookingId, seedPddChecklist } from "@/lib/pdd";
import { getServerSession } from "@/lib/serverAuth";
import {
  buildFinancialSnapshot,
  BookingNotFoundError,
  NoActiveBookingForLeadError,
  fmtINR,
} from "@/lib/buildFinancialSnapshot";
import { computeFinancialObligation } from "@/lib/financialObligationEngine";

export const dynamic = "force-dynamic";

/**
 * Roles permitted to record a disbursement tranche.
 *
 * Must stay in step with `canManageDisbursement` in components/LoanDealForm.tsx —
 * if the two lists diverge the button renders and the POST then 403s, which reads
 * as a broken feature rather than a permission.
 */
const TRANCHE_ROLES = ["sales manager", "admin", "site head"];

/** Matches middleware.ts: lowercase, trimmed, underscores normalised to spaces. */
const normalize = (r: unknown) =>
  String(r ?? "").trim().toLowerCase().replace(/_/g, " ");

// ─── GET — list tranches for a lead ───────────────────────────────────────
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    try {
        const result = await query(
            `SELECT * FROM disbursement_tranches WHERE lead_id = $1 ORDER BY created_at ASC`,
            [Number(id)]
        );
        return NextResponse.json({ success: true, tranches: result }, { status: 200 });
    } catch (err: any) {
        console.error("[GET /api/walkin_enquiries/[id]/tranches]", err);
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
    }
}

// ─── POST — record a new disbursement tranche ────────────────────────────
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    try {
        const body = await req.json();
        const { amount, status, receiving_date, bank_reference_no, remarks, sanction_amount, user_name, user_role } = body;

        // The signed-in session is the authority, not body.user_role. That field
        // is client-supplied, so the previous check could be satisfied by anyone
        // POSTing `user_role: "admin"` — it gated the UI, not the endpoint.
        // body.user_role is still accepted below, but only as a fallback label for
        // the audit columns.
        const session = await getServerSession();
        if (!session?.role) {
            return NextResponse.json(
                { success: false, message: "Not signed in." },
                { status: 401 }
            );
        }

        const cleanRole = normalize(session.role);
        if (!TRANCHE_ROLES.includes(cleanRole)) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Only Sales Managers, Site Heads and Admins can add disbursement tranches.",
                },
                { status: 403 }
            );
        }

        const cleanAmount = Number(String(amount || "").replace(/,/g, ""));
        if (!cleanAmount || cleanAmount <= 0) {
            return NextResponse.json(
                { success: false, message: "Disbursement amount is required and must be greater than zero." },
                { status: 400 }
            );
        }

        // "Received" is the legacy label for what's now called "Completed" —
        // old tranches saved before the rename must still count as disbursed.
        const currentTotalRes = await query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM disbursement_tranches WHERE lead_id = $1 AND LOWER(status) IN ('completed', 'received')`,
            [Number(id)]
        );
        const currentTotal = Number(currentTotalRes[0]?.total || 0);
        const remaining = Number(sanction_amount || 0) - currentTotal;
        if (cleanAmount > remaining && remaining > 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Tranche amount (₹${cleanAmount.toLocaleString("en-IN")}) exceeds remaining disbursement (₹${remaining.toLocaleString("en-IN")}).`,
                },
                { status: 400 }
            );
        }

        // ── FOE gates ────────────────────────────────────────────────────────
        // Phase 2. Validation only: nothing below this block changed. A booking
        // is required because every ceiling is derived from agreement value and
        // customer contribution, which live on the booking, not the lead.
        // The lead→booking lookup lives in buildFinancialSnapshot's leadId form,
        // so this route no longer carries its own copy of it.
        let obligation;
        try {
            const snapshot = await buildFinancialSnapshot(
                body.booking_id ? { bookingId: Number(body.booking_id) } : { leadId: Number(id) }
            );
            obligation = computeFinancialObligation(snapshot);
        } catch (e: any) {
            if (e instanceof NoActiveBookingForLeadError) {
                return NextResponse.json(
                    { success: false, error: "NO_ACTIVE_BOOKING", message: e.message },
                    { status: 404 }
                );
            }
            if (e instanceof BookingNotFoundError) {
                return NextResponse.json(
                    { success: false, error: "BOOKING_NOT_FOUND", message: e.message },
                    { status: 404 }
                );
            }
            throw e;
        }

        // Gate 1 — the sanction itself breaches its ceiling. Correct that before
        // any more bank money moves.
        if (obligation.loanOverLimit) {
            return NextResponse.json(
                {
                    success: false,
                    error: "LOAN_EXCEEDS_CEILING",
                    message: `Loan sanction of ₹${fmtINR(obligation.sanctionedAmount)} exceeds ceiling of ₹${fmtINR(obligation.maxAllowedLoan)}. Reduce sanction or increase customer contribution before adding disbursements.`,
                    maxAllowedLoan: obligation.maxAllowedLoan,
                    sanctionedAmount: obligation.sanctionedAmount,
                    obligation,
                },
                { status: 422 }
            );
        }

        // Gate 2 — no room left at all.
        if (!obligation.canAddDisbursementTranche) {
            return NextResponse.json(
                {
                    success: false,
                    error: "TRANCHE_EXCEEDS_LIMIT",
                    message: `Total disbursed ₹${fmtINR(obligation.disbursedAmount)} already at or above limit. Max allowed: ₹${fmtINR(obligation.maxAllowedLoan)}`,
                    maxAllowedLoan: obligation.maxAllowedLoan,
                    disbursedAmount: obligation.disbursedAmount,
                    obligation,
                },
                { status: 422 }
            );
        }

        // Gate 3 — this particular tranche would push the total past the ceiling.
        const newTotal = obligation.disbursedAmount + cleanAmount;
        if (newTotal > obligation.maxAllowedLoan) {
            return NextResponse.json(
                {
                    success: false,
                    error: "TRANCHE_WOULD_EXCEED",
                    message: `This tranche of ₹${fmtINR(cleanAmount)} would bring total disbursed to ₹${fmtINR(newTotal)}, exceeding ceiling of ₹${fmtINR(obligation.maxAllowedLoan)}.`,
                    maxTrancheAllowed: obligation.maxAllowedLoan - obligation.disbursedAmount,
                    obligation,
                },
                { status: 422 }
            );
        }

        // C3: resolve the booking this disbursement belongs to and record it
        // alongside lead_id. Client may pass booking_id explicitly; otherwise we
        // attach to the lead's latest booking. lead_id is still written for
        // backward compatibility with older reads.
        const bookingId = body.booking_id ? Number(body.booking_id) : await resolveLatestBookingId(Number(id));

        // Insert the tranche
        const trancheRes = await query(
            `INSERT INTO disbursement_tranches
         (lead_id, booking_id, amount, status, receiving_date, bank_reference_no, remarks, added_by_name, added_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
            // added_by_* come from the session first: the audit trail should record
            // who actually performed the write, not what the caller claimed to be.
            // The body values remain as a fallback for a session missing a name.
            [Number(id), bookingId, cleanAmount, status || "Pending", receiving_date || null, bank_reference_no || null, remarks || null, session.name || user_name || null, session.role || user_role || null]
        );

        // Compute new total (completed-equivalent tranches only)
        const sumRes = await query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM disbursement_tranches WHERE lead_id = $1 AND LOWER(status) IN ('completed', 'received')`,
            [Number(id)]
        );
        const totalDisbursed = Number(sumRes[0]?.total || 0);

        const tranche = trancheRes[0];

        // C4: once total disbursed reaches the sanctioned amount, the loan is fully
        // disbursed — auto-seed the standard PDD checklist (idempotent) so the
        // 30-day document-submission window starts tracking immediately.
        let pddSeeded = 0;
        const sanctionTotal = Number(String(sanction_amount ?? "").replace(/,/g, "")) || 0;
        if (bookingId && sanctionTotal > 0 && totalDisbursed >= sanctionTotal) {
            try {
                const selApp = await query<{ id: number }>(
                    `SELECT id FROM loan_applications WHERE booking_id = $1 AND is_selected = true LIMIT 1`,
                    [bookingId]
                );
                pddSeeded = await seedPddChecklist(bookingId, selApp[0]?.id ?? null, receiving_date || null);
            } catch (e: any) {
                console.warn("[tranches] PDD auto-seed skipped:", e?.message);
            }
        }

        return NextResponse.json({ success: true, tranche, totalDisbursed, pddSeeded }, { status: 200 });
    } catch (err: any) {
        console.error("[POST /api/walkin_enquiries/[id]/tranches]", err);
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
    }
}