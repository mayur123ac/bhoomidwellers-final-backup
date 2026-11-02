/**
 * Phase 6 — Deal Stage Pipeline: Database Integration Tests
 *
 * Runs against an isolated local PostgreSQL database (deal_stage_test).
 * Tests cover: booking confirmation, inventory verification, pending recovery,
 * outbox force-retry, concurrency, and idempotency.
 *
 * Prerequisites:
 *   - Local PostgreSQL running on localhost:5432
 *   - deal_stage_test database created from bhoomiBackup_crm template
 *   - 2026-11-01_deal_stage_tables.sql migration applied
 *   - organization_id UUID column added to walkin_enquiries, booking_applications,
 *     inventory_units, booking_history
 *
 * Run: npx vitest run src/lib/dealStage.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, PoolClient } from "pg";
import { processOneEvent, type OutboxEvent } from "./dealStage";
import { insertAndProcessOutboxEvent, buildEventKey } from "./dealStageOutbox";

// ---------------------------------------------------------------------------
// Test database connection
// ---------------------------------------------------------------------------

const TEST_DB_URL = "postgresql://postgres:8369787919@localhost:5432/deal_stage_test";
let pool: Pool;

const ORG_ID = "00000000-0000-4000-a000-000000000001";
const ORG_ID_B = "00000000-0000-4000-a000-000000000002";

let nextLeadId = 90000;
let nextBookingId = 90000;
let nextInventoryId = 90000;

function freshIds() {
  nextLeadId++;
  nextBookingId++;
  nextInventoryId++;
  return { leadId: nextLeadId, bookingId: nextBookingId, inventoryId: nextInventoryId };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
  // Verify connection
  const res = await pool.query("SELECT 1 AS ok");
  expect(res.rows[0].ok).toBe(1);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // Clean test data between tests (leave production data intact via high IDs)
  await pool.query("DELETE FROM deal_stage_history WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM deal_stage_outbox WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM booking_history WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM inventory_units WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM booking_applications WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM walkin_enquiries WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
});

// ---------------------------------------------------------------------------
// Helpers: insert test rows
// ---------------------------------------------------------------------------

async function insertLead(client: PoolClient, id: number, orgId = ORG_ID, status = "Open") {
  await client.query(
    `INSERT INTO walkin_enquiries (id, name, phone, sr_no, status, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
    [id, `Test Lead ${id}`, `9000${id}`, id, status, orgId],
  );
}

async function insertBooking(
  client: PoolClient,
  id: number,
  leadId: number,
  orgId = ORG_ID,
  status = "Pending",
) {
  await client.query(
    `INSERT INTO booking_applications (id, lead_id, booking_number, booking_status, organization_id, project_name, tower, flat_number, floor_number)
     VALUES ($1, $2, $3, $4, $5, 'TestProject', 'TowerA', $6, '1')
     ON CONFLICT (id) DO UPDATE SET booking_status = EXCLUDED.booking_status`,
    [id, leadId, `BK-${id}`, status, orgId, `F-${id}`],
  );
}

async function insertInventoryUnit(
  client: PoolClient,
  id: number,
  bookingId: number,
  orgId = ORG_ID,
  status = "booked",
) {
  await client.query(
    `INSERT INTO inventory_units
       (id, project_name, tower, unit_type, floor, flat_no, carpet_area_sqft,
        status, source, is_corner, is_park_facing, parking_slots, booking_id, organization_id)
     VALUES ($1, 'TestProject', 'TowerA', 'Flat', 1, $2, 0,
             $3, 'booking_sync', false, false, 0, $4, $5)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, booking_id = EXCLUDED.booking_id`,
    [id, `F-${bookingId}`, status, bookingId, orgId],
  );
}

// ---------------------------------------------------------------------------
// Helper: run in transaction
// ---------------------------------------------------------------------------

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helper: read state
// ---------------------------------------------------------------------------

async function getBookingStatus(bookingId: number): Promise<string | null> {
  const r = await pool.query("SELECT booking_status FROM booking_applications WHERE id = $1", [bookingId]);
  return r.rows[0]?.booking_status ?? null;
}

async function getInventoryStatus(inventoryId: number): Promise<{ status: string; booking_id: number | null } | null> {
  const r = await pool.query("SELECT status, booking_id FROM inventory_units WHERE id = $1", [inventoryId]);
  return r.rows[0] ?? null;
}

async function getOutboxStatus(eventKey: string): Promise<{ status: string; attempts: number } | null> {
  const r = await pool.query("SELECT status, attempts FROM deal_stage_outbox WHERE event_key = $1", [eventKey]);
  return r.rows[0] ?? null;
}

async function getStageHistory(leadId: number): Promise<{ stage: string; stage_ordinal: number; transition_type: string }[]> {
  const r = await pool.query(
    "SELECT stage, stage_ordinal, transition_type FROM deal_stage_history WHERE lead_id = $1 ORDER BY stage_ordinal",
    [leadId],
  );
  return r.rows;
}

async function getLeadStatus(leadId: number): Promise<string | null> {
  const r = await pool.query("SELECT status FROM walkin_enquiries WHERE id = $1", [leadId]);
  return r.rows[0]?.status ?? null;
}

async function getBookingHistoryCount(bookingId: number): Promise<number> {
  const r = await pool.query("SELECT COUNT(*)::int AS cnt FROM booking_history WHERE booking_id = $1", [bookingId]);
  return r.rows[0].cnt;
}

// ============================================================================
// 1. Successful booking confirmation (full flow)
// ============================================================================

describe("Integration: Successful booking confirmation", () => {
  it("booking_initiated creates Sales stage + inferred predecessors", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      await insertInventoryUnit(client, inventoryId, bookingId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_initiated",
        event_ts: new Date().toISOString(),
        event_key: buildEventKey("booking_initiated", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_form", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    // Verify: 5 stages (Fresh..Sales), Sales is ACTUAL, rest INFERRED
    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(5);
    expect(stages[4].stage).toBe("Sales");
    expect(stages[4].transition_type).toBe("ACTUAL");
    expect(stages.filter((s) => s.transition_type === "INFERRED").length).toBe(4);

    // Outbox marked done
    const outbox = await getOutboxStatus(buildEventKey("booking_initiated", "booking_applications", bookingId));
    expect(outbox?.status).toBe("done");
  });

  it("booking_confirmed adds Booked stage after booking_initiated", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      await insertInventoryUnit(client, inventoryId, bookingId);

      // First: booking_initiated
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_initiated",
        event_ts: new Date().toISOString(),
        event_key: buildEventKey("booking_initiated", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_form", booking_id: bookingId },
        organization_id: ORG_ID,
      });

      // Then: booking_confirmed
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_confirmed",
        event_ts: new Date().toISOString(),
        event_key: buildEventKey("booking_confirmed", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_post_confirm", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    // All 6 stages exist
    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(6);
    expect(stages[5].stage).toBe("Booked");
    expect(stages[5].transition_type).toBe("ACTUAL");
    expect(stages[4].stage).toBe("Sales");
    expect(stages[4].transition_type).toBe("ACTUAL");

    // Both outbox events done
    const o1 = await getOutboxStatus(buildEventKey("booking_initiated", "booking_applications", bookingId));
    const o2 = await getOutboxStatus(buildEventKey("booking_confirmed", "booking_applications", bookingId));
    expect(o1?.status).toBe("done");
    expect(o2?.status).toBe("done");
  });
});

// ============================================================================
// 2. Inventory verification failure
// ============================================================================

describe("Integration: Inventory verification failure", () => {
  it("confirmation transaction verifies inventory — query matches booking_id + org + status", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      // Insert inventory as 'available' (not 'booked') — simulates released unit
      await insertInventoryUnit(client, inventoryId, bookingId, ORG_ID, "available");

      // The inventory check query from route.ts — should return 0 rows
      const invCheck = await client.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [bookingId, ORG_ID],
      );
      expect(invCheck.rows.length).toBe(0);
    });
  });

  it("inventory with wrong org_id is not matched", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      // Insert inventory under a DIFFERENT org
      await insertInventoryUnit(client, inventoryId, bookingId, ORG_ID_B, "booked");

      const invCheck = await client.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [bookingId, ORG_ID],
      );
      expect(invCheck.rows.length).toBe(0);
    });
  });
});

// ============================================================================
// 3. Zero-row confirmation UPDATE
// ============================================================================

describe("Integration: Zero-row confirmation UPDATE", () => {
  it("already-confirmed booking returns 0 rows from RETURNING", async () => {
    const { leadId, bookingId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId, ORG_ID, "Confirmed");

      const confirmRes = await client.query(
        `UPDATE booking_applications
            SET booking_status = 'Confirmed', confirmed_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND booking_status = 'Pending'
          RETURNING id`,
        [bookingId, ORG_ID],
      );
      expect(confirmRes.rows.length).toBe(0);
    });
  });

  it("Pending booking returns 1 row from RETURNING", async () => {
    const { leadId, bookingId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId, ORG_ID, "Pending");

      const confirmRes = await client.query(
        `UPDATE booking_applications
            SET booking_status = 'Confirmed', confirmed_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND booking_status = 'Pending'
          RETURNING id`,
        [bookingId, ORG_ID],
      );
      expect(confirmRes.rows.length).toBe(1);
      expect(confirmRes.rows[0].id).toBe(bookingId);
    });

    // Verify committed
    expect(await getBookingStatus(bookingId)).toBe("Confirmed");
  });
});

// ============================================================================
// 4. Missing inventory row
// ============================================================================

describe("Integration: Missing inventory row", () => {
  it("no inventory_units row at all — verification returns 0 rows", async () => {
    const { leadId, bookingId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      // Deliberately no inventory row

      const invCheck = await client.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [bookingId, ORG_ID],
      );
      expect(invCheck.rows.length).toBe(0);
    });
  });
});

// ============================================================================
// 5. Wrong-tenant inventory row
// ============================================================================

describe("Integration: Wrong-tenant inventory row", () => {
  it("inventory from org B not visible to org A query", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      await insertInventoryUnit(client, inventoryId, bookingId, ORG_ID_B, "booked");

      // Query as org A
      const invCheck = await client.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [bookingId, ORG_ID],
      );
      expect(invCheck.rows.length).toBe(0);

      // Query as org B — should find it
      const invCheckB = await client.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [bookingId, ORG_ID_B],
      );
      expect(invCheckB.rows.length).toBe(1);
    });
  });
});

// ============================================================================
// 6. Duplicate inventory association
// ============================================================================

describe("Integration: Duplicate inventory association", () => {
  it("multiple units for same booking — LIMIT 1 returns exactly one", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();
    const inventoryId2 = inventoryId + 1000;

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      await insertInventoryUnit(client, inventoryId, bookingId);
      // Second unit linked to same booking
      await client.query(
        `INSERT INTO inventory_units
           (id, project_name, tower, unit_type, floor, flat_no, carpet_area_sqft,
            status, source, is_corner, is_park_facing, parking_slots, booking_id, organization_id)
         VALUES ($1, 'TestProject', 'TowerB', 'Flat', 2, 'F-DUP', 0,
                 'booked', 'booking_sync', false, false, 0, $2, $3)`,
        [inventoryId2, bookingId, ORG_ID],
      );

      const invCheck = await client.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [bookingId, ORG_ID],
      );
      expect(invCheck.rows.length).toBe(1);
    });
  });
});

// ============================================================================
// 7. Two concurrent confirmation requests
// ============================================================================

describe("Integration: Concurrent confirmation", () => {
  it("only one transaction wins the Pending → Confirmed flip", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    // Set up data
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await insertLead(setup, leadId);
      await insertBooking(setup, bookingId, leadId, ORG_ID, "Pending");
      await insertInventoryUnit(setup, inventoryId, bookingId);
      await setup.query("COMMIT");
    } finally {
      setup.release();
    }

    // Two concurrent connections
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      // A locks inventory + confirms
      const invA = await clientA.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [bookingId, ORG_ID],
      );
      expect(invA.rows.length).toBe(1);

      const confirmA = await clientA.query(
        `UPDATE booking_applications
            SET booking_status = 'Confirmed', confirmed_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND booking_status = 'Pending'
          RETURNING id`,
        [bookingId, ORG_ID],
      );
      expect(confirmA.rows.length).toBe(1);

      await clientA.query("COMMIT");

      // B tries same — inventory lock was released, B can proceed
      const invB = await clientB.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [bookingId, ORG_ID],
      );
      expect(invB.rows.length).toBe(1); // inventory still 'booked'

      // But the booking is already Confirmed — 0 rows
      const confirmB = await clientB.query(
        `UPDATE booking_applications
            SET booking_status = 'Confirmed', confirmed_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND booking_status = 'Pending'
          RETURNING id`,
        [bookingId, ORG_ID],
      );
      expect(confirmB.rows.length).toBe(0); // idempotent no-op

      await clientB.query("COMMIT");
    } finally {
      clientA.release();
      clientB.release();
    }

    expect(await getBookingStatus(bookingId)).toBe("Confirmed");
  });
});

// ============================================================================
// 8. Two concurrent Pending recovery requests
// ============================================================================

describe("Integration: Concurrent Pending recovery", () => {
  it("only one recovery wins — second gets 0 rows from RETURNING", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    // Setup
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await insertLead(setup, leadId);
      await insertBooking(setup, bookingId, leadId, ORG_ID, "Pending");
      await insertInventoryUnit(setup, inventoryId, bookingId);
      await setup.query("COMMIT");
    } finally {
      setup.release();
    }

    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      // A: lock inventory + confirm
      await clientA.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [bookingId, ORG_ID],
      );

      const recA = await clientA.query(
        `UPDATE booking_applications
            SET booking_status = 'Confirmed', confirmed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND booking_status = 'Pending'
          RETURNING id`,
        [bookingId, ORG_ID],
      );
      expect(recA.rows.length).toBe(1);

      // A inserts history
      await clientA.query(
        `INSERT INTO booking_history (booking_id, updated_by, user_role, changed_fields, organization_id)
         VALUES ($1, 'AdminA', 'admin', $2, $3)`,
        [bookingId, JSON.stringify({ action: "pending_recovery" }), ORG_ID],
      );
      await clientA.query("COMMIT");

      // B: inventory lock succeeds (released by A's commit)
      await clientB.query(
        `SELECT id FROM inventory_units
          WHERE booking_id = $1 AND organization_id = $2
            AND status = 'booked' AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [bookingId, ORG_ID],
      );

      // B: confirmation fails — already Confirmed
      const recB = await clientB.query(
        `UPDATE booking_applications
            SET booking_status = 'Confirmed', confirmed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND booking_status = 'Pending'
          RETURNING id`,
        [bookingId, ORG_ID],
      );
      expect(recB.rows.length).toBe(0);
      // B should NOT insert booking_history (the code returns early)

      await clientB.query("COMMIT");
    } finally {
      clientA.release();
      clientB.release();
    }

    expect(await getBookingStatus(bookingId)).toBe("Confirmed");
    // Only 1 history row, not 2
    expect(await getBookingHistoryCount(bookingId)).toBe(1);
  });
});

// ============================================================================
// 9. Failed recovery transaction
// ============================================================================

describe("Integration: Failed recovery transaction", () => {
  it("error during recovery rolls back — booking stays Pending", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    // Setup
    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId, ORG_ID, "Pending");
      await insertInventoryUnit(client, inventoryId, bookingId);
    });

    // Attempt recovery that fails mid-transaction
    try {
      await withTransaction(async (client) => {
        // Inventory check passes
        const invCheck = await client.query(
          `SELECT id FROM inventory_units
            WHERE booking_id = $1 AND organization_id = $2
              AND status = 'booked' AND deleted_at IS NULL
            LIMIT 1 FOR UPDATE`,
          [bookingId, ORG_ID],
        );
        expect(invCheck.rows.length).toBe(1);

        // Confirm succeeds
        await client.query(
          `UPDATE booking_applications
              SET booking_status = 'Confirmed', confirmed_at = NOW()
            WHERE id = $1 AND organization_id = $2 AND booking_status = 'Pending'`,
          [bookingId, ORG_ID],
        );

        // Simulate failure after confirm but before commit
        throw new Error("Simulated failure");
      });
    } catch (err: any) {
      expect(err.message).toBe("Simulated failure");
    }

    // Booking should still be Pending (transaction rolled back)
    expect(await getBookingStatus(bookingId)).toBe("Pending");
    // Inventory still booked
    const inv = await getInventoryStatus(inventoryId);
    expect(inv?.status).toBe("booked");
    expect(inv?.booking_id).toBe(bookingId);
  });
});

// ============================================================================
// 10. Existing failed event reprocessing (forceRetryStuckEvent)
// ============================================================================

describe("Integration: Failed event reprocessing via force-retry", () => {
  it("duplicate event_key with status=failed triggers reprocessing", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();
    const eventKey = buildEventKey("booking_confirmed", "booking_applications", bookingId);

    // Setup: lead + manually insert a 'failed' outbox event
    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId, ORG_ID, "Confirmed");
      await insertInventoryUnit(client, inventoryId, bookingId);

      // Manually insert a failed outbox event
      await client.query(
        `INSERT INTO deal_stage_outbox
           (lead_id, event_type, event_ts, event_key, actor_id, payload, organization_id, status, attempts, error_message)
         VALUES ($1, 'booking_confirmed', NOW(), $2, NULL, $3, $4, 'failed', 3, 'previous error')`,
        [leadId, eventKey, JSON.stringify({ source: "test", booking_id: bookingId }), ORG_ID],
      );
    });

    // Verify initial state: outbox is 'failed', no stages
    expect((await getOutboxStatus(eventKey))?.status).toBe("failed");
    expect((await getStageHistory(leadId)).length).toBe(0);

    // Now call insertAndProcessOutboxEvent with the same event_key.
    // INSERT hits ON CONFLICT DO NOTHING → forceRetryStuckEvent fires.
    await withTransaction(async (client) => {
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_confirmed",
        event_ts: new Date().toISOString(),
        event_key: eventKey,
        actor_id: null,
        payload: { source: "reactivation", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    // Outbox should now be 'done'
    const outbox = await getOutboxStatus(eventKey);
    expect(outbox?.status).toBe("done");

    // Stage history should have Booked + inferred predecessors
    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(6);
    expect(stages[5].stage).toBe("Booked");
    expect(stages[5].transition_type).toBe("ACTUAL");
  });
});

// ============================================================================
// 11. Existing completed event deduplication
// ============================================================================

describe("Integration: Completed event dedup", () => {
  it("duplicate event_key with status=done — force-retry is no-op", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();
    const eventKey = buildEventKey("booking_confirmed", "booking_applications", bookingId);

    // Create a fully processed event
    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId, ORG_ID, "Confirmed");
      await insertInventoryUnit(client, inventoryId, bookingId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_confirmed",
        event_ts: new Date().toISOString(),
        event_key: eventKey,
        actor_id: null,
        payload: { source: "initial", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    expect((await getOutboxStatus(eventKey))?.status).toBe("done");
    const stagesBefore = await getStageHistory(leadId);
    expect(stagesBefore.length).toBe(6);

    // Re-submit same event_key
    await withTransaction(async (client) => {
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_confirmed",
        event_ts: new Date().toISOString(),
        event_key: eventKey,
        actor_id: null,
        payload: { source: "reactivation", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    // Still 'done', still 6 stages, no duplicates
    expect((await getOutboxStatus(eventKey))?.status).toBe("done");
    const stagesAfter = await getStageHistory(leadId);
    expect(stagesAfter.length).toBe(6);
  });
});

// ============================================================================
// 12. Concurrent force-retry (SKIP LOCKED)
// ============================================================================

describe("Integration: Concurrent force-retry with SKIP LOCKED", () => {
  it("one connection locks the event, the other skips it", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();
    const eventKey = buildEventKey("booking_confirmed", "booking_applications", bookingId);

    // Setup: lead + failed outbox event
    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId, ORG_ID, "Confirmed");
      await insertInventoryUnit(client, inventoryId, bookingId);

      await client.query(
        `INSERT INTO deal_stage_outbox
           (lead_id, event_type, event_ts, event_key, actor_id, payload, organization_id, status, attempts)
         VALUES ($1, 'booking_confirmed', NOW(), $2, NULL, $3, $4, 'failed', 1)`,
        [leadId, eventKey, JSON.stringify({ source: "test", booking_id: bookingId }), ORG_ID],
      );
    });

    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      // A locks the event
      const lockA = await clientA.query(
        `SELECT id, lead_id, event_type, event_ts, event_key,
                actor_id, payload, organization_id, attempts
           FROM deal_stage_outbox
          WHERE event_key = $1 AND organization_id = $2 AND status IN ('pending', 'failed')
          FOR UPDATE SKIP LOCKED`,
        [eventKey, ORG_ID],
      );
      expect(lockA.rows.length).toBe(1);

      // B tries same query with SKIP LOCKED — should get 0 rows
      const lockB = await clientB.query(
        `SELECT id, lead_id, event_type, event_ts, event_key,
                actor_id, payload, organization_id, attempts
           FROM deal_stage_outbox
          WHERE event_key = $1 AND organization_id = $2 AND status IN ('pending', 'failed')
          FOR UPDATE SKIP LOCKED`,
        [eventKey, ORG_ID],
      );
      expect(lockB.rows.length).toBe(0);

      await clientA.query("ROLLBACK");
      await clientB.query("ROLLBACK");
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});

// ============================================================================
// 13. SAVEPOINT isolation — processing failure preserves outbox row
// ============================================================================

describe("Integration: SAVEPOINT isolation", () => {
  it("processing failure leaves outbox as failed, business operation intact", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();
    const eventKey = buildEventKey("booking_confirmed", "booking_applications", bookingId);

    // Use a lead_id that does NOT exist to make processOneEvent fail
    const badLeadId = leadId + 50000;

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      await insertInventoryUnit(client, inventoryId, bookingId);

      // Insert outbox event pointing to a non-existent lead
      // processOneEvent will fail because the lead check fails
      await insertAndProcessOutboxEvent(client, {
        lead_id: badLeadId,
        event_type: "booking_confirmed",
        event_ts: new Date().toISOString(),
        event_key: eventKey,
        actor_id: null,
        payload: { source: "test", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    // Outbox row exists and is 'failed'
    const outbox = await getOutboxStatus(eventKey);
    expect(outbox?.status).toBe("failed");
    expect(outbox?.attempts).toBe(1);

    // Booking row still exists (business operation was not rolled back)
    expect(await getBookingStatus(bookingId)).toBe("Pending");

    // No stage history (processOneEvent was rolled back via SAVEPOINT)
    const stages = await getStageHistory(badLeadId);
    expect(stages.length).toBe(0);
  });
});

// ============================================================================
// 14. Outbox tenant isolation — cross-tenant force-retry blocked
// ============================================================================

describe("Integration: Outbox tenant isolation", () => {
  it("force-retry with wrong org_id does not find the event", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();
    const eventKey = buildEventKey("booking_confirmed", "booking_applications", bookingId);

    // Create a failed event in ORG_ID
    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      await insertInventoryUnit(client, inventoryId, bookingId);

      await client.query(
        `INSERT INTO deal_stage_outbox
           (lead_id, event_type, event_ts, event_key, actor_id, payload, organization_id, status, attempts)
         VALUES ($1, 'booking_confirmed', NOW(), $2, NULL, $3, $4, 'failed', 2)`,
        [leadId, eventKey, JSON.stringify({ source: "test" }), ORG_ID],
      );
    });

    // Try to force-retry from ORG_ID_B — should find nothing
    await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT id FROM deal_stage_outbox
          WHERE event_key = $1 AND organization_id = $2 AND status IN ('pending', 'failed')
          FOR UPDATE SKIP LOCKED`,
        [eventKey, ORG_ID_B],
      );
      expect(res.rows.length).toBe(0);
    });

    // Event still 'failed' — not touched
    expect((await getOutboxStatus(eventKey))?.status).toBe("failed");
  });
});

// ============================================================================
// 15. Full end-to-end: booking_initiated + booking_confirmed pipeline
// ============================================================================

describe("Integration: Full pipeline — initiated then confirmed", () => {
  it("produces 6 stages, Booked ACTUAL, Sales ACTUAL, 4 INFERRED", async () => {
    const { leadId, bookingId, inventoryId } = freshIds();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertBooking(client, bookingId, leadId);
      await insertInventoryUnit(client, inventoryId, bookingId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_initiated",
        event_ts: "2026-11-01T10:00:00.000Z",
        event_key: buildEventKey("booking_initiated", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_form", booking_id: bookingId },
        organization_id: ORG_ID,
      });

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_confirmed",
        event_ts: "2026-11-01T10:00:01.000Z",
        event_key: buildEventKey("booking_confirmed", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_post_confirm", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(6);

    // Verify each stage
    const expected = [
      { stage: "Fresh", ordinal: 1, type: "INFERRED" },
      { stage: "Contacted", ordinal: 2, type: "INFERRED" },
      { stage: "Site Visit", ordinal: 3, type: "INFERRED" },
      { stage: "Negotiation", ordinal: 4, type: "INFERRED" },
      { stage: "Sales", ordinal: 5, type: "ACTUAL" },
      { stage: "Booked", ordinal: 6, type: "ACTUAL" },
    ];

    for (let i = 0; i < 6; i++) {
      expect(stages[i].stage).toBe(expected[i].stage);
      expect(stages[i].stage_ordinal).toBe(expected[i].ordinal);
      expect(stages[i].transition_type).toBe(expected[i].type);
    }

    // Both outbox events done
    const o1 = await getOutboxStatus(buildEventKey("booking_initiated", "booking_applications", bookingId));
    const o2 = await getOutboxStatus(buildEventKey("booking_confirmed", "booking_applications", bookingId));
    expect(o1?.status).toBe("done");
    expect(o2?.status).toBe("done");
  });
});
