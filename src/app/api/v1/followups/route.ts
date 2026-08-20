// app/api/v1/followups/route.ts — read follow-up history for a lead.
//
// Requires `leadId`. There is no "all follow-ups" mode, unlike the other list
// endpoints, and that is a deliberate limit rather than an omission: follow-up
// messages are free text written by staff, and an unbounded feed of them is an
// export of internal commentary about customers. Scoped to one lead, it answers
// the legitimate question ("what has happened with this enquiry") without
// doubling as a bulk transcript.
//
// Internal-messaging rows are excluded for the same reason. follow_ups carries
// two different things: notes about a lead, and staff-to-staff messages routed
// via sent_to_user_id / sent_to_role (see follow_ups_internal_messaging.sql).
// The second kind is colleagues talking to each other and is not lead history.

import { ApiV1Error, withApiKey } from "@/lib/apiV1";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withApiKey("/api/v1/followups", "followups:read", async (ctx) => {
  const leadIdRaw = ctx.searchParams.get("leadId");
  const leadId = Number(leadIdRaw);

  if (!leadIdRaw || !Number.isInteger(leadId) || leadId <= 0) {
    throw new ApiV1Error(
      "MISSING_PARAMETER",
      "A numeric `leadId` query parameter is required."
    );
  }

  const rows = await query(
    `SELECT id, lead_id, message, follow_up_type, created_by_name, created_by_role,
            followup_date, site_visit_date, created_at
       FROM follow_ups
      WHERE lead_id = $1
        AND sent_to_user_id IS NULL
        AND sent_to_role IS NULL
        AND organization_id = $4
      ORDER BY created_at ASC, id ASC
      LIMIT $2 OFFSET $3`,
    [leadId, ctx.limit, ctx.offset, ctx.key.organization_id]
  );

  const totalRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM follow_ups
      WHERE lead_id = $1 AND sent_to_user_id IS NULL AND sent_to_role IS NULL
        AND organization_id = $2`,
    [leadId, ctx.key.organization_id]
  );

  return { data: rows, meta: { leadId, total: Number(totalRows[0]?.count ?? 0) } };
});
