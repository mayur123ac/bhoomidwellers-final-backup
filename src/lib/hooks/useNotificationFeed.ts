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
//
// ── Notification sound ───────────────────────────────────────────────────────
// When `options.playSound` is true this hook detects genuinely NEW notifications
// on each poll and plays /assets/notification1.mp3 for each one, subject to the
// user's saved inApp preferences (browser, sound, DND).
//
// "Genuinely new" means: not present in the very first fetch (page load) and not
// already seen in a previous poll. IDs are tracked in a ref so reconnects and
// re-renders never replay a sound for an already-known notification.
//
// The sound trigger is intentionally here rather than in individual dashboards so
// that every notification source (new leads, site visits, follow-ups) plays the
// same sound through the same gate.

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Sound helpers (module-level — shared across hook instances) ────────────
   Module scope rather than component scope so the prefs cache and audio state
   are shared when multiple hook instances exist on the same page. */

interface _InAppPrefs {
  browser: boolean;
  sound: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

let _prefCache: _InAppPrefs | null = null;
let _prefCacheAt = 0;
const _PREFS_TTL_MS = 60_000;

/** Fetch inApp prefs from the settings endpoint, with a 60-second client cache. */
async function _fetchInAppPrefs(): Promise<_InAppPrefs> {
  const now = Date.now();
  if (_prefCache && now - _prefCacheAt < _PREFS_TTL_MS) return _prefCache;
  try {
    const res = await fetch("/api/settings/notifications", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { success: boolean; prefs?: { inApp?: _InAppPrefs } };
      if (json?.success && json?.prefs?.inApp) {
        _prefCache = json.prefs.inApp;
        _prefCacheAt = now;
        return _prefCache;
      }
    }
  } catch {
    /* Transient — fall through to defaults. */
  }
  // Conservative defaults: never auto-play if prefs are unreadable.
  return { browser: true, sound: false, dndEnabled: false, dndStart: "22:00", dndEnd: "08:00" };
}

/** True when the current wall-clock time falls inside the user's DND window. */
function _isDndActive(prefs: _InAppPrefs): boolean {
  if (!prefs.dndEnabled) return false;
  const now = new Date();
  const hhmm =
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const { dndStart, dndEnd } = prefs;
  // Same-day window (e.g. 09:00–17:00)
  if (dndStart <= dndEnd) return hhmm >= dndStart && hhmm < dndEnd;
  // Cross-midnight window (e.g. 22:00–08:00)
  return hhmm >= dndStart || hhmm < dndEnd;
}

/**
 * Play /assets/notification1.mp3 once.
 *
 * Browser autoplay policy may block this if the user has not yet interacted
 * with the page. The rejection is caught silently — no error is logged and no
 * retry is attempted, per spec.
 */
function _playNotificationSound(): void {
  if (typeof window === "undefined") return; // SSR guard
  try {
    const audio = new Audio("/assets/notification1.mp3");
    const promise = audio.play();
    if (promise !== undefined) {
      promise.catch(() => {
        // Autoplay blocked by browser policy — silently ignored.
      });
    }
  } catch {
    // Audio constructor unavailable — silently ignored.
  }
}

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
const POLL_MS = 120_000;

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
  /**
   * When true, plays /assets/notification1.mp3 for each genuinely new
   * notification detected after the initial page load.
   *
   * "Genuinely new" means: not present in the first fetch (so page-load
   * notifications never trigger sound) and not already seen in any earlier
   * poll (so reconnects never replay).
   *
   * Sound is only played when the user's inApp preferences allow it:
   *   browser=true AND sound=true AND DND is not currently active.
   *
   * Only ONE caller per page should pass playSound=true. Child components
   * (e.g. SalesSettingsBells) that also call this hook on the same page
   * should omit this option to avoid duplicate sounds.
   */
  playSound?: boolean;
}): NotificationFeedState {
  const followUpReminders = options?.followUpReminders !== false;
  const siteVisitAlerts = options?.siteVisitAlerts !== false;
  const enabled = options?.enabled !== false;
  const playSound = options?.playSound === true;

  const [newLeads, setNewLeads] = useState<CrmNotification[]>(EMPTY);
  const [siteVisits, setSiteVisits] = useState<CrmNotification[]>(EMPTY);
  const [followUps, setFollowUps] = useState<CrmNotification[]>(EMPTY);
  const [all, setAll] = useState<CrmNotification[]>(EMPTY);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(false);

  // Tracks every notification ID we have ever seen, so we can distinguish
  // "appeared on this poll for the first time" from "was already here".
  const seenIds = useRef<Set<string>>(new Set());
  // False until the first successful fetch completes. The first fetch seeds
  // seenIds without playing sound — those are already-existing notifications.
  const initialLoadDone = useRef(false);

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

      // ── Sound detection ───────────────────────────────────────────────────
      if (playSound) {
        const incoming: CrmNotification[] = data.all ?? [];
        if (!initialLoadDone.current) {
          // First successful fetch: seed seenIds without playing any sound.
          // These are notifications that existed before the user opened the page.
          for (const n of incoming) seenIds.current.add(n.id);
          initialLoadDone.current = true;
        } else {
          // Subsequent polls: IDs not yet seen are genuinely new.
          const newOnes = incoming.filter((n) => !seenIds.current.has(n.id));
          // Always update seenIds, even when sound is suppressed, so that a
          // notification that arrived during DND does not replay sound when
          // DND lifts on the next poll.
          for (const n of incoming) seenIds.current.add(n.id);
          if (newOnes.length > 0) {
            const prefs = await _fetchInAppPrefs();
            if (prefs.browser && prefs.sound && !_isDndActive(prefs)) {
              for (let i = 0; i < newOnes.length; i++) {
                _playNotificationSound();
              }
            }
          }
        }
      }
    } catch {
      /* transient; the next poll retries */
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [enabled, followUpReminders, siteVisitAlerts, playSound]);

  useEffect(() => {
    fetchFeed();
    let timer: ReturnType<typeof setInterval> | null = setInterval(fetchFeed, POLL_MS);
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
      } else {
        fetchFeed();
        if (!timer) timer = setInterval(fetchFeed, POLL_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
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
