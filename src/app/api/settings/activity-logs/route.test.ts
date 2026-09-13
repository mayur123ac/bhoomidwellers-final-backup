// @vitest-environment node
//
// Regression tests for GET /api/settings/activity-logs
//
// Root cause: the old route queried `SELECT details FROM audit_logs` but
// audit_logs has no `details` column.  The fix delegates to fetchActivityFeed
// (lib/auditLog.ts) which synthesises `details` via a UNION over the three
// audit tables.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityRow } from "@/lib/auditLog";

// ── Stable mock rows ─────────────────────────────────────────────────────────

const MOCK_ROW: ActivityRow = {
  source: "audit",
  id: 1,
  user_id: 42,
  actor_name: "Test User",
  action: "profile.update",
  details: "name → Test User",
  ip_address: "1.2.3.4",
  user_agent: "Mozilla/5.0",
  created_at: "2026-09-13T10:00:00Z",
};

// ── Static mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => ({
    ok: true,
    userId: 42,
    session: { name: "Test User", role: "admin" },
    response: undefined,
  })),
}));

vi.mock("@/lib/auditLog", () => ({
  fetchActivityFeed: vi.fn(async () => ({ rows: [MOCK_ROW], total: 1 })),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "test-org-uuid"),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { requireSession } from "@/lib/serverAuth";
import { fetchActivityFeed } from "@/lib/auditLog";

const mockRequireSession = vi.mocked(requireSession);
const mockFetchActivityFeed = vi.mocked(fetchActivityFeed);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGet(qs: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/settings/activity-logs");
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: "GET" });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/settings/activity-logs", () => {
  let GET: (req: any) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Restore defaults after clearAllMocks
    mockRequireSession.mockResolvedValue({
      ok: true,
      userId: 42,
      session: { name: "Test User", role: "admin" },
      response: undefined,
    } as any);

    mockFetchActivityFeed.mockResolvedValue({ rows: [MOCK_ROW], total: 1 });

    const mod = await import("./route");
    GET = mod.GET;
  });

  // ── 1. Authenticated user gets their activity logs ────────────────────────

  it("1. authenticated user receives activity logs", async () => {
    const res = await GET(makeGet({ from: "2026-08-14", to: "2026-09-13T23:59:59" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows).toHaveLength(1);
  });

  // ── 2. Unauthenticated request is rejected ────────────────────────────────

  it("2. unauthenticated request is rejected", async () => {
    mockRequireSession.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }),
    } as any);

    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    // fetchActivityFeed must NOT have been called
    expect(mockFetchActivityFeed).not.toHaveBeenCalled();
  });

  // ── 3. organization_id cannot be widened via query param ─────────────────

  it("3. userId used from session, not from query param", async () => {
    const res = await GET(makeGet({ userId: "999" }));
    expect(res.status).toBe(200);

    // fetchActivityFeed must be called with the SESSION's userId (42), not 999
    expect(mockFetchActivityFeed).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42 })
    );
    expect(mockFetchActivityFeed).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: 999 })
    );
  });

  // ── 4. `details` field is returned and synthesised by fetchActivityFeed ──

  it("4. response includes synthesised details field (no direct audit_logs.details query)", async () => {
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.rows[0].details).toBe("name → Test User");
    // Confirm we delegate to fetchActivityFeed, not raw SQL on audit_logs
    expect(mockFetchActivityFeed).toHaveBeenCalledTimes(1);
  });

  // ── 5. Date range is passed through to fetchActivityFeed ─────────────────

  it("5. date range filtering passed to fetchActivityFeed", async () => {
    await GET(makeGet({ from: "2026-08-01", to: "2026-08-31T23:59:59" }));
    expect(mockFetchActivityFeed).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-08-01", to: "2026-08-31T23:59:59" })
    );
  });

  // ── 6. Action-type filter is passed through ───────────────────────────────

  it("6. action filter passed to fetchActivityFeed", async () => {
    await GET(makeGet({ action: "password" }));
    expect(mockFetchActivityFeed).toHaveBeenCalledWith(
      expect.objectContaining({ action: "password" })
    );
  });

  // ── 7. 'All actions' (empty action) passes undefined/null, not '' ─────────

  it("7. empty action filter passes undefined (All actions)", async () => {
    await GET(makeGet({ action: "" }));
    // actionFilter will be falsy — route passes undefined to fetchActivityFeed
    expect(mockFetchActivityFeed).toHaveBeenCalledWith(
      expect.objectContaining({ action: undefined })
    );
  });

  // ── 8. CSV export returns correct CSV content ─────────────────────────────

  it("8. CSV export returns text/csv with correct headers and data", async () => {
    const res = await GET(makeGet({ format: "csv" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("activity-logs.csv");

    const text = await res.text();
    expect(text).toMatch(/^Date,Action,Details,IP Address\n/);
    expect(text).toContain("profile.update");
  });

  // ── 9. CSV export uses synthesised details (not nonexistent audit_logs.details) ──

  it("9. CSV export details comes from fetchActivityFeed, not raw audit_logs.details", async () => {
    const res = await GET(makeGet({ format: "csv" }));
    const text = await res.text();
    expect(text).toContain("name → Test User");
    // fetchActivityFeed must be called with large limit for CSV
    expect(mockFetchActivityFeed).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10000, offset: 0 })
    );
  });

  // ── 10. User cannot access another user's logs (userId ignored from QS) ──

  it("10. userId query param is ignored; only session userId is used", async () => {
    // Even if someone passes userId=1 on the query string, fetchActivityFeed
    // must receive userId=42 (the session user), not 1.
    await GET(makeGet({ userId: "1" }));
    const call = mockFetchActivityFeed.mock.calls[0][0];
    expect(call.userId).toBe(42);
  });

  // ── Field name mapping ────────────────────────────────────────────────────

  it("response maps ActivityRow fields to UI-expected camelCase names", async () => {
    const res = await GET(makeGet());
    const body = await res.json();
    const row = body.rows[0];
    // UI reads row.timestamp, row.actor, row.ipAddress, row.device
    expect(row.timestamp).toBe("2026-09-13T10:00:00Z");
    expect(row.actor).toBe("Test User");
    expect(row.ipAddress).toBe("1.2.3.4");
    expect(row.device).toBe("Mozilla/5.0");
    // Response uses 'rows', not 'logs'
    expect(body).toHaveProperty("rows");
    expect(body).not.toHaveProperty("logs");
  });

  // ── Pagination fields ─────────────────────────────────────────────────────

  it("response includes pagination fields", async () => {
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("totalPages");
    expect(body).toHaveProperty("perPage");
  });
});
