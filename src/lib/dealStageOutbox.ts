// lib/dealStageOutbox.ts — Outbox writer + immediate processor for deal stage events.
//
// Each hook calls insertAndProcessOutboxEvent() which:
// 1. INSERTs the outbox row (idempotent via event_key UNIQUE).
// 2. Wraps processOneEvent() in a SAVEPOINT so a processing failure does
//    NOT roll back the caller's business operation.
// 3. On success → marks the outbox row 'done'.
// 4. On failure → ROLLBACK TO SAVEPOINT, outbox row survives as 'pending'
//    (or 'failed' with retry metadata if this was a retry).
//
// The outbox table remains the source of truth: every business event is
// durable regardless of whether immediate processing succeeds.

import { PoolClient } from "pg";
import { processOneEvent, type OutboxEvent } from "@/lib/dealStage";

// ---------------------------------------------------------------------------
// buildEventKey
// ---------------------------------------------------------------------------

export function buildEventKey(
  eventType: string,
  sourceTable: string,
  sourceRecordId: number,
): string {
  return `${eventType}:${sourceTable}:${sourceRecordId}`;
}

// ---------------------------------------------------------------------------
// OutboxEventParams
// ---------------------------------------------------------------------------

export interface OutboxEventParams {
  lead_id: number;
  event_type: string;
  event_ts: string | Date;
  event_key: string;
  actor_id: number | null;
  payload: Record<string, unknown>;
  organization_id: string;
}

// ---------------------------------------------------------------------------
// insertAndProcessOutboxEvent — the primary hook entry point
// ---------------------------------------------------------------------------

/**
 * Insert an outbox event and immediately attempt to process it.
 *
 * Must be called on the same PoolClient as the business operation's
 * transaction. Processing is isolated behind a SAVEPOINT so that failure
 * does not affect the business operation or the outbox INSERT.
 *
 * After the primary event is processed, opportunistically retries up to
 * MAX_OPPORTUNISTIC_RETRIES stale failed events for the same lead.
 */
export async function insertAndProcessOutboxEvent(
  client: PoolClient,
  params: OutboxEventParams,
): Promise<void> {
  const eventTs =
    params.event_ts instanceof Date
      ? params.event_ts.toISOString()
      : params.event_ts;

  // 1. Insert the outbox row. ON CONFLICT DO NOTHING for idempotency.
  //    RETURNING id tells us whether the row was actually inserted (vs. dedup).
  const insertRes = await client.query<{ id: number; attempts: number }>(
    `INSERT INTO deal_stage_outbox
       (lead_id, event_type, event_ts, event_key, actor_id, payload, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id, attempts`,
    [
      params.lead_id,
      params.event_type,
      eventTs,
      params.event_key,
      params.actor_id,
      JSON.stringify(params.payload),
      params.organization_id,
    ],
  );

  // If the row already existed (duplicate event_key), check if it's stuck
  // (pending or failed) and force-retry it. This handles reactivation where
  // a prior booking_confirmed event failed and the same event_key is reused.
  if (insertRes.rows.length === 0) {
    await forceRetryStuckEvent(client, params.event_key, params.organization_id);
    return;
  }

  const outboxId = insertRes.rows[0].id;

  // 2. Build the OutboxEvent shape for processOneEvent.
  const event: OutboxEvent = {
    id: outboxId,
    lead_id: params.lead_id,
    event_type: params.event_type,
    event_ts: eventTs,
    event_key: params.event_key,
    actor_id: params.actor_id,
    payload: params.payload,
    organization_id: params.organization_id,
    attempts: 0,
  };

  // 3. Attempt immediate processing inside a SAVEPOINT.
  await attemptProcessEvent(client, event);

  // 4. Opportunistic retry: pick up stale failed events for the same lead.
  await opportunisticRetry(client, params.lead_id, params.organization_id);
}

// ---------------------------------------------------------------------------
// attemptProcessEvent — SAVEPOINT-isolated processing
// ---------------------------------------------------------------------------

async function attemptProcessEvent(
  client: PoolClient,
  event: OutboxEvent,
): Promise<boolean> {
  await client.query("SAVEPOINT ds_process");

  try {
    await processOneEvent(client, event);

    // Success: mark done
    await client.query(
      `UPDATE deal_stage_outbox
          SET status = 'done', processed_at = NOW(), error_message = NULL
        WHERE id = $1`,
      [event.id],
    );
    await client.query("RELEASE SAVEPOINT ds_process");
    return true;
  } catch (err: any) {
    await client.query("ROLLBACK TO SAVEPOINT ds_process");

    // Record failure metadata on the outbox row.
    // The row itself survives because the ROLLBACK only undoes
    // processOneEvent's work, not the original INSERT.
    const newAttempts = (event.attempts ?? 0) + 1;
    const errorMsg = String(err?.message || "Unknown error").slice(0, 500);
    const isDeadLetter = newAttempts >= 10;

    await client.query(
      `UPDATE deal_stage_outbox
          SET status = 'failed',
              attempts = $1::int,
              error_message = $2,
              next_retry_at = CASE
                WHEN $3::boolean THEN NULL
                ELSE NOW() + make_interval(secs => LEAST(pow(2, $1::int) * 30, 3600))
              END
        WHERE id = $4`,
      [newAttempts, errorMsg, isDeadLetter, event.id],
    );

    return false;
  }
}

// ---------------------------------------------------------------------------
// forceRetryStuckEvent — recover a stuck event on duplicate key
// ---------------------------------------------------------------------------

/**
 * When an INSERT hits ON CONFLICT DO NOTHING (duplicate event_key), the row
 * may be stuck as 'pending' or 'failed' from a prior attempt. This function
 * finds it and retries processing if it hasn't already succeeded.
 *
 * Primary use case: booking reactivation reuses the same event_key as the
 * original confirmation. If the original failed, this ensures it gets retried.
 *
 * Dead-lettered events (attempts ≥ 10, next_retry_at = NULL) are intentionally
 * eligible: this function is only called on an explicit business action
 * (booking confirmation or reactivation), so allowing one more attempt on a
 * previously-exhausted event is correct — the underlying issue may be resolved.
 */
async function forceRetryStuckEvent(
  client: PoolClient,
  eventKey: string,
  organizationId: string,
): Promise<void> {
  const res = await client.query<OutboxEvent>(
    `SELECT id, lead_id, event_type, event_ts, event_key,
            actor_id, payload, organization_id, attempts
       FROM deal_stage_outbox
      WHERE event_key = $1
        AND organization_id = $2
        AND status IN ('pending', 'failed')
      FOR UPDATE SKIP LOCKED`,
    [eventKey, organizationId],
  );

  if (res.rows.length === 0) return; // already 'done' — no-op

  const row = res.rows[0];
  if (typeof row.payload === "string") {
    row.payload = JSON.parse(row.payload);
  }
  await attemptProcessEvent(client, row);
}

// ---------------------------------------------------------------------------
// opportunisticRetry — piggyback on business requests
// ---------------------------------------------------------------------------

const MAX_OPPORTUNISTIC_RETRIES = 2;

/**
 * After processing the primary event, pick up stale failed events for the
 * same lead. This provides recovery without a cron dependency.
 *
 * Uses FOR UPDATE SKIP LOCKED to avoid contention with concurrent requests.
 * Strict limit prevents unbounded latency.
 */
async function opportunisticRetry(
  client: PoolClient,
  leadId: number,
  organizationId: string,
): Promise<void> {
  const stale = await client.query<OutboxEvent>(
    `SELECT id, lead_id, event_type, event_ts, event_key,
            actor_id, payload, organization_id, attempts
       FROM deal_stage_outbox
      WHERE lead_id = $1
        AND organization_id = $2
        AND status = 'failed'
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= NOW()
      ORDER BY id ASC
      LIMIT $3
      FOR UPDATE SKIP LOCKED`,
    [leadId, organizationId, MAX_OPPORTUNISTIC_RETRIES],
  );

  for (const row of stale.rows) {
    if (typeof row.payload === "string") {
      row.payload = JSON.parse(row.payload);
    }
    await attemptProcessEvent(client, row);
  }
}

// ---------------------------------------------------------------------------
// Legacy alias — kept for backward compatibility with existing imports.
// All call sites should migrate to insertAndProcessOutboxEvent.
// ---------------------------------------------------------------------------

/** @deprecated Use insertAndProcessOutboxEvent instead. */
export const insertOutboxEvent = insertAndProcessOutboxEvent;
