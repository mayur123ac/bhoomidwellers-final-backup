// @vitest-environment node
//
// Tests for the mandatory-location login flow.
//
// These are pure unit tests: they import the route handler directly and call it
// with crafted Request objects, WITHOUT a real database. The db module is mocked
// to return canned rows, so the tests verify the request-level contract:
//
//   * Location must be present and valid
//   * Missing/invalid coordinates are rejected before credentials are checked
//   * Valid location + valid credentials → 200
//   * Email failures do not corrupt authentication
//
// Integration tests that hit a real Postgres belong in a separate file gated
// on a database URL environment variable, like platformSecurity.integration.test.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock the database module
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock session signing
vi.mock("@/lib/sessionCookie", () => ({
  signSession: vi.fn(async () => "mock-session-value"),
  isSessionSigningConfigured: vi.fn(() => true),
}));

// Mock password verification
vi.mock("@/lib/passwords", () => ({
  verifyPassword: vi.fn(async (plain: string, stored: string) => plain === stored),
  isHashed: vi.fn(() => false),
  needsRehash: vi.fn(() => false),
}));

// Mock audit log
vi.mock("@/lib/auditLog", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

// Mock login notification (fire-and-forget)
vi.mock("@/lib/loginNotification", () => ({
  notifyLogin: vi.fn(async () => {}),
  handleFailedLogin: vi.fn(async () => {}),
}));

// Mock login security
vi.mock("@/lib/loginSecurity", () => ({
  clearFailedLogins: vi.fn(async () => {}),
}));

// Mock settings user
vi.mock("@/lib/settingsUser", () => ({
  avatarSrc: vi.fn(() => null),
}));

// Mock next/headers for cookies (needed by tenantContext)
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
  headers: async () => new Headers(),
}));

import { query } from "@/lib/db";
const mockQuery = vi.mocked(query);

// ── Helper ─────────────────────────────────────────────────────────────────

function loginRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_USER = {
  id: 1,
  name: "Test User",
  email: "test@example.com",
  password: "correct-password",
  is_active: true,
  organization_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  role: "Admin",
  theme_preference: null,
  avatar_key: null,
  avatar_url: null,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Login location validation", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: user lookup returns VALID_USER, session insert returns id
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("FROM users")) return [VALID_USER];
      if (s.includes("INSERT INTO employee_sessions")) return [{ id: 99 }];
      if (s.includes("UPDATE users")) return [];
      if (s.includes("INSERT INTO audit_logs")) return [];
      if (s.includes("FROM organizations")) return [{ status: "active" }];
      return [];
    });

    // Dynamic import to pick up fresh mocks each time
    const mod = await import("./route");
    POST = mod.POST;
  });

  // ── Missing location ─────────────────────────────────────────────────

  it("rejects login when latitude is missing", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", longitude: 72.8 })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("Location access is required");
  });

  it("rejects login when longitude is missing", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 19.0 })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("Location access is required");
  });

  it("rejects login when both coordinates are missing", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("Location access is required");
  });

  // ── Invalid coordinates ──────────────────────────────────────────────

  it("rejects login when latitude is out of range (> 90)", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 91, longitude: 72.8 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects login when latitude is out of range (< -90)", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: -91, longitude: 72.8 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects login when longitude is out of range (> 180)", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 19.0, longitude: 181 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects login when longitude is out of range (< -180)", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 19.0, longitude: -181 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects login when latitude is NaN", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: NaN, longitude: 72.8 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects login when latitude is Infinity", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: Infinity, longitude: 72.8 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects login when coordinates are strings", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: "19.0", longitude: "72.8" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects login when coordinates are null", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: null, longitude: null })
    );
    expect(res.status).toBe(400);
  });

  // ── Valid location ───────────────────────────────────────────────────

  it("accepts login with valid location and correct credentials", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 19.076, longitude: 72.8777 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Login successful.");
    expect(body.user.email).toBe("test@example.com");
  });

  it("accepts edge-case coordinates (0, 0)", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 0, longitude: 0 })
    );
    expect(res.status).toBe(200);
  });

  it("accepts boundary coordinates (-90, -180)", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: -90, longitude: -180 })
    );
    expect(res.status).toBe(200);
  });

  it("accepts boundary coordinates (90, 180)", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 90, longitude: 180 })
    );
    expect(res.status).toBe(200);
  });

  // ── Credentials still enforced ──────────────────────────────────────

  it("rejects invalid credentials even with valid location", async () => {
    const res = await POST(
      loginRequest({ identifier: "test@example.com", password: "wrong-password", latitude: 19.076, longitude: 72.8777 })
    );
    expect(res.status).toBe(401);
  });

  it("rejects unknown user even with valid location", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM users")) return [];
      return [];
    });

    const res = await POST(
      loginRequest({ identifier: "nobody@example.com", password: "test", latitude: 19.076, longitude: 72.8777 })
    );
    expect(res.status).toBe(401);
  });

  // ── Location stored in session ──────────────────────────────────────

  it("passes coordinates to the employee_sessions INSERT", async () => {
    await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 19.076, longitude: 72.8777 })
    );

    // Find the INSERT INTO employee_sessions call
    const sessionCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("INSERT INTO employee_sessions")
    );
    expect(sessionCall).toBeDefined();
    const params = sessionCall![1] as unknown[];
    // latitude is $6, longitude is $7 (0-indexed: 5, 6)
    expect(params[5]).toBe(19.076);
    expect(params[6]).toBe(72.8777);
  });

  // ── Audit log records coordinates ───────────────────────────────────

  it("records coordinates in the audit log", async () => {
    const { writeAuditLog } = await import("@/lib/auditLog");
    const mockAudit = vi.mocked(writeAuditLog);

    await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 19.076, longitude: 72.8777 })
    );

    const loginAudit = mockAudit.mock.calls.find(
      (call) => call[0].action === "login"
    );
    expect(loginAudit).toBeDefined();
    expect((loginAudit![0].newValue as any).latitude).toBe(19.076);
    expect((loginAudit![0].newValue as any).longitude).toBe(72.8777);
  });

  // ── Notification receives coordinates ───────────────────────────────

  it("passes coordinates to notifyLogin", async () => {
    const { notifyLogin } = await import("@/lib/loginNotification");
    const mockNotify = vi.mocked(notifyLogin);

    await POST(
      loginRequest({ identifier: "test@example.com", password: "correct-password", latitude: 19.076, longitude: 72.8777 })
    );

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 19.076,
        longitude: 72.8777,
      })
    );
  });

  // ── Location check comes before credential check ────────────────────

  it("rejects missing location without querying the database", async () => {
    mockQuery.mockClear();

    await POST(
      loginRequest({ identifier: "test@example.com", password: "test" })
    );

    // No database queries should have been made
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
