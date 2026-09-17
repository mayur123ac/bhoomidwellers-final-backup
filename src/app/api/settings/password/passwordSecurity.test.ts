// @vitest-environment node
//
// Security tests for the multi-step password change flow.
//
// Case A: logged-in user knows current password
//   Step 1: POST /api/settings/password/verify-current
//   Step 2: POST /api/settings/password/verify-otp
//   Step 3: POST /api/settings/password/change
//
// Case B: logged-in user forgot current password
//   Step 1: POST /api/settings/password/recover
//   Step 2: POST /api/settings/password/verify-otp (purpose = self_password_recovery)
//   Step 3: POST /api/settings/password/change      (purpose = self_password_recovery)

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Captured state ──────────────────────────────────────────────────────────

let capturedInsertParams: any[] | null = null;
let emailSentTo: string | null = null;
let emailSentCode: string | null = null;
let mockEmailDelivered = true;
let mockRateOk = true;
let mockRateReason = "cooldown";
let mockCheckOtpResult: any = null;
let mockVerifyPasswordResult = true;
let mockQueryThrows = false;
let mockAuthCheckResult: any = null;
let mockConsumeResult = true;
let mockPasswordChangedEmailCalled = false;

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => ({
    ok: true,
    userId: 42,
    session: { name: "Test User", role: "admin", email: "test@example.com", org: "org-uuid-1" },
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
    sendPasswordChanged: vi.fn(async () => {
      mockPasswordChangedEmailCalled = true;
      return { delivered: true };
    }),
  },
}));

vi.mock("@/lib/passwordReset", () => ({
  SELF_PW_CHANGE_PURPOSE: "self_password_change",
  SELF_PW_RECOVERY_PURPOSE: "self_password_recovery",
  RESET_OTP_TTL_MINUTES: 10,
  generateOtp: vi.fn(() => "654321"),
  hashOtp: vi.fn((otp: string) => `hmac_${otp}`),
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
  verifyPassword: vi.fn(async () => mockVerifyPasswordResult),
  passwordMeetsRules: vi.fn((pw: string) => pw.length >= 8),
}));

vi.mock("@/lib/passwordChangeAuth", () => ({
  AUTH_TTL_MINUTES: 5,
  createPasswordChangeAuth: vi.fn(async () => "auth-token-abc123"),
  checkPasswordChangeAuth: vi.fn(async () => mockAuthCheckResult),
  consumeAuthAndChangePassword: vi.fn(async () => mockConsumeResult),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (mockQueryThrows) throw new Error("DB error");
    // verify-current: load user with password
    if (sql.includes("SELECT") && sql.includes("password") && sql.includes("email")) {
      return [{ password: "stored_hash", email: "user@example.com", name: "Test User" }];
    }
    // recover: load user email/name
    if (sql.includes("SELECT email, name FROM users")) {
      return [{ email: "user@example.com", name: "Test User" }];
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
      query: vi.fn(async () => ({ rows: [{ id: 1 }] })),
    };
    return fn(client);
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url: string, body: any = {}): Request {
  return new Request(url, {
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
  mockRateReason = "cooldown";
  mockCheckOtpResult = null;
  mockVerifyPasswordResult = true;
  mockQueryThrows = false;
  mockAuthCheckResult = null;
  mockConsumeResult = true;
  mockPasswordChangedEmailCalled = false;
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// Case A Step 1: POST /api/settings/password/verify-current
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/password/verify-current", () => {
  let handler: typeof import("./verify-current/route").POST;

  beforeEach(async () => {
    const mod = await import("./verify-current/route");
    handler = mod.POST;
  });

  it("1. correct password sends OTP and succeeds", async () => {
    mockVerifyPasswordResult = true;
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "MyPassword1!",
    }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(emailSentTo).toBe("user@example.com");
  });

  it("2. wrong password rejects with 403, never generates OTP", async () => {
    mockVerifyPasswordResult = false;
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "wrong",
    }) as any);
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(emailSentTo).toBeNull();
    expect(capturedInsertParams).toBeNull();
  });

  it("3. OTP never appears in the API response", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "MyPassword1!",
    }) as any);
    const json = await res.json();
    expect(json).not.toHaveProperty("otp");
    expect(json).not.toHaveProperty("code");
    expect(JSON.stringify(json)).not.toContain("654321");
  });

  it("4. OTP is stored as HMAC hash, not plaintext", async () => {
    await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "MyPassword1!",
    }) as any);
    expect(capturedInsertParams).not.toBeNull();
    expect(capturedInsertParams![2]).toBe("hmac_654321");
    expect(capturedInsertParams![2]).not.toBe("654321");
  });

  it("5. missing currentPassword is rejected", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-current", {}) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it("6. rate limiting is enforced", async () => {
    mockRateOk = false;
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "MyPassword1!",
    }) as any);
    expect(res.status).toBe(429);
  });

  it("7. email delivery failure returns 503, not false success", async () => {
    mockEmailDelivered = false;
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "MyPassword1!",
    }) as any);
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.success).toBe(false);
  });

  it("8. purpose is self_password_change (not recovery)", async () => {
    await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "MyPassword1!",
    }) as any);
    expect(capturedInsertParams).not.toBeNull();
    // purpose is the 5th parameter (index 4)
    expect(capturedInsertParams![4]).toBe("self_password_change");
  });

  it("9. DB error fails closed", async () => {
    mockQueryThrows = true;
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "MyPassword1!",
    }) as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Case B Step 1: POST /api/settings/password/recover
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/password/recover", () => {
  let handler: typeof import("./recover/route").POST;

  beforeEach(async () => {
    const mod = await import("./recover/route");
    handler = mod.POST;
  });

  it("10. sends OTP to canonical email from session, not request body", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/recover", {
      email: "attacker@evil.com", // this must be ignored
    }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(emailSentTo).toBe("user@example.com"); // from DB, not request
  });

  it("11. OTP never appears in the API response", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/recover") as any);
    const json = await res.json();
    expect(json).not.toHaveProperty("otp");
    expect(json).not.toHaveProperty("code");
    expect(JSON.stringify(json)).not.toContain("654321");
  });

  it("12. purpose is self_password_recovery (not change)", async () => {
    await handler(makeReq("http://localhost/api/settings/password/recover") as any);
    expect(capturedInsertParams).not.toBeNull();
    expect(capturedInsertParams![4]).toBe("self_password_recovery");
  });

  it("13. rate limiting is enforced", async () => {
    mockRateOk = false;
    const res = await handler(makeReq("http://localhost/api/settings/password/recover") as any);
    expect(res.status).toBe(429);
  });

  it("14. email delivery failure returns 503", async () => {
    mockEmailDelivered = false;
    const res = await handler(makeReq("http://localhost/api/settings/password/recover") as any);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("15. OTP is stored as HMAC hash", async () => {
    await handler(makeReq("http://localhost/api/settings/password/recover") as any);
    expect(capturedInsertParams![2]).toBe("hmac_654321");
  });

  it("16. DB error fails closed", async () => {
    mockQueryThrows = true;
    const res = await handler(makeReq("http://localhost/api/settings/password/recover") as any);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: POST /api/settings/password/verify-otp
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/password/verify-otp", () => {
  let handler: typeof import("./verify-otp/route").POST;

  beforeEach(async () => {
    const mod = await import("./verify-otp/route");
    handler = mod.POST;
  });

  it("17. correct OTP returns authToken", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42 } };
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
      purpose: "self_password_change",
    }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authToken).toBe("auth-token-abc123");
    expect(json.authExpiresInMinutes).toBe(5);
  });

  it("18. wrong OTP is rejected", async () => {
    mockCheckOtpResult = { ok: false, reason: "mismatch", attemptsRemaining: 4 };
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "000000",
      purpose: "self_password_change",
    }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.attemptsRemaining).toBe(4);
  });

  it("19. expired OTP is rejected", async () => {
    mockCheckOtpResult = { ok: false, reason: "expired", attemptsRemaining: 0 };
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
    }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.restart).toBe(true);
  });

  it("20. locked OTP (too many attempts) is rejected", async () => {
    mockCheckOtpResult = { ok: false, reason: "locked", attemptsRemaining: 0 };
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
    }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.message).toContain("Too many incorrect attempts");
    expect(json.restart).toBe(true);
  });

  it("21. malformed OTP (non-6-digit) is rejected client-side", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "12345",
    }) as any);
    expect(res.status).toBe(400);
  });

  it("22. accepts purpose = self_password_recovery", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 2, user_id: 42 } };
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
      purpose: "self_password_recovery",
    }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authToken).toBeTruthy();
  });

  it("23. rejects invalid purpose", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
      purpose: "password_reset",
    }) as any);
    expect(res.status).toBe(400);
  });

  it("24. cross-purpose attack: password_reset purpose is rejected", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
      purpose: "admin_password_change",
    }) as any);
    expect(res.status).toBe(400);
  });

  it("25. DB error fails closed", async () => {
    const { checkOtpForPurpose } = await import("@/lib/passwordReset");
    (checkOtpForPurpose as any).mockRejectedValueOnce(new Error("DB down"));
    const res = await handler(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
    }) as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 3: POST /api/settings/password/change
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/password/change", () => {
  let handler: typeof import("./change/route").POST;

  beforeEach(async () => {
    const mod = await import("./change/route");
    handler = mod.POST;
  });

  it("26. valid authToken + valid password succeeds", async () => {
    mockAuthCheckResult = { ok: true, row: { id: 1, user_id: 42, purpose: "self_password_change" } };
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token-abc123",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
      purpose: "self_password_change",
    }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.reauthRequired).toBe(true);
  });

  it("27. missing authToken is rejected", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    expect(res.status).toBe(400);
  });

  it("28. invalid authToken is rejected", async () => {
    mockAuthCheckResult = { ok: false, reason: "invalid" };
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "bad-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("Invalid authorization");
  });

  it("29. expired authToken is rejected", async () => {
    mockAuthCheckResult = { ok: false, reason: "expired" };
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "expired-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("expired");
  });

  it("30. consumed authToken is rejected (replay attack)", async () => {
    mockAuthCheckResult = { ok: false, reason: "consumed" };
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "used-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("already been used");
  });

  it("31. passwords must match", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "Different!Pass1",
    }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("do not match");
  });

  it("32. weak password is rejected", async () => {
    const { passwordMeetsRules } = await import("@/lib/passwords");
    (passwordMeetsRules as any).mockReturnValueOnce(false);
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "weak",
      confirmPassword: "weak",
    }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("Password must be");
  });

  it("33. concurrent consumption race returns error", async () => {
    mockAuthCheckResult = { ok: true, row: { id: 1, user_id: 42, purpose: "self_password_change" } };
    mockConsumeResult = false; // another request consumed it first
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("34. recovery purpose works and returns recovery message", async () => {
    mockAuthCheckResult = { ok: true, row: { id: 1, user_id: 42, purpose: "self_password_recovery" } };
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
      purpose: "self_password_recovery",
    }) as any);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toContain("recovery");
  });

  it("35. invalid purpose is rejected", async () => {
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
      purpose: "password_reset",
    }) as any);
    expect(res.status).toBe(400);
  });

  it("36. security notification email is sent on success", async () => {
    mockAuthCheckResult = { ok: true, row: { id: 1, user_id: 42, purpose: "self_password_change" } };
    await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    const { EmailService } = await import("@/lib/email/EmailService");
    expect(EmailService.sendPasswordChanged).toHaveBeenCalled();
  });

  it("37. DB error fails closed", async () => {
    const { checkPasswordChangeAuth } = await import("@/lib/passwordChangeAuth");
    (checkPasswordChangeAuth as any).mockRejectedValueOnce(new Error("DB down"));
    const res = await handler(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-purpose isolation tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Cross-purpose isolation", () => {
  it("38. verify-otp rejects email_change purpose", async () => {
    const { POST } = await import("./verify-otp/route");
    const res = await POST(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
      purpose: "email_change",
    }) as any);
    expect(res.status).toBe(400);
  });

  it("39. verify-otp rejects email_verification purpose", async () => {
    const { POST } = await import("./verify-otp/route");
    const res = await POST(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
      purpose: "email_verification",
    }) as any);
    expect(res.status).toBe(400);
  });

  it("40. change rejects email_change purpose", async () => {
    const { POST } = await import("./change/route");
    const res = await POST(makeReq("http://localhost/api/settings/password/change", {
      authToken: "auth-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
      purpose: "email_change",
    }) as any);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Old endpoint deprecation
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/settings/password (deprecated)", () => {
  it("41. returns 410 Gone", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    const json = await res.json();
    expect(res.status).toBe(410);
    expect(json.success).toBe(false);
    expect(json.message).toContain("retired");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit logging
// ═══════════════════════════════════════════════════════════════════════════

describe("Audit logging", () => {
  it("42. failed current password is audit-logged", async () => {
    mockVerifyPasswordResult = false;
    const { POST } = await import("./verify-current/route");
    await POST(makeReq("http://localhost/api/settings/password/verify-current", {
      currentPassword: "wrong",
    }) as any);
    const { writeAuditLog } = await import("@/lib/auditLog");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "self_password_change.current_password_failed",
      })
    );
  });

  it("43. failed OTP verification is audit-logged", async () => {
    mockCheckOtpResult = { ok: false, reason: "mismatch", attemptsRemaining: 4 };
    const { POST } = await import("./verify-otp/route");
    await POST(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "000000",
    }) as any);
    const { writeAuditLog } = await import("@/lib/auditLog");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "self_password_change.otp_failed",
      })
    );
  });

  it("44. successful OTP verification is audit-logged", async () => {
    mockCheckOtpResult = { ok: true, row: { id: 1, user_id: 42 } };
    const { POST } = await import("./verify-otp/route");
    await POST(makeReq("http://localhost/api/settings/password/verify-otp", {
      otp: "654321",
    }) as any);
    const { writeAuditLog } = await import("@/lib/auditLog");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "self_password_change.otp_verified",
      })
    );
  });

  it("45. failed auth token is audit-logged", async () => {
    mockAuthCheckResult = { ok: false, reason: "invalid" };
    const { POST } = await import("./change/route");
    await POST(makeReq("http://localhost/api/settings/password/change", {
      authToken: "bad-token",
      newPassword: "NewStr0ng!Pass",
      confirmPassword: "NewStr0ng!Pass",
    }) as any);
    const { writeAuditLog } = await import("@/lib/auditLog");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "self_password_change.auth_failed",
      })
    );
  });
});
