"use client";

import { useEffect } from "react";

export type LostLeadUpdate = {
  type?: string;
  leadId?: string;
  lead?: LeadRecord;
};

export type LeadRecord = {
  id: string | number;
  [key: string]: unknown;
};

export function updateLeadLostState<T extends LeadRecord>(leads: T[], updatedLead: LeadRecord | null | undefined): T[] {
  if (!updatedLead?.id) return leads;
  return leads.map((lead) =>
    String(lead.id) === String(updatedLead.id)
      ? ({ ...lead, ...updatedLead } as T)
      : lead
  );
}

export const updateLeadRestoreState = updateLeadLostState;

export async function handleMarkLostLead(params: {
  leadId: string | number;
  reason: string;
  markedBy: string;
}) {
  const res = await fetch("/api/leads/lost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leadId: params.leadId,
      is_lost_lead: true,
      lost_reason: params.reason,
      lost_marked_by: params.markedBy,
    }),
  });
  return res.json();
}

export async function restoreLostLead(params: {
  leadId: string | number;
  restoredBy: string;
}) {
  const res = await fetch("/api/leads/restore", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leadId: params.leadId,
      is_lost_lead: false,
      restored_by: params.restoredBy,
      restored_at: new Date().toISOString(),
    }),
  });
  return res.json();
}

export const handleRestoreLead = restoreLostLead;

/** Backoff floor and ceiling between fallback resyncs, in ms. */
const FALLBACK_MIN_MS = 5_000;
const FALLBACK_MAX_MS = 120_000;

export function useLostLeadEvents(onLeadUpdate: (lead: LeadRecord) => void, onFallbackSync?: () => void) {
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = FALLBACK_MIN_MS;

    // `onerror` fires on EVERY drop, and EventSource reconnects automatically —
    // so on a flaky connection this used to trigger a FULL dashboard refetch
    // roughly every 3 seconds, indefinitely. Two guards:
    //
    //  1. A transient error where readyState is CONNECTING is the browser already
    //     reconnecting on its own. Nothing has been missed yet, so there is
    //     nothing to resync; only a CLOSED stream is a real failure.
    //  2. Real failures resync on an exponential backoff (5s → 120s) instead of
    //     once per drop, so a sustained outage costs a handful of requests rather
    //     than one every few seconds.
    const scheduleFallback = () => {
      if (closed || !onFallbackSync || fallbackTimer) return;
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (closed) return;
        onFallbackSync();
        backoffMs = Math.min(backoffMs * 2, FALLBACK_MAX_MS);
      }, backoffMs);
    };

    try {
      source = new EventSource("/api/leads/lost/events");
      source.onopen = () => {
        // A healthy stream resets the backoff, so the next outage starts at 5s.
        backoffMs = FALLBACK_MIN_MS;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      };
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as LostLeadUpdate;
          if (payload.type === "lead:lost-updated" && payload.lead) {
            onLeadUpdate(payload.lead);
          }
        } catch {}
      };
      source.onerror = () => {
        if (source?.readyState === EventSource.CONNECTING) return;
        scheduleFallback();
      };
    } catch {
      onFallbackSync?.();
    }

    // Capacitor / mobile: reconnect SSE when app comes back to foreground.
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || closed) return;
      source?.close();
      backoffMs = FALLBACK_MIN_MS;
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      try {
        source = new EventSource("/api/leads/lost/events");
        source.onopen = () => {
          backoffMs = FALLBACK_MIN_MS;
          if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        };
        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as LostLeadUpdate;
            if (payload.type === "lead:lost-updated" && payload.lead) onLeadUpdate(payload.lead);
          } catch {}
        };
        source.onerror = () => {
          if (source?.readyState === EventSource.CONNECTING) return;
          scheduleFallback();
        };
      } catch { /* ignore */ }
      onFallbackSync?.();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      closed = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      source?.close();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onLeadUpdate, onFallbackSync]);
}
