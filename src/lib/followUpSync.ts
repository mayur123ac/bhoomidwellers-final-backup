"use client";

// lib/followUpSync.ts — follow-up + reminder realtime sync.
//
// Migrated from SSE (EventSource → /api/followups/events) to Supabase
// Realtime Broadcast. The hook signature is preserved so every dashboard
// caller works without changes.

import { useEffect, useRef, useMemo, useCallback } from "react";
import { useRealtimeOrg } from "./supabase/useRealtimeOrg";

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

export type FollowUpDeletedSSEPayload = {
  followUpId: string;
  leadId: string;
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

/**
 * Subscribe to follow-up and reminder events via Supabase Realtime.
 *
 * Signature matches the original SSE hook so callers do not need changes.
 * The organizationId parameter is resolved from the CRM user stored in
 * localStorage (same source as the dashboard pages).
 */
export function useFollowUpEvents(
  onNewFollowUp: (followUp: FollowUpSSEPayload) => void,
  onReadReceipt?: (payload: FollowUpReadSSEPayload) => void,
  onFallbackSync?: () => void,
  onReminderDue?: (reminder: ReminderSSEPayload) => void,
  onFollowUpDeleted?: (payload: FollowUpDeletedSSEPayload) => void,
) {
  const onNewRef = useRef(onNewFollowUp);
  onNewRef.current = onNewFollowUp;
  const onReadRef = useRef(onReadReceipt);
  onReadRef.current = onReadReceipt;
  const onFallbackRef = useRef(onFallbackSync);
  onFallbackRef.current = onFallbackSync;
  const onReminderDueRef = useRef(onReminderDue);
  onReminderDueRef.current = onReminderDue;
  const onDeletedRef = useRef(onFollowUpDeleted);
  onDeletedRef.current = onFollowUpDeleted;

  // Resolve org from stored CRM user (same as dashboard pages)
  const orgId = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("crmUser");
      if (!raw) return null;
      const u = JSON.parse(raw);
      return u?.org || null;
    } catch { return null; }
  }, []);

  const events = useMemo(() => ({
    "followup.created": (payload: Record<string, unknown>) => {
      const followUp = payload.followUp as FollowUpSSEPayload | undefined;
      if (followUp) onNewRef.current(followUp);
    },
    "followup.read": (payload: Record<string, unknown>) => {
      if (payload.ids) onReadRef.current?.(payload as unknown as FollowUpReadSSEPayload);
    },
    "reminder.created": (_payload: Record<string, unknown>) => {
      // Reminder created — no client action needed beyond awareness
    },
    "reminder.due": (payload: Record<string, unknown>) => {
      const reminder = payload.reminder as ReminderSSEPayload | undefined;
      if (reminder) onReminderDueRef.current?.(reminder);
    },
    "reminder.updated": (_payload: Record<string, unknown>) => {
      // Reminder updated — client can refetch if needed
    },
    "followup.deleted": (payload: Record<string, unknown>) => {
      const p = payload as unknown as FollowUpDeletedSSEPayload;
      if (p.followUpId) {
        onDeletedRef.current?.(p);
      } else {
        // Fallback: full refetch if payload is malformed
        onFallbackRef.current?.();
      }
    },
  }), []);

  useRealtimeOrg({ organizationId: orgId, events });

  // Run a one-time fallback sync on mount to catch anything missed before
  // the realtime channel was established (same purpose as the SSE onopen sync).
  useEffect(() => {
    const timer = setTimeout(() => {
      onFallbackRef.current?.();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);
}

// ── Lead-scoped follow-up polling ───────────────────────────────────────────
//
// Reliable fallback for cross-user real-time delivery. When a lead's detail
// panel is open, polls that single lead's follow-ups via the indexed
// ?lead_id= query (0.03 ms on the server). Stops immediately when the lead
// is deselected. This ensures new messages appear within a few seconds even
// when Supabase Realtime is not delivering events.

const LEAD_POLL_INTERVAL_MS = 8_000;

/**
 * Poll follow-ups for a single lead at a short interval.
 *
 * @param leadId   — the currently-selected lead's ID (null/undefined = off)
 * @param onUpdate — called with (leadId, serverFollowUps[]) on each successful poll
 */
export function useLeadFollowUpPolling(
  leadId: string | number | null | undefined,
  onUpdate: (leadId: string, followUps: FollowUpSSEPayload[]) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!leadId) return;
    let active = true;
    const lid = String(leadId);

    const poll = async () => {
      try {
        const res = await fetch(`/api/followups?lead_id=${lid}`);
        if (!res.ok || !active) return;
        const json = await res.json();
        if (active && json.success && Array.isArray(json.data)) {
          onUpdateRef.current(lid, json.data);
        }
      } catch { /* network errors are harmless — next poll retries */ }
    };

    const timer = setInterval(poll, LEAD_POLL_INTERVAL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [leadId]);
}

/**
 * Build a stable merge callback for lead-scoped polling.
 *
 * Replaces the follow-ups for one lead with fresh server data while
 * preserving any in-flight optimistic entries (_status === "sending").
 */
export function useMergeLeadFollowUps(
  setFollowUps: React.Dispatch<React.SetStateAction<any[]>>,
  setFupsByLead?: React.Dispatch<React.SetStateAction<Map<string, any[]>>>,
) {
  return useCallback((lid: string, serverData: any[]) => {
    const serverIds = new Set(serverData.map((f: any) => String(f._id)));

    setFollowUps(prev => {
      const otherLeads = prev.filter(f => String(f.leadId) !== lid);
      // Preserve optimistic entries not yet confirmed by the server
      const optimistic = prev.filter(f =>
        String(f.leadId) === lid &&
        f._status === "sending" &&
        !serverIds.has(String(f._id))
      );
      return [...otherLeads, ...serverData, ...optimistic];
    });

    setFupsByLead?.(prev => {
      const next = new Map(prev);
      const existing = next.get(lid) ?? [];
      const optimistic = existing.filter((f: any) =>
        f._status === "sending" &&
        !serverIds.has(String(f._id))
      );
      next.set(lid, [...serverData, ...optimistic]);
      return next;
    });
  }, [setFollowUps, setFupsByLead]);
}
