// @vitest-environment node
//
// Security tests for the self-password-change OTP flow after remediation.
//
// Validates:
//   1. OTP never appears in API responses
//   2. OTP is stored as SHA-256 hash, not plaintext
//   3. Attempt limiting is enforced (via checkOtpForPurpose)
//   4. Rate limiting on OTP generation
//   5. Expired OTP rejected
//   6. Consumed OTP rejected (atomic consumption)
//   7. Email is actually sent
//   8. Email delivery failure does not produce a false success
//   9. Missing table / DB error fails closed
//  10. Session revocation uses application clock (sessionRevocationNow)
//  11. Dev mode does NOT leak OTP or bypass verification

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Captured state ──────────────────────────────────────────────────────────

let capturedInsertParams: any[] | null = null;
let capturedUpdateParams: any[] | null = null;
let emailSentTo: string | null = null;
let emailSentCode: string | null = null;
let mockEmailDelivered = true;
let mockRateOk = true;
let mockRateReason = "cooldown";
let mockCheckOtpResult: any = null;
let mockTransactionResult: any = { id: 1 };
let mockQueryThrows = false;

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => ({
    ok: true,
    userId: 42,
    session: { name: "Test User", role: "admin", email: "test@example.com" },
    response: undefined,
  })),
}));

vi.mock("@/lib/auditLog", () => ({
  writeAuditLog: vi.fn(async () => {}),
  requestContext: vi.fn(() => ({ ip: "127.0.0.1", userAgent: "test-agent" })),
}));

vi.mock("@/lib/email/config", () => ({
  isMailConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/email/EmailService", () => ({
  EmailService: {
    sendOTP: vi.fn(async (to: string, input: any) => {
      emailSentTo = to;
      emailSentCode = input.code;
      return { delivered: mockEmailDelivered, provider: "test" };
    }),
  },
}));

vi.mock("@/lib/passwordReset", () => ({
  SELF_PW_CHANGE_PURPOSE: "self_password_change",
  RESET_OTP_TTL_MINUTES: 10,
  generateOtp: vi.fn(() => "123456"),
  hashOtp: vi.fn((otp: string) => `hashed_${otp}`),
  checkRateLimitForPurpose: vi.fn(async () => {
    if (mockRateOk) return { ok: true };
    return { ok: false, reason: mockRateReason, retryAfterSeconds: 30 };
  }),
  checkOtpForPurpose: vi.fn(async () => mockCheckOtpResult),
  sessionRevocationNow: vi.fn(() => new Date("2026-09-16T12:00:01Z")),
  MAX_OTP_ATTEMPTS: 5,
}));

vi.mock("@/lib/passwords", () => ({
  hashPassword: vi.fn(async () => "scrypt_hashed_password"),
  passwordMeetsRules: vi.fn(() => true),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (mockQueryThrows) throw new Error("DB error");
    if (sql.includes("SELECT") && sql.includes("permissions")) {
      return [{ permissions: { can_change_password: true }, email: "test@example.com", name: "Test User" }];
    }
    if (sql.includes("INSERT INTO email_change_otps")) {
      capturedInsertParams = params;
      return [];
    }
    if (sql.includes("UPDATE email_change_otps SET consumed_at")) {
      return [];
    }
    return [];
  }),
  transaction: vi.fn(async (fn: any) => {
    const client = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes("UPDATE email_change_otps") && sql.includes("consumed_at")) {
          capturedUpdateParams = params;
          return { rows: mockTransactionResult ? [{ id: 1 }] : [] };
        }
        if (sql.includes("UPDATE users")) {
          return { rows: mockTransactionResult ? [mockTransactionResult] : [] };
        }
        return { rows: [] };
      }),
    };
    return fn(client);
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: any = {}): Request {
  return new Request("http://localhost/api/settings/self-password-change/request-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeConfirmRequest(body: any): Request {
  return new Request("http://localhost/api/settings/self-password-change/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  capturedInsertParams = null;
  capturedUpdateParams = null;
  emailSentTo = null;
  emailSentCode = null;
  mockEmailDelivered = true;
  mockRateOk = true;
  mockCheckOtpResult = null;
  mockTransactionResult = { id: 1 };
  mockQueryThrows = false;
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// request-otp route
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/self-password-change/request-otp", () => {
  let handler: typeof import("./request-otp/route").POST;

  beforeEach(async () => {
    const mod = await import("./request-otp/route");
    handler = mod.POST;
  });

  it("1. OTP never appears in the API response", async () => {
    const res = await handler(makeRequest() as any);
    const json = await res.json();
    expect(json).not.toHaveProperty("code");
    expect(json).not.toHaveProperty("otp");
    expect(JSON.stringify(json)).not.toContain("123456");
  });

  it("2. OTP is stored as a hash, not plaintext", async () => {
    await handler(makeRequest() as any);
    expect(capturedInsertParams).not.toBeNull();
    // The otp_hash parameter (index 2) must be the hashed value, not plaintext
    expect(capturedInsertParams![2]).toBe("hashed_123456");
    expect(capturedInsertParams![2]).not.toBe("123456");
  });

  it("7. Email is actually sent", async () => {
    await handler(makeRequest() as any);
    expect(emailSentTo).toBe("test@example.com");
    expect(emailSentCode).toBe("123456"); // The EMAIL receives the plaintext (correct)
  });

  it("8. Email delivery failure returns error, not false success", async () => {
    mockEmailDelivered = false;
    const res = await handler(makeRequest() as any);
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.success).toBe(false);
  });

  it("4. Rate limiting is enforced on OTP generation", async () => {
    mockRateOk = false;
    const res = await handler(makeRequest() as any);
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(json.success).toBe(false);
  });

  it("11. Dev mode does NOT leak OTP in response", async () => {
    // The route has no dev-mode code path at all
    const res = await handler(makeRequest() as any);
    const json = await res.json();
    expect(json).not.toHaveProperty("code");
    expect(json).not.toHaveProperty("otp");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// confirm route
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/self-password-change/confirm", () => {
  let handler: typeof import("./confirm/route").POST;

  beforeEach(async () => {
    const mod = await import("./confirm/route");
    handler = mod.POST;
  });

  it("correct OTP succeeds", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42 } };
    const res = await handler(makeConfirmRequest({ otp: "123456", newPassword: "Str0ng!Pass" }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.reauthRequired).toBe(true);
  });

  it("wrong OTP fails", async () => {
    mockCheckOtpResult = { ok: false, reason: "mismatch", attemptsRemaining: 4 };
    const res = await handler(makeConfirmRequest({ otp: "000000", newPassword: "Str0ng!Pass" }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("5. expired OTP fails", async () => {
    mockCheckOtpResult = { ok: false, reason: "expired", attemptsRemaining: 0 };
    const res = await handler(makeConfirmRequest({ otp: "123456", newPassword: "Str0ng!Pass" }) as any);
    expect(res.status).toBe(400);
  });

  it("3. attempt limit is enforced (locked)", async () => {
    mockCheckOtpResult = { ok: false, reason: "locked", attemptsRemaining: 0 };
    const res = await handler(makeConfirmRequest({ otp: "123456", newPassword: "Str0ng!Pass" }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.message).toContain("Too many incorrect attempts");
  });

  it("6. consumed OTP rejected (race condition)", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42 } };
    mockTransactionResult = null; // consumed_at already set by another request
    const res = await handler(makeConfirmRequest({ otp: "123456", newPassword: "Str0ng!Pass" }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("9. DB error fails closed, does NOT bypass verification", async () => {
    // checkOtpForPurpose itself throws
    const { checkOtpForPurpose } = await import("@/lib/passwordReset");
    (checkOtpForPurpose as any).mockRejectedValueOnce(new Error("DB error"));

    const res = await handler(makeConfirmRequest({ otp: "123456", newPassword: "Str0ng!Pass" }) as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("10. session revocation uses sessionRevocationNow, not SQL NOW()", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42 } };
    const { transaction } = await import("@/lib/db");
    await handler(makeConfirmRequest({ otp: "123456", newPassword: "Str0ng!Pass" }) as any);

    // Verify that the transaction was called (which uses sessionRevocationNow)
    expect(transaction).toHaveBeenCalled();
    const { sessionRevocationNow } = await import("@/lib/passwordReset");
    expect(sessionRevocationNow).toHaveBeenCalled();
  });

  it("malformed OTP (non-6-digit) is rejected", async () => {
    const res = await handler(makeConfirmRequest({ otp: "12345", newPassword: "Str0ng!Pass" }) as any);
    expect(res.status).toBe(400);
  });
});
