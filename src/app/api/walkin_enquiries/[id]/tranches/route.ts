import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveLatestBookingId, seedPddChecklist } from "@/lib/pdd";

export const dynamic = "force-dynamic";

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

        const cleanRole = (user_role || "").trim().toLowerCase();
        if (cleanRole !== "sales manager" && cleanRole !== "admin") {
            return NextResponse.json(
                { success: false, message: "Only Sales Managers and Admins can add disbursement tranches." },
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
            [Number(id), bookingId, cleanAmount, status || "Pending", receiving_date || null, bank_reference_no || null, remarks || null, user_name || null, user_role || null]
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