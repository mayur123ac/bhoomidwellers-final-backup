// app/api/v1/employees/route.ts — read the user directory.
//
// Name, role and department only. No email, no phone, no whatsapp_number — the
// scope is documented as "no contact details" and this is where that promise is
// kept. A staff directory complete with mobile numbers is a phishing target and
// a recruitment list, and no plausible integration needs it: the reason to read
// this endpoint is to resolve an `assigned_to` id into a name.
//
// Obviously `password` is absent, but it is worth noting explicitly that the
// column list is an allow-list for exactly that class of reason — a SELECT *
// here would have exported the password column and every invite token.

import { withApiKey } from "@/lib/apiV1";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withApiKey("/api/v1/employees", "employees:read", async (ctx) => {
  const role = ctx.searchParams.get("role");
  // Default to active only; `?includeInactive=true` opts in. A directory that
  // silently includes people who have left is the more surprising default.
  const includeInactive = ctx.searchParams.get("includeInactive") === "true";

  const where: string[] = ["deleted_at IS NULL"];
  const params: unknown[] = [];

  if (!includeInactive) where.push("is_active = true");

  if (role) {
    params.push(role);
    // Role strings are inconsistent in this table ("site_head" and "Site Head"
    // both occur) — normalised on both sides, the same way requireRoles() does
    // it in lib/serverAuth.ts.
    where.push(
      `LOWER(REPLACE(role, '_', ' ')) = LOWER(REPLACE($${params.length}, '_', ' '))`
    );
  }

  // The API key is the tenant for v1 — there is no session here. Pushed onto
  // `params` so its index follows whatever optional filters were supplied, the
  // same way /api/v1/leads does it. Without this an integration key issued to one
  // organization would return the whole platform's staff directory.
  params.push(ctx.key.organization_id);
  where.push(`organization_id = $${params.length}`);

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const rows = await query(
    `SELECT id, name, role, department, reporting_manager_id, is_active, created_at
       FROM users
       ${whereSql}
      ORDER BY name ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ctx.limit, ctx.offset]
  );

  const totalRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users ${whereSql}`,
    params
  );

  return { data: rows, meta: { total: Number(totalRows[0]?.count ?? 0) } };
});
