// api/whatsapp/events/route.ts — SSE stream for live conversation updates.
//
// The viewer identity is resolved from the SIGNED session here, once, and handed
// to the registry. Nothing about who the subscriber is comes from the request:
// no role header, no org query parameter. That is what makes the per-subscriber
// filtering in lib/whatsappEvents.ts trustworthy — a client cannot widen its own
// visibility by asking to.

import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { createWhatsAppEventStream } from "@/lib/whatsappEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  return createWhatsAppEventStream({
    userId: gate.userId,
    name: gate.session.name || gate.session.email || "",
    role: gate.session.role,
    organizationId: await getOrganizationId(),
  });
}
