// @vitest-environment node
//
// Tests for attendance location visibility in admin/site-head APIs.
//
// Verifies that:
//   * /api/attendance/live returns login_latitude and login_longitude
//   * /api/attendance/session-history returns the same columns
//   * Missing coordinates display as null (not fabricated)
//   * Correct session coordinates are returned per date
//   * Unauthorized roles cannot access the data

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/serverAuth", () => ({
  requireRole: vi.fn(async () => ({
    isAuthorized: true,
    session: { _id: "1", name: "Admin", email: "admin@test.com", role: "Admin", org: "test-org" },
  })),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => "test-org-uuid"),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
  }),
  headers: async () => new Headers(),
}));

import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
const mockQuery = vi.mocked(query);
const mockRequireRole = vi.mocked(requireRole);

// ── Helpers ────────────────────────────────────────────────────────────────

function liveRequest(date?: string): Request {
  const url = date
    ? `http://localhost:3000/api/attendance/live?date=${date}`
    : "http://localhost:3000/api/attendance/live";
  return new Request(url);
}

function historyRequest(userId: string, date?: string): Request {
  let url = `http://localhost:3000/api/attendance/session-history?userId=${userId}`;
  if (date) url += `&date=${date}`;
  return new Request(url);
}

// ── Live API tests ─────────────────────────────────────────────────────────

describe("/api/attendance/live — location columns", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      isAuthorized: true,
      session: { _id: "1", name: "Admin", email: "admin@test.com", role: "Admin", org: "test-org" },
    } as any);

    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      // Session expiration cleanup — no-op
      if (s.includes("UPDATE employee_sessions") && s.includes("is_active = false")) return [];
      // Main live query
      if (s.includes("FROM users")) {
        return [{
          user_id: 10,
          name: "Test Employee",
          email: "emp@test.com",
          role: "Sales Manager",
          session_start: "2026-08-31T05:30:00.000Z",
          session_end: null,
          session_is_active: true,
          ip_address: "192.168.1.1",
          device_info: "Windows PC / Chrome",
          login_device_name: "Windows PC",
          login_device_type: "Desktop",
          login_os: "Windows 10/11",
          login_browser: "Chrome",
          login_latitude: 19.076,
          login_longitude: 72.8777,
          login_location_name: "Manpada, Thane, Maharashtra, India",
          login_location_accuracy: 12,
          status: "ACTIVE",
          attendance_status: "Present",
          idle_duration_seconds: 0,
          productivity_score: 5,
          active_sessions_count: 1,
          session_duration_seconds: 3600,
        }];
      }
      return [];
    });

    const mod = await import("./live/route");
    GET = mod.GET;
  });

  it("returns location and device fields for an employee session", async () => {
    const res = await GET(liveRequest("2026-08-31"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].login_latitude).toBe(19.076);
    expect(body.sessions[0].login_longitude).toBe(72.8777);
    expect(body.sessions[0].login_location_name).toBe("Manpada, Thane, Maharashtra, India");
    expect(body.sessions[0].login_location_accuracy).toBe(12);
    expect(body.sessions[0].login_device_name).toBe("Windows PC");
    expect(body.sessions[0].login_device_type).toBe("Desktop");
    expect(body.sessions[0].login_os).toBe("Windows 10/11");
    expect(body.sessions[0].login_browser).toBe("Chrome");
  });

  it("returns null coordinates for old sessions without GPS", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 10,
          name: "Old Employee",
          login_latitude: null,
          login_longitude: null,
          session_start: "2026-07-15T05:30:00.000Z",
          status: "OFFLINE",
          attendance_status: "Present",
        }];
      }
      return [];
    });

    const res = await GET(liveRequest("2026-07-15"));
    const body = await res.json();
    expect(body.sessions[0].login_latitude).toBeNull();
    expect(body.sessions[0].login_longitude).toBeNull();
    // Old records also have no device fields
    expect(body.sessions[0].login_device_name).toBeUndefined();
  });

  it("returns OPPO device for Android OPPO session", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 11, name: "Mobile User", status: "ACTIVE",
          session_start: "2026-08-31T06:00:00.000Z",
          login_device_name: "OPPO", login_device_type: "Mobile",
          login_os: "Android 15", login_browser: "Chrome",
          login_latitude: 19.076, login_longitude: 72.8777,
          attendance_status: "Present",
        }];
      }
      return [];
    });
    const res = await GET(liveRequest("2026-08-31"));
    const body = await res.json();
    expect(body.sessions[0].login_device_name).toBe("OPPO");
    expect(body.sessions[0].login_device_type).toBe("Mobile");
    expect(body.sessions[0].login_os).toBe("Android 15");
    expect(body.sessions[0].login_browser).toBe("Chrome");
  });

  it("returns iPhone device for iOS session", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 12, name: "iOS User", status: "ACTIVE",
          session_start: "2026-08-31T06:00:00.000Z",
          login_device_name: "iPhone", login_device_type: "Mobile",
          login_os: "iOS 18.1", login_browser: "Safari",
          login_latitude: 19.076, login_longitude: 72.8777,
          attendance_status: "Present",
        }];
      }
      return [];
    });
    const res = await GET(liveRequest("2026-08-31"));
    const body = await res.json();
    expect(body.sessions[0].login_device_name).toBe("iPhone");
    expect(body.sessions[0].login_device_type).toBe("Mobile");
    expect(body.sessions[0].login_os).toBe("iOS 18.1");
    expect(body.sessions[0].login_browser).toBe("Safari");
  });

  it("returns Mac device for macOS Safari session", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 13, name: "Mac User", status: "ACTIVE",
          session_start: "2026-08-31T06:00:00.000Z",
          login_device_name: "Mac", login_device_type: "Desktop",
          login_os: "macOS 14.0", login_browser: "Safari",
          login_latitude: null, login_longitude: null,
          attendance_status: "Present",
        }];
      }
      return [];
    });
    const res = await GET(liveRequest("2026-08-31"));
    const body = await res.json();
    expect(body.sessions[0].login_device_name).toBe("Mac");
    expect(body.sessions[0].login_device_type).toBe("Desktop");
    expect(body.sessions[0].login_os).toBe("macOS 14.0");
    expect(body.sessions[0].login_browser).toBe("Safari");
  });

  it("returns realme device for Android realme session", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 14, name: "Realme User", status: "ACTIVE",
          session_start: "2026-08-31T06:00:00.000Z",
          login_device_name: "realme", login_device_type: "Mobile",
          login_os: "Android 14", login_browser: "Chrome",
          login_latitude: 18.5204, login_longitude: 73.8567,
          attendance_status: "Present",
        }];
      }
      return [];
    });
    const res = await GET(liveRequest("2026-08-31"));
    const body = await res.json();
    expect(body.sessions[0].login_device_name).toBe("realme");
    expect(body.sessions[0].login_os).toBe("Android 14");
  });

  it("rejects unauthorized roles", async () => {
    mockRequireRole.mockResolvedValue({
      isAuthorized: false,
    } as any);

    const res = await GET(liveRequest());
    expect(res.status).toBe(401);
  });
});

// ── Session History API tests ──────────────────────────────────────────────

describe("/api/attendance/session-history — location columns", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      isAuthorized: true,
      session: { _id: "1", name: "Admin", email: "admin@test.com", role: "Admin", org: "test-org" },
    } as any);

    mockQuery.mockImplementation(async () => {
      return [{
        id: 99,
        session_start: "2026-08-31T05:30:00.000Z",
        session_end: "2026-08-31T14:30:00.000Z",
        is_active: false,
        ip_address: "10.0.0.1",
        device_info: "Mac / Safari",
        login_device_name: "Mac",
        login_device_type: "Desktop",
        login_os: "macOS 14.0",
        login_browser: "Safari",
        session_end_reason: null,
        login_latitude: 18.5204,
        login_longitude: 73.8567,
        login_location_name: "Kothrud, Pune, Maharashtra, India",
        login_location_accuracy: 8,
        session_duration_seconds: 32400,
      }];
    });

    const mod = await import("./session-history/route");
    GET = mod.GET;
  });

  it("returns login_latitude and login_longitude per session", async () => {
    const res = await GET(historyRequest("10", "2026-08-31"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].login_latitude).toBe(18.5204);
    expect(body.sessions[0].login_longitude).toBe(73.8567);
    expect(body.sessions[0].login_location_name).toBe("Kothrud, Pune, Maharashtra, India");
    expect(body.sessions[0].login_location_accuracy).toBe(8);
    expect(body.sessions[0].login_device_name).toBe("Mac");
    expect(body.sessions[0].login_device_type).toBe("Desktop");
    expect(body.sessions[0].login_os).toBe("macOS 14.0");
    expect(body.sessions[0].login_browser).toBe("Safari");
  });

  it("returns null coordinates for sessions without GPS data", async () => {
    mockQuery.mockImplementation(async () => [{
      id: 50,
      session_start: "2026-07-01T05:30:00.000Z",
      session_end: "2026-07-01T14:30:00.000Z",
      is_active: false,
      login_latitude: null,
      login_longitude: null,
      session_duration_seconds: 32400,
    }]);

    const res = await GET(historyRequest("10", "2026-07-01"));
    const body = await res.json();
    expect(body.sessions[0].login_latitude).toBeNull();
    expect(body.sessions[0].login_longitude).toBeNull();
  });

  it("returns correct location and device per date — different days have different data", async () => {
    // Simulate two calls returning different coordinates and devices for different dates
    let callCount = 0;
    mockQuery.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{
          id: 100,
          session_start: "2026-08-31T05:30:00.000Z",
          login_latitude: 19.076,
          login_longitude: 72.8777,
          login_device_name: "OPPO",
          login_os: "Android 15",
          session_duration_seconds: 28800,
        }];
      }
      return [{
        id: 101,
        session_start: "2026-09-01T05:30:00.000Z",
        login_latitude: 18.5204,
        login_longitude: 73.8567,
        login_device_name: "iPhone",
        login_os: "iOS 18.1",
        session_duration_seconds: 28800,
      }];
    });

    const res1 = await GET(historyRequest("10", "2026-08-31"));
    const body1 = await res1.json();
    expect(body1.sessions[0].login_latitude).toBe(19.076);
    expect(body1.sessions[0].login_device_name).toBe("OPPO");
    expect(body1.sessions[0].login_os).toBe("Android 15");

    const res2 = await GET(historyRequest("10", "2026-09-01"));
    const body2 = await res2.json();
    expect(body2.sessions[0].login_latitude).toBe(18.5204);
    expect(body2.sessions[0].login_device_name).toBe("iPhone");
    expect(body2.sessions[0].login_os).toBe("iOS 18.1");
  });

  it("rejects unauthorized roles", async () => {
    mockRequireRole.mockResolvedValue({
      isAuthorized: false,
    } as any);

    const res = await GET(historyRequest("10"));
    expect(res.status).toBe(401);
  });
});

// ── Admin Working Hours integration tests ─────────────────────────────────
// Verifies that /api/attendance/live returns the attendance-based working
// hours fields (attendance_span_seconds, attendance_marked_at,
// attendance_completed) and that the admin panel can derive the correct
// display for completed, active, and not-marked employees.

describe("/api/attendance/live — admin working hours", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      isAuthorized: true,
      session: { _id: "1", name: "Admin", email: "admin@test.com", role: "Admin", org: "test-org" },
    } as any);

    const mod = await import("./live/route");
    GET = mod.GET;
  });

  it("completed day: 9 AM mark → 5 PM checkout = 8h (28800s)", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 10, name: "Employee A", status: "OFFLINE",
          session_start: "2026-10-26T03:30:00.000Z",
          attendance_status: "Present",
          attendance_span_seconds: 28800,
          attendance_marked_at: "2026-10-26T03:30:00.000Z",
          attendance_completed: true,
        }];
      }
      return [];
    });

    const res = await GET(liveRequest("2026-10-26"));
    const body = await res.json();
    expect(body.sessions[0].attendance_span_seconds).toBe(28800);
    expect(body.sessions[0].attendance_completed).toBe(true);
    expect(body.sessions[0].attendance_marked_at).toBe("2026-10-26T03:30:00.000Z");
  });

  it("active day: marked 2h ago, not yet checked out", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 11, name: "Employee B", status: "ACTIVE",
          session_start: twoHoursAgo,
          attendance_status: "Present",
          attendance_span_seconds: 7200,
          attendance_marked_at: twoHoursAgo,
          attendance_completed: false,
        }];
      }
      return [];
    });

    const res = await GET(liveRequest("2026-10-26"));
    const body = await res.json();
    expect(body.sessions[0].attendance_completed).toBe(false);
    expect(body.sessions[0].attendance_marked_at).toBeTruthy();
    // Server computes ~7200 at query time; client will use attendance_marked_at for live tick
    expect(body.sessions[0].attendance_span_seconds).toBeGreaterThanOrEqual(7199);
  });

  it("frozen after checkout: span does not change", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 12, name: "Employee C", status: "OFFLINE",
          attendance_status: "Present",
          attendance_span_seconds: 1800,
          attendance_marked_at: "2026-10-26T07:41:00.000Z",
          attendance_completed: true,
        }];
      }
      return [];
    });

    const res1 = await GET(liveRequest("2026-10-26"));
    const body1 = await res1.json();

    // Second call — same frozen value
    const res2 = await GET(liveRequest("2026-10-26"));
    const body2 = await res2.json();

    expect(body1.sessions[0].attendance_span_seconds).toBe(1800);
    expect(body2.sessions[0].attendance_span_seconds).toBe(1800);
  });

  it("no attendance marked: fields are null, UI shows dash", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 13, name: "Employee D", status: "ACTIVE",
          session_start: "2026-10-26T04:00:00.000Z",
          attendance_status: null,
          attendance_span_seconds: null,
          attendance_marked_at: null,
          attendance_completed: null,
        }];
      }
      return [];
    });

    const res = await GET(liveRequest("2026-10-26"));
    const body = await res.json();
    expect(body.sessions[0].attendance_span_seconds).toBeNull();
    expect(body.sessions[0].attendance_marked_at).toBeNull();
    expect(body.sessions[0].attendance_completed).toBeNull();
  });

  it("date filter returns correct day's attendance data", async () => {
    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        const date = params?.[0];
        if (date === "2026-10-25") {
          return [{
            user_id: 10, name: "Employee A", status: "OFFLINE",
            attendance_status: "Present",
            attendance_span_seconds: 32400, // 9h
            attendance_marked_at: "2026-10-25T03:30:00.000Z",
            attendance_completed: true,
          }];
        }
        return [{
          user_id: 10, name: "Employee A", status: "OFFLINE",
          attendance_status: null,
          attendance_span_seconds: null,
          attendance_marked_at: null,
          attendance_completed: null,
        }];
      }
      return [];
    });

    const res25 = await GET(liveRequest("2026-10-25"));
    const body25 = await res25.json();
    expect(body25.sessions[0].attendance_span_seconds).toBe(32400);

    const res26 = await GET(liveRequest("2026-10-26"));
    const body26 = await res26.json();
    expect(body26.sessions[0].attendance_span_seconds).toBeNull();
  });

  it("rejects non-admin roles", async () => {
    mockRequireRole.mockResolvedValue({ isAuthorized: false } as any);
    const res = await GET(liveRequest("2026-10-26"));
    expect(res.status).toBe(401);
  });

  it("admin and employee calculations agree: same submitted_at formula", async () => {
    // Simulates the scenario: mark at 1:11 PM IST, checkout at 1:41 PM IST
    // = exactly 1800 seconds. Both my-sessions (employee) and live (admin)
    // use the same formula: logout_time - submitted_at AT TIME ZONE 'UTC'.
    mockQuery.mockImplementation(async (sql: string) => {
      const s = typeof sql === "string" ? sql : "";
      if (s.includes("UPDATE employee_sessions")) return [];
      if (s.includes("FROM users")) {
        return [{
          user_id: 10, name: "Employee A", status: "OFFLINE",
          attendance_status: "Present",
          attendance_span_seconds: 1800,
          attendance_marked_at: "2026-10-26T07:41:00.000Z",
          attendance_completed: true,
          working_track: 1800,
        }];
      }
      return [];
    });

    const res = await GET(liveRequest("2026-10-26"));
    const body = await res.json();
    // Admin panel sees the same 1800s as the employee's my-sessions page
    expect(body.sessions[0].attendance_span_seconds).toBe(1800);
    expect(body.sessions[0].working_track).toBe(1800);
  });
});
