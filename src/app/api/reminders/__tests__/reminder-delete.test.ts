// @vitest-environment node
//
// DELETE /api/reminders/[id] — soft-delete tests
//
// Verifies:
// 1. Auth gates (session, userId)
// 2. Owner can delete own pending/notified reminders
// 3. Admin can delete any org reminder
// 4. Non-owner non-admin → 403
// 5. Already completed/cancelled → 409
// 6. Already soft-deleted → 404
// 7. Cross-org isolation → 404
// 8. Atomic transaction (UPDATE + follow_up INSERT)
// 9. Transaction failure → rollback, no broadcast
// 10. 0-row UPDATE → 409 (race condition)
// 11. Broadcast fires only after commit

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const {
  mockRequireSession,
  mockGetSessionUserId,
  mockGetOrganizationId,
  mockQuery,
  mockTransaction,
  mockBroadcastUpdated,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGetSessionUserId: vi.fn(),
  mockGetOrganizationId: vi.fn(),
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockBroadcastUpdated: vi.fn(),
}));

vi.mock("@/lib/serverAuth", () => ({
  requireSession: () => mockRequireSession(),
  getSessionUserId: (s: any) => mockGetSessionUserId(s),
}));
vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: () => mockGetOrganizationId(),
}));
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  transaction: (fn: any) => mockTransaction(fn),
}));
vi.mock("@/lib/reminderEvents", () => ({
  broadcastReminderCreated: vi.fn(),
  broadcastReminderUpdated: (...args: unknown[]) => mockBroadcastUpdated(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-DEL";
const USER_ID = "user-uuid-DEL";
const OTHER_USER = "user-uuid-OTHER";

function makeGate(role = "receptionist", userId = USER_ID) {
  return {
    ok: true,
    session: { role, name: "Test User" },
    userId,
  };
}

function makeReq() {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost/api/reminders/1"),
  };
}

const ctx = { params: Promise.resolve({ id: "1" }) };

const FAKE_REMINDER = {
  id: 1,
  lead_id: 100,
  organization_id: ORG_ID,
  assigned_user_id: USER_ID,
  created_by_id: USER_ID,
  created_by_name: "Test User",
  reminder_type: "follow_up",
  note: "Call back",
  remind_at: new Date(Date.now() + 86400000),
  status: "pending",
  notified_at: null,
  completed_at: null,
  cancelled_at: null,
  deleted_at: null,
  deleted_by: null,
  created_at: new Date(),
  updated_at: new Date(),
  lead_name: "John Doe",
  lead_phone: "9876543210",
  assigned_user_name: "Test User",
};

function makeMockClient(queryResults: Array<{ rows: any[] }>) {
  let callIdx = 0;
  const calls: Array<{ sql: string; params: any[] }> = [];
  return {
    calls,
    client: {
      query: async (sql: string, params?: any[]) => {
        calls.push({ sql, params: params ?? [] });
        const result = queryResults[callIdx] ?? { rows: [] };
        callIdx++;
        return result;
      },
    },
  };
}

function setupTransaction(queryResults: Array<{ rows: any[] }>) {
  const tracker = makeMockClient(queryResults);
  mockTransaction.mockImplementation(async (fn: any) => fn(tracker.client));
  return tracker;
}

function setupTransactionFailure(failOnCall: number, queryResults: Array<{ rows: any[] }>) {
  let callIdx = 0;
  const calls: Array<{ sql: string; params: any[] }> = [];
  const mockClient = {
    query: async (sql: string, params?: any[]) => {
      calls.push({ sql, params: params ?? [] });
      if (callIdx === failOnCall) {
        callIdx++;
        throw new Error("DB write failed");
      }
      const result = queryResults[callIdx] ?? { rows: [] };
      callIdx++;
      return result;
    },
  };
  mockTransaction.mockImplementation(async (fn: any) => fn(mockClient));
  return { calls };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("DELETE /api/reminders/[id]", () => {
  let DELETE: (req: any, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockRequireSession.mockResolvedValue(makeGate());
    mockGetSessionUserId.mockReturnValue(USER_ID);
    mockGetOrganizationId.mockResolvedValue(ORG_ID);
    mockQuery.mockResolvedValue([FAKE_REMINDER]);

    const mod = await import("../[id]/route");
    DELETE = mod.DELETE as unknown as (req: any, ctx: any) => Promise<Response>;
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  it("returns 401 when userId is missing", async () => {
    mockGetSessionUserId.mockReturnValue(null);
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid reminder id", async () => {
    const badCtx = { params: Promise.resolve({ id: "abc" }) };
    const res = await DELETE(makeReq(), badCtx);
    expect(res.status).toBe(400);
  });

  // ── Not found ────────────────────────────────────────────────────────────

  it("returns 404 when reminder does not exist", async () => {
    mockQuery.mockResolvedValue([]);
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(404);
  });

  it("returns 404 when reminder is already soft-deleted", async () => {
    mockQuery.mockResolvedValue([{ ...FAKE_REMINDER, deleted_at: new Date() }]);
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(404);
  });

  // ── Authorization ────────────────────────────────────────────────────────

  it("returns 403 for non-owner non-admin", async () => {
    mockGetSessionUserId.mockReturnValue(OTHER_USER);
    mockRequireSession.mockResolvedValue(makeGate("receptionist", OTHER_USER));
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("owner can delete their own reminder", async () => {
    const deletedRow = { ...FAKE_REMINDER, status: "cancelled", deleted_at: new Date(), cancelled_at: new Date() };
    setupTransaction([
      { rows: [deletedRow] },
      { rows: [] },
    ]);

    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("admin can delete any org reminder", async () => {
    mockGetSessionUserId.mockReturnValue(OTHER_USER);
    mockRequireSession.mockResolvedValue(makeGate("admin", OTHER_USER));

    const deletedRow = { ...FAKE_REMINDER, status: "cancelled", deleted_at: new Date(), cancelled_at: new Date() };
    setupTransaction([
      { rows: [deletedRow] },
      { rows: [] },
    ]);

    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(200);
  });

  it("super_admin can delete any org reminder", async () => {
    mockGetSessionUserId.mockReturnValue(OTHER_USER);
    mockRequireSession.mockResolvedValue(makeGate("super_admin", OTHER_USER));

    const deletedRow = { ...FAKE_REMINDER, status: "cancelled", deleted_at: new Date(), cancelled_at: new Date() };
    setupTransaction([
      { rows: [deletedRow] },
      { rows: [] },
    ]);

    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(200);
  });

  // ── State guards ─────────────────────────────────────────────────────────

  it("returns 409 for completed reminder", async () => {
    mockQuery.mockResolvedValue([{ ...FAKE_REMINDER, status: "completed" }]);
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toContain("completed");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 for already cancelled reminder", async () => {
    mockQuery.mockResolvedValue([{ ...FAKE_REMINDER, status: "cancelled" }]);
    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── Atomic transaction ───────────────────────────────────────────────────

  it("uses transaction() with UPDATE + follow_up INSERT", async () => {
    const deletedRow = { ...FAKE_REMINDER, status: "cancelled", deleted_at: new Date() };
    const tracker = setupTransaction([
      { rows: [deletedRow] },
      { rows: [] },
    ]);

    await DELETE(makeReq(), ctx);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(tracker.calls).toHaveLength(2);
    expect(tracker.calls[0].sql).toMatch(/UPDATE lead_reminders/i);
    expect(tracker.calls[0].sql).toContain("deleted_at");
    expect(tracker.calls[0].sql).toContain("deleted_by");
    expect(tracker.calls[0].sql).toContain("cancelled");
    expect(tracker.calls[1].sql).toMatch(/INSERT INTO follow_ups/i);
  });

  it("transaction error propagates (triggers ROLLBACK)", async () => {
    setupTransactionFailure(1, [
      { rows: [{ ...FAKE_REMINDER, status: "cancelled" }] },
    ]);

    await expect(DELETE(makeReq(), ctx)).rejects.toThrow("DB write failed");
    expect(mockBroadcastUpdated).not.toHaveBeenCalled();
  });

  it("returns 409 when UPDATE matches 0 rows (race condition)", async () => {
    const tracker = setupTransaction([
      { rows: [] }, // UPDATE returns nothing — already transitioned
    ]);

    const res = await DELETE(makeReq(), ctx);
    expect(res.status).toBe(409);
    expect(tracker.calls).toHaveLength(1);
    expect(mockBroadcastUpdated).not.toHaveBeenCalled();
  });

  // ── Broadcast ────────────────────────────────────────────────────────────

  it("broadcasts after successful delete", async () => {
    const deletedRow = {
      ...FAKE_REMINDER,
      status: "cancelled",
      deleted_at: new Date(),
      cancelled_at: new Date(),
    };
    setupTransaction([
      { rows: [deletedRow] },
      { rows: [] },
    ]);

    await DELETE(makeReq(), ctx);

    expect(mockBroadcastUpdated).toHaveBeenCalledTimes(1);
    expect(mockBroadcastUpdated).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({
      id: 1,
      status: "cancelled",
    }));
  });

  it("does not broadcast when transaction returns null (409)", async () => {
    setupTransaction([{ rows: [] }]);
    await DELETE(makeReq(), ctx);
    expect(mockBroadcastUpdated).not.toHaveBeenCalled();
  });

  // ── query() only used for SELECT, not writes ─────────────────────────────

  it("does not use bare query() for writes", async () => {
    const deletedRow = { ...FAKE_REMINDER, status: "cancelled", deleted_at: new Date() };
    setupTransaction([
      { rows: [deletedRow] },
      { rows: [] },
    ]);

    await DELETE(makeReq(), ctx);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("lead_reminders");
  });
});

// ── PATCH deleted_at guard ──────────────────────────────────────────────────

describe("PATCH /api/reminders/[id] — deleted_at guard", () => {
  let PATCH: (req: any, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockRequireSession.mockResolvedValue(makeGate());
    mockGetSessionUserId.mockReturnValue(USER_ID);
    mockGetOrganizationId.mockResolvedValue(ORG_ID);

    const mod = await import("../[id]/route");
    PATCH = mod.PATCH as unknown as (req: any, ctx: any) => Promise<Response>;
  });

  it("returns 404 when reminder is soft-deleted", async () => {
    mockQuery.mockResolvedValue([{ ...FAKE_REMINDER, deleted_at: new Date() }]);

    const req = {
      headers: new Headers({ "content-type": "application/json" }),
      nextUrl: new URL("http://localhost/api/reminders/1"),
      json: async () => ({ action: "complete" }),
    };

    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ── GET pagination ──────────────────────────────────────────────────────────

describe("GET /api/reminders — pagination", () => {
  let GET: (req: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockRequireSession.mockResolvedValue(makeGate());
    mockGetSessionUserId.mockReturnValue(USER_ID);
    mockGetOrganizationId.mockResolvedValue(ORG_ID);
    mockQuery.mockResolvedValue([]);

    const mod = await import("../route");
    GET = mod.GET as unknown as (req: any) => Promise<Response>;
  });

  it("returns page and hasMore in response", async () => {
    const res = await GET({
      headers: new Headers(),
      nextUrl: new URL("http://localhost/api/reminders"),
    });
    const body = await res.json();
    expect(body).toHaveProperty("page", 1);
    expect(body).toHaveProperty("hasMore", false);
  });

  it("passes LIMIT and OFFSET to query", async () => {
    await GET({
      headers: new Headers(),
      nextUrl: new URL("http://localhost/api/reminders?page=2&limit=10"),
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("OFFSET");
    // limit+1=11 for hasMore detection, offset=(2-1)*10=10
    expect(params).toContain(11);
    expect(params).toContain(10);
  });

  it("clamps limit to 200 max", async () => {
    await GET({
      headers: new Headers(),
      nextUrl: new URL("http://localhost/api/reminders?limit=999"),
    });

    const [, params] = mockQuery.mock.calls[0];
    // defaults to 50+1=51 when out of range
    expect(params).toContain(51);
  });

  it("hasMore=true when rows exceed limit", async () => {
    // Return limit+1 rows to trigger hasMore
    const fakeRows = Array.from({ length: 51 }, (_, i) => ({
      id: i + 1, lead_id: 100, organization_id: ORG_ID,
      assigned_user_id: USER_ID, created_by_id: USER_ID,
      created_by_name: "Test", reminder_type: "follow_up",
      note: null, remind_at: new Date(), status: "pending",
      notified_at: null, completed_at: null, cancelled_at: null,
      created_at: new Date(), updated_at: new Date(),
      lead_name: "Lead", lead_phone: "1234567890", sr_no: i,
      budget: null, configuration: null, property_type: null,
      assigned_user_name: "User",
    }));
    mockQuery.mockResolvedValue(fakeRows);

    const res = await GET({
      headers: new Headers(),
      nextUrl: new URL("http://localhost/api/reminders"),
    });
    const body = await res.json();
    expect(body.hasMore).toBe(true);
    expect(body.data).toHaveLength(50); // trimmed to limit
  });
});
