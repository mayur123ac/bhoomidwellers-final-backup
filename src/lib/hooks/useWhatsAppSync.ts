// lib/hooks/useWhatsAppSync.ts — WhatsApp conversation realtime sync.
//
// Migrated from SSE (EventSource → /api/whatsapp/events) to Supabase
// Realtime Broadcast. The hook signature and event types are preserved.
//
// WhatsApp events include _visibility metadata so the client can apply
// the same viewer-level filtering that the SSE broadcaster used to do
// server-side. This preserves the security property that a sales manager
// does not see conversations for leads assigned to someone else, even
// though the transport is now org-wide.

import { useRef, useMemo } from "react";
import { useRealtimeOrg } from "../supabase/useRealtimeOrg";

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

/** Viewer-level access check matching lib/whatsappAccess.ts canViewerSee(). */
const FULL_ACCESS_ROLES = ["admin", "super admin"];
const UNMATCHED_VISIBILITY_ROLES = ["admin", "super admin", "site head"];
const OWNERSHIP_COLUMNS: Record<string, readonly string[]> = {
  receptionist: ["assignedTo", "assignedReceptionist"],
  "site head": ["assignedTo", "overseeingSiteHead"],
  "sales manager": ["assignedTo"],
};

function normalizeRole(r: unknown): string {
  return String(r ?? "").trim().toLowerCase().replace(/_/g, " ");
}

function eq(a: string | null | undefined, b: string): boolean {
  return String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

type VisibilityMeta = {
  leadId?: number | null;
  matchState?: string;
  assignedTo?: string | null;
  assignedReceptionist?: string | null;
  overseeingSiteHead?: string | null;
  // FK user-id fields added by loadVisibility() after the FK migration.
  assignedToUserId?: number | null;
  assignedReceptionistUserId?: number | null;
  overseeingSiteHeadUserId?: number | null;
};

function canViewerSeeEvent(
  viewerRole: string,
  viewerName: string,
  viewerUserId: number | null,
  visibility: VisibilityMeta | undefined
): boolean {
  if (!visibility) return true; // no visibility metadata = show to all
  const role = normalizeRole(viewerRole);
  if (FULL_ACCESS_ROLES.includes(role)) return true;
  if (visibility.matchState !== "matched") return UNMATCHED_VISIBILITY_ROLES.includes(role);
  const cols = OWNERSHIP_COLUMNS[role];
  if (!cols || cols.length === 0) return false;
  for (const col of cols) {
    if (col === "assignedTo") {
      if (visibility.assignedToUserId !== undefined) {
        if (visibility.assignedToUserId !== null && viewerUserId !== null && visibility.assignedToUserId === viewerUserId) return true;
        if (visibility.assignedToUserId === null && eq(visibility.assignedTo, viewerName)) return true;
      } else if (eq(visibility.assignedTo, viewerName)) return true;
    }
    if (col === "assignedReceptionist") {
      if (visibility.assignedReceptionistUserId !== undefined) {
        if (visibility.assignedReceptionistUserId !== null && viewerUserId !== null && visibility.assignedReceptionistUserId === viewerUserId) return true;
        if (visibility.assignedReceptionistUserId === null && eq(visibility.assignedReceptionist, viewerName)) return true;
      } else if (eq(visibility.assignedReceptionist, viewerName)) return true;
    }
    if (col === "overseeingSiteHead") {
      if (visibility.overseeingSiteHeadUserId !== undefined) {
        if (visibility.overseeingSiteHeadUserId !== null && viewerUserId !== null && visibility.overseeingSiteHeadUserId === viewerUserId) return true;
        if (visibility.overseeingSiteHeadUserId === null && eq(visibility.overseeingSiteHead, viewerName)) return true;
      } else if (eq(visibility.overseeingSiteHead, viewerName)) return true;
    }
  }
  return false;
}

export function useWhatsAppSync(options: Options) {
  const optsRef = useRef(options);
  optsRef.current = options;

  const enabled = options.enabled !== false;

  const crmUser = useMemo(() => {
    if (typeof window === "undefined") return { org: null, role: "", name: "", userId: null as number | null };
    try {
      const raw = localStorage.getItem("crmUser");
      if (!raw) return { org: null, role: "", name: "", userId: null as number | null };
      const u = JSON.parse(raw);
      const rawId = u?._id ?? u?.id;
      const userId: number | null = rawId != null && Number.isFinite(Number(rawId)) ? Number(rawId) : null;
      return { org: u?.org || null, role: u?.role || "", name: u?.name || u?.email || "", userId };
    } catch { return { org: null, role: "", name: "", userId: null as number | null }; }
  }, []);

  const events = useMemo(() => ({
    "whatsapp.message_created": (payload: Record<string, unknown>) => {
      const v = payload._visibility as VisibilityMeta | undefined;
      if (!canViewerSeeEvent(crmUser.role, crmUser.name, crmUser.userId, v)) return;
      optsRef.current.onMessage?.(payload as any);
    },
    "whatsapp.message_status": (payload: Record<string, unknown>) => {
      const v = payload._visibility as VisibilityMeta | undefined;
      if (!canViewerSeeEvent(crmUser.role, crmUser.name, crmUser.userId, v)) return;
      optsRef.current.onStatus?.(payload as any);
    },
    "whatsapp.conversation_updated": (payload: Record<string, unknown>) => {
      const v = payload._visibility as VisibilityMeta | undefined;
      if (!canViewerSeeEvent(crmUser.role, crmUser.name, crmUser.userId, v)) return;
      optsRef.current.onConversation?.(payload as any);
    },
  }), [crmUser.role, crmUser.name, crmUser.userId]);

  useRealtimeOrg({
    organizationId: crmUser.org,
    events,
    enabled,
  });
}
