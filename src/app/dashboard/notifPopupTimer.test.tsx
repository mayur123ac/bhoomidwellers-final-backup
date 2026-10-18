// notifPopupTimer.test.tsx — verifies the notification popup auto-dismiss
// and hydration-vs-live behaviour in dashboard/page.tsx.
//
// The test exercises the exact useState/useEffect/useRef patterns used in
// the dashboard, extracted into minimal hooks so they can run without
// mounting the 9000-line page component.

import { renderHook, act } from "@testing-library/react";
import { useState, useEffect, useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Types ───────────────────────────────────────────────────────────────────

type CrmNotif = { id: string; line1: string; line2: string; type: "lead" | "visit"; leadId?: number };

type CrmNotification = { id: string; title: string; subtitle: string; kind: string; leadId: number };

const mkNotif = (id: string): CrmNotif => ({
  id, line1: `Line1-${id}`, line2: `Line2-${id}`, type: "lead",
});

const mkServerNotif = (id: string): CrmNotification => ({
  id, title: `Title-${id}`, subtitle: `Sub-${id}`, kind: "new_lead", leadId: parseInt(id) || 0,
});

// ─── Hook A: popup timer + dequeue (mirrors lines 970-998) ──────────────────

function useNotifPopup(initialQueue: CrmNotif[] = []) {
  const [notifQueue, setNotifQueue] = useState<CrmNotif[]>(initialQueue);
  const [activeNotif, setActiveNotif] = useState<CrmNotif | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeNotifId = activeNotif?.id ?? null;

  useEffect(() => {
    if (activeNotifId || notifQueue.length === 0) return;
    const next = notifQueue[0];
    setActiveNotif(next);
    setNotifQueue(prev => prev.slice(1));
  }, [activeNotifId, notifQueue]);

  useEffect(() => {
    if (!activeNotifId) {
      if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
      return;
    }
    const startedForId = activeNotifId;
    notifTimerRef.current = setTimeout(() => {
      notifTimerRef.current = null;
      setActiveNotif(prev => (prev?.id === startedForId ? null : prev));
    }, 2000);
    return () => {
      if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
    };
  }, [activeNotifId]);

  return {
    activeNotif,
    notifQueue,
    dismiss: () => setActiveNotif(null),
    enqueue: (items: CrmNotif[]) => setNotifQueue(prev => [...prev, ...items]),
  };
}

// ─── Hook B: queue populator with hydration gate (mirrors lines 921-976) ────

/**
 * Minimal reproduction of the queue populator effect. Uses an in-memory Map
 * as a stand-in for localStorage so tests are isolated and deterministic.
 */
function useNotifQueuePopulator(opts: {
  notificationHistory: CrmNotification[];
  organizationId: string | null;
  storage: Map<string, string>;
}) {
  const { notificationHistory, organizationId, storage } = opts;
  const [notifQueue, setNotifQueue] = useState<CrmNotif[]>([]);
  const [notifCount, setNotifCount] = useState(0);
  const [activeNotif, setActiveNotif] = useState<CrmNotif | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupFeedInitialized = useRef(false);

  // Queue populator — same logic as dashboard/page.tsx
  useEffect(() => {
    if (!organizationId) return;
    if (notificationHistory.length === 0) return;

    const storageKey = `crm_shown_notif_ids:${organizationId}`;
    let storedIds: string[] = [];
    try {
      const item = storage.get(storageKey);
      storedIds = item ? JSON.parse(item) : [];
      if (!Array.isArray(storedIds)) storedIds = [];
    } catch { storedIds = []; }

    const seenSet = new Set(storedIds);

    if (!popupFeedInitialized.current) {
      let wrote = false;
      for (const n of notificationHistory) {
        if (!seenSet.has(n.id)) { seenSet.add(n.id); wrote = true; }
      }
      if (wrote) {
        try { storage.set(storageKey, JSON.stringify(Array.from(seenSet))); } catch { }
      }
      popupFeedInitialized.current = true;
      return;
    }

    const fresh: CrmNotif[] = [];
    for (const n of notificationHistory) {
      if (seenSet.has(n.id)) continue;
      fresh.push({
        id: n.id, line1: n.title, line2: n.subtitle,
        type: n.kind === "site_visit" ? "visit" : "lead",
        leadId: n.leadId,
      });
      seenSet.add(n.id);
    }

    if (fresh.length > 0) {
      setNotifQueue(prev => [...prev, ...fresh]);
      setNotifCount(c => c + fresh.length);
      try { storage.set(storageKey, JSON.stringify(Array.from(seenSet))); } catch { }
    }
  }, [notificationHistory, organizationId, storage]);

  // Dequeue + auto-dismiss (same as Hook A)
  const activeNotifId = activeNotif?.id ?? null;

  useEffect(() => {
    if (activeNotifId || notifQueue.length === 0) return;
    setActiveNotif(notifQueue[0]);
    setNotifQueue(prev => prev.slice(1));
  }, [activeNotifId, notifQueue]);

  useEffect(() => {
    if (!activeNotifId) {
      if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
      return;
    }
    const startedForId = activeNotifId;
    notifTimerRef.current = setTimeout(() => {
      notifTimerRef.current = null;
      setActiveNotif(prev => (prev?.id === startedForId ? null : prev));
    }, 2000);
    return () => {
      if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
    };
  }, [activeNotifId]);

  return { activeNotif, notifQueue, notifCount, popupFeedInitialized };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Notification popup timer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("auto-dismisses after 2000ms", () => {
    const { result } = renderHook(() => useNotifPopup([mkNotif("a")]));
    expect(result.current.activeNotif?.id).toBe("a");

    act(() => { vi.advanceTimersByTime(1999); });
    expect(result.current.activeNotif?.id).toBe("a");

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.activeNotif).toBeNull();
  });

  it("does not reset the timer when new notifications are enqueued", () => {
    const { result } = renderHook(() => useNotifPopup([mkNotif("a")]));
    expect(result.current.activeNotif?.id).toBe("a");

    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { result.current.enqueue([mkNotif("b"), mkNotif("c")]); });

    expect(result.current.activeNotif?.id).toBe("a");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.activeNotif?.id).toBe("b");
  });

  it("processes multiple notifications sequentially", () => {
    const { result } = renderHook(() => useNotifPopup([mkNotif("1"), mkNotif("2"), mkNotif("3")]));

    expect(result.current.activeNotif?.id).toBe("1");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeNotif?.id).toBe("2");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeNotif?.id).toBe("3");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeNotif).toBeNull();
    expect(result.current.notifQueue).toHaveLength(0);
  });

  it("manual close does not cause a stale timeout to dismiss the next popup", () => {
    const { result } = renderHook(() => useNotifPopup([mkNotif("a"), mkNotif("b")]));
    expect(result.current.activeNotif?.id).toBe("a");

    act(() => { vi.advanceTimersByTime(500); });
    act(() => { result.current.dismiss(); });

    expect(result.current.activeNotif?.id).toBe("b");

    // Stale timer for "a" must not dismiss "b"
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.activeNotif?.id).toBe("b");

    // "b"'s own timer fires 2000ms after it appeared
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.activeNotif).toBeNull();
  });

  it("timer is cleaned up on unmount", () => {
    const { result, unmount } = renderHook(() => useNotifPopup([mkNotif("a")]));
    expect(result.current.activeNotif?.id).toBe("a");
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
  });

  it("empty queue does not show a popup", () => {
    const { result } = renderHook(() => useNotifPopup([]));
    expect(result.current.activeNotif).toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.activeNotif).toBeNull();
  });
});

describe("Queue populator — hydration vs live", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does NOT enqueue popups on initial hydration with empty seen-ID store", () => {
    const storage = new Map<string, string>();
    const history = [mkServerNotif("1"), mkServerNotif("2"), mkServerNotif("3")];

    const { result } = renderHook(() =>
      useNotifQueuePopulator({ notificationHistory: history, organizationId: "org-a", storage }),
    );

    // No popup should appear — these are pre-existing notifications.
    expect(result.current.activeNotif).toBeNull();
    expect(result.current.notifQueue).toHaveLength(0);
    expect(result.current.notifCount).toBe(0);

    // But the IDs should be written to storage as "seen".
    const stored = JSON.parse(storage.get("crm_shown_notif_ids:org-a") || "[]");
    expect(stored).toContain("1");
    expect(stored).toContain("2");
    expect(stored).toContain("3");

    // The feed-initialized flag should be set.
    expect(result.current.popupFeedInitialized.current).toBe(true);
  });

  it("does NOT enqueue popups when multiple notifications arrive during hydration", () => {
    const storage = new Map<string, string>();
    // Simulate a large initial feed — 10 notifications
    const history = Array.from({ length: 10 }, (_, i) => mkServerNotif(String(i + 1)));

    const { result } = renderHook(() =>
      useNotifQueuePopulator({ notificationHistory: history, organizationId: "org-b", storage }),
    );

    expect(result.current.activeNotif).toBeNull();
    expect(result.current.notifQueue).toHaveLength(0);
    expect(result.current.notifCount).toBe(0);

    // All 10 IDs are in storage
    const stored = JSON.parse(storage.get("crm_shown_notif_ids:org-b") || "[]");
    expect(stored).toHaveLength(10);

    // Advance timers — still no popup
    act(() => { vi.advanceTimersByTime(10000); });
    expect(result.current.activeNotif).toBeNull();
  });

  it("enqueues a genuinely new notification arriving after initialization", () => {
    const storage = new Map<string, string>();
    const initialHistory = [mkServerNotif("1"), mkServerNotif("2")];

    const { result, rerender } = renderHook(
      ({ history }) => useNotifQueuePopulator({
        notificationHistory: history, organizationId: "org-c", storage,
      }),
      { initialProps: { history: initialHistory } },
    );

    // Hydration: no popups
    expect(result.current.activeNotif).toBeNull();
    expect(result.current.notifCount).toBe(0);

    // Now simulate a new notification arriving via SSE (feed updates)
    const updatedHistory = [...initialHistory, mkServerNotif("3")];
    rerender({ history: updatedHistory });

    // "3" is genuinely new — should appear as a popup
    expect(result.current.activeNotif?.id).toBe("3");
    expect(result.current.notifCount).toBe(1);

    // And auto-dismiss after 2s
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeNotif).toBeNull();
  });

  it("handles multiple live notifications arriving rapidly after initialization", () => {
    const storage = new Map<string, string>();
    const initialHistory = [mkServerNotif("old-1")];

    const { result, rerender } = renderHook(
      ({ history }) => useNotifQueuePopulator({
        notificationHistory: history, organizationId: "org-d", storage,
      }),
      { initialProps: { history: initialHistory } },
    );

    // Hydration complete, no popups
    expect(result.current.activeNotif).toBeNull();

    // Two new notifications arrive at once
    rerender({ history: [...initialHistory, mkServerNotif("new-1"), mkServerNotif("new-2")] });

    expect(result.current.activeNotif?.id).toBe("new-1");
    expect(result.current.notifCount).toBe(2);

    // First popup auto-dismisses, second appears
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeNotif?.id).toBe("new-2");

    // Second auto-dismisses
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeNotif).toBeNull();
    expect(result.current.notifQueue).toHaveLength(0);
  });

  it("preserves storage across hydration and live phases", () => {
    const storage = new Map<string, string>();
    const initialHistory = [mkServerNotif("a"), mkServerNotif("b")];

    const { rerender } = renderHook(
      ({ history }) => useNotifQueuePopulator({
        notificationHistory: history, organizationId: "org-e", storage,
      }),
      { initialProps: { history: initialHistory } },
    );

    // After hydration, "a" and "b" are in storage
    let stored = JSON.parse(storage.get("crm_shown_notif_ids:org-e") || "[]");
    expect(new Set(stored)).toEqual(new Set(["a", "b"]));

    // New notification "c" arrives
    rerender({ history: [...initialHistory, mkServerNotif("c")] });

    // "c" is added to storage
    stored = JSON.parse(storage.get("crm_shown_notif_ids:org-e") || "[]");
    expect(new Set(stored)).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not enqueue popups when feed re-delivers the same items (no new IDs)", () => {
    const storage = new Map<string, string>();
    const history = [mkServerNotif("x"), mkServerNotif("y")];

    const { result, rerender } = renderHook(
      ({ history: h }) => useNotifQueuePopulator({
        notificationHistory: h, organizationId: "org-f", storage,
      }),
      { initialProps: { history } },
    );

    // Hydration
    expect(result.current.notifCount).toBe(0);

    // Simulate a poll that returns the same items (new array reference, same IDs)
    rerender({ history: [mkServerNotif("x"), mkServerNotif("y")] });

    // Still no popups — IDs already in storage
    expect(result.current.activeNotif).toBeNull();
    expect(result.current.notifCount).toBe(0);
  });
});
