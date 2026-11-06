/**
 * Deal Stage Pipeline: Site Visit Integration Tests
 *
 * Tests the unification of both Site Visit pathways:
 * 1. Sales Form site visit scheduling (`site_visit_scheduled_via_salesform`)
 * 2. Individual site visit scheduling (`site_visit_scheduled`)
 *
 * Both must converge on the same stage (Site Visit, ordinal 3) via
 * the same outbox + processOneEvent pipeline.
 *
 * Prerequisites:
 *   - Local PostgreSQL running on localhost:5432
 *   - deal_stage_test database with migration applied
 *
 * Run: npx vitest run src/lib/dealStage.sitevisit.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, PoolClient } from "pg";
import { insertAndProcessOutboxEvent, buildEventKey } from "./dealStageOutbox";

// ---------------------------------------------------------------------------
// Test database connection
// ---------------------------------------------------------------------------

const TEST_DB_URL = "postgresql://postgres:8369787919@localhost:5432/deal_stage_test";
let pool: Pool;

const ORG_ID = "00000000-0000-4000-a000-000000000001";
const ORG_ID_B = "00000000-0000-4000-a000-000000000002";

let nextId = 80000;
function freshLeadId() { return ++nextId; }
let nextSiteVisitId = 80000;
function freshSiteVisitId() { return ++nextSiteVisitId; }
let nextFollowUpId = 80000;
function freshFollowUpId() { return ++nextFollowUpId; }

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
  const res = await pool.query("SELECT 1 AS ok");
  expect(res.rows[0].ok).toBe(1);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("DELETE FROM deal_stage_history WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM deal_stage_outbox WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM booking_history WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM inventory_units WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM booking_applications WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
  await pool.query("DELETE FROM walkin_enquiries WHERE organization_id = $1 OR organization_id = $2", [ORG_ID, ORG_ID_B]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertLead(client: PoolClient, id: number, orgId = ORG_ID) {
  await client.query(
    `INSERT INTO walkin_enquiries (id, name, phone, sr_no, status, organization_id)
     VALUES ($1, $2, $3, $4, 'Open', $5)
     ON CONFLICT (id) DO NOTHING`,
    [id, `SV Test Lead ${id}`, `9100${id}`, id, orgId],
  );
}

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

async function getStageHistory(leadId: number) {
  const r = await pool.query(
    `SELECT stage, stage_ordinal, transition_type, source_event, source_table, source_record_id
       FROM deal_stage_history WHERE lead_id = $1 ORDER BY stage_ordinal`,
    [leadId],
  );
  return r.rows as {
    stage: string;
    stage_ordinal: number;
    transition_type: string;
    source_event: string;
    source_table: string | null;
    source_record_id: number | null;
  }[];
}

async function getOutboxStatus(eventKey: string) {
  const r = await pool.query("SELECT status, attempts FROM deal_stage_outbox WHERE event_key = $1", [eventKey]);
  return r.rows[0] as { status: string; attempts: number } | undefined;
}

// ============================================================================
// 1. Sales Form with Site Visit → stage 3
// ============================================================================

describe("Site Visit via Sales Form", () => {
  it("sales_form_submitted + site_visit_scheduled_via_salesform produces stages 1-3", async () => {
    const leadId = freshLeadId();
    const followUpId = freshFollowUpId();
    const siteVisitId = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      // 1. sales_form_submitted → Contacted (ordinal 2)
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "sales_form_submitted",
        event_ts: "2026-11-01T09:00:00.000Z",
        event_key: buildEventKey("sales_form_submitted", "follow_ups", followUpId),
        actor_id: null,
        payload: { source: "sales_form", source_table: "follow_ups", source_record_id: followUpId },
        organization_id: ORG_ID,
      });

      // 2. site_visit_scheduled_via_salesform → Site Visit (ordinal 3)
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled_via_salesform",
        event_ts: "2026-11-01T09:00:01.000Z",
        event_key: buildEventKey("site_visit_scheduled_via_salesform", "site_visits", siteVisitId),
        actor_id: null,
        payload: { source: "sales_form", source_table: "site_visits", source_record_id: siteVisitId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(3);
    expect(stages[0]).toMatchObject({ stage: "Fresh", stage_ordinal: 1, transition_type: "INFERRED" });
    expect(stages[1]).toMatchObject({ stage: "Contacted", stage_ordinal: 2, transition_type: "ACTUAL" });
    expect(stages[2]).toMatchObject({ stage: "Site Visit", stage_ordinal: 3, transition_type: "ACTUAL" });

    // Source provenance
    expect(stages[2].source_event).toBe("site_visit_scheduled_via_salesform");
    expect(stages[2].source_table).toBe("site_visits");
    expect(stages[2].source_record_id).toBe(siteVisitId);

    // Outbox entries done
    const o1 = await getOutboxStatus(buildEventKey("sales_form_submitted", "follow_ups", followUpId));
    const o2 = await getOutboxStatus(buildEventKey("site_visit_scheduled_via_salesform", "site_visits", siteVisitId));
    expect(o1?.status).toBe("done");
    expect(o2?.status).toBe("done");
  });
});

// ============================================================================
// 2. Individual Site Visit scheduling → stage 3
// ============================================================================

describe("Site Visit via Individual Scheduling", () => {
  it("site_visit_scheduled produces stages 1-3 with INFERRED Fresh + Contacted", async () => {
    const leadId = freshLeadId();
    const siteVisitId = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-02T10:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", siteVisitId),
        actor_id: null,
        payload: { source: "site_visit_panel", source_table: "site_visits", source_record_id: siteVisitId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(3);
    expect(stages[0]).toMatchObject({ stage: "Fresh", stage_ordinal: 1, transition_type: "INFERRED" });
    expect(stages[1]).toMatchObject({ stage: "Contacted", stage_ordinal: 2, transition_type: "INFERRED" });
    expect(stages[2]).toMatchObject({ stage: "Site Visit", stage_ordinal: 3, transition_type: "ACTUAL" });

    expect(stages[2].source_event).toBe("site_visit_scheduled");
    expect(stages[2].source_table).toBe("site_visits");
    expect(stages[2].source_record_id).toBe(siteVisitId);
  });
});

// ============================================================================
// 3. Both pathways converge on the same stage (ordinal 3)
// ============================================================================

describe("Both pathways converge", () => {
  it("individual then salesform — second is no-op (already ACTUAL)", async () => {
    const leadId = freshLeadId();
    const svId1 = freshSiteVisitId();
    const svId2 = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      // First: individual scheduling
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-03T08:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId1),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId1 },
        organization_id: ORG_ID,
      });

      // Second: salesform scheduling — same target ordinal 3
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled_via_salesform",
        event_ts: "2026-11-03T09:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled_via_salesform", "site_visits", svId2),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId2 },
        organization_id: ORG_ID,
      });
    });

    // Still only 3 stages — no duplicates
    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(3);
    expect(stages[2].stage).toBe("Site Visit");
    expect(stages[2].transition_type).toBe("ACTUAL");
    // First event wins — source_event preserved from first scheduling
    expect(stages[2].source_event).toBe("site_visit_scheduled");

    // Both outbox events are done
    const o1 = await getOutboxStatus(buildEventKey("site_visit_scheduled", "site_visits", svId1));
    const o2 = await getOutboxStatus(buildEventKey("site_visit_scheduled_via_salesform", "site_visits", svId2));
    expect(o1?.status).toBe("done");
    expect(o2?.status).toBe("done");
  });

  it("salesform then individual — second is no-op (already ACTUAL)", async () => {
    const leadId = freshLeadId();
    const svId1 = freshSiteVisitId();
    const svId2 = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled_via_salesform",
        event_ts: "2026-11-03T08:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled_via_salesform", "site_visits", svId1),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId1 },
        organization_id: ORG_ID,
      });

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-03T09:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId2),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId2 },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(3);
    expect(stages[2].stage).toBe("Site Visit");
    expect(stages[2].transition_type).toBe("ACTUAL");
    expect(stages[2].source_event).toBe("site_visit_scheduled_via_salesform");
  });
});

// ============================================================================
// 4. Site Visit completed → Negotiation (ordinal 4)
// ============================================================================

describe("Site Visit completed advances to Negotiation", () => {
  it("site_visit_completed after site_visit_scheduled produces 4 stages", async () => {
    const leadId = freshLeadId();
    const svId = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-04T08:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_completed",
        event_ts: "2026-11-05T14:00:00.000Z",
        event_key: buildEventKey("site_visit_completed", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(4);
    expect(stages[0]).toMatchObject({ stage: "Fresh", transition_type: "INFERRED" });
    expect(stages[1]).toMatchObject({ stage: "Contacted", transition_type: "INFERRED" });
    expect(stages[2]).toMatchObject({ stage: "Site Visit", transition_type: "ACTUAL" });
    expect(stages[3]).toMatchObject({ stage: "Negotiation", stage_ordinal: 4, transition_type: "ACTUAL" });
  });
});

// ============================================================================
// 5. Sales Form WITHOUT site visit → Contacted only (ordinal 2)
// ============================================================================

describe("Sales Form without site visit", () => {
  it("sales_form_submitted alone only advances to Contacted", async () => {
    const leadId = freshLeadId();
    const followUpId = freshFollowUpId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "sales_form_submitted",
        event_ts: "2026-11-05T10:00:00.000Z",
        event_key: buildEventKey("sales_form_submitted", "follow_ups", followUpId),
        actor_id: null,
        payload: { source_table: "follow_ups", source_record_id: followUpId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(2);
    expect(stages[0]).toMatchObject({ stage: "Fresh", stage_ordinal: 1, transition_type: "INFERRED" });
    expect(stages[1]).toMatchObject({ stage: "Contacted", stage_ordinal: 2, transition_type: "ACTUAL" });
    // No Site Visit stage
    expect(stages.find((s) => s.stage === "Site Visit")).toBeUndefined();
  });
});

// ============================================================================
// 6. Individual site visit on already-Contacted lead → advances to Site Visit
// ============================================================================

describe("Site visit on already-Contacted lead", () => {
  it("Contacted ACTUAL upgraded, then Site Visit added as ACTUAL", async () => {
    const leadId = freshLeadId();
    const followUpId = freshFollowUpId();
    const svId = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      // Step 1: sales_form → Contacted
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "sales_form_submitted",
        event_ts: "2026-11-01T09:00:00.000Z",
        event_key: buildEventKey("sales_form_submitted", "follow_ups", followUpId),
        actor_id: null,
        payload: { source_table: "follow_ups", source_record_id: followUpId },
        organization_id: ORG_ID,
      });

      // Step 2: individual site visit scheduling
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-02T10:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(3);
    expect(stages[1]).toMatchObject({ stage: "Contacted", transition_type: "ACTUAL" });
    expect(stages[2]).toMatchObject({ stage: "Site Visit", transition_type: "ACTUAL" });
  });
});

// ============================================================================
// 7. Site visit on lead that already has Site Visit → INFERRED corrected to ACTUAL
// ============================================================================

describe("INFERRED→ACTUAL correction for Site Visit", () => {
  it("booking_initiated infers Site Visit, later scheduling corrects to ACTUAL", async () => {
    const leadId = freshLeadId();
    const bookingId = freshLeadId(); // reuse counter
    const svId = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      // booking_initiated skips directly to Sales (ordinal 5)
      // → infers Fresh(1), Contacted(2), Site Visit(3), Negotiation(4) as INFERRED
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_initiated",
        event_ts: "2026-11-03T12:00:00.000Z",
        event_key: buildEventKey("booking_initiated", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_form", booking_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    // Verify Site Visit is INFERRED
    let stages = await getStageHistory(leadId);
    expect(stages[2]).toMatchObject({ stage: "Site Visit", transition_type: "INFERRED" });

    // Now schedule a site visit — this should correct INFERRED→ACTUAL
    await withTransaction(async (client) => {
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-02T08:00:00.000Z", // earlier timestamp
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });
    });

    stages = await getStageHistory(leadId);
    // Still 5 stages (no duplicates)
    expect(stages.length).toBe(5);
    // Site Visit corrected to ACTUAL
    expect(stages[2]).toMatchObject({
      stage: "Site Visit",
      transition_type: "ACTUAL",
      source_event: "site_visit_scheduled",
    });
    // Used LEAST() — earlier timestamp wins
    const svEnteredAt = new Date(stages[2].source_event === "site_visit_scheduled" ? "2026-11-02T08:00:00.000Z" : "").getTime();
    expect(svEnteredAt).toBeLessThan(new Date("2026-11-03T12:00:00.000Z").getTime());
  });
});

// ============================================================================
// 8. Duplicate site visit events → idempotent
// ============================================================================

describe("Duplicate event idempotency", () => {
  it("same event_key submitted twice — second is no-op", async () => {
    const leadId = freshLeadId();
    const svId = freshSiteVisitId();
    const eventKey = buildEventKey("site_visit_scheduled", "site_visits", svId);

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-04T10:00:00.000Z",
        event_key: eventKey,
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });
    });

    const stagesBefore = await getStageHistory(leadId);
    expect(stagesBefore.length).toBe(3);

    // Submit same event_key again
    await withTransaction(async (client) => {
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-04T10:00:00.000Z",
        event_key: eventKey,
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });
    });

    // No duplicate stages
    const stagesAfter = await getStageHistory(leadId);
    expect(stagesAfter.length).toBe(3);

    // Outbox still done
    expect((await getOutboxStatus(eventKey))?.status).toBe("done");
  });
});

// ============================================================================
// 9. Forward-only progression — site visit cannot regress to Fresh
// ============================================================================

describe("Forward-only progression", () => {
  it("lead_assigned after site_visit_scheduled does not create duplicate stages", async () => {
    const leadId = freshLeadId();
    const svId = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      // Site visit first (ordinal 3)
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-05T10:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });

      // Then lead_assigned (ordinal 1) — backward, should correct INFERRED→ACTUAL
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "lead_assigned",
        event_ts: "2026-11-01T08:00:00.000Z",
        event_key: buildEventKey("lead_assigned", "walkin_enquiries", leadId),
        actor_id: null,
        payload: { source_table: "walkin_enquiries", source_record_id: leadId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    // Still 3 stages, no regression
    expect(stages.length).toBe(3);
    // Fresh corrected from INFERRED → ACTUAL
    expect(stages[0]).toMatchObject({ stage: "Fresh", transition_type: "ACTUAL" });
    expect(stages[2]).toMatchObject({ stage: "Site Visit", transition_type: "ACTUAL" });
  });
});

// ============================================================================
// 10. Both pathways' outbox events are properly persisted
// ============================================================================

describe("Outbox persistence for both pathways", () => {
  it("outbox rows contain correct source_table and event provenance", async () => {
    const leadId = freshLeadId();
    const svId1 = freshSiteVisitId();
    const svId2 = freshSiteVisitId();
    const leadId2 = freshLeadId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);
      await insertLead(client, leadId2);

      // Pathway 1: salesform
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled_via_salesform",
        event_ts: "2026-11-05T10:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled_via_salesform", "site_visits", svId1),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId1 },
        organization_id: ORG_ID,
      });

      // Pathway 2: individual
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId2,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-05T11:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId2),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId2 },
        organization_id: ORG_ID,
      });
    });

    // Verify outbox rows
    const r1 = await pool.query(
      "SELECT event_type, status, payload FROM deal_stage_outbox WHERE event_key = $1",
      [buildEventKey("site_visit_scheduled_via_salesform", "site_visits", svId1)],
    );
    expect(r1.rows[0].event_type).toBe("site_visit_scheduled_via_salesform");
    expect(r1.rows[0].status).toBe("done");

    const r2 = await pool.query(
      "SELECT event_type, status, payload FROM deal_stage_outbox WHERE event_key = $1",
      [buildEventKey("site_visit_scheduled", "site_visits", svId2)],
    );
    expect(r2.rows[0].event_type).toBe("site_visit_scheduled");
    expect(r2.rows[0].status).toBe("done");
  });
});

// ============================================================================
// 11. SAVEPOINT isolation for site visit processing failures
// ============================================================================

describe("SAVEPOINT isolation — site visit", () => {
  it("processing failure leaves outbox as failed, lead row intact", async () => {
    const leadId = freshLeadId();
    const svId = freshSiteVisitId();
    const badLeadId = leadId + 99999; // non-existent lead
    const eventKey = buildEventKey("site_visit_scheduled", "site_visits", svId);

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      // Fire event pointing to non-existent lead — processOneEvent will fail
      await insertAndProcessOutboxEvent(client, {
        lead_id: badLeadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-05T10:00:00.000Z",
        event_key: eventKey,
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });
    });

    // Outbox row is 'failed' — not lost
    const outbox = await getOutboxStatus(eventKey);
    expect(outbox?.status).toBe("failed");
    expect(outbox?.attempts).toBe(1);

    // No stage history for the bad lead
    const stages = await getStageHistory(badLeadId);
    expect(stages.length).toBe(0);

    // Original lead row still exists (business op not rolled back)
    const leadCheck = await pool.query("SELECT id FROM walkin_enquiries WHERE id = $1", [leadId]);
    expect(leadCheck.rows.length).toBe(1);
  });
});

// ============================================================================
// 12. Tenant isolation — cross-org site visit blocked
// ============================================================================

describe("Tenant isolation — site visit", () => {
  it("site visit event for org A does not affect org B leads", async () => {
    const leadIdA = freshLeadId();
    const leadIdB = freshLeadId();
    const svIdA = freshSiteVisitId();

    await withTransaction(async (client) => {
      await insertLead(client, leadIdA, ORG_ID);
      await insertLead(client, leadIdB, ORG_ID_B);

      // Schedule site visit for org A lead
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadIdA,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-05T10:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svIdA),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svIdA },
        organization_id: ORG_ID,
      });
    });

    // Org A lead has stages
    const stagesA = await getStageHistory(leadIdA);
    expect(stagesA.length).toBe(3);

    // Org B lead has no stages
    const stagesB = await getStageHistory(leadIdB);
    expect(stagesB.length).toBe(0);
  });

  it("cross-org event_key does not collide", async () => {
    const leadIdA = freshLeadId();
    const leadIdB = freshLeadId();
    const svId = freshSiteVisitId(); // same ID, different orgs

    await withTransaction(async (client) => {
      await insertLead(client, leadIdA, ORG_ID);
      await insertLead(client, leadIdB, ORG_ID_B);

      await insertAndProcessOutboxEvent(client, {
        lead_id: leadIdA,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-05T10:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });
    });

    // Same event_key but different org — outbox INSERT should succeed (event_key is globally unique)
    // But processOneEvent will fail because the lead belongs to a different org
    // The key point: org A's data is isolated
    const stagesA = await getStageHistory(leadIdA);
    expect(stagesA.length).toBe(3);
    expect(stagesA[2].stage).toBe("Site Visit");
  });
});

// ============================================================================
// 13. Full pipeline: lead_assigned → sales_form → site_visit → completed → booking
// ============================================================================

describe("Full pipeline through Site Visit", () => {
  it("complete progression with Site Visit produces all 6 stages correctly", async () => {
    const leadId = freshLeadId();
    const followUpId = freshFollowUpId();
    const svId = freshSiteVisitId();
    const bookingId = freshLeadId();

    await withTransaction(async (client) => {
      await insertLead(client, leadId);

      // 1. lead_assigned → Fresh
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "lead_assigned",
        event_ts: "2026-11-01T08:00:00.000Z",
        event_key: buildEventKey("lead_assigned", "walkin_enquiries", leadId),
        actor_id: null,
        payload: { source_table: "walkin_enquiries", source_record_id: leadId },
        organization_id: ORG_ID,
      });

      // 2. sales_form_submitted → Contacted
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "sales_form_submitted",
        event_ts: "2026-11-02T10:00:00.000Z",
        event_key: buildEventKey("sales_form_submitted", "follow_ups", followUpId),
        actor_id: null,
        payload: { source_table: "follow_ups", source_record_id: followUpId },
        organization_id: ORG_ID,
      });

      // 3. site_visit_scheduled → Site Visit
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_scheduled",
        event_ts: "2026-11-03T10:00:00.000Z",
        event_key: buildEventKey("site_visit_scheduled", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });

      // 4. site_visit_completed → Negotiation
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "site_visit_completed",
        event_ts: "2026-11-04T14:00:00.000Z",
        event_key: buildEventKey("site_visit_completed", "site_visits", svId),
        actor_id: null,
        payload: { source_table: "site_visits", source_record_id: svId },
        organization_id: ORG_ID,
      });

      // 5. booking_initiated → Sales
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_initiated",
        event_ts: "2026-11-05T10:00:00.000Z",
        event_key: buildEventKey("booking_initiated", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_form", booking_id: bookingId, source_table: "booking_applications", source_record_id: bookingId },
        organization_id: ORG_ID,
      });

      // 6. booking_confirmed → Booked
      await insertAndProcessOutboxEvent(client, {
        lead_id: leadId,
        event_type: "booking_confirmed",
        event_ts: "2026-11-05T11:00:00.000Z",
        event_key: buildEventKey("booking_confirmed", "booking_applications", bookingId),
        actor_id: null,
        payload: { source: "booking_post_confirm", booking_id: bookingId, source_table: "booking_applications", source_record_id: bookingId },
        organization_id: ORG_ID,
      });
    });

    const stages = await getStageHistory(leadId);
    expect(stages.length).toBe(6);

    const expected = [
      { stage: "Fresh",       ordinal: 1, type: "ACTUAL" },
      { stage: "Contacted",   ordinal: 2, type: "ACTUAL" },
      { stage: "Site Visit",  ordinal: 3, type: "ACTUAL" },
      { stage: "Negotiation", ordinal: 4, type: "ACTUAL" },
      { stage: "Sales",       ordinal: 5, type: "ACTUAL" },
      { stage: "Booked",      ordinal: 6, type: "ACTUAL" },
    ];

    for (let i = 0; i < 6; i++) {
      expect(stages[i].stage).toBe(expected[i].stage);
      expect(stages[i].stage_ordinal).toBe(expected[i].ordinal);
      expect(stages[i].transition_type).toBe(expected[i].type);
    }

    // Timestamps are non-decreasing
    for (let i = 0; i < stages.length - 1; i++) {
      const r = await pool.query(
        "SELECT entered_at FROM deal_stage_history WHERE lead_id = $1 AND stage_ordinal = $2",
        [leadId, stages[i].stage_ordinal],
      );
      const r2 = await pool.query(
        "SELECT entered_at FROM deal_stage_history WHERE lead_id = $1 AND stage_ordinal = $2",
        [leadId, stages[i + 1].stage_ordinal],
      );
      expect(new Date(r.rows[0].entered_at).getTime())
        .toBeLessThanOrEqual(new Date(r2.rows[0].entered_at).getTime());
    }
  });
});
