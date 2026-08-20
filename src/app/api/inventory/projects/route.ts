// app/api/inventory/projects/route.ts
// Sell.Do parity — projects are a real entity, not a string repeated on every unit.
//
// This is what stops "Malad", "Malad East" and "Malad Project" from being three
// different projects. The unique index is on LOWER(TRIM(name)), so the duplicate
// is refused at the database, not just in this handler.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

const PROJECT_STATUSES = ["upcoming", "active", "sold_out", "archived"];

// ─── GET — list projects, each with live unit counts ─────────────────────────
// Viewing is open to every signed-in role, matching GET /api/inventory.
export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const includeArchived = searchParams.get("include_archived") === "true";

    const rows = await query(
      `SELECT p.*,
              COALESCE(u.total, 0)     AS unit_count,
              COALESCE(u.available, 0) AS available_count,
              COALESCE(u.booked, 0)    AS booked_count,
              COALESCE(t.towers, 0)    AS tower_count
         FROM inventory_projects p
         LEFT JOIN (
           SELECT project_id,
                  COUNT(*)::int                                            AS total,
                  COUNT(*) FILTER (WHERE status = 'available')::int         AS available,
                  COUNT(*) FILTER (WHERE status IN ('booked','registered'))::int AS booked
             FROM inventory_units WHERE deleted_at IS NULL GROUP BY project_id
         ) u ON u.project_id = p.id
         LEFT JOIN (
           SELECT project_id, COUNT(*)::int AS towers
             FROM inventory_towers WHERE deleted_at IS NULL GROUP BY project_id
         ) t ON t.project_id = p.id
        WHERE p.deleted_at IS NULL
          ${includeArchived ? "" : "AND p.status <> 'archived'"}
        ORDER BY p.name ASC`,
    );

    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/inventory/projects]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create a project ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // Same gate as unit creation: Admin and Sales Manager own inventory structure.
    const gate = await requireRoles(["admin", "sales manager"]);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ success: false, message: "Project name is required." }, { status: 400 });
    }

    const status = String(body.status || "active").toLowerCase().trim();
    if (!PROJECT_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, message: `Invalid status. Allowed: ${PROJECT_STATUSES.join(", ")}.` },
        { status: 400 },
      );
    }

    const actor = gate.session.name || "system";
    const rows = await query(
      `INSERT INTO inventory_projects (name, city, address, rera_number, status, possession_date, created_by, updated_by, organization_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)
       RETURNING *`,
      [
        name,
        body.city ? String(body.city).trim() : null,
        body.address ? String(body.address).trim() : null,
        body.rera_number ? String(body.rera_number).trim() : null,
        status,
        body.possession_date || null,
        actor,
        await getOrganizationId(),
      ],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/inventory/projects]", err);
    // 23505 is the LOWER(TRIM(name)) unique index — the case-variant duplicate
    // this table exists to prevent. Report it as a conflict, not a server error.
    if (err?.code === "23505") {
      return NextResponse.json(
        { success: false, message: "A project with that name already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
