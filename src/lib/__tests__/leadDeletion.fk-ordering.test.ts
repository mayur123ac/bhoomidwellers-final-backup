// @vitest-environment node
//
// Regression test for lead-deletion FK ordering fix (2026-09-10).
//
// ROOT CAUSE BEING TESTED
// ───────────────────────
// booking_applications.id has four RESTRICT FK children that were not cleared
// before the row was deleted:
//
//   disbursement_tranches.booking_id  RESTRICT
//   cp_commissions.booking_id         RESTRICT
//   financial_adjustments.booking_id  RESTRICT
//   inventory_units.booking_id        RESTRICT
//
// The fix introduces a pre-booking cleanup block that clears cp_commissions and
// inventory_units.booking_id via subquery, and moves disbursement_tranches and
// financial_adjustments before booking_applications in LEAD_RELATED_DELETES.
//
// RUN CONDITION
// ─────────────
// Requires LEAD_DELETION_TEST_DATABASE_URL pointing at a disposable Postgres
// database with the production schema applied. Skipped when the variable is
// absent so `npm test` in environments without a dedicated test DB still passes.
//
// Do NOT point this at the production or development database — the beforeEach
// wipes all lead-related tables to guarantee a clean slate.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Pool, PoolClient } from "pg";
import { clearTenantCache } from "@/lib/tenantContext";

const TEST_DB = process.env.LEAD_DELETION_TEST_DATABASE_URL;
const describeIfDb = TEST_DB ? describe : describe.skip;

// Point lib/db at the test database before any module is imported.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

// Fixed org UUID so we always have exactly one organization (required for the
// sole-organization fallback in getOrganizationId when there is no session).
const TEST_ORG = "cccc0000-0000-4000-8000-000000000003";

// ── Wipe order ───────────────────────────────────────────────────────────────
// Covers every table the seed inserts into, in child-before-parent order.
// Tables absent from dbWipe.ts (lead_reminders, cp_commissions, etc.) must
// precede the parents they reference.
const WIPE_ORDER = [
  "lead_reminders",        // RESTRICT → walkin_enquiries
  "cp_commissions",        // RESTRICT → booking_applications
  "financial_adjustments", // RESTRICT → booking_applications + walkin_enquiries
  "disbursement_tranches", // RESTRICT → booking_applications
  "inventory_offers",      // RESTRICT → inventory_units (CASCADE) + walkin_enquiries
  "inventory_cost_sheets", // CASCADE  → inventory_units; RESTRICT → walkin_enquiries
  "inventory_unit_history",// CASCADE  → inventory_units
  "inventory_units",       // RESTRICT → walkin_enquiries + booking_applications
  "inventory_towers",      // FK       → inventory_projects
  "inventory_projects",
  "booking_applications",  // RESTRICT → walkin_enquiries
  "walkin_enquiries",
  "users",
  "channel_partners",      // referenced by cp_commissions
  "organizations",
];

async function wipeTestTables(c: PoolClient) {
  for (const tbl of WIPE_ORDER) {
    await c.query(`DELETE FROM "${tbl}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describeIfDb("deleteLeadDatabaseRecords — FK ordering regression", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: TEST_DB, ssl: { rejectUnauthorized: false } });
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // Flush the sole-org cache so getOrganizationId re-queries the test DB.
    clearTenantCache();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await wipeTestTables(c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    clearTenantCache();
  });

  // ── Main regression scenario ─────────────────────────────────────────────
  it("deletes a lead with all confirmed RESTRICT-FK dependents without constraint violation", async () => {
    const { deleteLeadDatabaseRecords } = await import("@/lib/leadDeletion");

    // ── 1. Seed ───────────────────────────────────────────────────────────
    const seed = await pool.connect();
    let leadId!: number;
    let bookingId!: number;
    let otherLeadId!: number;
    let otherBookingId!: number;
    let unitId!: number;

    try {
      await seed.query("BEGIN");

      // One organization — sole-org resolution in getOrganizationId works.
      await seed.query(
        `INSERT INTO organizations (id, name, slug, status)
         VALUES ($1,'FK Test Org','fk-test-org','active')`,
        [TEST_ORG],
      );

      // One user — required by lead_reminders.assigned_user_id / created_by_id.
      const userRes = await seed.query(
        `INSERT INTO users (name, email, role, organization_id)
         VALUES ('FK Test User','fk@test.com','sales manager',$1)
         RETURNING id`,
        [TEST_ORG],
      );
      const userId = userRes.rows[0].id as number;

      // Channel partner — required by cp_commissions.channel_partner_id.
      const cpRes = await seed.query(
        `INSERT INTO channel_partners (name) VALUES ('FK Test CP') RETURNING id`,
      );
      const cpId = cpRes.rows[0].id as number;

      // Inventory hierarchy — required by inventory_units FKs.
      const projRes = await seed.query(
        `INSERT INTO inventory_projects (name, organization_id) VALUES ('FK Project',$1) RETURNING id`,
        [TEST_ORG],
      );
      const projId = projRes.rows[0].id as number;

      const towerRes = await seed.query(
        `INSERT INTO inventory_towers (project_id, name, organization_id) VALUES ($1,'T1',$2) RETURNING id`,
        [projId, TEST_ORG],
      );
      const towerId = towerRes.rows[0].id as number;

      // Lead under test (lead_A).
      const leadRes = await seed.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id)
         VALUES ('Lead A','9990000001',$1) RETURNING id`,
        [TEST_ORG],
      );
      leadId = leadRes.rows[0].id as number;

      // A second lead whose booking must be untouched (isolation check).
      const otherLeadRes = await seed.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id)
         VALUES ('Lead B','9990000002',$1) RETURNING id`,
        [TEST_ORG],
      );
      otherLeadId = otherLeadRes.rows[0].id as number;

      // Booking for lead_A.
      const bookingRes = await seed.query(
        `INSERT INTO booking_applications
           (lead_id, booking_number, booking_status, project_name, tower, wing, flat_number, organization_id)
         VALUES ($1,'BK-FK-A','Confirmed','FK Project','T1','W','101',$2) RETURNING id`,
        [leadId, TEST_ORG],
      );
      bookingId = bookingRes.rows[0].id as number;

      // Booking for lead_B — must survive the deletion of lead_A.
      const otherBookingRes = await seed.query(
        `INSERT INTO booking_applications
           (lead_id, booking_number, booking_status, project_name, tower, wing, flat_number, organization_id)
         VALUES ($1,'BK-FK-B','Confirmed','FK Project','T1','W','102',$2) RETURNING id`,
        [otherLeadId, TEST_ORG],
      );
      otherBookingId = otherBookingRes.rows[0].id as number;

      // Inventory unit: lead_id + held_for_lead_id + booking_id (all RESTRICT FKs).
      const unitRes = await seed.query(
        `INSERT INTO inventory_units
           (project_name, tower, wing, unit_type, floor, flat_no, carpet_area_sqft,
            status, source, lead_id, held_for_lead_id, booking_id,
            project_id, tower_id, organization_id)
         VALUES ('FK Project','T1','W','1BHK',1,'101',750,
                 'booked','booking_sync',$1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [leadId, leadId, bookingId, projId, towerId, TEST_ORG],
      );
      unitId = unitRes.rows[0].id as number;

      // disbursement_tranches: lead_id (no FK — plain integer) + booking_id (RESTRICT).
      await seed.query(
        `INSERT INTO disbursement_tranches (lead_id, amount, booking_id)
         VALUES ($1, 100000, $2)`,
        [leadId, bookingId],
      );

      // cp_commissions: booking_id (RESTRICT), no lead_id column.
      await seed.query(
        `INSERT INTO cp_commissions
           (booking_id, channel_partner_id, agreement_value, commission_rate_percent,
            gross_commission_amount, tds_percent, tds_amount, net_payable_amount)
         VALUES ($1,$2,5000000,2,100000,2,2000,98000)`,
        [bookingId, cpId],
      );

      // financial_adjustments: booking_id (RESTRICT) + lead_id (RESTRICT).
      await seed.query(
        `INSERT INTO financial_adjustments
           (booking_id, lead_id, adjustment_type, performed_by, performed_by_role,
            gate_code, obligation_snapshot, reason)
         VALUES ($1,$2,'discount_override','Admin','admin','FOE_ADJUST','{}','Regression test')`,
        [bookingId, leadId],
      );

      // inventory_cost_sheets: unit_id (NOT NULL) + lead_id (nullable RESTRICT FK).
      // Remaining numeric columns default to 0; omitting them is intentional.
      await seed.query(
        `INSERT INTO inventory_cost_sheets (unit_id, lead_id) VALUES ($1,$2)`,
        [unitId, leadId],
      );

      // inventory_offers: unit_id (NOT NULL) + lead_id (nullable RESTRICT FK).
      await seed.query(
        `INSERT INTO inventory_offers (unit_id, lead_id) VALUES ($1,$2)`,
        [unitId, leadId],
      );

      // lead_reminders: lead_id (RESTRICT, NOT NULL).
      await seed.query(
        `INSERT INTO lead_reminders
           (lead_id, organization_id, assigned_user_id, created_by_id,
            created_by_name, remind_at)
         VALUES ($1,$2,$3,$4,'FK Test User', NOW() + INTERVAL '1 day')`,
        [leadId, TEST_ORG, userId, userId],
      );

      await seed.query("COMMIT");
    } catch (e) {
      await seed.query("ROLLBACK");
      throw e;
    } finally {
      seed.release();
    }

    // ── 2. Act: delete lead_A ────────────────────────────────────────────
    // Uses a fresh client so getOrganizationId sees the committed sole-org row.
    clearTenantCache();
    let deleteError: unknown = null;
    const del = await pool.connect();
    try {
      await del.query("BEGIN");
      await deleteLeadDatabaseRecords(del, leadId, { recalc: false });
      await del.query("COMMIT");
    } catch (e) {
      await del.query("ROLLBACK");
      deleteError = e;
    } finally {
      del.release();
    }

    // ── 3. Assert: no FK violation ───────────────────────────────────────
    expect(deleteError, `deleteLeadDatabaseRecords threw: ${deleteError}`).toBeNull();

    // ── 4. Assert: lead_A and its booking are gone ───────────────────────
    const leadRows = await pool.query(
      "SELECT id FROM walkin_enquiries WHERE id = $1", [leadId],
    );
    expect(leadRows.rows, "walkin_enquiries row must be deleted").toHaveLength(0);

    const bookingRows = await pool.query(
      "SELECT id FROM booking_applications WHERE id = $1", [bookingId],
    );
    expect(bookingRows.rows, "booking_applications row must be deleted").toHaveLength(0);

    // ── 5. Assert: all booking-scoped children deleted ───────────────────
    const dt = await pool.query(
      "SELECT id FROM disbursement_tranches WHERE lead_id = $1", [leadId],
    );
    expect(dt.rows, "disbursement_tranches must be deleted").toHaveLength(0);

    const cc = await pool.query(
      "SELECT id FROM cp_commissions WHERE booking_id = $1", [bookingId],
    );
    expect(cc.rows, "cp_commissions must be deleted").toHaveLength(0);

    const fa = await pool.query(
      "SELECT id FROM financial_adjustments WHERE lead_id = $1", [leadId],
    );
    expect(fa.rows, "financial_adjustments must be deleted").toHaveLength(0);

    const lr = await pool.query(
      "SELECT id FROM lead_reminders WHERE lead_id = $1", [leadId],
    );
    expect(lr.rows, "lead_reminders must be deleted").toHaveLength(0);

    // ── 6. Assert: inventory unit preserved, all lead/booking refs NULLed ─
    const unit = await pool.query(
      `SELECT lead_id, held_for_lead_id, booking_id
         FROM inventory_units WHERE id = $1`,
      [unitId],
    );
    expect(unit.rows, "inventory_units row must be preserved").toHaveLength(1);
    expect(unit.rows[0].lead_id, "inventory_units.lead_id must be NULL").toBeNull();
    expect(unit.rows[0].held_for_lead_id, "inventory_units.held_for_lead_id must be NULL").toBeNull();
    expect(unit.rows[0].booking_id, "inventory_units.booking_id must be NULL").toBeNull();

    const cs = await pool.query(
      "SELECT lead_id FROM inventory_cost_sheets WHERE unit_id = $1", [unitId],
    );
    expect(cs.rows, "inventory_cost_sheets row must be preserved").toHaveLength(1);
    expect(cs.rows[0].lead_id, "inventory_cost_sheets.lead_id must be NULL").toBeNull();

    const offer = await pool.query(
      "SELECT lead_id FROM inventory_offers WHERE unit_id = $1", [unitId],
    );
    expect(offer.rows, "inventory_offers row must be preserved").toHaveLength(1);
    expect(offer.rows[0].lead_id, "inventory_offers.lead_id must be NULL").toBeNull();

    // ── 7. Assert: lead_B and booking_B are untouched ────────────────────
    const otherLead = await pool.query(
      "SELECT id FROM walkin_enquiries WHERE id = $1", [otherLeadId],
    );
    expect(otherLead.rows, "lead_B must not be deleted").toHaveLength(1);

    const otherBooking = await pool.query(
      "SELECT id FROM booking_applications WHERE id = $1", [otherBookingId],
    );
    expect(otherBooking.rows, "booking_B must not be deleted").toHaveLength(1);
  });

  // ── No-booking lead: lead_reminders is the only RESTRICT blocker ─────
  it("deletes a lead with no booking but with a lead_reminders record", async () => {
    const { deleteLeadDatabaseRecords } = await import("@/lib/leadDeletion");

    const seed = await pool.connect();
    let leadId!: number;
    try {
      await seed.query("BEGIN");

      await seed.query(
        `INSERT INTO organizations (id, name, slug, status)
         VALUES ($1,'FK Test Org','fk-test-org','active')`,
        [TEST_ORG],
      );
      const userRes = await seed.query(
        `INSERT INTO users (name, email, role, organization_id)
         VALUES ('FK Test User','fk@test.com','sales manager',$1) RETURNING id`,
        [TEST_ORG],
      );
      const userId = userRes.rows[0].id as number;

      const leadRes = await seed.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id)
         VALUES ('No-Booking Lead','9990000003',$1) RETURNING id`,
        [TEST_ORG],
      );
      leadId = leadRes.rows[0].id as number;

      await seed.query(
        `INSERT INTO lead_reminders
           (lead_id, organization_id, assigned_user_id, created_by_id,
            created_by_name, remind_at)
         VALUES ($1,$2,$3,$4,'FK Test User', NOW() + INTERVAL '1 day')`,
        [leadId, TEST_ORG, userId, userId],
      );
      await seed.query("COMMIT");
    } catch (e) {
      await seed.query("ROLLBACK");
      throw e;
    } finally {
      seed.release();
    }

    clearTenantCache();
    let deleteError: unknown = null;
    const del = await pool.connect();
    try {
      await del.query("BEGIN");
      await deleteLeadDatabaseRecords(del, leadId, { recalc: false });
      await del.query("COMMIT");
    } catch (e) {
      await del.query("ROLLBACK");
      deleteError = e;
    } finally {
      del.release();
    }

    expect(deleteError, `Deletion of no-booking lead threw: ${deleteError}`).toBeNull();

    const leadRows = await pool.query(
      "SELECT id FROM walkin_enquiries WHERE id = $1", [leadId],
    );
    expect(leadRows.rows).toHaveLength(0);

    const reminders = await pool.query(
      "SELECT id FROM lead_reminders WHERE lead_id = $1", [leadId],
    );
    expect(reminders.rows, "lead_reminders must be deleted").toHaveLength(0);
  });
});
