// api/cp-commissions/[id]/route.ts — [id] is always the cp_commissions id.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Fields a caller may set through this route. Everything else on the row is
// either derived money or audit state and must not be reachable here.
const EDITABLE_FIELDS = ["due_date", "status", "paid_date", "payment_reference"] as const;

// Derived money + audit columns. Named explicitly so a request that tries to
// "correct" a calculated amount is rejected loudly rather than ignored quietly —
// the DB CHECK would catch an inconsistent set, but a self-consistent bad set
// (e.g. all three rewritten together) would otherwise pass.
const PROTECTED_FIELDS = [
  "id",
  "booking_id",
  "channel_partner_id",
  "agreement_value",
  "commission_rate_percent",
  "gross_commission_amount",
  "tds_percent",
  "tds_amount",
  "net_payable_amount",
  "reversal_reason",
  "reversed_at",
  "created_by",
  "created_at",
  "updated_at",
];

const ALLOWED_STATUSES = ["due", "paid"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const rows = await query(
      `SELECT c.*, cp.name AS channel_partner_name, b.booking_number
         FROM cp_commissions c
         JOIN channel_partners cp ON cp.id = c.channel_partner_id
         LEFT JOIN booking_applications b ON b.id = c.booking_id
        WHERE c.id = $1`,
      [Number(id)]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: `Commission ${id} not found.` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/cp-commissions/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Commission edits drive real payouts.
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const updatedBy = (body.updated_by || body.user_name || "system").toString();

    const attemptedProtected = PROTECTED_FIELDS.filter((f) => f in body);
    if (attemptedProtected.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Calculated fields cannot be modified: ${attemptedProtected.join(", ")}. Reverse the commission and recompute instead.`,
          code: "PROTECTED_FIELD",
        },
        { status: 400 }
      );
    }

    if ("status" in body) {
      if (body.status === "reversed") {
        return NextResponse.json(
          {
            success: false,
            message: `Use POST /api/cp-commissions/${id}/reverse to reverse a commission — it requires a reason and stamps the audit trail.`,
            code: "USE_REVERSE_ENDPOINT",
          },
          { status: 400 }
        );
      }
      if (!ALLOWED_STATUSES.includes(body.status)) {
        return NextResponse.json(
          {
            success: false,
            message: `status must be one of: ${ALLOWED_STATUSES.join(", ")}.`,
            code: "INVALID_STATUS",
          },
          { status: 400 }
        );
      }
    }

    const sets: string[] = [];
    const values: any[] = [];
    for (const field of EDITABLE_FIELDS) {
      if (field in body) {
        values.push(body[field] === "" ? null : body[field]);
        sets.push(`${field} = $${values.length}`);
      }
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

    // A reversed commission is a closed record — reopening it by flipping status
    // to paid/due would erase the reversal without any audit trace.
    const rows = await query(
      `UPDATE cp_commissions
          SET ${sets.join(", ")}
        WHERE id = $${values.length} AND status <> 'reversed'
        RETURNING *`,
      values
    );

    if (rows.length === 0) {
      const exists = await query(`SELECT status FROM cp_commissions WHERE id = $1`, [Number(id)]);
      if (exists.length === 0) {
        return NextResponse.json(
          { success: false, message: `Commission ${id} not found.` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        {
          success: false,
          message: `Commission ${id} is reversed and can no longer be edited.`,
          code: "IS_REVERSED",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[PATCH /api/cp-commissions/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
