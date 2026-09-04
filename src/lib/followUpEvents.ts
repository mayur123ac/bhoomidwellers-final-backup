// followUpEvents.ts — follow-up event types and broadcast.
//
// The SSE subscriber registry and stream factory have been removed.
// Broadcasts are now delivered via Supabase Realtime (see broadcastToOrg
// calls at each API call site). This module is retained for its type
// exports and the broadcastFollowUp() function signature which the
// reminderEvents module delegates through.

// ── Event types ─────────────────────────────────────────────────────────────

export type FollowUpEvent =
  | { type: "followup:created"; followUp: FollowUpPayload }
  | { type: "followup:read";    ids: number[]; leadId: number; readAt: string; readBy: string }
  | { type: "connected";        ts: number };

export interface FollowUpPayload {
  _id: string;
  leadId: string;
  salesManagerName: string;
  createdBy: string;
  message: string;
  siteVisitDate: string | null;
  createdAt: string;
  followUpType: string;
  createdByRole: string | null;
  sentToRole: string | null;
  sentToUserId: number | null;
  parentFollowUpId: number | null;
  readAt: string | null;
  clientMessageId?: string;
}

// ── Broadcast (no-op for SSE, Supabase handled at call sites) ───────────────

/**
 * Legacy broadcast function. SSE delivery has been removed; Supabase Realtime
 * broadcast is called directly at each API route. This function is retained
 * because reminderEvents.ts delegates through it — those calls are also
 * backed by their own broadcastToOrg() calls now.
 */
export function broadcastFollowUp(_organizationId: string, _event: FollowUpEvent) {
  // SSE removed — Supabase broadcast is handled at each call site
}
