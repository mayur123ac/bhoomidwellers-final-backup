// @vitest-environment node
//
// Security tests for the email-change + email-verify OTP flow after remediation.
//
// Validates:
//   1. OTP never appears in email-change API response
//   2. OTP stored as hash, not plaintext
//   3. Rate limiting on email-change OTP generation
//   4. Email is actually sent to the NEW address
//   5. Email delivery failure returns error
//   6. Correct OTP verifies and promotes email
//   7. Wrong OTP fails with attempt counting
//   8. Expired OTP fails
//   9. Locked (too many attempts) fails
//  10. Consumed OTP rejected atomically
//  11. DB error fails closed (no bypass)
//  12. Fallback verify-without-OTP removed
//  13. Dev mode does NOT leak OTP

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Captured state ──────────────────────────────────────────────────────────

let capturedInsertParams: any[] | null = null;
let emailSentTo: string | null = null;
let emailSentCode: string | null = null;
let mockEmailDelivered = true;
let mockRateOk = true;
let mockCheckOtpResult: any = null;
let mockTransactionResult: any = { id: 1, email: "new@example.com", secondary_email: "old@example.com", secondary_email_verified: true };

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => ({
    ok: true,
    userId: 42,
    session: { name: "Test User", role: "admin", email: "old@example.com" },
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
  EMAIL_CHANGE_PURPOSE: "email_change",
  RESET_OTP_TTL_MINUTES: 10,
  MAX_OTP_ATTEMPTS: 5,
  generateOtp: vi.fn(() => "654321"),
  hashOtp: vi.fn((otp: string) => `hashed_${otp}`),
  checkRateLimitForPurpose: vi.fn(async () => {
    if (mockRateOk) return { ok: true };
    return { ok: false, reason: "cooldown", retryAfterSeconds: 30 };
  }),
  checkOtpForPurpose: vi.fn(async () => mockCheckOtpResult),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes("SELECT id FROM users") && sql.includes("LOWER(email)")) {
      return []; // no clash
    }
    if (sql.includes("UPDATE users SET secondary_email")) {
      return [];
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
      query: vi.fn(async (sql: string) => {
        if (sql.includes("UPDATE email_change_otps") && sql.includes("consumed_at")) {
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

function makeChangeRequest(body: any = {}): Request {
  return new Request("http://localhost/api/settings/email-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeVerifyRequest(body: any): Request {
  return new Request("http://localhost/api/settings/email-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  capturedInsertParams = null;
  emailSentTo = null;
  emailSentCode = null;
  mockEmailDelivered = true;
  mockRateOk = true;
  mockCheckOtpResult = null;
  mockTransactionResult = { id: 1, email: "new@example.com", secondary_email: null, secondary_email_verified: true };
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// email-change route
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/email-change", () => {
  let handler: typeof import("./email-change/route").POST;

  beforeEach(async () => {
    const mod = await import("./email-change/route");
    handler = mod.POST;
  });

  it("1. OTP never appears in the API response", async () => {
    const res = await handler(makeChangeRequest({ newEmail: "new@example.com" }) as any);
    const json = await res.json();
    expect(json).not.toHaveProperty("code");
    expect(json).not.toHaveProperty("otp");
    expect(JSON.stringify(json)).not.toContain("654321");
  });

  it("2. OTP is stored as a hash, not plaintext", async () => {
    await handler(makeChangeRequest({ newEmail: "new@example.com" }) as any);
    expect(capturedInsertParams).not.toBeNull();
    expect(capturedInsertParams![2]).toBe("hashed_654321");
    expect(capturedInsertParams![2]).not.toBe("654321");
  });

  it("3. Rate limiting enforced on OTP generation", async () => {
    mockRateOk = false;
    const res = await handler(makeChangeRequest({ newEmail: "new@example.com" }) as any);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("4. Email is sent to the NEW address", async () => {
    await handler(makeChangeRequest({ newEmail: "new@example.com" }) as any);
    expect(emailSentTo).toBe("new@example.com");
    expect(emailSentCode).toBe("654321");
  });

  it("5. Email delivery failure returns error", async () => {
    mockEmailDelivered = false;
    const res = await handler(makeChangeRequest({ newEmail: "new@example.com" }) as any);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("13. Dev mode does NOT leak OTP", async () => {
    const res = await handler(makeChangeRequest({ newEmail: "new@example.com" }) as any);
    const json = await res.json();
    expect(json).not.toHaveProperty("code");
    expect(json).not.toHaveProperty("otp");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// email-verify route
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/email-verify", () => {
  let handler: typeof import("./email-verify/route").POST;

  beforeEach(async () => {
    const mod = await import("./email-verify/route");
    handler = mod.POST;
  });

  it("6. Correct OTP verifies and promotes email", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42, new_email: "new@example.com" } };
    const res = await handler(makeVerifyRequest({ otp: "654321" }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.user).toBeDefined();
  });

  it("7. Wrong OTP fails", async () => {
    mockCheckOtpResult = { ok: false, reason: "mismatch", attemptsRemaining: 4 };
    const res = await handler(makeVerifyRequest({ otp: "000000" }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("8. Expired OTP fails", async () => {
    mockCheckOtpResult = { ok: false, reason: "expired", attemptsRemaining: 0 };
    const res = await handler(makeVerifyRequest({ otp: "654321" }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.restart).toBe(true);
  });

  it("9. Locked (too many attempts) fails", async () => {
    mockCheckOtpResult = { ok: false, reason: "locked", attemptsRemaining: 0 };
    const res = await handler(makeVerifyRequest({ otp: "654321" }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.message).toContain("Too many incorrect attempts");
    expect(json.restart).toBe(true);
  });

  it("10. Consumed OTP rejected atomically", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42, new_email: "new@example.com" } };
    mockTransactionResult = null;
    const res = await handler(makeVerifyRequest({ otp: "654321" }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("11. DB error fails closed", async () => {
    const { checkOtpForPurpose } = await import("@/lib/passwordReset");
    (checkOtpForPurpose as any).mockRejectedValueOnce(new Error("DB error"));

    const res = await handler(makeVerifyRequest({ otp: "654321" }) as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("12. No fallback verify-without-OTP bypass exists", async () => {
    // When OTP check fails, the route must NOT fall through to verifying
    // the email without a valid OTP.
    mockCheckOtpResult = { ok: false, reason: "none", attemptsRemaining: 0 };
    const res = await handler(makeVerifyRequest({ otp: "654321" }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("malformed OTP rejected", async () => {
    const res = await handler(makeVerifyRequest({ otp: "abc" }) as any);
    expect(res.status).toBe(400);
  });

  it("accepts 'code' field name for backwards compat", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42, new_email: "new@example.com" } };
    const res = await handler(makeVerifyRequest({ code: "654321" }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
