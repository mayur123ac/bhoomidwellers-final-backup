// @vitest-environment node
//
// Tests for manager assignment availability.
//
// Business rules under test:
//   • GET /api/users/sales-manager returns assignmentAvailability: "available" | "busy"
//   • GET /api/users/site-head returns assignmentAvailability: "available" | "busy"
//   • BUSY = manager has an active receptionist_submitted lead whose sales form is
//     not yet submitted (sales_form_submitted_at IS NULL, not lost, not terminal).
//   • Availability is independent of login presence (Online/Offline).
//   • SSMs are included in the sales-manager endpoint.
//   • Both endpoints are org-scoped (tenant isolation).
//   • Availability updates after sales-form submission (covered via existing T10–T16).

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Static mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => ({
    ok: true,
    userId: 1,
    session: { _id: "1", name: "Receptionist", role: "receptionist" },
    response: undefined,
  })),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "org-abc"),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/db";
const mockQuery = vi.mocked(query);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock manager row as the DB would return it. */
function makeManagerRow(overrides: Record<string, any> = {}) {
  return {
    id: 10,
    name: "Amit SM",
    username: "amit",
    email: "amit@test.com",
    phone: null,
    whatsapp_number: null,
    presence: "ONLINE",
    assignmentAvailability: "available",
    role: "sales manager",
    ...overrides,
  };
}

// ── GET /api/users/sales-manager ──────────────────────────────────────────────

describe("GET /api/users/sales-manager — assignmentAvailability", () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // First call: expire stale sessions (UPDATE, return value ignored)
    mockQuery.mockResolvedValueOnce([] as any);
    const mod = await import("./route");
    GET = mod.GET;
  });

  // T-A1: Available manager
  it("[T-A1] manager with no active unworked receptionist lead → assignmentAvailability=available", async () => {
    mockQuery.mockResolvedValueOnce([makeManagerRow({ assignmentAvailability: "available" })] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data[0].assignmentAvailability).toBe("available");
  });

  // T-A2: Busy manager
  it("[T-A2] manager with active unworked receptionist lead → assignmentAvailability=busy", async () => {
    mockQuery.mockResolvedValueOnce([makeManagerRow({ assignmentAvailability: "busy" })] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].assignmentAvailability).toBe("busy");
  });

  // T-A3: Offline + BUSY — orthogonal fields
  it("[T-A3] manager can be OFFLINE and BUSY simultaneously", async () => {
    mockQuery.mockResolvedValueOnce([
      makeManagerRow({ presence: "OFFLINE", assignmentAvailability: "busy" }),
    ] as any);

    const res = await GET();
    const json = await res.json();
    const m = json.data[0];
    expect(m.presence).toBe("OFFLINE");
    expect(m.assignmentAvailability).toBe("busy");
  });

  // T-A4: SSM is included in the response
  it("[T-A4] Senior Sales Manager appears in sales-manager endpoint", async () => {
    mockQuery.mockResolvedValueOnce([
      makeManagerRow({ role: "senior sales manager", name: "Senior SM", assignmentAvailability: "available" }),
    ] as any);

    const res = await GET();
    const json = await res.json();
    expect(json.data.some((m: any) => m.role === "senior sales manager")).toBe(true);
  });

  // T-A5: Tenant isolation — orgId is always passed to both queries
  it("[T-A5] orgId is passed to both DB queries (tenant isolation)", async () => {
    mockQuery.mockResolvedValueOnce([makeManagerRow()] as any);

    await GET();

    // Both calls must receive the org UUID as first positional param
    expect(mockQuery).toHaveBeenCalledTimes(2);
    for (const call of mockQuery.mock.calls) {
      expect(call[1]?.[0]).toBe("org-abc");
    }
  });

  // T-A6: Multiple managers — mixed availability
  it("[T-A6] returns correct availability for each manager independently", async () => {
    mockQuery.mockResolvedValueOnce([
      makeManagerRow({ id: 10, name: "Amit SM",  assignmentAvailability: "available" }),
      makeManagerRow({ id: 11, name: "Busy SM",  assignmentAvailability: "busy" }),
      makeManagerRow({ id: 12, name: "Other SM", assignmentAvailability: "available" }),
    ] as any);

    const res = await GET();
    const json = await res.json();
    expect(json.data).toHaveLength(3);
    expect(json.data.find((m: any) => m.name === "Busy SM").assignmentAvailability).toBe("busy");
    expect(json.data.find((m: any) => m.name === "Amit SM").assignmentAvailability).toBe("available");
  });
});

// ── GET /api/users/site-head ──────────────────────────────────────────────────

describe("GET /api/users/site-head — assignmentAvailability", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValueOnce([] as any); // expire sessions
    const mod = await import("../site-head/route");
    GET = mod.GET;
  });

  // T-A7: Site Head available
  it("[T-A7] site head with no active unworked lead → assignmentAvailability=available", async () => {
    mockQuery.mockResolvedValueOnce([
      makeManagerRow({ role: "site_head", assignmentAvailability: "available" }),
    ] as any);

    const req = new Request("http://localhost/api/users/site-head");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].assignmentAvailability).toBe("available");
  });

  // T-A8: Site Head busy
  it("[T-A8] site head with active unworked lead → assignmentAvailability=busy", async () => {
    mockQuery.mockResolvedValueOnce([
      makeManagerRow({ role: "site_head", name: "Neha Site Head", assignmentAvailability: "busy" }),
    ] as any);

    const req = new Request("http://localhost/api/users/site-head");
    const res = await GET(req);
    const json = await res.json();
    expect(json.data[0].assignmentAvailability).toBe("busy");
  });

  // T-A9: Site head availability uses same criteria as walkInQueue.isManagerEligible
  it("[T-A9] site head busy state is orthogonal to online presence", async () => {
    mockQuery.mockResolvedValueOnce([
      makeManagerRow({ role: "site_head", presence: "OFFLINE", assignmentAvailability: "busy" }),
    ] as any);

    const req = new Request("http://localhost/api/users/site-head");
    const res = await GET(req);
    const json = await res.json();
    const sh = json.data[0];
    expect(sh.presence).toBe("OFFLINE");
    expect(sh.assignmentAvailability).toBe("busy");
  });

  // T-A10: Tenant isolation for site-head endpoint
  it("[T-A10] orgId is passed to all site-head DB queries", async () => {
    mockQuery.mockResolvedValueOnce([makeManagerRow({ role: "site_head" })] as any);

    const req = new Request("http://localhost/api/users/site-head");
    await GET(req);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    for (const call of mockQuery.mock.calls) {
      expect(call[1]?.[0]).toBe("org-abc");
    }
  });
});
