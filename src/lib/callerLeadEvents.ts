// callerLeadEvents.ts — caller lead event broadcast.
//
// The SSE subscriber registry and stream factory have been removed.
// Broadcasts are now delivered via Supabase Realtime.

import { broadcastToOrg } from "./supabase/broadcast";

/**
 * Broadcast a caller-lead event to the organization's Supabase channel.
 */
export function broadcastCallerUpdate(organizationId: string, data: object) {
  const eventType = (data as any)?.type;
  const eventName = eventType ? `caller.${eventType}` : "caller.update";
  broadcastToOrg(organizationId, eventName, data as Record<string, unknown>);
}
