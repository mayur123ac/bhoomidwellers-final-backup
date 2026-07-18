// lib/hooks/useCallerSync.ts
import { useEffect, useRef } from "react";

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
  // ✅ New — called when another caller claims ownership of a lead
  onLeadOwnershipChanged?: (event: Extract<SyncEvent, { type: "lead_updated" }>) => void;
}

export function useCallerSync(options: UseCallerSyncOptions) {
  const esRef      = useRef<EventSource | null>(null);
  const optsRef    = useRef(options);
  const retryDelay = useRef(1_000); // ✅ Exponential backoff
  optsRef.current  = options;

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      const es = new EventSource("/api/caller-leads/events");
      esRef.current = es;

      es.onopen = () => {
        retryDelay.current = 1_000; // ✅ Reset backoff on successful connect
      };

      es.onmessage = (e) => {
        // Ignore SSE heartbeat comments (they never reach onmessage anyway,
        // but guard against malformed pings just in case)
        if (!e.data || e.data.startsWith(":")) return;

        try {
          const event: SyncEvent = JSON.parse(e.data);
          const opts = optsRef.current;

          switch (event.type) {
            case "leads_uploaded":
              opts.onLeadsUploaded?.(event);
              break;

            case "batch_deleted":
              opts.onBatchDeleted?.(event);
              break;

            case "lead_updated":
              opts.onLeadUpdated?.(event);
              // ✅ If another caller just claimed this lead, fire ownership callback
              // so the panel can immediately reload and show the lock
              if (event.changes.saved_by || event.changes.status === "saved") {
                opts.onLeadOwnershipChanged?.(event);
              }
              break;

            case "lead_deleted":
              opts.onLeadDeleted?.(event);
              break;

            case "followup_added":
              opts.onFollowupAdded?.(event);
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        if (!cancelled) {
          // ✅ Exponential backoff: 1s → 2s → 4s → max 30s
          setTimeout(connect, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, []);
}