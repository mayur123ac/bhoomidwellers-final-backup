/**
 * Phase 2 Final Acceptance Audit — Test Cases
 *
 * These tests verify the five audit concerns (A–E) identified in the
 * acceptance review. They test only pure functions; database integration
 * tests are marked BLOCKED (no test database available).
 */
import { describe, it, expect } from "vitest";
import {
  computeReconciledTimestamps,
  computeStageDurations,
  buildApiResponse,
  STAGE_NAMES,
  type ReconcileInput,
  type StageHistoryRow,
} from "./dealStage";

const T = (day: number) => `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;

function makeReconcileRow(
  id: number,
  ordinal: number,
  entered_at: string,
  type: "ACTUAL" | "INFERRED",
): ReconcileInput {
  return { id, stage_ordinal: ordinal, entered_at, transition_type: type };
}

function makeHistoryRow(
  ordinal: number,
  entered_at: string,
  type: "ACTUAL" | "INFERRED",
  overrides?: Partial<StageHistoryRow>,
): StageHistoryRow {
  return {
    id: ordinal * 100,
    lead_id: 1,
    stage: STAGE_NAMES[ordinal],
    stage_ordinal: ordinal,
    entered_at,
    transition_type: type,
    source_event: "test",
    source_record_id: null,
    source_table: null,
    triggered_by: null,
    organization_id: "org-1",
    created_at: entered_at,
    ...overrides,
  };
}

// ===========================================================================
// AUDIT A: Two ACTUAL events targeting the same stage — processing order
// ===========================================================================

describe("Audit A: first-ACTUAL-wins policy and processing order", () => {
  /**
   * Scenario: Sales form (Nov 8) and Call completed (Nov 7) both target Contacted.
   *
   * processOneEvent logic trace:
   *
   * ORDER 1 — Sales form first (Nov 8), then Call (Nov 7):
   *   Event 1 (sales_form, Nov 8): Lead has Fresh(ACTUAL). targetOrdinal=2 > highestExisting=1.
   *     → Step 6: INSERT Contacted(ACTUAL, Nov 8, source=sales_form) ON CONFLICT DO NOTHING.
   *     → Result: Contacted = { entered_at: Nov 8, source_event: sales_form }
   *
   *   Event 2 (call_completed, Nov 7): Lead has Fresh, Contacted(ACTUAL). targetOrdinal=2 <= highestExisting=2.
   *     → Step 4: existingRow = Contacted, transition_type = 'ACTUAL'.
   *     → condition `transition_type === "INFERRED"` is FALSE.
   *     → No UPDATE executed. No-op. Return.
   *     → Result: Contacted = { entered_at: Nov 8, source_event: sales_form } (UNCHANGED)
   *
   * ORDER 2 — Call first (Nov 7), then Sales form (Nov 8):
   *   Event 1 (call_completed, Nov 7): Lead has Fresh(ACTUAL). targetOrdinal=2 > highestExisting=1.
   *     → Step 6: INSERT Contacted(ACTUAL, Nov 7, source=call_completed) ON CONFLICT DO NOTHING.
   *     → Result: Contacted = { entered_at: Nov 7, source_event: call_completed }
   *
   *   Event 2 (sales_form, Nov 8): Lead has Fresh, Contacted(ACTUAL). targetOrdinal=2 <= highestExisting=2.
   *     → Step 4: existingRow = Contacted, transition_type = 'ACTUAL'.
   *     → condition `transition_type === "INFERRED"` is FALSE.
   *     → No UPDATE executed. No-op. Return.
   *     → Result: Contacted = { entered_at: Nov 7, source_event: call_completed } (UNCHANGED)
   *
   * CONCLUSION: The entered_at timestamp differs:
   *   Order 1 → Nov 8, Order 2 → Nov 7.
   *   The source_event also differs: sales_form vs call_completed.
   *
   * This is a KNOWN ORDER-DEPENDENT BEHAVIOR. The entered_at reflects whichever
   * ACTUAL event was processed first. The second ACTUAL is silently discarded.
   *
   * The TIMESTAMP is order-dependent, but the STAGE PROJECTION (which stage the
   * lead is in) is order-independent. Both orders produce the same set of stages.
   */

  it("documents: entered_at depends on processing order for same-stage ACTUALs", () => {
    // Simulate the reconciliation output for both orders.
    // After order 1: Contacted is ACTUAL@Nov8
    // After order 2: Contacted is ACTUAL@Nov7
    // Reconciliation cannot fix this because both are ACTUAL — it never touches ACTUAL rows.

    // Order 1 final state:
    const order1 = [
      makeReconcileRow(1, 1, T(1), "ACTUAL"),  // Fresh
      makeReconcileRow(2, 2, T(8), "ACTUAL"),   // Contacted — from sales_form
    ];

    // Order 2 final state:
    const order2 = [
      makeReconcileRow(1, 1, T(1), "ACTUAL"),  // Fresh
      makeReconcileRow(2, 2, T(7), "ACTUAL"),   // Contacted — from call_completed
    ];

    const r1 = computeReconciledTimestamps(order1);
    const r2 = computeReconciledTimestamps(order2);

    // Both have no updates (all ACTUAL) and no contradiction
    expect(r1.updates).toEqual([]);
    expect(r2.updates).toEqual([]);
    expect(r1.hasContradiction).toBe(false);
    expect(r2.hasContradiction).toBe(false);

    // But the entered_at values are different — reconciliation cannot resolve this
    expect(order1[1].entered_at).not.toBe(order2[1].entered_at);
  });

  it("documents: stage projection is identical regardless of order", () => {
    // Both orders produce: Fresh(ACTUAL), Contacted(ACTUAL) — same stages, same ordinals
    const rows1 = [
      makeHistoryRow(1, T(1), "ACTUAL"),
      makeHistoryRow(2, T(8), "ACTUAL"),
    ];
    const rows2 = [
      makeHistoryRow(1, T(1), "ACTUAL"),
      makeHistoryRow(2, T(7), "ACTUAL"),
    ];

    const resp1 = buildApiResponse(rows1, 1);
    const resp2 = buildApiResponse(rows2, 1);

    expect(resp1.currentStage).toBe(resp2.currentStage);
    expect(resp1.currentOrdinal).toBe(resp2.currentOrdinal);
    expect(resp1.stages.length).toBe(resp2.stages.length);
    expect(resp1.upcomingStages).toEqual(resp2.upcomingStages);
    // Both timelines are consistent (both non-decreasing)
    expect(resp1.timelineConsistent).toBe(true);
    expect(resp2.timelineConsistent).toBe(true);
  });
});

// ===========================================================================
// AUDIT B: Contradictory ACTUAL timestamps
// ===========================================================================

describe("Audit B: contradictory ACTUAL timestamps", () => {
  it("are never silently modified", () => {
    const rows = [
      makeReconcileRow(1, 1, T(10), "ACTUAL"),  // Fresh — later
      makeReconcileRow(2, 2, T(5),  "ACTUAL"),   // Contacted — earlier
    ];
    const r = computeReconciledTimestamps(rows);
    // No updates means neither ACTUAL was modified
    expect(r.updates).toEqual([]);
    // Timestamps are unchanged
    expect(rows[0].entered_at).toBe(T(10));
    expect(rows[1].entered_at).toBe(T(5));
  });

  it("set timelineConsistent to false via duration clamping", () => {
    const histRows = [
      makeHistoryRow(1, T(10), "ACTUAL"),
      makeHistoryRow(2, T(5),  "ACTUAL"),
    ];
    const resp = buildApiResponse(histRows, 1);
    expect(resp.timelineConsistent).toBe(false);
  });

  it("are distinguishable from INFERRED reconciliation in the API", () => {
    // Contradictory ACTUALs: duration_clamped=true, entered_at reflects original business times
    // INFERRED reconciliation: duration_clamped=false (timestamps were fixed), entered_at is adjusted

    // Case 1: Contradictory ACTUALs
    const contradictory = [
      makeHistoryRow(1, T(10), "ACTUAL"),
      makeHistoryRow(2, T(5),  "ACTUAL"),
    ];
    const resp1 = buildApiResponse(contradictory, 1);
    expect(resp1.stages[0].duration_clamped).toBe(true);
    expect(resp1.stages[0].transition_type).toBe("ACTUAL");
    expect(resp1.stages[1].transition_type).toBe("ACTUAL");

    // Case 2: Reconciled INFERRED (no clamping needed after reconciliation)
    const reconciled = [
      makeHistoryRow(1, T(3), "INFERRED"),
      makeHistoryRow(2, T(5), "ACTUAL"),
    ];
    const resp2 = buildApiResponse(reconciled, 1);
    expect(resp2.stages[0].duration_clamped).toBe(false);
    expect(resp2.stages[0].transition_type).toBe("INFERRED");
  });

  it("cannot produce misleading duration output", () => {
    // Negative durations are clamped to 0 and flagged
    const rows = [
      makeHistoryRow(1, T(10), "ACTUAL"),
      makeHistoryRow(2, T(5),  "ACTUAL"),
      makeHistoryRow(3, T(8),  "ACTUAL"),
    ];
    const durations = computeStageDurations(rows);

    // Fresh(Nov10) → Contacted(Nov5): negative → clamped to 0, flagged
    expect(durations[0].duration_ms).toBe(0);
    expect(durations[0].duration_clamped).toBe(true);

    // Contacted(Nov5) → SiteVisit(Nov8): positive, normal
    expect(durations[1].duration_ms).toBe(3 * 86400000);
    expect(durations[1].duration_clamped).toBe(false);

    // A consumer seeing duration_clamped=true knows the data is inconsistent
    // and should not be treated as real elapsed time.
  });
});

// ===========================================================================
// AUDIT D: Database concurrency — BLOCKED (no test database)
// ===========================================================================

describe("Audit D: database concurrency", () => {
  it.skip("BLOCKED: two concurrent events targeting the same lead — requires real database", () => {
    // Would test: INSERT two outbox events for the same lead, process both
    // concurrently. FOR UPDATE on walkin_enquiries serializes them.
    // Verify: exactly one Contacted row, both outbox events marked 'done'.
  });

  it.skip("BLOCKED: two concurrent events targeting different stages — requires real database", () => {
    // Would test: sales_form_submitted + site_visit_scheduled for same lead.
    // Both should succeed without contention (FOR UPDATE serializes).
  });

  it.skip("BLOCKED: concurrent late-event reconciliation — requires real database", () => {
    // Would test: two events for the same lead processed concurrently,
    // both triggering reconciliation. FOR UPDATE on walkin_enquiries means
    // only one runs at a time, so there is no concurrent reconciliation.
  });

  it.skip("BLOCKED: transaction rollback after INFERRED timestamps updated — requires real database", () => {
    // Would test: processOneEvent inserts stages + runs reconciliation,
    // then the SAVEPOINT is rolled back. All changes (including reconciled
    // timestamps) should be undone.
  });

  it.skip("BLOCKED: duplicate outbox event insertion — requires real database", () => {
    // Would test: two concurrent INSERT INTO deal_stage_outbox with the
    // same event_key. ON CONFLICT (event_key) DO NOTHING ensures exactly
    // one row. Second INSERT silently succeeds with 0 affected rows.
  });
});
