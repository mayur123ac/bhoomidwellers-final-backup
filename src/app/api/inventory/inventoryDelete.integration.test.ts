// @vitest-environment node
//
// Integration tests for the three inventory delete tiers, run against a REAL
// Postgres database (a scratch copy of the production schema), through the
// actual route handlers — not a re-implementation of their rules.
//
// They exist because the bug they cover was invisible to every other kind of
// test: the schema was right, the types were right and the build was clean, and
// the flat still could not be deleted. Only a row with `source = 'booking_sync'`
// and a cancelled booking, pushed through the real handler, shows it.
//
// Requires INVENTORY_TEST_DATABASE_URL to point at a throwaway database. Skipped
// entirely when it is unset, so `npm test` on a machine without one still passes.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { wipeAll } from "@/test/dbWipe";

const TEST_DB = process.env.INVENTORY_TEST_DATABASE_URL;
const describeIfDb = TEST_DB ? describe : describe.skip;

if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.SESSION_SECRET ||= "integration-test-secret-not-a-real-one";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

/**
 * The signed cookie the handlers see. Swapped per test to change tenant/role.
 *
 * Only `cookies()` is stubbed — it reads from ambient request context, which
 * does not exist outside a real request. Everything downstream of it is the
 * production path: the value is a genuinely HMAC-signed session, verified by the
 * real verifySession(), gated by the real requireRoles(). Mocking the session
 * module instead would not work anyway (requireSession calls getServerSession
 * through a module-local binding a mock cannot intercept) and would skip exactly
 * the layer these tests need to trust.
 */
let sessionCookie: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "crm_session" && sessionCookie ? { name, value: sessionCookie } : undefined) }),
  headers: async () => new Headers(),
}));

async function signInAs(user: { _id?: string; name?: string; role: string; org: string }) {
  const { signSession } = await import("@/lib/sessionCookie");
  const value = await signSession({ _id: "1", name: "Admin", isActive: true, ...user });
  if (!value) throw new Error("SESSION_SECRET missing — cannot mint a test session");
  sessionCookie = value;
}

/**
 * Two tenants and the five flat-delete cases, rebuilt from empty.
 *
 * `Alpha Tower` deliberately mixes all of them in one building, because that is
 * also the shape the whole-building delete has to reason about.
 */
async function seed(db: import("pg").Pool): Promise<Record<string, number>> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    // Shared with the other database suites, so this clears everything rather
    // than only what this file writes. The order — including cost sheets and
    // price rules before units, which is the same knot the building delete hit
    // — lives in src/test/dbWipe.ts.
    await wipeAll(c);

    await c.query(
      `INSERT INTO organizations (id, name, slug, status)
       VALUES ($1,'Bhoomi Test','bhoomi-test','active'), ($2,'Viraj Test','viraj-test','active')`,
      [ORG_A, ORG_B],
    );

    const project = async (name: string, org: string) =>
      (await c.query(`INSERT INTO inventory_projects (name, organization_id) VALUES ($1,$2) RETURNING id`,
        [name, org])).rows[0].id as number;
    const tower = async (projectId: number, name: string, org: string) =>
      (await c.query(`INSERT INTO inventory_towers (project_id, name, organization_id) VALUES ($1,$2,$3) RETURNING id`,
        [projectId, name, org])).rows[0].id as number;
    const booking = async (leadId: number, num: string, status: string, flat: string, org: string) =>
      (await c.query(
        `INSERT INTO booking_applications (lead_id, booking_number, booking_status, project_name, tower, wing, flat_number, organization_id)
         VALUES ($1,$2,$3,'Alpha Tower','A','B',$4,$5) RETURNING id`,
        [leadId, num, status, flat, org])).rows[0].id as number;
    const unit = async (o: {
      flat: string; status: string; source: string; project: string; tower: string;
      projectId: number; towerId: number; org: string; leadId?: number | null; bookingId?: number | null;
    }) => (await c.query(
      `INSERT INTO inventory_units (project_name, tower, wing, unit_type, floor, flat_no, carpet_area_sqft,
                                    status, source, lead_id, booking_id, project_id, tower_id, organization_id)
       VALUES ($1,$2,'B','1BHK',1,$3,750,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [o.project, o.tower, o.flat, o.status, o.source, o.leadId ?? null, o.bookingId ?? null,
       o.projectId, o.towerId, o.org])).rows[0].id as number;

    const projA = await project("Alpha Tower", ORG_A);
    const towerA = await tower(projA, "A", ORG_A);
    const projClean = await project("Clean Block", ORG_A);
    const towerClean = await tower(projClean, "C", ORG_A);

    const leadA = (await c.query(
      `INSERT INTO walkin_enquiries (name, phone, organization_id) VALUES ('Lead A','9990000001',$1) RETURNING id`,
      [ORG_A])).rows[0].id as number;

    const bkCancelled = await booking(leadA, "BK-T-CANCELLED", "Cancelled", "A-102", ORG_A);
    const bkConfirmed = await booking(leadA, "BK-T-CONFIRMED", "Confirmed", "A-103", ORG_A);
    const bkRegistered = await booking(leadA, "BK-T-REGISTERED", "Confirmed", "A-104", ORG_A);

    const inA = { project: "Alpha Tower", tower: "A", projectId: projA, towerId: towerA, org: ORG_A };
    // A — plain available stock, no booking anywhere in its past
    const uA = await unit({ ...inA, flat: "A-101", status: "available", source: "bulk_generated" });
    // B — THE BUG CASE: created by booking sync, booking cancelled, link cleared
    const uB = await unit({ ...inA, flat: "A-102", status: "available", source: "booking_sync" });
    await c.query(
      `INSERT INTO inventory_unit_history (unit_id, old_status, new_status, changed_by, reason, organization_id)
       VALUES ($1,NULL,'booked','Seed',$2,$3), ($1,'booked','available','Seed',$4,$3)`,
      [uB, `linked to booking #${bkCancelled}`, ORG_A, `booking #${bkCancelled} cancelled`],
    );
    // B2 — cancelled booking still ON the row (release never ran)
    const uB2 = await unit({ ...inA, flat: "A-105", status: "available", source: "booking_sync", bookingId: bkCancelled });
    // C — actively booked
    const uC = await unit({ ...inA, flat: "A-103", status: "booked", source: "booking_sync", leadId: leadA, bookingId: bkConfirmed });
    // D — registered / financially linked
    const uD = await unit({ ...inA, flat: "A-104", status: "registered", source: "booking_sync", leadId: leadA, bookingId: bkRegistered });

    const inClean = { project: "Clean Block", tower: "C", projectId: projClean, towerId: towerClean, org: ORG_A };
    const uClean1 = await unit({ ...inClean, flat: "C-101", status: "available", source: "bulk_generated" });
    const uClean2 = await unit({ ...inClean, flat: "C-102", status: "available", source: "bulk_generated" });

    const projB = await project("Viraj Heights", ORG_B);
    const towerB = await tower(projB, "V", ORG_B);
    const uForeign = await unit({
      flat: "V-101", status: "available", source: "bulk_generated",
      project: "Viraj Heights", tower: "V", projectId: projB, towerId: towerB, org: ORG_B,
    });

    await c.query("COMMIT");
    return { projA, projClean, projB, leadA, bkCancelled, bkConfirmed, bkRegistered,
             uA, uB, uB2, uC, uD, uClean1, uClean2, uForeign };
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

describeIfDb("inventory delete guardrails", () => {
  let db: import("pg").Pool;
  let unitDelete: typeof import("./[id]/route").DELETE;
  let bulkDelete: typeof import("./bulk/route").DELETE;
  let projectDelete: typeof import("./projects/[id]/route").DELETE;
  let projectPreview: typeof import("./projects/[id]/route").GET;
  let ids: Record<string, number>;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    db = new Pool({ connectionString: TEST_DB });
    ({ DELETE: unitDelete } = await import("./[id]/route"));
    ({ DELETE: bulkDelete } = await import("./bulk/route"));
    ({ DELETE: projectDelete, GET: projectPreview } = await import("./projects/[id]/route"));
  });

  afterAll(async () => { await db.end(); });

  // Re-seeded from scratch before every test rather than rolled back: several of
  // these tests DELETE rows outright, so restoring a flag would not be enough.
  beforeEach(async () => {
    ids = await seed(db);
    await signInAs({ role: "admin", org: ORG_A });
  });

  const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
  const req = (url: string) => new Request(url) as any;

  const unitRow = async (id: number) =>
    (await db.query(`SELECT * FROM inventory_units WHERE id = $1`, [id])).rows[0];

  /* ── A. available flat, no booking anywhere in its past ─────────────────── */
  it("A: deletes an available flat that no booking ever touched", async () => {
    const res = await unitDelete(req(`http://t/api/inventory/${ids.uA}`), params(ids.uA));
    expect(res.status).toBe(200);
    expect((await unitRow(ids.uA)).deleted_at).not.toBeNull();
  });

  /* ── B. THE BUG: available flat whose only booking was cancelled ────────── */
  it("B: deletes an available flat whose only booking history is a cancellation", async () => {
    const before = await unitRow(ids.uB);
    expect(before.source).toBe("booking_sync");   // the provenance that used to lock it
    expect(before.booking_id).toBeNull();
    expect(before.status).toBe("available");

    const res = await unitDelete(req(`http://t/api/inventory/${ids.uB}`), params(ids.uB));
    const body = await res.json();
    expect(body.message ?? "").not.toMatch(/cannot be deleted/i);
    expect(res.status).toBe(200);
    expect((await unitRow(ids.uB)).deleted_at).not.toBeNull();
  });

  it("B: preserves the booking and the unit's history when that flat is deleted", async () => {
    await unitDelete(req(`http://t/api/inventory/${ids.uB}`), params(ids.uB));

    // The booking record is untouched, and still names the flat itself.
    const booking = (await db.query(
      `SELECT booking_status, flat_number FROM booking_applications WHERE id = $1`,
      [ids.bkCancelled],
    )).rows[0];
    expect(booking.booking_status).toBe("Cancelled");
    expect(booking.flat_number).toBe("A-102");

    // The unit's own life story survives — soft delete, so nothing cascaded.
    const history = (await db.query(
      `SELECT reason, new_status FROM inventory_unit_history WHERE unit_id = $1 ORDER BY id`,
      [ids.uB],
    )).rows;
    expect(history.map((h: any) => h.reason)).toContain(`booking #${ids.bkCancelled} cancelled`);
    expect(history.at(-1).new_status).toBe("deleted");
  });

  it("B2: a cancelled booking still ON the row needs the admin override, then deletes", async () => {
    const plain = await unitDelete(req(`http://t/api/inventory/${ids.uB2}`), params(ids.uB2));
    expect(plain.status).toBe(409);
    expect((await plain.json()).requiresOverride).toBe(true);
    expect((await unitRow(ids.uB2)).deleted_at).toBeNull();

    const forced = await unitDelete(
      req(`http://t/api/inventory/${ids.uB2}?force=true`), params(ids.uB2),
    );
    expect(forced.status).toBe(200);
    expect((await unitRow(ids.uB2)).deleted_at).not.toBeNull();
  });

  /* ── C. actively booked ─────────────────────────────────────────────────── */
  it("C: refuses to delete an actively booked flat, even with force=true", async () => {
    for (const url of [`http://t/api/inventory/${ids.uC}`, `http://t/api/inventory/${ids.uC}?force=true`]) {
      const res = await unitDelete(req(url), params(ids.uC));
      expect(res.status).toBe(409);
      expect((await res.json()).message).toMatch(/cannot be deleted/i);
    }
    expect((await unitRow(ids.uC)).deleted_at).toBeNull();
  });

  /* ── D. registered / financially linked ─────────────────────────────────── */
  it("D: refuses to delete a registered flat, even with force=true", async () => {
    const res = await unitDelete(
      req(`http://t/api/inventory/${ids.uD}?force=true`), params(ids.uD),
    );
    expect(res.status).toBe(409);
    expect((await unitRow(ids.uD)).deleted_at).toBeNull();
  });

  /* ── E. cross-tenant ────────────────────────────────────────────────────── */
  it("E: another tenant's flat is not found, and is not deleted", async () => {
    const res = await unitDelete(
      req(`http://t/api/inventory/${ids.uForeign}?force=true`), params(ids.uForeign),
    );
    expect(res.status).toBe(404);
    // The row count is the assertion that matters — a 404 with the row gone
    // would still be a cross-tenant delete.
    expect((await unitRow(ids.uForeign)).deleted_at).toBeNull();
  });

  it("E: a bulk delete silently drops another tenant's ids", async () => {
    const res = await bulkDelete({
      json: async () => ({ ids: [ids.uA, ids.uForeign] }),
    } as any);
    const body = await res.json();
    expect(body.deleted).toBe(1);
    expect((await unitRow(ids.uForeign)).deleted_at).toBeNull();
    expect((await unitRow(ids.uA)).deleted_at).not.toBeNull();
  });

  /* ── Building delete ────────────────────────────────────────────────────── */
  it("building: deletes a building whose stock was never booked", async () => {
    const res = await projectDelete(req("http://t/"), params(ids.projClean));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.deleted_units).toBe(2);

    const left = await db.query(
      `SELECT COUNT(*)::int AS n FROM inventory_units WHERE project_id = $1`, [ids.projClean]);
    expect(left.rows[0].n).toBe(0);
    const proj = await db.query(`SELECT COUNT(*)::int AS n FROM inventory_projects WHERE id = $1`, [ids.projClean]);
    expect(proj.rows[0].n).toBe(0);
    const towers = await db.query(`SELECT COUNT(*)::int AS n FROM inventory_towers WHERE project_id = $1`, [ids.projClean]);
    expect(towers.rows[0].n).toBe(0);
  });

  it("building: refuses a building holding a live booking, and changes nothing", async () => {
    const res = await projectDelete(req("http://t/"), params(ids.projA));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("BOOKING_LINKED_UNITS");
    expect(body.blocking.map((b: any) => b.flat_no).sort()).toEqual(["A-103", "A-104"]);

    const still = await db.query(
      `SELECT COUNT(*)::int AS n FROM inventory_units WHERE project_id = $1`, [ids.projA]);
    expect(still.rows[0].n).toBe(5);
    const proj = await db.query(`SELECT COUNT(*)::int AS n FROM inventory_projects WHERE id = $1`, [ids.projA]);
    expect(proj.rows[0].n).toBe(1);
  });

  it("building: archives rather than purges flats that carry booking history", async () => {
    // Free the building of its live bookings, leaving only the cancelled-history
    // flats — the case the purge must not destroy.
    await db.query(
      `UPDATE inventory_units SET status='available', booking_id=NULL, lead_id=NULL WHERE id = ANY($1::int[])`,
      [[ids.uC, ids.uD, ids.uB2]],
    );

    const res = await projectDelete(req("http://t/"), params(ids.projA));
    expect(res.status).toBe(200);
    const { data } = await res.json();

    // A-101 was plain generated stock: purged. The four booking_sync flats are
    // archived, and their history rows are still there.
    expect(data.deleted_units).toBe(1);
    expect(data.archived_units).toBe(4);

    const survivors = await db.query(
      `SELECT id, deleted_at, project_id, tower_id FROM inventory_units WHERE id = ANY($1::int[])`,
      [[ids.uB, ids.uB2, ids.uC, ids.uD]],
    );
    expect(survivors.rows).toHaveLength(4);
    for (const row of survivors.rows) {
      expect(row.deleted_at).not.toBeNull();
      expect(row.project_id).toBeNull();   // detached, so the project row could go
      expect(row.tower_id).toBeNull();
    }
    const history = await db.query(
      `SELECT COUNT(*)::int AS n FROM inventory_unit_history WHERE unit_id = $1`, [ids.uB]);
    expect(history.rows[0].n).toBeGreaterThan(0);

    // The bookings themselves are untouched.
    const bookings = await db.query(`SELECT COUNT(*)::int AS n FROM booking_applications`);
    expect(bookings.rows[0].n).toBe(3);
  });

  it("building: an archived flat's issued cost sheet does not block the delete", async () => {
    // The bug this covers: the flats above are ARCHIVED, so their issued cost
    // sheets outlive the building — and each one pointed at a price rule that
    // the project delete cascades away. That FK made a building with a single
    // quote on a single booking-history flat permanently undeletable, with
    //   violates foreign key constraint "inventory_cost_sheets_price_rule_id_fkey"
    // The seed has no pricing at all, which is exactly why every other building
    // test passed while the real building could not be deleted.
    const ruleId = (await db.query(
      `INSERT INTO inventory_price_rules (project_id, base_rate_per_sqft, organization_id)
       VALUES ($1, 9500, $2) RETURNING id`,
      [ids.projA, ORG_A],
    )).rows[0].id as number;
    const sheetId = (await db.query(
      `INSERT INTO inventory_cost_sheets (unit_id, price_rule_id, version, base_rate_per_sqft,
                                          agreement_value, total_amount, breakdown, status, organization_id)
       VALUES ($1, $2, 1, 9500, 7125000, 7500000, '[{"label":"Base","amount":7125000}]'::jsonb,
               'issued', $3) RETURNING id`,
      [ids.uB, ruleId, ORG_A],
    )).rows[0].id as number;

    await db.query(
      `UPDATE inventory_units SET status='available', booking_id=NULL, lead_id=NULL WHERE id = ANY($1::int[])`,
      [[ids.uC, ids.uD, ids.uB2]],
    );

    const res = await projectDelete(req("http://t/"), params(ids.projA));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.detached_cost_sheets).toBe(1);

    // The building and its pricing are gone.
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM inventory_projects WHERE id = $1`, [ids.projA])).rows[0].n).toBe(0);
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM inventory_price_rules WHERE id = $1`, [ruleId])).rows[0].n).toBe(0);

    // The quote survives, with every number intact — only the pointer to the
    // now-deleted rule was cleared. A sheet that lost its totals would be a
    // worse outcome than the failed delete.
    const sheet = (await db.query(`SELECT * FROM inventory_cost_sheets WHERE id = $1`, [sheetId])).rows[0];
    expect(sheet).toBeDefined();
    expect(sheet.price_rule_id).toBeNull();
    expect(sheet.status).toBe("issued");
    expect(Number(sheet.total_amount)).toBe(7500000);
    expect(sheet.breakdown).not.toBeNull();
  });

  it("building: another tenant's building is not found, and is not deleted", async () => {
    const res = await projectDelete(req("http://t/"), params(ids.projB));
    expect(res.status).toBe(404);
    const proj = await db.query(`SELECT COUNT(*)::int AS n FROM inventory_projects WHERE id = $1`, [ids.projB]);
    expect(proj.rows[0].n).toBe(1);
    const units = await db.query(`SELECT COUNT(*)::int AS n FROM inventory_units WHERE project_id = $1`, [ids.projB]);
    expect(units.rows[0].n).toBe(1);
  });

  it("building: tenant B cannot preview tenant A's building either", async () => {
    await signInAs({ role: "admin", org: ORG_B });
    const res = await projectPreview(req("http://t/"), params(ids.projA));
    expect(res.status).toBe(404);
  });

  it("building preview: reports the dependency counts the modal shows", async () => {
    const res = await projectPreview(req("http://t/"), params(ids.projA));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      name: "Alpha Tower",
      units: 5,
      towers: 1,
      floors: 1,
      active_bookings: 2,          // A-103 booked, A-104 registered
      history_preserved_units: 2,  // A-102 and A-105, both cancelled-booking flats
    });
  });

  it("non-admin cannot delete a flat", async () => {
    await signInAs({ _id: "9", name: "SM", role: "sales manager", org: ORG_A });
    const res = await unitDelete(req(`http://t/api/inventory/${ids.uA}`), params(ids.uA));
    expect(res.status).toBe(403);
    expect((await unitRow(ids.uA)).deleted_at).toBeNull();
  });
});
