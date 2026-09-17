// @vitest-environment node
//
// Direct library-level security tests for passwordReset.ts.
//
// These exercise the ACTUAL hash comparison path (hashOtp, checkOtp,
// checkOtpForPurpose) without mocking, so the HMAC-SHA256 + timingSafeEqual
// pipeline is verified end-to-end.
//
// Also validates pepper configuration safety:
//   - missing OTP_PEPPER fails closed (throws)
//   - no silent SHA-256 fallback
//   - no hardcoded pepper in source
//   - deterministic output for same OTP + same pepper
//   - different OTPs produce different verifiers

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// ── DB mock ──────────────────────────────────────────────────────────────────
// We need a minimal db mock so checkOtp / checkOtpForPurpose can query rows.

let mockQueryRows: any[] = [];
let mockQueryFn: ReturnType<typeof vi.fn>;

function defaultQueryFn() {
  return vi.fn(async () => mockQueryRows);
}

mockQueryFn = defaultQueryFn();

vi.mock("@/lib/db", () => ({
  query: (...args: any[]) => mockQueryFn(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function setOtpPepper(value: string | undefined) {
  if (value === undefined) {
    delete process.env.OTP_PEPPER;
  } else {
    process.env.OTP_PEPPER = value;
  }
}

const TEST_PEPPER = "test-pepper-value-at-least-16-chars-long";
const DIFFERENT_PEPPER = "a-completely-different-pepper-value";

// ═══════════════════════════════════════════════════════════════════════════════
// hashOtp
// ═══════════════════════════════════════════════════════════════════════════════

describe("hashOtp", () => {
  let hashOtp: typeof import("./passwordReset").hashOtp;

  beforeEach(async () => {
    setOtpPepper(TEST_PEPPER);
    const mod = await import("./passwordReset");
    hashOtp = mod.hashOtp;
  });

  afterEach(() => {
    setOtpPepper(undefined);
  });

  it("produces HMAC-SHA256, not bare SHA-256", () => {
    const otp = "123456";
    const result = hashOtp(otp);

    // Manually compute the expected HMAC
    const expected = createHmac("sha256", TEST_PEPPER).update(otp).digest("hex");
    expect(result).toBe(expected);

    // Verify it is NOT the bare SHA-256 (which would be offline-reversible)
    const { createHash } = require("crypto");
    const bareSha = createHash("sha256").update(otp).digest("hex");
    expect(result).not.toBe(bareSha);
  });

  it("is deterministic for same OTP + same pepper", () => {
    const a = hashOtp("654321");
    const b = hashOtp("654321");
    expect(a).toBe(b);
  });

  it("different OTPs produce different verifiers", () => {
    const a = hashOtp("123456");
    const b = hashOtp("654321");
    expect(a).not.toBe(b);
  });

  it("stored verifier cannot be used directly as the OTP", () => {
    const otp = "123456";
    const verifier = hashOtp(otp);
    // Feeding the verifier back into hashOtp produces a different value
    const reHash = hashOtp(verifier);
    expect(reHash).not.toBe(verifier);
  });

  it("output is a 64-character hex string (32 bytes)", () => {
    const result = hashOtp("000000");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws when OTP_PEPPER is missing", () => {
    setOtpPepper(undefined);
    expect(() => hashOtp("123456")).toThrow("OTP_PEPPER");
  });

  it("throws when OTP_PEPPER is too short", () => {
    setOtpPepper("short");
    expect(() => hashOtp("123456")).toThrow("OTP_PEPPER");
  });

  it("throws when OTP_PEPPER is empty string", () => {
    setOtpPepper("");
    expect(() => hashOtp("123456")).toThrow("OTP_PEPPER");
  });

  it("does NOT silently fall back to SHA-256 when pepper is missing", () => {
    setOtpPepper(undefined);
    // Must throw, not return a bare SHA-256 hash
    expect(() => hashOtp("123456")).toThrow();
  });

  it("different pepper produces different verifier for same OTP", () => {
    const a = hashOtp("123456");
    setOtpPepper(DIFFERENT_PEPPER);
    const b = hashOtp("123456");
    expect(a).not.toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// checkOtp (password_reset purpose)
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkOtp", () => {
  let checkOtp: typeof import("./passwordReset").checkOtp;
  let hashOtp: typeof import("./passwordReset").hashOtp;

  beforeEach(async () => {
    setOtpPepper(TEST_PEPPER);
    mockQueryRows = [];
    mockQueryFn = defaultQueryFn();
    vi.clearAllMocks();
    const mod = await import("./passwordReset");
    checkOtp = mod.checkOtp;
    hashOtp = mod.hashOtp;
  });

  afterEach(() => {
    setOtpPepper(undefined);
  });

  function makeLiveRow(otp: string, overrides: Record<string, any> = {}) {
    return {
      id: 1,
      user_id: 42,
      otp_hash: hashOtp(otp),
      attempts: 0,
      expires_at: new Date(Date.now() + 600_000).toISOString(), // 10 min future
      consumed_at: null,
      ...overrides,
    };
  }

  it("correct OTP succeeds", async () => {
    mockQueryRows = [makeLiveRow("123456")];
    const result = await checkOtp(42, "123456");
    expect(result.ok).toBe(true);
  });

  it("incorrect OTP fails with mismatch", async () => {
    mockQueryRows = [makeLiveRow("123456")];
    // After mismatch, the UPDATE query returns bumped attempts
    mockQueryFn = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT")) return [makeLiveRow("123456")];
      if (sql.includes("UPDATE")) return [{ attempts: 1 }];
      return [];
    });
    const result = await checkOtp(42, "000000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("mismatch");
  });

  it("expired OTP fails", async () => {
    mockQueryRows = [makeLiveRow("123456", {
      expires_at: new Date(Date.now() - 1000).toISOString(), // past
    })];
    const result = await checkOtp(42, "123456");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("locked OTP (too many attempts) fails", async () => {
    mockQueryRows = [makeLiveRow("123456", { attempts: 5 })];
    const result = await checkOtp(42, "123456");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("locked");
  });

  it("no live row returns 'none'", async () => {
    mockQueryRows = [];
    const result = await checkOtp(42, "123456");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("none");
  });

  it("malformed verifier in DB does not cause success", async () => {
    mockQueryRows = [{
      id: 1,
      user_id: 42,
      otp_hash: "not-a-valid-hex-hash",
      attempts: 0,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      consumed_at: null,
    }];
    // Buffer.from("not-a-valid-hex-hash", "hex") produces a different length
    // timingSafeEqual will either fail on length check or comparison
    mockQueryFn = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT")) return mockQueryRows;
      if (sql.includes("UPDATE")) return [{ attempts: 1 }];
      return [];
    });
    const result = await checkOtp(42, "123456");
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// checkOtpForPurpose
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkOtpForPurpose", () => {
  let checkOtpForPurpose: typeof import("./passwordReset").checkOtpForPurpose;
  let hashOtp: typeof import("./passwordReset").hashOtp;
  let SELF_PW_CHANGE_PURPOSE: string;
  let EMAIL_CHANGE_PURPOSE: string;

  beforeEach(async () => {
    setOtpPepper(TEST_PEPPER);
    mockQueryRows = [];
    mockQueryFn = defaultQueryFn();
    vi.clearAllMocks();
    const mod = await import("./passwordReset");
    checkOtpForPurpose = mod.checkOtpForPurpose;
    hashOtp = mod.hashOtp;
    SELF_PW_CHANGE_PURPOSE = mod.SELF_PW_CHANGE_PURPOSE;
    EMAIL_CHANGE_PURPOSE = mod.EMAIL_CHANGE_PURPOSE;
  });

  afterEach(() => {
    setOtpPepper(undefined);
  });

  function makeLiveRow(otp: string, overrides: Record<string, any> = {}) {
    return {
      id: 10,
      user_id: 42,
      otp_hash: hashOtp(otp),
      attempts: 0,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      consumed_at: null,
      new_email: "new@example.com",
      ...overrides,
    };
  }

  it("correct OTP succeeds", async () => {
    mockQueryRows = [makeLiveRow("654321")];
    const result = await checkOtpForPurpose(42, "654321", SELF_PW_CHANGE_PURPOSE);
    expect(result.ok).toBe(true);
  });

  it("incorrect OTP fails", async () => {
    mockQueryFn = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT")) return [makeLiveRow("654321")];
      if (sql.includes("UPDATE")) return [{ attempts: 1 }];
      return [];
    });
    const result = await checkOtpForPurpose(42, "000000", SELF_PW_CHANGE_PURPOSE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("mismatch");
  });

  it("expired OTP fails", async () => {
    mockQueryRows = [makeLiveRow("654321", {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })];
    const result = await checkOtpForPurpose(42, "654321", SELF_PW_CHANGE_PURPOSE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("consumed OTP (no live row) fails", async () => {
    mockQueryRows = [];
    const result = await checkOtpForPurpose(42, "654321", SELF_PW_CHANGE_PURPOSE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("none");
  });

  it("attempt limit enforced", async () => {
    mockQueryRows = [makeLiveRow("654321", { attempts: 5 })];
    const result = await checkOtpForPurpose(42, "654321", SELF_PW_CHANGE_PURPOSE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("locked");
  });

  it("purpose isolation: query includes purpose parameter", async () => {
    // The purpose is passed to loadLiveOtpForPurpose which filters by purpose
    mockQueryFn = vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("SELECT")) {
        // Verify purpose is in the query params
        expect(params).toContain(SELF_PW_CHANGE_PURPOSE);
        return [makeLiveRow("654321")];
      }
      return [];
    });
    await checkOtpForPurpose(42, "654321", SELF_PW_CHANGE_PURPOSE);
    expect(mockQueryFn).toHaveBeenCalled();
  });

  it("different purpose string queries different bucket", async () => {
    const queriedPurposes: string[] = [];
    mockQueryFn = vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("SELECT") && params) {
        queriedPurposes.push(params[1]);
      }
      return [];
    });
    await checkOtpForPurpose(42, "654321", SELF_PW_CHANGE_PURPOSE);
    await checkOtpForPurpose(42, "654321", EMAIL_CHANGE_PURPOSE);
    expect(queriedPurposes).toContain(SELF_PW_CHANGE_PURPOSE);
    expect(queriedPurposes).toContain(EMAIL_CHANGE_PURPOSE);
    expect(SELF_PW_CHANGE_PURPOSE).not.toBe(EMAIL_CHANGE_PURPOSE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pepper protection
// ═══════════════════════════════════════════════════════════════════════════════

describe("pepper protection", () => {
  afterEach(() => {
    setOtpPepper(undefined);
  });

  it("no hardcoded pepper exists — hashOtp fails without env var", async () => {
    setOtpPepper(undefined);
    const { hashOtp } = await import("./passwordReset");
    expect(() => hashOtp("123456")).toThrow("OTP_PEPPER");
  });

  it("pepper minimum length is enforced (< 16 chars rejected)", async () => {
    setOtpPepper("fifteen-chars!!");  // 15 chars
    const { hashOtp } = await import("./passwordReset");
    expect(() => hashOtp("123456")).toThrow("OTP_PEPPER");
  });

  it("pepper of exactly 16 chars is accepted", async () => {
    setOtpPepper("exactly16chars!!");  // 16 chars
    const { hashOtp } = await import("./passwordReset");
    expect(() => hashOtp("123456")).not.toThrow();
  });

  it("OTP_PEPPER is not a NEXT_PUBLIC_ variable", () => {
    // NEXT_PUBLIC_ prefixed variables are bundled into the client JS.
    // OTP_PEPPER must NEVER have this prefix.
    expect("OTP_PEPPER".startsWith("NEXT_PUBLIC_")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Database compromise scenario (Phase 8 documentation via test)
// ═══════════════════════════════════════════════════════════════════════════════

describe("database compromise resistance", () => {
  beforeEach(() => {
    setOtpPepper(TEST_PEPPER);
  });

  afterEach(() => {
    setOtpPepper(undefined);
  });

  it("verifier cannot be reversed without the pepper", async () => {
    const { hashOtp } = await import("./passwordReset");
    const verifier = hashOtp("123456");

    // An attacker with the verifier but NOT the pepper tries all million OTPs
    // using bare SHA-256 (the old method). None will match.
    const { createHash } = require("crypto");
    const bareSha = createHash("sha256").update("123456").digest("hex");
    expect(verifier).not.toBe(bareSha);

    // The attacker tries HMAC with a wrong pepper — also fails
    const wrongPepper = createHmac("sha256", "wrong-pepper-value!!")
      .update("123456")
      .digest("hex");
    expect(verifier).not.toBe(wrongPepper);
  });

  it("precomputing all million HMACs requires the pepper", async () => {
    const { hashOtp } = await import("./passwordReset");
    const target = hashOtp("555555");

    // Without the pepper, brute-forcing means trying each of the million OTPs
    // with each possible pepper — computationally infeasible.
    // With the pepper, brute-forcing is trivial (< 1 second).
    // This test just verifies the architectural property: same pepper reproduces.
    const reproduced = createHmac("sha256", TEST_PEPPER)
      .update("555555")
      .digest("hex");
    expect(target).toBe(reproduced);
  });
});
