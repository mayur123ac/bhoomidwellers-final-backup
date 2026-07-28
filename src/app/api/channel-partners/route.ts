// api/channel-partners/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Commission rates drive real payouts, so writes are gated server-side the same
// way disbursement tranches are — the UI hiding the nav entry is not a control,
// it just hides the button.
const MANAGE_ROLES = ["admin", "sales manager", "sales_manager"];
export function canManagePartners(role: any): boolean {
  return MANAGE_ROLES.includes((role || "").toString().trim().toLowerCase());
}

// ─── GET — list partners ──────────────────────────────────────────────────
// Filters: status, needs_rate=true (partners with no negotiated rate yet — the
// working queue for the current data gap, where most partners were discovered
// from lead intake and have never had a rate captured).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const needsRate = searchParams.get("needs_rate");

    const where: string[] = [];
    const params: any[] = [];

    if (status) {
      params.push(status);
      where.push(`cp.status = $${params.length}`);
    }
    if (needsRate === "true") {
      where.push(`cp.default_commission_rate IS NULL`);
    }

    const rows = await query(
      `SELECT cp.*,
              (SELECT COUNT(*) FROM walkin_enquiries w WHERE w.channel_partner_id = cp.id) AS lead_count,
              (SELECT COUNT(*) FROM booking_applications b WHERE b.sourced_by_channel_partner_id = cp.id) AS booking_count
         FROM channel_partners cp
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY cp.name ASC`,
      params
    );

    return NextResponse.json({ success: true, data: rows, count: rows.length }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/channel-partners]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create a partner manually ─────────────────────────────────────
// default_commission_rate is optional: a partner can exist before their
// commercial terms are agreed. computeCPCommission rejects until it is set.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = (body.name || "").toString().trim();
    const createdBy = (body.created_by || body.user_name || "system").toString();

    if (!canManagePartners(body.user_role)) {
      return NextResponse.json(
        { success: false, message: "Only Admins and Sales Managers can add channel partners.", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { success: false, message: "name is required." },
        { status: 400 }
      );
    }

    const rate = body.default_commission_rate;
    if (rate !== undefined && rate !== null && rate !== "") {
      const n = Number(rate);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        return NextResponse.json(
          { success: false, message: "default_commission_rate must be between 0 and 100." },
          { status: 400 }
        );
      }
    }

    const rows = await query(
      `INSERT INTO channel_partners
         (name, company_name, rera_registration_no, pan_number, phone, email,
          bank_account_details, default_commission_rate, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'active'), $10, $10)
       RETURNING *`,
      [
        name,
        body.company_name || null,
        body.rera_registration_no || null,
        body.pan_number || null,
        body.phone || null,
        body.email || null,
        body.bank_account_details ? JSON.stringify(body.bank_account_details) : null,
        rate === undefined || rate === null || rate === "" ? null : Number(rate),
        body.status || null,
        createdBy,
      ]
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/channel-partners]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
