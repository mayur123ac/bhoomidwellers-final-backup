// app/api/booking-applications/[id]/receipts/route.ts
// Customer receipts against a booking — token, booking amount, OCR instalments,
// cash component. Append-only: every receipt is a CREDIT row on financial_ledger
// scoped to the booking's financial_accounts row. Nothing here ever overwrites an
// aggregate, so customer_ledger_view and booking_total_cost_view stay authoritative
// and the reversal chain remains intact.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { assertParentOrganization } from "@/lib/tenantGuard";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Same gate as the milestones and TDS routes — recording money in is not a
// sales-manager action.
function isAllowedRole(role: string) {
    const clean = (role || "").trim().toLowerCase();
    return clean === "admin" || clean === "site_head" || clean === "site head";
}

const RECEIPT_TYPES = ["token", "booking_amount", "ocr", "cash_component"];

const num = (v: any) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(String(v).replace(/[₹,\s]/g, ""));
    return isNaN(n) ? null : n;
};

// ─── GET — customer receipts for a booking ────────────────────────────────────
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

        const rows = await query(
            `SELECT fl.id, fl.transaction_type, fl.amount, fl.transaction_date,
              fl.payment_mode, fl.reference_no, fl.remarks, fl.status, fl.created_by, fl.created_at
       FROM financial_ledger fl
       JOIN financial_accounts fa ON fa.id = fl.account_id
       WHERE fa.booking_id = $1
         AND fl.transaction_direction = 'CREDIT'
         AND fl.received_from = 'Customer'
       ORDER BY fl.transaction_date ASC NULLS LAST, fl.created_at ASC`,
            [Number(id)],
        );
        return NextResponse.json({ success: true, data: rows }, { status: 200 });
    } catch (err: any) {
        console.error("[GET /api/booking-applications/[id]/receipts]", err);
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
    }
}

// ─── POST — record a customer receipt ─────────────────────────────────────────
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

        const body = await req.json();
        const {
            transaction_type, amount, transaction_date,
            payment_mode, reference_no, remarks, milestone_id,
            user_name, user_role,
        } = body;

        if (!user_name || !user_role) {
            return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
        }
        if (!isAllowedRole(user_role)) {
            return NextResponse.json(
                { success: false, message: "Only Admin and Site Head can record receipts." },
                { status: 403 },
            );
        }

        const type = String(transaction_type || "ocr").trim().toLowerCase();
        if (!RECEIPT_TYPES.includes(type)) {
            return NextResponse.json(
                { success: false, message: `transaction_type must be one of: ${RECEIPT_TYPES.join(", ")}` },
                { status: 400 },
            );
        }

        const cleanAmount = num(amount);
        if (!cleanAmount || cleanAmount <= 0) {
            return NextResponse.json(
                { success: false, message: "amount is required and must be greater than zero." },
                { status: 400 },
            );
        }

        // Cash basis: an undated receipt is not collected money. Rejecting it here is
        // what keeps "OCR received" from drifting above what has actually arrived.
        if (!transaction_date) {
            return NextResponse.json(
                { success: false, message: "transaction_date is required — a receipt without a date is not yet collected." },
                { status: 400 },
            );
        }

        const bookingRes = await query<{ id: number }>(
            // MT-06: ownership gate for the receipt write path.
            `SELECT id FROM booking_applications WHERE id = $1 AND organization_id = $2`,
            [Number(id), await getOrganizationId()],
        );
        if (!bookingRes.length) {
            return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
        }

        const saved = await transaction(async (client) => {
            // MT-05: resolved once per transaction. The booking id comes from the
            // URL, so the parent's ownership is checked rather than assumed —
            // otherwise a caller could hang a receipt off another tenant's booking.
            const orgId = await getOrganizationId(client);
            await assertParentOrganization(client, "booking_applications", Number(id), orgId);
            // One financial account per booking; create it on first receipt so this
            // route works for bookings made before the ledger existed.
            const accountRes = await client.query(
                `SELECT id FROM financial_accounts WHERE booking_id = $1 LIMIT 1`,
                [Number(id)],
            );
            let accountId = accountRes.rows[0]?.id;
            if (!accountId) {
                const created = await client.query(
                    // PRE-EXISTING BUG, found by the MT-05 PREPARE harness:
                    // financial_accounts has no created_by column, so this
                    // statement has always been invalid and would 500 on the
                    // first receipt for a booking with no account yet. Column
                    // removed so the statement matches the schema and the two
                    // sibling inserts in booking-applications/{route,[id]}.
                    `INSERT INTO financial_accounts (booking_id, organization_id) VALUES ($1, $2) RETURNING id`,
                    [Number(id), orgId],
                );
                accountId = created.rows[0].id;
            }

            const ins = await client.query(
                `INSERT INTO financial_ledger
           (account_id, transaction_type, transaction_direction, amount, transaction_date,
            status, received_from, payment_mode, reference_no, remarks, milestone_id, created_by,
            organization_id)
         VALUES ($1, $2, 'CREDIT', $3, $4, 'Received', 'Customer', $5, $6, $7, $8, $9, $10)
         RETURNING *`,
                [
                    accountId, type, cleanAmount, transaction_date,
                    payment_mode || null, reference_no || null, remarks || null,
                    milestone_id ? Number(milestone_id) : null, user_name,
                    orgId,
                ],
            );

            // Keep the milestone's paid_amount in step when the receipt is tagged to one.
            if (milestone_id) {
                await client.query(
                    `UPDATE booking_payment_milestones
             SET paid_amount = COALESCE(paid_amount, 0) + $1,
                 status = CASE WHEN COALESCE(paid_amount, 0) + $1 >= demand_amount THEN 'Paid' ELSE 'Partial' END,
                 updated_at = NOW()
           WHERE id = $2 AND booking_id = $3`,
                    [cleanAmount, Number(milestone_id), Number(id)],
                );
            }

            await client.query(
                `INSERT INTO booking_history (booking_id, updated_by, user_role, changed_fields, organization_id)
         VALUES ($1, $2, $3, $4, $5)`,
                [
                    Number(id), user_name, user_role,
                    JSON.stringify({ receipt: { type, amount: cleanAmount, transaction_date, payment_mode: payment_mode || null } }),
                    orgId,
                ],
            );

            return ins.rows[0];
        });

        return NextResponse.json({ success: true, data: saved }, { status: 201 });
    } catch (err: any) {
        console.error("[POST /api/booking-applications/[id]/receipts]", err);
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
    }
}