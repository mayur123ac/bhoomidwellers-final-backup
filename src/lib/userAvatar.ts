// lib/userAvatar.ts — the signed-in user's profile picture, for the whole CRM.
//
// ── The bug this exists to fix ──────────────────────────────────────────────
// Uploading a picture in Settings → Profile updated `setUser` on that page and
// nothing else, so the eight header avatars across the app kept rendering the
// user's initial until the next full reload — and after a reload they still
// did, because nothing outside that page had ever heard of the file.
//
// This is the same shape of problem lib/theme.ts was written for ("toggling in
// one place did not move any of the others") and it is solved the same way, on
// purpose: a module-level store with a subscriber list, a localStorage working
// copy, and a durable column behind it.
//
// ── Where the value lives ───────────────────────────────────────────────────
//
//   localStorage `crm_avatar`      the working copy. Read synchronously, so a
//                                  header paints the picture on its first frame
//                                  rather than flashing the initial first.
//   users.avatar_key / avatar_url  the durable copy, written by
//                                  /api/settings/avatar. Restored at sign-in,
//                                  which is what makes the picture survive a
//                                  logout or a different machine.
//
// The sentinel matters: an EMPTY STRING means "this user has no picture, and we
// know that". It is not the same as the key being absent, which means "we have
// not asked yet" and is what triggers the one-time backfill in
// hooks/useUserAvatar.ts. Without that distinction, a user who removed their
// picture would have it re-fetched on every mount forever.

const STORAGE_KEY = "crm_avatar";
/** Fired in this tab on every change. `storage` only reaches the others. */
const CHANGE_EVENT = "crm-avatar-change";

/* ══════════════════════════════════════════════════════════════════════════
   Reading
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The current avatar URL, or null when there is none.
 *
 * Returns null both for "no picture" and for "not known yet". Callers that need
 * to tell those apart use hasResolvedAvatar().
 */
export function getAvatarUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? stored : null;
  } catch {
    return null;
  }
}

/** True once we know the answer, including when the answer is "no picture". */
export function hasResolvedAvatar(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Writing
   ══════════════════════════════════════════════════════════════════════════ */

function broadcast(url: string | null) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: url }));
}

/**
 * Set the picture and tell every mounted header about it.
 *
 * Called after a successful upload or removal. The server write has already
 * happened by then — this only updates the working copy, so a failed upload
 * never moves the header.
 */
export function setAvatarUrl(url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    // "" rather than removeItem: see the sentinel note in the header. Removing
    // the key would mean "unknown" and re-trigger the backfill fetch.
    localStorage.setItem(STORAGE_KEY, url ?? "");
  } catch {
    /* private mode — the event below still updates this session */
  }
  broadcast(url);
}

/**
 * Adopt whatever the server says, at sign-in or on a profile load.
 *
 * Separate from setAvatarUrl only by intent; both write the same value. Kept as
 * its own name so call sites read as "this came from the server" rather than
 * "the user just did something", matching adoptServerTheme().
 */
export function adoptServerAvatar(value: unknown): string | null {
  const url = typeof value === "string" && value.trim() !== "" ? value : null;
  setAvatarUrl(url);
  return url;
}

/**
 * Drop the working copy at sign-out.
 *
 * The key is REMOVED here, not set to "": the next user to sign in on this
 * machine must not inherit the previous one's "no picture" answer, and an
 * absent key is what makes the next session fetch its own. users.avatar_* is
 * untouched, so signing back in restores the picture.
 */
export function clearAvatar(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  broadcast(null);
}

/* ══════════════════════════════════════════════════════════════════════════
   Subscribing
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Listen for changes. Returns an unsubscribe function.
 *
 * Two events, because neither covers both cases: `storage` fires in OTHER tabs
 * only (the browser deliberately does not fire it in the tab that wrote), and
 * the CustomEvent fires only in this one.
 */
export function subscribeToAvatar(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };

  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
