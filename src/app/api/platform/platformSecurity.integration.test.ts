// @vitest-environment node
//
// End-to-end coverage for the Super Admin master controls, against a real
// Postgres. These are the assertions the brief's acceptance lists ask for and
// that no unit test can make, because every one of them is about what actually
// reaches the database or the wire:
//
//   * one organization's users never appear in another's response
//   * no password, in any form, is ever returned
//   * "logged in" tracks live sessions, not last_login_at
//   * force logout REVOKES — the target's existing session stops working
//   * a tenant Admin cannot call any of these endpoints
//   * a draft update is invisible to CRM users; a published one is unread
//   * marking read affects exactly one person
//   * unpublish removes it from the feed and keeps the record
//
// ── Running it ──────────────────────────────────────────────────────────────
//   PLATFORM_TEST_DATABASE_URL=<postgres url> npx vitest run \
//     src/app/api/platform/platformSecurity.integration.test.ts
//
// Skipped without that variable, so a normal `npm test` does not need a
// database. Unlike the inventory suites this one does NOT wipe anything: it
// creates two scratch organizations with fixed UUIDs, works only inside them,
// and deletes exactly what it created in afterAll. That makes it safe to point
// at a shared development branch.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.PLATFORM_TEST_DATABASE_URL;
const describeIfDb = TEST_DB ? describe : describe.skip;

if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
// The pool refuses production endpoints in dev; a scratch URL is not one, but
// the flag keeps the suite runnable against any branch the operator chooses.
process.env.ALLOW_PROD_DB_IN_DEV ||= "1";
process.env.SESSION_SECRET ||= "integration-test-secret-not-a-real-one";

const ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

let sessionCookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === "crm_session" && sessionCookie ? { name: n, value: sessionCookie } : undefined,
  }),
  headers: async () => new Headers(),
}));

interface Ids {
  superAdmin: number;
  adminA: number;
  employeeA: number;
  employeeB: number;
  sessionA: number;
}

describeIfDb("Super Admin master controls", () => {
  let db: import("pg").Pool;
  let ids: Ids;

  /** Signs a cookie for a given identity. `iat` is stamped by signSession. */
  async function signInAs(user: { id: number; name: string; role: string; org?: string }) {
    const { signSession } = await import("@/lib/sessionCookie");
    const value = await signSession({
      _id: String(user.id),
      name: user.name,
      role: user.role,
      isActive: true,
      org: user.org,
    });
    if (!value) throw new Error("SESSION_SECRET missing");
    sessionCookie = value;
    return value;
  }

  /**
   * Sleeps until the current whole second has elapsed.
   *
   * sessionRevocationNow() stamps the next second boundary so a revocation
   * unambiguously covers everything issued in the second it happened. Tests
   * that assert a SUBSEQUENT sign-in works must therefore start that sign-in
   * in a later second, or they are asserting against the fail-closed window.
   */
  async function waitPastRevocationBoundary() {
    const nextBoundary = (Math.floor(Date.now() / 1000) + 1) * 1000;
    await new Promise((r) => setTimeout(r, Math.max(0, nextBoundary - Date.now()) + 50));
  }

  async function seed(): Promise<Ids> {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await cleanup(c);

      await c.query(
        `INSERT INTO organizations (id, name, slug, status)
         VALUES ($1, 'Scratch Org A', 'scratch-org-a', 'active'),
                ($2, 'Scratch Org B', 'scratch-org-b', 'active')`,
        [ORG_A, ORG_B],
      );

      const mkUser = async (
        name: string,
        email: string,
        role: string,
        org: string | null,
        password: string | null,
      ) =>
        (
          await c.query(
            `INSERT INTO users (name, email, role, organization_id, password, is_active)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [name, email, role, org, password],
          )
        ).rows[0].id as number;

      // The platform operator: organization_id IS NULL is half of what makes it
      // platform level, and the gate demands it.
      const superAdmin = await mkUser(
        "ZZ Scratch Platform", "zz-scratch-platform@example.test", "super_admin", null, "scrypt$placeholder",
      );
      const adminA = await mkUser(
        "ZZ Scratch Admin A", "zz-scratch-admin-a@example.test", "Admin", ORG_A, "scrypt$placeholder",
      );
      const employeeA = await mkUser(
        "ZZ Scratch Employee A", "zz-scratch-emp-a@example.test", "Sales Manager", ORG_A, "scrypt$placeholder",
      );
      // Deliberately has NO password, so the password-status branch is exercised
      // in both directions.
      const employeeB = await mkUser(
        "ZZ Scratch Employee B", "zz-scratch-emp-b@example.test", "Sales Manager", ORG_B, null,
      );

      // A live session for employee A: active, heartbeat a moment ago. This is
      // what "currently logged in" must be computed from.
      const sessionA = (
        await c.query(
          `INSERT INTO employee_sessions
             (user_id, session_start, last_heartbeat, ip_address, device_info, is_active, organization_id)
           VALUES ($1, now() - interval '10 minutes', now(), '127.0.0.1', 'Windows PC / Chrome', true, $2)
           RETURNING id`,
          [employeeA, ORG_A],
        )
      ).rows[0].id as number;

      // Employee B is signed in too — in the OTHER organization. Nothing about
      // them may appear in an Org A response.
      await c.query(
        `INSERT INTO employee_sessions
           (user_id, session_start, last_heartbeat, is_active, organization_id)
         VALUES ($1, now() - interval '5 minutes', now(), true, $2)`,
        [employeeB, ORG_B],
      );

      // A stale login for admin A: last_login_at set, but no live session. If
      // login status were inferred from last_login_at this row would read online.
      await c.query(`UPDATE users SET last_login_at = now() - interval '3 days' WHERE id = $1`, [adminA]);

      await c.query("COMMIT");
      return { superAdmin, adminA, employeeA, employeeB, sessionA };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  /** Removes only this suite's rows, child-first. */
  async function cleanup(c: import("pg").PoolClient) {
    await c.query(
      `DELETE FROM crm_update_reads
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'zz-scratch-%@example.test')`,
    );
    await c.query(`DELETE FROM crm_updates WHERE version LIKE 'zz-scratch-%'`);
    await c.query(
      `DELETE FROM audit_logs
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'zz-scratch-%@example.test')`,
    );
    await c.query(`DELETE FROM employee_sessions WHERE organization_id IN ($1, $2)`, [ORG_A, ORG_B]);
    // Also by user: the platform account's session rows carry organization_id
    // NULL, so the tenant-scoped delete above cannot reach them.
    await c.query(
      `DELETE FROM employee_sessions
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'zz-scratch-%@example.test')`,
    );
    await c.query(
      `DELETE FROM employee_live_state
        WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'zz-scratch-%@example.test')`,
    );
    await c.query(`DELETE FROM roles WHERE organization_id IN ($1, $2)`, [ORG_A, ORG_B]);
    await c.query(`DELETE FROM users WHERE email LIKE 'zz-scratch-%@example.test'`);
    await c.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [ORG_A, ORG_B]);
  }

  beforeAll(async () => {
    const { Pool } = await import("pg");
    db = new Pool({ connectionString: TEST_DB });
  });

  afterAll(async () => {
    const c = await db.connect();
    try { await cleanup(c); } finally { c.release(); }
    await db.end();
    const { getPool } = await import("@/lib/db");
    await getPool().end();
  });

  beforeEach(async () => {
    ids = await seed();
    // The tenant cache memoises "the sole organization"; two scratch tenants
    // exist now, so a stale entry would resolve the wrong one.
    const { clearTenantCache } = await import("@/lib/tenantContext");
    clearTenantCache();
  });

  /* ══ ORGANIZATION USERS ══════════════════════════════════════════════════*/

  async function orgUsers(orgId: string) {
    const { GET } = await import("./organizations/[id]/users/route");
    const res = await GET(
      new Request(`http://t/api/platform/organizations/${orgId}/users`) as any,
      { params: Promise.resolve({ id: orgId }) },
    );
    return { status: res.status, json: await res.json() };
  }

  it("returns only the selected organization's users", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });

    const a = await orgUsers(ORG_A);
    expect(a.json.success).toBe(true);
    const namesA = a.json.data.users.map((u: any) => u.name).sort();
    expect(namesA).toEqual(["ZZ Scratch Admin A", "ZZ Scratch Employee A"]);

    // The whole point of the isolation requirement: not merely hidden, absent
    // from the payload entirely.
    expect(JSON.stringify(a.json)).not.toContain("Employee B");
    expect(JSON.stringify(a.json)).not.toContain(ORG_B);

    const b = await orgUsers(ORG_B);
    expect(b.json.data.users.map((u: any) => u.name)).toEqual(["ZZ Scratch Employee B"]);
    expect(JSON.stringify(b.json)).not.toContain("Employee A");
  });

  it("never returns a password or a hash, in any field", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { json } = await orgUsers(ORG_A);
    const payload = JSON.stringify(json);

    expect(payload).not.toContain("scrypt$");
    expect(payload).not.toContain("placeholder");
    // No key called password/hash/token anywhere in the tree.
    expect(payload).not.toMatch(/"password"\s*:/);
    expect(payload).not.toMatch(/"hash"\s*:/);
    expect(payload).not.toMatch(/"(access|refresh)_?[Tt]oken"\s*:/);

    // What it DOES carry is a status string, and only these two values.
    for (const u of json.data.users) {
      expect(["set", "not_set"]).toContain(u.passwordStatus);
    }
  });

  it("reports a password status without the value, in both directions", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const a = await orgUsers(ORG_A);
    const b = await orgUsers(ORG_B);
    expect(a.json.data.users.every((u: any) => u.passwordStatus === "set")).toBe(true);
    // Employee B was seeded with no password at all.
    expect(b.json.data.users[0].passwordStatus).toBe("not_set");
  });

  it("derives login status from live sessions, not last_login_at", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { json } = await orgUsers(ORG_A);
    const byName = Object.fromEntries(json.data.users.map((u: any) => [u.name, u]));

    // Live heartbeat → online, with the session start exposed as "current login".
    expect(byName["ZZ Scratch Employee A"].loginStatus).toBe("online");
    expect(byName["ZZ Scratch Employee A"].currentLoginAt).toBeTruthy();
    expect(byName["ZZ Scratch Employee A"].activeSessions).toBe(1);

    // Signed in three days ago, no session row → offline. The trap the brief
    // names: last_login_at is set and must NOT make this read as logged in.
    expect(byName["ZZ Scratch Admin A"].lastLoginAt).toBeTruthy();
    expect(byName["ZZ Scratch Admin A"].loginStatus).toBe("offline");

    expect(json.data.counts).toMatchObject({ total: 2, active: 2, loggedIn: 1 });
  });

  it("treats a stale heartbeat as offline", async () => {
    await db.query(
      `UPDATE employee_sessions SET last_heartbeat = now() - interval '20 minutes' WHERE id = $1`,
      [ids.sessionA],
    );
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { json } = await orgUsers(ORG_A);
    const emp = json.data.users.find((u: any) => u.name === "ZZ Scratch Employee A");
    expect(emp.loginStatus).toBe("offline");
    expect(json.data.counts.loggedIn).toBe(0);
  });

  it("refuses a tenant Admin", async () => {
    await signInAs({ id: ids.adminA, name: "ZZ Scratch Admin A", role: "admin", org: ORG_A });
    const { status, json } = await orgUsers(ORG_A);
    expect(status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.data).toBeUndefined();
  });

  it("refuses an unauthenticated caller", async () => {
    sessionCookie = undefined;
    const { status } = await orgUsers(ORG_A);
    expect(status).toBe(401);
  });

  /* ══ FORCE LOGOUT ════════════════════════════════════════════════════════*/

  async function userAction(userId: number, body: Record<string, unknown>) {
    const { PATCH } = await import("./users/[id]/route");
    const res = await PATCH(
      new Request(`http://t/api/platform/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as any,
      { params: Promise.resolve({ id: String(userId) }) },
    );
    return { status: res.status, json: await res.json() };
  }

  it("force logout revokes the target's existing session server-side", async () => {
    // The employee is signed in and their session works.
    const employeeCookie = await signInAs({
      id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A,
    });
    const { requireSession } = await import("@/lib/serverAuth");
    expect((await requireSession()).ok).toBe(true);

    // Super Admin signs them out.
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { status, json } = await userAction(ids.employeeA, { action: "forceLogout" });
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // The SAME cookie, replayed. This is the assertion that separates a real
    // revocation from a frontend flag: nothing about the browser changed, and
    // the gate every CRM route goes through now refuses it.
    sessionCookie = employeeCookie;
    const after = await requireSession();
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.response.status).toBe(401);

    // And the tracked session is closed, so the panels agree.
    const row = await db.query(
      `SELECT is_active, session_end_reason FROM employee_sessions WHERE id = $1`,
      [ids.sessionA],
    );
    expect(row.rows[0].is_active).toBe(false);
    expect(row.rows[0].session_end_reason).toBe("super_admin_force_logout");
  });

  it("shows the user as offline afterwards, and lets them sign back in", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    await userAction(ids.employeeA, { action: "forceLogout" });

    const { json } = await orgUsers(ORG_A);
    const emp = json.data.users.find((u: any) => u.name === "ZZ Scratch Employee A");
    expect(emp.loginStatus).toBe("offline");

    // A NEW session, issued after the revocation, must work — otherwise force
    // logout would be a permanent lockout rather than a sign-out.
    //
    // The wait is deliberate and is not a sleep-until-it-passes. `iat` is whole
    // seconds, so sessionRevocationNow() stamps the NEXT second boundary in
    // order to fail closed: every session issued during the current second —
    // the set that existed when the operator clicked — is refused. Signing back
    // in during that same second is therefore refused too, by design, and the
    // unit suite pins that half explicitly. What matters here is the durable
    // guarantee, so the test crosses the boundary rather than racing it. Without
    // this the assertion passed or failed depending on how long the two
    // preceding round trips happened to take.
    await waitPastRevocationBoundary();

    await signInAs({ id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A });
    const { requireSession } = await import("@/lib/serverAuth");
    expect((await requireSession()).ok).toBe(true);
  });

  it("cannot be aimed at another organization's user by id", async () => {
    // There is nowhere in the request to put an organization, so the tenant is
    // always the target's own. This pins that the id alone cannot be misused:
    // employee B is reachable, but only ever inside org B.
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    await userAction(ids.employeeB, { action: "forceLogout" });

    const closed = await db.query(
      `SELECT count(*)::int AS n FROM employee_sessions
        WHERE organization_id = $1 AND is_active = false`,
      [ORG_B],
    );
    expect(closed.rows[0].n).toBe(1);

    // Org A's session is untouched.
    const stillOpen = await db.query(
      `SELECT is_active FROM employee_sessions WHERE id = $1`, [ids.sessionA],
    );
    expect(stillOpen.rows[0].is_active).toBe(true);
  });

  it("refuses force logout from a tenant Admin", async () => {
    await signInAs({ id: ids.adminA, name: "ZZ Scratch Admin A", role: "admin", org: ORG_A });
    const { status } = await userAction(ids.employeeA, { action: "forceLogout" });
    expect(status).toBe(403);
    const row = await db.query(`SELECT is_active FROM employee_sessions WHERE id = $1`, [ids.sessionA]);
    expect(row.rows[0].is_active).toBe(true);
  });

  it("cannot target a platform account", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    // The route only sees users with an organization, so the Super Admin's own
    // row is not addressable through it — no self-lockout, no peer takeover.
    const { status } = await userAction(ids.superAdmin, { action: "forceLogout" });
    expect(status).toBe(404);
  });

  /* ══ PASSWORD AND EMAIL ══════════════════════════════════════════════════*/

  it("hashes a new password, never stores plaintext, and revokes sessions", async () => {
    const employeeCookie = await signInAs({
      id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A,
    });

    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { status, json } = await userAction(ids.employeeA, {
      action: "changePassword",
      newPassword: "Str0ng!Passw0rd",
      confirmPassword: "Str0ng!Passw0rd",
    });
    expect(status).toBe(200);
    // The response says what happened and carries nothing else.
    expect(JSON.stringify(json)).not.toContain("Str0ng!Passw0rd");

    const row = await db.query(
      `SELECT password, password_changed_at FROM users WHERE id = $1`, [ids.employeeA],
    );
    const stored = row.rows[0].password as string;
    expect(stored).not.toBe("Str0ng!Passw0rd");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(row.rows[0].password_changed_at).toBeTruthy();

    // The new password verifies through the project's own verifier — i.e. the
    // employee can actually sign in with it.
    const { verifyPassword } = await import("@/lib/passwords");
    expect(await verifyPassword("Str0ng!Passw0rd", stored)).toBe(true);
    expect(await verifyPassword("wrong-password", stored)).toBe(false);

    // Existing sessions are gone, which is the app's established policy for a
    // password change.
    sessionCookie = employeeCookie;
    const { requireSession } = await import("@/lib/serverAuth");
    expect((await requireSession()).ok).toBe(false);
  });

  it("enforces the project's password rules and the confirmation", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });

    const weak = await userAction(ids.employeeA, {
      action: "changePassword", newPassword: "abc", confirmPassword: "abc",
    });
    expect(weak.status).toBe(400);

    const mismatch = await userAction(ids.employeeA, {
      action: "changePassword", newPassword: "Str0ng!Passw0rd", confirmPassword: "Str0ng!Passw0rZ",
    });
    expect(mismatch.status).toBe(400);

    // Neither attempt wrote anything.
    const row = await db.query(`SELECT password FROM users WHERE id = $1`, [ids.employeeA]);
    expect(row.rows[0].password).toBe("scrypt$placeholder");
  });

  it("changes an email and enforces global identifier uniqueness", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });

    const ok = await userAction(ids.employeeA, {
      action: "changeEmail", newEmail: "zz-scratch-renamed@example.test",
    });
    expect(ok.status).toBe(200);
    const row = await db.query(`SELECT email FROM users WHERE id = $1`, [ids.employeeA]);
    expect(row.rows[0].email).toBe("zz-scratch-renamed@example.test");

    // Taken by a user in ANOTHER organization. Email is a login identifier and
    // is unique platform-wide, so this must be refused rather than scoped away.
    const clash = await userAction(ids.employeeA, {
      action: "changeEmail", newEmail: "zz-scratch-emp-b@example.test",
    });
    expect(clash.status).toBe(409);

    const bad = await userAction(ids.employeeA, { action: "changeEmail", newEmail: "not-an-email" });
    expect(bad.status).toBe(400);
  });

  it("audits every security action, without recording the credential", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    await userAction(ids.employeeA, {
      action: "changePassword", newPassword: "Str0ng!Passw0rd", confirmPassword: "Str0ng!Passw0rd",
    });
    await userAction(ids.employeeA, { action: "forceLogout" });

    const rows = await db.query(
      `SELECT action, new_value FROM audit_logs WHERE user_id = $1 ORDER BY id`, [ids.superAdmin],
    );
    const actions = rows.rows.map((r: any) => r.action);
    expect(actions).toContain("platform.user.password_change");
    expect(actions).toContain("platform.user.force_logout");

    const blob = JSON.stringify(rows.rows);
    expect(blob).not.toContain("Str0ng!Passw0rd");
    expect(blob).not.toContain("scrypt$");
    // The target is identified, which is the point of the trail.
    expect(blob).toContain("ZZ Scratch Employee A");
  });

  /* ══ DEACTIVATION ════════════════════════════════════════════════════════*/

  it("deactivating signs the user out and blocks their session", async () => {
    const employeeCookie = await signInAs({
      id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A,
    });
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });

    const { status } = await userAction(ids.employeeA, { action: "setStatus", isActive: false });
    expect(status).toBe(200);

    const row = await db.query(
      `SELECT is_active, deactivated_at FROM users WHERE id = $1`, [ids.employeeA],
    );
    expect(row.rows[0].is_active).toBe(false);
    expect(row.rows[0].deactivated_at).toBeTruthy();

    sessionCookie = employeeCookie;
    const { requireSession } = await import("@/lib/serverAuth");
    expect((await requireSession()).ok).toBe(false);
  });

  it("refuses to deactivate an organization's last Admin", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { status, json } = await userAction(ids.adminA, { action: "setStatus", isActive: false });
    expect(status).toBe(409);
    expect(json.message).toMatch(/only active Admin/i);

    const row = await db.query(`SELECT is_active FROM users WHERE id = $1`, [ids.adminA]);
    expect(row.rows[0].is_active).toBe(true);
  });

  /* ══ ORGANIZATION SUSPENSION ═════════════════════════════════════════════*/

  it("suspending signs out the whole tenant and leaves the other one alone", async () => {
    const employeeCookie = await signInAs({
      id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A,
    });
    const otherCookie = await signInAs({
      id: ids.employeeB, name: "ZZ Scratch Employee B", role: "sales manager", org: ORG_B,
    });

    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { PATCH } = await import("./organizations/[id]/route");
    const res = await PATCH(
      new Request(`http://t/api/platform/organizations/${ORG_A}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "suspended" }),
      }) as any,
      { params: Promise.resolve({ id: ORG_A }) },
    );
    expect(res.status).toBe(200);

    const { requireSession } = await import("@/lib/serverAuth");
    sessionCookie = employeeCookie;
    expect((await requireSession()).ok).toBe(false);

    // Org B is untouched — suspension is not a platform-wide switch.
    sessionCookie = otherCookie;
    expect((await requireSession()).ok).toBe(true);
  });

  /* ══ LOGOUT ══════════════════════════════════════════════════════════════*/

  it("closes a platform account's session on logout, with several tenants present", async () => {
    // The regression this pins, found in production on 2026-08-24: logout called
    // getOrganizationId(), which for a Super Admin has no `org` claim to read and
    // falls back to "the only organization" — a fallback that throws once a
    // second tenant exists. The throw was swallowed, the cookie was cleared, and
    // the session row stayed open forever. Fourteen had piled up.
    //
    // Two scratch organizations exist in this fixture, so the old code path is
    // exercised exactly as production hit it.
    const sessionId = (
      await db.query(
        `INSERT INTO employee_sessions
           (user_id, session_start, last_heartbeat, is_active, organization_id)
         VALUES ($1, now() - interval '1 minute', now(), true, NULL)
         RETURNING id`,
        [ids.superAdmin],
      )
    ).rows[0].id as number;

    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { POST } = await import("../auth/logout/route");
    const res = await POST(new Request("http://t/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);

    const row = await db.query(
      `SELECT is_active, session_end FROM employee_sessions WHERE id = $1`,
      [sessionId],
    );
    // The whole point: NULL organization_id and all, the row is closed.
    expect(row.rows[0].is_active).toBe(false);
    expect(row.rows[0].session_end).toBeTruthy();
  });

  it("closes a tenant user's session without touching another tenant's", async () => {
    await signInAs({
      id: ids.employeeB, name: "ZZ Scratch Employee B", role: "sales manager", org: ORG_B,
    });
    const { POST } = await import("../auth/logout/route");
    await POST(new Request("http://t/api/auth/logout", { method: "POST" }));

    const b = await db.query(
      `SELECT count(*)::int n FROM employee_sessions
        WHERE organization_id = $1 AND is_active = true`, [ORG_B],
    );
    expect(b.rows[0].n).toBe(0);

    // Org A's live session is untouched — the scoping is still real.
    const a = await db.query(`SELECT is_active FROM employee_sessions WHERE id = $1`, [ids.sessionA]);
    expect(a.rows[0].is_active).toBe(true);
  });

  /* ══ SYSTEM UPDATES ══════════════════════════════════════════════════════*/

  async function createUpdate(publish: boolean, version: string, title: string) {
    const { POST } = await import("./updates/route");
    const res = await POST(
      new Request("http://t/api/platform/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version, title, type: "Feature", description: "Body **text**.",
          features: ["one", "two"], publish,
        }),
      }) as any,
    );
    return { status: res.status, json: await res.json() };
  }

  async function userFeed() {
    const { GET } = await import("../updates/route");
    const res = await GET();
    return { status: res.status, json: await res.json() };
  }

  async function markRead(updateId: number) {
    const { POST } = await import("../updates/route");
    const res = await POST(
      new Request("http://t/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read", updateId }),
      }),
    );
    return res.status;
  }

  it("keeps a draft out of the user feed entirely", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const created = await createUpdate(false, "zz-scratch-draft", "Scratch Draft Title");
    expect(created.json.data.status).toBe("draft");

    await signInAs({ id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A });
    const feed = await userFeed();
    // Not hidden by the component — never serialised.
    expect(JSON.stringify(feed.json)).not.toContain("Scratch Draft Title");
  });

  it("publishing makes it visible and unread for everyone", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const created = await createUpdate(true, "zz-scratch-pub", "Scratch Published Title");
    const updateId = created.json.data.id as number;
    expect(created.json.data.status).toBe("published");
    expect(created.json.data.publishedAt).toBeTruthy();

    for (const u of [
      { id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A },
      { id: ids.employeeB, name: "ZZ Scratch Employee B", role: "sales manager", org: ORG_B },
    ]) {
      await signInAs(u);
      const feed = await userFeed();
      const row = feed.json.data.find((r: any) => r.id === updateId);
      expect(row).toBeTruthy();
      expect(row.has_read).toBe(false);
    }
  });

  it("marking read affects only the reader", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const created = await createUpdate(true, "zz-scratch-read", "Scratch Read Title");
    const updateId = created.json.data.id as number;

    // Employee A reads it. A Sales Manager, note — the old handler required the
    // Admin role for this and returned 403 to everyone else.
    await signInAs({ id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A });
    expect(await markRead(updateId)).toBe(200);
    const a = await userFeed();
    expect(a.json.data.find((r: any) => r.id === updateId).has_read).toBe(true);

    // Employee B still has it unread.
    await signInAs({ id: ids.employeeB, name: "ZZ Scratch Employee B", role: "sales manager", org: ORG_B });
    const b = await userFeed();
    expect(b.json.data.find((r: any) => r.id === updateId).has_read).toBe(false);

    // One read row, belonging to one person.
    const reads = await db.query(`SELECT user_id FROM crm_update_reads WHERE update_id = $1`, [updateId]);
    expect(reads.rows.map((r: any) => r.user_id)).toEqual([ids.employeeA]);
  });

  it("unpublish removes it from the feed and keeps the record and the read marks", async () => {
    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const created = await createUpdate(true, "zz-scratch-unpub", "Scratch Unpublish Title");
    const updateId = created.json.data.id as number;

    await signInAs({ id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A });
    await markRead(updateId);

    await signInAs({ id: ids.superAdmin, name: "ZZ Scratch Platform", role: "super_admin" });
    const { PATCH } = await import("./updates/[id]/route");
    const res = await PATCH(
      new Request(`http://t/api/platform/updates/${updateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpublish" }),
      }) as any,
      { params: Promise.resolve({ id: String(updateId) }) },
    );
    expect(res.status).toBe(200);

    // Gone from the live feed…
    await signInAs({ id: ids.employeeA, name: "ZZ Scratch Employee A", role: "sales manager", org: ORG_A });
    const feed = await userFeed();
    expect(feed.json.data.find((r: any) => r.id === updateId)).toBeUndefined();

    // …but the row, its original publication date and the read mark survive.
    const row = await db.query(
      `SELECT status, published_at,
              (SELECT count(*)::int FROM crm_update_reads WHERE update_id = $1) AS reads
         FROM crm_updates WHERE id = $1`,
      [updateId],
    );
    expect(row.rows[0].status).toBe("draft");
    expect(row.rows[0].published_at).toBeTruthy();
    expect(row.rows[0].reads).toBe(1);
  });

  it("refuses authoring from a tenant Admin", async () => {
    await signInAs({ id: ids.adminA, name: "ZZ Scratch Admin A", role: "admin", org: ORG_A });
    const attempt = await createUpdate(true, "zz-scratch-denied", "Should Not Exist");
    expect(attempt.status).toBe(403);

    const rows = await db.query(`SELECT id FROM crm_updates WHERE version = 'zz-scratch-denied'`);
    expect(rows.rows).toHaveLength(0);
  });

  it("refuses authoring through the user-facing route", async () => {
    await signInAs({ id: ids.adminA, name: "ZZ Scratch Admin A", role: "admin", org: ORG_A });
    const { POST } = await import("../updates/route");
    const res = await POST(
      new Request("http://t/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", version: "zz-scratch-x", title: "Nope" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
