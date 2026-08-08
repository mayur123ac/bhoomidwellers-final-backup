"use client";

// useCrmTheme — the theme, for components.
//
// Every header toggle and the Preferences radio group use this. They all read
// and write the same value in lib/theme.ts, so switching in any one of them
// moves all the others in the same tick — which is the thing that was missing
// before: six components each held their own `isDark` and none of them agreed.
//
// ── Why useSyncExternalStore ────────────────────────────────────────────────
// The theme is a genuine external store: it lives in localStorage and a
// module-level subscriber list, and it changes from places React knows nothing
// about (another component's toggle, another browser tab, a logout).
//
// The obvious alternative — useState plus an effect that adopts the real value
// on mount — works but is wrong in two ways this hook has to get right. It
// renders one frame with the wrong theme before the effect runs, and it tears
// during concurrent rendering, where two components reading the same store can
// commit different values in one pass.
//
// useSyncExternalStore exists for exactly this shape. It takes a separate
// server snapshot, so hydration is correct by construction rather than by an
// effect that fires afterwards.

import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  getTheme,
  setTheme as setThemeGlobal,
  subscribeToTheme,
  toggleTheme as toggleThemeGlobal,
  type CrmTheme,
} from "@/lib/theme";

export interface UseCrmTheme {
  theme: CrmTheme;
  isDark: boolean;
  setTheme: (theme: CrmTheme) => void;
  toggleTheme: () => void;
}

/**
 * The server has no localStorage, so it always renders the default and the
 * markup it produces must be reproducible on the client's first pass — anything
 * else is a hydration mismatch.
 *
 * The visible theme is not actually wrong during that pass: the pre-paint script
 * in the root layout has already set `data-crm-theme` on <html>, so the page is
 * painted correctly before React runs at all. Only the React-driven bits (the
 * sun/moon glyph) settle a tick later.
 */
function getServerSnapshot(): CrmTheme {
  return DEFAULT_THEME;
}

export function useCrmTheme(): UseCrmTheme {
  // getTheme returns a string, so the snapshot compares by value and cannot
  // loop — the usual useSyncExternalStore trap is returning a fresh object.
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, getServerSnapshot);

  return {
    theme,
    isDark: theme === "dark",
    // Passed straight through. Writing local state here too would create a
    // second path for the value to arrive by, and two paths can disagree.
    setTheme: setThemeGlobal,
    toggleTheme: toggleThemeGlobal,
  };
}
