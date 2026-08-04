// app/api/inventory/towers/route.ts
// Sell.Do parity — the middle hierarchy level: project → tower → unit.
//
// Wing deliberately stays on the unit rather than becoming a tower. The existing
// data has several wings inside one tower ("B", "B wing", "A wing"), and the
// unit-level unique index already keys on (project, tower, wing, floor, flat) —
// promoting wing here would have forced that index to be rebuilt.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// ─── GET — towers, optionally scoped to a project ────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");

    const where: string[] = ["t.deleted_at IS NULL"];
    const vals: any[] = [];
    if (projectId) { vals.push(Number(projectId)); where.push(`t.project_id = $${vals.length}`); }

    const rows = await query(
      `SELECT t.*, p.name AS project_name,
              COALESCE(u.total, 0)     AS unit_count,
              COALESCE(u.available, 0) AS available_count,
              COALESCE(u.booked, 0)    AS booked_count
         FROM inventory_towers t
         JOIN inventory_projects p ON p.id = t.project_id
         LEFT JOIN (
           SELECT tower_id,
                  COUNT(*)::int                                                  AS total,
                  COUNT(*) FILTER (WHERE status = 'available')::int               AS available,
                  COUNT(*) FILTER (WHERE status IN ('booked','registered'))::int  AS booked
             FROM inventory_units WHERE deleted_at IS NULL GROUP BY tower_id
         ) u ON u.tower_id = t.id
        WHERE ${where.join(" AND ")}
        ORDER BY p.name ASC, t.name ASC`,
      vals,
    );

    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/towers]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create a tower under a project ───────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const projectId = Number(body.project_id);
    const name = String(body.name || "").trim();

    if (!projectId || !Number.isFinite(projectId)) {
      return NextResponse.json({ success: false, message: "project_id is required." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ success: false, message: "Tower name is required." }, { status: 400 });
    }

    // Checked explicitly rather than relying on the FK, so a bad id reads as
    // "that project does not exist" instead of a raw constraint violation.
    const proj = await query(
      `SELECT id FROM inventory_projects WHERE id = $1 AND deleted_at IS NULL`, [projectId]);
    if (!proj.length) {
      return NextResponse.json({ success: false, message: "Project not found." }, { status: 404 });
    }

    const actor = gate.session.name || "system";
    const rows = await query(
      `INSERT INTO inventory_towers (project_id, name, total_floors, units_per_floor, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
      [
        projectId, name,
        body.total_floors === "" || body.total_floors == null ? null : Number(body.total_floors),
        body.units_per_floor === "" || body.units_per_floor == null ? null : Number(body.units_per_floor),
        actor,
      ],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/inventory/towers]", err);
    if (err?.code === "23505") {
      return NextResponse.json(
        { success: false, message: "That tower already exists in this project." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
