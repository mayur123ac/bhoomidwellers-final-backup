// lib/whatsappEvents.ts — the live push channel for WhatsApp conversations.
//
// Follows lib/callerLeadEvents.ts: a module-scope registry (never a route-file
// one, because a route module is not a stable singleton in Next and the registry
// can end up instantiated more than once, leaving broadcasts reaching only some
// open streams), partitioned by organization.
//
// ── One difference from the caller channel, and it matters ──────────────────
// callerLeadEvents partitions by TENANT and stops there. That is right for it:
// every subscriber on a tenant's Caller Panel is entitled to every lead in it.
//
// WhatsApp conversations are not like that. A sales manager may see the leads
// assigned to them and no others, so a tenant-wide fan-out would push another
// employee's customer messages — names, phone numbers, whatever the customer
// wrote — down their open stream. Filtering in the browser is not a fix; the
// data has already crossed the wire.
//
// So each subscriber registers with its viewer identity, and every event carries
// the ownership facts needed to decide. lib/whatsappAccess.ts owns that decision
// so the stream and the list endpoints cannot drift apart.

import type { EventVisibility, Viewer } from "./whatsappAccess";
import { canViewerSee } from "./whatsappAccess";

type Controller = ReadableStreamDefaultController;

interface Subscriber {
  controller: Controller;
  viewer: Viewer;
}

/** organization id → subscribers currently connected for that tenant. */
const byOrg = new Map<string, Set<Subscriber>>();

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
      // Optional, and omitted rather than nulled when unchanged. A mark-read
      // event carries no new message, and sending explicit nulls would make the
      // receiving list blank the preview it is already showing.
      lastMessagePreview?: string | null;
      lastMessageAt?: string | null;
      lastMessageDirection?: string | null;
      matchState: string;
      ts: number;
    };

/**
 * Push an event to the subscribers of one organization who are entitled to it.
 *
 * @param visibility the ownership facts for the conversation's lead. Required —
 *                   there is no overload that omits it, so a call site cannot
 *                   accidentally broadcast unfiltered.
 */
export function broadcastWhatsAppEvent(
  organizationId: string,
  event: WhatsAppEvent,
  visibility: EventVisibility
): void {
  const subs = byOrg.get(organizationId);
  if (!subs || subs.size === 0) return;

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const dead: Subscriber[] = [];

  subs.forEach((sub) => {
    if (!canViewerSee(sub.viewer, visibility)) return;
    try {
      sub.controller.enqueue(payload);
    } catch {
      // The stream is gone; the client navigated away or the socket dropped.
      dead.push(sub);
    }
  });

  dead.forEach((s) => subs.delete(s));
  if (subs.size === 0) byOrg.delete(organizationId);
}

function subscribe(organizationId: string, sub: Subscriber) {
  let set = byOrg.get(organizationId);
  if (!set) {
    set = new Set<Subscriber>();
    byOrg.set(organizationId, set);
  }
  set.add(sub);
}

function unsubscribe(organizationId: string, sub: Subscriber) {
  const set = byOrg.get(organizationId);
  if (!set) return;
  set.delete(sub);
  if (set.size === 0) byOrg.delete(organizationId);
}

/** Diagnostics only. */
export function subscriberCount(organizationId: string): number {
  return byOrg.get(organizationId)?.size ?? 0;
}

/**
 * Open an SSE stream for one viewer.
 *
 * The viewer is captured at connect time from the signed session. It is not
 * refreshed for the life of the stream, which is bounded by the browser tab —
 * and a role change forces re-login anyway (sessions_revoked_at), so a stream
 * cannot outlive the permissions it was opened with.
 */
export function createWhatsAppEventStream(viewer: Viewer): Response {
  let sub: Subscriber;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(ctrl) {
      sub = { controller: ctrl, viewer };
      subscribe(viewer.organizationId, sub);
      ctrl.enqueue(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);

      // 25s, same as the caller channel — under the 30s idle timeout that
      // proxies and Vercel apply.
      heartbeat = setInterval(() => {
        try {
          ctrl.enqueue(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeat);
          unsubscribe(viewer.organizationId, sub);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe(viewer.organizationId, sub);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
