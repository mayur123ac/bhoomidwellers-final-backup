//api/leads/lost/events/route.ts
import { createLeadUpdateStream } from "@/lib/lostLeadEvents";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  // Live push of lost/restored lead events; gated before the stream opens.
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  // The stream is opened for ONE tenant. Previously every subscriber shared a
  // single global set, so a lost-lead event in one organization pushed the full
  // lead row to every other organization's open dashboards. The id comes from
  // the signed session via getOrganizationId(), never from the request.
  const organizationId = await getOrganizationId();
  return createLeadUpdateStream(organizationId);
}
