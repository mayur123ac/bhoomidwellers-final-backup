// @vitest-environment node
//
// Integration tests for CP registration attribution (registered_by_user_id)
// and tenant isolation on the channel-partners POST / PATCH routes.
//
// ── Running ──────────────────────────────────────────────────────────────
//   PLATFORM_TEST_DATABASE_URL=<postgres url> npx vitest run \
//     src/app/api/channel-partners/cpRegistration.integration.test.ts
//
// Skipped without that variable so `npm test` doesn't need a database.
// Creates scratch orgs + users, works only inside them, and cleans up.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.PLATFORM_TEST_DATABASE_URL;
const describeIfDb = TEST_DB ? describe : describe.skip;

if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.ALLOW_PROD_DB_IN_DEV ||= "1";
process.env.SESSION_SECRET ||= "integration-test-secret-not-a-real-one";

const ORG_A = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb";

let sessionCookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === "crm_session" && sessionCookie ? { name: n, value: sessionCookie } : undefined,
  }),
  headers: async () => new Headers(),
}));

describeIfDb("CP registration attribution + tenant isolation", () => {
  let db: import("pg").Pool;
  let receptionistA: number;
  let receptionistB: number;
  let adminA: number;
  let sourcingMgrA: number;

  async function signInAs(user: { id: number; name: string; email: string; role: string; org?: string }) {
    const { signSession } = await import("@/lib/sessionCookie");
    const value = await signSession({
      _id: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: true,
      org: user.org,
    });
    if (!value) throw new Error("SESSION_SECRET missing");
    sessionCookie = value;
    return value;
  }

  async function seed() {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await cleanup(c);

      await c.query(
        `INSERT INTO organizations (id, name, slug, status)
         VALUES ($1, 'CP Test Org A', 'cp-test-org-a', 'active'),
                ($2, 'CP Test Org B', 'cp-test-org-b', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [ORG_A, ORG_B],
      );

      const mkUser = async (
        name: string,
        email: string,
        role: string,
        org: string,
      ) =>
        (
          await c.query(
            `INSERT INTO users (name, email, role, organization_id, password, is_active)
             VALUES ($1, $2, $3, $4, 'scrypt$placeholder', true) RETURNING id`,
            [name, email, role, org],
          )
        ).rows[0].id as number;

      receptionistA = await mkUser("ZZ CP Receptionist A", "zz-cp-recep-a@example.test", "Receptionist", ORG_A);
      receptionistB = await mkUser("ZZ CP Receptionist B", "zz-cp-recep-b@example.test", "Receptionist", ORG_B);
      adminA = await mkUser("ZZ CP Admin A", "zz-cp-admin-a@example.test", "Admin", ORG_A);
      sourcingMgrA = await mkUser("ZZ CP Sourcing A", "zz-cp-sourcing-a@example.test", "Sourcing Manager", ORG_A);

      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  async function cleanup(c: import("pg").PoolClient) {
    // Child-first deletion of test rows
    await c.query(
      `DELETE FROM channel_partners
        WHERE organization_id IN ($1, $2)
          AND name LIKE 'ZZ CP Test %'`,
      [ORG_A, ORG_B],
    );
    await c.query(
      `DELETE FROM users WHERE email LIKE 'zz-cp-%@example.test'`,
    );
    await c.query(
      `DELETE FROM organizations WHERE id IN ($1, $2)`,
      [ORG_A, ORG_B],
    );
  }

  beforeAll(async () => {
    const { Pool } = await import("pg");
    const isLocalhost = TEST_DB!.includes("localhost") || TEST_DB!.includes("127.0.0.1");
    db = new Pool({
      connectionString: TEST_DB,
      ...(isLocalhost ? {} : { ssl: { rejectUnauthorized: false } }),
    });
    await seed();
  });

  afterAll(async () => {
    if (db) {
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        await cleanup(c);
        await c.query("COMMIT");
      } finally {
        c.release();
      }
      await db.end();
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function postCP(body: Record<string, unknown>) {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/channel-partners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    return { status: res.status, body: await res.json() };
  }

  async function patchCP(id: number, body: Record<string, unknown>) {
    const { NextRequest } = await import("next/server");
    const { PATCH } = await import("./[id]/route");
    const req = new NextRequest(`http://localhost/api/channel-partners/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(id) }) });
    return { status: res.status, body: await res.json() };
  }

  /** Read CP directly from DB to verify server-side attribution. */
  async function getCP(id: number) {
    const rows = await db.query(
      `SELECT * FROM channel_partners WHERE id = $1`,
      [id],
    );
    return rows.rows[0] ?? null;
  }

  // ── Test 1: New registration saves correct employee ID ──────────────────

  it("saves registered_by_user_id from the authenticated session on new registration", async () => {
    await signInAs({
      id: receptionistA, name: "ZZ CP Receptionist A",
      email: "zz-cp-recep-a@example.test", role: "Receptionist", org: ORG_A,
    });
    const res = await postCP({ name: "ZZ CP Test Partner Alpha", phone: "9000000001" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const cp = await getCP(res.body.data.id);
    expect(cp).not.toBeNull();
    expect(cp.registered_by_user_id).toBe(receptionistA);
    expect(cp.organization_id).toBe(ORG_A);
  });

  // ── Test 2: Tenant B gets its own org ID and employee ID ────────────────

  it("Tenant B registration gets Tenant B org + employee", async () => {
    await signInAs({
      id: receptionistB, name: "ZZ CP Receptionist B",
      email: "zz-cp-recep-b@example.test", role: "Receptionist", org: ORG_B,
    });
    const res = await postCP({ name: "ZZ CP Test Partner Beta", phone: "9000000002" });
    expect(res.status).toBe(201);

    const cp = await getCP(res.body.data.id);
    expect(cp.registered_by_user_id).toBe(receptionistB);
    expect(cp.organization_id).toBe(ORG_B);
  });

  // ── Test 3: Client cannot spoof registered_by_user_id ───────────────────

  it("ignores a client-supplied registered_by_user_id", async () => {
    await signInAs({
      id: receptionistA, name: "ZZ CP Receptionist A",
      email: "zz-cp-recep-a@example.test", role: "Receptionist", org: ORG_A,
    });
    const res = await postCP({
      name: "ZZ CP Test Partner Gamma",
      phone: "9000000003",
      registered_by_user_id: receptionistB, // forged
    });
    expect(res.status).toBe(201);

    const cp = await getCP(res.body.data.id);
    // Must be the actual session user, not the forged value
    expect(cp.registered_by_user_id).toBe(receptionistA);
  });

  // ── Test 4: Editing preserves original creator ──────────────────────────

  it("PATCH does not overwrite registered_by_user_id", async () => {
    // Create as receptionist A
    await signInAs({
      id: receptionistA, name: "ZZ CP Receptionist A",
      email: "zz-cp-recep-a@example.test", role: "Receptionist", org: ORG_A,
    });
    const createRes = await postCP({ name: "ZZ CP Test Partner Delta", phone: "9000000004" });
    expect(createRes.status).toBe(201);
    const cpId = createRes.body.data.id;

    // Edit as admin A
    await signInAs({
      id: adminA, name: "ZZ CP Admin A",
      email: "zz-cp-admin-a@example.test", role: "Admin", org: ORG_A,
    });
    const patchRes = await patchCP(cpId, {
      company_name: "Updated Corp",
      registered_by_user_id: adminA, // attempt to overwrite
    });
    expect(patchRes.status).toBe(200);

    const cp = await getCP(cpId);
    // Original creator preserved
    expect(cp.registered_by_user_id).toBe(receptionistA);
    expect(cp.company_name).toBe("Updated Corp");
  });

  // ── Test 5: Duplicate-phone merge preserves original creator ────────────

  it("merge (allow_merge) preserves the original registered_by_user_id", async () => {
    // Create first with receptionist A
    await signInAs({
      id: receptionistA, name: "ZZ CP Receptionist A",
      email: "zz-cp-recep-a@example.test", role: "Receptionist", org: ORG_A,
    });
    const createRes = await postCP({ name: "ZZ CP Test Partner Epsilon", phone: "9000000005" });
    expect(createRes.status).toBe(201);
    const cpId = createRes.body.data.id;

    // Merge attempt by admin A with same phone
    await signInAs({
      id: adminA, name: "ZZ CP Admin A",
      email: "zz-cp-admin-a@example.test", role: "Admin", org: ORG_A,
    });
    const mergeRes = await postCP({
      name: "ZZ CP Test Partner Epsilon Dup",
      phone: "9000000005",
      allow_merge: true,
      office_address: "123 Merge St",
    });
    expect(mergeRes.status).toBe(200);
    expect(mergeRes.body.merged).toBe(true);

    const cp = await getCP(cpId);
    // Original creator preserved, profile topped up
    expect(cp.registered_by_user_id).toBe(receptionistA);
    expect(cp.office_address).toBe("123 Merge St");
  });

  // ── Test 6: Cross-tenant duplicate phone does not leak ──────────────────

  it("duplicate phone in another tenant does not trigger cross-tenant disclosure", async () => {
    // Register in Org A
    await signInAs({
      id: receptionistA, name: "ZZ CP Receptionist A",
      email: "zz-cp-recep-a@example.test", role: "Receptionist", org: ORG_A,
    });
    await postCP({ name: "ZZ CP Test Partner Zeta", phone: "9000000006" });

    // Register same phone in Org B — should succeed as a new partner, no merge
    await signInAs({
      id: receptionistB, name: "ZZ CP Receptionist B",
      email: "zz-cp-recep-b@example.test", role: "Receptionist", org: ORG_B,
    });
    const res = await postCP({ name: "ZZ CP Test Partner Zeta B", phone: "9000000006" });
    expect(res.status).toBe(201);
    expect(res.body.merged).toBe(false);

    const cp = await getCP(res.body.data.id);
    expect(cp.organization_id).toBe(ORG_B);
    expect(cp.registered_by_user_id).toBe(receptionistB);
  });

  // ── Test 7: Tenant A cannot PATCH Tenant B's CP ─────────────────────────

  it("PATCH from another tenant returns 404", async () => {
    // Create in Org B
    await signInAs({
      id: receptionistB, name: "ZZ CP Receptionist B",
      email: "zz-cp-recep-b@example.test", role: "Receptionist", org: ORG_B,
    });
    const createRes = await postCP({ name: "ZZ CP Test Partner Eta", phone: "9000000007" });
    expect(createRes.status).toBe(201);
    const cpId = createRes.body.data.id;

    // Try to edit from Org A (admin)
    await signInAs({
      id: adminA, name: "ZZ CP Admin A",
      email: "zz-cp-admin-a@example.test", role: "Admin", org: ORG_A,
    });
    const patchRes = await patchCP(cpId, { company_name: "Hacked" });
    expect(patchRes.status).toBe(404);

    // Verify untouched
    const cp = await getCP(cpId);
    expect(cp.company_name).not.toBe("Hacked");
  });

  // ── Test 8: Existing historical records keep null attribution ───────────

  it("existing records with null registered_by_user_id remain valid", async () => {
    // Insert directly without registered_by_user_id
    const ins = await db.query(
      `INSERT INTO channel_partners (name, phone, organization_id, status, created_by, updated_by)
       VALUES ('ZZ CP Test Partner Theta', '9000000008', $1, 'active', 'legacy', 'legacy')
       RETURNING id`,
      [ORG_A],
    );
    const cpId = ins.rows[0].id;

    const cp = await getCP(cpId);
    expect(cp.registered_by_user_id).toBeNull();
    expect(cp.name).toBe("ZZ CP Test Partner Theta");
  });

  // ── Test 9: Unauthenticated request is rejected ─────────────────────────

  it("rejects unauthenticated requests", async () => {
    sessionCookie = undefined;
    const res = await postCP({ name: "ZZ CP Test Partner Anon", phone: "9000000009" });
    expect(res.status).toBe(401);
  });
});
