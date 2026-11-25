// @vitest-environment node
//
// Tests for /api/settings/employees
//
// Covers: email delivery, invitation tokens, multi-tenant IDOR, account
// creation, SMTP error handling, and invitation acceptance.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockSession: any = null;
let mockUserId: number | null = null;
let mockQueryResults: any[] = [];
let mockQueryCalls: { sql: string; params: any[] }[] = [];

vi.mock("@/lib/serverAuth", () => ({
  requireRoles: vi.fn(async (roles: string[]) => {
    if (!mockSession) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ success: false, message: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    if (!roles.some((r) => r === mockSession.role || r === "super_admin" && mockSession.role === "super_admin")) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ success: false, message: "Forbidden" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
    return { ok: true, session: mockSession, userId: mockUserId };
  }),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[]) => {
    mockQueryCalls.push({ sql, params });
    return typeof mockQueryResults === "function"
      ? (mockQueryResults as any)(sql, params)
      : mockQueryResults;
  }),
}));

let mockEmailDelivered = true;
vi.mock("@/lib/email/EmailService", () => ({
  EmailService: {
    sendEmployeeInvitation: vi.fn(async () => ({
      delivered: mockEmailDelivered,
      provider: "smtp",
      messageId: mockEmailDelivered ? "test-msg-id" : undefined,
    })),
  },
}));

vi.mock("@/lib/email/config", () => ({
  isMailConfigured: vi.fn(() => true),
  readSenderConfig: vi.fn(() => ({
    fromName: "Test CRM",
    fromEmail: "test@example.com",
    replyTo: "test@example.com",
    supportEmail: "test@example.com",
    appUrl: "https://app.example.com",
    companyName: "Test Company",
  })),
}));

vi.mock("@/lib/settingsUser", () => ({
  joinName: (first: string, last: string) => [first, last].filter(Boolean).join(" "),
  avatarSrc: () => null,
  initialsFor: (name: string) => (name || "?")[0],
}));

vi.mock("@/lib/renameUserReferences", () => ({
  propagateUserRename: vi.fn(async () => {}),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { GET, POST, PATCH, DELETE } from "../route";
import { EmailService } from "@/lib/email/EmailService";

function makeRequest(
  method: string,
  body?: any,
  params?: Record<string, string>
) {
  const url = new URL("http://localhost/api/settings/employees");
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return new Request(url.toString(), init) as any;
}

async function json(res: Response) {
  return res.json();
}

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function adminSession(org: string | null = ORG_A) {
  mockSession = { role: "admin", org, name: "Test Admin" };
  mockUserId = 1;
}

function superAdminSession() {
  mockSession = { role: "super_admin", org: null, name: "Platform Admin" };
  mockUserId = 99;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSession = null;
  mockUserId = null;
  mockQueryResults = [];
  mockQueryCalls = [];
  mockEmailDelivered = true;
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/settings/employees", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(401);
  });

  it("returns employees scoped to org", async () => {
    adminSession();
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("FROM users e")) {
        return [{ id: 10, name: "Alice", email: "a@test.com", is_active: true, role: "admin" }];
      }
      if (sql.includes("FROM users\n")) return [];
      return [];
    }) as any;

    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    // Verify org scoping was applied
    const orgQueries = mockQueryCalls.filter((c) => c.params.includes(ORG_A));
    expect(orgQueries.length).toBeGreaterThan(0);
  });
});

describe("POST /api/settings/employees — creation", () => {
  it("rejects unauthenticated", async () => {
    const res = await POST(makeRequest("POST", { firstName: "Test" }));
    expect(res.status).toBe(401);
  });

  it("validates required fields", async () => {
    adminSession();
    mockQueryResults = [];
    const res = await POST(makeRequest("POST", { firstName: "", lastName: "" }));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.message).toContain("Name is required");
  });

  it("creates employee with temporary password when no invite", async () => {
    adminSession();
    // Mock: no duplicate, insert returns id
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE LOWER")) return [];
      if (sql.includes("INSERT INTO users")) return [{ id: 50 }];
      return [];
    }) as any;

    const res = await POST(
      makeRequest("POST", {
        firstName: "New",
        lastName: "Employee",
        email: "new@test.com",
        role: "sales_manager",
      })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.temporaryPassword).toBeTruthy();
    expect(body.id).toBe(50);
  });

  it("sends invite email and creates invitation token when sendInvite=true", async () => {
    adminSession();
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE LOWER")) return [];
      if (sql.includes("INSERT INTO users")) return [{ id: 51 }];
      if (sql.includes("UPDATE employee_invitations")) return [];
      if (sql.includes("INSERT INTO employee_invitations")) return [];
      if (sql.includes("SELECT name FROM organizations")) return [{ name: "Test Org" }];
      if (sql.includes("UPDATE users SET invite_sent_at")) return [];
      return [];
    }) as any;

    const res = await POST(
      makeRequest("POST", {
        firstName: "Invited",
        lastName: "User",
        email: "invited@test.com",
        role: "sales_manager",
        sendInvite: true,
      })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.inviteDelivered).toBe(true);
    expect(body.temporaryPassword).toBeNull();
    expect(EmailService.sendEmployeeInvitation).toHaveBeenCalledOnce();

    // Verify invitation URL contains the app URL
    const callArgs = (EmailService.sendEmployeeInvitation as any).mock.calls[0];
    expect(callArgs[1].inviteUrl).toContain("https://app.example.com/accept-invite?token=");
  });

  it("reports email failure honestly", async () => {
    adminSession();
    mockEmailDelivered = false;
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE LOWER")) return [];
      if (sql.includes("INSERT INTO users")) return [{ id: 52 }];
      if (sql.includes("UPDATE employee_invitations")) return [];
      if (sql.includes("INSERT INTO employee_invitations")) return [];
      if (sql.includes("SELECT name FROM organizations")) return [{ name: "Test Org" }];
      return [];
    }) as any;

    const res = await POST(
      makeRequest("POST", {
        firstName: "Fail",
        lastName: "Email",
        email: "fail@test.com",
        role: "admin",
        sendInvite: true,
      })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.inviteDelivered).toBe(false);
    expect(body.message).toContain("could not be delivered");
    // Temporary password returned as fallback
    expect(body.temporaryPassword).toBeTruthy();
  });

  it("validates reporting manager belongs to same org", async () => {
    adminSession();
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE LOWER")) return [];
      // Manager ownership check — returns empty (not in org)
      if (sql.includes("AND organization_id =") && sql.includes("AND deleted_at IS NULL LIMIT 1"))
        return [];
      return [];
    }) as any;

    const res = await POST(
      makeRequest("POST", {
        firstName: "X",
        lastName: "Y",
        email: "xy@test.com",
        role: "sales_manager",
        reportingManagerId: 999,
      })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.message).toContain("Invalid reporting manager");
  });

  it("prevents duplicate email", async () => {
    adminSession();
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE LOWER")) return [{ id: 1 }];
      return [];
    }) as any;

    const res = await POST(
      makeRequest("POST", {
        firstName: "Dup",
        lastName: "Email",
        email: "existing@test.com",
      })
    );
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/settings/employees — multi-tenant security", () => {
  it("bulkStatus rejects cross-tenant IDs", async () => {
    adminSession(ORG_A);
    mockQueryResults = vi.fn(async (sql: string) => {
      // Ownership check: only id 10 belongs to ORG_A, not 20
      if (sql.includes("SELECT id FROM users WHERE id = ANY"))
        return [{ id: 10 }];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { action: "bulkStatus", ids: [10, 20], isActive: false })
    );
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.message).toContain("not found in your organization");
  });

  it("bulkStatus works for same-org IDs", async () => {
    adminSession(ORG_A);
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE id = ANY"))
        return [{ id: 10 }, { id: 11 }];
      if (sql.includes("UPDATE users SET is_active"))
        return [];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { action: "bulkStatus", ids: [10, 11], isActive: false })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);

    // Verify the UPDATE includes org scoping
    const updateCall = mockQueryCalls.find((c) => c.sql.includes("UPDATE users SET is_active"));
    expect(updateCall?.sql).toContain("organization_id");
  });

  it("setStatus rejects employee from other org", async () => {
    adminSession(ORG_A);
    mockQueryResults = vi.fn(async (sql: string) => {
      // Ownership check fails
      if (sql.includes("AND organization_id =") && sql.includes("LIMIT 1"))
        return [];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { action: "setStatus", id: 20, isActive: false })
    );
    expect(res.status).toBe(404);
  });

  it("resendInvite rejects cross-tenant employee", async () => {
    adminSession(ORG_A);
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("AND organization_id =") && sql.includes("LIMIT 1"))
        return [];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { action: "resendInvite", id: 20 })
    );
    expect(res.status).toBe(404);
  });

  it("resendInvite sends real email for same-org employee", async () => {
    adminSession(ORG_A);
    mockEmailDelivered = true;
    mockQueryResults = vi.fn(async (sql: string) => {
      // Ownership check succeeds
      if (sql.includes("AND organization_id =") && sql.includes("LIMIT 1"))
        return [{ id: 10, organization_id: ORG_A }];
      // Employee details
      if (sql.includes("SELECT email, name, role FROM users"))
        return [{ email: "emp@test.com", name: "Test Emp", role: "sales_manager" }];
      if (sql.includes("UPDATE employee_invitations")) return [];
      if (sql.includes("INSERT INTO employee_invitations")) return [];
      if (sql.includes("SELECT name FROM organizations")) return [{ name: "Org A" }];
      if (sql.includes("UPDATE users SET invite_sent_at")) return [];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { action: "resendInvite", id: 10 })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.inviteDelivered).toBe(true);
    expect(EmailService.sendEmployeeInvitation).toHaveBeenCalled();
  });

  it("resendInvite returns 503 when email delivery fails", async () => {
    adminSession(ORG_A);
    mockEmailDelivered = false;
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("AND organization_id =") && sql.includes("LIMIT 1"))
        return [{ id: 10, organization_id: ORG_A }];
      if (sql.includes("SELECT email, name, role FROM users"))
        return [{ email: "emp@test.com", name: "Test Emp", role: "sales_manager" }];
      if (sql.includes("UPDATE employee_invitations")) return [];
      if (sql.includes("INSERT INTO employee_invitations")) return [];
      if (sql.includes("SELECT name FROM organizations")) return [{ name: "Org A" }];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { action: "resendInvite", id: 10 })
    );
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.success).toBe(false);
  });

  it("employee update rejects cross-tenant modification", async () => {
    adminSession(ORG_A);
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("AND organization_id =") && sql.includes("LIMIT 1"))
        return [];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { id: 20, firstName: "Hacked", lastName: "Name" })
    );
    expect(res.status).toBe(404);
  });

  it("super admin can modify employees across orgs", async () => {
    superAdminSession();
    mockQueryResults = vi.fn(async (sql: string, params: any[]) => {
      // Super admin ownership check — no org filter, just existence
      if (sql.includes("FROM users WHERE id") && sql.includes("deleted_at IS NULL LIMIT 1"))
        return [{ id: 20, organization_id: ORG_B }];
      if (sql.includes("SELECT name FROM users WHERE id"))
        return [{ name: "Old Name" }];
      if (sql.includes("UPDATE users SET"))
        return [];
      return [];
    }) as any;

    const res = await PATCH(
      makeRequest("PATCH", { id: 20, firstName: "Updated", lastName: "Name", email: "u@test.com" })
    );
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/settings/employees — multi-tenant security", () => {
  it("rejects unauthenticated", async () => {
    const res = await DELETE(makeRequest("DELETE", { id: 10 }));
    expect(res.status).toBe(401);
  });

  it("rejects cross-tenant deletion", async () => {
    adminSession(ORG_A);
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("AND organization_id =") && sql.includes("LIMIT 1"))
        return [];
      return [];
    }) as any;

    const res = await DELETE(makeRequest("DELETE", { id: 20 }));
    expect(res.status).toBe(404);
  });

  it("allows same-org deletion", async () => {
    adminSession(ORG_A);
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("AND organization_id =") && sql.includes("LIMIT 1"))
        return [{ id: 10, organization_id: ORG_A }];
      if (sql.includes("UPDATE users SET deleted_at"))
        return [];
      return [];
    }) as any;

    const res = await DELETE(makeRequest("DELETE", { id: 10 }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
  });

  it("requires employee id", async () => {
    adminSession();
    const res = await DELETE(makeRequest("DELETE", {}));
    expect(res.status).toBe(400);
  });
});

describe("Invitation acceptance — accept-invite route", () => {
  // These tests import the accept-invite route
  let acceptGET: any;
  let acceptPOST: any;

  beforeEach(async () => {
    // Re-import to get fresh module with current mocks
    const mod = await import("../accept-invite/route");
    acceptGET = mod.GET;
    acceptPOST = mod.POST;
  });

  it("GET rejects missing token", async () => {
    const req = new Request("http://localhost/api/settings/employees/accept-invite") as any;
    const res = await acceptGET(req);
    expect(res.status).toBe(400);
  });

  it("GET returns 404 for invalid token", async () => {
    mockQueryResults = [];
    const req = new Request(
      "http://localhost/api/settings/employees/accept-invite?token=bogus"
    ) as any;
    const res = await acceptGET(req);
    expect(res.status).toBe(404);
  });

  it("GET returns 410 for consumed invitation", async () => {
    mockQueryResults = vi.fn(async () => [
      {
        id: 1,
        user_id: 50,
        email: "inv@test.com",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        consumed_at: new Date().toISOString(),
        user_name: "Test",
        org_name: "Org",
        role: "admin",
      },
    ]) as any;

    const req = new Request(
      "http://localhost/api/settings/employees/accept-invite?token=used-token"
    ) as any;
    const res = await acceptGET(req);
    expect(res.status).toBe(410);
  });

  it("GET returns 410 for expired invitation", async () => {
    mockQueryResults = vi.fn(async () => [
      {
        id: 1,
        user_id: 50,
        email: "inv@test.com",
        expires_at: new Date(Date.now() - 86400000).toISOString(),
        consumed_at: null,
        user_name: "Test",
        org_name: "Org",
        role: "admin",
      },
    ]) as any;

    const req = new Request(
      "http://localhost/api/settings/employees/accept-invite?token=expired-token"
    ) as any;
    const res = await acceptGET(req);
    expect(res.status).toBe(410);
  });

  it("GET returns invitation details for valid token", async () => {
    mockQueryResults = vi.fn(async () => [
      {
        id: 1,
        user_id: 50,
        email: "inv@test.com",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        consumed_at: null,
        user_name: "New Employee",
        org_name: "Test Org",
        role: "sales_manager",
      },
    ]) as any;

    const req = new Request(
      "http://localhost/api/settings/employees/accept-invite?token=valid-token"
    ) as any;
    const res = await acceptGET(req);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.invitation.name).toBe("New Employee");
    expect(body.invitation.organization).toBe("Test Org");
  });

  it("POST rejects short password", async () => {
    const req = new Request("http://localhost/api/settings/employees/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "valid", password: "short" }),
    }) as any;
    const res = await acceptPOST(req);
    expect(res.status).toBe(400);
  });

  it("POST rejects reused token", async () => {
    mockQueryResults = vi.fn(async () => [
      {
        id: 1,
        user_id: 50,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        consumed_at: new Date().toISOString(),
      },
    ]) as any;

    const req = new Request("http://localhost/api/settings/employees/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "used-token", password: "securepassword123" }),
    }) as any;
    const res = await acceptPOST(req);
    expect(res.status).toBe(410);
  });

  it("POST accepts valid token and sets password", async () => {
    mockQueryCalls = [];
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id, user_id")) {
        return [
          {
            id: 1,
            user_id: 50,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            consumed_at: null,
          },
        ];
      }
      return [];
    }) as any;

    const req = new Request("http://localhost/api/settings/employees/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "valid-token", password: "securepassword123" }),
    }) as any;
    const res = await acceptPOST(req);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);

    // Verify password was set
    const pwUpdate = mockQueryCalls.find((c) => c.sql.includes("UPDATE users SET password"));
    expect(pwUpdate).toBeTruthy();

    // Verify invitation was consumed
    const consume = mockQueryCalls.find((c) => c.sql.includes("UPDATE employee_invitations SET consumed_at"));
    expect(consume).toBeTruthy();
  });
});

describe("SMTP error handling", () => {
  it("invite_sent_at is NOT updated when email fails", async () => {
    adminSession(ORG_A);
    mockEmailDelivered = false;
    mockQueryCalls = [];
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE LOWER")) return [];
      if (sql.includes("INSERT INTO users")) return [{ id: 60 }];
      if (sql.includes("UPDATE employee_invitations")) return [];
      if (sql.includes("INSERT INTO employee_invitations")) return [];
      if (sql.includes("SELECT name FROM organizations")) return [{ name: "Org" }];
      return [];
    }) as any;

    await POST(
      makeRequest("POST", {
        firstName: "No",
        lastName: "Delivery",
        email: "fail@test.com",
        role: "admin",
        sendInvite: true,
      })
    );

    // invite_sent_at should NOT have been updated since delivery failed
    const inviteSentUpdate = mockQueryCalls.find(
      (c) => c.sql.includes("UPDATE users SET invite_sent_at")
    );
    expect(inviteSentUpdate).toBeUndefined();
  });

  it("invite_sent_at IS updated when email succeeds", async () => {
    adminSession(ORG_A);
    mockEmailDelivered = true;
    mockQueryCalls = [];
    mockQueryResults = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE LOWER")) return [];
      if (sql.includes("INSERT INTO users")) return [{ id: 61 }];
      if (sql.includes("UPDATE employee_invitations")) return [];
      if (sql.includes("INSERT INTO employee_invitations")) return [];
      if (sql.includes("SELECT name FROM organizations")) return [{ name: "Org" }];
      if (sql.includes("UPDATE users SET invite_sent_at")) return [];
      return [];
    }) as any;

    await POST(
      makeRequest("POST", {
        firstName: "Yes",
        lastName: "Delivery",
        email: "ok@test.com",
        role: "admin",
        sendInvite: true,
      })
    );

    const inviteSentUpdate = mockQueryCalls.find(
      (c) => c.sql.includes("UPDATE users SET invite_sent_at")
    );
    expect(inviteSentUpdate).toBeTruthy();
  });
});
