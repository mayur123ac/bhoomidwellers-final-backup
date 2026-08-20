// api/platform/users/route.ts — every user, across every organization.
//
// ── The column list is an allow-list, deliberately ──────────────────────────
// `users` has 35 columns, among them `password`, `invite_token`, and the
// alternate-email verification fields. This SELECT names six of them plus the
// organization join. It is written as an allow-list for the same reason
// /api/employees was rewritten as one under MT-06: a `SELECT u.*` here would
// ship the password column to the browser the moment anyone looked, and would
// silently pick up whatever sensitive column is added next.
//
// `password` and `invite_token` are not selected, not aliased, and not returned
// in any shape.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 500;

export async function GET(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  // Optional narrowing. Bound rather than trusted: a caller asking for 10 000
  // rows gets MAX_LIMIT, and a non-UUID organization filter is ignored rather
  // than passed to Postgres.
  const url = new URL(req.url);
  const orgParam = url.searchParams.get("organization_id");
  const org = orgParam && /^[0-9a-f-]{36}$/i.test(orgParam) ? orgParam : null;
  const limit = Math.min(Number(url.searchParams.get("limit")) || MAX_LIMIT, MAX_LIMIT);

  try {
    const rows = await query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         u.is_active AS "isActive",
         u.created_at,
         u.organization_id,
         o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE u.deleted_at IS NULL
        AND ($1::uuid IS NULL OR u.organization_id = $1::uuid)
      ORDER BY o.name NULLS FIRST, u.created_at DESC
      LIMIT $2`,
      [org, limit]
    );

    return NextResponse.json(
      {
        success: true,
        data: rows.map(r => ({
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          // A platform account has no organization by definition; label it as
          // such rather than showing an empty cell.
          organization: r.organization_name ?? "Platform",
          organizationId: r.organization_id,
          status: r.isActive ? "active" : "inactive",
          createdOn: r.created_at,
        })),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/platform/users]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
