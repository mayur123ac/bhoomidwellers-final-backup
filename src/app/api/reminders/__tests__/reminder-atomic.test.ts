// @vitest-environment node
//
// Atomic transaction tests for reminder write paths.
//
// POST /api/reminders  — INSERT reminder + INSERT follow_up in one transaction
// PATCH /api/reminders/[id] — UPDATE reminder + INSERT follow_up in one transaction
//
// Verifies:
// 1. Both writes go through the transaction() wrapper (not bare query())
// 2. The transaction callback issues exactly 2 client.query() calls
// 3. If the second write fails, the transaction throws (triggers ROLLBACK)
// 4. On success, the response contains correct data

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const {
  mockRequireSession,
  mockGetSessionUserId,
  mockGetOrganizationId,
  mockQuery,
  mockTransaction,
  mockBroadcastCreated,
  mockBroadcastUpdated,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGetSessionUserId: vi.fn(),
  mockGetOrganizationId: vi.fn(),
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockBroadcastCreated: vi.fn(),
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
  broadcastReminderCreated: (...args: unknown[]) => mockBroadcastCreated(...args),
  broadcastReminderUpdated: (...args: unknown[]) => mockBroadcastUpdated(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-TX";
const USER_ID = "user-uuid-TX";
const FUTURE_ISO = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

function makeGate(role = "receptionist") {
  return {
    ok: true,
    session: { role, name: "Test User" },
    userId: USER_ID,
  };
}

/** Minimal request object for POST */
function makePostReq(body: Record<string, any>) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    nextUrl: new URL("http://localhost/api/reminders"),
    json: async () => body,
  };
}

/** Minimal request object for PATCH */
function makePatchReq(body: Record<string, any>) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    nextUrl: new URL("http://localhost/api/reminders/42"),
    json: async () => body,
  };
}

/** Build a mock PoolClient that records calls and returns canned rows */
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

/** Configure mockTransaction to run the callback with a mock client */
function setupTransaction(queryResults: Array<{ rows: any[] }>) {
  const tracker = makeMockClient(queryResults);
  mockTransaction.mockImplementation(async (fn: any) => fn(tracker.client));
  return tracker;
}

/** Configure mockTransaction to simulate failure on the Nth client.query call */
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

const FAKE_REMINDER_ROW = {
  id: 1,
  lead_id: 100,
  organization_id: ORG_ID,
  assigned_user_id: USER_ID,
  created_by_id: USER_ID,
  created_by_name: "Test User",
  reminder_type: "follow_up",
  note: null,
  remind_at: new Date(FUTURE_ISO),
  status: "pending",
  notified_at: null,
  completed_at: null,
  cancelled_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const FAKE_EXISTING_REMINDER = {
  ...FAKE_REMINDER_ROW,
  lead_name: "John Doe",
  lead_phone: "9876543210",
  assigned_user_name: "Test User",
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/reminders — atomic create
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/reminders — atomic transaction", () => {
  let POST: (req: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockRequireSession.mockResolvedValue(makeGate());
    mockGetSessionUserId.mockReturnValue(USER_ID);
    mockGetOrganizationId.mockResolvedValue(ORG_ID);

    // Lead verification query (runs outside the transaction via query())
    mockQuery.mockResolvedValue([
      { id: 100, name: "John Doe", phone: "9876543210", status: "Active", is_lost_lead: false },
    ]);

    const mod = await import("../route");
    POST = mod.POST as unknown as (req: any) => Promise<Response>;
  });

  it("uses transaction() (not bare query()) for the two writes", async () => {
    const tracker = setupTransaction([
      { rows: [FAKE_REMINDER_ROW] },  // INSERT lead_reminders
      { rows: [] },                     // INSERT follow_ups
    ]);

    const res = await POST(makePostReq({ leadId: 100, remindAt: FUTURE_ISO }));
    expect(res.status).toBe(201);

    // transaction() must have been called exactly once
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // The callback must have issued exactly 2 client.query() calls
    expect(tracker.calls).toHaveLength(2);
  });

  it("first client.query is INSERT into lead_reminders", async () => {
    const tracker = setupTransaction([
      { rows: [FAKE_REMINDER_ROW] },
      { rows: [] },
    ]);

    await POST(makePostReq({ leadId: 100, remindAt: FUTURE_ISO }));

    expect(tracker.calls[0].sql).toMatch(/INSERT INTO lead_reminders/i);
    expect(tracker.calls[0].params[0]).toBe(100); // lead_id
  });

  it("second client.query is INSERT into follow_ups", async () => {
    const tracker = setupTransaction([
      { rows: [FAKE_REMINDER_ROW] },
      { rows: [] },
    ]);

    await POST(makePostReq({ leadId: 100, remindAt: FUTURE_ISO }));

    expect(tracker.calls[1].sql).toMatch(/INSERT INTO follow_ups/i);
    expect(tracker.calls[1].params[0]).toBe(100); // lead_id
  });

  it("surfaces transaction error to the caller (triggers ROLLBACK)", async () => {
    setupTransactionFailure(1, [
      { rows: [FAKE_REMINDER_ROW] },  // INSERT reminder succeeds
      // INSERT follow_up will throw
    ]);

    await expect(
      POST(makePostReq({ leadId: 100, remindAt: FUTURE_ISO })),
    ).rejects.toThrow("DB write failed");

    // Broadcast must NOT fire — the transaction failed
    expect(mockBroadcastCreated).not.toHaveBeenCalled();
  });

  it("does not use bare query() for the writes (only for lead verification)", async () => {
    setupTransaction([
      { rows: [FAKE_REMINDER_ROW] },
      { rows: [] },
    ]);

    await POST(makePostReq({ leadId: 100, remindAt: FUTURE_ISO }));

    // query() should only have been called once — for the lead ownership SELECT
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("walkin_enquiries");
  });

  it("returns 201 with correct payload on success", async () => {
    setupTransaction([
      { rows: [FAKE_REMINDER_ROW] },
      { rows: [] },
    ]);

    const res = await POST(makePostReq({ leadId: 100, remindAt: FUTURE_ISO, note: "Call back" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.leadId).toBe(100);
    expect(body.data.status).toBe("pending");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/reminders/[id] — atomic state transition
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/reminders/[id] — atomic transaction", () => {
  let PATCH: (req: any, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockRequireSession.mockResolvedValue(makeGate());
    mockGetSessionUserId.mockReturnValue(USER_ID);
    mockGetOrganizationId.mockResolvedValue(ORG_ID);

    // Existing reminder query (runs outside the transaction via query())
    mockQuery.mockResolvedValue([FAKE_EXISTING_REMINDER]);

    const mod = await import("../[id]/route");
    PATCH = mod.PATCH as unknown as (req: any, ctx: any) => Promise<Response>;
  });

  const ctx = { params: Promise.resolve({ id: "1" }) };

  // ── complete action ─────────────────────────────────────────────────────

  it("complete: uses transaction() for UPDATE + follow_up INSERT", async () => {
    const completedRow = { ...FAKE_REMINDER_ROW, status: "completed", completed_at: new Date() };
    const tracker = setupTransaction([
      { rows: [completedRow] },  // UPDATE lead_reminders
      { rows: [] },              // INSERT follow_ups
    ]);

    const res = await PATCH(makePatchReq({ action: "complete" }), ctx);
    expect(res.status).toBe(200);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(tracker.calls).toHaveLength(2);
    expect(tracker.calls[0].sql).toMatch(/UPDATE lead_reminders/i);
    expect(tracker.calls[0].sql).toMatch(/completed/i);
    expect(tracker.calls[1].sql).toMatch(/INSERT INTO follow_ups/i);
  });

  // ── cancel action ───────────────────────────────────────────────────────

  it("cancel: uses transaction() for UPDATE + follow_up INSERT", async () => {
    const cancelledRow = { ...FAKE_REMINDER_ROW, status: "cancelled", cancelled_at: new Date() };
    const tracker = setupTransaction([
      { rows: [cancelledRow] },
      { rows: [] },
    ]);

    const res = await PATCH(makePatchReq({ action: "cancel" }), ctx);
    expect(res.status).toBe(200);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(tracker.calls).toHaveLength(2);
    expect(tracker.calls[0].sql).toMatch(/UPDATE lead_reminders/i);
    expect(tracker.calls[0].sql).toMatch(/cancelled/i);
    expect(tracker.calls[1].sql).toMatch(/INSERT INTO follow_ups/i);
  });

  // ── reschedule action ───────────────────────────────────────────────────

  it("reschedule: uses transaction() for UPDATE + follow_up INSERT", async () => {
    const rescheduledRow = { ...FAKE_REMINDER_ROW, remind_at: new Date(FUTURE_ISO) };
    const tracker = setupTransaction([
      { rows: [rescheduledRow] },
      { rows: [] },
    ]);

    const res = await PATCH(makePatchReq({ action: "reschedule", remindAt: FUTURE_ISO }), ctx);
    expect(res.status).toBe(200);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(tracker.calls).toHaveLength(2);
    expect(tracker.calls[0].sql).toMatch(/UPDATE lead_reminders/i);
    expect(tracker.calls[0].sql).toMatch(/remind_at/i);
    expect(tracker.calls[1].sql).toMatch(/INSERT INTO follow_ups/i);
  });

  // ── rollback on follow_up failure ───────────────────────────────────────

  it("complete: transaction error rolls back (no partial state change)", async () => {
    setupTransactionFailure(1, [
      { rows: [{ ...FAKE_REMINDER_ROW, status: "completed" }] },
      // follow_up INSERT will throw
    ]);

    await expect(
      PATCH(makePatchReq({ action: "complete" }), ctx),
    ).rejects.toThrow("DB write failed");

    expect(mockBroadcastUpdated).not.toHaveBeenCalled();
  });

  it("cancel: transaction error rolls back (no partial state change)", async () => {
    setupTransactionFailure(1, [
      { rows: [{ ...FAKE_REMINDER_ROW, status: "cancelled" }] },
    ]);

    await expect(
      PATCH(makePatchReq({ action: "cancel" }), ctx),
    ).rejects.toThrow("DB write failed");

    expect(mockBroadcastUpdated).not.toHaveBeenCalled();
  });

  it("reschedule: transaction error rolls back (no partial state change)", async () => {
    setupTransactionFailure(1, [
      { rows: [{ ...FAKE_REMINDER_ROW }] },
    ]);

    await expect(
      PATCH(makePatchReq({ action: "reschedule", remindAt: FUTURE_ISO }), ctx),
    ).rejects.toThrow("DB write failed");

    expect(mockBroadcastUpdated).not.toHaveBeenCalled();
  });

  // ── 0-row UPDATE → 409 without follow_up INSERT ────────────────────────

  it("returns 409 and skips follow_up if UPDATE matches 0 rows", async () => {
    const tracker = setupTransaction([
      { rows: [] },  // UPDATE returns 0 rows — already transitioned
    ]);

    const res = await PATCH(makePatchReq({ action: "complete" }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/already transitioned/i);

    // follow_up INSERT must NOT have been attempted
    expect(tracker.calls).toHaveLength(1);
    expect(mockBroadcastUpdated).not.toHaveBeenCalled();
  });

  // ── reschedule validation before transaction ────────────────────────────

  it("reschedule: bad input returns 400 without starting a transaction", async () => {
    const res = await PATCH(makePatchReq({ action: "reschedule" }), ctx);
    expect(res.status).toBe(400);

    // transaction() must not have been called — validation is pre-tx
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("reschedule: past date returns 400 without starting a transaction", async () => {
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const res = await PATCH(makePatchReq({ action: "reschedule", remindAt: pastIso }), ctx);
    expect(res.status).toBe(400);

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // ── bare query() only used for the SELECT, never for writes ─────────────

  it("does not use bare query() for writes (only for existing-reminder SELECT)", async () => {
    const completedRow = { ...FAKE_REMINDER_ROW, status: "completed", completed_at: new Date() };
    setupTransaction([
      { rows: [completedRow] },
      { rows: [] },
    ]);

    await PATCH(makePatchReq({ action: "complete" }), ctx);

    // query() should only have been called once — for the SELECT existing reminder
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("lead_reminders");
  });
});
