// app/api/inventory/[id]/route.ts
// Single unit: read (with full status history), manual edit / status change, and
// soft delete. Status rules mirror the lifecycle in the spec (§2):
//   • booked / registered are set only by the booking-sync flow, never here.
//   • A booked/registered unit can only be *released* (→ available/cancelled),
//     which also unlinks its lead_id / booking_id.
//   • on_hold requires a hold_expires_at; leaving on_hold clears it.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { isAdmin, isLinkedActive, linkDescriptor, softDeleteUnit } from "@/lib/inventoryDelete";

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
const EDITABLE: Record<string, (v: any) => any> = {
  apartment_name:     v => (v == null ? null : String(v).trim()),
  project_name:       v => (v == null ? null : String(v).trim()),
  tower:              v => (v == null ? null : String(v).trim()),
  wing:               v => (v ? String(v).trim() : null),
  unit_type:          v => (v == null ? null : String(v).trim()),
  floor:              v => (v === "" || v == null ? null : Number(v)),
  flat_no:            v => (v == null ? null : String(v).trim()),
  carpet_area_sqft:   cleanNum,
  built_up_area_sqft: cleanNum,
  rate_per_sqft:      cleanNum,
  base_price:         cleanNum,
  facing:             v => (v ? String(v).trim() : null),
};

// ─── GET — single unit + its history ──────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    let rows = await query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);
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
        `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
         VALUES ($1, 'on_hold', 'available', 'System', 'hold expired')`,
        [Number(id)],
      );
      rows = await query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);
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
    const body = await req.json();
    const { user_name, user_role } = body;
    if (!user_name || !user_role)
      return NextResponse.json({ success: false, message: "user_name and user_role are required" }, { status: 400 });
    if (!isInventoryManager(user_role))
      return NextResponse.json({ success: false, message: "Only Admin and Sales Managers can edit units." }, { status: 403 });

    const result = await transaction(async (client) => {
      const existing = await client.query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);
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
          `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason)
           VALUES ($1,$2,$3,$4,$5)`,
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
    const { searchParams } = new URL(req.url);
    const role = searchParams.get("user_role") || "";
    const userName = searchParams.get("user_name") || "admin";
    // Force = the admin has passed the row-level "type the flat number" override to
    // delete a booked/registered/on_hold or lead/booking-linked unit anyway.
    const force = searchParams.get("force") === "true";
    if (!isAdmin(role))
      return NextResponse.json({ success: false, message: "Only Admin can delete units." }, { status: 403 });

    const result = await transaction(async (client) => {
      const existing = await client.query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);
      if (!existing.rows.length) return { notFound: true as const };
      const unit = existing.rows[0];
      if (unit.deleted_at) return { unit };  // already deleted — idempotent

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
    if ("blocked" in result)
      return NextResponse.json({ success: false, message: result.blocked, requiresOverride: true }, { status: 409 });
    return NextResponse.json({ success: true, data: result.unit }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/inventory/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
