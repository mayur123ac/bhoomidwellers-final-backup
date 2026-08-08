// app/api/v1/leads/route.ts — read walk-in enquiries.
//
// ── The column list is an allow-list, not a convenience ─────────────────────
// walkin_enquiries has 57 columns. This selects 20. The omissions are the point:
//
//   * Internal routing state (assigned_receptionist, overseeing_site_head,
//     escalated_to_site_head, sourcing_manager_*) describes who inside the
//     company owns the lead. It is meaningless outside and leaks org structure.
//   * lost_lead_reason and notes are free text written by staff about a
//     customer, on the assumption it stays internal.
//   * site_visit_history / loan_tracking_info / referral_info are JSON blobs
//     whose shape is not a contract anyone should build against.
//
// SELECT * would have been shorter and would have silently exported all three
// categories, plus every column added to the table in future. An allow-list
// fails in the safe direction: a new column is absent until someone adds it
// here deliberately.

import { withApiKey } from "@/lib/apiV1";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const COLUMNS = `
  id, sr_no, name, phone, alt_phone, email, city, pin_code, preferred_location,
  budget, configuration, property_type, purpose, use_type, source, source_other,
  status, lead_interest_status, enquiry_date, created_at, last_activity_at
`;

export const GET = withApiKey("/api/v1/leads", "leads:read", async (ctx) => {
  const status = ctx.searchParams.get("status");
  const search = ctx.searchParams.get("search");
  // ISO date; filters on enquiry_date falling back to created_at, which is the
  // same precedence the dashboard uses when a lead was backdated.
  const since = ctx.searchParams.get("since");

  // Every filter is a bound parameter. String interpolation into the WHERE
  // clause would be an injection hole reachable by anyone holding any key with
  // leads:read — a much wider audience than the cookie-authenticated routes.
  // Seeded with a always-true predicate so the filters below can append
  // unconditionally without each one having to know whether it is first.
  // walkin_enquiries has no soft-delete column — lead removal is a hard delete
  // via lib/leadDeletion.ts — so there is nothing to exclude here.
  const where: string[] = ["TRUE"];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (since) {
    params.push(since);
    where.push(`COALESCE(enquiry_date, created_at) >= $${params.length}::timestamptz`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const rows = await query(
    `SELECT ${COLUMNS}
       FROM walkin_enquiries
       ${whereSql}
      ORDER BY COALESCE(enquiry_date, created_at) DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ctx.limit, ctx.offset]
  );

  const totalRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM walkin_enquiries ${whereSql}`,
    params
  );

  return { data: rows, meta: { total: Number(totalRows[0]?.count ?? 0) } };
});
