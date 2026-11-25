// @vitest-environment node
//
// Phase 1 Reminder Tests
//
// 1. Datetime precision: 10:37 AM IST must survive the full pipeline.
// 2. Server-side IST formatting: toLocaleString must use Asia/Kolkata.
// 3. Cron auth: CRON_SECRET, x-reminder-token, and unauthenticated.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ══════════════════════════════════════════════════════════════════════════════
// 1. Datetime precision — ReminderModal parsing
// ══════════════════════════════════════════════════════════════════════════════

describe("ReminderModal datetime parsing", () => {
  // Reproduce the exact parsing logic from ReminderModal.tsx handleSubmit
  // (custom mode path). This is a unit test of the parsing, not a React render.

  function parseCustomDatetime(customDatetime: string): Date | null {
    const [datePart, timePart] = customDatetime.split("T");
    if (!datePart || !timePart) return null;
    const [yr, mo, dy] = datePart.split("-").map(Number);
    const [hr, mn] = timePart.split(":").map(Number);
    return new Date(yr, mo - 1, dy, hr, mn, 0, 0);
  }

  it("preserves 10:37 AM exactly (no minute truncation)", () => {
    const d = parseCustomDatetime("2026-11-27T10:37");
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(10);
    expect(d!.getMinutes()).toBe(37);
    expect(d!.getSeconds()).toBe(0);
  });

  it("preserves 10:00 AM exactly", () => {
    const d = parseCustomDatetime("2026-11-27T10:00");
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(10);
    expect(d!.getMinutes()).toBe(0);
  });

  it("preserves 11:45 AM exactly", () => {
    const d = parseCustomDatetime("2026-11-27T11:45");
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(11);
    expect(d!.getMinutes()).toBe(45);
  });

  it("rejects malformed input without T separator", () => {
    const d = parseCustomDatetime("2026-11-27 10:37");
    expect(d).toBeNull();
  });

  it("rejects empty string", () => {
    const d = parseCustomDatetime("");
    expect(d).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Quick option: 10:00 AM is intentional and correctly preserved
// ══════════════════════════════════════════════════════════════════════════════

describe("Quick option date generation", () => {
  function getQuickDate(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(10, 0, 0, 0);
    return d;
  }

  it("quick options set exactly 10:00 AM local", () => {
    const d = getQuickDate(1);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it("quick option .toISOString() preserves the instant", () => {
    const d = getQuickDate(3);
    const iso = d.toISOString();
    const roundTrip = new Date(iso);
    expect(roundTrip.getTime()).toBe(d.getTime());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. IST timezone conversion: local time → UTC ISO → display roundtrip
// ══════════════════════════════════════════════════════════════════════════════

describe("IST timezone formatting", () => {
  it("formats UTC timestamp as IST with correct minutes", () => {
    // 10:37 AM IST = 05:07 UTC
    const utcIso = "2026-11-27T05:07:00.000Z";
    const d = new Date(utcIso);
    const formatted = d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    expect(formatted).toMatch(/37/);
    expect(formatted).toMatch(/10/);
  });

  it("formats 10:00 AM IST correctly", () => {
    // 10:00 AM IST = 04:30 UTC
    const utcIso = "2026-11-27T04:30:00.000Z";
    const d = new Date(utcIso);
    const formatted = d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    expect(formatted).toMatch(/10/);
    expect(formatted).toMatch(/00/);
  });

  it("formats 11:45 AM IST correctly", () => {
    // 11:45 AM IST = 06:15 UTC
    const utcIso = "2026-11-27T06:15:00.000Z";
    const d = new Date(utcIso);
    const formatted = d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    expect(formatted).toMatch(/11/);
    expect(formatted).toMatch(/45/);
  });

  it("without timeZone, format depends on system TZ (documents the bug)", () => {
    const utcIso = "2026-11-27T05:07:00.000Z";
    const d = new Date(utcIso);
    const formatted = d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    // Just verify it returns a string — actual value depends on runner TZ
    expect(typeof formatted).toBe("string");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Cron auth — /api/reminders/process authorization
// ══════════════════════════════════════════════════════════════════════════════

// vi.mock factories are hoisted above variable declarations, so we use
// vi.hoisted() to create the mock fns that the factories reference.
const { mockProcessReminders, mockGetServerSession, mockGetOrganizationId } = vi.hoisted(() => ({
  mockProcessReminders: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockGetOrganizationId: vi.fn(),
}));

vi.mock("@/services/reminder.service", () => ({
  processReminders: (...args: unknown[]) => mockProcessReminders(...args),
}));
vi.mock("@/lib/serverAuth", () => ({
  getServerSession: () => mockGetServerSession(),
}));
vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: () => mockGetOrganizationId(),
}));
vi.mock("@/config/whatsapp.config", () => ({
  getVerifyToken: () => "test-verify-token",
}));
vi.mock("@/lib/whatsapp-client", () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

describe("Cron endpoint auth", () => {
  let GET: (req: any) => Promise<Response>;

  beforeEach(async () => {
    mockProcessReminders.mockReset();
    mockGetServerSession.mockReset();
    mockGetOrganizationId.mockReset();

    // Default: no session
    mockGetServerSession.mockResolvedValue(null);

    const mod = await import("../process/route");
    GET = mod.GET as unknown as (req: any) => Promise<Response>;
  });

  // NextRequest requires a full URL and has .nextUrl.searchParams.
  // Use the actual NextRequest from next/server to avoid the searchParams error.
  function makeReq(headers: Record<string, string> = {}) {
    // Construct a minimal object that satisfies the route's usage:
    // - req.headers.get(name)
    // - req.nextUrl.searchParams.get(name)
    const hdrs = new Headers(headers);
    const url = new URL("http://localhost/api/reminders/process");
    return {
      headers: hdrs,
      nextUrl: url,
    };
  }

  it("returns 401 when no auth is provided", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("accepts valid CRON_SECRET via Authorization: Bearer", async () => {
    vi.stubEnv("CRON_SECRET", "my-cron-secret-123");
    mockProcessReminders.mockResolvedValue({ processed: 0, failed: 0, errors: [] });

    const res = await GET(makeReq({ authorization: "Bearer my-cron-secret-123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.via).toBe("vercel-cron");

    vi.unstubAllEnvs();
  });

  it("rejects invalid CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "my-cron-secret-123");

    const res = await GET(makeReq({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);

    vi.unstubAllEnvs();
  });

  it("accepts valid x-reminder-token", async () => {
    mockProcessReminders.mockResolvedValue({ processed: 2, failed: 0, errors: [] });

    const res = await GET(makeReq({ "x-reminder-token": "test-verify-token" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.via).toBe("token");
  });

  it("rejects invalid x-reminder-token", async () => {
    const res = await GET(makeReq({ "x-reminder-token": "wrong-token" }));
    expect(res.status).toBe(401);
  });

  it("accepts admin session", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Test Admin" });
    mockGetOrganizationId.mockResolvedValue("org-uuid-123");
    mockProcessReminders.mockResolvedValue({ processed: 1, failed: 0, errors: [] });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.via).toBe("session");
  });

  it("rejects non-admin session", async () => {
    mockGetServerSession.mockResolvedValue({ role: "sales_manager", name: "Test SM" });

    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("processes reminders and returns report structure", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    mockProcessReminders.mockResolvedValue({ processed: 5, failed: 1, errors: [{ reminderId: 99, error: "db error" }] });

    const res = await GET(makeReq({ authorization: "Bearer secret" }));
    const body = await res.json();
    expect(body.processed).toBe(5);
    expect(body.failed).toBe(1);
    expect(body.errors).toHaveLength(1);

    vi.unstubAllEnvs();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Full pipeline: custom datetime 10:37 → ISO → server parse → format
// ══════════════════════════════════════════════════════════════════════════════

describe("Full pipeline: 10:37 AM roundtrip", () => {
  const testCases = [
    { label: "10:37 AM IST", input: "2026-11-27T10:37", displayMinute: "37" },
    { label: "10:00 AM IST", input: "2026-11-27T10:00", displayMinute: "00" },
    { label: "11:45 AM IST", input: "2026-11-27T11:45", displayMinute: "45" },
  ];

  for (const tc of testCases) {
    it(`${tc.label}: parsing preserves minutes through full pipeline`, () => {
      // Step 1: ReminderModal explicit parse (browser side)
      const [datePart, timePart] = tc.input.split("T");
      const [yr, mo, dy] = datePart.split("-").map(Number);
      const [hr, mn] = timePart.split(":").map(Number);
      const localDate = new Date(yr, mo - 1, dy, hr, mn, 0, 0);

      // Verify local components preserved
      expect(localDate.getHours()).toBe(hr);
      expect(localDate.getMinutes()).toBe(mn);

      // Step 2: .toISOString() — converts local to UTC
      const isoString = localDate.toISOString();
      expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Step 3: Server-side parse (simulates route.ts line 64)
      const serverParsed = new Date(isoString);
      expect(serverParsed.getTime()).toBe(localDate.getTime());

      // Step 4: Server-side format with IST timezone
      const formatted = serverParsed.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      // Step 5: Verify the display contains the correct minute
      expect(formatted).toMatch(new RegExp(tc.displayMinute));
    });
  }

  it("10:37 AM roundtrip: ISO → IST display preserves minutes", () => {
    const localDate = new Date(2026, 10, 27, 10, 37, 0, 0); // Nov = month 10
    const iso = localDate.toISOString();

    expect(iso).toMatch(/Z$/);

    // Round-trip through IST display
    const display = new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    expect(display).toMatch(/37/);
  });
});
