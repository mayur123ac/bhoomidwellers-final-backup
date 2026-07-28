// api/cp-commissions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { computeCPCommission, CPCommissionError } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

// ─── GET — list commissions, filterable ───────────────────────────────────
// Filters: channel_partner_id, status, date_from, date_to (on created_at).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const channelPartnerId = searchParams.get("channel_partner_id");
    const status = searchParams.get("status");
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    const where: string[] = [];
    const params: any[] = [];

    if (channelPartnerId) {
      params.push(Number(channelPartnerId));
      where.push(`c.channel_partner_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      where.push(`c.created_at >= $${params.length}::timestamp`);
    }
    if (dateTo) {
      // Exclusive upper bound on the day after, so a date-only `date_to` still
      // includes commissions created during that day.
      params.push(dateTo);
      where.push(`c.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const rows = await query(
      `SELECT c.*, cp.name AS channel_partner_name, b.booking_number
         FROM cp_commissions c
         JOIN channel_partners cp ON cp.id = c.channel_partner_id
         LEFT JOIN booking_applications b ON b.id = c.booking_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY c.created_at DESC, c.id DESC`,
      params
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/cp-commissions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — accrue the commission for a booking ───────────────────────────
// channel_partner_id is NOT accepted: attribution already lives on the booking
// (sourced_by_channel_partner_id), and letting a caller pass a different partner
// would allow the payee to be overridden at commission time.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Accepts both spellings: booking_id (Phase 2 callers) and bookingId (Phase 4 UI).
    const bookingId = Number(body.booking_id ?? body.bookingId);
    const createdBy = (body.created_by || body.user_name || "system").toString();

    if (!bookingId || Number.isNaN(bookingId)) {
      return NextResponse.json(
        { success: false, message: "booking_id is required." },
        { status: 400 }
      );
    }

    const source = body.source === "manual" ? "manual" : "auto";
    const rawOverride = body.overrideGross ?? body.override_gross;
    const hasOverride = rawOverride !== undefined && rawOverride !== null && String(rawOverride).trim() !== "";

    if (hasOverride && Number.isNaN(Number(rawOverride))) {
      return NextResponse.json(
        { success: false, message: "overrideGross must be a number.", code: "INVALID_OVERRIDE" },
        { status: 400 }
      );
    }
    if (hasOverride && Number(rawOverride) < 0) {
      return NextResponse.json(
        { success: false, message: "overrideGross cannot be negative.", code: "INVALID_OVERRIDE" },
        { status: 400 }
      );
    }

    const row = await transaction((client) =>
      computeCPCommission(client, bookingId, createdBy, {
        source,
        overrideGross: hasOverride ? Number(rawOverride) : undefined,
        overrideReason: (body.overrideReason ?? body.override_reason ?? "").toString(),
      })
    );
    return NextResponse.json({ success: true, data: row }, { status: 201 });
  } catch (err: any) {
    if (err instanceof CPCommissionError) {
      return NextResponse.json(
        { success: false, message: err.message, code: err.code },
        { status: err.status }
      );
    }
    console.error("[POST /api/cp-commissions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
