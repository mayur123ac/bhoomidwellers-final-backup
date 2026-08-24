// lib/hooks/useWhatsAppSync.ts — live conversation updates over SSE.
//
// Modelled on useCallerSync: one EventSource, callbacks kept in a ref so the
// stream is not torn down and rebuilt on every parent render, and exponential
// backoff on reconnect.
//
// ── Why the callbacks live in a ref ─────────────────────────────────────────
// The obvious version puts `options` in the effect's dependency array. Because
// callers pass inline arrow functions, that array changes identity on every
// render, so the effect re-runs, the EventSource is closed and reopened, and the
// browser opens a new connection several times a second. useCallerSync carries a
// comment about exactly this. The ref keeps the handlers current while the effect
// depends on nothing.

import { useEffect, useRef } from "react";

export type WhatsAppSyncEvent =
  | { type: "connected"; ts: number }
  | {
      type: "message_created";
      conversationId: number;
      leadId: number | null;
      message: any;
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

interface Options {
  enabled?: boolean;
  onMessage?: (e: Extract<WhatsAppSyncEvent, { type: "message_created" }>) => void;
  onStatus?: (e: Extract<WhatsAppSyncEvent, { type: "message_status" }>) => void;
  onConversation?: (e: Extract<WhatsAppSyncEvent, { type: "conversation_updated" }>) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function useWhatsAppSync(options: Options) {
  const optsRef = useRef(options);
  optsRef.current = options;

  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1_000;

    const connect = () => {
      if (cancelled) return;

      es = new EventSource("/api/whatsapp/events");

      es.onopen = () => {
        delay = 1_000;
        optsRef.current.onConnectionChange?.(true);
      };

      es.onmessage = (ev) => {
        if (!ev.data || ev.data.startsWith(":")) return;
        let event: WhatsAppSyncEvent;
        try {
          event = JSON.parse(ev.data);
        } catch {
          return;
        }

        const o = optsRef.current;
        switch (event.type) {
          case "message_created":
            o.onMessage?.(event);
            break;
          case "message_status":
            o.onStatus?.(event);
            break;
          case "conversation_updated":
            o.onConversation?.(event);
            break;
        }
      };

      es.onerror = () => {
        // EventSource reconnects on its own while it is CONNECTING; intervening
        // would produce two live streams. Only a CLOSED stream is ours to
        // rebuild.
        if (es?.readyState === EventSource.CONNECTING) {
          optsRef.current.onConnectionChange?.(false);
          return;
        }
        optsRef.current.onConnectionChange?.(false);
        es?.close();
        es = null;
        if (cancelled) return;
        retryTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [enabled]);
}
