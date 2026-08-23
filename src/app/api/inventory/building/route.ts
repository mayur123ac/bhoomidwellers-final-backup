// app/api/inventory/building/route.ts
// Whole-building soft-delete, scoped by apartment + project + tower + wing.
// Admin-only. project + tower are required (never an unscoped mass delete).
// Linked/active units are SKIPPED and reported. Each deletion writes a history row.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { isLinkedActive, isBookingProtected, bookingProtectedReason, linkDescriptor, softDeleteUnit,
         UNITS_WITH_BOOKING_STATUS, UNIT_GUARD_COLUMNS, GUARDED_UNIT_SQL } from "@/lib/inventoryDelete";

export const dynamic = "force-dynamic";

// Build the scoped WHERE clause shared by the preview COUNT and the actual delete.
// Keeps the linked-status predicate identical to lib/inventoryDelete.isLinkedActive.
// apartment_name is no longer part of the scope — it is retired as an input, and
// narrowing a DELETE by a field the UI can no longer set would silently shrink
// the set the operator was shown in the preview.
//
// MT-06: the scope is project NAME plus tower NAME. Those are free-text strings
// and two builders can easily both have a "Phase 1" / "Tower A". Without the
// organization predicate this DELETE soft-deleted another tenant's entire tower
// whenever the names happened to coincide, and the GET preview counted their
// units. The organization is always $1 so it can never be the omitted branch.
//
// Predicates are qualified with `iu` because both the preview and the delete now
// read units through UNITS_WITH_BOOKING_STATUS, and booking_applications has
// organization_id and project_name columns of its own — unqualified names would
// be ambiguous.
function buildScope(orgId: string, project_name?: string, tower?: string, wing?: string) {
  const where = ["iu.deleted_at IS NULL", "iu.organization_id = $1", "iu.project_name = $2", "iu.tower = $3"];
  const vals: any[] = [orgId, String(project_name).trim(), String(tower).trim()];
  if (wing && String(wing).trim()) { vals.push(String(wing).trim()); where.push(`COALESCE(iu.wing,'') = COALESCE($${vals.length},'')`); }
  return { whereSql: where.join(" AND "), vals };
}

// ─── GET — accurate preview counts (COUNT(*), never capped) ───────────────────
export async function GET(req: NextRequest) {
  try {
    // MT-06: the preview count was answered anonymously, which let anyone
    // enumerate project and tower names and their unit counts. It previews an
    // admin-only destructive action, so it is gated the same way.
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const project_name = searchParams.get("project_name") || "";
    const tower = searchParams.get("tower") || "";
    const wing = searchParams.get("wing") || "";
    if (!project_name.trim() || !tower.trim())
      return NextResponse.json({ success: false, message: "project_name and tower are required." }, { status: 400 });

    const { whereSql, vals } = buildScope(await getOrganizationId(), project_name, tower, wing);
    const rows = await query<{ matched: number; linked: number }>(
      `SELECT COUNT(*)::int AS matched,
              COUNT(*) FILTER (WHERE ${GUARDED_UNIT_SQL})::int AS linked
         ${UNITS_WITH_BOOKING_STATUS} WHERE ${whereSql}`,
      vals,
    );
    const matched = rows[0]?.matched ?? 0;
    const linked = rows[0]?.linked ?? 0;
    return NextResponse.json({ success: true, matched, linked, deletable: matched - linked }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/building]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // Session-derived, not body-derived — see the note in inventory/bulk. This
    // one soft-deletes an entire tower/wing, so the body-supplied role check it
    // shipped with was the highest-blast-radius instance of that bug.
    const gate = await requireRoles(["admin"]);
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const { project_name, tower, wing } = body;

    if (!project_name || !String(project_name).trim() || !tower || !String(tower).trim())
      return NextResponse.json({ success: false, message: "project_name and tower are required." }, { status: 400 });

    const actor = gate.session.name || "admin";
    const { whereSql, vals } = buildScope(await getOrganizationId(), project_name, tower, wing);
    const scopeLabel = `Tower ${String(tower).trim()}${wing && String(wing).trim() ? ` / Wing ${String(wing).trim()}` : ""}`;

    const result = await transaction(async (client) => {
      const rows = (await client.query(
        `SELECT ${UNIT_GUARD_COLUMNS} ${UNITS_WITH_BOOKING_STATUS} WHERE ${whereSql}`, vals)).rows;
      const skipped: { id: number; flat_no: string; reason: string }[] = [];
      const deletable: any[] = [];
      for (const u of rows) {
        // Hard block first: booking-protected units can never be deleted.
        if (isBookingProtected(u)) skipped.push({ id: u.id, flat_no: u.flat_no, reason: bookingProtectedReason(u) });
        else if (isLinkedActive(u)) skipped.push({ id: u.id, flat_no: u.flat_no, reason: `linked to ${linkDescriptor(u)}` });
        else deletable.push(u);
      }
      for (const u of deletable) {
        await softDeleteUnit(client, u, actor, `deleted via whole-building delete: ${scopeLabel}`);
      }
      return { matched: rows.length, deleted: deletable.length, skipped };
    });

    return NextResponse.json({
      success: true,
      deleted: result.deleted,
      skipped: result.skipped.length,
      total: result.matched,
      skipped_details: result.skipped,
    }, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/inventory/building]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
