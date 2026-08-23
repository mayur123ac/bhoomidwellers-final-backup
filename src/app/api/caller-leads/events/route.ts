// app/api/caller-leads/events/route.ts
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { createCallerUpdateStream } from "@/lib/callerLeadEvents";

export const dynamic = "force-dynamic";

/**
 * The subscriber registry and broadcaster now live in lib/callerLeadEvents.ts.
 * They used to be declared here and imported BY other route files, which meant
 * one global, un-partitioned Set of controllers: every caller-lead change was
 * pushed to every organization's open panel. See that module for the details.
 */
export async function GET() {
  // Gated before the stream opens. An SSE endpoint holds a connection and pushes
  // every caller-lead change to whoever is listening, so leaving it open meant a
  // live feed of lead activity to an anonymous subscriber.
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  return createCallerUpdateStream(await getOrganizationId());
}
