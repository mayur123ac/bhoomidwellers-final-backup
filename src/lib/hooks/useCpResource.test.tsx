// useCpResource — the guarantees the CP panels' loading UX rests on.
//
// Three of these are not performance assertions at all, they are correctness
// assertions that happen to live in a performance helper:
//
//  · a cached URL must report `loading: false` on the FIRST render, because that
//    is the entire reason a returning operator does not see a skeleton over rows
//    they were looking at three seconds ago;
//  · a failed revalidation must not blank rows that are on screen;
//  · the cache must empty itself when the signed-in user changes, because logout
//    in this CRM is a soft navigation and module scope survives it — without
//    that check the next person to sign in would paint the previous tenant's
//    partner list.
//
// The last one is a data-isolation test wearing a performance test's clothes,
// and is the reason this file exists at all.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCpResource, invalidateCpCache, peekCpCache } from "./useCpResource";

const NO_ROWS: unknown[] = [];

/** A `{ success, data }` body, the shape every CP route answers with. */
const body = (data: unknown) => JSON.stringify({ success: true, data });

function mockFetchOnce(payload: string, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => payload,
  });
}

function signIn(id: number) {
  localStorage.setItem("crm_user", JSON.stringify({ _id: id, email: `u${id}@x.com`, role: "admin" }));
}

beforeEach(() => {
  localStorage.clear();
  signIn(1);
  invalidateCpCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  invalidateCpCache();
  localStorage.clear();
});

describe("first load", () => {
  it("reports loading until the response lands, then the rows", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 1 }, { id: 2 }])));

    const { result } = renderHook(() =>
      useCpResource<unknown[]>("/api/channel-partners", { initial: NO_ROWS })
    );

    // The skeleton frame: nothing cached, so there is genuinely nothing to draw.
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("stays idle and fires no request when the url is null", async () => {
    const fetchMock = mockFetchOnce(body([]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useCpResource<unknown[]>(null, { initial: NO_ROWS })
    );

    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a second visit to the same panel", () => {
  it("is not loading on the very first render, so no skeleton is drawn", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 1 }])));

    const first = renderHook(() =>
      useCpResource<unknown[]>("/api/cp-enquiries", { initial: NO_ROWS })
    );
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    // Remount, exactly as switching away from the view and back does.
    const second = renderHook(() =>
      useCpResource<unknown[]>("/api/cp-enquiries", { initial: NO_ROWS })
    );

    // Asserted BEFORE any await: this is the first committed render.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.data).toHaveLength(1);
  });

  it("keeps the same array identity when the response is byte-identical", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 7 }])));

    const { result } = renderHook(() =>
      useCpResource<unknown[]>("/api/channel-partners?x=1", { initial: NO_ROWS })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const firstRows = result.current.data;

    // A revalidation that changed nothing must not hand the table a new array,
    // or every memoised row re-renders for no reason.
    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    expect(result.current.data).toBe(firstRows);
  });

  it("never re-enters loading on an explicit refresh, even after invalidation", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 1 }, { id: 2 }])));

    const { result } = renderHook(() =>
      useCpResource<unknown[]>("/api/cp-enquiries?r=1", { initial: NO_ROWS })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // What the panels' Refresh button does: drop the shared entry so sibling
    // panels re-read, then revalidate. The table stays on screen throughout —
    // putting a skeleton over readable rows here was the original bug.
    const sawLoading: boolean[] = [];
    invalidateCpCache("/api/cp-enquiries");
    act(() => { result.current.refetch(); });
    sawLoading.push(result.current.loading);

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    sawLoading.push(result.current.loading);

    expect(sawLoading).toEqual([false, false]);
    expect(result.current.data).toHaveLength(2);
  });

  it("does show a skeleton when the url changes, because the old rows are the wrong answer", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 1 }])));

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useCpResource<unknown[]>(url, { initial: NO_ROWS }),
      { initialProps: { url: "/api/cp-enquiries?sm=1" } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A different filter is a different question; the rows on screen answer the
    // previous one, so showing them while the new list loads would be wrong.
    rerender({ url: "/api/cp-enquiries?sm=2" });
    expect(result.current.loading).toBe(true);
  });
});

describe("failures", () => {
  it("surfaces the error and leaves the rows on screen", async () => {
    const ok = mockFetchOnce(body([{ id: 1 }, { id: 2 }]));
    vi.stubGlobal("fetch", ok);

    const { result } = renderHook(() =>
      useCpResource<unknown[]>("/api/cp-enquiries?f=1", { initial: NO_ROWS })
    );
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ success: false, message: "Boom." }),
    }));

    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.error).toBe("Boom."));

    // The point of the whole error path: readable rows are not thrown away
    // because a background refresh failed.
    expect(result.current.data).toHaveLength(2);
    expect(result.current.loading).toBe(false);
  });

  it("reports a malformed body rather than crashing the panel", async () => {
    vi.stubGlobal("fetch", mockFetchOnce("<html>gateway error</html>"));

    const { result } = renderHook(() =>
      useCpResource<unknown[]>("/api/cp-enquiries?f=2", { initial: NO_ROWS })
    );

    await waitFor(() => expect(result.current.error).toBe("Malformed response."));
    expect(result.current.loading).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("empties the cache when the signed-in user changes", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 1, name: "Tenant A partner" }])));

    const a = renderHook(() =>
      useCpResource<unknown[]>("/api/channel-partners", { initial: NO_ROWS })
    );
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    a.unmount();

    expect(peekCpCache("/api/channel-partners")).toBeDefined();

    // Logout is a soft nav in this app, so module scope survives it. Someone
    // else signing in on the same tab must not inherit that entry.
    signIn(2);
    expect(peekCpCache("/api/channel-partners")).toBeUndefined();

    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 9, name: "Tenant B partner" }])));
    const b = renderHook(() =>
      useCpResource<unknown[]>("/api/channel-partners", { initial: NO_ROWS })
    );

    // Back to a skeleton, which is the correct answer: this user has no rows yet.
    expect(b.result.current.loading).toBe(true);
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(b.result.current.data).toEqual([{ id: 9, name: "Tenant B partner" }]);
  });
});

describe("invalidation", () => {
  it("drops only the entries matching the substring", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(body([{ id: 1 }])));

    const partners = renderHook(() =>
      useCpResource<unknown[]>("/api/channel-partners", { initial: NO_ROWS })
    );
    const enquiries = renderHook(() =>
      useCpResource<unknown[]>("/api/cp-enquiries", { initial: NO_ROWS })
    );
    await waitFor(() => expect(partners.result.current.loading).toBe(false));
    await waitFor(() => expect(enquiries.result.current.loading).toBe(false));

    invalidateCpCache("/api/cp-enquiries");

    expect(peekCpCache("/api/channel-partners")).toBeDefined();
    expect(peekCpCache("/api/cp-enquiries")).toBeUndefined();
  });
});

describe("request sharing", () => {
  it("makes one request when two hooks want the same url at once", async () => {
    const fetchMock = mockFetchOnce(body([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => {
      const a = useCpResource<unknown[]>("/api/channel-partners?shared=1", { initial: NO_ROWS });
      const b = useCpResource<unknown[]>("/api/channel-partners?shared=1", { initial: NO_ROWS });
      return { a, b };
    });

    await waitFor(() => expect(result.current.a.loading).toBe(false));
    await waitFor(() => expect(result.current.b.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
