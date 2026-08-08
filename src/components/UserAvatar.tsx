"use client";

// components/UserAvatar.tsx — the picture-or-initial, for every header avatar.
//
// ── What this deliberately is NOT ───────────────────────────────────────────
// It is not a container. Each dashboard's avatar button has its own size,
// border, colours and click behaviour, and those are staying exactly as they
// are — so this renders only the CONTENTS of that button, as a drop-in for the
// `{String(user?.name || "A").charAt(0).toUpperCase()}` expression that used to
// be there. Nothing about the surrounding markup changes.
//
// The picture comes from the shared store, not from a prop, so all eight
// headers show the same thing without anyone having to thread it through eight
// page components. `name` is still a prop because the fallback initial is the
// only part that differs per call site.

import { useState } from "react";
import { useUserAvatar } from "@/lib/hooks/useUserAvatar";

export default function UserAvatar({
  name,
  fallback = "U",
  fallbackNode,
  alt = "",
}: {
  name?: string | null;
  /** Shown when there is no name either — each header already had its own. */
  fallback?: string;
  /**
   * What to render instead of an initial when there is no picture. The Sales
   * and Sourcing headers never showed a letter — they show a FaUserCircle
   * glyph — and "do not redesign the header" means they keep showing it.
   */
  fallbackNode?: React.ReactNode;
  alt?: string;
}) {
  const avatarUrl = useUserAvatar();
  // A stored URL can 404 — an R2 object deleted behind the app's back, or a
  // local file lost with the .next cache. Falling back to the initial is better
  // than a broken-image glyph in the header.
  //
  // The failure is remembered as the URL that failed, not as a boolean: a later
  // upload produces a different URL, so the check clears itself. A boolean
  // would have stuck on the initial for the rest of the session, and a `key`
  // would not have reset it — key resets a child's state, not the state of the
  // component holding it.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  if (avatarUrl && brokenUrl !== avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={alt}
        // Fills whatever container it is dropped into, so the host's sizing is
        // still the only thing deciding how big the avatar is.
        className="h-full w-full rounded-full object-cover"
        onError={() => setBrokenUrl(avatarUrl)}
      />
    );
  }

  if (fallbackNode !== undefined) return <>{fallbackNode}</>;
  return <>{String(name || fallback).charAt(0).toUpperCase()}</>;
}
