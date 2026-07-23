// app/api/inventory/building/route.ts
// Whole-building soft-delete, scoped by apartment + project + tower + wing.
// Admin-only. project + tower are required (never an unscoped mass delete).
// Linked/active units are SKIPPED and reported. Each deletion writes a history row.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { isAdmin, isLinkedActive, linkDescriptor, softDeleteUnit } from "@/lib/inventoryDelete";

export const dynamic = "force-dynamic";

// Build the scoped WHERE clause shared by the preview COUNT and the actual delete.
// Keeps the linked-status predicate identical to lib/inventoryDelete.isLinkedActive.
function buildScope(project_name?: string, tower?: string, wing?: string, apartment_name?: string) {
  const where = ["deleted_at IS NULL", "project_name = $1", "tower = $2"];
  const vals: any[] = [String(project_name).trim(), String(tower).trim()];
  if (apartment_name && String(apartment_name).trim()) { vals.push(String(apartment_name).trim()); where.push(`apartment_name = $${vals.length}`); }
  if (wing && String(wing).trim()) { vals.push(String(wing).trim()); where.push(`COALESCE(wing,'') = COALESCE($${vals.length},'')`); }
  return { whereSql: where.join(" AND "), vals };
}

const LINKED_SQL = `(status IN ('booked','registered','on_hold') OR lead_id IS NOT NULL OR booking_id IS NOT NULL)`;

// ─── GET — accurate preview counts (COUNT(*), never capped) ───────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const project_name = searchParams.get("project_name") || "";
    const tower = searchParams.get("tower") || "";
    const wing = searchParams.get("wing") || "";
    const apartment_name = searchParams.get("apartment_name") || "";
    if (!project_name.trim() || !tower.trim())
      return NextResponse.json({ success: false, message: "project_name and tower are required." }, { status: 400 });

    const { whereSql, vals } = buildScope(project_name, tower, wing, apartment_name);
    const rows = await query<{ matched: number; linked: number }>(
      `SELECT COUNT(*)::int AS matched,
              COUNT(*) FILTER (WHERE ${LINKED_SQL})::int AS linked
         FROM inventory_units WHERE ${whereSql}`,
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
    const body = await req.json().catch(() => ({}));
    const { apartment_name, project_name, tower, wing, user_name, user_role } = body;

    if (!isAdmin(user_role))
      return NextResponse.json({ success: false, message: "Only Admin can delete units." }, { status: 403 });
    if (!project_name || !String(project_name).trim() || !tower || !String(tower).trim())
      return NextResponse.json({ success: false, message: "project_name and tower are required." }, { status: 400 });

    const actor = user_name || "admin";
    const { whereSql, vals } = buildScope(project_name, tower, wing, apartment_name);
    const scopeLabel = `Tower ${String(tower).trim()}${wing && String(wing).trim() ? ` / Wing ${String(wing).trim()}` : ""}`;

    const result = await transaction(async (client) => {
      const rows = (await client.query(`SELECT * FROM inventory_units WHERE ${whereSql}`, vals)).rows;
      const skipped: { id: number; flat_no: string; reason: string }[] = [];
      const deletable: any[] = [];
      for (const u of rows) {
        if (isLinkedActive(u)) skipped.push({ id: u.id, flat_no: u.flat_no, reason: `linked to ${linkDescriptor(u)}` });
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
