// lib/notifications/feed.ts — THE notification queue, built on the server.
//
// ── Why this file exists ────────────────────────────────────────────────────
// The CRM has no `notifications` table. Every notification is derived: a "New
// Lead" is a `walkin_enquiries` row created recently, a "Site Visit" is the
// latest `follow_ups.site_visit_date` on a lead, a "Follow-up" is a lead with no
// activity for two days. Until now that derivation happened in React, in four
// separate copies (admin, sales, receptionist, employees), each re-deriving the
// same three rules from a full download of every lead and every follow-up.
//
// Deriving in the browser is not itself the tenant bug — the endpoints that fed
// it are organization-scoped — but it left the tenant boundary implicit and
// spread across four files, with each copy free to add a fetch that forgets it.
// It is now explicit and in one place: every query below carries
// `organization_id = $1`, the id comes from the signed session via
// getOrganizationId(), and each notification is stamped with the organization it
// was derived from so the client can be checked against it.
//
// Two rules this module keeps:
//
//   1. The organization NEVER comes from the caller. `buildNotificationFeed`
//      takes an organizationId that the route resolved from the session; there
//      is no code path where a request body or query string reaches it.
//   2. Every notification carries `leadId` AND `organizationId`. Opening a
//      notification means opening its lead, and the lead lookup re-checks the
//      organization (see resolveNotificationLead below) rather than trusting
//      that the notification was legitimately obtained.
//
// ── Why the date maths is here and not in SQL ───────────────────────────────
// `walkin_enquiries.created_at` is `timestamp WITHOUT time zone` while
// `follow_ups.created_at` is `timestamptz`, the database session runs in GMT and
// the business runs in IST. Expressing "created within one day" in SQL across
// those two column types is exactly the kind of `AT TIME ZONE` bug that looks
// correct locally and shifts by 5.5 hours in production. So SQL does the part
// that is security — the tenant predicate — and TypeScript does the part that is
// presentation, using the same arithmetic the UI has always used.

import { query } from "@/lib/db";

/** Popover cap. Three, with a footer link to the full Notification Center. */
export const NOTIFICATION_POPOVER_LIMIT = 3;

export type NotificationKind = "new_lead" | "site_visit" | "follow_up" | "reminder";

export interface CrmNotification {
  /** Stable across refreshes, so dismissals survive a poll. */
  id: string;
  kind: NotificationKind;
  /** The lead this notification is about. Clicking it opens this lead. */
  leadId: number;
  /** The tenant this was derived from. Checked client-side as defence in depth. */
  organizationId: string;
  leadName: string;
  srNo: number | null;
  /** Headline, e.g. "New Lead · 335 - sanjana umesh menaker". */
  title: string;
  /** Second line, e.g. "Amogh (Site Head)". */
  subtitle: string;
  /** Anchor time, ISO. Sort key for New Lead. */
  at: string | null;
  /** Follow-up only: whole days since the last activity. Sort key, descending. */
  daysSince?: number;
  /** Site visit only: whole days until the visit. Sort key, ascending. */
  visitDiff?: number;
  /** Site visit only: the raw scheduled datetime. */
  visitDate?: string | null;
  status?: string | null;
  /**
   * "Interested" / "Not Interested" / "Pending", from the latest Salesform note.
   * The follow-up rule excludes "Not Interested" leads, and the popover shows it
   * as a badge.
   */
  interestStatus: string;
  /** Whoever the lead sits with, and their role label. */
  ownerName: string;
  ownerRole: string;
}

export interface NotificationFeed {
  organizationId: string;
  newLeads: CrmNotification[];
  siteVisits: CrmNotification[];
  followUps: CrmNotification[];
  reminders: CrmNotification[];
  /** Everything, newest-first. What the Notification Center renders. */
  all: CrmNotification[];
  counts: { newLeads: number; siteVisits: number; followUps: number; reminders: number; total: number };
}

interface FeedRow {
  id: number;
  sr_no: number | null;
  name: string;
  assigned_to: string | null;
  assigned_receptionist: string | null;
  created_at: string;
  status: string | null;
  is_lost_lead: boolean;
  organization_id: string;
  last_activity_at: string | null;
  latest_visit_date: string | null;
  owner_role: string | null;
  latest_salesform: string | null;
}

/**
 * One organization-scoped read that answers all three notification questions.
 *
 * The two LATERAL subqueries repeat `organization_id = w.organization_id` even
 * though they already join on `lead_id`. That is deliberate: lead ids are global
 * integers, so a follow-up row mis-stamped with the wrong organization would
 * otherwise be picked up through the id alone.
 */
const FEED_SQL = `
  SELECT w.id,
         w.sr_no,
         w.name,
         w.assigned_to,
         w.assigned_receptionist,
         w.created_at,
         w.status,
         COALESCE(w.is_lost_lead, false) AS is_lost_lead,
         w.organization_id,
         act.last_activity_at,
         vis.latest_visit_date,
         own.role AS owner_role,
         sf.message AS latest_salesform
    FROM walkin_enquiries w
    LEFT JOIN LATERAL (
      SELECT MAX(f.created_at) AS last_activity_at
        FROM follow_ups f
       WHERE f.lead_id = w.id
         AND f.organization_id = w.organization_id
    ) act ON TRUE
    LEFT JOIN LATERAL (
      SELECT f.site_visit_date AS latest_visit_date
        FROM follow_ups f
       WHERE f.lead_id = w.id
         AND f.organization_id = w.organization_id
         AND f.site_visit_date IS NOT NULL
         AND f.site_visit_date <> ''
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT 1
    ) vis ON TRUE
    LEFT JOIN LATERAL (
      -- The assignee's role, for the "Amogh (Site Head)" label. Resolved by NAME,
      -- because walkin_enquiries stores assignments as names, not ids — and name
      -- is not unique across tenants, so the organization predicate is what stops
      -- a same-named user in another organization supplying the label.
      SELECT u.role
        FROM users u
       WHERE u.organization_id = w.organization_id
         AND LOWER(TRIM(u.name)) = LOWER(TRIM(COALESCE(NULLIF(w.assigned_to, ''), w.assigned_receptionist)))
       ORDER BY u.id
       LIMIT 1
    ) own ON TRUE
    LEFT JOIN LATERAL (
      -- The most recent Salesform note. The CRM has no lead_interest_status
      -- column: "Interested" / "Not Interested" is a line inside the note the
      -- Salesform writes into follow_ups. The dashboards have always parsed it
      -- out of that text; the parse now happens once, here, instead of per view.
      SELECT f.message
        FROM follow_ups f
       WHERE f.lead_id = w.id
         AND f.organization_id = w.organization_id
         AND f.message LIKE '%Detailed Salesform Submitted%'
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT 1
    ) sf ON TRUE
   WHERE w.organization_id = $1
   ORDER BY w.id DESC`;

/** Midnight today, in the process's local zone — the same anchor the UI used. */
function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Salesform's "Lead Status" line, e.g. "• Lead Status: Not Interested".
 * Compiled once rather than per lead — this runs across the whole lead table on
 * every refresh.
 */
const LEAD_STATUS_RE = /• Lead Status: (.*)/;

function interestFrom(message: string | null): string {
  if (!message) return "Pending";
  const m = message.match(LEAD_STATUS_RE);
  return m ? m[1].trim() : "Pending";
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Who this viewer's notifications are about.
 *
 * `all` for the roles whose panel is the whole site — Admin, Site Head and, for
 * new arrivals, the front desk. `mine` for a Sales Manager, whose queue is the
 * leads assigned to them. This mirrors the scoping each dashboard already
 * applied client-side; it is a display rule, NOT the tenant boundary. The tenant
 * boundary is the SQL predicate above and applies to every role without
 * exception.
 */
function normalizeRole(role: string): string {
  return String(role ?? "").trim().toLowerCase().replace(/_/g, " ");
}

function seesWholeSite(role: string): boolean {
  const r = normalizeRole(role);
  return r === "admin" || r === "site head" || r === "super admin";
}

/**
 * The role label printed beside the assignee's name.
 *
 * Falls back to the desk the lead sits on when the name does not resolve to a
 * user row — historic leads carry names of people who have since left, and
 * "Manager" is what the UI has always shown for those.
 */
function prettyRole(role: string | null, row: FeedRow): string {
  const r = normalizeRole(role ?? "");
  if (r === "site head") return "Site Head";
  if (r === "receptionist") return "Receptionist";
  if (r === "sales manager") return "Manager";
  if (r === "senior sales manager") return "Senior Manager";
  if (r === "sourcing manager") return "Sourcing Manager";
  if (r === "admin") return "Admin";
  if (r) return role as string;
  return row.assigned_to ? "Manager" : row.assigned_receptionist ? "Receptionist" : "Unassigned";
}

function ownsLead(row: FeedRow, viewerName: string): boolean {
  const me = viewerName.trim().toLowerCase();
  if (!me) return false;
  return (
    (row.assigned_to ?? "").trim().toLowerCase() === me ||
    (row.assigned_receptionist ?? "").trim().toLowerCase() === me
  );
}

export interface BuildFeedOptions {
  /** From getOrganizationId(). Never from the request. */
  organizationId: string;
  viewerName: string;
  viewerRole: string;
  /** Numeric users.id from getSessionUserId(). Needed for reminder queries. */
  userId?: number | null;
  /** Injectable for tests; defaults to now. */
  now?: Date;
  /** Settings → Additional Features toggles. */
  followUpRemindersEnabled?: boolean;
  siteVisitAlertsEnabled?: boolean;
}

export async function buildNotificationFeed(
  opts: BuildFeedOptions
): Promise<NotificationFeed> {
  const {
    organizationId,
    viewerName,
    viewerRole,
    userId = null,
    now = new Date(),
    followUpRemindersEnabled = true,
    siteVisitAlertsEnabled = true,
  } = opts;

  const rows = await query<FeedRow>(FEED_SQL, [organizationId]);

  const today = startOfToday(now);
  const wholeSite = seesWholeSite(viewerRole);

  const newLeads: CrmNotification[] = [];
  const siteVisits: CrmNotification[] = [];
  const followUps: CrmNotification[] = [];

  for (const row of rows) {
    // Belt and braces. The WHERE clause already guarantees this; the assertion
    // exists so a future edit that widens the query fails a test instead of
    // shipping another tenant's lead into someone's notification list.
    if (row.organization_id !== organizationId) continue;

    const mine = wholeSite || ownsLead(row, viewerName);
    const created = parseDate(row.created_at);
    const formattedId = String(row.id).padStart(3, "0");
    const ownerName = row.assigned_to?.trim() || row.assigned_receptionist?.trim() || "Unassigned";
    const ownerRole = prettyRole(row.owner_role, row);
    const interestStatus = interestFrom(row.latest_salesform);

    // ── New Lead: created today or yesterday ────────────────────────────────
    if (mine && created) {
      const createdDiffDays = (today.getTime() - startOfDay(created).getTime()) / DAY_MS;
      if (createdDiffDays <= 1 && createdDiffDays >= 0) {
        newLeads.push({
          id: `lead_${row.id}`,
          kind: "new_lead",
          leadId: row.id,
          organizationId,
          leadName: row.name,
          srNo: row.sr_no,
          title: `New Lead · ${formattedId} - ${row.name}`,
          subtitle: `${ownerName} (${ownerRole})`,
          at: created.toISOString(),
          status: row.status,
          interestStatus,
          ownerName,
          ownerRole,
        });
      }
    }

    // ── Site Visit: scheduled from three days ago to two days out ───────────
    const visit = siteVisitAlertsEnabled ? parseDate(row.latest_visit_date) : null;
    if (mine && visit && !row.is_lost_lead) {
      const visitDiff = Math.round((startOfDay(visit).getTime() - today.getTime()) / DAY_MS);
      if (visitDiff >= -3 && visitDiff <= 2) {
        siteVisits.push({
          id: `visit_${row.id}_${row.latest_visit_date}`,
          kind: "site_visit",
          leadId: row.id,
          organizationId,
          leadName: row.name,
          srNo: row.sr_no,
          title: `Site Visit · ${visit.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}`,
          subtitle: `${ownerName} (${ownerRole}) - ${row.name}`,
          at: visit.toISOString(),
          visitDiff,
          visitDate: row.latest_visit_date,
          status: row.status,
          interestStatus,
          ownerName,
          ownerRole,
        });
      }
    }

    // ── Follow-up: no activity for two days or more ─────────────────────────
    //
    // "Not Interested" leads are excluded, as are Closing/Completed ones. Both
    // exclusions predate this module and are what the popover footer has always
    // promised ("Not Interested & Closing leads excluded"); chasing a lead who
    // has said no is not a reminder, it is noise.
    if (mine && followUpRemindersEnabled && !row.is_lost_lead) {
      const isFinal = row.status === "Completed" || row.status === "Closing" || row.status === "Closed";
      if (!isFinal && interestStatus !== "Not Interested") {
        const lastActivity = parseDate(row.last_activity_at) ?? created;
        if (lastActivity) {
          const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS);
          if (daysSince >= 2) {
            followUps.push({
              id: `followup_${row.id}`,
              kind: "follow_up",
              leadId: row.id,
              organizationId,
              leadName: row.name,
              srNo: row.sr_no,
              title: `#${row.sr_no || row.id} — ${row.name}`,
              subtitle: `${daysSince}d no contact`,
              at: lastActivity.toISOString(),
              daysSince,
              status: row.status,
              interestStatus,
              ownerName,
              ownerRole,
            });
          }
        }
      }
    }
  }

  // ── Reminders: due or notified, assigned to this viewer ───────────────
  //
  // Unlike the three categories above (which are derived from walkin_enquiries
  // + follow_ups), reminders live in their own table. A separate query is
  // cleaner than shoehorning them into the FEED_SQL LATERAL joins.
  const reminders: CrmNotification[] = [];

  if (userId) {
    const reminderRows = await query<{
      id: number;
      lead_id: number;
      remind_at: string;
      note: string | null;
      reminder_type: string;
      status: string;
      lead_name: string;
      lead_sr_no: number | null;
      organization_id: string;
    }>(
      `SELECT r.id, r.lead_id, r.remind_at, r.note, r.reminder_type, r.status,
              w.name AS lead_name, w.sr_no AS lead_sr_no, r.organization_id
         FROM lead_reminders r
         JOIN walkin_enquiries w ON w.id = r.lead_id
        WHERE r.organization_id = $1
          AND r.assigned_user_id = $2
          AND r.status IN ('pending', 'notified')
          AND r.remind_at <= $3
        ORDER BY r.remind_at ASC
        LIMIT 50`,
      [organizationId, userId, new Date(now.getTime() + 2 * DAY_MS).toISOString()],
    );

    for (const rr of reminderRows) {
      if (rr.organization_id !== organizationId) continue;
      const remindDate = parseDate(rr.remind_at);
      const isDue = remindDate && remindDate.getTime() <= now.getTime();
      const label = rr.reminder_type === "callback" ? "Callback" : "Follow-up";
      const noteSnippet = rr.note ? ` — ${rr.note.slice(0, 60)}` : "";
      reminders.push({
        id: `reminder_${rr.id}`,
        kind: "reminder",
        leadId: rr.lead_id,
        organizationId,
        leadName: rr.lead_name,
        srNo: rr.lead_sr_no,
        title: isDue
          ? `${label} Reminder Due${noteSnippet}`
          : `${label} Reminder${noteSnippet}`,
        subtitle: `${rr.lead_name} · ${remindDate ? remindDate.toLocaleString("en-IN", {
          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
        }) : ""}`,
        at: rr.remind_at,
        status: isDue ? "due" : rr.status,
        interestStatus: "Pending",
        ownerName: viewerName,
        ownerRole: viewerRole,
      });
    }
  }

  // Sort orders are part of the contract, not incidental:
  //   follow-ups  — highest daysSince first (most neglected at the top)
  //   site visits — closest visitDiff first (today before tomorrow)
  //   new leads   — newest first
  //   reminders   — soonest first (already sorted by remind_at ASC)
  newLeads.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
  siteVisits.sort((a, b) => (a.visitDiff ?? 0) - (b.visitDiff ?? 0));
  followUps.sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0));

  const all = [...reminders, ...newLeads, ...siteVisits, ...followUps].sort(
    (a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime()
  );

  return {
    organizationId,
    newLeads,
    siteVisits,
    followUps,
    reminders,
    all,
    counts: {
      newLeads: newLeads.length,
      siteVisits: siteVisits.length,
      followUps: followUps.length,
      reminders: reminders.length,
      total: all.length,
    },
  };
}

/**
 * Resolve the lead a notification points at, for THIS organization only.
 *
 * Returns null when the lead does not exist OR belongs to another tenant — the
 * two are deliberately indistinguishable to the caller, so a 404 cannot be used
 * to probe which lead ids exist elsewhere.
 *
 * This is the check that makes requirement "notification.organization_id ===
 * lead.organization_id" enforceable: the notification id is not trusted, the
 * lead id inside it is not trusted, and the organization is re-read from the
 * session on every open.
 */
export async function resolveNotificationLead(
  organizationId: string,
  leadId: number | string
): Promise<{ id: number; name: string; sr_no: number | null; organization_id: string } | null> {
  const numericId = Number(leadId);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const rows = await query<{ id: number; name: string; sr_no: number | null; organization_id: string }>(
    `SELECT id, name, sr_no, organization_id
       FROM walkin_enquiries
      WHERE id = $1 AND organization_id = $2
      LIMIT 1`,
    [numericId, organizationId]
  );
  return rows[0] ?? null;
}
