// lib/notificationPreferenceService.ts — the one place that answers
// "should this user receive this notification?".
//
// Every system email checks here first. Nothing bypasses it: the check lives
// inside sendToUser() in lib/emailRouting.ts, which is the only function the CRM
// uses to mail a person, so a new notification is gated by construction rather
// than by remembering to add a call.
//
// ── This is not the same question as emailRouting ───────────────────────────
//
//   notificationPreferenceService   WHETHER to send      isNotificationEnabled()
//   emailRouting                    WHERE it goes        resolveRecipients()
//
// Both must pass. Turning off "Successful login" silences that one notification
// everywhere; unticking both destinations silences everything. They compose, and
// neither can express the other.
//
// ── Sparse storage ─────────────────────────────────────────────────────────
// notification_type_preferences holds a row only where a user has made an
// explicit choice. Everything else resolves to the catalogue's `defaultEnabled`.
// That is what lets a new notification type ship without a backfill — see the
// header of notification_type_preferences_2026-08-07.sql.
//
// ── The cache ───────────────────────────────────────────────────────────────
// A short per-process memo, keyed by user. The send path reads these preferences
// once per outbound email and they change roughly never, so the alternative is a
// query per email to re-learn a value that was correct thirty seconds ago.
//
// It is deliberately small and dumb:
//
//   - 60 seconds. Long enough to cover a burst of mail, short enough that the
//     staleness window after an external write is not worth reasoning about.
//   - Invalidated synchronously on every write that goes through this module,
//     so a user who saves their settings never sees the old value.
//   - Per-process. Under multiple Node processes each holds its own copy, and
//     the worst case is one process sending one already-disabled notification
//     within 60 seconds of the change. A shared cache would mean Redis, which
//     this deployment does not have, for a value that is cheap to re-read.
//
// It is NOT a source of truth. Every write hits the database first.

import { query } from "@/lib/db";
import {
  ALL_NOTIFICATIONS,
  defaultPreferences,
  getNotification,
  isKnownNotificationKey,
} from "@/lib/notificationCatalogue";

/* ══════════════════════════════════════════════════════════════════════════
   Cache
   ══════════════════════════════════════════════════════════════════════════ */

const CACHE_TTL_MS = 60_000;

// Bounded so a long-running process serving many users cannot grow this without
// limit. Eviction is oldest-inserted-first, which for a settings cache is
// indistinguishable from LRU and costs nothing to maintain.
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  overrides: Record<string, boolean>;
  expiresAt: number;
}

const cache = new Map<number, CacheEntry>();

function cacheGet(userId: number): Record<string, boolean> | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(userId);
    return null;
  }
  return entry.overrides;
}

function cacheSet(userId: number, overrides: Record<string, boolean>): void {
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(userId)) {
    // Map iterates in insertion order, so the first key is the oldest.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(userId, { overrides, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Drop a user's cached preferences. Called after every write. */
export function invalidatePreferenceCache(userId?: number): void {
  if (userId === undefined) cache.clear();
  else cache.delete(userId);
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The stored overrides for one user — only the keys they have explicitly set.
 *
 * Unknown keys are dropped here rather than at the call sites, so a row for a
 * retired notification cannot leak into the API response and render as a switch
 * with no meaning.
 */
async function loadOverrides(userId: number): Promise<Record<string, boolean>> {
  const cached = cacheGet(userId);
  if (cached) return cached;

  const rows = await query<{ notification_key: string; enabled: boolean }>(
    `SELECT notification_key, enabled
       FROM notification_type_preferences
      WHERE user_id = $1`,
    [userId]
  );

  const overrides: Record<string, boolean> = {};
  for (const row of rows) {
    if (isKnownNotificationKey(row.notification_key)) {
      overrides[row.notification_key] = row.enabled;
    }
  }

  cacheSet(userId, overrides);
  return overrides;
}

/**
 * Every catalogue key resolved for this user: stored value where one exists,
 * catalogue default everywhere else.
 *
 * This is the single request the settings screen loads from — one query, one
 * complete answer, no per-key round trips.
 */
export async function getNotificationPreferences(
  userId: number
): Promise<Record<string, boolean>> {
  const resolved = defaultPreferences();

  try {
    const overrides = await loadOverrides(userId);
    for (const [key, enabled] of Object.entries(overrides)) resolved[key] = enabled;
  } catch (err) {
    // Falling back to the catalogue defaults rather than throwing. This function
    // is on the send path: a database blip must not turn "we could not read your
    // preferences" into "your password-change alert was never sent". The
    // defaults are the safe answer — security mail defaults on.
    console.error(
      "[notificationPreferences] could not load preferences, using defaults:",
      err instanceof Error ? err.message : String(err)
    );
  }

  return resolved;
}

/**
 * The gate. Every email sender goes through this before sending.
 *
 * An unknown key returns true. That is the deliberate choice: a caller passing a
 * key that is not in the catalogue is a bug in the caller, and the two ways to
 * handle it are "send an email nobody configured" or "silently drop a
 * notification nobody can turn back on". A stray email is visible and gets
 * reported; a silent drop is not, and security mail is the most likely thing to
 * be affected. The mismatch is logged so it gets fixed.
 */
export async function isNotificationEnabled(
  userId: number,
  notificationKey: string
): Promise<boolean> {
  const definition = getNotification(notificationKey);

  if (!definition) {
    console.warn(
      `[notificationPreferences] unknown key "${notificationKey}" — sending anyway. ` +
        `Add it to lib/notificationCatalogue.ts.`
    );
    return true;
  }

  try {
    const overrides = await loadOverrides(userId);
    const stored = overrides[notificationKey];
    return stored === undefined ? definition.defaultEnabled : stored;
  } catch (err) {
    console.error(
      `[notificationPreferences] check failed for "${notificationKey}", using default:`,
      err instanceof Error ? err.message : String(err)
    );
    return definition.defaultEnabled;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Writing
   ══════════════════════════════════════════════════════════════════════════ */

export interface SaveResult {
  /** Keys that were written. */
  applied: string[];
  /** Keys rejected because the catalogue does not contain them. */
  ignored: string[];
}

/**
 * Apply a batch of changes in one statement.
 *
 * Batched deliberately: the settings screen can change forty toggles before the
 * user presses Save, and forty round trips would be forty chances to half-apply
 * a change set. One multi-row upsert either lands or does not.
 *
 * The parameter list is built as tuples rather than looping INSERTs for the same
 * reason — and `ON CONFLICT` makes it idempotent, so a double-submitted form
 * writes the same values twice instead of failing on the unique index.
 */
export async function setNotificationPreferences(
  userId: number,
  changes: Record<string, boolean>
): Promise<SaveResult> {
  const applied: string[] = [];
  const ignored: string[] = [];

  for (const key of Object.keys(changes)) {
    if (isKnownNotificationKey(key)) applied.push(key);
    else ignored.push(key);
  }

  if (applied.length === 0) {
    // Still invalidate: the caller believes it saved, and leaving a stale entry
    // behind would be a difference between what they see and what sends.
    invalidatePreferenceCache(userId);
    return { applied, ignored };
  }

  // $1 is the user id; each key contributes ($2, $3), ($4, $5), …
  const values: unknown[] = [userId];
  const tuples = applied.map((key) => {
    values.push(key, changes[key]);
    return `($1, $${values.length - 1}, $${values.length})`;
  });

  await query(
    `INSERT INTO notification_type_preferences (user_id, notification_key, enabled)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (user_id, notification_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    values
  );

  // After the write, never before: a failed write that had already cleared the
  // cache would repopulate it from the database on the next read anyway, but
  // clearing first opens a window where a concurrent read caches the old value
  // as if it were fresh.
  invalidatePreferenceCache(userId);

  return { applied, ignored };
}

/**
 * Reset a user to the catalogue defaults by deleting their overrides.
 *
 * Deleting rather than writing the default values keeps the "no row means
 * default" invariant intact — so if a default later changes, a user who reset
 * follows the new default instead of being pinned to the old one.
 */
export async function resetNotificationPreferences(userId: number): Promise<void> {
  await query(`DELETE FROM notification_type_preferences WHERE user_id = $1`, [userId]);
  invalidatePreferenceCache(userId);
}

/* ══════════════════════════════════════════════════════════════════════════
   Summary
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The "You will receive" list the settings screen previews.
 *
 * Computed here as well as in the browser so the server's answer is the
 * authoritative one after each save — the client's optimistic version is only
 * ever a guess about what the server will say.
 *
 * De-duplicated on the short label: "Plan upgraded" and "Plan downgraded" both
 * summarise as "Plan changes", and listing that twice looks like a bug.
 */
export function summarise(preferences: Record<string, boolean>): string[] {
  const seen = new Set<string>();
  const summary: string[] = [];

  for (const definition of ALL_NOTIFICATIONS) {
    if (!preferences[definition.key]) continue;
    const label = definition.short ?? definition.label;
    if (seen.has(label)) continue;
    seen.add(label);
    summary.push(label);
  }

  return summary;
}
