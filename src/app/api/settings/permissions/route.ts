import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import { avatarSrc } from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

const DEFAULT_PERMISSIONS = { can_change_password: true };

// GET /api/settings/permissions
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  const orgId = gate.session.org;
  const role = (gate.session.role ?? "").toLowerCase().replace(/_/g, " ");
  const isAdmin = role === "admin" || role === "super admin";

  try {
    if (isAdmin) {
      // Admin view: list all members with their permissions
      const conditions = ["u.deleted_at IS NULL"];
      const params: any[] = [];
      let idx = 1;

      if (orgId) {
        conditions.push(`u.organization_id = $${idx++}`);
        params.push(orgId);
      }

      const rows = await query<any>(
        `SELECT u.id, u.name, u.email, u.role, u.department,
                u.avatar_key, u.avatar_url, u.permissions
         FROM users u
         WHERE ${conditions.join(" AND ")}
         ORDER BY u.name ASC`,
        params
      );

      const members = rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        department: r.department,
        avatarUrl: avatarSrc(r),
        permissions: r.permissions ?? DEFAULT_PERMISSIONS,
      }));

      return NextResponse.json({ success: true, members });
    } else {
      // Non-admin view: just their own permissions
      const rows = await query<any>(
        `SELECT permissions FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const permissions = rows[0]?.permissions ?? DEFAULT_PERMISSIONS;
      return NextResponse.json({ success: true, own: true, permissions });
    }
  } catch (err: any) {
    console.error("[GET /api/settings/permissions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/settings/permissions — update a member's permissions (admin only)
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();

    if (!body.userId) {
      return NextResponse.json({ success: false, message: "User ID is required." }, { status: 400 });
    }

    const permissions = {
      can_change_password: body.permissions?.can_change_password !== false,
    };

    await query(
      `UPDATE users SET permissions = $1::jsonb WHERE id = $2`,
      [JSON.stringify(permissions), body.userId]
    );

    return NextResponse.json({ success: true, message: "Permissions saved." });
  } catch (err: any) {
    console.error("[POST /api/settings/permissions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
