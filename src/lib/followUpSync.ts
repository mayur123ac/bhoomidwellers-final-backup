"use client";

import { useEffect, useCallback, useRef } from "react";

export type FollowUpSSEPayload = {
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
};

export type FollowUpReadSSEPayload = {
  ids: number[];
  leadId: number;
  readAt: string;
  readBy: string;
};

export type ReminderSSEPayload = {
  id: number;
  leadId: number;
  leadName?: string;
  leadPhone?: string;
  assignedUserId: number;
  assignedUserName?: string;
  createdByName: string;
  reminderType: string;
  note: string | null;
  remindAt: string;
  status: string;
  notifiedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
};

const FALLBACK_MIN_MS = 5_000;
const FALLBACK_MAX_MS = 120_000;

/**
 * Subscribe to follow-up SSE events. Mirrors useLostLeadEvents exactly:
 * exponential backoff on real failures, auto-reconnect on transient drops,
 * and an optional fallback sync for recovery.
 */
export function useFollowUpEvents(
  onNewFollowUp: (followUp: FollowUpSSEPayload) => void,
  onReadReceipt?: (payload: FollowUpReadSSEPayload) => void,
  onFallbackSync?: () => void,
  onReminderDue?: (reminder: ReminderSSEPayload) => void,
) {
  // Stable refs so the EventSource callbacks always see the latest handler
  // without re-creating the stream on every render.
  const onNewRef = useRef(onNewFollowUp);
  onNewRef.current = onNewFollowUp;
  const onReadRef = useRef(onReadReceipt);
  onReadRef.current = onReadReceipt;
  const onFallbackRef = useRef(onFallbackSync);
  onFallbackRef.current = onFallbackSync;
  const onReminderDueRef = useRef(onReminderDue);
  onReminderDueRef.current = onReminderDue;

  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = FALLBACK_MIN_MS;

    const scheduleFallback = () => {
      if (closed || !onFallbackRef.current || fallbackTimer) return;
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (closed) return;
        onFallbackRef.current?.();
        backoffMs = Math.min(backoffMs * 2, FALLBACK_MAX_MS);
      }, backoffMs);
    };

    try {
      source = new EventSource("/api/followups/events");
      source.onopen = () => {
        backoffMs = FALLBACK_MIN_MS;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      };
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "followup:created" && payload.followUp) {
            onNewRef.current(payload.followUp);
          } else if (payload.type === "followup:read" && payload.ids) {
            onReadRef.current?.(payload);
          } else if (payload.type === "reminder:due" && payload.reminder) {
            onReminderDueRef.current?.(payload.reminder);
          }
        } catch { /* malformed event, ignore */ }
      };
      source.onerror = () => {
        if (source?.readyState === EventSource.CONNECTING) return;
        scheduleFallback();
      };
    } catch {
      onFallbackRef.current?.();
    }

    // Capacitor / mobile: when the app backgrounds, Android may kill the SSE
    // connection silently. On foreground, close the stale source, reconnect,
    // and run a fallback sync to catch anything missed.
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || closed) return;
      source?.close();
      backoffMs = FALLBACK_MIN_MS;
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      try {
        source = new EventSource("/api/followups/events");
        source.onopen = () => {
          backoffMs = FALLBACK_MIN_MS;
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        };
        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "followup:created" && payload.followUp) onNewRef.current(payload.followUp);
            else if (payload.type === "followup:read" && payload.ids) onReadRef.current?.(payload);
            else if (payload.type === "reminder:due" && payload.reminder) onReminderDueRef.current?.(payload.reminder);
          } catch { /* ignore */ }
        };
        source.onerror = () => {
          if (source?.readyState === EventSource.CONNECTING) return;
          scheduleFallback();
        };
      } catch { /* ignore */ }
      onFallbackRef.current?.();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      closed = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      source?.close();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []); // intentionally empty — refs handle callback identity
}
