// @vitest-environment node
//
// Regression tests for POST /api/attendance/mark
//
// Covers:
//   1. Successful mark with active session (happy path)
//   2. Successful mark with expired session today (the bug fix)
//   3. No session today at all → 404
//   4. Idempotent: already marked today → returns existing record
//   5. Explicit session_id in body → uses it directly
//   6. Unauthorized role → 401
//   7. Cannot determine user → 400
//   8. UNIQUE constraint violation on login_session_id → 500
//   9. Error response includes actionable message
//  10. Multiple sessions today: picks the most recent
//  11. New mark returns markedAt timestamp
//  12. Idempotent re-mark preserves original markedAt
//  13. Historical records without submitted_at show null markedAt
//  14. RETURNING clause includes submitted_at

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/serverAuth", () => ({
  requireRole: vi.fn(async () => ({
    isAuthorized: true,
    session: { _id: "42", name: "Test User", email: "test@test.com", role: "sales_manager", org: "org-1" },
  })),
  getSessionUserId: vi.fn(() => 42),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
}));

vi.mock("@/lib/eventBus", () => ({
  broadcastEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/broadcast", () => ({
  broadcastToOrg: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
  headers: async () => new Headers(),
}));

import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
const mockQuery = vi.mocked(query);
const mockRequireRole = vi.mocked(requireRole);
const mockGetSessionUserId = vi.mocked(getSessionUserId);

// ── Helpers ────────────────────────────────────────────────────────────────

function markRequest(body: Record<string, unknown> = {}): Request {
  return new Request("http://localhost:3000/api/attendance/mark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callMark(body: Record<string, unknown> = {}) {
  // Dynamic import to pick up fresh mocks each time
  const { POST } = await import("./mark/route");
  const res = await POST(markRequest(body) as any);
  const data = await res.json();
  return { res, data };
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default auth
  mockRequireRole.mockResolvedValue({
    isAuthorized: true,
    session: { _id: "42", name: "Test User", email: "test@test.com", role: "sales_manager", org: "org-1" },
  } as any);
  mockGetSessionUserId.mockReturnValue(42 as any);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/attendance/mark", () => {
  // 1. Happy path: active session exists
  it("marks attendance when an active session exists today", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 100, session_start: "2026-10-23T03:30:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, attendance_status: "Present", login_time: "2026-10-23T03:30:00Z", submitted_at: "2026-10-23T04:00:00Z" }]);

    const { res, data } = await callMark();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe("Present");
    expect(data.timeIn).toBeTruthy();
  });

  // 2. THE BUG FIX: expired session (is_active = false) still found today
  it("marks attendance when session today is expired (heartbeat timeout)", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 101, session_start: "2026-10-23T04:00:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 2, attendance_status: "Present", login_time: "2026-10-23T04:00:00Z", submitted_at: "2026-10-23T04:05:00Z" }]);

    const { res, data } = await callMark();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify the query used DATE-based filtering, not is_active
    const sessionQuery = mockQuery.mock.calls[0][0] as string;
    expect(sessionQuery).toContain("AT TIME ZONE");
    expect(sessionQuery).toContain("CURRENT_TIMESTAMP");
    expect(sessionQuery).not.toContain("is_active = true");
  });

  // 3. No session today → 404
  it("returns 404 when no session exists for today", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const { res, data } = await callMark();
    expect(res.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.message).toContain("No session found for today");
  });

  // 4. Idempotent: already marked
  it("returns success when attendance already marked today", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 100, session_start: "2026-10-23T03:30:00Z" }])
      .mockResolvedValueOnce([{ id: 5, attendance_status: "Present", login_time: "2026-10-23T03:30:00Z", submitted_at: "2026-10-23T03:35:00Z" }]);

    const { res, data } = await callMark();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toContain("already marked");
  });

  // 5. Explicit session_id in body → skips fallback query
  it("uses explicit session_id from body without querying for session", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 3, attendance_status: "Present", login_time: "2026-10-23T03:30:00Z", submitted_at: "2026-10-23T03:35:00Z" }]);

    const { res, data } = await callMark({ session_id: 200 });
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const firstQuery = mockQuery.mock.calls[0][0] as string;
    expect(firstQuery).toContain("attendance_records");
  });

  // 6. Unauthorized role → 401
  it("returns 401 for unauthorized role", async () => {
    mockRequireRole.mockResolvedValueOnce({ isAuthorized: false } as any);

    const { res, data } = await callMark();
    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.message).toBe("Unauthorized");
  });

  // 7. Cannot determine user → 400
  it("returns 400 when session user ID is null", async () => {
    mockGetSessionUserId.mockReturnValueOnce(null as any);

    const { res, data } = await callMark();
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.message).toContain("Cannot determine");
  });

  // 8. UNIQUE constraint violation → 500 with message
  it("returns 500 with message on DB constraint error", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 100, session_start: "2026-10-23T03:30:00Z" }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "attendance_records_login_session_id_key"'));

    const { res, data } = await callMark();
    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.message).toBe("Internal Server Error");
  });

  // 9. Error response always includes actionable message
  it("every non-200 response includes a message field", async () => {
    // 404 case
    mockQuery.mockResolvedValueOnce([]);
    const r1 = await callMark();
    expect(r1.data.message).toBeTruthy();
    expect(typeof r1.data.message).toBe("string");

    // 401 case
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValueOnce({ isAuthorized: false } as any);
    const r2 = await callMark();
    expect(r2.data.message).toBeTruthy();
    expect(typeof r2.data.message).toBe("string");
  });

  // 10. Multiple sessions today → picks the most recent (DESC order)
  it("uses the most recent session when multiple exist today", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 103, session_start: "2026-10-23T08:00:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 4, attendance_status: "Present", login_time: "2026-10-23T08:00:00Z", submitted_at: "2026-10-23T08:01:00Z" }]);

    const { res, data } = await callMark();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const sessionQuery = mockQuery.mock.calls[0][0] as string;
    expect(sessionQuery).toContain("ORDER BY session_start DESC");

    const insertArgs = mockQuery.mock.calls[2][1] as any[];
    expect(insertArgs).toContain(103);
  });

  // 11. New mark returns markedAt timestamp
  it("returns markedAt timestamp on successful new mark", async () => {
    const markedTime = "2026-10-23T04:15:30.123Z";
    mockQuery
      .mockResolvedValueOnce([{ id: 100, session_start: "2026-10-23T03:30:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, attendance_status: "Present", login_time: "2026-10-23T03:30:00Z", submitted_at: markedTime }]);

    const { data } = await callMark();
    expect(data.success).toBe(true);
    expect(data.markedAt).toBe(markedTime);
  });

  // 12. Idempotent re-mark preserves original markedAt
  it("returns the original markedAt on idempotent re-mark", async () => {
    const originalMarkedTime = "2026-10-23T03:35:00Z";
    mockQuery
      .mockResolvedValueOnce([{ id: 100, session_start: "2026-10-23T03:30:00Z" }])
      .mockResolvedValueOnce([{
        id: 5,
        attendance_status: "Present",
        login_time: "2026-10-23T03:30:00Z",
        submitted_at: originalMarkedTime,
      }]);

    const { data } = await callMark();
    expect(data.success).toBe(true);
    expect(data.message).toContain("already marked");
    expect(data.markedAt).toBe(originalMarkedTime);
  });

  // 13. Historical records without submitted_at return null markedAt
  it("returns null markedAt for historical records without submitted_at", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 100, session_start: "2026-10-23T03:30:00Z" }])
      .mockResolvedValueOnce([{
        id: 5,
        attendance_status: "Present",
        login_time: "2026-10-23T03:30:00Z",
        submitted_at: null,
      }]);

    const { data } = await callMark();
    expect(data.success).toBe(true);
    expect(data.markedAt).toBeNull();
  });

  // 14. INSERT RETURNING clause includes submitted_at
  it("INSERT RETURNING includes submitted_at column", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 100, session_start: "2026-10-23T03:30:00Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, attendance_status: "Present", login_time: "2026-10-23T03:30:00Z", submitted_at: "2026-10-23T04:00:00Z" }]);

    await callMark();

    // The INSERT query (3rd call) must include submitted_at in RETURNING
    const insertQuery = mockQuery.mock.calls[2][0] as string;
    expect(insertQuery).toContain("RETURNING");
    expect(insertQuery).toContain("submitted_at");
  });
});
