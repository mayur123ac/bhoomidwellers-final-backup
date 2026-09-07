// @vitest-environment node
//
// Tests for multi-field revisit detection in GET /api/walkin_enquiries/check-match
// and POST /api/walkin_enquiries returning-lead classification.
//
// Covers:
//   * Exact phone match (primary mobile)
//   * Alternate phone match
//   * Email match
//   * Name + address match
//   * Name-only NON-match
//   * Unchecked checkbox creating Visit 1
//   * Checked checkbox creating Visit 2
//   * Visit 3 from an existing Visit 2
//   * Multiple matching customers
//   * Different organizations with identical customer info
//   * Normalized phone formats (+91 8369787919, 8369787919, +918369787919)

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
  getOrganizationId: vi.fn(async () => "org-alpha"),
}));

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => ({
    ok: true,
    session: { _id: "1", name: "Front Desk", email: "desk@test.com", role: "Receptionist", org: "org-alpha" },
  })),
  getServerSession: vi.fn(async () => ({
    _id: "1", name: "Front Desk", email: "desk@test.com", role: "Receptionist", org: "org-alpha",
  })),
}));

vi.mock("@/lib/phoneAccess", () => ({
  resolvePhone: vi.fn(async (_actor: any, _row: any, _scope: string, _orgId: string, phone: string) => phone),
}));

vi.mock("@/lib/visitChain", () => ({
  batchGetVisitDepths: vi.fn(async (ids: number[]) => {
    const m = new Map<number, number>();
    for (const id of ids) m.set(id, 1);
    return m;
  }),
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

import { query } from "@/lib/db";
import { batchGetVisitDepths } from "@/lib/visitChain";
import { getOrganizationId } from "@/lib/tenantContext";

const mockQuery = vi.mocked(query);
const mockBatchDepths = vi.mocked(batchGetVisitDepths);
const mockGetOrgId = vi.mocked(getOrganizationId);

// Helper: row that looks like a walkin_enquiry
function makeDbRow(overrides: Record<string, any> = {}) {
  return {
    id: 50,
    name: "Existing Client",
    phone: "8369787919",
    alt_phone: null,
    email: "client@test.com",
    address: "123 Main Street, Andheri",
    pin_code: "400069",
    city: "Mumbai",
    assigned_to: "SM A",
    created_at: new Date(Date.now() - 200_000_000).toISOString(), // > 24h ago
    lead_classification: "UNIQUE",
    seconds_ago: 200_000,
    ...overrides,
  };
}

function makeCheckMatchUrl(params: Record<string, string>): string {
  const sp = new URLSearchParams(params);
  return `http://localhost:3000/api/walkin_enquiries/check-match?${sp.toString()}`;
}

// ── check-match API tests ─────────────────────────────────────────────────

describe("GET /api/walkin_enquiries/check-match — multi-field matching", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([] as any);
    mockBatchDepths.mockImplementation(async (ids) => {
      const m = new Map<number, number>();
      for (const id of ids) m.set(id, 1);
      return m;
    });
    mockGetOrgId.mockResolvedValue("org-alpha");

    const mod = await import("./route");
    GET = mod.GET;
  });

  it("returns no match when no fields are provided", async () => {
    const res = await GET(new Request(makeCheckMatchUrl({})));
    const body = await res.json();
    expect(body.matched).toBe(false);
    expect(body.candidates).toEqual([]);
  });

  it("detects an exact primary mobile match", async () => {
    const row = makeDbRow();
    // The first query is the primary mobile match
    mockQuery.mockResolvedValueOnce([row] as any);

    const res = await GET(new Request(makeCheckMatchUrl({ phone: "8369787919" })));
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.candidates.length).toBe(1);
    expect(body.candidates[0].id).toBe(50);
    expect(body.candidates[0].matchReasons).toContain("primary_mobile");
  });

  it("detects an alternate mobile match (incoming phone vs existing alt_phone)", async () => {
    const row = makeDbRow({ id: 51, alt_phone: "9999999999" });
    // First query (primary phone match): no results
    mockQuery.mockResolvedValueOnce([] as any);
    // Second query (incoming phone vs existing alt_phone): match
    mockQuery.mockResolvedValueOnce([row] as any);

    const res = await GET(new Request(makeCheckMatchUrl({ phone: "9999999999" })));
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.candidates[0].matchReasons).toContain("alternate_mobile");
  });

  it("detects an alternate mobile match (incoming altPhone vs existing phone)", async () => {
    const row = makeDbRow({ id: 52 });
    // No primary phone match
    mockQuery.mockResolvedValueOnce([] as any);
    // No incoming phone vs existing alt_phone
    mockQuery.mockResolvedValueOnce([] as any);
    // Incoming altPhone vs existing phone: match
    mockQuery.mockResolvedValueOnce([row] as any);

    const res = await GET(new Request(makeCheckMatchUrl({
      phone: "1111111111",
      altPhone: "8369787919",
    })));
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.candidates.some((c: any) => c.matchReasons.includes("alternate_mobile"))).toBe(true);
  });

  it("detects an email match", async () => {
    const row = makeDbRow({ id: 53 });
    // All phone queries return empty
    mockQuery.mockResolvedValue([] as any);
    // Override: email query returns a match
    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
      if (typeof sql === "string" && sql.includes("LOWER(TRIM(email))")) {
        return [row] as any;
      }
      return [] as any;
    });

    const res = await GET(new Request(makeCheckMatchUrl({
      email: "Client@Test.com",
    })));
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.candidates[0].matchReasons).toContain("email");
  });

  it("detects a name + address match", async () => {
    const row = makeDbRow({ id: 54 });
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("address IS NOT NULL AND address <> 'N/A'")) {
        return [row] as any;
      }
      return [] as any;
    });

    const res = await GET(new Request(makeCheckMatchUrl({
      name: "Existing Client",
      address: "123 Main Street, Andheri",
    })));
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.candidates[0].matchReasons).toContain("name_address");
  });

  it("does NOT match on name alone", async () => {
    // Name-only must not produce any match
    mockQuery.mockResolvedValue([] as any);

    const res = await GET(new Request(makeCheckMatchUrl({
      name: "Existing Client",
    })));
    const body = await res.json();
    expect(body.matched).toBe(false);
    expect(body.candidates).toEqual([]);
  });

  it("returns multiple candidates when several leads match", async () => {
    const row1 = makeDbRow({ id: 60, name: "Client A" });
    const row2 = makeDbRow({ id: 61, name: "Client B" });

    mockQuery.mockResolvedValueOnce([row1, row2] as any);

    const res = await GET(new Request(makeCheckMatchUrl({ phone: "8369787919" })));
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.candidates.length).toBe(2);
    expect(body.candidates.map((c: any) => c.id)).toEqual(expect.arrayContaining([60, 61]));
  });

  it("enforces organization isolation (different orgs with identical data)", async () => {
    // The API uses getOrganizationId() to scope queries — only org-alpha leads appear
    const row = makeDbRow({ id: 70 });
    // First call returns a match (scoped to org-alpha already by the mock)
    mockQuery.mockResolvedValueOnce([row] as any);

    const res = await GET(new Request(makeCheckMatchUrl({ phone: "8369787919" })));
    const body = await res.json();
    expect(body.matched).toBe(true);

    // Verify the query was called with the org-alpha scope
    const firstCallArgs = mockQuery.mock.calls[0];
    expect(firstCallArgs[1]).toContain("org-alpha");
  });

  it("handles normalized phone formats: +91 8369787919, 8369787919, +918369787919", async () => {
    // All three formats should produce the same normalized phone (last 10 digits)
    // The normalization happens in the SQL (RIGHT(regexp_replace(...), 10)),
    // so all three should hit the same query with the raw value — the DB normalizes.
    const row = makeDbRow();

    for (const format of ["+91 8369787919", "8369787919", "+918369787919"]) {
      vi.clearAllMocks();
      mockQuery.mockResolvedValueOnce([row] as any);

      const res = await GET(new Request(makeCheckMatchUrl({ phone: format })));
      const body = await res.json();
      expect(body.matched).toBe(true);
      expect(body.candidates[0].matchReasons).toContain("primary_mobile");
    }
  });

  it("ignores matches less than 24 hours old", async () => {
    const recentRow = makeDbRow({ seconds_ago: 3600 }); // 1 hour ago
    mockQuery.mockResolvedValueOnce([recentRow] as any);

    const res = await GET(new Request(makeCheckMatchUrl({ phone: "8369787919" })));
    const body = await res.json();
    expect(body.matched).toBe(false);
  });

  it("detects name + PIN/city supporting match", async () => {
    const row = makeDbRow({ id: 55, pin_code: "400069" });
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("pin_code IS NOT NULL")) {
        return [row] as any;
      }
      return [] as any;
    });

    const res = await GET(new Request(makeCheckMatchUrl({
      name: "Existing Client",
      pinCode: "400069",
    })));
    const body = await res.json();
    expect(body.matched).toBe(true);
    expect(body.candidates[0].matchReasons).toContain("name_pin_city");
  });
});

// ── POST /api/walkin_enquiries — revisit checkbox behavior ────────────────

import { transaction } from "@/lib/db";
const mockTransaction = vi.mocked(transaction);

function makePostRequest(body: Record<string, any>): Request {
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

describe("POST /api/walkin_enquiries — revisit checkbox creates correct visits", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([] as any);

    const mockClient = {
      query: vi.fn(async () => ({ rows: [{ id: 999 }] })),
    };
    mockTransaction.mockImplementation(async (fn: any) => {
      const result = await fn(mockClient);
      return result;
    });

    const mod = await import("../route");
    POST = mod.POST;
  });

  it("unchecked checkbox creates Visit 1 (UNIQUE)", async () => {
    // Prior lead exists but isRevisit is false
    mockQuery.mockResolvedValue([makeDbRow({ id: 50 })] as any);

    const res = await POST(makePostRequest({ isRevisit: false }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.leadClassification).toBe("UNIQUE");
    expect(body.returningFromLeadId).toBeNull();
  });

  it("checked checkbox creates Visit 2 (RETURNING_LEAD)", async () => {
    mockQuery.mockResolvedValue([makeDbRow({ id: 50 })] as any);

    const res = await POST(makePostRequest({ isRevisit: true, revisitLeadId: 50 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.leadClassification).toBe("RETURNING_LEAD");
    expect(body.returningFromLeadId).toBe(50);
  });

  it("creates Visit 3 from an existing Visit 2", async () => {
    // The "most recent" prior lead is visit 2 (itself a RETURNING_LEAD)
    mockQuery.mockResolvedValue([
      makeDbRow({ id: 75, lead_classification: "RETURNING_LEAD", seconds_ago: 200_000 }),
    ] as any);

    const res = await POST(makePostRequest({ isRevisit: true, revisitLeadId: 75 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.leadClassification).toBe("RETURNING_LEAD");
    // The chain links to the most recent visit (75), making the new one Visit 3.
    // Visit depth is computed by the recursive CTE at read time, not stored.
    expect(body.returningFromLeadId).toBe(75);
  });

  it("multi-field revisit fallback: revisitLeadId used when phone doesn't match", async () => {
    // Primary phone query returns no match, but the client found a match via email/alt_phone.
    // First call (phone check) returns empty:
    mockQuery
      .mockResolvedValueOnce([] as any)    // phone check: no match
      .mockResolvedValueOnce([makeDbRow({ id: 88, seconds_ago: 200_000 })] as any); // fallback id check

    const res = await POST(makePostRequest({
      isRevisit: true,
      revisitLeadId: 88,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.leadClassification).toBe("RETURNING_LEAD");
    expect(body.returningFromLeadId).toBe(88);
  });

  it("does not silently convert to revisit — requires explicit checkbox", async () => {
    mockQuery.mockResolvedValue([makeDbRow({ id: 50 })] as any);

    // No isRevisit flag at all
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(201);
    const body = await res.json();
    // Even though a matching lead exists, it stays UNIQUE without the checkbox
    expect(body.leadClassification).toBe("UNIQUE");
  });
});
