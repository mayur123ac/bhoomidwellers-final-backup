// eventBus.ts — Live Activity event broadcast.
//
// The SSE subscriber registry (global.sseClients) has been removed.
// Broadcasts are now delivered via Supabase Realtime (broadcastToOrg
// at each API call site). This module is retained because multiple API
// routes still import broadcastEvent() — those call sites also invoke
// broadcastToOrg() directly.

/**
 * Legacy broadcast function. SSE delivery has been removed; Supabase
 * Realtime broadcast is called directly at each API route alongside
 * this call.
 */
export function broadcastEvent(
  _organizationId: string,
  _event: any,
  _targetRoles?: string[],
  _targetUserId?: number
) {
  // SSE removed — Supabase broadcast is handled at each call site
}

/** Legacy — kept for API compatibility with the SSE live-activity route. */
export function addSSEClient(_client: any) {}
export function removeSSEClient(_id: string) {}
