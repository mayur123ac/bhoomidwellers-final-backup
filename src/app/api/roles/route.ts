// app/api/roles/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRole } from "@/lib/serverAuth";

// ── GET: Fetch all roles ──────────────────────────────────────────────────────
//
// MT-05 Batch 1 authorization fix. This handler previously had NO gate at all:
// an unauthenticated caller reached getOrganizationId(), which falls back to
// sole-organization resolution, and was handed that organization's role list.
//
// Gated with requireRole(["admin"]) rather than requireSession() for two reasons:
// the POST below in this same file already uses exactly that gate, and the sole
// consumer — /dashboard/employees — is admin-only by middleware (every other
// role is redirected to its own dashboard). requireSession() would also have
// closed the hole, but would have been a weaker guard than the screen behind it.
//
// The gate runs BEFORE the organization is resolved: an anonymous caller should
// not cause tenant resolution to run at all. The tenant-scoping of the query
// itself is unchanged.
export async function GET() {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    const orgId = await getOrganizationId();
    const roles = await query(`SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name ASC`, [orgId]);

    // Map id → _id so the employees page keeps working without changes
    const mapped = roles.map(r => ({ ...r, _id: String(r.id) }));
    return NextResponse.json(mapped, { status: 200 });

  } catch (error) {
    console.error("GET /api/roles error:", error);
    return NextResponse.json({ message: "Error fetching roles." }, { status: 500 });
  }
}

// ── POST: Add a new role ──────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    // Resolved after the gate, for the same reason as GET above. Value and
    // tenant-scoping are unchanged — only the ordering relative to auth.
    const orgId = await getOrganizationId();

    const { name } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json({ message: "Role name is required." }, { status: 400 });
    }

    // Conflict check
    const existing = await query(
      // Roles ARE tenant-scoped: a name is unique only within its organization,
      // matching roles_org_name_key (organization_id, name).
      `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) AND organization_id = $2 LIMIT 1`,
      [name.trim(), orgId]
    );
    if (existing.length > 0) {
      return NextResponse.json({ message: "Role already exists." }, { status: 400 });
    }

    const [newRole] = await query(
      // MT-05: roles are organization-specific (UNIQUE (organization_id, name)),
      // so a role name is only unique within its own tenant.
      `INSERT INTO roles (name, organization_id) VALUES ($1, $2) RETURNING id, name`,
      [name.trim(), orgId]
    );

    return NextResponse.json(
      { ...newRole, _id: String(newRole.id) },
      { status: 201 }
    );

  } catch (error) {
    console.error("POST /api/roles error:", error);
    return NextResponse.json({ message: "Error creating role." }, { status: 500 });
  }
}