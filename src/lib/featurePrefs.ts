// lib/featurePrefs.ts — the shape of users.feature_prefs.
//
// "Additional Features" is a per-user screen: nothing here changes what anybody
// else sees, and nothing here is a credential. The org-wide switches it sits
// next to (click-to-call provider, Bolna, lead-number sorting) stay admin-only
// and are only ever *reported* to a Sales Manager, never edited by one — see
// the platform block in api/settings/feature-prefs/route.ts.
//
// The catalogue below is the single source of truth for both the API validation
// and the rendered list, so adding a toggle is one entry here rather than an
// entry here plus a checkbox there plus a whitelist somewhere else.

/* ── Lead sorting ───────────────────────────────────────────────────────────
   The user's own default ordering for their assigned-leads list. This is NOT
   organization_settings.lead_number_sorting_enabled, which renumbers sr_no for
   the whole company and is admin-only; that one decides what a lead is called,
   this one decides what order you see them in. */

// Every option here is backed by a field the lead records actually carry —
// created_at, name, leadInterestStatus, and the follow-up log. There is no
// "hot / warm / cold" option because there is no such field: interest is
// Interested / Pending / Not Interested / NGD, and `interest` sorts on that.
export const LEAD_SORT_OPTIONS = [
  { id: "newest", label: "Newest first", description: "Most recently created leads at the top." },
  { id: "oldest", label: "Oldest first", description: "Work the backlog from the bottom up." },
  { id: "stale", label: "Longest without contact", description: "Whoever you have not spoken to for longest comes first." },
  { id: "interest", label: "Interested first", description: "Interested leads, then undecided, then NGD and lost." },
  { id: "name", label: "Client name (A–Z)", description: "Alphabetical, for looking someone up by name." },
] as const;

export type LeadSortId = (typeof LEAD_SORT_OPTIONS)[number]["id"];

export const DEFAULT_LEAD_SORT: LeadSortId = "newest";

/** Interested first, then undecided, then the ones not worth the top of a list. */
const INTEREST_RANK: Record<string, number> = {
  Interested: 0,
  Pending: 1,
  "Not Interested": 3,
  "NON GENUINE DEMAND (NGD)": 4,
  "Non Qualified Lead": 4,
  "Non Qualified Leads": 4,
  "Non qualified Lead": 4,
};

const timeOf = (value: unknown): number => {
  const ms = new Date(String(value ?? "")).getTime();
  // A lead with no usable date sorts as oldest rather than jumping to the top,
  // which is what NaN would do inside a comparator.
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * The comparator behind LEAD_SORT_OPTIONS.
 *
 * `lastActivityAt` is supplied by the caller because working it out means
 * scanning the follow-up log, which only the screen holding that log can do —
 * this module stays free of data access so it can be imported by the API route
 * and the client alike.
 */
export function compareLeads(
  a: any,
  b: any,
  sort: LeadSortId,
  lastActivityAt: (lead: any) => number = (lead) => timeOf(lead?.created_at)
): number {
  switch (sort) {
    case "oldest":
      return timeOf(a?.created_at) - timeOf(b?.created_at);
    case "name":
      return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), undefined, {
        sensitivity: "base",
      });
    case "stale":
      // Oldest last-activity first — the lead you have neglected longest.
      return lastActivityAt(a) - lastActivityAt(b);
    case "interest": {
      const rank = (l: any) => INTEREST_RANK[String(l?.leadInterestStatus ?? "Pending")] ?? 2;
      const diff = rank(a) - rank(b);
      // Ties fall back to newest, so the group order is stable and useful
      // rather than whatever order the API happened to return.
      return diff !== 0 ? diff : timeOf(b?.created_at) - timeOf(a?.created_at);
    }
    case "newest":
    default:
      return timeOf(b?.created_at) - timeOf(a?.created_at);
  }
}

export const LEAD_SORT_IDS = new Set<string>(LEAD_SORT_OPTIONS.map((o) => o.id));

/* ── Workflow toggles ───────────────────────────────────────────────────────
   Each entry carries its own default. The list is deliberately short: a toggle
   only belongs here once something reads it, because a switch that changes
   nothing is worse than no switch at all. All three below are consumed in
   app/dashboard/sales/page.tsx.

   They are stored for every role, not only Sales Managers — a role can change,
   and dropping someone's saved preference on promotion would be worse than
   storing a few booleans nobody reads. */

export interface FeatureToggleSpec {
  id: string;
  label: string;
  description: string;
  default: boolean;
}

export const FEATURE_TOGGLES: FeatureToggleSpec[] = [
  {
    id: "followUpReminders",
    label: "Follow-up reminders",
    description:
      "Flag leads you have not contacted for two days or more on the bell in the header. Turning this off silences the badge; it does not change the leads.",
    default: true,
  },
  {
    id: "siteVisitAlerts",
    label: "Site visit alerts",
    description: "Pop up a reminder for site visits scheduled for today or tomorrow.",
    default: true,
  },
  {
    id: "compactLeadCards",
    label: "Compact lead cards",
    description: "Fit more leads on screen by tightening the assigned-leads grid.",
    default: false,
  },
];

export const TOGGLE_IDS = new Set(FEATURE_TOGGLES.map((t) => t.id));

/* ── The stored value ───────────────────────────────────────────────────────*/

export interface FeaturePrefs {
  leadSort: LeadSortId;
  toggles: Record<string, boolean>;
}

export const DEFAULT_FEATURE_PREFS: FeaturePrefs = {
  leadSort: DEFAULT_LEAD_SORT,
  toggles: Object.fromEntries(FEATURE_TOGGLES.map((t) => [t.id, t.default])),
};

/**
 * Merge a stored blob over the defaults.
 *
 * Unknown keys are dropped and unknown sort ids fall back, so a row written by
 * an older build — or by a stale browser tab posting a toggle that has since
 * been removed — reads as something the UI can render rather than as a hole.
 */
export function mergeFeaturePrefs(stored: unknown): FeaturePrefs {
  const d = DEFAULT_FEATURE_PREFS;
  if (!stored || typeof stored !== "object") return { leadSort: d.leadSort, toggles: { ...d.toggles } };

  const raw = stored as Record<string, any>;
  const leadSort: LeadSortId = LEAD_SORT_IDS.has(raw.leadSort) ? raw.leadSort : d.leadSort;

  const toggles = { ...d.toggles };
  const storedToggles = raw.toggles && typeof raw.toggles === "object" ? raw.toggles : {};
  for (const spec of FEATURE_TOGGLES) {
    const v = storedToggles[spec.id];
    if (typeof v === "boolean") toggles[spec.id] = v;
  }

  return { leadSort, toggles };
}

/**
 * Validate a PATCH body into a complete value ready to be stored.
 *
 * Partial bodies are supported: whatever is absent keeps its current value, so
 * flipping one toggle does not require the client to send the whole object back
 * and cannot race another tab into resetting the rest.
 */
export function applyFeaturePrefsPatch(
  current: FeaturePrefs,
  body: unknown
): { ok: true; next: FeaturePrefs } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Invalid body." };
  }
  const raw = body as Record<string, any>;
  const next: FeaturePrefs = { leadSort: current.leadSort, toggles: { ...current.toggles } };

  if (raw.leadSort !== undefined) {
    if (!LEAD_SORT_IDS.has(String(raw.leadSort))) {
      return { ok: false, message: "Unknown lead sorting option." };
    }
    next.leadSort = String(raw.leadSort) as LeadSortId;
  }

  if (raw.toggles !== undefined) {
    if (!raw.toggles || typeof raw.toggles !== "object" || Array.isArray(raw.toggles)) {
      return { ok: false, message: "Toggles must be an object." };
    }
    for (const [id, value] of Object.entries(raw.toggles as Record<string, unknown>)) {
      if (!TOGGLE_IDS.has(id)) {
        return { ok: false, message: `Unknown feature "${id}".` };
      }
      if (typeof value !== "boolean") {
        return { ok: false, message: `"${id}" must be true or false.` };
      }
      next.toggles[id] = value;
    }
  }

  if (raw.reset === true) {
    return { ok: true, next: { leadSort: DEFAULT_LEAD_SORT, toggles: { ...DEFAULT_FEATURE_PREFS.toggles } } };
  }

  return { ok: true, next };
}
