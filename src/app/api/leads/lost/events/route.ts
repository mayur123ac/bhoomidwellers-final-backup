//api/leads/lost/events/route.ts
import { createLeadUpdateStream } from "@/lib/lostLeadEvents";
import { requireSession } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  // Live push of lost/restored lead events; gated before the stream opens.
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  return createLeadUpdateStream();
}
