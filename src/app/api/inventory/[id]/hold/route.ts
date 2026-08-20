// app/api/inventory/[id]/hold/route.ts
// Sell.Do parity, gap 2 — a hold with an OWNER, not just an expiry.
//
// inventory_units already had hold_expires_at and a lazy sweep that reverts
// expired holds (see GET /api/inventory). What it never had was who placed the
// hold and for which customer, so the grid could say "on hold" and nobody could
// say whose. Sell.Do treats hold ownership as core to preventing double-booking,
// because an unattributable hold is one nobody dares release.
import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Industry norm (and Sell.Do's) is a short tentative block that auto-reverts.
const DEFAULT_HOLD_HOURS = 48;
const MAX_HOLD_HOURS = 24 * 14;

// Only a free unit may be held. Notably absent: 'booked' and 'registered' — a
// sold flat cannot be tentatively promised to someone else.
const HOLDABLE = ["available"];

// ─── POST — place a hold ─────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const hours = Number(body.hours ?? DEFAULT_HOLD_HOURS);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOLD_HOURS) {
      return NextResponse.json(
        { success: false, message: `Hold duration must be between 1 and ${MAX_HOLD_HOURS} hours.` },
        { status: 400 },
      );
    }

    const leadId = body.lead_id == null || body.lead_id === "" ? null : Number(body.lead_id);
    const actor = gate.session.name || "system";

    const result = await transaction(async (client) => {
      // FOR UPDATE: two agents holding the same flat at once is exactly the race
      // this feature exists to prevent, so the read must lock the row.
      const cur = await client.query(
        `SELECT id, status, flat_no, tower, held_by, held_for_lead_id, hold_expires_at, booking_id
           FROM inventory_units WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [Number(id)],
      );
      if (!cur.rows.length) {
        throw Object.assign(new Error("Unit not found."), { httpStatus: 404 });
      }
      const unit = cur.rows[0];

      if (unit.booking_id != null) {
        throw Object.assign(
          new Error(`Flat ${unit.flat_no} is attached to booking #${unit.booking_id} and cannot be held.`),
          { httpStatus: 409 },
        );
      }
      if (!HOLDABLE.includes(String(unit.status).toLowerCase())) {
        // An existing hold is reported with its owner — the whole point of the change.
        const who = unit.status === "on_hold" && unit.held_by ? ` by ${unit.held_by}` : "";
        throw Object.assign(
          new Error(`Flat ${unit.flat_no} is ${unit.status}${who} and cannot be held.`),
          { httpStatus: 409 },
        );
      }

      const upd = await client.query(
        `UPDATE inventory_units
            SET status = 'on_hold',
                hold_expires_at = NOW() + ($2 || ' hours')::interval,
                held_by = $3, held_for_lead_id = $4, hold_reason = $5,
                updated_by = $3, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [Number(id), String(hours), actor, leadId, body.reason ? String(body.reason).trim() : null],
      );

      await client.query(
        `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
         VALUES ($1, $2, 'on_hold', $3, $4,
                 (SELECT organization_id FROM inventory_units WHERE id = $1))`,
        [
          Number(id), unit.status, actor,
          `held for ${hours}h${leadId ? ` for lead #${leadId}` : ""}${body.reason ? ` — ${String(body.reason).trim()}` : ""}`,
        ],
      );

      return upd.rows[0];
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err: any) {
    console.error("[POST /api/inventory/[id]/hold]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: err?.httpStatus || 500 });
  }
}

// ─── DELETE — release a hold early ───────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const actor = gate.session.name || "system";
    const role = String(gate.session.role || "").trim().toLowerCase().replace(/_/g, " ");

    const result = await transaction(async (client) => {
      const cur = await client.query(
        `SELECT id, status, flat_no, held_by FROM inventory_units
          WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [Number(id)],
      );
      if (!cur.rows.length) throw Object.assign(new Error("Unit not found."), { httpStatus: 404 });
      const unit = cur.rows[0];

      if (String(unit.status).toLowerCase() !== "on_hold") {
        throw Object.assign(new Error(`Flat ${unit.flat_no} is not on hold.`), { httpStatus: 409 });
      }

      // Ownership is what makes a hold meaningful, so releasing someone else's is
      // an Admin action. Without this, hold ownership would be decorative.
      if (unit.held_by && unit.held_by !== actor && role !== "admin") {
        throw Object.assign(
          new Error(`This hold belongs to ${unit.held_by}. Only they or an Admin can release it.`),
          { httpStatus: 403 },
        );
      }

      const upd = await client.query(
        `UPDATE inventory_units
            SET status = 'available', hold_expires_at = NULL,
                held_by = NULL, held_for_lead_id = NULL, hold_reason = NULL,
                updated_by = $2, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [Number(id), actor],
      );

      await client.query(
        `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
         VALUES ($1, 'on_hold', 'available', $2, $3,
                 (SELECT organization_id FROM inventory_units WHERE id = $1))`,
        [Number(id), actor, `hold released${unit.held_by && unit.held_by !== actor ? ` (was ${unit.held_by}'s)` : ""}`],
      );

      return upd.rows[0];
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/inventory/[id]/hold]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: err?.httpStatus || 500 });
  }
}
