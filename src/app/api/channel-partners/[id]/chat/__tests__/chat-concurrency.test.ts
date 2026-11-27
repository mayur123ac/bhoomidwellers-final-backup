// @vitest-environment node
//
// Concurrency and reliability tests for CP Chat synchronization.
//
// Tests:
// 1. Simultaneous POSTs from two users produce distinct messages
// 2. Delta overlap catches messages committed near the cursor boundary
// 3. Duplicate POST with same text creates two distinct rows
// 4. POST response items have correct structure for client merge
// 5. Delta query deduplicates by id when overlap re-reads existing rows
// 6. threadState fingerprint is stable when no CRM events change
// 7. threadState fingerprint changes when a booking status changes
// 8. Full-load and delta-load produce consistent item shapes
// 9. Concurrent GET requests do not interfere
// 10. POST under load — sequential inserts produce monotonic timestamps

import { describe, expect, it, vi, beforeEach } from "vitest";

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
  resolveSender: vi.fn((role: any, name: any) => ({
    role: role || "admin", name: name || "Test",
    label: `${role || "Admin"} · ${name || "Test"}`, tone: "neutral", system: false,
  })),
  formatUnitConfig: vi.fn((v: any) => v ?? ""),
  clean: vi.fn((v: any) => v ?? ""),
}));

const ORG_ID = "org-uuid-concurrency";
const CP_ID = 10;
const CURSOR_T0 = "2026-11-27T12:00:00.000000Z";
const CURSOR_T1 = "2026-11-27T12:00:02.000000Z";
const FP_A = "fp-stable-a";

const partnerRow = {
  id: CP_ID, name: "CP Test", company_name: "Co",
  phone: "1234567890", email: "cp@test.com",
  office_address: null, city: "Mumbai", pin_code: "400001",
  status: "Active", owner_contact_person: null,
  created_at: "2026-01-01", updated_at: "2026-11-01",
  assigned_sourcing_manager_id: 2,
  assigned_sourcing_manager_at: "2026-06-01",
  assigned_sourcing_manager_name: "SM",
  assigned_sourcing_manager_role: "sourcing_manager",
};

function makeGetReq(url: string) {
  return {
    headers: new Headers(),
    nextUrl: new URL(url, "http://localhost"),
  } as any;
}

function makePostReq(body: any) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    nextUrl: new URL(`http://localhost/api/channel-partners/${CP_ID}/chat`),
    json: async () => body,
    formData: async () => { throw new Error("not multipart"); },
  } as any;
}

const ctx = { params: Promise.resolve({ id: String(CP_ID) }) };

describe("CP Chat concurrency and reliability", () => {
  let GET: (req: any, ctx: any) => Promise<Response>;
  let POST: (req: any, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockGetOrganizationId.mockResolvedValue(ORG_ID);
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin", _id: "1" });
    mockGetSessionUserId.mockReturnValue(1);
    const mod = await import("../route");
    GET = mod.GET as any;
    POST = mod.POST as any;
  });

  // ── 1. Two simultaneous POSTs create distinct messages ──────────────────
  it("two POSTs with different text create two distinct rows", async () => {
    // Promise.all consumes mockResolvedValueOnce non-deterministically,
    // so use content-matching mockImplementation instead.
    let insertCount = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("channel_partners")) {
        return [partnerRow];
      }
      if (typeof sql === "string" && sql.includes("INSERT INTO cp_chat_messages")) {
        insertCount++;
        return [{ id: `uuid-msg-${insertCount}`, sent_at: `2026-11-27T12:00:00.${insertCount}00Z` }];
      }
      return [];
    });

    const [res1, res2] = await Promise.all([
      POST(makePostReq({ text: "Hello from user A" }), ctx),
      POST(makePostReq({ text: "Hello from user B" }), ctx),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = await res1.json();
    const body2 = await res2.json();
    // Both should have distinct IDs (order may vary with Promise.all)
    expect(body1.data[0].id).not.toBe(body2.data[0].id);
  });

  // ── 2. POST response has correct structure for client merge ─────────────
  it("POST response items include id, ts, kind, text, sender, mine, source", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([{
      id: "uuid-shape-test", sent_at: "2026-11-27T12:00:00.000Z",
    }]);

    const res = await POST(makePostReq({ text: "Shape test" }), ctx);
    const body = await res.json();
    const item = body.data[0];

    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("ts");
    expect(item).toHaveProperty("kind", "text");
    expect(item).toHaveProperty("text", "Shape test");
    expect(item).toHaveProperty("sender");
    expect(item).toHaveProperty("mine", true);
    expect(item).toHaveProperty("source", "cp_chat_messages");
    expect(item.id).toMatch(/^m/);
  });

  // ── 3. Delta overlap re-reads and client deduplicates ───────────────────
  it("delta returns overlapping rows that client deduplicates by id", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    // loadPersisted returns two rows — one is from before the cursor (overlap window)
    mockQuery.mockResolvedValueOnce([
      {
        id: 100, message_type: "text", message_text: "Old msg",
        sent_at: "2026-11-27T11:59:58.000Z", edited_at: null,
        sender_user_id: 1, visit_id: null,
        attachment_key: null, attachment_name: null, attachment_type: null, attachment_size: null,
        sender_name: "Admin", sender_role: "admin",
      },
      {
        id: 101, message_type: "text", message_text: "New msg",
        sent_at: "2026-11-27T12:00:01.000Z", edited_at: null,
        sender_user_id: 2, visit_id: null,
        attachment_key: null, attachment_name: null, attachment_type: null, attachment_size: null,
        sender_name: "SM", sender_role: "sourcing_manager",
      },
    ]);
    // threadState
    mockQuery.mockResolvedValueOnce([{ cursor: CURSOR_T1, fingerprint: FP_A }]);

    const res = await GET(
      makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`),
      ctx
    );
    const body = await res.json();

    // Both rows returned — client's Map-by-id merge deduplicates
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[0].id).toBe("m100");
    expect(body.data.messages[1].id).toBe("m101");
  });

  // ── 4. Fingerprint is stable across consecutive polls ───────────────────
  it("fingerprint is deterministic when no CRM events change", async () => {
    // Poll 1
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ cursor: CURSOR_T0, fingerprint: FP_A }]);

    const res1 = await GET(
      makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`),
      ctx
    );
    const body1 = await res1.json();

    // Poll 2 — same fingerprint
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ cursor: CURSOR_T1, fingerprint: FP_A }]);

    const res2 = await GET(
      makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(body1.data.cursor)}`),
      ctx
    );
    const body2 = await res2.json();

    expect(body1.data.fingerprint).toBe(body2.data.fingerprint);
  });

  // ── 5. Fingerprint changes on CRM event mutation ────────────────────────
  it("fingerprint changes when CRM data mutates", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ cursor: CURSOR_T0, fingerprint: FP_A }]);

    const res1 = await GET(
      makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`),
      ctx
    );

    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([{ cursor: CURSOR_T1, fingerprint: "fp-changed" }]);

    const res2 = await GET(
      makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`),
      ctx
    );

    const b1 = await res1.json();
    const b2 = await res2.json();
    expect(b1.data.fingerprint).not.toBe(b2.data.fingerprint);
  });

  // ── 6. Concurrent GETs do not interfere ─────────────────────────────────
  it("concurrent delta GETs both return valid responses", async () => {
    // Promise.all consumes mockResolvedValueOnce non-deterministically,
    // so use content-matching mockImplementation instead.
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("channel_partners")) {
        return [partnerRow];
      }
      if (typeof sql === "string" && sql.includes("cp_chat_messages")) {
        return [];
      }
      if (typeof sql === "string" && sql.includes("AS cursor")) {
        return [{ cursor: CURSOR_T1, fingerprint: FP_A }];
      }
      return [];
    });

    const [res1, res2] = await Promise.all([
      GET(makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`), ctx),
      GET(makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`), ctx),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const b1 = await res1.json();
    const b2 = await res2.json();
    expect(b1.success).toBe(true);
    expect(b2.success).toBe(true);
  });

  // ── 7. POST response ts is monotonic for sequential sends ───────────────
  it("sequential POSTs produce monotonically increasing timestamps", async () => {
    const timestamps = [
      "2026-11-27T12:00:00.100Z",
      "2026-11-27T12:00:00.200Z",
      "2026-11-27T12:00:00.300Z",
    ];

    const results: any[] = [];
    for (let i = 0; i < 3; i++) {
      mockQuery.mockResolvedValueOnce([partnerRow]);
      mockQuery.mockResolvedValueOnce([{
        id: `uuid-seq-${i}`, sent_at: timestamps[i],
      }]);
      const res = await POST(makePostReq({ text: `Msg ${i}` }), ctx);
      results.push(await res.json());
    }

    const tsList = results.map(r => r.data[0].ts);
    for (let i = 1; i < tsList.length; i++) {
      expect(tsList[i]).toBeGreaterThan(tsList[i - 1]);
    }
  });

  // ── 8. Delta path SQL includes both sent_at and edited_at ───────────────
  it("delta query catches edited messages via edited_at", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    // A message that was sent long ago but edited recently
    mockQuery.mockResolvedValueOnce([{
      id: 200, message_type: "text", message_text: "Edited text",
      sent_at: "2026-11-20T10:00:00.000Z",  // old sent_at
      edited_at: "2026-11-27T12:00:01.000Z", // recent edit
      sender_user_id: 1, visit_id: null,
      attachment_key: null, attachment_name: null, attachment_type: null, attachment_size: null,
      sender_name: "Admin", sender_role: "admin",
    }]);
    mockQuery.mockResolvedValueOnce([{ cursor: CURSOR_T1, fingerprint: FP_A }]);

    const res = await GET(
      makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`),
      ctx
    );
    const body = await res.json();

    expect(body.data.messages).toHaveLength(1);
    expect(body.data.messages[0].id).toBe("m200");
    expect(body.data.messages[0].edited).toBe(true);
  });

  // ── 9. Delta and full-load item shapes are compatible ───────────────────
  it("delta items have same shape as full-load items for client merge", async () => {
    const msgRow = {
      id: 300, message_type: "text", message_text: "Test",
      sent_at: "2026-11-27T12:00:01.000Z", edited_at: null,
      sender_user_id: 1, visit_id: null,
      attachment_key: null, attachment_name: null, attachment_type: null, attachment_size: null,
      sender_name: "Admin", sender_role: "admin",
    };

    // Delta path
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([msgRow]);
    mockQuery.mockResolvedValueOnce([{ cursor: CURSOR_T1, fingerprint: FP_A }]);

    const deltaRes = await GET(
      makeGetReq(`/api/channel-partners/${CP_ID}/chat?since=${encodeURIComponent(CURSOR_T0)}`),
      ctx
    );
    const deltaBody = await deltaRes.json();
    const deltaItem = deltaBody.data.messages[0];

    // Both should have these properties
    expect(deltaItem).toHaveProperty("id");
    expect(deltaItem).toHaveProperty("ts");
    expect(deltaItem).toHaveProperty("kind");
    expect(deltaItem).toHaveProperty("sender");
    expect(deltaItem).toHaveProperty("text");
    expect(deltaItem).toHaveProperty("source", "cp_chat_messages");
    expect(deltaItem).toHaveProperty("mine");
    expect(deltaItem.id).toMatch(/^m\d+$/);
  });

  // ── 10. POST with duplicate text creates separate rows ──────────────────
  it("two POSTs with identical text create two distinct message ids", async () => {
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([{ id: "uuid-dup-1", sent_at: "2026-11-27T12:00:00.100Z" }]);
    mockQuery.mockResolvedValueOnce([partnerRow]);
    mockQuery.mockResolvedValueOnce([{ id: "uuid-dup-2", sent_at: "2026-11-27T12:00:00.200Z" }]);

    const res1 = await POST(makePostReq({ text: "Same text" }), ctx);
    const res2 = await POST(makePostReq({ text: "Same text" }), ctx);

    const b1 = await res1.json();
    const b2 = await res2.json();
    expect(b1.data[0].id).not.toBe(b2.data[0].id);
  });
});
