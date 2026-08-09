// lib/timePreferences.ts — the CRM's one answer to "what time is it here?".
//
// ── Why the timezone is a constant and not a choice ─────────────────────────
// The Profile screen has always shown a full IANA timezone picker, but nothing
// downstream read the saved value: every timestamp in the CRM is rendered with
// the browser's local zone, and every reporting range is computed in it. So the
// picker was a control that changed a database column and nothing else — worse
// than absent, because it implies the rest of the app honours it.
//
// The business runs in one place, so rather than retro-fit zone handling into
// every date in the product, the zone is pinned here to Asia/Kolkata and the
// picker is locked to match. That makes the setting honest: the displayed value
// is genuinely what the app uses, because everything that formats a user-facing
// time now comes through this module.
//
// When a second region genuinely needs supporting, this is the file to change —
// flip TIMEZONE_LOCKED, widen ALLOWED_TIMEZONES, and the picker in
// settings/profile re-enables itself off those two exports.
//
// `weekStartDay` is NOT locked. It is a real per-user preference and is read
// from the profile record via useTimePreferences() in lib/hooks.
//
// ── No "use client" here, deliberately ──────────────────────────────────────
// The profile API route enforces the timezone lock and validates weekStartDay
// against the same constants the UI renders from, so this module is imported on
// both sides. A client directive would turn these exports into client
// references and the route could not call them. The React hook that subscribes
// to the stored preference therefore lives in lib/hooks/useTimePreferences.ts,
// which is a client module; everything below is framework-free.

/* ── The zone ───────────────────────────────────────────────────────────────*/

export const APP_TIMEZONE = "Asia/Kolkata";
export const APP_TIMEZONE_ABBR = "IST";
export const APP_TIMEZONE_LABEL = "India Standard Time";
export const APP_TIMEZONE_OFFSET = "UTC+05:30";

/** Locked to a single zone for now. See the note at the top of this file. */
export const TIMEZONE_LOCKED = true;
export const ALLOWED_TIMEZONES = [APP_TIMEZONE];

export function isAllowedTimezone(tz: string): boolean {
  return ALLOWED_TIMEZONES.includes(tz);
}

/* ── Week start ─────────────────────────────────────────────────────────────*/

export const DEFAULT_WEEK_START_DAY = 1;

export const WEEK_START_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 0, label: "Sunday" },
  { value: 6, label: "Saturday" },
] as const;

export function isValidWeekStartDay(day: number): boolean {
  return WEEK_START_OPTIONS.some((o) => o.value === day);
}

/* ── Formatting ─────────────────────────────────────────────────────────────
   Every helper pins timeZone, so a caller cannot accidentally format in the
   browser's zone by forgetting to pass one. `en-IN` for the date shapes the
   business already writes by hand (09 Aug 2026), not the US order. */

function fmt(date: Date, options: Intl.DateTimeFormatOptions, locale = "en-IN") {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: APP_TIMEZONE }).format(date);
}

/** "09 Aug 2026" */
export function formatAppDate(date: Date | string | number): string {
  return fmt(new Date(date), { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * "9:34 PM", or "9:34:07 PM" with seconds.
 *
 * en-IN renders the day period lowercase ("9:34 pm"), which reads as a typo
 * beside the uppercase abbreviations the rest of the chrome uses. Normalised
 * here so no caller has to remember to do it.
 */
export function formatAppTime(date: Date | string | number, withSeconds = false): string {
  return fmt(new Date(date), {
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  })
    .replace(/\bam\b/, "AM")
    .replace(/\bpm\b/, "PM");
}

/** "09 Aug 2026, 9:34 PM" */
export function formatAppDateTime(date: Date | string | number, withSeconds = false): string {
  return `${formatAppDate(date)}, ${formatAppTime(date, withSeconds)}`;
}

/** "Sun" — the weekday as resolved in the app's zone, not the browser's. */
export function formatAppWeekday(date: Date | string | number): string {
  return fmt(new Date(date), { weekday: "short" });
}

/**
 * The calendar day, in the app's zone, as "YYYY-MM-DD".
 *
 * The one piece a Date object cannot give you directly: `toISOString()` is UTC,
 * so at 00:30 IST it reports the previous day, and any report keyed on it is a
 * day out for the first five and a half hours of every day.
 */
export function appDateKey(date: Date | string | number = new Date()): string {
  return fmt(new Date(date), { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");
}

/* ── Week ranges ────────────────────────────────────────────────────────────
   For the "calendar and reporting date ranges" the Profile card promises. */

/** Midnight on the first day of the week containing `date`, in the app's zone. */
export function startOfAppWeek(
  date: Date | string | number = new Date(),
  weekStartDay: number = DEFAULT_WEEK_START_DAY
): Date {
  const key = appDateKey(date);
  // Parsed as UTC midnight so the arithmetic below cannot be nudged across a
  // boundary by the browser's own offset; the calendar day was already resolved
  // in the app's zone by appDateKey().
  const day = new Date(`${key}T00:00:00Z`);
  const diff = (day.getUTCDay() - weekStartDay + 7) % 7;
  day.setUTCDate(day.getUTCDate() - diff);
  return day;
}

/** `{ start, end }` as "YYYY-MM-DD", inclusive, honouring the user's week start. */
export function appWeekRange(
  date: Date | string | number = new Date(),
  weekStartDay: number = DEFAULT_WEEK_START_DAY
): { start: string; end: string } {
  const start = startOfAppWeek(date, weekStartDay);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/* ── The user's preferences ─────────────────────────────────────────────────
   The stored `weekStartDay` is read through useTimePreferences() in
   lib/hooks/useTimePreferences.ts — a client module, because it holds a cache
   and subscribes to the session. Only the shape lives here, so both sides can
   name it. */

export interface TimePreferences {
  timezone: string;
  weekStartDay: number;
  ready: boolean;
}
