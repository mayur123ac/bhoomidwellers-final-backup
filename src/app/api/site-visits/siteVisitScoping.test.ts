// @vitest-environment node
//
// GET /api/site-visits/all used to hand every signed-in session every site
// visit in the organization, with each lead's name and phone attached, and let
// the calendar component filter in React. These tests pin the server-side
// predicate that replaced that, because the failure mode is silent: the screen
// looks identical either way, and the difference is only visible in the payload.
//
// Run against the same throwaway database as the other integration suites.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { wipeAll } from "@/test/dbWipe";

const TEST_DB = process.env.INVENTORY_TEST_DATABASE_URL;
const describeIfDb = TEST_DB ? describe : describe.skip;

if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.SESSION_SECRET ||= "integration-test-secret-not-a-real-one";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

let sessionCookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "crm_session" && sessionCookie ? { name: n, value: sessionCookie } : undefined),
  }),
  headers: async () => new Headers(),
}));

async function signInAs(user: { name: string; role: string; org: string }) {
  const { signSession } = await import("@/lib/sessionCookie");
  const value = await signSession({ _id: "1", isActive: true, ...user });
  if (!value) throw new Error("SESSION_SECRET missing");
  sessionCookie = value;
}

async function seed(db: import("pg").Pool) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    // The scratch database is shared with the other integration suites, so this
    // clears everything, not just what this file writes. Order lives in one
    // place — see src/test/dbWipe.ts for the two FK edges that make it subtle.
    await wipeAll(c);
    await c.query(
      `INSERT INTO organizations (id, name, slug, status)
       VALUES ($1,'A','org-a','active'), ($2,'B','org-b','active')`,
      [ORG_A, ORG_B],
    );
    const lead = async (name: string, assignedTo: string | null, recep: string | null, sh: string | null, org: string) =>
      (await c.query(
        `INSERT INTO walkin_enquiries (name, phone, assigned_to, assigned_receptionist, overseeing_site_head, organization_id)
         VALUES ($1,'9990000000',$2,$3,$4,$5) RETURNING id`,
        [name, assignedTo, recep, sh, org],
      )).rows[0].id as number;

    const priyaOwn = await lead("Priya lead", null, "Priya", null, ORG_A);
    const priyaAssigned = await lead("Priya assigned", "Priya", null, null, ORG_A);
    const rakeshLead = await lead("Rakesh lead", null, null, "Rakesh", ORG_A);
    const someoneElse = await lead("Megha lead", "Megha", null, null, ORG_A);
    const otherOrg = await lead("Other org lead", "Priya", "Priya", null, ORG_B);

    for (const [leadId, org] of [
      [priyaOwn, ORG_A], [priyaAssigned, ORG_A], [rakeshLead, ORG_A],
      [someoneElse, ORG_A], [otherOrg, ORG_B],
    ] as const) {
      await c.query(
        `INSERT INTO site_visits (lead_id, visit_date, created_by, role, status, organization_id)
         VALUES ($1, NOW(), 'Seed', 'admin', 'scheduled', $2)`,
        [leadId, org],
      );
    }
    await c.query("COMMIT");
    return { priyaOwn, priyaAssigned, rakeshLead, someoneElse, otherOrg };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

describeIfDb("GET /api/site-visits/all scoping", () => {
  let db: import("pg").Pool;
  let GET: typeof import("./all/route").GET;
  let ids: Record<string, number>;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    db = new Pool({ connectionString: TEST_DB });
    ({ GET } = await import("./all/route"));
  });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => { ids = await seed(db); });

  const call = async () => {
    const res = await GET(new Request("http://t/api/site-visits/all"));
    return (await res.json()).data as any[];
  };

  it("admin sees the whole organization, and not the other one", async () => {
    await signInAs({ name: "Admin", role: "admin", org: ORG_A });
    const rows = await call();
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toContain("Other org lead");
  });

  it("receptionist sees only her own leads' visits", async () => {
    await signInAs({ name: "Priya", role: "receptionist", org: ORG_A });
    const rows = await call();
    // assigned_receptionist = Priya, and assigned_to = Priya. Not Megha's, and
    // not the org B lead that names her in both columns.
    expect(rows.map((r) => r.lead_id).sort()).toEqual([ids.priyaOwn, ids.priyaAssigned].sort());
  });

  it("another employee's customer phone never reaches the receptionist", async () => {
    await signInAs({ name: "Priya", role: "receptionist", org: ORG_A });
    const payload = JSON.stringify(await call());
    // The point of the whole change: not merely hidden in the UI, absent.
    expect(payload).not.toContain("Megha lead");
    expect(payload).not.toContain("Rakesh lead");
    expect(payload).not.toContain("Other org lead");
  });

  it("site head sees assigned and overseen leads", async () => {
    await signInAs({ name: "Rakesh", role: "site_head", org: ORG_A });
    const rows = await call();
    expect(rows.map((r) => r.lead_id)).toEqual([ids.rakeshLead]);
  });

  it("a restricted role with no name on the session gets nothing, not everything", async () => {
    await signInAs({ name: "", role: "receptionist", org: ORG_A });
    expect(await call()).toEqual([]);
  });

  it("an unauthenticated request is refused", async () => {
    sessionCookie = undefined;
    const res = await GET(new Request("http://t/api/site-visits/all"));
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
