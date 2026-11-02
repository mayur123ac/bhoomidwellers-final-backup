// lib/dealStage.ts — Deal Stage Pipeline: Core Engine
// Pure functions for stage computation + processOneEvent (database).

import { PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

export const STAGE_NAMES: Record<number, string> = {
  1: "Fresh",
  2: "Contacted",
  3: "Site Visit",
  4: "Negotiation",
  5: "Sales",
  6: "Booked",
};

export const STAGE_ORDINALS: Record<string, number> = {
  Fresh: 1,
  Contacted: 2,
  "Site Visit": 3,
  Negotiation: 4,
  Sales: 5,
  Booked: 6,
};

const EVENT_TO_STAGE: Record<string, { stage: string; ordinal: number }> = {
  lead_assigned:                     { stage: "Fresh",       ordinal: 1 },
  lead_assigned_from_queue:          { stage: "Fresh",       ordinal: 1 },
  lead_assigned_bulk:                { stage: "Fresh",       ordinal: 1 },
  sales_form_submitted:              { stage: "Contacted",   ordinal: 2 },
  call_completed:                    { stage: "Contacted",   ordinal: 2 },
  site_visit_scheduled:              { stage: "Site Visit",  ordinal: 3 },
  site_visit_scheduled_via_salesform:{ stage: "Site Visit",  ordinal: 3 },
  site_visit_completed:              { stage: "Negotiation", ordinal: 4 },
  booking_initiated:                 { stage: "Sales",       ordinal: 5 },
  booking_confirmed:                 { stage: "Booked",      ordinal: 6 },
};

// ---------------------------------------------------------------------------
// mapEventToStage
// ---------------------------------------------------------------------------

export function mapEventToStage(eventType: string): { stage: string; ordinal: number } {
  const mapping = EVENT_TO_STAGE[eventType];
  if (!mapping) throw new Error(`Unknown event_type: ${eventType}`);
  return mapping;
}

// ---------------------------------------------------------------------------
// computeInferredStages
// ---------------------------------------------------------------------------

export function computeInferredStages(
  highestExisting: number,
  targetOrdinal: number,
): { stage: string; ordinal: number }[] | null {
  if (targetOrdinal <= highestExisting) return null;
  const inferred: { stage: string; ordinal: number }[] = [];
  for (let o = highestExisting + 1; o < targetOrdinal; o++) {
    inferred.push({ stage: STAGE_NAMES[o], ordinal: o });
  }
  return inferred.length > 0 ? inferred : null;
}

// ---------------------------------------------------------------------------
// History row type (as returned by SELECT from deal_stage_history)
// ---------------------------------------------------------------------------

export interface StageHistoryRow {
  id: number;
  lead_id: number;
  stage: string;
  stage_ordinal: number;
  entered_at: string;
  transition_type: "ACTUAL" | "INFERRED";
  source_event: string;
  source_record_id: number | null;
  source_table: string | null;
  triggered_by: number | null;
  organization_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Timeline reconciliation (pure)
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  id: number;
  stage_ordinal: number;
  entered_at: string;
  transition_type: "ACTUAL" | "INFERRED";
}

export interface TimestampUpdate {
  id: number;
  new_entered_at: string;
}

export interface ReconcileResult {
  updates: TimestampUpdate[];
  hasContradiction: boolean;
}

/**
 * Compute reconciled timestamps for INFERRED stages so the timeline is
 * non-decreasing by ordinal wherever ACTUAL evidence permits.
 *
 * Policy:
 * - ACTUAL timestamps are never modified.
 * - Each INFERRED stage is clamped to the interval defined by the nearest
 *   ACTUAL stages below and above it.
 * - If ACTUAL bounds are contradictory (lower > upper), the INFERRED stage
 *   is left unchanged and the contradiction is flagged.
 * - A forward sweep then enforces non-decreasing order among consecutive
 *   INFERRED stages that share the same consistent ACTUAL bounds.
 */
export function computeReconciledTimestamps(rows: ReconcileInput[]): ReconcileResult {
  if (rows.length === 0) return { updates: [], hasContradiction: false };

  const sorted = [...rows].sort((a, b) => a.stage_ordinal - b.stage_ordinal);

  // Detect contradictory ACTUALs (earlier ordinal with strictly later timestamp)
  const actuals = sorted.filter((r) => r.transition_type === "ACTUAL");
  let hasContradiction = false;
  for (let i = 0; i < actuals.length - 1; i++) {
    if (ts(actuals[i].entered_at) > ts(actuals[i + 1].entered_at)) {
      hasContradiction = true;
      break;
    }
  }

  // Working copy with mutable ts values
  const work = sorted.map((r) => ({
    id: r.id,
    stage_ordinal: r.stage_ordinal,
    transition_type: r.transition_type,
    ts: ts(r.entered_at),
    original_ts: ts(r.entered_at),
  }));

  const actualWork = work.filter((w) => w.transition_type === "ACTUAL");

  // Pass 1: Clamp each INFERRED to its nearest ACTUAL bounds
  for (const row of work) {
    if (row.transition_type !== "INFERRED") continue;

    // Nearest ACTUAL below (highest ordinal < this)
    const lowerActual = findLastWhere(actualWork, (a) => a.stage_ordinal < row.stage_ordinal);
    // Nearest ACTUAL above (lowest ordinal > this)
    const upperActual = actualWork.find((a) => a.stage_ordinal > row.stage_ordinal);

    if (lowerActual && upperActual) {
      if (lowerActual.ts <= upperActual.ts) {
        // Consistent bounds — clamp
        row.ts = Math.max(lowerActual.ts, Math.min(upperActual.ts, row.ts));
      }
      // Contradictory bounds — don't modify
    } else if (lowerActual) {
      row.ts = Math.max(lowerActual.ts, row.ts);
    } else if (upperActual) {
      row.ts = Math.min(upperActual.ts, row.ts);
    }
  }

  // Pass 2: Forward sweep — enforce non-decreasing among INFERRED stages,
  // respecting ACTUAL timestamps as floor resets.
  let floorTs: number | null = null;
  for (const row of work) {
    if (row.transition_type === "ACTUAL") {
      floorTs = row.ts;
    } else {
      // INFERRED: pull up to floor if below it, but only if the adjustment
      // does not exceed this stage's upper ACTUAL bound.
      if (floorTs !== null && row.ts < floorTs) {
        const upperActual = actualWork.find((a) => a.stage_ordinal > row.stage_ordinal);
        if (!upperActual || floorTs <= upperActual.ts) {
          row.ts = floorTs;
        }
        // else: contradictory bounds, leave as is
      }
      floorTs = row.ts;
    }
  }

  // Collect updates where the timestamp actually changed
  const updates: TimestampUpdate[] = [];
  for (const row of work) {
    if (row.ts !== row.original_ts) {
      updates.push({
        id: row.id,
        new_entered_at: new Date(row.ts).toISOString(),
      });
    }
  }

  return { updates, hasContradiction };
}

function ts(isoString: string): number {
  return new Date(isoString).getTime();
}

function findLastWhere<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// reconcileInferredTimestamps (database wrapper)
// ---------------------------------------------------------------------------

/**
 * After processing an event, reload history and reconcile INFERRED timestamps.
 * This is the second permitted mutation on deal_stage_history (alongside
 * INFERRED→ACTUAL correction). Only INFERRED rows' entered_at values are
 * modified, and only to satisfy non-decreasing chronology against ACTUAL bounds.
 */
export async function reconcileInferredTimestamps(
  client: PoolClient,
  leadId: number,
): Promise<ReconcileResult> {
  const result = await client.query(
    `SELECT id, stage_ordinal, entered_at, transition_type
       FROM deal_stage_history
      WHERE lead_id = $1
      ORDER BY stage_ordinal ASC`,
    [leadId],
  );

  const reconciled = computeReconciledTimestamps(result.rows);

  for (const upd of reconciled.updates) {
    await client.query(
      `UPDATE deal_stage_history SET entered_at = $1 WHERE id = $2`,
      [upd.new_entered_at, upd.id],
    );
  }

  return reconciled;
}

// ---------------------------------------------------------------------------
// computeStageDurations
// ---------------------------------------------------------------------------

export interface StageDuration {
  stage: string;
  ordinal: number;
  entered_at: string;
  transition_type: "ACTUAL" | "INFERRED";
  duration_ms: number | null; // null for the last (current) stage
  duration_clamped: boolean;  // true if raw duration was negative (clamped to 0)
}

export function computeStageDurations(rows: StageHistoryRow[]): StageDuration[] {
  if (rows.length === 0) return [];

  const sorted = [...rows].sort((a, b) => a.stage_ordinal - b.stage_ordinal);

  return sorted.map((row, i) => {
    const next = sorted[i + 1];
    let duration_ms: number | null = null;
    let duration_clamped = false;
    if (next) {
      const diff = new Date(next.entered_at).getTime() - new Date(row.entered_at).getTime();
      if (diff < 0) {
        duration_ms = 0;
        duration_clamped = true;
      } else {
        duration_ms = diff;
      }
    }
    return {
      stage: row.stage,
      ordinal: row.stage_ordinal,
      entered_at: row.entered_at,
      transition_type: row.transition_type,
      duration_ms,
      duration_clamped,
    };
  });
}

// ---------------------------------------------------------------------------
// buildApiResponse
// ---------------------------------------------------------------------------

export interface DealStageApiResponse {
  leadId: number;
  currentStage: string;
  currentOrdinal: number;
  stages: StageDuration[];
  upcomingStages: { stage: string; ordinal: number }[];
  totalStages: number;
  timelineConsistent: boolean;
}

export function buildApiResponse(rows: StageHistoryRow[], leadId: number): DealStageApiResponse {
  const durations = computeStageDurations(rows);
  const highestOrdinal = rows.length > 0
    ? Math.max(...rows.map((r) => r.stage_ordinal))
    : 0;
  const currentStage = highestOrdinal > 0 ? STAGE_NAMES[highestOrdinal] : "Untracked";

  const upcoming: { stage: string; ordinal: number }[] = [];
  for (let o = highestOrdinal + 1; o <= 6; o++) {
    upcoming.push({ stage: STAGE_NAMES[o], ordinal: o });
  }

  const timelineConsistent = durations.every((d) => !d.duration_clamped);

  return {
    leadId,
    currentStage,
    currentOrdinal: highestOrdinal,
    stages: durations,
    upcomingStages: upcoming,
    totalStages: 6,
    timelineConsistent,
  };
}

// ---------------------------------------------------------------------------
// processOneEvent — core stage transition logic
// ---------------------------------------------------------------------------

export interface OutboxEvent {
  id: number;
  lead_id: number;
  event_type: string;
  event_ts: string;
  event_key: string;
  actor_id: number | null;
  payload: {
    source_table?: string;
    source_record_id?: number;
    [key: string]: unknown;
  };
  organization_id: string;
  attempts: number;
}

export async function processOneEvent(client: PoolClient, event: OutboxEvent): Promise<void> {
  // 1. Verify lead exists (and lock it for serialization)
  const leadCheck = await client.query(
    `SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [event.lead_id, event.organization_id],
  );
  if (leadCheck.rows.length === 0) {
    throw new Error(`lead not found: ${event.lead_id}`);
  }

  // 2. Map event to target stage
  const { stage: targetStage, ordinal: targetOrdinal } = mapEventToStage(event.event_type);

  // 3. Load current stage history
  const historyResult = await client.query(
    `SELECT stage, stage_ordinal, transition_type
       FROM deal_stage_history
      WHERE lead_id = $1
      ORDER BY stage_ordinal ASC`,
    [event.lead_id],
  );
  const existing: { stage: string; stage_ordinal: number; transition_type: string }[] = historyResult.rows;
  const highestExisting = existing.length > 0
    ? Math.max(...existing.map((r) => r.stage_ordinal))
    : 0;

  const sourceTable = event.payload.source_table ?? null;
  const sourceRecordId = event.payload.source_record_id ?? null;

  // 4. Target stage already exists — correct INFERRED→ACTUAL or no-op
  if (targetOrdinal <= highestExisting) {
    const existingRow = existing.find((r) => r.stage === targetStage);
    if (existingRow && existingRow.transition_type === "INFERRED") {
      await client.query(
        `INSERT INTO deal_stage_history
           (lead_id, stage, stage_ordinal, entered_at, transition_type,
            source_event, source_record_id, source_table, triggered_by, organization_id)
         VALUES ($1, $2, $3, $4, 'ACTUAL', $5, $6, $7, $8, $9)
         ON CONFLICT (lead_id, stage) DO UPDATE
           SET transition_type  = EXCLUDED.transition_type,
               entered_at       = LEAST(deal_stage_history.entered_at, EXCLUDED.entered_at),
               source_event     = EXCLUDED.source_event,
               source_record_id = EXCLUDED.source_record_id,
               source_table     = EXCLUDED.source_table,
               triggered_by     = EXCLUDED.triggered_by
           WHERE deal_stage_history.transition_type = 'INFERRED'`,
        [
          event.lead_id, targetStage, targetOrdinal, event.event_ts,
          event.event_type, sourceRecordId, sourceTable,
          event.actor_id, event.organization_id,
        ],
      );
    }
    // If already ACTUAL, this is a no-op — event marked done by caller.
    // Reconcile INFERRED timestamps after any correction.
    await reconcileInferredTimestamps(client, event.lead_id);
    return;
  }

  // 5. Infer missing intermediate stages
  for (let o = highestExisting + 1; o < targetOrdinal; o++) {
    await client.query(
      `INSERT INTO deal_stage_history
         (lead_id, stage, stage_ordinal, entered_at, transition_type,
          source_event, source_record_id, source_table, triggered_by, organization_id)
       VALUES ($1, $2, $3, $4, 'INFERRED', $5, $6, $7, $8, $9)
       ON CONFLICT (lead_id, stage) DO UPDATE
         SET transition_type  = EXCLUDED.transition_type,
             entered_at       = LEAST(deal_stage_history.entered_at, EXCLUDED.entered_at),
             source_event     = EXCLUDED.source_event,
             source_record_id = EXCLUDED.source_record_id,
             source_table     = EXCLUDED.source_table,
             triggered_by     = EXCLUDED.triggered_by
         WHERE deal_stage_history.transition_type = 'INFERRED'`,
      [
        event.lead_id, STAGE_NAMES[o], o, event.event_ts,
        event.event_type, sourceRecordId, sourceTable,
        event.actor_id, event.organization_id,
      ],
    );
  }

  // 6. Insert the actual target stage
  await client.query(
    `INSERT INTO deal_stage_history
       (lead_id, stage, stage_ordinal, entered_at, transition_type,
        source_event, source_record_id, source_table, triggered_by, organization_id)
     VALUES ($1, $2, $3, $4, 'ACTUAL', $5, $6, $7, $8, $9)
     ON CONFLICT (lead_id, stage) DO NOTHING`,
    [
      event.lead_id, targetStage, targetOrdinal, event.event_ts,
      event.event_type, sourceRecordId, sourceTable,
      event.actor_id, event.organization_id,
    ],
  );

  // 7. Reconcile INFERRED timestamps against ACTUAL bounds
  await reconcileInferredTimestamps(client, event.lead_id);
}
