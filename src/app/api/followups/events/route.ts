// api/followups/events/route.ts
//
// SSE stream for follow-up events, scoped to the caller's organization.
// Pattern mirrors /api/leads/lost/events/route.ts exactly.

import { createFollowUpStream } from "@/lib/followUpEvents";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const organizationId = await getOrganizationId();
  return createFollowUpStream(organizationId);
}
