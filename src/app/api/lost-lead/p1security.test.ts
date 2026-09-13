// @vitest-environment node
//
// P1-7/P1-8 regression tests for /api/lost-lead
//
// P1-7: POST previously accepted `marked_by` from the client body and wrote it
//        directly to lost_lead_marked_by and follow_ups.created_by_name. The fix
//        derives that value from gate.session.name instead.
//
// P1-8: PUT previously accepted `restored_by` from the client body and wrote it
//        to follow_ups.created_by_name. The fix derives it from gate.session.name.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Captured params ────────────────────────────────────────────────────────────
let capturedUpdateParams: any[] | null = null;
let capturedFollowUpParams: any[] | null = null;

// ── Static mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/serverAuth", () => ({
  requireRoles: vi.fn(async () => ({
    ok: true,
    userId: 55,
    session: { name: "Session Admin", role: "admin" },
    response: undefined,
  })),
  requireSession: vi.fn(async () => ({
    ok: true,
    userId: 55,
    session: { name: "Session Admin", role: "admin" },
    response: undefined,
  })),
  getServerSession: vi.fn(async () => ({
    _id: "55", id: "55",
    name: "Session Admin",
    email: "admin@test.com",
    role: "admin",
    org: "test-org",
  })),
  getSessionUserId: vi.fn(() => 55),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "test-org-uuid"),
}));

// The query mock branches on SQL content to capture UPDATE and INSERT params.
vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes("UPDATE walkin_enquiries")) {
      capturedUpdateParams = params;
      return [{ id: 1, sr_no: 100, name: "Test Lead", is_lost_lead: false }];
    }
    if (sql.includes("INSERT INTO follow_ups")) {
      capturedFollowUpParams = params;
      return [{ id: 9, lead_id: "1", message: params[1], created_by_name: params[2] }];
    }
    // Default SELECT response — override per-test for lost/active state checks.
    return [{ id: 1, sr_no: 100, name: "Test Lead", is_lost_lead: false }];
  }),
  transaction: vi.fn(),
  recalculateSrNos: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

// ── Imports (after mocks are hoisted) ─────────────────────────────────────────
import { query as dbQuery } from "@/lib/db";
const mockQuery = vi.mocked(dbQuery);

// ── Helpers ────────────────────────────────────────────────────────────────────
function makePostRequest(body: Record<string, any>): Request {
  return new Request("http://localhost:3000/api/lost-lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePutRequest(body: Record<string, any>): Request {
  return new Request("http://localhost:3000/api/lost-lead", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("P1-7 POST /api/lost-lead — markedBy derives from session, not body", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedUpdateParams = null;
    capturedFollowUpParams = null;

    // Default: lead exists and is NOT already lost
    mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes("UPDATE walkin_enquiries")) {
        capturedUpdateParams = params;
        return [{ id: 1, sr_no: 100, name: "Test Lead" }];
      }
      if (sql.includes("INSERT INTO follow_ups")) {
        capturedFollowUpParams = params;
        return [{ id: 9, lead_id: "1", created_by_name: params[2] }];
      }
      // SELECT — return non-lost lead
      return [{ id: 1, sr_no: 100, name: "Test Lead", is_lost_lead: false }];
    });

    const mod = await import("./route");
    POST = mod.POST;
  });

  // T7: Forged marked_by in body — DB must get the session name, not the body value
  it("[P1-7 T7] forged marked_by in body → DB uses session name", async () => {
    const req = makePostRequest({
      lead_id: 1,
      reason: "Client stopped responding to all calls",
      marked_by: "HACKER_NAME", // forged — must be ignored
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // UPDATE param[1] is the markedBy written to lost_lead_marked_by ($2 in SQL)
    expect(capturedUpdateParams).not.toBeNull();
    expect(capturedUpdateParams![1]).toBe("Session Admin");
    expect(capturedUpdateParams![1]).not.toBe("HACKER_NAME");

    // follow_ups created_by_name is params[2] ($3 in SQL)
    expect(capturedFollowUpParams).not.toBeNull();
    expect(capturedFollowUpParams![2]).toBe("Session Admin");
    expect(capturedFollowUpParams![2]).not.toBe("HACKER_NAME");
  });

  // T9: No marked_by in body at all — must still succeed (field no longer required)
  it("[P1-7 T9] marked_by absent from body → 200 OK (field is no longer required)", async () => {
    const req = makePostRequest({
      lead_id: 1,
      reason: "Client stopped responding to all calls",
      // marked_by deliberately omitted
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(capturedUpdateParams).not.toBeNull();
    expect(capturedUpdateParams![1]).toBe("Session Admin");
  });

  // Sanity: reason still required — short reason must still be rejected
  it("[P1-7 sanity] reason shorter than 10 chars → 400 Bad Request", async () => {
    const req = makePostRequest({ lead_id: 1, reason: "Short" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // Sanity: lead_id still required
  it("[P1-7 sanity] missing lead_id → 400 Bad Request", async () => {
    const req = makePostRequest({ reason: "Client stopped responding to all calls" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("P1-8 PUT /api/lost-lead — restoredBy derives from session, not body", () => {
  let PUT: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedUpdateParams = null;
    capturedFollowUpParams = null;

    // Default: lead exists and IS lost
    mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes("UPDATE walkin_enquiries")) {
        capturedUpdateParams = params;
        return [{ id: 1, sr_no: 100, name: "Test Lead" }];
      }
      if (sql.includes("INSERT INTO follow_ups")) {
        capturedFollowUpParams = params;
        return [{ id: 9, lead_id: "1", created_by_name: params[2] }];
      }
      // SELECT — return a lost lead
      return [{ id: 1, sr_no: 100, name: "Test Lead", is_lost_lead: true }];
    });

    const mod = await import("./route");
    PUT = mod.PUT;
  });

  // T8: Forged restored_by in body — follow_up must get session name
  it("[P1-8 T8] forged restored_by in body → follow_up uses session name", async () => {
    const req = makePutRequest({
      lead_id: 1,
      restored_by: "HACKER_NAME", // forged — must be ignored
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    // follow_ups created_by_name is params[2] ($3 in SQL)
    expect(capturedFollowUpParams).not.toBeNull();
    expect(capturedFollowUpParams![2]).toBe("Session Admin");
    expect(capturedFollowUpParams![2]).not.toBe("HACKER_NAME");
  });

  // No restored_by in body at all — must still succeed (field no longer required)
  it("[P1-8] restored_by absent from body → 200 OK (field is no longer required)", async () => {
    const req = makePutRequest({ lead_id: 1 });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(capturedFollowUpParams![2]).toBe("Session Admin");
  });

  // Sanity: lead_id still required
  it("[P1-8 sanity] missing lead_id → 400 Bad Request", async () => {
    const req = makePutRequest({});
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});
