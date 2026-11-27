// @vitest-environment node
//
// GET /api/reminders authorization tests
//
// 1. Missing user ID → 401 (fail-closed)
// 2. Receptionist → own reminders only
// 3. Sales Manager → own reminders only
// 4. Admin → all organization reminders
// 5. Admin + assigned_to=me → own reminders only
// 6. Cross-org isolation (orgId always in WHERE)

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const {
  mockRequireSession,
  mockGetSessionUserId,
  mockGetOrganizationId,
  mockQuery,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGetSessionUserId: vi.fn(),
  mockGetOrganizationId: vi.fn(),
  mockQuery: vi.fn(),
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
}));
vi.mock("@/lib/reminderEvents", () => ({
  broadcastReminderCreated: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(role: string, name = "Test User") {
  return { role, name };
}

function makeGate(session: any) {
  return { ok: true, session, userId: "user-uuid-1" };
}

function makeReq(searchParams: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/reminders");
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v);
  }
  return {
    headers: new Headers(),
    nextUrl: url,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/reminders authorization", () => {
  let GET: (req: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockGetOrganizationId.mockResolvedValue("org-uuid-AAA");
    mockQuery.mockResolvedValue([]);

    const mod = await import("../route");
    GET = mod.GET as unknown as (req: any) => Promise<Response>;
  });

  // ── 1. Missing user ID → 401 ───────────────────────────────────────────
  it("returns 401 when session user ID is missing (fail-closed)", async () => {
    const session = makeSession("receptionist");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue(null); // <-- no userId

    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/invalid session user/i);

    // query() must NOT have been called — fail closed before DB access
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── 2. Receptionist → own reminders only ────────────────────────────────
  it("receptionist only sees own reminders (assigned_user_id filter)", async () => {
    const session = makeSession("receptionist");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue("user-uuid-1");

    await GET(makeReq());

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];

    // Must filter by organization AND assigned_user_id
    expect(sql).toContain("r.organization_id = $1");
    expect(sql).toContain("r.assigned_user_id = $2");
    expect(params[0]).toBe("org-uuid-AAA");
    expect(params[1]).toBe("user-uuid-1");
  });

  // ── 3. Sales Manager → own reminders only ──────────────────────────────
  it("sales_manager only sees own reminders", async () => {
    const session = makeSession("sales_manager");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue("user-uuid-SM");

    await GET(makeReq());

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("r.assigned_user_id = $2");
    expect(params[1]).toBe("user-uuid-SM");
  });

  // ── 4. Admin → all organization reminders ──────────────────────────────
  it("admin sees all organization reminders (no assigned_user_id filter)", async () => {
    const session = makeSession("admin");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue("user-uuid-admin");

    await GET(makeReq());

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];

    // Must filter by organization but NOT filter by assigned_user_id in WHERE
    expect(sql).toContain("r.organization_id = $1");
    // The WHERE clause must NOT contain assigned_user_id = $2
    const whereClause = sql.split("WHERE")[1];
    expect(whereClause).not.toMatch(/r\.assigned_user_id\s*=\s*\$/);
    expect(params[0]).toBe("org-uuid-AAA");
    // params[0]=orgId, plus pagination params (limit+1, offset) — no userId param
    expect(params).toHaveLength(3);
  });

  // ── 5. Admin + assigned_to=me → own reminders only ─────────────────────
  it("admin with assigned_to=me sees only own reminders", async () => {
    const session = makeSession("admin");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue("user-uuid-admin");

    await GET(makeReq({ assigned_to: "me" }));

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("r.assigned_user_id = $2");
    expect(params[1]).toBe("user-uuid-admin");
  });

  // ── 6. Cross-org isolation ─────────────────────────────────────────────
  it("query always scopes by organization_id (no cross-org data)", async () => {
    const session = makeSession("receptionist");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue("user-uuid-1");
    mockGetOrganizationId.mockResolvedValue("org-uuid-BBB");

    await GET(makeReq());

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];

    // organization_id is always the first condition and comes from the session
    expect(sql).toContain("r.organization_id = $1");
    expect(params[0]).toBe("org-uuid-BBB");
  });

  // ── Bonus: site_head also gets whole-site view ─────────────────────────
  it("site_head sees all organization reminders", async () => {
    const session = makeSession("site_head");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue("user-uuid-sh");

    await GET(makeReq());

    const [sql] = mockQuery.mock.calls[0];
    const whereClause = sql.split("WHERE")[1];
    expect(whereClause).not.toMatch(/r\.assigned_user_id\s*=\s*\$/);
  });

  // ── Bonus: super_admin also gets whole-site view ───────────────────────
  it("super_admin sees all organization reminders", async () => {
    const session = makeSession("super_admin");
    mockRequireSession.mockResolvedValue(makeGate(session));
    mockGetSessionUserId.mockReturnValue("user-uuid-sa");

    await GET(makeReq());

    const [sql] = mockQuery.mock.calls[0];
    const whereClause = sql.split("WHERE")[1];
    expect(whereClause).not.toMatch(/r\.assigned_user_id\s*=\s*\$/);
  });
});
