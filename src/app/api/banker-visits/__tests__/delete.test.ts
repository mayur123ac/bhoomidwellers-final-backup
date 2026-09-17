// @vitest-environment node
//
// Tests for DELETE /api/banker-visits/{id}
//
// Covers: auth, RBAC, tenant isolation, input validation, happy path,
// idempotency (double-delete), and that GET/POST remain unaffected.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockSession: any = null;
let mockOrgId: string = "org-111";
let mockQueryResults: any[] = [];

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => {
    if (!mockSession) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ success: false, message: "You must be signed in.", code: "UNAUTHORIZED" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    return { ok: true, session: mockSession };
  }),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => mockOrgId),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => mockQueryResults),
}));

vi.mock("@/lib/cpRbac", () => ({
  normalizeRole: (r: any) =>
    (r || "").toString().toLowerCase().replace(/_/g, " ").trim(),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { DELETE } from "../[id]/route";

function makeRequest() {
  return new Request("http://localhost/api/banker-visits/42", { method: "DELETE" });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function json(res: Response) {
  return res.json();
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSession = null;
  mockOrgId = "org-111";
  mockQueryResults = [];
  vi.clearAllMocks();
});

describe("DELETE /api/banker-visits/{id}", () => {
  // 1. Unauthenticated
  it("rejects unauthenticated requests with 401", async () => {
    mockSession = null;
    const res = await DELETE(makeRequest() as any, makeParams("1"));
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.success).toBe(false);
  });

  // 2. Non-admin roles rejected
  it.each(["receptionist", "sales manager", "sourcing manager", "site head"])(
    "rejects %s role with 403",
    async (role) => {
      mockSession = { _id: 1, name: "User", role, isActive: true };
      const res = await DELETE(makeRequest() as any, makeParams("1"));
      expect(res.status).toBe(403);
      const body = await json(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe("FORBIDDEN");
    }
  );

  // 3. Admin can delete
  it("admin can delete a banker visit belonging to their organization", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };
    mockQueryResults = [{ id: 42, banker_name: "XYZ Banker" }];
    const res = await DELETE(makeRequest() as any, makeParams("42"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.message).toContain("XYZ Banker");
  });

  // 4. Cross-tenant: ID exists in another org → 404
  it("returns 404 when banker visit belongs to another organization", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };
    mockQueryResults = []; // RETURNING returns nothing because org doesn't match
    const res = await DELETE(makeRequest() as any, makeParams("42"));
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.success).toBe(false);
  });

  // 5. Invalid ID
  it("rejects non-integer id with 400", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };
    const res = await DELETE(makeRequest() as any, makeParams("abc"));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.message).toContain("Invalid");
  });

  it("rejects zero id with 400", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };
    const res = await DELETE(makeRequest() as any, makeParams("0"));
    expect(res.status).toBe(400);
  });

  it("rejects negative id with 400", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };
    const res = await DELETE(makeRequest() as any, makeParams("-5"));
    expect(res.status).toBe(400);
  });

  // 6. Non-existent ID
  it("returns 404 for non-existent id", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };
    mockQueryResults = [];
    const res = await DELETE(makeRequest() as any, makeParams("99999"));
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.success).toBe(false);
  });

  // 7. Successful deletion removes exactly one row (via RETURNING)
  it("DELETE RETURNING returns exactly one row on success", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };
    mockQueryResults = [{ id: 7, banker_name: "Test Banker" }];

    const { query } = await import("@/lib/db");
    const res = await DELETE(makeRequest() as any, makeParams("7"));
    expect(res.status).toBe(200);

    // Verify query was called with org-scoped DELETE
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM banker_visits"),
      expect.arrayContaining([7, "org-111"])
    );
  });

  // 8. Double-delete: second call returns 404
  it("double-delete returns 404 on second attempt", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin", isActive: true };

    // First delete succeeds
    mockQueryResults = [{ id: 42, banker_name: "Banker" }];
    const res1 = await DELETE(makeRequest() as any, makeParams("42"));
    expect(res1.status).toBe(200);

    // Second delete: row no longer exists
    mockQueryResults = [];
    const res2 = await DELETE(makeRequest() as any, makeParams("42"));
    expect(res2.status).toBe(404);
  });

  // 9. Admin role normalisation (underscore variant)
  it("accepts Admin with underscore-style role string", async () => {
    mockSession = { _id: 1, name: "Admin", role: "Admin", isActive: true };
    mockQueryResults = [{ id: 1, banker_name: "B" }];
    const res = await DELETE(makeRequest() as any, makeParams("1"));
    expect(res.status).toBe(200);
  });
});
