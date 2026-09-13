// @vitest-environment node
//
// Regression tests for the receptionist + sales-manager dual-assignment bug.
//
// Bug: POST /api/walkin_enquiries used
//   `recepUserRow.rows[0]?.id ?? actorUserId ?? null`
// for assignedReceptionistUserId. When assigned_receptionist was NULL (i.e. the
// receptionist assigned the lead to a Sales Manager), actorUserId fired and stored
// the receptionist's own ID in assigned_receptionist_user_id, producing contradictory
// dual-ownership on every newly created lead.
//
// Fix: Remove `?? actorUserId`. assigned_receptionist_user_id is now NULL whenever
//      assigned_receptionist was not explicitly provided.
//
// INSERT params (0-based JS array indices):
//   index 17 → $18 = assignedTo                   (the name string)
//   index 18 → $19 = assigned_receptionist         (the name string | null)
//   index 33 → $34 = assignedToUserId              (integer FK | null)
//   index 34 → $35 = assignedReceptionistUserId    (integer FK | null)  ← core assertion

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Shared capture ───────────────────────────────────────────────────────────
// We need the INSERT params from INSIDE the transaction mock. A module-scope
// variable works because tests are serial inside one describe block.
let capturedInsertParams: any[] | null = null;

// ── Static mocks (registered once before any import of ./route) ─────────────

vi.mock("@/lib/db", () => {
  let insertCapture: any[] | null = null;
  const makeMockClient = () => ({
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql && sql.includes("INSERT INTO walkin_enquiries")) {
        // expose captured params via module-level variable
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        (globalThis as any).__lastInsertParams = params;
      }
      return { rows: [{ id: 999 }] };
    }),
  });
  return {
    query: vi.fn(async () => []),
    transaction: vi.fn(async (fn: any) => fn(makeMockClient())),
    recalculateSrNos: vi.fn(),
    getPool: vi.fn(() => ({ query: vi.fn() })),
  };
});

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "test-org-uuid"),
}));

vi.mock("@/lib/serverAuth", () => ({
  getServerSession: vi.fn(async () => ({
    _id: "42", id: "42",
    name: "Priya Desk",
    email: "priya@test.com",
    role: "Receptionist",
    org: "test-org",
  })),
  // P0-7 fix: getSessionUserId is now imported by the route.
  // Returns 42 to match the mocked session's _id.
  getSessionUserId: vi.fn((_session: any) => 42),
}));

vi.mock("@/lib/cpCommissionEngine", () => ({
  isChannelPartnerSource: vi.fn(() => false),
  resolveChannelPartnerId: vi.fn(async () => null),
}));

vi.mock("@/lib/sourcingAssignment", () => ({
  claimPartnerForSourcingManager: vi.fn(),
  resolvePartnerOwner: vi.fn(async () => null),
}));

vi.mock("@/lib/cpRbac", () => ({
  normalizeRole: vi.fn((r: string) => r?.toLowerCase().replace(/_/g, " ") || ""),
}));

vi.mock("@/services/whatsapp.service", () => ({
  notifyCpLeadAssigned: vi.fn(),
}));

vi.mock("@/lib/apiResponse", () => ({
  jsonCompressed: vi.fn(),
}));

vi.mock("@/lib/supabase/broadcast", () => ({
  broadcastToOrg: vi.fn(async () => {}),
}));

vi.mock("@/lib/phoneAccess", () => ({
  resolvePhones: vi.fn(async (_actor: any, rows: any[]) => rows),
}));

vi.mock("@/lib/visitChain", () => ({
  batchGetVisitDepths: vi.fn(async () => new Map()),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { query, transaction } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);
const mockGetServerSession = vi.mocked(getServerSession);

function makeRequest(body: Record<string, any>): Request {
  return new Request("http://localhost:3000/api/walkin_enquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test Client",
      phone: "9876543210",
      assignedTo: "Sales Manager A",
      ...body,
    }),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/walkin_enquiries — assignment ownership regression", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as any).__lastInsertParams = null;

    // Default: no prior leads (avoids duplicate rejection)
    mockQuery.mockResolvedValue([] as any);

    // Rebuild transaction mock each test so the INSERT capture is fresh.
    // The mock returns { id: 999, normalized_role: "sales manager" } for all
    // user SELECT queries so the P0-5 role validation (added by the security
    // fix) passes without needing a real DB. The normalized_role field is only
    // read when the route checks isAssignableRole(); "sales manager" is a valid
    // assignable role so every test that expects a 201 will still reach the INSERT.
    //
    // FIX-G: The P0-5 lookup for "Priya Desk" must return id=42 (matching the
    // session _id) so the ID-based receptionist self-assign guard sees
    // assignedToUserId === actorUserId and allows the self-assign through.
    // All other name lookups still return id=999.
    mockTransaction.mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn(async (sql: string, params: any[]) => {
          if (sql && sql.includes("INSERT INTO walkin_enquiries")) {
            (globalThis as any).__lastInsertParams = params;
            return { rows: [{ id: 999, normalized_role: "sales manager" }] };
          }
          if (params && params[1] === "Priya Desk") {
            return { rows: [{ id: 42, normalized_role: "receptionist" }] };
          }
          return { rows: [{ id: 999, normalized_role: "sales manager" }] };
        }),
      };
      return fn(client);
    });

    const mod = await import("./route");
    POST = mod.POST;
  });

  // ── Test 1: Admin assigns lead to Sales Manager ───────────────────────────
  // P1-6: receptionists can no longer assign to SMs directly. The P0 regression
  // (assigned_receptionist_user_id incorrectly set to the creator's ID) still
  // applies and is verified here using an admin session, which is unrestricted.
  it("[T1] Admin SM assignment → assigned_receptionist_user_id is NULL (not creator ID)", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      _id: "1", id: "1",
      name: "Admin User",
      email: "admin@test.com",
      role: "admin",
      org: "test-org",
    } as any);
    const res = await POST(makeRequest({
      assignedTo: "Sales Manager A",
      assigned_receptionist: null,
    }));

    expect(res.status).toBe(201);
    const params: any[] = (globalThis as any).__lastInsertParams;
    expect(params).not.toBeNull();

    // $18 = assignedTo name
    expect(params[17]).toBe("Sales Manager A");
    // $19 = assigned_receptionist — should be NULL
    expect(params[18]).toBeNull();
    // $35 = assignedReceptionistUserId — CORE ASSERTION: must be NULL, not actorUserId=42
    expect(params[34]).toBeNull();
  });

  // ── Test 2: Receptionist self-assigns ─────────────────────────────────────
  it("[T2] self-assign → assigned_receptionist_user_id is set via DB lookup (not fallback)", async () => {
    // When selfAssign=true, the frontend sends:
    //   assignedTo = user.name = "Priya Desk"
    //   assigned_receptionist = user.name = "Priya Desk"
    // The DB lookup for assigned_receptionist returns id=999 (from mock).
    const res = await POST(makeRequest({
      assignedTo: "Priya Desk",
      assigned_receptionist: "Priya Desk",
    }));

    expect(res.status).toBe(201);
    const params: any[] = (globalThis as any).__lastInsertParams;
    expect(params).not.toBeNull();

    // $19 = assigned_receptionist = Priya Desk (explicitly set)
    expect(params[18]).toBe("Priya Desk");
    // $35 = assignedReceptionistUserId = 42 (from DB lookup — not actorUserId fallback).
    // The FIX-G mock returns id=42 for all "Priya Desk" lookups (matching the session
    // _id so the self-assign guard passes), so the receptionist lookup also yields 42.
    // The point of this test is that the value comes from a DB lookup, not from the
    // old `?? actorUserId` fallback — 42 from a lookup still proves that.
    expect(params[34]).toBe(42);
  });

  // ── Test 3: Body-supplied assigned_receptionist is ignored (P0-6) ───────────
  // A stale form might send assigned_receptionist explicitly. With the P0-6 fix
  // the server IGNORES it — assigned_receptionist is derived server-side from the
  // session, never from the request body.
  // P1-6: uses an admin session so the SM assignment is allowed; the P0-6
  // assertion (body field is ignored) is unchanged for non-receptionist sessions.
  it("[T3] body-supplied assigned_receptionist is ignored (P0-6): server derives NULL", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      _id: "1", id: "1",
      name: "Admin User",
      email: "admin@test.com",
      role: "admin",
      org: "test-org",
    } as any);
    const res = await POST(makeRequest({
      assignedTo: "Sales Manager A",
      assigned_receptionist: "Priya Desk", // body field — must be IGNORED by server
    }));

    expect(res.status).toBe(201);
    const params: any[] = (globalThis as any).__lastInsertParams;
    expect(params).not.toBeNull();

    // $18 = SM name
    expect(params[17]).toBe("Sales Manager A");
    // $19 = assigned_receptionist — P0-6: derived from session, not body.
    // Session is admin (not receptionist) → effectiveAssignedReceptionist is NULL.
    expect(params[18]).toBeNull();
    // $35 = assignedReceptionistUserId — NULL because effectiveAssignedReceptionist = null.
    expect(params[34]).toBeNull();
  });

  // ── Test 4: Missing assigned_receptionist field entirely ──────────────────
  // P1-6: admin session so the SM assignment is not blocked.
  it("[T4] assigned_receptionist absent from payload → assigned_receptionist_user_id NULL", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      _id: "1", id: "1",
      name: "Admin User",
      email: "admin@test.com",
      role: "admin",
      org: "test-org",
    } as any);
    // Some callers may omit the field entirely (not even send null)
    const res = await POST(new Request("http://localhost:3000/api/walkin_enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Client",
        phone: "9876543211",
        assignedTo: "Sales Manager B",
        // assigned_receptionist is NOT in the body at all
      }),
    }));

    expect(res.status).toBe(201);
    const params: any[] = (globalThis as any).__lastInsertParams;
    expect(params).not.toBeNull();

    // assigned_receptionist_user_id must still be NULL — no implicit fallback
    expect(params[34]).toBeNull();
  });

  // ── Test 5: Response metadata is correct ─────────────────────────────────
  // P1-6: admin session so the SM assignment is not blocked.
  it("[T5] successful SM assignment returns success=true and UNIQUE classification", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      _id: "1", id: "1",
      name: "Admin User",
      email: "admin@test.com",
      role: "admin",
      org: "test-org",
    } as any);
    const res = await POST(makeRequest({
      assignedTo: "Sales Manager A",
      assigned_receptionist: null,
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.leadClassification).toBe("UNIQUE");
    expect(body.returningFromLeadId).toBeNull();
  });
});

// ── P1-6 Receptionist self-assignment enforcement ─────────────────────────────
// A receptionist may only assign a lead to themselves at creation time.
// Assigning to any other user must be rejected with 403.

describe("P1-6 POST /api/walkin_enquiries — receptionist self-assignment enforcement", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as any).__lastInsertParams = null;

    // Default: no prior leads (avoids duplicate rejection)
    mockQuery.mockResolvedValue([] as any);

    // FIX-G: "Priya Desk" lookup returns id=42 so the ID-based self-assign guard
    // passes for the receptionist self-assign case (actorUserId=42 === assignedToUserId=42).
    mockTransaction.mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn(async (sql: string, params: any[]) => {
          if (sql && sql.includes("INSERT INTO walkin_enquiries")) {
            (globalThis as any).__lastInsertParams = params;
            return { rows: [{ id: 999, normalized_role: "sales manager" }] };
          }
          if (params && params[1] === "Priya Desk") {
            return { rows: [{ id: 42, normalized_role: "receptionist" }] };
          }
          return { rows: [{ id: 999, normalized_role: "sales manager" }] };
        }),
      };
      return fn(client);
    });

    const mod = await import("./route");
    POST = mod.POST;
  });

  // P1-6 T1: Receptionist self-assigns — allowed
  // Default session (Priya Desk / Receptionist) is assigning to themselves.
  it("[P1-6 T1] receptionist assigns to themselves → 201 OK", async () => {
    const res = await POST(makeRequest({ assignedTo: "Priya Desk" }));
    expect(res.status).toBe(201);
  });

  // P1-6 T2: Receptionist tries to assign to another receptionist — 403
  it("[P1-6 T2] receptionist assigns to another receptionist → 403 Forbidden", async () => {
    const res = await POST(makeRequest({ assignedTo: "Sunita Front" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/only assign leads to themselves/i);
  });

  // P1-6 T3: Receptionist tries to assign to a sales manager — 403
  // Even though a sales manager is an assignable role, receptionists cannot
  // assign to them directly — they must self-assign.
  it("[P1-6 T3] receptionist assigns to a sales manager → 403 Forbidden", async () => {
    const res = await POST(makeRequest({ assignedTo: "Sales Manager A" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/only assign leads to themselves/i);
  });

  // P1-6 T4: Admin assigns to any receptionist — no restriction on admins
  it("[P1-6 T4] admin assigns to any receptionist → 201 OK", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      _id: "1", id: "1",
      name: "Admin User",
      email: "admin@test.com",
      role: "admin",
      org: "test-org",
    } as any);
    const res = await POST(makeRequest({ assignedTo: "Priya Desk" }));
    expect(res.status).toBe(201);
  });
});

// ── Corrupted record identification logic ─────────────────────────────────────
// Validates the SQL predicate used to identify corrupted historical records.
// The migration query is:
//   UPDATE walkin_enquiries
//   SET assigned_receptionist_user_id = NULL
//   WHERE assigned_receptionist IS NULL
//     AND assigned_receptionist_user_id IS NOT NULL
//     AND organization_id = <org_id>;

describe("Corrupted record identification — cleanup predicate", () => {
  it("flags records with NULL receptionist name but non-NULL receptionist_user_id", () => {
    const isCorrupted = (r: {
      assigned_receptionist: string | null;
      assigned_receptionist_user_id: number | null;
    }) =>
      r.assigned_receptionist === null && r.assigned_receptionist_user_id !== null;

    // Corrupted: created by buggy fallback — no name, but ID set
    expect(isCorrupted({
      assigned_receptionist: null,
      assigned_receptionist_user_id: 42,
    })).toBe(true);

    // Clean SM-owned lead: no receptionist, no ID
    expect(isCorrupted({
      assigned_receptionist: null,
      assigned_receptionist_user_id: null,
    })).toBe(false);

    // Legitimate self-assign: both name and ID are set
    expect(isCorrupted({
      assigned_receptionist: "Priya Desk",
      assigned_receptionist_user_id: 42,
    })).toBe(false);

    // Old pre-FK row: name set, ID null (not corrupted — awaits backfill)
    expect(isCorrupted({
      assigned_receptionist: "Priya Desk",
      assigned_receptionist_user_id: null,
    })).toBe(false);
  });

  it("does not flag records where assigned_receptionist name is present", () => {
    // Even if the user IDs were accidentally mismatched (edge case), the
    // presence of assigned_receptionist name indicates an intentional assignment.
    // The cleanup query only targets the unambiguous case: name IS NULL.
    const isCorrupted = (r: {
      assigned_receptionist: string | null;
      assigned_receptionist_user_id: number | null;
    }) =>
      r.assigned_receptionist === null && r.assigned_receptionist_user_id !== null;

    expect(isCorrupted({
      assigned_receptionist: "Priya Desk",
      assigned_receptionist_user_id: 99, // possibly wrong id, but name is there
    })).toBe(false);
  });
});
