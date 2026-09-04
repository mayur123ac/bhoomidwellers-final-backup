"use client";

// lib/followUpSync.ts — follow-up + reminder realtime sync.
//
// Migrated from SSE (EventSource → /api/followups/events) to Supabase
// Realtime Broadcast. The hook signature is preserved so every dashboard
// caller works without changes.

import { useEffect, useRef, useMemo } from "react";
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
) {
  const onNewRef = useRef(onNewFollowUp);
  onNewRef.current = onNewFollowUp;
  const onReadRef = useRef(onReadReceipt);
  onReadRef.current = onReadReceipt;
  const onFallbackRef = useRef(onFallbackSync);
  onFallbackRef.current = onFallbackSync;
  const onReminderDueRef = useRef(onReminderDue);
  onReminderDueRef.current = onReminderDue;

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
