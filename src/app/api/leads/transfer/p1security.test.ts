// @vitest-environment node
//
// P1-9 / P0-7 regression test for POST /api/leads/transfer
//
// P0-7: `transferred_by` derives from the authenticated session (gate.session.name),
//        never from the request body. This was fixed server-side in P0-7.
//
// P1-9: The client-side call sites (dashboard/page.tsx × 3, TransferModal.tsx × 1)
//        still included `transferred_by` in their fetch bodies. Those keys were removed
//        in P1-9. This test validates the server-side guarantee independently of the
//        client cleanup — even if a forged client somehow includes `transferred_by`,
//        the DB must record the session name.
//
// Test #10 (plan): POST /api/leads/transfer with forged `transferred_by` in body
//   — lead_assignment_logs.assigned_by = session name, not the forged value.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Captured params ────────────────────────────────────────────────────────────
let capturedFollowUpParams: any[] | null = null;
let capturedAssignmentLogParams: any[] | null = null;

// ── Static mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/serverAuth", () => ({
  requireRoles: vi.fn(async () => ({
    ok: true,
    userId: 7,
    session: { name: "Session Admin", role: "admin" },
    response: undefined,
  })),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "test-org-uuid"),
}));

vi.mock("@/lib/leadAuth", () => ({
  isAssignableRole: vi.fn(() => true),
}));

// The query mock branches on SQL to route each call to the right capture slot.
vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes("SELECT id, sr_no, assigned_to")) {
      // Existing lead lookup
      return [{ id: 1, sr_no: 100, assigned_to: "Old Manager", assigned_receptionist: null }];
    }
    if (sql.includes("SELECT id") && sql.includes("FROM users")) {
      // Destination user lookup (FIX-A/FIX-B)
      return [{ id: 88, normalized_role: "sales manager" }];
    }
    if (sql.includes("INSERT INTO follow_ups")) {
      capturedFollowUpParams = params;
      return [{ id: 9, lead_id: "1", message: params[1], created_by_name: params[2], created_at: new Date() }];
    }
    if (sql.includes("UPDATE walkin_enquiries")) {
      return [{ id: 1, assigned_to: params[0], assigned_to_user_id: params[1] }];
    }
    if (sql.includes("INSERT INTO lead_assignment_logs")) {
      capturedAssignmentLogParams = params;
      return [];
    }
    return [];
  }),
  transaction: vi.fn(),
  recalculateSrNos: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

// ── Imports (after mocks are hoisted) ─────────────────────────────────────────
import { query as dbQuery } from "@/lib/db";
const mockQuery = vi.mocked(dbQuery);

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeTransferRequest(body: Record<string, any>): Request {
  return new Request("http://localhost:3000/api/leads/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("P0-7/P1-9 POST /api/leads/transfer — transferred_by derives from session, not body", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedFollowUpParams = null;
    capturedAssignmentLogParams = null;

    // Reset to the default branching implementation after clearAllMocks()
    mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes("SELECT id, sr_no, assigned_to")) {
        return [{ id: 1, sr_no: 100, assigned_to: "Old Manager", assigned_receptionist: null }];
      }
      if (sql.includes("SELECT id") && sql.includes("FROM users")) {
        return [{ id: 88, normalized_role: "sales manager" }];
      }
      if (sql.includes("INSERT INTO follow_ups")) {
        capturedFollowUpParams = params;
        return [{ id: 9, lead_id: "1", message: params[1], created_by_name: params[2], created_at: new Date() }];
      }
      if (sql.includes("UPDATE walkin_enquiries")) {
        return [{ id: 1, assigned_to: params[0], assigned_to_user_id: params[1] }];
      }
      if (sql.includes("INSERT INTO lead_assignment_logs")) {
        capturedAssignmentLogParams = params;
        return [];
      }
      return [];
    });

    const mod = await import("./route");
    POST = mod.POST;
  });

  // Test #10: Forged transferred_by in body — DB must get the session name
  it("[P0-7 T10] forged transferred_by in body → lead_assignment_logs.assigned_by = session name", async () => {
    const req = makeTransferRequest({
      lead_id: 1,
      transfer_to: "New Manager",
      transfer_note: "Handing off this lead",
      transferred_by: "HACKER_NAME", // forged — must be ignored by the server
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // lead_assignment_logs INSERT: params[2] = assigned_by ($3 in SQL)
    expect(capturedAssignmentLogParams).not.toBeNull();
    expect(capturedAssignmentLogParams![2]).toBe("Session Admin");
    expect(capturedAssignmentLogParams![2]).not.toBe("HACKER_NAME");
  });

  // Companion: follow_ups.created_by_name also uses session name
  it("[P0-7] follow_ups.created_by_name = session name (not forged body value)", async () => {
    const req = makeTransferRequest({
      lead_id: 1,
      transfer_to: "New Manager",
      transfer_note: "Handing off this lead",
      transferred_by: "HACKER_NAME",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // follow_ups INSERT: params[2] = created_by_name ($3 in SQL)
    expect(capturedFollowUpParams).not.toBeNull();
    expect(capturedFollowUpParams![2]).toBe("Session Admin");
    expect(capturedFollowUpParams![2]).not.toBe("HACKER_NAME");
  });

  // Sanity: transfer still works when transferred_by is absent (P1-9 cleanup)
  it("[P1-9] transferred_by absent from body → transfer succeeds (field was dead weight)", async () => {
    const req = makeTransferRequest({
      lead_id: 1,
      transfer_to: "New Manager",
      transfer_note: "Handing off this lead",
      // transferred_by deliberately omitted
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // DB still records the session actor
    expect(capturedAssignmentLogParams![2]).toBe("Session Admin");
  });
});
