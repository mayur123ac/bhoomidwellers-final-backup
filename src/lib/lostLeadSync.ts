"use client";

// lib/lostLeadSync.ts — lost/restored lead realtime sync + helpers.
//
// Migrated from SSE (EventSource → /api/leads/lost/events) to Supabase
// Realtime Broadcast. The hook signature and utility functions are preserved.

import { useEffect, useRef, useMemo } from "react";
import { useRealtimeOrg } from "./supabase/useRealtimeOrg";

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

export function useLostLeadEvents(onLeadUpdate: (lead: LeadRecord) => void, onFallbackSync?: () => void) {
  const onUpdateRef = useRef(onLeadUpdate);
  onUpdateRef.current = onLeadUpdate;
  const onFallbackRef = useRef(onFallbackSync);
  onFallbackRef.current = onFallbackSync;

  const orgId = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("crmUser");
      if (!raw) return null;
      return JSON.parse(raw)?.org || null;
    } catch { return null; }
  }, []);

  const events = useMemo(() => ({
    "lead.lost_updated": (payload: Record<string, unknown>) => {
      const lead = payload.lead as LeadRecord | undefined;
      if (lead) onUpdateRef.current(lead);
    },
  }), []);

  useRealtimeOrg({ organizationId: orgId, events });

  // One-time fallback sync on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      onFallbackRef.current?.();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);
}
