// api/channel-partners/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import {
  canViewPartners,
  canEditPartners,
  canDeletePartners,
  canSeePartnerCommercials,
} from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

/**
 * Fields any editing role may change. The office-visit profile columns
 * (office_address, owner_contact_person, gst_number) join the original set;
 * they are plain descriptive data with no commission consequence.
 */
const EDITABLE_FIELDS = [
  "name",
  "company_name",
  "rera_registration_no",
  "pan_number",
  "phone",
  "email",
  "office_address",
  "pin_code",
  "city",
  "owner_contact_person",
  "gst_number",
  "bank_account_details",
  "default_commission_rate",
  "status",
] as const;

/** Fields that only a role with commercial visibility may touch. */
const COMMERCIAL_FIELDS = new Set(["default_commission_rate", "bank_account_details", "status"]);

// Same cookie-derived gate the collection route uses — never body.user_role.
async function authorize(check: (role: any) => boolean) {
  const session = await getServerSession();
  if (!session?.role) {
    return { ok: false as const, res: NextResponse.json(
      { success: false, message: "Not signed in.", code: "UNAUTHORIZED" }, { status: 401 }) };
  }
  if (!check(session.role)) {
    return { ok: false as const, res: NextResponse.json(
      { success: false, message: "Your role cannot perform this action.", code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorize(canViewPartners);
  if (!auth.ok) return auth.res;

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

    let data: any = rows[0];
    if (!canSeePartnerCommercials(auth.session.role)) {
      const { default_commission_rate, bank_account_details, ...rest } = data;
      data = rest;
    }
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/channel-partners/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── PATCH / PUT — update a partner, incl. setting the rate for the first time ──
// Existing commissions are NOT recalculated when the rate changes: each
// cp_commissions row stores the rate it was computed at, so historical accruals
// stay at the terms that applied when they were earned.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorize(canEditPartners);
  if (!auth.ok) return auth.res;

  const { id } = await params;
  try {
    const body = await req.json();
    const updatedBy = (auth.session.name || "system").toString();
    const canSetCommercials = canSeePartnerCommercials(auth.session.role);

    if ("default_commission_rate" in body && canSetCommercials) {
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

    if ("name" in body && !(body.name || "").toString().trim()) {
      return NextResponse.json(
        { success: false, message: "name cannot be blank.", code: "INVALID_NAME" },
        { status: 400 }
      );
    }

    const sets: string[] = [];
    const values: any[] = [];
    for (const field of EDITABLE_FIELDS) {
      if (!(field in body)) continue;
      if (COMMERCIAL_FIELDS.has(field) && !canSetCommercials) continue;
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

/** PUT is accepted as an alias for PATCH; both apply a partial update. */
export const PUT = PATCH;

// ─── DELETE — admin only ───────────────────────────────────────────────────
// channel_partners.id is FK-referenced by walkin_enquiries, booking_applications
// and cp_commissions. Rather than letting Postgres raise a raw FK violation at a
// non-technical Admin, the references are counted first and the delete is refused
// with an explanation — deleting a partner who has accrued commission would
// orphan financial history, so "mark inactive" is the correct action there.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorize(canDeletePartners);
  if (!auth.ok) return auth.res;

  const { id } = await params;
  const cpId = Number(id);
  if (!Number.isInteger(cpId)) {
    return NextResponse.json({ success: false, message: "Invalid partner id." }, { status: 400 });
  }

  try {
    const [refs] = await query(
      `SELECT
         (SELECT COUNT(*) FROM walkin_enquiries    WHERE channel_partner_id = $1)            AS lead_count,
         (SELECT COUNT(*) FROM booking_applications WHERE sourced_by_channel_partner_id = $1) AS booking_count,
         (SELECT COUNT(*) FROM cp_commissions      WHERE channel_partner_id = $1)            AS commission_count,
         (SELECT name FROM channel_partners        WHERE id = $1)                            AS name`,
      [cpId]
    );

    if (!refs?.name) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }

    const leads = Number(refs.lead_count || 0);
    const bookings = Number(refs.booking_count || 0);
    const commissions = Number(refs.commission_count || 0);

    if (leads > 0 || bookings > 0 || commissions > 0) {
      const parts = [
        leads && `${leads} lead${leads === 1 ? "" : "s"}`,
        bookings && `${bookings} booking${bookings === 1 ? "" : "s"}`,
        commissions && `${commissions} commission record${commissions === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return NextResponse.json(
        {
          success: false,
          code: "HAS_REFERENCES",
          message: `"${refs.name}" is referenced by ${parts.join(", ")} and cannot be deleted. Mark them inactive instead — that stops new commission accruing without losing the history.`,
          references: { leads, bookings, commissions },
        },
        { status: 409 }
      );
    }

    await query(`DELETE FROM channel_partners WHERE id = $1`, [cpId]);
    return NextResponse.json(
      { success: true, message: `"${refs.name}" deleted.` },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[DELETE /api/channel-partners/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
