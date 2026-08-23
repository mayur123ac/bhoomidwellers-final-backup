// app/api/inventory/[id]/route.ts
// Single unit: read (with full status history), manual edit / status change, and
// soft delete. Status rules mirror the lifecycle in the spec (§2):
//   • booked / registered are set only by the booking-sync flow, never here.
//   • A booked/registered unit can only be *released* (→ available/cancelled),
//     which also unlinks its lead_id / booking_id.
//   • on_hold requires a hold_expires_at; leaving on_hold clears it.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { isAdmin, isLinkedActive, isBookingProtected, bookingProtectedReason, linkDescriptor, softDeleteUnit,
         UNITS_WITH_BOOKING_STATUS, UNIT_GUARD_COLUMNS } from "@/lib/inventoryDelete";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

function isInventoryManager(role: string) {
  const clean = (role || "").trim().toLowerCase();
  return ["admin", "sales manager", "sales_manager"].includes(clean);
}

const cleanNum = (v: any) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? null : n;
};

const SYNC_ONLY_STATUSES = ["booked", "registered"];


// Fields a user may PATCH directly. status + hold_expires_at are handled
// separately below because they carry lifecycle rules.
// apartment_name is deliberately not editable — the field is retired. Legacy rows
// keep whatever they had; nothing new can set it.
const EDITABLE: Record<string, (v: any) => any> = {
  project_name: v => (v == null ? null : String(v).trim()),
  tower: v => (v == null ? null : String(v).trim()),
  wing: v => (v ? String(v).trim() : null),
  unit_type: v => (v == null ? null : String(v).trim()),
  floor: v => (v === "" || v == null ? null : Number(v)),
  flat_no: v => (v == null ? null : String(v).trim()),
  carpet_area_sqft: cleanNum,
  built_up_area_sqft: cleanNum,
  rate_per_sqft: cleanNum,
  base_price: cleanNum,
  facing: v => (v ? String(v).trim() : null),
};

// Single unit joined with its linked lead (name/phone/email) and booking
// (number/status/applicant) so the detail drawer can show who holds it.
const UNIT_DETAIL_SQL = `
  SELECT iu.*, w.name AS lead_name, w.phone AS lead_phone, w.email AS lead_email,
         w.assigned_to AS lead_assigned_to,
         b.booking_number, b.booking_status, b.primary_name AS booking_primary_name
    FROM inventory_units iu
    -- Joined tenant-owned rows carry their own predicate: a lead or booking from
    -- another organization must not be decorated onto this unit.
    LEFT JOIN walkin_enquiries w
           ON w.id = iu.lead_id AND w.organization_id = iu.organization_id
    LEFT JOIN booking_applications b
           ON b.id = iu.booking_id AND b.organization_id = iu.organization_id
   WHERE iu.id = $1 AND iu.organization_id = $2`;

// ─── GET — single unit + its history ──────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const unitOrgId = await getOrganizationId();
    let rows = await query(UNIT_DETAIL_SQL, [Number(id), unitOrgId]);
    if (!rows.length)
      return NextResponse.json({ success: false, message: "Unit not found" }, { status: 404 });

    // Lazy hold-expiry self-heal (spec §2).
    const u = rows[0];
    if (u.status === "on_hold" && u.hold_expires_at && new Date(u.hold_expires_at) < new Date() && !u.deleted_at) {
      await query(
        `UPDATE inventory_units SET status='available', hold_expires_at=NULL, updated_at=NOW() WHERE id=$1`,
        [Number(id)],
      );
      await query(
        `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
         VALUES ($1, 'on_hold', 'available', 'System', 'hold expired',
                 (SELECT organization_id FROM inventory_units WHERE id = $1))`,
        [Number(id)],
      );
      rows = await query(UNIT_DETAIL_SQL, [Number(id), unitOrgId]);
    }

    const history = await query(
      `SELECT * FROM inventory_unit_history WHERE unit_id = $1 ORDER BY changed_at DESC, id DESC`,
      [Number(id)],
    );
    return NextResponse.json({ success: true, data: { ...rows[0], history } }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── PATCH — manual edit / status change ──────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const { user_name, user_role } = body;
    if (!user_name || !user_role)
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    if (!isInventoryManager(user_role))
      return NextResponse.json({ success: false, message: "Only Admin and Sales Managers can edit units." }, { status: 403 });

    const result = await transaction(async (client) => {
      // MT-06: the unit id is a caller-supplied route parameter and this handler
      // deletes. Scoping the lookup means a foreign unit returns notFound instead
      // of being deleted out of another tenant.
      const existing = await client.query(`SELECT * FROM inventory_units WHERE id = $1 AND organization_id = $2`, [Number(id), await getOrganizationId(client)]);
      if (!existing.rows.length) return { notFound: true as const };
      const unit = existing.rows[0];
      if (unit.deleted_at) return { error: "This unit has been deleted." };

      const setParts: string[] = [];
      const vals: any[] = [];
      const push = (v: any) => { vals.push(v); return `$${vals.length}`; };

      for (const [key, coerce] of Object.entries(EDITABLE)) {
        if (key in body) setParts.push(`${key} = ${push(coerce(body[key]))}`);
      }

      // ── Status transition ──
      let statusChange: { from: string; to: string } | null = null;
      if ("status" in body && body.status != null) {
        const next = String(body.status).toLowerCase().trim();
        const cur: string = unit.status;
        if (next !== cur) {
          if (SYNC_ONLY_STATUSES.includes(next))
            return { error: `Status "${next}" is set automatically by the booking flow, not manually.` };

          const isLinked = SYNC_ONLY_STATUSES.includes(cur);
          if (isLinked && !["available", "cancelled"].includes(next))
            return { error: `This unit is ${cur}. Release it (set to Available) before changing to another status.` };

          if (next === "on_hold") {
            const holdExpiry = body.hold_expires_at || null;
            if (!holdExpiry) return { error: "hold_expires_at is required when putting a unit on hold." };
            setParts.push(`hold_expires_at = ${push(holdExpiry)}`);
          } else {
            setParts.push(`hold_expires_at = NULL`);
          }

          // Releasing a booked/registered unit unlinks its lead + booking.
          if (isLinked && ["available", "cancelled"].includes(next)) {
            setParts.push(`lead_id = NULL`);
            setParts.push(`booking_id = NULL`);
          }

          setParts.push(`status = ${push(next)}`);
          statusChange = { from: cur, to: next };
        }
      }

      if (!setParts.length) return { unit };  // nothing to update

      setParts.push(`updated_by = ${push(user_name)}`);
      setParts.push(`updated_at = NOW()`);
      const updated = await client.query(
        `UPDATE inventory_units SET ${setParts.join(", ")} WHERE id = ${push(Number(id))} RETURNING *`,
        vals,
      );
      const row = updated.rows[0];

      if (statusChange) {
        const released = ["available", "cancelled"].includes(statusChange.to) && SYNC_ONLY_STATUSES.includes(statusChange.from);
        const reason = body.reason || (released ? "released (manual)" : "status changed (manual)");
        await client.query(
          `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
           VALUES ($1,$2,$3,$4,$5,
                   (SELECT organization_id FROM inventory_units WHERE id = $1))`,
          [Number(id), statusChange.from, statusChange.to, user_name, reason],
        );
      }
      return { unit: row };
    });

    if ("notFound" in result)
      return NextResponse.json({ success: false, message: "Unit not found" }, { status: 404 });
    if ("error" in result)
      return NextResponse.json({ success: false, message: result.error }, { status: 400 });
    return NextResponse.json({ success: true, data: result.unit }, { status: 200 });
  } catch (err: any) {
    console.error("[PATCH /api/inventory/[id]]", err);
    if (err?.code === "23505")
      return NextResponse.json({ success: false, message: "Another unit with these details already exists." }, { status: 409 });
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── DELETE — soft delete ─────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Role was read from the request body; now from the session.
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    // From the session, not ?user_role= — the query string was the only thing
    // the isAdmin() check below consulted, so appending &user_role=admin to the
    // URL satisfied it. requireRoles above is now the real gate; these remain so
    // the history row records who actually did it.
    const role = gate.session.role || "";
    const userName = gate.session.name || "admin";
    // Force = the admin has passed the row-level "type the flat number" override to
    // delete a booked/registered/on_hold or lead/booking-linked unit anyway.
    const force = searchParams.get("force") === "true";
    if (!isAdmin(role))
      return NextResponse.json({ success: false, message: "Only Admin can delete units." }, { status: 403 });

    const result = await transaction(async (client) => {
      // MT-06: the unit id is a caller-supplied route parameter and this handler
      // deletes. Scoping the lookup means a foreign unit returns notFound instead
      // of being deleted out of another tenant.
      //
      // Read through the booking join so isBookingProtected() can see whether the
      // linked booking is still live or was cancelled — without it the guard
      // fails closed and every once-booked flat stays undeletable.
      const existing = await client.query(
        `SELECT ${UNIT_GUARD_COLUMNS} ${UNITS_WITH_BOOKING_STATUS}
          WHERE iu.id = $1 AND iu.organization_id = $2`,
        [Number(id), await getOrganizationId(client)],
      );
      if (!existing.rows.length) return { notFound: true as const };
      const unit = existing.rows[0];
      if (unit.deleted_at) return { unit };  // already deleted — idempotent

      // ── HARD BLOCK: booking-protected units can NEVER be deleted, even by admin.
      // This covers: booking_id set, status = booked/registered, source = booking sync.
      if (isBookingProtected(unit))
        return { hardBlocked: bookingProtectedReason(unit) };

      const linked = isLinkedActive(unit);
      // Guardrail (also enforced client-side): a linked/active unit can only be
      // removed with an explicit force override — never a plain delete.
      if (linked && !force)
        return { blocked: `This flat is ${linkDescriptor(unit)}. Use the override to delete it.` };

      const reason = linked
        ? `force-deleted while linked to ${linkDescriptor(unit)} — override by admin`
        : "unit deleted by admin";
      await softDeleteUnit(client, unit, userName, reason);
      const upd = await client.query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);
      return { unit: upd.rows[0] };
    });

    if ("notFound" in result)
      return NextResponse.json({ success: false, message: "Unit not found" }, { status: 404 });
    if ("hardBlocked" in result)
      return NextResponse.json({ success: false, message: result.hardBlocked }, { status: 409 });
    if ("blocked" in result)
      return NextResponse.json({ success: false, message: result.blocked, requiresOverride: true }, { status: 409 });
    return NextResponse.json({ success: true, data: result.unit }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/inventory/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
