// app/api/v1/bookings/route.ts — read bookings.
//
// ── Why this projection is unusually narrow ─────────────────────────────────
// booking_applications is the most sensitive table in the CRM. Among its ~130
// columns are `primary_aadhaar`, `primary_pan`, `joint_pan`, `signature_data`,
// the four `*_aadhaar_front_url` / `*_pan_url` document links, and full
// residential addresses of buyers.
//
// Aadhaar and PAN are identity documents under Indian law; a signature image is
// forgeable material. None of it belongs on an API surface whose whole purpose
// is to be consumed by third-party tooling, and no scope in the catalogue grants
// it. There is deliberately no `bookings:write` scope either — nothing external
// should be mutating a signed booking.
//
// If a future integration genuinely needs a document, it should go through a
// separate, individually-audited endpoint that returns a short-lived signed URL
// for ONE document — not through a list endpoint that hands over every buyer's
// identity documents in a single page of JSON.

import { withApiKey } from "@/lib/apiV1";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const COLUMNS = `
  id, booking_number, lead_id, primary_name, booking_status,
  project_name, apartment_name, tower, wing, flat_number, floor_number,
  property_type, carpet_area, consideration_value, agreement_value,
  booking_amount, token_amount, booking_source, channel_partner_name,
  booking_date, application_date, registration_status, possession_status,
  loan_required, loan_status, created_at, updated_at
`;

export const GET = withApiKey("/api/v1/bookings", "bookings:read", async (ctx) => {
  const status = ctx.searchParams.get("status");
  const project = ctx.searchParams.get("project");
  const since = ctx.searchParams.get("since");

  const where: string[] = ["TRUE"];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    where.push(`booking_status = $${params.length}`);
  }
  if (project) {
    params.push(project);
    where.push(`project_name = $${params.length}`);
  }
  if (since) {
    params.push(since);
    where.push(`COALESCE(booking_date, created_at) >= $${params.length}::timestamptz`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const rows = await query(
    `SELECT ${COLUMNS}
       FROM booking_applications
       ${whereSql}
      ORDER BY COALESCE(booking_date, created_at) DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ctx.limit, ctx.offset]
  );

  const totalRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM booking_applications ${whereSql}`,
    params
  );

  return { data: rows, meta: { total: Number(totalRows[0]?.count ?? 0) } };
});
