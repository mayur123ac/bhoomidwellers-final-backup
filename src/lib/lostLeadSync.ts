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

export function useLostLeadEvents(onLeadUpdate: (lead: LeadRecord) => void, onFallbackSync?: () => void) {
  useEffect(() => {
    let source: EventSource | null = null;

    try {
      source = new EventSource("/api/leads/lost/events");
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as LostLeadUpdate;
          if (payload.type === "lead:lost-updated" && payload.lead) {
            onLeadUpdate(payload.lead);
          }
        } catch {}
      };
      source.onerror = () => {
        onFallbackSync?.();
      };
    } catch {
      onFallbackSync?.();
    }

    return () => {
      source?.close();
    };
  }, [onLeadUpdate, onFallbackSync]);
}
