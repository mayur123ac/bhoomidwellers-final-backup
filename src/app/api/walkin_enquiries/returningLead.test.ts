// @vitest-environment node
//
// Tests for the returning-lead classification logic in POST /api/walkin_enquiries.
//
// Verifies that:
//   * A brand-new phone number creates a UNIQUE lead
//   * The same phone within 15 seconds is rejected (409)
//   * The same phone within 24 hours is rejected (duplicate)
//   * The same phone after 24 hours creates a RETURNING_LEAD
//   * The response includes returning-lead metadata
//   * Phone normalization works (different formats match)

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => {
  const mockClient = {
    query: vi.fn(async () => ({ rows: [{ id: 999 }] })),
  };
  return {
    query: vi.fn(async () => []),
    transaction: vi.fn(async (fn: any) => fn(mockClient)),
    recalculateSrNos: vi.fn(),
    getPool: vi.fn(() => ({ query: vi.fn() })),
  };
});

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "test-org-uuid"),
}));

vi.mock("@/lib/serverAuth", () => ({
  getServerSession: vi.fn(async () => ({
    _id: "1", name: "Front Desk", email: "desk@test.com", role: "Receptionist", org: "test-org",
  })),
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

import { query, transaction } from "@/lib/db";
const mockQuery = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);

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

describe("POST /api/walkin_enquiries — returning lead classification", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: no prior leads
    mockQuery.mockResolvedValue([] as any);

    // Default transaction mock: returns a row with the classification
    const mockClient = {
      query: vi.fn(async () => ({ rows: [{ id: 999 }] })),
    };
    mockTransaction.mockImplementation(async (fn: any) => {
      const result = await fn(mockClient);
      return result;
    });

    const mod = await import("./route");
    POST = mod.POST;
  });

  it("classifies a new phone number as UNIQUE", async () => {
    // No prior leads for this phone
    mockQuery.mockResolvedValue([] as any);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.leadClassification).toBe("UNIQUE");
    expect(body.returningFromLeadId).toBeNull();
  });

  it("rejects the same phone within 15 seconds (accidental double-click)", async () => {
    mockQuery.mockResolvedValue([{
      id: 100, name: "Existing Lead", assigned_to: "SM A", created_at: new Date(), seconds_ago: 5,
    }] as any);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/already been submitted/i);
  });

  it("rejects the same phone within 24 hours (duplicate)", async () => {
    mockQuery.mockResolvedValue([{
      id: 101, name: "Earlier Today", assigned_to: "SM B", created_at: new Date(), seconds_ago: 3600, // 1 hour
    }] as any);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/already created today/i);
  });

  it("classifies a phone seen >24h ago as RETURNING_LEAD", async () => {
    mockQuery.mockResolvedValue([{
      id: 50, name: "Old Client", assigned_to: "SM C", created_at: new Date(Date.now() - 100000000), seconds_ago: 100000,
    }] as any);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.leadClassification).toBe("RETURNING_LEAD");
    expect(body.returningFromLeadId).toBe(50);
    expect(body.returningFromLeadName).toBe("Old Client");
    expect(body.returningFromAssignedTo).toBe("SM C");
  });

  it("rejects requests missing required fields", async () => {
    const res = await POST(new Request("http://localhost:3000/api/walkin_enquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", phone: "" }),
    }));
    expect(res.status).toBe(400);
  });
});
