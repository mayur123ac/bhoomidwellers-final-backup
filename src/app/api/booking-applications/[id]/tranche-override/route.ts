// app/api/booking-applications/[id]/tranche-override/route.ts
//
// Phase 6 — the ONE audited way past a Financial Obligation Engine gate.
//
// Adding a disbursement tranche is the only financial action with no legitimate
// path once a loan breaches its ceiling: OCR can be corrected downward through
// the booking PUT, a sanction can be reduced through the loan-application PUT,
// but a genuine bank disbursement on a breached loan is simply refused. This
// route gives an admin a way through that leaves a permanent record of who
// decided what, and of the exact financial state they decided it against.
//
// It is NOT a general correction system. It overrides one gate, for one
// tranche, and it does not fix the underlying breach — the engine will still
// report the booking as Mismatch afterwards, which is correct: the numbers
// still contradict each other, a human just accepted that for this payment.
//
// Addressed by booking_id (the normal tranche route is addressed by lead_id and
// stays where it is, at /api/walkin_enquiries/[id]/tranches).

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { assertParentOrganization } from "@/lib/tenantGuard";
import { requireRoles } from "@/lib/serverAuth";
import {
  buildFinancialSnapshot,
  BookingNotFoundError,
  fmtINR,
} from "@/lib/buildFinancialSnapshot";
import { computeFinancialObligation } from "@/lib/financialObligationEngine";

export const dynamic = "force-dynamic";

/** 'superadmin' does not exist in this deployment (roles are admin / sales manager /
 *  site head / receptionist / sourcing manager) but is listed for forward
 *  compatibility; requireRoles normalizes case and underscores. */
const OVERRIDE_ROLES = ["admin", "superadmin"];

const MIN_REASON_LENGTH = 20;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Role first, before any DB read: a sales manager crafting this request by
    // hand must not even cause a query, let alone reach the gate logic.
    const gate = await requireRoles(OVERRIDE_ROLES);
    if (!gate.ok) return gate.response;

    const bookingId = Number(id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return NextResponse.json({ success: false, error: "Invalid booking id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(String(body.amount ?? "").replace(/[₹,\s]/g, "")) || 0;
    const reason = String(body.reason ?? "");
    const notes = body.notes ? String(body.notes) : null;
    const expectedDate = body.expected_date ? String(body.expected_date) : null;

    // Enforced HERE, not only in the modal. The frontend check is UX; this is
    // the one that decides whether an unexplained override can exist.
    if (reason.trim().length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          error: "REASON_TOO_SHORT",
          message: `Reason must be at least ${MIN_REASON_LENGTH} characters. Describe why this override is necessary.`,
        },
        { status: 400 }
      );
    }

    if (!(amount > 0)) {
      return NextResponse.json(
        { success: false, error: "INVALID_AMOUNT", message: "Tranche amount must be greater than zero." },
        { status: 400 }
      );
    }

    let snapshot;
    try {
      snapshot = await buildFinancialSnapshot({ bookingId });
    } catch (e: any) {
      if (e instanceof BookingNotFoundError) {
        return NextResponse.json({ success: false, error: "BOOKING_NOT_FOUND", message: e.message }, { status: 404 });
      }
      throw e;
    }
    const obligation = computeFinancialObligation(snapshot);

    // An override with nothing to override is a bypass of the audit trail by
    // another name — the caller should use the normal route so the standard
    // gates apply.
    const overriddenGates: string[] = [];
    if (obligation.loanOverLimit) overriddenGates.push("LOAN_EXCEEDS_CEILING");
    if (!obligation.canAddDisbursementTranche) overriddenGates.push("TRANCHE_EXCEEDS_LIMIT");
    if (obligation.disbursedAmount + amount > obligation.maxAllowedLoan) overriddenGates.push("TRANCHE_WOULD_EXCEED");

    const bookingRows = await query<{ lead_id: number | null }>(
      `SELECT lead_id FROM booking_applications WHERE id = $1`,
      [bookingId]
    );
    const leadId = bookingRows[0]?.lead_id ?? null;

    if (overriddenGates.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "OVERRIDE_NOT_NEEDED",
          message: "This tranche would not be blocked by the normal route. Use /api/walkin_enquiries/[leadId]/tranches instead.",
          leadId,
        },
        { status: 400 }
      );
    }

    // The ceiling is a policy limit and can be overridden. The sanction is what
    // the bank actually agreed to lend — no admin decision makes money exist
    // that was never sanctioned, so this one is refused even here.
    if (obligation.sanctionedAmount > 0 && obligation.disbursedAmount + amount > obligation.sanctionedAmount) {
      return NextResponse.json(
        {
          success: false,
          error: "EXCEEDS_SANCTION",
          message: `Override cannot approve disbursement above sanctioned amount. Reduce tranche or increase sanction first. Sanctioned ₹${fmtINR(obligation.sanctionedAmount)}, already disbursed ₹${fmtINR(obligation.disbursedAmount)}.`,
          sanctionedAmount: obligation.sanctionedAmount,
          alreadyDisbursed: obligation.disbursedAmount,
          maxTranche: obligation.sanctionedAmount - obligation.disbursedAmount,
          obligation,
        },
        { status: 422 }
      );
    }

    // The gate that was actually bypassed — NOT merely the first critical finding
    // on the booking. On a booking that also breaches its OCR ceiling, "first
    // critical" is OCR_EXCEEDS_ALLOCATABLE, which this override does not touch;
    // recording that would misstate what the admin approved. Ordered
    // loanOverLimit → tranche-blocked → would-exceed, so [0] is the primary
    // reason. Every other finding is preserved in obligation_snapshot.
    const gateCode = overriddenGates[0];

    const performedBy = gate.session.email || gate.session.name || String(gate.session._id ?? "unknown");

    const result = await transaction(async (client) => {
      // MT-05: bookingId comes from the URL, so the parent's ownership is
      // verified rather than assumed before anything is written under it.
      const orgId = await getOrganizationId(client);
      await assertParentOrganization(client, "booking_applications", bookingId, orgId);
      // Log FIRST. If the tranche were committed before its justification, a
      // failure in between would leave a disbursement nobody authorised on
      // record — the transaction makes both atomic, and this ordering makes the
      // invariant obvious to anyone reading it later.
      const adj = await client.query(
        `INSERT INTO financial_adjustments (
           booking_id, lead_id, adjustment_type,
           performed_by, performed_by_role, performed_at,
           gate_code, obligation_snapshot,
           reason, approved_amount, notes,
           organization_id
         ) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          bookingId, leadId, "TRANCHE_OVERRIDE",
          performedBy, gate.session.role,
          gateCode, JSON.stringify(obligation),
          reason.trim(), amount, notes,
          orgId,
        ]
      );
      const adjustmentId = adj.rows[0].id as number;

      // Same column shape as the INSERT in /api/walkin_enquiries/[id]/tranches.
      // That table has no `expected_date` or `created_by`: the date column is
      // receiving_date, and the actor is recorded in added_by_name/added_by_role.
      const tranche = await client.query(
        `INSERT INTO disbursement_tranches
           (lead_id, booking_id, amount, status, receiving_date, remarks, added_by_name, added_by_role, organization_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          leadId, bookingId, amount, "Scheduled", expectedDate,
          `Admin override #${adjustmentId}: ${reason.trim()}`,
          gate.session.name || performedBy, gate.session.role,
          orgId,
        ]
      );
      const trancheId = tranche.rows[0].id as number;

      await client.query(
        `UPDATE financial_adjustments SET resulting_tranche_id = $1 WHERE id = $2`,
        [trancheId, adjustmentId]
      );

      return { adjustmentId, trancheId };
    });

    return NextResponse.json(
      {
        success: true,
        adjustmentId: result.adjustmentId,
        trancheId: result.trancheId,
        overriddenGates,
        warning:
          "This disbursement was approved via admin override. The booking has active financial integrity issues that should be resolved. Run the audit script after correcting underlying figures.",
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/booking-applications/[id]/tranche-override]", err);
    return NextResponse.json({ success: false, error: "Internal error", message: err?.message }, { status: 500 });
  }
}
