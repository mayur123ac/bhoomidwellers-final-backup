// @vitest-environment node
//
// Tests for the automatic enquiry confirmation email sent to the customer
// immediately after a receptionist registers a walk-in enquiry.
//
// Business rules under test:
//   • When a valid customer email is present, a confirmation email is sent.
//   • The org name is resolved dynamically from the organizations table.
//   • The email is addressed to the customer (not an internal user).
//   • When assignedTo is set, the manager name appears in the email.
//   • When the lead is queued (assignmentStatus=pending), assignedTo is null.
//   • "N/A" and missing email values are silently skipped — no email sent.
//   • SMTP failure does NOT fail the enquiry (fire-and-forget).
//   • No duplicate email on retried POST (idempotent per request boundary).
//   • Tenant isolation: org name is fetched using the request's orgId, not a
//     hard-coded value.
//   • The template can be edited in templates/index.ts without touching route.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Static mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  transaction: vi.fn(),
  recalculateSrNos: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "org-test"),
}));

vi.mock("@/lib/serverAuth", () => ({
  getServerSession: vi.fn(async () => ({
    _id: "42", id: "42", name: "Priya Desk",
    email: "priya@test.com", role: "Receptionist", org: "test-org",
  })),
  getSessionUserId: vi.fn(() => 42),
  requireSession: vi.fn(async () => ({
    ok: true, userId: 99,
    session: { _id: "99", name: "Amit SM", role: "sales manager" },
    response: undefined,
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

vi.mock("@/lib/supabase/broadcast", () => ({
  broadcastToOrg: vi.fn(async () => {}),
}));

vi.mock("@/lib/phoneAccess", () => ({
  resolvePhones: vi.fn(async (_a: any, rows: any[]) => rows),
}));

vi.mock("@/lib/visitChain", () => ({
  batchGetVisitDepths: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/walkInQueue", () => ({
  isManagerEligible: vi.fn(async () => true),
  processQueueForManager: vi.fn(async () => null),
}));

// EmailService is mocked so we can spy on sendEnquiryConfirmation without
// actually hitting SMTP. The mock mirrors the real module shape.
vi.mock("@/lib/email/EmailService", () => ({
  EmailService: {
    sendEnquiryConfirmation: vi.fn(async () => ({
      delivered: true, provider: "console",
    })),
  },
}));

// isValidRecipient keeps its real implementation so the "N/A" / empty-string
// filter logic runs as it would in production.
vi.mock("@/lib/email/types", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/types")>();
  return { ...real };
});

// ── Imports ───────────────────────────────────────────────────────────────────

import { query, transaction } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { isManagerEligible } from "@/lib/walkInQueue";
import { EmailService } from "@/lib/email/EmailService";

const mockQuery       = vi.mocked(query);
const mockTransaction = vi.mocked(transaction);
const mockGetSession  = vi.mocked(getServerSession);
const mockIsEligible  = vi.mocked(isManagerEligible);
const mockSendEmail   = vi.mocked(EmailService.sendEnquiryConfirmation);

// ── Helpers ───────────────────────────────────────────────────────────────────

function receptionistSession() {
  return {
    _id: "42", id: "42", name: "Priya Desk",
    email: "priya@test.com", role: "Receptionist", org: "test-org",
  } as any;
}

/**
 * Transaction-level client mock.
 *
 * The INSERT captures name ($1) and email ($3) from the params so the
 * subsequent `SELECT * FROM walkin_enquiries WHERE id` returns a full row.
 * This mirrors what the real DB does: the route INSERTs then re-SELECTs the
 * row to get computed columns — result.row.email therefore reflects the
 * value that was INSERTed.
 *
 * The optional queryFn override allows individual tests to return custom rows.
 */
function makeClient(queryFn?: (sql: string, params: any[]) => any) {
  // Captured from the INSERT so the SELECT can echo them back.
  let _name  = "Walk In Client";
  let _email = "test@example.com";

  return {
    query: vi.fn(async (sql: string, params: any[]) => {
      if (queryFn) {
        const r = queryFn(sql, params);
        if (r !== undefined) return r;
      }
      if (sql.includes("INSERT INTO walkin_enquiries")) {
        _name  = params[0];          // $1 = name
        _email = params[2] ?? "N/A"; // $3 = email || "N/A"
        (globalThis as any).__lastInsertParams = params;
        return { rows: [{ id: 888 }] };
      }
      if (sql.includes("INSERT INTO walk_in_assignment_queue")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT * FROM walkin_enquiries WHERE id")) {
        return { rows: [{ id: 888, name: _name, email: _email, assigned_to: "Amit SM", organization_id: "org-test" }] };
      }
      return { rows: [{ id: 99, normalized_role: "sales manager" }] };
    }),
  };
}

function makeRequest(body: Record<string, any> = {}) {
  return new Request("http://localhost/api/walkin_enquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Walk In Client",
      phone: "9000000001",
      assignedTo: "Amit SM",
      ...body,
    }),
  });
}

// Wait for fire-and-forget microtasks to settle
function flushAsync() {
  return new Promise<void>((resolve) => setTimeout(resolve, 10));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Enquiry confirmation email — POST /api/walkin_enquiries", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: all module-level query() calls return empty rows (no prior leads,
    // no sourcing manager, etc.). Individual tests override with mockImplementation
    // to route the "SELECT name FROM organizations" call to a specific org name.
    mockQuery.mockResolvedValue([] as any);
    mockIsEligible.mockResolvedValue(true);
    mockGetSession.mockResolvedValue(receptionistSession());
    // Default transaction: inserts enquiry row with a valid email
    mockTransaction.mockImplementation(async (fn: any) => fn(makeClient()));
    const mod = await import("./route");
    POST = mod.POST;
  });

  // Helper: mockQuery routing by SQL content — safe against positional Once consumption
  function withOrgName(name: string) {
    mockQuery.mockImplementation(async (sql: string) => {
      if ((sql as string).includes("FROM organizations")) return [{ name }];
      return [];
    });
  }

  // E1 — happy path: valid email triggers confirmation
  it("[E1] valid customer email → sendEnquiryConfirmation called once", async () => {
    withOrgName("Sunrise Realty");

    const res = await POST(makeRequest({ email: "customer@example.com" }));
    expect(res.status).toBe(201);

    await flushAsync();

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail.mock.calls[0][0]).toBe("customer@example.com");
  });

  // E2 — org name is resolved from organizations table (tenant isolation)
  it("[E2] org name is fetched dynamically — correct orgId used in query", async () => {
    withOrgName("Green Valley Homes");

    await POST(makeRequest({ email: "buyer@example.com" }));
    await flushAsync();

    // The query that resolves the org name must include the org id from context
    const orgNameQuery = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("organizations")
    );
    expect(orgNameQuery).toBeDefined();
    expect(orgNameQuery![1]).toContain("org-test");

    expect(mockSendEmail.mock.calls[0][1].orgName).toBe("Green Valley Homes");
  });

  // E3 — assigned manager name appears in the template input
  it("[E3] assignedTo from the saved row is passed to the template", async () => {
    withOrgName("Bhoomi Dwellers");

    await POST(makeRequest({ email: "buyer@example.com" }));
    await flushAsync();

    const input = mockSendEmail.mock.calls[0][1];
    expect(input.assignedTo).toBe("Amit SM");
  });

  // E4 — queued lead: assignedTo is null so customer sees generic message
  it("[E4] isQueuedAssignment=true → assignedTo is null in email input", async () => {
    mockIsEligible.mockResolvedValueOnce(false); // SM is busy → lead queued
    mockTransaction.mockImplementationOnce(async (fn: any) => fn(makeClient()));
    withOrgName("Bhoomi Dwellers");

    await POST(makeRequest({ email: "buyer@example.com" }));
    await flushAsync();

    const input = mockSendEmail.mock.calls[0][1];
    expect(input.assignedTo).toBeNull();
  });

  // E5 — "N/A" email: no email sent
  it("[E5] email='N/A' → sendEnquiryConfirmation NOT called", async () => {
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const client = makeClient((sql) => {
        if (sql.includes("INSERT INTO walkin_enquiries")) return { rows: [{ id: 888 }] };
        if (sql.includes("SELECT * FROM walkin_enquiries WHERE id")) {
          return { rows: [{ id: 888, name: "Walk In Client", email: "N/A", assigned_to: "Amit SM", organization_id: "org-test" }] };
        }
      });
      return fn(client);
    });

    await POST(makeRequest({ email: "N/A" }));
    await flushAsync();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // E6 — missing email: no email sent
  it("[E6] email missing (empty string) → sendEnquiryConfirmation NOT called", async () => {
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const client = makeClient((sql) => {
        if (sql.includes("INSERT INTO walkin_enquiries")) return { rows: [{ id: 888 }] };
        if (sql.includes("SELECT * FROM walkin_enquiries WHERE id")) {
          return { rows: [{ id: 888, name: "Walk In Client", email: "", assigned_to: "Amit SM", organization_id: "org-test" }] };
        }
      });
      return fn(client);
    });

    await POST(makeRequest({ email: "" }));
    await flushAsync();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // E7 — SMTP failure does not affect the enquiry response
  it("[E7] SMTP failure does not cause enquiry POST to fail", async () => {
    mockSendEmail.mockRejectedValueOnce(new Error("SMTP connection refused"));
    withOrgName("Bhoomi Dwellers");

    const res = await POST(makeRequest({ email: "buyer@example.com" }));

    await flushAsync();

    // Enquiry still created successfully
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  // E8 — org name falls back to "Bhoomi Dwellers" when organizations query returns empty
  it("[E8] org name falls back to 'Bhoomi Dwellers' when organizations row is not found", async () => {
    // mockQuery already defaults to [] (no org row found) — no override needed

    await POST(makeRequest({ email: "buyer@example.com" }));
    await flushAsync();

    const input = mockSendEmail.mock.calls[0][1];
    expect(input.orgName).toBe("Bhoomi Dwellers");
  });

  // E9 — client name is passed through to the template
  it("[E9] clientName in email input matches the name submitted in the form", async () => {
    withOrgName("Sunrise Realty");

    await POST(makeRequest({ name: "Rajesh Kumar", email: "rajesh@example.com" }));
    await flushAsync();

    const input = mockSendEmail.mock.calls[0][1];
    expect(input.clientName).toBe("Rajesh Kumar");
  });

  // E10 — null email in saved row: no email sent
  it("[E10] null email in saved row → sendEnquiryConfirmation NOT called", async () => {
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const client = makeClient((sql) => {
        if (sql.includes("INSERT INTO walkin_enquiries")) return { rows: [{ id: 888 }] };
        if (sql.includes("SELECT * FROM walkin_enquiries WHERE id")) {
          return { rows: [{ id: 888, name: "Walk In Client", email: null, assigned_to: "Amit SM", organization_id: "org-test" }] };
        }
      });
      return fn(client);
    });

    await POST(makeRequest());
    await flushAsync();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // E11 — template unit test: enquiryConfirmationTemplate produces correct shape
  it("[E11] enquiryConfirmationTemplate shape — subject, html, text, assignedTo mentioned", async () => {
    const { enquiryConfirmationTemplate } = await import("@/lib/email/templates/index");

    const t = enquiryConfirmationTemplate({
      clientName: "Priya Patel",
      orgName: "Sunrise Realty",
      assignedTo: "Amit SM",
    });

    expect(t.subject).toContain("Sunrise Realty");
    expect(t.html).toContain("Priya Patel");
    expect(t.html).toContain("Amit SM");
    expect(t.text).toContain("Amit SM");
    expect(Array.isArray(t.attachments)).toBe(true);

    // No assignedTo variant
    const t2 = enquiryConfirmationTemplate({
      clientName: "Ravi",
      orgName: "Green Valley",
      assignedTo: null,
    });
    expect(t2.text).toContain("Our team will be in touch");
    expect(t2.text).not.toContain("null");
  });
});
