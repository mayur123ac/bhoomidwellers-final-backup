"use client";

// useUserAvatar — the signed-in user's profile picture, for components.
//
// Mirrors useCrmTheme, including the choice of useSyncExternalStore: the avatar
// is a genuine external store (localStorage plus a module-level subscriber
// list) that changes from places React knows nothing about — an upload on the
// Profile screen, a removal in another tab, a sign-out.
//
// ── The backfill ────────────────────────────────────────────────────────────
// Anyone already signed in when this shipped has no `crm_avatar` key, and so
// would see their initial in the header until they signed out and back in. One
// fetch on first mount fixes that, and only ever runs when the answer is
// genuinely unknown — an empty string is a known "no picture" and does not
// re-trigger it. The promise is module-level, so eight headers mounting at once
// still make one request.

import { useEffect, useSyncExternalStore } from "react";
import {
  adoptServerAvatar,
  getAvatarUrl,
  hasResolvedAvatar,
  subscribeToAvatar,
} from "@/lib/userAvatar";

let backfill: Promise<unknown> | null = null;

function ensureResolved() {
  if (hasResolvedAvatar() || backfill) return;

  backfill = fetch("/api/settings/profile", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      // A 401 or a failure leaves the key absent rather than writing a wrong
      // answer, so the next mount tries again instead of committing to "no
      // picture" because one request happened to fail.
      if (json?.user) adoptServerAvatar(json.user.avatarUrl);
    })
    .catch(() => {
      /* leave unresolved; the initial is a correct fallback meanwhile */
    })
    .finally(() => {
      backfill = null;
    });
}

/** The server has no localStorage, so it renders the fallback initial. */
function getServerSnapshot(): string | null {
  return null;
}

export function useUserAvatar(): string | null {
  const avatarUrl = useSyncExternalStore(subscribeToAvatar, getAvatarUrl, getServerSnapshot);

  // In an effect, not during render: it writes to the store, and a store write
  // during render is what tears concurrent passes.
  useEffect(() => {
    ensureResolved();
  }, []);

  return avatarUrl;
}
