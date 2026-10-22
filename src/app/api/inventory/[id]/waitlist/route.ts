// api/inventory/[id]/waitlist/route.ts
//
// Manages the unit interest queue (waitlist). Leads can be added to the
// waitlist for a unit that is already booked. When the active booking is
// cancelled, the next waiting lead is auto-promoted to on_hold.
//
// GET  — list waitlist entries for this unit
// POST — add a lead to the waitlist
// PUT  — withdraw a lead or reorder the queue
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// ── GET: List waitlist for a unit ─────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const unitId = parseInt(id, 10);
  if (!Number.isFinite(unitId)) {
    return NextResponse.json({ success: false, message: "Invalid unit id." }, { status: 400 });
  }

  const orgId = await getOrganizationId();

  // Verify unit exists in this org
  const unitCheck = await query(
    `SELECT id FROM inventory_units WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [unitId, orgId]
  );
  if (unitCheck.length === 0) {
    return NextResponse.json({ success: false, message: "Unit not found." }, { status: 404 });
  }

  // Pre-migration fallback: if the table doesn't exist yet, return empty.
  const tableCheck = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_unit_waitlist' LIMIT 1`
  );
  if (tableCheck.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const rows = await query(
    `SELECT w.id, w.unit_id, w.lead_id, w.position, w.status, w.notes,
            w.created_by, w.promoted_at, w.created_at, w.updated_at,
            l.name AS lead_name, l.phone AS lead_phone, l.assigned_to
     FROM inventory_unit_waitlist w
     LEFT JOIN walkin_enquiries l ON l.id = w.lead_id AND l.organization_id = w.organization_id
     WHERE w.unit_id = $1 AND w.organization_id = $2
     ORDER BY
       CASE w.status WHEN 'waiting' THEN 0 WHEN 'promoted' THEN 1 ELSE 2 END,
       w.position ASC, w.created_at ASC`,
    [unitId, orgId]
  );

  return NextResponse.json({ success: true, data: rows });
}

// ── POST: Add a lead to the waitlist ──────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["admin", "sales manager", "sales_manager"]);
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const { id } = await params;
  const unitId = parseInt(id, 10);
  if (!Number.isFinite(unitId)) {
    return NextResponse.json({ success: false, message: "Invalid unit id." }, { status: 400 });
  }

  const body = await req.json();
  const leadId = parseInt(body.lead_id, 10);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ success: false, message: "lead_id is required." }, { status: 400 });
  }
  const notes = (body.notes || "").trim() || null;

  const orgId = await getOrganizationId();

  // Verify unit exists
  const unitCheck = await query(
    `SELECT id, status, booking_id FROM inventory_units
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [unitId, orgId]
  );
  if (unitCheck.length === 0) {
    return NextResponse.json({ success: false, message: "Unit not found." }, { status: 404 });
  }

  // Verify lead exists in same org
  const leadCheck = await query(
    `SELECT id, name FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
    [leadId, orgId]
  );
  if (leadCheck.length === 0) {
    return NextResponse.json({ success: false, message: "Lead not found in this organization." }, { status: 404 });
  }

  // Pre-migration fallback
  const tableCheck = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_unit_waitlist' LIMIT 1`
  );
  if (tableCheck.length === 0) {
    return NextResponse.json({ success: false, message: "Waitlist feature requires migration. Run 2026-10-20_inventory_unit_waitlist.sql." }, { status: 503 });
  }

  // Cannot add the lead that already has the active booking on this unit
  const unit = unitCheck[0];
  if (unit.booking_id) {
    const activeBookingLead = await query(
      `SELECT lead_id FROM booking_applications WHERE id = $1 AND organization_id = $2 AND booking_status != 'Cancelled'`,
      [unit.booking_id, orgId]
    );
    if (activeBookingLead.length > 0 && Number(activeBookingLead[0].lead_id) === leadId) {
      return NextResponse.json(
        { success: false, message: "This lead already has the active booking for this unit." },
        { status: 409 }
      );
    }
  }

  // Determine next position
  const maxPos = await query(
    `SELECT COALESCE(MAX(position), 0) AS max_pos
     FROM inventory_unit_waitlist
     WHERE unit_id = $1 AND organization_id = $2 AND status = 'waiting'`,
    [unitId, orgId]
  );
  const nextPosition = (maxPos[0]?.max_pos ?? 0) + 1;

  try {
    const result = await query(
      `INSERT INTO inventory_unit_waitlist (unit_id, lead_id, position, status, notes, created_by, organization_id)
       VALUES ($1, $2, $3, 'waiting', $4, $5, $6)
       ON CONFLICT (organization_id, unit_id, lead_id) WHERE status = 'waiting'
       DO NOTHING
       RETURNING id`,
      [unitId, leadId, nextPosition, notes, session.name, orgId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, message: "This lead is already on the waitlist for this unit." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { id: result[0].id, position: nextPosition },
      message: `Lead added to waitlist at position ${nextPosition}.`,
    }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/inventory/[id]/waitlist]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ── PUT: Withdraw a lead from the waitlist ────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["admin", "sales manager", "sales_manager"]);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const unitId = parseInt(id, 10);
  if (!Number.isFinite(unitId)) {
    return NextResponse.json({ success: false, message: "Invalid unit id." }, { status: 400 });
  }

  const body = await req.json();
  const entryId = parseInt(body.entry_id, 10);
  const action = body.action; // "withdraw"
  if (!Number.isFinite(entryId) || action !== "withdraw") {
    return NextResponse.json({ success: false, message: "entry_id and action='withdraw' required." }, { status: 400 });
  }

  const orgId = await getOrganizationId();

  // Pre-migration fallback
  const tableCheck = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_unit_waitlist' LIMIT 1`
  );
  if (tableCheck.length === 0) {
    return NextResponse.json({ success: false, message: "Waitlist feature requires migration." }, { status: 503 });
  }

  const result = await query(
    `UPDATE inventory_unit_waitlist
     SET status = 'withdrawn', updated_at = NOW()
     WHERE id = $1 AND unit_id = $2 AND organization_id = $3 AND status = 'waiting'
     RETURNING id`,
    [entryId, unitId, orgId]
  );

  if (result.length === 0) {
    return NextResponse.json({ success: false, message: "Entry not found or already processed." }, { status: 404 });
  }

  return NextResponse.json({ success: true, message: "Withdrawn from waitlist." });
}
