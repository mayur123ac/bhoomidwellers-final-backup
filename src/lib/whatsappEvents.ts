// lib/whatsappEvents.ts — WhatsApp conversation event broadcast.
//
// The SSE subscriber registry and stream factory have been removed.
// Broadcasts are now delivered via Supabase Realtime with visibility
// metadata so clients can apply viewer-level filtering locally.

import type { EventVisibility } from "./whatsappAccess";
import { broadcastToOrg } from "./supabase/broadcast";

export type WhatsAppEvent =
  | { type: "connected"; ts: number }
  | {
      type: "message_created";
      conversationId: number;
      leadId: number | null;
      message: unknown;
      unreadCount: number;
      ts: number;
    }
  | {
      type: "message_status";
      conversationId: number;
      leadId: number | null;
      messageId: string;
      status: string;
      deliveredAt?: string | null;
      readAt?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      ts: number;
    }
  | {
      type: "conversation_updated";
      conversationId: number;
      leadId: number | null;
      unreadCount: number;
      lastMessagePreview?: string | null;
      lastMessageAt?: string | null;
      lastMessageDirection?: string | null;
      matchState: string;
      ts: number;
    };

/**
 * Broadcast a WhatsApp event to the organization's Supabase channel.
 *
 * Includes visibility metadata so clients can apply the same viewer-level
 * filtering that the SSE broadcaster used to do server-side.
 */
export function broadcastWhatsAppEvent(
  organizationId: string,
  event: WhatsAppEvent,
  visibility: EventVisibility
): void {
  const eventName = event.type === "connected" ? "whatsapp.connected" : `whatsapp.${event.type}`;
  broadcastToOrg(organizationId, eventName, {
    ...event,
    _visibility: visibility,
  } as Record<string, unknown>);
}
