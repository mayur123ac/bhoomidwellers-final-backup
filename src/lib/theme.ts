// lib/theme.ts — the CRM's one theme setting.
//
// Before this, "what theme am I in" had six answers. The Admin dashboard and
// Employees each read `crm_theme` from localStorage; Receptionist, Sales and
// Sourcing kept `useState(false)` that reset on every navigation; Settings kept
// its own copy; and Preferences → Theme wrote a `theme_preference` column that
// nothing ever read. Toggling in one place did not move any of the others.
//
// Everything now goes through this module.
//
// ── Where the value lives ───────────────────────────────────────────────────
//
//   localStorage `crm_theme`   the working copy. Read synchronously on mount,
//                              so the first paint is already correct.
//   users.theme_preference     the durable copy. Restored at next sign-in, on
//                              whatever machine, which is what makes the
//                              choice survive a logout.
//
// localStorage is written first and the server call follows. The reverse would
// make every toggle wait on a round trip to repaint, and a failed request would
// leave the switch visibly stuck. If the server write fails the working copy is
// still right for this session and the next successful save fixes the durable
// one.
//
// ── Why a custom event rather than React context ────────────────────────────
// The five dashboards are separate route trees that never share a provider, and
// wrapping them all would mean touching six large page components to thread a
// context through. A module-level subscriber list reaches every listener
// wherever it is mounted, in one hop, with no provider to forget.
//
// `storage` covers other tabs; the browser deliberately does not fire it in the
// tab that made the change, which is exactly why the in-page event exists too.

export type CrmTheme = "light" | "dark";

const STORAGE_KEY = "crm_theme";
/** Fired in this tab on every change. `storage` only reaches the others. */
const CHANGE_EVENT = "crm-theme-change";

/** The attribute the pre-paint script and the dashboards key off. */
const ROOT_ATTRIBUTE = "data-crm-theme";

export const DEFAULT_THEME: CrmTheme = "light";

/* ══════════════════════════════════════════════════════════════════════════
   Reading
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Coerce anything to a valid theme.
 *
 * `"system"` was a third option until this change. Rows still hold it, and so
 * do browsers that stored it, so it is resolved here against the OS preference
 * rather than rejected — a stored value from last week must not leave someone
 * with a blank setting.
 */
export function normaliseTheme(value: unknown): CrmTheme {
  if (value === "dark") return "dark";
  if (value === "light") return "light";
  if (value === "system") return prefersDark() ? "dark" : "light";
  return DEFAULT_THEME;
}

function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** The current theme. Safe on the server, where it answers with the default. */
export function getTheme(): CrmTheme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // No stored value at all means this browser has never been told. Following
    // the OS preference is a better first impression than forcing light, and it
    // is only ever the *initial* value — the first explicit choice overwrites it.
    if (stored === null) return prefersDark() ? "dark" : "light";
    return normaliseTheme(stored);
  } catch {
    // Private mode, or storage disabled by policy.
    return DEFAULT_THEME;
  }
}

export function isDarkTheme(): boolean {
  return getTheme() === "dark";
}

/* ══════════════════════════════════════════════════════════════════════════
   Writing
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Mirror the theme onto <html>, so CSS that keys off the attribute — and the
 * pre-paint script in the root layout — agree with React's view of it.
 *
 * Also sets `color-scheme`, which is what makes native widgets (scrollbars,
 * date pickers, select popups) follow along. Those render from the UA
 * stylesheet and know nothing about the class names on the page.
 */
function applyToDocument(theme: CrmTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute(ROOT_ATTRIBUTE, theme);
  root.style.colorScheme = theme;
}

/**
 * Persist to the server. Fire-and-forget by design.
 *
 * A theme toggle must feel instant, and it has already been applied locally by
 * the time this runs. Failures are logged rather than surfaced: telling someone
 * their colour scheme "failed to save" while it is visibly applied is noise,
 * and the next save retries it anyway.
 *
 * Skipped when signed out — the endpoint requires a session, and firing it from
 * the login screen would produce a 401 in the console on every visit.
 */
function persistToServer(theme: CrmTheme): void {
  if (typeof window === "undefined") return;
  try {
    if (!localStorage.getItem("crm_user")) return;
  } catch {
    return;
  }

  void fetch("/api/settings/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
    keepalive: true,
  }).catch((err) => {
    console.warn("[theme] could not save the theme preference:", err);
  });
}

/**
 * Set the theme everywhere: document, storage, listeners, server.
 *
 * `options.persist: false` writes locally without touching the server. Used
 * when adopting a value that CAME from the server, so restoring at login does
 * not immediately echo the same value back.
 */
export function setTheme(theme: CrmTheme, options: { persist?: boolean } = {}): CrmTheme {
  const next = normaliseTheme(theme);

  applyToDocument(next);

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode — the change still applies for this session */
  }

  if (options.persist !== false) persistToServer(next);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<CrmTheme>(CHANGE_EVENT, { detail: next }));
  }

  return next;
}

export function toggleTheme(): CrmTheme {
  return setTheme(getTheme() === "dark" ? "light" : "dark");
}

/**
 * Drop the working copy. Called on logout.
 *
 * Without this the next person to sign in on the same machine inherits the
 * previous user's theme until their own preference loads — and if they never
 * open Preferences, it simply stays wrong. The durable copy on their row is
 * untouched; `adoptServerTheme` puts it back when they sign in.
 */
export function clearTheme(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
  applyToDocument(DEFAULT_THEME);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<CrmTheme>(CHANGE_EVENT, { detail: DEFAULT_THEME }));
  }
}

/**
 * Adopt the value stored on the user's row, without echoing it back.
 *
 * Called right after sign-in. This is what makes "dark mode was selected at
 * last login" hold on a different machine, where localStorage knows nothing.
 */
export function adoptServerTheme(value: unknown): CrmTheme {
  return setTheme(normaliseTheme(value), { persist: false });
}

/* ══════════════════════════════════════════════════════════════════════════
   Subscribing
   ══════════════════════════════════════════════════════════════════════════ */

/** Listen for changes from anywhere — this tab or another. Returns an unsubscribe. */
export function subscribeToTheme(listener: (theme: CrmTheme) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onLocal = (event: Event) => {
    listener((event as CustomEvent<CrmTheme>).detail ?? getTheme());
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    // A `null` newValue is a removal — a logout in another tab.
    listener(event.newValue === null ? DEFAULT_THEME : normaliseTheme(event.newValue));
  };

  window.addEventListener(CHANGE_EVENT, onLocal);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Pre-paint script
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Runs before first paint, injected into <head> by the root layout.
 *
 * Without it there is a visible flash: the server renders with no knowledge of
 * localStorage, so the page paints light and then snaps to dark once React
 * hydrates. On a dark-mode user's every navigation that is a white flash.
 *
 * Deliberately tiny, dependency-free and wrapped in try/catch — it runs before
 * anything else on the page, so a throw here would be the first thing to break
 * and would take the document with it.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{
var t=localStorage.getItem('${STORAGE_KEY}');
if(t!=='dark'&&t!=='light'){t=(t==='system'||t===null)&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
var r=document.documentElement;r.setAttribute('${ROOT_ATTRIBUTE}',t);r.style.colorScheme=t;
}catch(e){}})();`;
