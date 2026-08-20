// api/cp-commissions/by-booking/[bookingId]/route.ts
// Lookup by BOOKING id. Deliberately nested under /by-booking rather than sharing
// the /cp-commissions/[id] segment: Next.js forbids sibling dynamic segments with
// different slug names, and more importantly a path where the id sometimes means
// a booking and sometimes a commission is a data-integrity accident waiting to
// happen. /cp-commissions/[id] is always the commission id.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// A booking can now hold several reversed commissions plus at most one active one.
//
// Resolution order: the active row wins. If every row is reversed, we return the
// most recent one with is_active:false rather than 404 — a 404 would claim the
// booking has no commission history, which is false and leaves a caller unable to
// show "reversed on <date> because <reason>, needs recomputing". The flag is what
// keeps that from being mistaken for a payable amount, so callers MUST branch on
// is_active before treating net_payable_amount as owed.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  const { bookingId } = await params;
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const rows = await query(
      `SELECT c.*, cp.name AS channel_partner_name, cp.status AS channel_partner_status,
              b.booking_number
         FROM cp_commissions c
         JOIN channel_partners cp
           ON cp.id = c.channel_partner_id AND cp.organization_id = c.organization_id
         LEFT JOIN booking_applications b
           ON b.id = c.booking_id AND b.organization_id = c.organization_id
        WHERE c.booking_id = $1 AND c.organization_id = $2
        ORDER BY (c.status <> 'reversed') DESC, c.id DESC`,
      [Number(bookingId), await getOrganizationId()]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: `No commission found for booking ${bookingId}.` },
        { status: 404 }
      );
    }

    const row: any = rows[0];
    const isActive = row.status !== "reversed";

    return NextResponse.json(
      {
        success: true,
        data: { ...row, is_active: isActive },
        is_active: isActive,
        reversed_count: rows.filter((r: any) => r.status === "reversed").length,
        total_count: rows.length,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/cp-commissions/by-booking/[bookingId]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
