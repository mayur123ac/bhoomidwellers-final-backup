// lib/settingsUser.ts — the shape the Settings panel reads and writes.
//
// Keeping the SELECT list, the defaults and the name-splitting in one place so
// the profile, account, preferences and notifications routes cannot drift into
// four slightly different ideas of what a user record looks like.

import { query } from "@/lib/db";

/* ── Name handling ──────────────────────────────────────────────────────────
   `users.name` is a single column and is load-bearing: the login route matches
   on LOWER(name), and employee_activity_logs joins against it for display. The
   Profile screen shows First and Last name because the spec asks for it, so the
   split happens here on read and the rejoin happens on write. There is no
   first_name/last_name column, deliberately — two sources of truth for a
   person's name is how you end up with a directory that disagrees with a login. */

export function splitName(fullName: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const trimmed = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(" ");
  // Everything after the first token is the surname, so "Ravi Kumar Sharma"
  // round-trips unchanged rather than losing "Sharma".
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function joinName(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/* ── Notification preferences ───────────────────────────────────────────────
   Stored as one JSONB column rather than a dozen boolean columns or a side
   table. They are only ever read and written as a whole by one screen, and a
   new toggle should be a UI change, not a migration. */

export interface NotificationPrefs {
  frequency: "instant" | "daily" | "weekly" | "never";
  digestTime: string;   // "HH:mm", used by daily + weekly
  digestDay: number;    // 0-6, used by weekly
  email: {
    leadAssigned: boolean;
    bookingUpdates: boolean;
    commissionAlerts: boolean;
    teamMentions: boolean;
    teamMembership: boolean;
    teamDigest: boolean;
    systemAlerts: boolean;
  };
  inApp: {
    browser: boolean;
    sound: boolean;
    dndEnabled: boolean;
    dndStart: string;   // "HH:mm"
    dndEnd: string;     // "HH:mm"
  };
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  frequency: "instant",
  digestTime: "09:00",
  digestDay: 1,
  email: {
    leadAssigned: true,
    bookingUpdates: true,
    commissionAlerts: true,
    teamMentions: true,
    teamMembership: true,
    teamDigest: false,
    systemAlerts: true,
  },
  inApp: {
    browser: true,
    sound: false,
    dndEnabled: false,
    dndStart: "22:00",
    dndEnd: "08:00",
  },
};

/**
 * Merge stored prefs over the defaults, one level at a time.
 *
 * A shallow spread would drop every default in `email` the moment a stored blob
 * contained a partial `email` object — which is exactly what happens when a new
 * toggle is added to the type and existing rows predate it.
 */
export function mergeNotificationPrefs(stored: any): NotificationPrefs {
  const d = DEFAULT_NOTIFICATION_PREFS;
  if (!stored || typeof stored !== "object") return d;
  return {
    frequency: stored.frequency ?? d.frequency,
    digestTime: stored.digestTime ?? d.digestTime,
    digestDay: stored.digestDay ?? d.digestDay,
    email: { ...d.email, ...(stored.email ?? {}) },
    inApp: { ...d.inApp, ...(stored.inApp ?? {}) },
  };
}

/* ── Dashboard widgets ──────────────────────────────────────────────────────
   The widget catalogue the Preferences screen renders. Ids are stored in
   users.dashboard_config; a null column means "all defaults on". */

export const DASHBOARD_WIDGETS = [
  { id: "lead_overview", label: "Lead Overview" },
  { id: "revenue_dashboard", label: "Revenue Dashboard" },
  { id: "team_activity", label: "Team Activity" },
  { id: "booking_pipeline", label: "Booking Pipeline" },
  { id: "site_visits", label: "Site Visit Overview" },
  { id: "live_activity", label: "Live Activity" },
  { id: "geo_analytics", label: "Geo Analytics" },
  { id: "inventory", label: "Inventory Snapshot" },
] as const;

export const DEFAULT_WIDGET_IDS = DASHBOARD_WIDGETS.map((w) => w.id) as string[];

/* ── Reading a user ─────────────────────────────────────────────────────────*/

export interface SettingsUserRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  username: string | null;
  whatsapp_number: string | null;
  is_active: boolean;
  created_at: string;
  avatar_key: string | null;
  avatar_url: string | null;
  timezone: string | null;
  week_start_day: number | null;
  theme_preference: string | null;
  language: string | null;
  dashboard_config: any;
  secondary_email: string | null;
  secondary_email_verified: boolean | null;
  notification_email_preference: string | null;
  notification_prefs: any;
  department: string | null;
  reporting_manager_id: number | null;
  last_email_change_at: string | null;
  password_changed_at: string | null;
  last_login_at: string | null;
  first_login_at: string | null;
  invite_sent_at: string | null;
  deactivated_at: string | null;
  deleted_at: string | null;
}

export const SETTINGS_USER_COLUMNS = `
  id, name, email, phone, role, username, whatsapp_number, is_active, created_at,
  avatar_key, avatar_url, timezone, week_start_day, theme_preference, language,
  dashboard_config, secondary_email, secondary_email_verified,
  notification_email_preference, notification_prefs, department,
  reporting_manager_id, last_email_change_at, password_changed_at,
  last_login_at, first_login_at, invite_sent_at, deactivated_at, deleted_at
`;

export async function loadSettingsUser(userId: number): Promise<SettingsUserRow | null> {
  const rows = await query<SettingsUserRow>(
    `SELECT ${SETTINGS_USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * The URL the browser should load for an avatar.
 *
 * R2 objects are private, so they go through the existing session-gated
 * /api/r2-proxy rather than being exposed on a public bucket URL. When R2 is
 * unconfigured the upload falls back to a local file and avatar_url holds the
 * public path directly.
 */
export function avatarSrc(row: {
  avatar_key: string | null;
  avatar_url: string | null;
}): string | null {
  if (row.avatar_key) return `/api/r2-proxy?key=${encodeURIComponent(row.avatar_key)}`;
  return row.avatar_url || null;
}

/** Initials for the fallback avatar, e.g. "Ravi Sharma" → "RS". */
export function initialsFor(name: string | null | undefined): string {
  const { firstName, lastName } = splitName(name);
  const a = firstName.charAt(0);
  const b = lastName.charAt(0);
  return (a + b).toUpperCase() || "?";
}

/** The public JSON shape every Settings screen consumes. */
export function serializeSettingsUser(row: SettingsUserRow) {
  const { firstName, lastName } = splitName(row.name);
  return {
    id: row.id,
    firstName,
    lastName,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    username: row.username,
    whatsappNumber: row.whatsapp_number,
    isActive: row.is_active,
    createdAt: row.created_at,
    avatarUrl: avatarSrc(row),
    hasAvatar: Boolean(row.avatar_key || row.avatar_url),
    initials: initialsFor(row.name),
    timezone: row.timezone || "Asia/Kolkata",
    weekStartDay: row.week_start_day ?? 1,
    // "light" rather than "system": there are only two themes now, and a caller
    // that has never chosen gets a real one it can render. Legacy "system" rows
    // pass through here and are resolved client-side by normaliseTheme() in
    // lib/theme.ts, which can consult the OS preference — the server cannot.
    theme: row.theme_preference || "light",
    language: row.language || "en-US",
    dashboardWidgets: Array.isArray(row.dashboard_config?.widgets)
      ? (row.dashboard_config.widgets as string[])
      : DEFAULT_WIDGET_IDS,
    secondaryEmail: row.secondary_email,
    secondaryEmailVerified: Boolean(row.secondary_email_verified),
    notificationEmailPreference: row.notification_email_preference || "primary",
    notificationPrefs: mergeNotificationPrefs(row.notification_prefs),
    department: row.department,
    reportingManagerId: row.reporting_manager_id,
    lastEmailChangeAt: row.last_email_change_at,
    passwordChangedAt: row.password_changed_at,
    lastLoginAt: row.last_login_at,
    firstLoginAt: row.first_login_at,
    inviteSentAt: row.invite_sent_at,
    deactivatedAt: row.deactivated_at,
  };
}

export type SettingsUser = ReturnType<typeof serializeSettingsUser>;
