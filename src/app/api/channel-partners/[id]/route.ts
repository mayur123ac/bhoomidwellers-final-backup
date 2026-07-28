// api/channel-partners/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canManagePartners } from "../route";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = [
  "name",
  "company_name",
  "rera_registration_no",
  "pan_number",
  "phone",
  "email",
  "bank_account_details",
  "default_commission_rate",
  "status",
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rows = await query(
      `SELECT cp.*,
              (SELECT COUNT(*) FROM walkin_enquiries w WHERE w.channel_partner_id = cp.id) AS lead_count,
              (SELECT COUNT(*) FROM booking_applications b WHERE b.sourced_by_channel_partner_id = cp.id) AS booking_count
         FROM channel_partners cp
        WHERE cp.id = $1`,
      [Number(id)]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/channel-partners/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── PATCH — update a partner, incl. setting the rate for the first time ──
// Existing commissions are NOT recalculated when the rate changes: each
// cp_commissions row stores the rate it was computed at, so historical accruals
// stay at the terms that applied when they were earned.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const updatedBy = (body.updated_by || body.user_name || "system").toString();

    if (!canManagePartners(body.user_role)) {
      return NextResponse.json(
        { success: false, message: "Only Admins and Sales Managers can edit channel partners.", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    if ("default_commission_rate" in body) {
      const raw = body.default_commission_rate;
      // Explicit null is allowed — it clears an incorrectly-entered rate and puts
      // the partner back in the "needs a rate" queue rather than leaving a wrong one.
      if (raw !== null && raw !== "") {
        const n = Number(raw);
        if (Number.isNaN(n) || n < 0 || n > 100) {
          return NextResponse.json(
            {
              success: false,
              message: "default_commission_rate must be a number between 0 and 100.",
              code: "INVALID_RATE",
            },
            { status: 400 }
          );
        }
      }
    }

    if ("status" in body && !["active", "inactive"].includes(body.status)) {
      return NextResponse.json(
        { success: false, message: "status must be 'active' or 'inactive'.", code: "INVALID_STATUS" },
        { status: 400 }
      );
    }

    const sets: string[] = [];
    const values: any[] = [];
    for (const field of EDITABLE_FIELDS) {
      if (!(field in body)) continue;
      let value = body[field];
      if (field === "bank_account_details" && value !== null && typeof value === "object") {
        value = JSON.stringify(value);
      }
      if (field === "default_commission_rate") {
        value = value === null || value === "" ? null : Number(value);
      }
      values.push(value === "" ? null : value);
      sets.push(`${field} = $${values.length}`);
    }

    if (sets.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Nothing to update. Editable fields: ${EDITABLE_FIELDS.join(", ")}.`,
          code: "NO_EDITABLE_FIELDS",
        },
        { status: 400 }
      );
    }

    values.push(updatedBy);
    sets.push(`updated_by = $${values.length}`);
    values.push(Number(id));

    const rows = await query(
      `UPDATE channel_partners SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[PATCH /api/channel-partners/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
