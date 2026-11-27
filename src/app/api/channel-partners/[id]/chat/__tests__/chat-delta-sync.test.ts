// @vitest-environment node
//
// Delta synchronization tests for GET /api/channel-partners/[id]/chat
//
// Verifies:
// 1. Full load returns cursor + fingerprint
// 2. Delta request (?since=) returns only new messages
// 3. Invalid cursor is rejected (falls through to full load)
// 4. Fingerprint changes when CRM events change
// 5. Delta overlap window catches late-committed rows
// 6. Auth is enforced on delta requests
// 7. Tenant isolation on delta path

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const {
  mockGetServerSession,
  mockGetSessionUserId,
  mockGetOrganizationId,
  mockQuery,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetSessionUserId: vi.fn(),
  mockGetOrganizationId: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("@/lib/serverAuth", () => ({
  getServerSession: () => mockGetServerSession(),
  getSessionUserId: (s: any) => mockGetSessionUserId(s),
}));
vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: () => mockGetOrganizationId(),
}));
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
vi.mock("@/lib/r2", () => ({
  uploadBufferToR2: vi.fn(),
  generatePresignedUrl: vi.fn().mockResolvedValue("https://example.com/signed"),
}));
vi.mock("@/lib/cpChat", () => ({
  resolveSender: vi.fn(() => ({
    role: "sourcing manager", name: "Test SM",
    label: "Sourcing Manager · Test SM", tone: "magenta", system: false,
  })),
  formatUnitConfig: vi.fn((v: any) => v ?? ""),
  clean: vi.fn((v: any) => v ?? ""),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-delta";
const CP_ID = 7;
const CURSOR = "2026-11-27T10:00:00.000000Z";
const FINGERPRINT_A = "abc123";
const FINGERPRINT_B = "def456";

const ADMIN_SESSION = { role: "admin", name: "Admin", _id: "1" };

/** Builds a partner row returned by loadPartner's query */
const partnerRow = {
  id: CP_ID, name: "Test CP", company_name: "Test Co",
  phone: "9876543210", email: "cp@test.com",
  office_address: null, city: "Mumbai", pin_code: "400001",
  status: "Active", owner_contact_person: null,
  created_at: "2026-01-01", updated_at: "2026-11-01",
  assigned_sourcing_manager_id: 2,
  assigned_sourcing_manager_at: "2026-06-01",
  assigned_sourcing_manager_name: "Test SM",
  assigned_sourcing_manager_role: "sourcing_manager",
};

/** A cp_chat_messages row from the DB */
const msgRow = (id: number, sentAt: string) => ({
  id,
  message_type: "text",
  message_text: `Message ${id}`,
  sent_at: sentAt,
  edited_at: null,
  sender_user_id: 1,
  visit_id: null,
  attachment_key: null,
  attachment_name: null,
  attachment_type: null,
  attachment_size: null,
  sender_name: "Admin",
  sender_role: "admin",
});

/** threadState row */
const stateRow = (cursor: string, fingerprint: string) => ({
  cursor, fingerprint,
});

function makeReq(url: string) {
  return {
    headers: new Headers(),
    nextUrl: new URL(url, "http://localhost"),
  } as any;
}

const ctx = { params: Promise.resolve({ id: String(CP_ID) }) };

// ── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/channel-partners/[id]/chat — delta sync", () => {
  let GET: (req: any, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockGetOrganizationId.mockResolvedValue(ORG_ID);
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetSessionUserId.mockReturnValue(1);

    const mod = await import("../route");
    GET = mod.GET as unknown as (req: any, ctx: any) => Promise<Response>;
  });

  // ── 1. Full load includes cursor + fingerprint ──────────────────────────
  it("full load returns cursor and fingerprint", async () => {
    // loadPartner returns the partner
    mockQuery.mockResolvedValueOnce([partnerRow]);
    // The full-load path fires 7 queries in Promise.all (persisted messages,
    // cp_visits, site_visits, bookings, registrations, disbursements, about)
    // plus the persisted .then() fires one more for location metadata.
    // Then threadState fires one final query.
    // Because Promise.all order is nondeterministic with the .then() chain,
    // use a default mock and override the about query by content matching.
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("total_leads")) {
        return [{ total_leads: 0, total_site_visits: 0, total_bookings: 0, total_cp_visits: 0 }];
      }
      if (typeof sql === "string" && sql.includes("AS cursor")) {
        return [stateRow(CURSOR, FINGERPRINT_A)];
      }
      return [];
    });

    const res = await GET(makeReq(`/api/channel-partners/${CP_ID}/chat`), ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.cursor).toBe(CURSOR);
    expect(body.data.fingerprint).toBe(FINGERPRINT_A);
    expect(body.data.about).toBeDefined();
  });

  // ── 2. Delta request returns only new messages ──────────────────────────
  it("delta request with ?since= returns new messages and updated cursor", async () => {
    // loadPartner
    mockQuery.mockResolvedValueOnce([partnerRow]);
    // loadPersisted (delta path) — returns one new message
    mockQuery.mockResolvedValueOnce([msgRow(42, "2026-11-27T10:00:01.000000Z")]);
    // threadState
    mockQuery.mockResolvedValueOnce([stateRow("2026-11-27T10:00:02.000000Z", FINGERPRINT_A)]);

    const res = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR)}`),
      ctx
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.messages[0].id).toBe("m42");
    expect(body.data.cursor).toBe("2026-11-27T10:00:02.000000Z");
    expect(body.data.fingerprint).toBe(FINGERPRINT_A);
    // Delta path does NOT include about
    expect(body.data.about).toBeUndefined();
  });

  // ── 3. Delta with no new messages returns empty ─────────────────────────
  it("delta with no new messages returns empty array", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);  // no new messages
    mockQuery.mockResolvedValueOnce([stateRow("2026-11-27T10:00:03.000000Z", FINGERPRINT_A)]);

    const res = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR)}`),
      ctx
    );
    const body = await res.json();
    expect(body.data.messages).toHaveLength(0);
    expect(body.data.cursor).toBe("2026-11-27T10:00:03.000000Z");
  });

  // ── 4. Invalid cursor falls through to full load ────────────────────────
  it("invalid cursor is ignored and full load is returned", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    // Same as full-load: use content-matching mock
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("total_leads")) {
        return [{ total_leads: 0, total_site_visits: 0, total_bookings: 0, total_cp_visits: 0 }];
      }
      if (typeof sql === "string" && sql.includes("AS cursor")) {
        return [stateRow(CURSOR, FINGERPRINT_A)];
      }
      return [];
    });

    const res = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=not-a-cursor`),
      ctx
    );
    const body = await res.json();
    // Should have about (full load)
    expect(body.data.about).toBeDefined();
    expect(body.data.cursor).toBe(CURSOR);
  });

  // ── 5. Delta enforces auth ──────────────────────────────────────────────
  it("delta request returns 401 when not signed in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR)}`),
      ctx
    );
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("delta request returns 403 for unauthorized role", async () => {
    mockGetServerSession.mockResolvedValue({ role: "caller_intern", name: "Nobody" });
    const res = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR)}`),
      ctx
    );
    expect(res.status).toBe(403);
  });

  // ── 6. Delta enforces partner ownership for sourcing manager ────────────
  it("sourcing manager cannot poll another manager's partner", async () => {
    mockGetServerSession.mockResolvedValue({
      role: "sourcing_manager", name: "Other SM", _id: "99",
    });
    mockGetSessionUserId.mockReturnValue(99);
    // Partner is assigned to SM id=2, not id=99
    mockQuery.mockResolvedValueOnce([partnerRow]);

    const res = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR)}`),
      ctx
    );
    expect(res.status).toBe(404);
  });

  // ── 7. Delta overlap SQL includes the 5-second window ──────────────────
  it("delta query uses the overlap interval in SQL", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);  // loadPersisted
    mockQuery.mockResolvedValueOnce([stateRow(CURSOR, FINGERPRINT_A)]);

    await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR)}`),
      ctx
    );

    // The second query call is loadPersisted — verify it includes the overlap
    const loadPersistedCall = mockQuery.mock.calls[1];
    const sql = loadPersistedCall[0] as string;
    expect(sql).toContain("5 seconds");
    expect(sql).toContain("$3::timestamptz");
    // Params should include the cursor
    expect(loadPersistedCall[1]).toEqual([ORG_ID, CP_ID, CURSOR]);
  });

  // ── 8. Fingerprint returned allows client to detect CRM changes ─────────
  it("different fingerprints signal CRM state change", async () => {
    // First poll
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([stateRow(CURSOR, FINGERPRINT_A)]);

    const res1 = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR)}`),
      ctx
    );
    const body1 = await res1.json();

    // Second poll — fingerprint changed (a booking was confirmed)
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([stateRow("2026-11-27T10:00:05.000000Z", FINGERPRINT_B)]);

    const res2 = await GET(
      makeReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(body1.data.cursor)}`),
      ctx
    );
    const body2 = await res2.json();

    expect(body1.data.fingerprint).toBe(FINGERPRINT_A);
    expect(body2.data.fingerprint).toBe(FINGERPRINT_B);
    expect(body1.data.fingerprint).not.toBe(body2.data.fingerprint);
  });
});
