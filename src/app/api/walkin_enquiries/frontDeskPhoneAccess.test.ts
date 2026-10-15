// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const listRows = [
  {
    id: 613,
    sr_no: 494,
    name: "Amit Singh",
    phone: "9876548982",
    alt_phone: null,
    assigned_to: "Singh Saumya",
    assigned_to_user_id: 8,
    assigned_receptionist: "Singh Saumya",
    assigned_receptionist_user_id: 8,
    overseeing_site_head_user_id: null,
  },
  {
    id: 700,
    sr_no: 592,
    name: "Sales Manager Lead",
    phone: "9987331449",
    alt_phone: null,
    assigned_to: "Sales Manager A",
    assigned_to_user_id: 99,
    assigned_receptionist: null,
    assigned_receptionist_user_id: null,
    overseeing_site_head_user_id: null,
  },
  {
    id: 701,
    sr_no: 591,
    name: "Other Receptionist Lead",
    phone: "8451862300",
    alt_phone: null,
    assigned_to: "Other Receptionist",
    assigned_to_user_id: 77,
    assigned_receptionist: "Other Receptionist",
    assigned_receptionist_user_id: 77,
    overseeing_site_head_user_id: null,
  },
  {
    id: 702,
    sr_no: 590,
    name: "Unassigned Lead",
    phone: "9814936887",
    alt_phone: null,
    assigned_to: null,
    assigned_to_user_id: null,
    assigned_receptionist: null,
    assigned_receptionist_user_id: null,
    overseeing_site_head_user_id: null,
  },
];

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  recalculateSrNos: vi.fn(),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
}));

vi.mock("@/lib/serverAuth", () => ({
  getServerSession: vi.fn(async () => ({
    _id: "8",
    name: "Singh Saumya",
    role: "Receptionist",
    org: "org-1",
  })),
  getSessionUserId: vi.fn(() => 8),
}));

vi.mock("@/lib/visitChain", () => ({
  batchGetVisitDepths: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/cpCommissionEngine", () => ({
  isChannelPartnerSource: vi.fn(() => false),
  resolveChannelPartnerId: vi.fn(async () => null),
}));

vi.mock("@/lib/sourcingAssignment", () => ({
  claimPartnerForSourcingManager: vi.fn(),
  resolvePartnerOwner: vi.fn(async () => null),
}));

vi.mock("@/lib/walkInQueue", () => ({
  isManagerEligible: vi.fn(async () => true),
}));

vi.mock("@/services/whatsapp.service", () => ({
  notifyCpLeadAssigned: vi.fn(),
}));

vi.mock("@/lib/supabase/broadcast", () => ({
  broadcastToOrg: vi.fn(async () => undefined),
}));

vi.mock("@/lib/email/EmailService", () => ({
  EmailService: {
    sendEnquiryConfirmation: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/email/types", () => ({
  isValidRecipient: vi.fn(() => false),
}));

import { query } from "@/lib/db";

const mockQuery = vi.mocked(query);

describe("GET /api/walkin_enquiries receptionist Front Desk Log phone access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM phone_number_access_policies")) {
        return [{ can_view_full_phone: true }] as any;
      }
      if (sql.includes("SELECT w.*") && sql.includes("FROM walkin_enquiries w")) {
        return listRows as any;
      }
      if (sql.includes("SELECT COUNT(*)::int AS total")) {
        return [{ total: listRows.length }] as any;
      }
      return [] as any;
    });
  });

  it("keeps the logged-in receptionist's own lead full and masks Sales Manager, other receptionist, and unassigned leads", async () => {
    const { GET } = await import("./route");

    const res = await GET(
      new Request("http://localhost/api/walkin_enquiries?q=9987331449&searchColumn=basic")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(4);
    expect(body.data.find((r: any) => r.id === 613).phone).toBe("9876548982");
    expect(body.data.find((r: any) => r.id === 700).phone).not.toBe("9987331449");
    expect(body.data.find((r: any) => r.id === 700).phone).toMatch(/^99.+1449$/);
    expect(body.data.find((r: any) => r.id === 701).phone).not.toBe("8451862300");
    expect(body.data.find((r: any) => r.id === 702).phone).not.toBe("9814936887");
  });
});
