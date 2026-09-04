// lib/hooks/useCallerSync.ts — caller panel realtime sync via Supabase.
//
// Migrated from SSE (EventSource → /api/caller-leads/events) to Supabase
// Realtime Broadcast. The hook signature and event types are preserved.

import { useRef, useMemo } from "react";
import { useRealtimeOrg } from "../supabase/useRealtimeOrg";

export type SyncEvent =
  | { type: "connected"; ts: number }
  | { type: "leads_uploaded"; batchId: string; count: number; fileName: string; uploadedBy: string; assignedTo: string; ts: number }
  | { type: "batch_deleted"; batchId: string; ts: number }
  | { type: "lead_updated"; leadId: number; changes: Record<string, any>; ts: number }
  | { type: "lead_deleted"; leadId: number; ts: number }
  | { type: "followup_added"; leadId: number; followUp: any; ts: number };

interface UseCallerSyncOptions {
  onLeadsUploaded?: (event: Extract<SyncEvent, { type: "leads_uploaded" }>) => void;
  onBatchDeleted?:  (event: Extract<SyncEvent, { type: "batch_deleted" }>) => void;
  onLeadUpdated?:   (event: Extract<SyncEvent, { type: "lead_updated" }>) => void;
  onLeadDeleted?:   (event: Extract<SyncEvent, { type: "lead_deleted" }>) => void;
  onFollowupAdded?: (event: Extract<SyncEvent, { type: "followup_added" }>) => void;
  onLeadOwnershipChanged?: (event: Extract<SyncEvent, { type: "lead_updated" }>) => void;
}

export function useCallerSync(options: UseCallerSyncOptions) {
  const optsRef = useRef(options);
  optsRef.current = options;

  const orgId = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("crmUser");
      if (!raw) return null;
      return JSON.parse(raw)?.org || null;
    } catch { return null; }
  }, []);

  const events = useMemo(() => ({
    "caller.leads_uploaded": (payload: Record<string, unknown>) => {
      optsRef.current.onLeadsUploaded?.(payload as any);
    },
    "caller.batch_deleted": (payload: Record<string, unknown>) => {
      optsRef.current.onBatchDeleted?.(payload as any);
    },
    "caller.lead_updated": (payload: Record<string, unknown>) => {
      optsRef.current.onLeadUpdated?.(payload as any);
      const changes = (payload as any).changes;
      if (changes?.saved_by || changes?.status === "saved") {
        optsRef.current.onLeadOwnershipChanged?.(payload as any);
      }
    },
    "caller.lead_deleted": (payload: Record<string, unknown>) => {
      optsRef.current.onLeadDeleted?.(payload as any);
    },
    "caller.followup_added": (payload: Record<string, unknown>) => {
      optsRef.current.onFollowupAdded?.(payload as any);
    },
  }), []);

  useRealtimeOrg({ organizationId: orgId, events });
}
