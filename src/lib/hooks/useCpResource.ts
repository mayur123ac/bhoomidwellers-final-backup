"use client";
// useCpResource — the CP panels' read path.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// CP Management, CP Enquiries, CP Chat and Channel Partners are all rendered by
// `activeView === …` on their host page, so leaving one and coming back
// UNMOUNTS and REMOUNTS the panel. Every one of them started from empty state
// and refetched, which meant a second visit to CP Management cost the same
// ~350 ms of Neon round trip as the first and put the table back to a "Loading"
// row — a table the operator had been looking at three seconds earlier.
//
// This keeps the last successful body per URL in module scope. A remount paints
// the cached rows on the FIRST render (so no skeleton, no layout shift) and
// revalidates in the background; when the response lands the rows are replaced
// only if the JSON actually differs, so an unchanged list does not re-render
// the table at all.
//
// ── Why the cache is owner-keyed ────────────────────────────────────────────
// Logout is a soft navigation (router.replace), so module scope survives a user
// switch on the same tab — the same trap the header avatar and attendance badge
// had to be fixed for. A cache that survived would let the next person to sign
// in see the previous tenant's partner rows on first paint. So every read and
// write first checks who the cache belongs to, and a mismatch empties it before
// anything is served. That is a data-isolation guard, not an optimisation: it
// runs before the cache is consulted, on every access.
//
// Nothing here changes what the server returns or who may call it. The API
// routes remain the only authority on scoping; this only decides whether a
// panel paints from the previous answer while it waits for the next one.

import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredCrmUser } from "@/lib/authSession";

type Entry = { body: string; data: unknown; at: number };

/** The `{ success, data, message }` envelope every CP route answers with. */
type ApiEnvelope = { success?: boolean; message?: string; data?: unknown };

/** The fields of the stored CRM user this module reads, and only those. */
type StoredUser = { _id?: string | number; id?: string | number; email?: string; role?: string };

const cache = new Map<string, Entry>();
let cacheOwner: string | null = null;

/**
 * Requests currently on the wire, keyed by URL.
 *
 * Two panels — or two hooks in one panel — regularly want the same list at the
 * same moment: the Channel Partners table asks for the registry and for the
 * "needs rate" queue, and on that tab those are literally the same URL. Sharing
 * the promise makes that one request instead of two identical ones racing.
 */
const inflight = new Map<string, Promise<{ text: string; ok: boolean; status: number }>>();

function sharedGet(url: string) {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = (async () => {
    const res = await fetch(url);
    return { text: await res.text(), ok: res.ok, status: res.status };
  })().finally(() => { inflight.delete(url); });
  inflight.set(url, p);
  return p;
}

/** Identity of the signed-in user, as far as the browser can know it. */
function currentOwner(): string {
  try {
    const u = getStoredCrmUser() as StoredUser | null;
    if (!u) return "anonymous";
    return `${u._id ?? u.id ?? ""}|${u.email ?? ""}|${u.role ?? ""}`;
  } catch {
    return "anonymous";
  }
}

/** Empties the cache if it belongs to someone other than the current user. */
function assertOwner() {
  const owner = currentOwner();
  if (cacheOwner !== owner) {
    cache.clear();
    cacheOwner = owner;
  }
}

/** The whole cache entry for `key`, or undefined. Owner-checked. */
function readEntry(key: string): Entry | undefined {
  assertOwner();
  return cache.get(key);
}

/** The cached body for `key`, or undefined. Owner-checked. */
export function peekCpCache<T = unknown>(key: string): T | undefined {
  return readEntry(key)?.data as T | undefined;
}

/**
 * Drops cached entries whose key contains `substring` (all of them when it is
 * omitted). Called after a write — a reassignment, a bulk assign, a delete —
 * so the next read cannot serve the list the write just invalidated.
 */
export function invalidateCpCache(substring?: string) {
  assertOwner();
  if (!substring) { cache.clear(); return; }
  for (const key of [...cache.keys()]) {
    if (key.includes(substring)) cache.delete(key);
  }
}

export type CpResource<T> = {
  data: T;
  /** True only when there is nothing to show yet — i.e. when to draw a skeleton. */
  loading: boolean;
  /** True while a background revalidation is in flight over existing data. */
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * GETs `url` (JSON, `{ success, data }` shaped) with a cached first paint.
 *
 * `url` may be null, which means "nothing to load yet" — the hook stays idle
 * rather than firing a request, which is how the panels express "no partner is
 * selected".
 */
export function useCpResource<T>(
  url: string | null,
  options: {
    /** What `data` is before anything has loaded. Must be a stable reference. */
    initial: T;
    /** Bumped by the caller to force a revalidation. */
    refreshKey?: number;
  }
): CpResource<T> {
  const { initial, refreshKey = 0 } = options;

  // Seeded from the cache during the first render, not in an effect: an effect
  // would paint one empty frame first, which is the layout shift this is here
  // to avoid.
  const seed = url ? readEntry(url) : undefined;
  const [data, setData] = useState<T>(() => (seed ? (seed.data as T) : initial));
  const [loading, setLoading] = useState(url != null && seed === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Identifies the request this component is currently interested in. A late
  // response for a URL we have since navigated away from is dropped rather than
  // written into state.
  const wantedRef = useRef<string | null>(url);
  wantedRef.current = url;

  // What is actually on screen, independent of the shared cache.
  //
  // These two exist because the cache can be dropped out from under a mounted
  // panel: a reassignment invalidates `/api/channel-partners` so every other
  // panel re-reads it, and the panel that performed the write is refreshing at
  // that moment too. Judging "have I got anything to show" from the cache alone
  // made that panel flash a skeleton over a table the operator was reading, and
  // made the byte-comparison below always miss. So the component remembers its
  // own last body and which URL it belongs to.
  const shownUrlRef = useRef<string | null>(seed ? url : null);
  const shownBodyRef = useRef<string | null>(seed ? seed.body : null);

  useEffect(() => {
    if (!url) {
      setData(initial);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      shownUrlRef.current = null;
      shownBodyRef.current = null;
      return;
    }

    const hit = readEntry(url);
    if (hit) {
      setData(hit.data as T);
      shownUrlRef.current = url;
      shownBodyRef.current = hit.body;
      setLoading(false);
      setRefreshing(true);
      setError(null);
    } else if (shownUrlRef.current === url) {
      // Same list, no cache entry — an explicit Refresh, or a write that
      // invalidated it. Rows are still on screen and still correct until the
      // answer changes them, so this is a refresh, not a cold load.
      setLoading(false);
      setRefreshing(true);
    } else {
      // Cold, or a different list entirely (a filter changed). Rows for the
      // previous URL would be the wrong answer to the new question, so this one
      // does get a skeleton.
      setLoading(true);
      setRefreshing(false);
    }

    let cancelled = false;
    (async () => {
      try {
        const { text, ok, status } = await sharedGet(url);
        if (cancelled || wantedRef.current !== url) return;

        let body: ApiEnvelope;
        try { body = JSON.parse(text) as ApiEnvelope; } catch { throw new Error("Malformed response."); }
        if (!ok || body?.success === false) {
          throw new Error(body?.message || `Request failed (${status}).`);
        }

        const next = body?.data as T;
        const prevBody = shownUrlRef.current === url ? shownBodyRef.current : null;
        assertOwner();
        cache.set(url, { body: text, data: next, at: Date.now() });

        setError(null);
        // Identical bytes mean identical rows: keeping the previous object
        // identity lets a memoised table skip re-rendering entirely on a
        // revalidation that changed nothing.
        if (prevBody !== text) setData(next);
        shownUrlRef.current = url;
        shownBodyRef.current = text;
      } catch (e: unknown) {
        if (cancelled || wantedRef.current !== url) return;
        // A failed revalidation must not blank out rows that are on screen and
        // still perfectly readable — the error is surfaced, the data stays.
        setError(e instanceof Error ? e.message : "Network error.");
      } finally {
        if (!cancelled && wantedRef.current === url) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => { cancelled = true; };
    // `initial` is documented as a stable reference; listing it would re-run
    // this on every render for callers who pass a literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshKey, tick]);

  // Forces a revalidation. It deliberately does NOT drop the cached entry:
  // clearing it would put this panel back to a skeleton over rows that are
  // still on screen. Callers that need other panels to re-read — after a
  // reassignment, a bulk assign, a delete — invalidate those keys themselves.
  const refetch = useCallback(() => {
    setTick(t => t + 1);
  }, []);

  return { data, loading, refreshing, error, refetch };
}
