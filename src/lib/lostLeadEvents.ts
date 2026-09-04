// lostLeadEvents.ts — lost/restored lead event broadcast.
//
// The SSE subscriber registry and stream factory have been removed.
// Broadcasts are now delivered via Supabase Realtime (broadcastToOrg
// at each API call site).

/**
 * Legacy broadcast function. SSE delivery has been removed; Supabase
 * Realtime broadcast is called directly at each API route.
 */
export function broadcastLeadUpdate(_organizationId: string, _data: object) {
  // SSE removed — Supabase broadcast is handled at each call site
}
