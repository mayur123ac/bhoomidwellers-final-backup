"use client";

// useNotificationFeed — the client half of /api/notifications/feed.
//
// The queue is built and tenant-scoped on the server (see
// lib/notifications/feed.ts). This hook only fetches it, polls it, and holds the
// dismissals, which are per-browser and deliberately not persisted server-side —
// dismissing a reminder is "I have seen this", not a change to the lead.
//
// There is no organization filter in here, on purpose. If a notification for
// another tenant ever reached this code, filtering it out would be hiding a
// server bug that had already disclosed the data. `assertSameOrganization`
// below therefore does not filter — it complains, loudly, in the console, so the
// failure is visible instead of cosmetically absent.

import { useCallback, useEffect, useRef, useState } from "react";

export const NOTIFICATION_POPOVER_LIMIT = 3;

export type NotificationKind = "new_lead" | "site_visit" | "follow_up";

export interface CrmNotification {
  id: string;
  kind: NotificationKind;
  leadId: number;
  organizationId: string;
  leadName: string;
  srNo: number | null;
  title: string;
  subtitle: string;
  at: string | null;
  daysSince?: number;
  visitDiff?: number;
  visitDate?: string | null;
  status?: string | null;
  interestStatus: string;
  ownerName: string;
  ownerRole: string;
}

/**
 * The window the Sales panel's Site Visit bell has always used: today and
 * tomorrow.
 *
 * The server returns a wider window (three days back to two days out) because
 * the Admin bell and the Notification Center both want it. Narrowing here is a
 * DISPLAY choice about which visits count as "coming up", made on data the
 * server has already scoped to this organization — it is not, and must never
 * become, how a tenant boundary is enforced.
 */
export function withinNextDay(items: CrmNotification[]): CrmNotification[] {
  return items.filter((n) => (n.visitDiff ?? 0) >= 0 && (n.visitDiff ?? 0) <= 1);
}

export interface NotificationFeedState {
  newLeads: CrmNotification[];
  siteVisits: CrmNotification[];
  followUps: CrmNotification[];
  all: CrmNotification[];
  organizationId: string | null;
  isLoading: boolean;
  refetch: () => void;
  /** Per-browser "I have seen this". */
  dismiss: (id: string) => void;
  dismissed: Set<string>;
}

const EMPTY: CrmNotification[] = [];

/** Poll interval. Matches the dashboards' own lead refresh cadence. */
const POLL_MS = 60_000;

function assertSameOrganization(items: CrmNotification[], organizationId: string | null) {
  if (!organizationId) return;
  const foreign = items.filter((n) => n.organizationId && n.organizationId !== organizationId);
  if (foreign.length > 0) {
    // Deliberately not filtered out. See the header: a foreign notification here
    // means the server already sent another tenant's data, and quietly removing
    // it from the list would turn a security incident into a rendering detail.
    console.error(
      "[notifications] TENANT MISMATCH — the server returned notifications for another organization:",
      foreign.map((n) => ({ id: n.id, leadId: n.leadId, organizationId: n.organizationId }))
    );
  }
}

export function useNotificationFeed(options?: {
  followUpReminders?: boolean;
  siteVisitAlerts?: boolean;
  enabled?: boolean;
}): NotificationFeedState {
  const followUpReminders = options?.followUpReminders !== false;
  const siteVisitAlerts = options?.siteVisitAlerts !== false;
  const enabled = options?.enabled !== false;

  const [newLeads, setNewLeads] = useState<CrmNotification[]>(EMPTY);
  const [siteVisits, setSiteVisits] = useState<CrmNotification[]>(EMPTY);
  const [followUps, setFollowUps] = useState<CrmNotification[]>(EMPTY);
  const [all, setAll] = useState<CrmNotification[]>(EMPTY);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(false);

  const fetchFeed = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const qs = new URLSearchParams();
      if (!followUpReminders) qs.set("followUpReminders", "off");
      if (!siteVisitAlerts) qs.set("siteVisitAlerts", "off");
      const res = await fetch(`/api/notifications/feed?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (!json?.success) return;

      const org: string | null = json.organizationId ?? null;
      const data = json.data ?? {};
      assertSameOrganization(data.all ?? [], org);

      setOrganizationId(org);
      setNewLeads(data.newLeads ?? EMPTY);
      setSiteVisits(data.siteVisits ?? EMPTY);
      setFollowUps(data.followUps ?? EMPTY);
      setAll(data.all ?? EMPTY);
    } catch {
      /* transient; the next poll retries */
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [enabled, followUpReminders, siteVisitAlerts]);

  useEffect(() => {
    fetchFeed();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchFeed();
    }, POLL_MS);
    const onVisible = () => { if (!document.hidden) fetchFeed(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchFeed]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const visible = (items: CrmNotification[]) => items.filter((n) => !dismissed.has(n.id));

  return {
    newLeads: visible(newLeads),
    siteVisits: visible(siteVisits),
    followUps: visible(followUps),
    all: visible(all),
    organizationId,
    isLoading,
    refetch: fetchFeed,
    dismiss,
    dismissed,
  };
}

/**
 * Open the lead a notification points at.
 *
 * Always goes through the server check first. The dashboards hold their own
 * organization-scoped lead list and could open the panel straight from it, but
 * then the only thing standing between a lead id and a Lead Detail panel would
 * be whatever the client happened to have loaded. Asking the server "may this
 * session open lead N" makes the answer authoritative, and it is the same check
 * whether the id came from a notification, a deep link or a hand-typed URL.
 *
 * Resolves to the lead's identity on success, or null when the lead does not
 * exist for this session's organization.
 */
export async function openNotificationLead(
  leadId: number | string
): Promise<{ id: number; name: string; srNo: number | null } | null> {
  try {
    const res = await fetch("/api/notifications/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.success ? json.data : null;
  } catch {
    return null;
  }
}
