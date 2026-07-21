// app/api/booking-applications/[id]/tds/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAllowedRole(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return clean === "admin" || clean === "site_head" || clean === "site head";
}

// Indian FY runs April–March; TDS quarters follow the same year.
function computeFinancialYear(dateStr?: string | null) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  let fyStartYear: number;
  let quarter: string;
  if (month >= 4) {
    fyStartYear = year;
    quarter = month <= 6 ? "Q1" : month <= 9 ? "Q2" : "Q3";
  } else {
    fyStartYear = year - 1;
    quarter = "Q4";
  }
  const financial_year = `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
  return { financial_year, quarter };
}

// ─── GET — list TDS records for a booking ─────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rows = await query(
      `SELECT * FROM booking_tds_records WHERE booking_id = $1 ORDER BY created_at ASC`,
      [Number(id)]
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]/tds]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — record a TDS deduction against a payment ──────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const {
      payment_id, tds_amount, tds_rate, form_26qb_filed, form_26qb_date,
      acknowledgement_no, buyer_pan, seller_pan, user_name, user_role,
    } = body;

    if (!user_name || !user_role) {
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    }
    if (!isAllowedRole(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin and Site Head can record TDS." }, { status: 403 });
    }

    const cleanAmount = Number(tds_amount);
    if (!cleanAmount || cleanAmount <= 0) {
      return NextResponse.json({ success: false, message: "tds_amount is required and must be greater than zero." }, { status: 400 });
    }

    const bookingRes = await query(`SELECT id FROM booking_applications WHERE id = $1`, [Number(id)]);
    if (!bookingRes.length) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    const { financial_year, quarter } = computeFinancialYear(form_26qb_date);

    const rows = await query(
      `INSERT INTO booking_tds_records
         (booking_id, payment_id, tds_amount, tds_rate, form_26qb_filed, form_26qb_date, acknowledgement_no, financial_year, quarter, buyer_pan, seller_pan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        Number(id), payment_id || null, cleanAmount, tds_rate != null ? Number(tds_rate) : 1,
        !!form_26qb_filed, form_26qb_date || null, acknowledgement_no || null,
        financial_year, quarter, buyer_pan || null, seller_pan || null,
      ]
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/booking-applications/[id]/tds]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── PUT — edit an existing TDS record ────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const {
      record_id, tds_amount, tds_rate, form_26qb_filed, form_26qb_date,
      acknowledgement_no, buyer_pan, seller_pan, user_name, user_role,
    } = body;

    if (!user_name || !user_role) {
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    }
    if (!isAllowedRole(user_role)) {
      return NextResponse.json({ success: false, message: "Only Admin and Site Head can edit TDS." }, { status: 403 });
    }
    if (!record_id) {
      return NextResponse.json({ success: false, message: "record_id is required" }, { status: 400 });
    }

    const cleanAmount = Number(tds_amount);
    if (!cleanAmount || cleanAmount <= 0) {
      return NextResponse.json({ success: false, message: "tds_amount is required and must be greater than zero." }, { status: 400 });
    }

    const { financial_year, quarter } = computeFinancialYear(form_26qb_date);

    const rows = await query(
      `UPDATE booking_tds_records SET
         tds_amount = $1, tds_rate = $2, form_26qb_filed = $3, form_26qb_date = $4,
         acknowledgement_no = $5, financial_year = $6, quarter = $7, buyer_pan = $8, seller_pan = $9
       WHERE id = $10 AND booking_id = $11
       RETURNING *`,
      [
        cleanAmount, tds_rate != null ? Number(tds_rate) : 1, !!form_26qb_filed, form_26qb_date || null,
        acknowledgement_no || null, financial_year, quarter, buyer_pan || null, seller_pan || null,
        Number(record_id), Number(id),
      ]
    );

    if (!rows.length) {
      return NextResponse.json({ success: false, message: "TDS record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[PUT /api/booking-applications/[id]/tds]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
