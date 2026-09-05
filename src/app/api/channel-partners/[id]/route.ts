// api/channel-partners/[id]/route.ts
//
// ── Phone Number Access Control ───────────────────────────────────────────────
// channel_partners.phone is resolved through the CP_ENQUIRY phone policy before
// it leaves this handler. Raw phone never reaches an unauthorized client.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession } from "@/lib/serverAuth";
import {
  canViewPartners,
  canViewAllPartners,
  canEditPartners,
  canDeletePartners,
  canAssignPartners,
  canSeePartnerCommercials,
} from "@/lib/cpRbac";
import { parseAssignee, isActiveSourcingManager } from "@/lib/sourcingAssignment";
import { resolvePhone } from "@/lib/phoneAccess";

export const dynamic = "force-dynamic";

/**
 * A Sourcing Manager may only open partners assigned to them. Returned as 404
 * rather than 403 deliberately: "you may not see this one" still confirms the
 * partner exists and, by elimination, who else holds them.
 */
function outOfScope(id: string) {
  return NextResponse.json(
    { success: false, message: `Channel partner ${id} not found.` },
    { status: 404 }
  );
}

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
              sm.name            AS assigned_sourcing_manager_name,
              sm.username        AS assigned_sourcing_manager_username,
              sm.email           AS assigned_sourcing_manager_email,
              sm.whatsapp_number AS assigned_sourcing_manager_phone,
              sm.is_active       AS assigned_sourcing_manager_active,
              (SELECT COUNT(*) FROM walkin_enquiries w
                WHERE w.channel_partner_id = cp.id AND w.organization_id = cp.organization_id) AS lead_count,
              (SELECT COUNT(*) FROM booking_applications b WHERE b.sourced_by_channel_partner_id = cp.id) AS booking_count
         FROM channel_partners cp
         LEFT JOIN users sm ON sm.id = cp.assigned_sourcing_manager_id
        WHERE cp.id = $1`,
      [Number(id)]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }

    if (
      !canViewAllPartners(auth.session.role) &&
      String(rows[0].assigned_sourcing_manager_id ?? "") !== String(auth.session._id ?? auth.session.id ?? "")
    ) {
      return outOfScope(id);
    }

    let data: any = rows[0];
    if (!canSeePartnerCommercials(auth.session.role)) {
      const { default_commission_rate, bank_account_details, ...rest } = data;
      data = rest;
    }

    // Apply phone masking for CP_ENQUIRY scope.
    // The ownership columns (assigned_sourcing_manager_id, assigned_sales_manager_id)
    // are already on the row from SELECT cp.*.
    const orgId = await getOrganizationId();
    const actor = {
      _id: auth.session._id,
      name: auth.session.name,
      role: auth.session.role,
    };
    data = {
      ...data,
      phone: await resolvePhone(actor, data, "CP_ENQUIRY", orgId, data.phone),
    };

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

    // ── Reassignment ────────────────────────────────────────────────────────
    // Handled outside the generic EDITABLE_FIELDS loop because it carries two
    // companion columns (at / by) that the client must not be able to set, and
    // because an explicit null is meaningful here — it unassigns the partner
    // rather than being treated as a blank string.
    //
    // Admin-only, a narrower gate than the rest of this route: a Sales Manager can
    // edit a partner's commercial terms but does not decide whose desk they sit on.
    // Silently dropping the field would let a Sales Manager's edit form appear to
    // reassign and quietly not, so an attempt is refused outright.
    const assignee = parseAssignee(body.assigned_sourcing_manager_id);
    if (assignee.kind !== "absent" && !canAssignPartners(auth.session.role)) {
      return NextResponse.json(
        {
          success: false,
          message: "Only an Admin can change a partner's Sourcing Manager.",
          code: "ASSIGN_FORBIDDEN",
        },
        { status: 403 }
      );
    }
    if (assignee.kind === "invalid") {
      return NextResponse.json(
        {
          success: false,
          message: "assigned_sourcing_manager_id must be a Sourcing Manager's user id, or null to unassign.",
          code: "INVALID_SOURCING_MANAGER",
        },
        { status: 400 }
      );
    }
    if (assignee.kind === "id" && !(await isActiveSourcingManager(assignee.id))) {
      // Guards against parking a partner on a Receptionist or a deactivated
      // account, where they would be invisible on every Sourcing Manager panel.
      return NextResponse.json(
        {
          success: false,
          message: "That user is not an active Sourcing Manager.",
          code: "INVALID_SOURCING_MANAGER",
        },
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

    if (assignee.kind !== "absent") {
      const newAssignee = assignee.kind === "id" ? assignee.id : null;
      values.push(newAssignee);
      const p = values.length;
      sets.push(`assigned_sourcing_manager_id = $${p}`);
      // Timestamp and actor are stamped server-side, and only when the owner
      // actually changes — re-saving an unrelated field must not make the
      // assignment look freshly made.
      sets.push(
        `assigned_sourcing_manager_at = CASE
           WHEN $${p}::int IS NULL THEN NULL
           WHEN assigned_sourcing_manager_id IS DISTINCT FROM $${p}::int THEN now()
           ELSE assigned_sourcing_manager_at END`
      );
      values.push(updatedBy);
      const a = values.length;
      sets.push(
        `assigned_sourcing_manager_by = CASE
           WHEN $${p}::int IS NULL THEN NULL
           WHEN assigned_sourcing_manager_id IS DISTINCT FROM $${p}::int THEN $${a}
           ELSE assigned_sourcing_manager_by END`
      );
    }

    if (sets.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Nothing to update. Editable fields: ${EDITABLE_FIELDS.join(", ")}, assigned_sourcing_manager_id.`,
          code: "NO_EDITABLE_FIELDS",
        },
        { status: 400 }
      );
    }

    values.push(updatedBy);
    sets.push(`updated_by = $${values.length}`);
    values.push(Number(id));
    // id comes from the URL, so the organization is part of the predicate: a
    // partner in another organization matches 0 rows and 404s below.
    values.push(await getOrganizationId());

    const rows = await query(
      `UPDATE channel_partners SET ${sets.join(", ")} WHERE id = $${values.length - 1} AND organization_id = $${values.length} RETURNING *`,
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
         -- Every reference count is organization-scoped: the delete guard must
         -- not be satisfied (or blocked) by another builder's rows.
         (SELECT COUNT(*) FROM walkin_enquiries    WHERE channel_partner_id = $1 AND organization_id = $2) AS lead_count,
         (SELECT COUNT(*) FROM booking_applications WHERE sourced_by_channel_partner_id = $1 AND organization_id = $2) AS booking_count,
         (SELECT COUNT(*) FROM cp_commissions      WHERE channel_partner_id = $1 AND organization_id = $2) AS commission_count,
         (SELECT COUNT(*) FROM cp_chat_messages    WHERE channel_partner_id = $1 AND organization_id = $2) AS chat_count,
         (SELECT name FROM channel_partners        WHERE id = $1 AND organization_id = $2)                 AS name`,
      [cpId, await getOrganizationId()]
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
    const chats = Number(refs.chat_count || 0);

    if (leads > 0 || bookings > 0 || commissions > 0 || chats > 0) {
      const parts = [
        leads && `${leads} lead${leads === 1 ? "" : "s"}`,
        bookings && `${bookings} booking${bookings === 1 ? "" : "s"}`,
        commissions && `${commissions} commission record${commissions === 1 ? "" : "s"}`,
        chats && `${chats} chat message${chats === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return NextResponse.json(
        {
          success: false,
          code: "HAS_REFERENCES",
          message: `"${refs.name}" is referenced by ${parts.join(", ")} and cannot be deleted. Mark them inactive instead — that stops new commission accruing without losing the history.`,
          references: { leads, bookings, commissions, chats },
        },
        { status: 409 }
      );
    }

    await query(`DELETE FROM channel_partners WHERE id = $1 AND organization_id = $2`, [cpId, await getOrganizationId()]);
    return NextResponse.json(
      { success: true, message: `"${refs.name}" deleted.` },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[DELETE /api/channel-partners/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
