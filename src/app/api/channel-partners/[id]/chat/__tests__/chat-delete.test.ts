// @vitest-environment node
//
// DELETE /api/channel-partners/[id]/chat — admin-only message deletion tests
//
// Verifies:
// 1. Unauthenticated → 401
// 2. Non-admin roles → 403
// 3. Admin can delete a message
// 4. Super admin can delete a message
// 5. Missing messageId → 400
// 6. Message not found → 404
// 7. Cross-org isolation (message in another org → 404)
// 8. Wrong CP (message in another partner's thread → 404)

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
  resolveSender: vi.fn(() => ({ role: "admin", name: "Test", label: "Admin · Test", tone: "neutral", system: false })),
  formatUnitConfig: vi.fn((v: any) => v ?? ""),
  clean: vi.fn((v: any) => v ?? ""),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-CP";
const MESSAGE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function makeReq(body: any = {}) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    nextUrl: new URL("http://localhost/api/channel-partners/5/chat"),
    json: async () => body,
  };
}

const ctx = { params: Promise.resolve({ id: "5" }) };

// ── Tests ───────────────────────────────────────────────────────────────────

describe("DELETE /api/channel-partners/[id]/chat", () => {
  let DELETE: (req: any, ctx: any) => Promise<Response>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mockGetOrganizationId.mockResolvedValue(ORG_ID);
    mockQuery.mockResolvedValue([]);

    const mod = await import("../route");
    DELETE = mod.DELETE as unknown as (req: any, ctx: any) => Promise<Response>;
  });

  // ── 1. Unauthenticated → 401 ───────────────────────────────────────────
  it("returns 401 when not signed in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 401 when session has no role", async () => {
    mockGetServerSession.mockResolvedValue({ name: "Test" });
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(401);
  });

  // ── 2. Non-admin roles → 403 ──────────────────────────────────────────
  it("returns 403 for receptionist", async () => {
    mockGetServerSession.mockResolvedValue({ role: "receptionist", name: "R" });
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for sales_manager", async () => {
    mockGetServerSession.mockResolvedValue({ role: "sales_manager", name: "SM" });
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(403);
  });

  it("returns 403 for sourcing_manager", async () => {
    mockGetServerSession.mockResolvedValue({ role: "sourcing_manager", name: "SoM" });
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(403);
  });

  it("returns 403 for site_head", async () => {
    mockGetServerSession.mockResolvedValue({ role: "site_head", name: "SH" });
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(403);
  });

  // ── 3. Admin can delete ────────────────────────────────────────────────
  it("admin deletes a message successfully", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin" });
    mockQuery.mockResolvedValue([{ id: MESSAGE_UUID }]);

    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify the DELETE query was scoped to org + CP
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM cp_chat_messages");
    expect(sql).toContain("organization_id = $2");
    expect(sql).toContain("channel_partner_id = $3");
    expect(params[0]).toBe(MESSAGE_UUID);
    expect(params[1]).toBe(ORG_ID);
    expect(params[2]).toBe(5);
  });

  // ── 4. Super admin can delete ──────────────────────────────────────────
  it("super_admin deletes a message successfully", async () => {
    mockGetServerSession.mockResolvedValue({ role: "super_admin", name: "SA" });
    mockQuery.mockResolvedValue([{ id: MESSAGE_UUID }]);

    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(200);
  });

  // ── 5. Missing messageId → 400 ────────────────────────────────────────
  it("returns 400 when messageId is missing", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin" });
    const res = await DELETE(makeReq({}), ctx);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when messageId is not a string", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin" });
    const res = await DELETE(makeReq({ messageId: 123 }), ctx);
    expect(res.status).toBe(400);
  });

  // ── 6. Message not found → 404 ────────────────────────────────────────
  it("returns 404 when message does not exist", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin" });
    mockQuery.mockResolvedValue([]);

    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(404);
  });

  // ── 7. Cross-org isolation ─────────────────────────────────────────────
  it("message in another org returns 404 (not 403)", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin" });
    mockGetOrganizationId.mockResolvedValue("org-uuid-OTHER");
    mockQuery.mockResolvedValue([]);

    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), ctx);
    expect(res.status).toBe(404);

    // The query was scoped to the OTHER org, so it found nothing
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe("org-uuid-OTHER");
  });

  // ── 8. Wrong CP ────────────────────────────────────────────────────────
  it("message in another partner's thread returns 404", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin" });
    // The message exists but belongs to CP 99, not CP 5
    mockQuery.mockResolvedValue([]);

    const otherCtx = { params: Promise.resolve({ id: "99" }) };
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), otherCtx);
    expect(res.status).toBe(404);
  });

  // ── 9. Invalid CP id ──────────────────────────────────────────────────
  it("returns 400 for non-integer CP id", async () => {
    mockGetServerSession.mockResolvedValue({ role: "admin", name: "Admin" });
    const badCtx = { params: Promise.resolve({ id: "abc" }) };
    const res = await DELETE(makeReq({ messageId: MESSAGE_UUID }), badCtx);
    expect(res.status).toBe(400);
  });
});
