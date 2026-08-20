// tenantContext — MT-05 session organization claim.
//
// The behaviour under test is the reason MT-05 exists. Before it, tenant
// resolution was "the only organization that exists", so creating a second
// organization made every tenant-scoped query throw. After it, a request
// carrying a signed session resolves from that session's `org` claim and a
// second organization is a non-event.
//
// Both modules are mocked because the real ones reach for a Postgres pool and
// for `next/headers`, neither of which exists in a unit test. What is being
// verified here is the resolution ORDER and the caching rule, which is exactly
// where a tenant leak would hide.

import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "c0f283a3-2e96-4f62-86a5-d46f04e9a18b"; // Bhoomi Dwellers
const ORG_B = "11111111-2222-3333-4444-555555555555"; // a second tenant

const getServerSession = vi.fn();
const poolQuery = vi.fn();

vi.mock("./serverAuth", () => ({ getServerSession }));
vi.mock("./db", () => ({ getPool: () => ({ query: poolQuery }) }));

async function freshModule() {
  vi.resetModules();
  return import("./tenantContext");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: one organization in the database, as production has today.
  poolQuery.mockResolvedValue({ rows: [{ id: ORG_A }] });
  getServerSession.mockResolvedValue(null);
});

describe("session claim takes precedence", () => {
  it("resolves from the session's org claim without querying the database", async () => {
    getServerSession.mockResolvedValue({ _id: "1", role: "Admin", org: ORG_B });
    const { getOrganizationId } = await freshModule();

    await expect(getOrganizationId()).resolves.toBe(ORG_B);
    // The point of the claim is that it answers on its own.
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("keeps working when a SECOND organization exists — the MT-05 headline", async () => {
    // Two organizations. Pre-MT-05 this threw for every caller.
    poolQuery.mockResolvedValue({ rows: [{ id: ORG_A }, { id: ORG_B }] });
    getServerSession.mockResolvedValue({ _id: "7", role: "Admin", org: ORG_B });

    const { getOrganizationId } = await freshModule();
    await expect(getOrganizationId()).resolves.toBe(ORG_B);
  });

  it("gives two concurrent users their OWN organization, not a cached one", async () => {
    // The regression this guards: caching a per-request value in module scope
    // would serve the first user's tenant to the second.
    const { getOrganizationId, clearTenantCache } = await freshModule();
    clearTenantCache();

    getServerSession.mockResolvedValue({ _id: "1", role: "Admin", org: ORG_A });
    await expect(getOrganizationId()).resolves.toBe(ORG_A);

    getServerSession.mockResolvedValue({ _id: "2", role: "Admin", org: ORG_B });
    await expect(getOrganizationId()).resolves.toBe(ORG_B);
  });
});

describe("fallback for sessionless callers", () => {
  it("falls back to the sole organization when there is no session", async () => {
    // login notifications, provider webhooks, scripts.
    const { getOrganizationId } = await freshModule();
    await expect(getOrganizationId()).resolves.toBe(ORG_A);
  });

  it("falls back when the session carries no org claim (pre-MT-05 cookie)", async () => {
    getServerSession.mockResolvedValue({ _id: "1", role: "Admin" });
    const { getOrganizationId } = await freshModule();
    await expect(getOrganizationId()).resolves.toBe(ORG_A);
  });

  it("falls back rather than crashing when there is no request context", async () => {
    // `cookies()` throws outside a request scope; that must degrade, not fail.
    getServerSession.mockRejectedValue(new Error("called outside a request scope"));
    const { getOrganizationId } = await freshModule();
    await expect(getOrganizationId()).resolves.toBe(ORG_A);
  });

  it("ignores a malformed org claim instead of using it as a tenant id", async () => {
    getServerSession.mockResolvedValue({ _id: "1", role: "Admin", org: "'; DROP TABLE users--" });
    const { getOrganizationId } = await freshModule();
    await expect(getOrganizationId()).resolves.toBe(ORG_A);
  });
});

describe("fails loudly rather than guessing", () => {
  it("throws when a sessionless caller faces more than one organization", async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: ORG_A }, { id: ORG_B }] });
    const { getOrganizationId } = await freshModule();
    await expect(getOrganizationId()).rejects.toThrow(/more than one organization/i);
  });

  it("throws when no organization exists at all", async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    const { getOrganizationId } = await freshModule();
    await expect(getOrganizationId()).rejects.toThrow(/no organization exists/i);
  });
});
