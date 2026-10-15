// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
}));

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => ({
    ok: true,
    session: {
      _id: "8",
      name: "Singh Saumya",
      role: "Receptionist",
      org: "org-1",
    },
    userId: 8,
  })),
  getSessionUserId: vi.fn(() => 8),
}));

vi.mock("@/lib/visitChain", () => ({
  batchGetVisitDepths: vi.fn(async () => new Map([[613, 2]])),
}));

vi.mock("@/lib/phoneAccess", () => ({
  resolvePhones: vi.fn(async (_actor: any, rows: any[]) => rows),
}));

import { query } from "@/lib/db";
import { resolvePhones } from "@/lib/phoneAccess";

const mockQuery = vi.mocked(query);
const mockResolvePhones = vi.mocked(resolvePhones);

const rawSelfAssignedLead = {
  id: 613,
  sr_no: 494,
  name: "Amit Singh",
  phone: "9876548982",
  alt_phone: "7777700000",
  assigned_to: "Singh Saumya",
  assigned_to_user_id: 8,
  assigned_receptionist: "Singh Saumya",
  assigned_receptionist_user_id: 8,
};

describe("Receptionist lead phone access endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([rawSelfAssignedLead] as any);
    mockResolvePhones.mockImplementation(async (_actor: any, rows: any[]) => rows);
  });

  it("GET /api/receptionist/assigned uses session identity and LEAD_PHONE resolution", async () => {
    const { GET } = await import("./assigned/route");

    const res = await GET(new Request("http://localhost/api/receptionist/assigned?name=SomeoneElse"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("assigned_to_user_id = $1"),
      [8, "Singh Saumya", "org-1"]
    );
    expect(mockResolvePhones).toHaveBeenCalledWith(
      { _id: "8", name: "Singh Saumya", role: "Receptionist" },
      [rawSelfAssignedLead],
      "LEAD_PHONE",
      "org-1",
      ["phone", "alt_phone"]
    );
    expect(body.data[0].phone).toBe("9876548982");
    expect(body.data[0].visitNumber).toBe(2);
  });

  it("GET /api/receptionist/leads returns the phone values produced by the backend policy", async () => {
    mockResolvePhones.mockResolvedValueOnce([
      {
        ...rawSelfAssignedLead,
        phone: "98****8982",
        alt_phone: "77****0000",
      },
    ] as any);
    const { GET } = await import("./leads/route");

    const res = await GET(new Request("http://localhost/api/receptionist/leads?name=SomeoneElse"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("assigned_receptionist_user_id = $1"),
      [8, "Singh Saumya", "org-1"]
    );
    expect(body.data[0].phone).toBe("98****8982");
    expect(body.data[0].alt_phone).toBe("77****0000");
  });
});
