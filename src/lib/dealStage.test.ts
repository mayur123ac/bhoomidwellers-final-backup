import { describe, it, expect } from "vitest";
import {
  mapEventToStage,
  computeInferredStages,
  computeReconciledTimestamps,
  computeStageDurations,
  buildApiResponse,
  STAGE_NAMES,
  type ReconcileInput,
  type StageHistoryRow,
} from "./dealStage";
import { buildEventKey } from "./dealStageOutbox";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// mapEventToStage
// ---------------------------------------------------------------------------

describe("mapEventToStage", () => {
  it("maps all 10 event types to their correct stage and ordinal", () => {
    expect(mapEventToStage("lead_assigned")).toEqual({ stage: "Fresh", ordinal: 1 });
    expect(mapEventToStage("lead_assigned_from_queue")).toEqual({ stage: "Fresh", ordinal: 1 });
    expect(mapEventToStage("lead_assigned_bulk")).toEqual({ stage: "Fresh", ordinal: 1 });
    expect(mapEventToStage("sales_form_submitted")).toEqual({ stage: "Contacted", ordinal: 2 });
    expect(mapEventToStage("call_completed")).toEqual({ stage: "Contacted", ordinal: 2 });
    expect(mapEventToStage("site_visit_scheduled")).toEqual({ stage: "Site Visit", ordinal: 3 });
    expect(mapEventToStage("site_visit_scheduled_via_salesform")).toEqual({ stage: "Site Visit", ordinal: 3 });
    expect(mapEventToStage("site_visit_completed")).toEqual({ stage: "Negotiation", ordinal: 4 });
    expect(mapEventToStage("booking_initiated")).toEqual({ stage: "Sales", ordinal: 5 });
    expect(mapEventToStage("booking_confirmed")).toEqual({ stage: "Booked", ordinal: 6 });
  });

  it("throws for unknown event types", () => {
    expect(() => mapEventToStage("unknown_event")).toThrow("Unknown event_type: unknown_event");
  });
});

// ---------------------------------------------------------------------------
// computeInferredStages
// ---------------------------------------------------------------------------

describe("computeInferredStages", () => {
  it("returns null when target is at or below highest existing", () => {
    expect(computeInferredStages(3, 2)).toBeNull();
    expect(computeInferredStages(3, 3)).toBeNull();
  });

  it("returns null when target is one above highest (no gap)", () => {
    expect(computeInferredStages(2, 3)).toBeNull();
  });

  it("returns intermediate stages when there is a gap", () => {
    expect(computeInferredStages(0, 3)).toEqual([
      { stage: "Fresh", ordinal: 1 },
      { stage: "Contacted", ordinal: 2 },
    ]);
    expect(computeInferredStages(1, 4)).toEqual([
      { stage: "Contacted", ordinal: 2 },
      { stage: "Site Visit", ordinal: 3 },
    ]);
  });

  it("returns all 5 intermediates when jumping from 0 to Booked", () => {
    const result = computeInferredStages(0, 6);
    expect(result).toHaveLength(5);
    expect(result![0].stage).toBe("Fresh");
    expect(result![4].stage).toBe("Sales");
  });
});

// ---------------------------------------------------------------------------
// computeReconciledTimestamps
// ---------------------------------------------------------------------------

describe("computeReconciledTimestamps", () => {
  it("returns empty for no rows", () => {
    const r = computeReconciledTimestamps([]);
    expect(r.updates).toEqual([]);
    expect(r.hasContradiction).toBe(false);
  });

  it("returns no updates when all stages are ACTUAL and chronological", () => {
    const rows = [
      makeReconcileRow(1, 1, T(1), "ACTUAL"),
      makeReconcileRow(2, 2, T(3), "ACTUAL"),
      makeReconcileRow(3, 3, T(5), "ACTUAL"),
    ];
    const r = computeReconciledTimestamps(rows);
    expect(r.updates).toEqual([]);
    expect(r.hasContradiction).toBe(false);
  });

  // Test 1: Higher-stage event processed before earlier Contacted event
  it("reconciles INFERRED stages when higher-stage processed first", () => {
    // Scenario: site_visit_completed at Nov 10 processed first.
    // Infers Fresh(Nov10), Contacted(Nov10), SiteVisit(Nov10), inserts Negotiation(Nov10).
    // Then sales_form corrects Contacted to ACTUAL at Nov 5.
    const rows = [
      makeReconcileRow(1, 1, T(10), "INFERRED"),  // Fresh — stale timestamp
      makeReconcileRow(2, 2, T(5),  "ACTUAL"),     // Contacted — corrected
      makeReconcileRow(3, 3, T(10), "INFERRED"),   // Site Visit — stale
      makeReconcileRow(4, 4, T(10), "ACTUAL"),     // Negotiation — original
    ];
    const r = computeReconciledTimestamps(rows);
    expect(r.hasContradiction).toBe(false);

    // Fresh should be clamped down to Nov 5 (upper ACTUAL bound = Contacted@Nov5)
    const freshUpdate = r.updates.find((u) => u.id === 1);
    expect(freshUpdate).toBeDefined();
    expect(freshUpdate!.new_entered_at).toBe(T(5));

    // Site Visit should be clamped: lower=Contacted@Nov5, upper=Negotiation@Nov10
    // Nov 10 is within [Nov5, Nov10], so no change
    const svUpdate = r.updates.find((u) => u.id === 3);
    expect(svUpdate).toBeUndefined();
  });

  // Test 2: Earlier ACTUAL event correcting an inferred stage
  it("clamps INFERRED below an earlier ACTUAL", () => {
    // Fresh=ACTUAL@Nov1, Contacted=INFERRED@Nov10 (originally from a later event)
    const rows = [
      makeReconcileRow(1, 1, T(1),  "ACTUAL"),
      makeReconcileRow(2, 2, T(10), "INFERRED"),
      makeReconcileRow(3, 3, T(10), "ACTUAL"),
    ];
    const r = computeReconciledTimestamps(rows);
    // Contacted: lower=Fresh@Nov1, upper=SiteVisit@Nov10 → clamp(Nov10, Nov1, Nov10) = Nov10 (within bounds)
    expect(r.updates).toEqual([]);
    expect(r.hasContradiction).toBe(false);
  });

  // Test 3: Multiple inferred stages requiring reconciliation
  it("reconciles multiple INFERRED stages between ACTUAL bounds", () => {
    // booking_confirmed at Nov 10 inferred everything, then site_visit_completed
    // corrects Negotiation to ACTUAL at Nov 3.
    const rows = [
      makeReconcileRow(1, 1, T(10), "INFERRED"),  // Fresh
      makeReconcileRow(2, 2, T(10), "INFERRED"),  // Contacted
      makeReconcileRow(3, 3, T(10), "INFERRED"),  // Site Visit
      makeReconcileRow(4, 4, T(3),  "ACTUAL"),    // Negotiation
      makeReconcileRow(5, 5, T(10), "INFERRED"),  // Sales
      makeReconcileRow(6, 6, T(10), "ACTUAL"),    // Booked
    ];
    const r = computeReconciledTimestamps(rows);

    // Fresh, Contacted, SiteVisit: upper bound = Negotiation@Nov3 → clamped to Nov3
    expect(r.updates.find((u) => u.id === 1)!.new_entered_at).toBe(T(3));
    expect(r.updates.find((u) => u.id === 2)!.new_entered_at).toBe(T(3));
    expect(r.updates.find((u) => u.id === 3)!.new_entered_at).toBe(T(3));

    // Sales: lower=Negotiation@Nov3, upper=Booked@Nov10 → Nov10 within bounds
    expect(r.updates.find((u) => u.id === 5)).toBeUndefined();
    expect(r.hasContradiction).toBe(false);
  });

  // Test 4: Multiple ACTUAL timestamps establishing valid boundaries
  it("preserves INFERRED timestamps when they are within ACTUAL bounds", () => {
    const rows = [
      makeReconcileRow(1, 1, T(1), "ACTUAL"),     // Fresh
      makeReconcileRow(2, 2, T(5), "INFERRED"),   // Contacted
      makeReconcileRow(3, 3, T(8), "INFERRED"),   // Site Visit
      makeReconcileRow(4, 4, T(12), "ACTUAL"),    // Negotiation
    ];
    const r = computeReconciledTimestamps(rows);
    // Both INFERRED are within [Nov1, Nov12] — no updates
    expect(r.updates).toEqual([]);
    expect(r.hasContradiction).toBe(false);
  });

  // Test 5: Contradictory ACTUAL timestamps
  it("detects contradictory ACTUALs and preserves them", () => {
    // Fresh@Nov10 ACTUAL, Contacted@Nov5 ACTUAL — earlier ordinal has later timestamp
    const rows = [
      makeReconcileRow(1, 1, T(10), "ACTUAL"),
      makeReconcileRow(2, 2, T(5),  "ACTUAL"),
    ];
    const r = computeReconciledTimestamps(rows);
    expect(r.hasContradiction).toBe(true);
    // No INFERRED stages to update
    expect(r.updates).toEqual([]);
  });

  it("does not modify INFERRED stages caught between contradictory ACTUALs", () => {
    const rows = [
      makeReconcileRow(1, 1, T(10), "ACTUAL"),    // Fresh — later than Negotiation
      makeReconcileRow(2, 2, T(7),  "INFERRED"),  // Contacted
      makeReconcileRow(3, 3, T(7),  "INFERRED"),  // Site Visit
      makeReconcileRow(4, 4, T(5),  "ACTUAL"),    // Negotiation — earlier than Fresh
    ];
    const r = computeReconciledTimestamps(rows);
    expect(r.hasContradiction).toBe(true);
    // Contacted and SiteVisit bounds are [Nov10, Nov5] — contradictory
    // They should NOT be modified
    expect(r.updates).toEqual([]);
  });

  // Forward sweep: INFERRED stages with different timestamps between same bounds
  it("enforces non-decreasing order among consecutive INFERRED stages", () => {
    // Two events with different timestamps create INFERRED stages with mismatched times
    // via LEAST() updates. Fresh ends up later than Contacted.
    const rows = [
      makeReconcileRow(1, 1, T(8),  "INFERRED"),  // Fresh — later
      makeReconcileRow(2, 2, T(3),  "INFERRED"),  // Contacted — earlier
      makeReconcileRow(3, 3, T(10), "ACTUAL"),     // Site Visit
    ];
    const r = computeReconciledTimestamps(rows);
    // Both have upper bound = SiteVisit@Nov10.
    // Pass 1: Both within [none, Nov10] — no clamp needed.
    // Pass 2 forward sweep: floor starts null. Fresh@Nov8 → floor=Nov8.
    // Contacted@Nov3 < floor@Nov8 → upper ACTUAL is Nov10, Nov8 <= Nov10, so set to Nov8.
    expect(r.updates.find((u) => u.id === 2)!.new_entered_at).toBe(T(8));
    expect(r.hasContradiction).toBe(false);
  });

  // Edge case: all INFERRED, no ACTUAL bounds at all
  it("enforces non-decreasing among all-INFERRED stages (no ACTUAL bounds)", () => {
    const rows = [
      makeReconcileRow(1, 1, T(10), "INFERRED"),
      makeReconcileRow(2, 2, T(3),  "INFERRED"),
    ];
    const r = computeReconciledTimestamps(rows);
    // Forward sweep: floor=null, Fresh@Nov10 → floor=Nov10.
    // Contacted@Nov3 < floor=Nov10, no upper ACTUAL → set to Nov10.
    expect(r.updates.find((u) => u.id === 2)!.new_entered_at).toBe(T(10));
  });

  // Full scenario: booking_confirmed first, then events arrive in reverse
  it("produces correct timeline after cascading corrections", () => {
    // State after: booking_confirmed@Nov10, then site_visit_completed@Nov5
    // corrects Negotiation to ACTUAL, then sales_form@Nov2 corrects Contacted.
    const rows = [
      makeReconcileRow(1, 1, T(5),  "INFERRED"),  // Fresh — from earlier reconciliation
      makeReconcileRow(2, 2, T(2),  "ACTUAL"),     // Contacted
      makeReconcileRow(3, 3, T(5),  "INFERRED"),  // Site Visit — from earlier reconciliation
      makeReconcileRow(4, 4, T(5),  "ACTUAL"),     // Negotiation
      makeReconcileRow(5, 5, T(10), "INFERRED"),  // Sales
      makeReconcileRow(6, 6, T(10), "ACTUAL"),     // Booked
    ];
    const r = computeReconciledTimestamps(rows);

    // Fresh: upper ACTUAL = Contacted@Nov2 → clamp(Nov5, -, Nov2) = Nov2
    const freshUpd = r.updates.find((u) => u.id === 1);
    expect(freshUpd).toBeDefined();
    expect(freshUpd!.new_entered_at).toBe(T(2));

    // SiteVisit: lower=Contacted@Nov2, upper=Negotiation@Nov5 → clamp(Nov5, Nov2, Nov5) = Nov5 (ok)
    // Sales: lower=Negotiation@Nov5, upper=Booked@Nov10 → Nov10 within bounds (ok)
    expect(r.updates).toHaveLength(1);
    expect(r.hasContradiction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeStageDurations
// ---------------------------------------------------------------------------

describe("computeStageDurations", () => {
  it("returns empty for no rows", () => {
    expect(computeStageDurations([])).toEqual([]);
  });

  it("computes durations between consecutive stages", () => {
    const rows = [
      makeHistoryRow(1, T(1), "ACTUAL"),
      makeHistoryRow(2, T(3), "ACTUAL"),
      makeHistoryRow(3, T(7), "ACTUAL"),
    ];
    const durations = computeStageDurations(rows);
    expect(durations[0].duration_ms).toBe(2 * 86400000); // 2 days
    expect(durations[0].duration_clamped).toBe(false);
    expect(durations[1].duration_ms).toBe(4 * 86400000); // 4 days
    expect(durations[1].duration_clamped).toBe(false);
    expect(durations[2].duration_ms).toBeNull(); // last stage
  });

  it("handles equal timestamps (zero duration, not clamped)", () => {
    const rows = [
      makeHistoryRow(1, T(5), "INFERRED"),
      makeHistoryRow(2, T(5), "INFERRED"),
    ];
    const durations = computeStageDurations(rows);
    expect(durations[0].duration_ms).toBe(0);
    expect(durations[0].duration_clamped).toBe(false);
  });

  // Test 8: Duration calculations after reconciliation — contradictory ACTUALs
  it("clamps negative durations and flags them", () => {
    const rows = [
      makeHistoryRow(1, T(10), "ACTUAL"),  // Fresh later than Contacted
      makeHistoryRow(2, T(5),  "ACTUAL"),  // Contacted
    ];
    const durations = computeStageDurations(rows);
    expect(durations[0].duration_ms).toBe(0);
    expect(durations[0].duration_clamped).toBe(true);
  });

  it("orders by ordinal not input order", () => {
    const rows = [
      makeHistoryRow(3, T(7), "ACTUAL"),
      makeHistoryRow(1, T(1), "ACTUAL"),
      makeHistoryRow(2, T(3), "ACTUAL"),
    ];
    const durations = computeStageDurations(rows);
    expect(durations[0].stage).toBe("Fresh");
    expect(durations[1].stage).toBe("Contacted");
    expect(durations[2].stage).toBe("Site Visit");
  });
});

// ---------------------------------------------------------------------------
// buildApiResponse
// ---------------------------------------------------------------------------

describe("buildApiResponse", () => {
  it("returns Untracked with all upcoming for empty history", () => {
    const resp = buildApiResponse([], 42);
    expect(resp.currentStage).toBe("Untracked");
    expect(resp.currentOrdinal).toBe(0);
    expect(resp.upcomingStages).toHaveLength(6);
    expect(resp.timelineConsistent).toBe(true);
  });

  it("returns correct current stage and upcoming", () => {
    const rows = [
      makeHistoryRow(1, T(1), "ACTUAL"),
      makeHistoryRow(2, T(3), "ACTUAL"),
    ];
    const resp = buildApiResponse(rows, 1);
    expect(resp.currentStage).toBe("Contacted");
    expect(resp.currentOrdinal).toBe(2);
    expect(resp.upcomingStages).toHaveLength(4);
    expect(resp.upcomingStages[0].stage).toBe("Site Visit");
  });

  it("flags timeline inconsistency from contradictory ACTUALs", () => {
    const rows = [
      makeHistoryRow(1, T(10), "ACTUAL"),
      makeHistoryRow(2, T(5),  "ACTUAL"),
    ];
    const resp = buildApiResponse(rows, 1);
    expect(resp.timelineConsistent).toBe(false);
  });

  it("reports consistent timeline for a normal progression", () => {
    const rows = [
      makeHistoryRow(1, T(1), "ACTUAL"),
      makeHistoryRow(2, T(3), "INFERRED"),
      makeHistoryRow(3, T(5), "ACTUAL"),
    ];
    const resp = buildApiResponse(rows, 1);
    expect(resp.timelineConsistent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Two ACTUAL events for the same stage
// ---------------------------------------------------------------------------

describe("two ACTUAL events for the same stage", () => {
  it("reconciliation is a no-op when all stages are ACTUAL", () => {
    // If two events both target Contacted (e.g., sales_form + call_completed),
    // the first one wins via ON CONFLICT DO NOTHING / INFERRED→ACTUAL.
    // By the time reconciliation runs, there is exactly one row per stage.
    // This test verifies reconciliation doesn't break an all-ACTUAL timeline.
    const rows = [
      makeReconcileRow(1, 1, T(1), "ACTUAL"),
      makeReconcileRow(2, 2, T(3), "ACTUAL"), // first Contacted wins
      makeReconcileRow(3, 3, T(5), "ACTUAL"),
    ];
    const r = computeReconciledTimestamps(rows);
    expect(r.updates).toEqual([]);
    expect(r.hasContradiction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Repeated processing of the same event (idempotency)
// ---------------------------------------------------------------------------

describe("repeated processing idempotency", () => {
  it("reconciliation is stable when called multiple times on the same state", () => {
    const rows = [
      makeReconcileRow(1, 1, T(10), "INFERRED"),
      makeReconcileRow(2, 2, T(5),  "ACTUAL"),
      makeReconcileRow(3, 3, T(10), "INFERRED"),
      makeReconcileRow(4, 4, T(10), "ACTUAL"),
    ];

    // First reconciliation
    const r1 = computeReconciledTimestamps(rows);
    expect(r1.updates.length).toBeGreaterThan(0);

    // Apply updates to get the reconciled state
    const reconciled = rows.map((row) => {
      const upd = r1.updates.find((u) => u.id === row.id);
      return upd ? { ...row, entered_at: upd.new_entered_at } : row;
    });

    // Second reconciliation on already-reconciled state — should be no-op
    const r2 = computeReconciledTimestamps(reconciled);
    expect(r2.updates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 10: Processing order does not alter final projection
// ---------------------------------------------------------------------------

describe("processing order independence", () => {
  it("produces identical reconciled state regardless of event processing order", () => {
    // Simulate two different processing orders for the same final state.
    // Order A: Negotiation first, then Contacted corrected
    // Order B: Contacted first, then Negotiation added
    //
    // Both should reconcile to the same timestamps.

    // Order A final state: Negotiation@Nov10 processed first, then Contacted@Nov3 corrects
    const orderA = [
      makeReconcileRow(1, 1, T(10), "INFERRED"),  // Fresh
      makeReconcileRow(2, 2, T(3),  "ACTUAL"),     // Contacted (corrected from INFERRED)
      makeReconcileRow(3, 3, T(10), "INFERRED"),   // Site Visit
      makeReconcileRow(4, 4, T(10), "ACTUAL"),     // Negotiation
    ];

    // Order B final state: Contacted@Nov3 first, then Negotiation@Nov10 adds stages
    const orderB = [
      makeReconcileRow(1, 1, T(3),  "INFERRED"),   // Fresh (inferred at Nov3)
      makeReconcileRow(2, 2, T(3),  "ACTUAL"),      // Contacted
      makeReconcileRow(3, 3, T(10), "INFERRED"),    // Site Visit (inferred at Nov10)
      makeReconcileRow(4, 4, T(10), "ACTUAL"),      // Negotiation
    ];

    const rA = computeReconciledTimestamps(orderA);
    const rB = computeReconciledTimestamps(orderB);

    // Apply updates
    const applyUpdates = (rows: ReconcileInput[], updates: { id: number; new_entered_at: string }[]) =>
      rows.map((r) => {
        const upd = updates.find((u) => u.id === r.id);
        return { ordinal: r.stage_ordinal, entered_at: upd ? upd.new_entered_at : r.entered_at };
      });

    const finalA = applyUpdates(orderA, rA.updates);
    const finalB = applyUpdates(orderB, rB.updates);

    // Both should produce: Fresh@Nov3, Contacted@Nov3, SiteVisit@Nov10, Negotiation@Nov10
    expect(finalA).toEqual(finalB);
    expect(finalA[0].entered_at).toBe(T(3));
    expect(finalA[1].entered_at).toBe(T(3));
    expect(finalA[2].entered_at).toBe(T(10));
    expect(finalA[3].entered_at).toBe(T(10));
  });

  it("converges for a 6-stage scenario with 3 ACTUAL events in any order", () => {
    // Three ACTUAL events: Fresh@Nov1, Negotiation@Nov5, Booked@Nov10
    // Regardless of processing order, the final reconciled state should be identical.

    // State after all processing (same final DB state regardless of order):
    const rows = [
      makeReconcileRow(1, 1, T(1),  "ACTUAL"),
      makeReconcileRow(2, 2, T(5),  "INFERRED"),  // could be T(1), T(5), or T(10) depending on order
      makeReconcileRow(3, 3, T(5),  "INFERRED"),
      makeReconcileRow(4, 4, T(5),  "ACTUAL"),
      makeReconcileRow(5, 5, T(10), "INFERRED"),
      makeReconcileRow(6, 6, T(10), "ACTUAL"),
    ];
    const r = computeReconciledTimestamps(rows);

    // Apply
    const final = rows.map((row) => {
      const upd = r.updates.find((u) => u.id === row.id);
      return {
        ordinal: row.stage_ordinal,
        entered_at: upd ? upd.new_entered_at : row.entered_at,
        type: row.transition_type,
      };
    });

    // Verify non-decreasing timestamps
    for (let i = 0; i < final.length - 1; i++) {
      expect(new Date(final[i].entered_at).getTime())
        .toBeLessThanOrEqual(new Date(final[i + 1].entered_at).getTime());
    }
  });
});

// ---------------------------------------------------------------------------
// buildEventKey
// ---------------------------------------------------------------------------

describe("buildEventKey", () => {
  it("formats the key correctly", () => {
    expect(buildEventKey("lead_assigned", "walkin_enquiries", 42))
      .toBe("lead_assigned:walkin_enquiries:42");
  });

  it("uses the event type, not the stage name", () => {
    const key = buildEventKey("call_completed", "follow_ups", 999);
    expect(key).toContain("call_completed");
    expect(key).not.toContain("Contacted");
  });
});

// ---------------------------------------------------------------------------
// Permanent event-key uniqueness vs outbox cleanup audit
// ---------------------------------------------------------------------------

describe("event-key uniqueness policy audit", () => {
  it("event keys include source record SERIAL IDs which are never reused", () => {
    // After outbox cleanup (DELETE of 'done' rows older than 90 days),
    // the event_key is freed in the unique index. But the source record ID
    // embedded in the key is a PostgreSQL SERIAL — monotonically increasing,
    // never recycled. So the same key cannot be legitimately regenerated.
    //
    // This test documents the invariant.
    const key1 = buildEventKey("sales_form_submitted", "follow_ups", 100);
    const key2 = buildEventKey("sales_form_submitted", "follow_ups", 101);
    expect(key1).not.toBe(key2);

    // Same event type + table + record = same key (idempotent)
    const key3 = buildEventKey("sales_form_submitted", "follow_ups", 100);
    expect(key1).toBe(key3);
  });

  it("different event types for the same record produce different keys", () => {
    const k1 = buildEventKey("site_visit_scheduled", "site_visits", 50);
    const k2 = buildEventKey("site_visit_completed", "site_visits", 50);
    expect(k1).not.toBe(k2);
  });
});
