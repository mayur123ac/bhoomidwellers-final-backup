# Deal Stage Pipeline — Processing and Recovery

> Version: 3.0 | Date: 2026-11-02 | Status: IMPLEMENTED

## 1. Processing Architecture (ADL-13)

### Immediate Event-Driven Processing

Deal stage processing is **synchronous and event-driven**. There is no cron
dependency. Each business hook calls `insertAndProcessOutboxEvent()` which
processes the event immediately within the caller's transaction.

### Processing Flow

```
insertAndProcessOutboxEvent(client, params):

  1. INSERT outbox row (ON CONFLICT event_key DO NOTHING)
     RETURNING id, attempts
     — If duplicate: return early (no processing).

  2. SAVEPOINT ds_process

  3. processOneEvent(client, event)

  4. On success:
     UPDATE deal_stage_outbox SET status = 'done', processed_at = NOW()
     RELEASE SAVEPOINT ds_process

  5. On failure:
     ROLLBACK TO SAVEPOINT ds_process
     — Business operation and outbox INSERT survive.
     UPDATE deal_stage_outbox SET status = 'failed',
       attempts = attempts + 1,
       next_retry_at = exponential backoff or NULL (dead-letter at 10)

  6. Opportunistic retry: pick up ≤2 stale failed events for the same lead
     (FOR UPDATE SKIP LOCKED, next_retry_at <= NOW())
```

### Recovery Without Cron

Two recovery mechanisms:

1. **Opportunistic retry** — after processing the primary event, the hook
   automatically retries up to 2 stale failed events for the same lead.
   This provides self-healing during normal operation.

2. **Manual admin endpoint** — `POST /api/cron/deal-stage-process` (admin
   session only, tenant-scoped). Batch-processes pending and retryable events
   for the admin's organization. No cron secrets required.

### Processing Loop

```
function processOutboxBatch(limit: number):

  1. BEGIN transaction

  2. SELECT id, lead_id, event_type, event_ts, event_key, actor_id,
            payload, organization_id, attempts
       FROM deal_stage_outbox
      WHERE (status = 'pending')
         OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
      ORDER BY id ASC
      LIMIT $limit
      FOR UPDATE SKIP LOCKED

  3. For each event in batch:
     SAVEPOINT evt_N

     a. processOneEvent(client, event)

     b. On success:
        UPDATE deal_stage_outbox
        SET status = 'done', processed_at = NOW(), error_message = NULL
        WHERE id = $event_id
        RELEASE SAVEPOINT evt_N

     c. On error:
        ROLLBACK TO SAVEPOINT evt_N
        newAttempts = attempts + 1
        UPDATE deal_stage_outbox
        SET status = 'failed',
            attempts = $newAttempts,
            error_message = LEFT($error_msg, 500),
            next_retry_at = CASE
              WHEN $newAttempts >= 10 THEN NULL
              ELSE NOW() + make_interval(secs => LEAST(pow(2, $newAttempts) * 30, 3600))
            END
        WHERE id = $event_id

  4. COMMIT
```

**Key design points:**

- `FOR UPDATE SKIP LOCKED` ensures concurrent processor invocations do
  not contend on the same rows.
- Each event is processed within a SAVEPOINT so a single failure does not roll back
  the entire batch.
- The batch is processed inside ONE transaction to minimize connection hold time.
- `attempts` is incremented ONLY on failure, not on processing start (ADL-05).
  This means `attempts` counts failed attempts, and the dead-letter threshold
  of 10 means "failed 10 times."
- There is no `processing` intermediate status. The row remains in its previous
  status (`pending` or `failed`) until the transaction commits with `done` or
  the error handler updates to `failed`. If the transaction rolls back (crash),
  the row reverts to its previous status automatically.

### Processing One Event

```
function processOneEvent(client, event):

  1. Verify lead exists:
     SELECT id, organization_id
       FROM walkin_enquiries
      WHERE id = $event.lead_id AND organization_id = $event.organization_id
      FOR UPDATE

     If not found: throw error "lead not found" (handled by SAVEPOINT rollback).

  2. Load current stage history:
     SELECT stage, stage_ordinal, entered_at, transition_type
       FROM deal_stage_history
      WHERE lead_id = $event.lead_id
      ORDER BY stage_ordinal ASC

  3. Determine target stage:
     Map event_type to target stage ordinal:
       lead_assigned / lead_assigned_from_queue / lead_assigned_bulk → 1 (Fresh)
       sales_form_submitted / call_completed                        → 2 (Contacted)
       site_visit_scheduled / site_visit_scheduled_via_salesform    → 3 (Site Visit)
       site_visit_completed                                        → 4 (Negotiation)
       booking_initiated                                           → 5 (Sales)
       booking_confirmed                                           → 6 (Booked)

  4. Determine highest existing ordinal:
     highestExisting = MAX(stage_ordinal) from loaded history, or 0 if empty.

  5. If target ordinal <= highestExisting:
     The target stage already exists in history.
     — If the existing row is INFERRED, execute the INFERRED→ACTUAL correction
       (see step 7b below). This corrects the transition_type and may update
       entered_at to the actual business event timestamp.
     — If the existing row is ACTUAL, this is a no-op. Return success.
     (This handles: duplicate events, retries after crash, concurrent events
      where a higher stage was already processed.)

  6. Infer missing intermediate stages:
     For each ordinal O from (highestExisting + 1) to (target ordinal - 1):
       INSERT INTO deal_stage_history
         (lead_id, stage, stage_ordinal, entered_at, transition_type,
          source_event, source_record_id, source_table, triggered_by,
          organization_id)
       VALUES
         ($lead_id, STAGE_NAME[O], O, $event.event_ts, 'INFERRED',
          $event.event_type, $source_record_id, $source_table,
          $event.actor_id, $org_id)
       ON CONFLICT (lead_id, stage) DO UPDATE
         SET transition_type  = EXCLUDED.transition_type,
             entered_at       = LEAST(deal_stage_history.entered_at, EXCLUDED.entered_at),
             source_event     = EXCLUDED.source_event,
             source_record_id = EXCLUDED.source_record_id,
             source_table     = EXCLUDED.source_table,
             triggered_by     = EXCLUDED.triggered_by
         WHERE deal_stage_history.transition_type = 'INFERRED'

  7. Insert or correct actual stage:
     a. For a new stage (target ordinal > highestExisting):
        INSERT INTO deal_stage_history
          (lead_id, stage, stage_ordinal, entered_at, transition_type,
           source_event, source_record_id, source_table, triggered_by,
           organization_id)
        VALUES
          ($lead_id, STAGE_NAME[target], target, $event.event_ts, 'ACTUAL',
           $event.event_type, $source_record_id, $source_table,
           $event.actor_id, $org_id)
        ON CONFLICT (lead_id, stage) DO NOTHING

     b. For an existing INFERRED stage (target ordinal <= highestExisting):
        INSERT INTO deal_stage_history (...)
        VALUES (... 'ACTUAL' ...)
        ON CONFLICT (lead_id, stage) DO UPDATE
          SET transition_type  = 'ACTUAL',
              entered_at       = LEAST(deal_stage_history.entered_at, EXCLUDED.entered_at),
              source_event     = EXCLUDED.source_event,
              source_record_id = EXCLUDED.source_record_id,
              source_table     = EXCLUDED.source_table,
              triggered_by     = EXCLUDED.triggered_by
          WHERE deal_stage_history.transition_type = 'INFERRED'

  8. Reconcile INFERRED timestamps (ADL-10):
     reconcileInferredTimestamps(client, lead_id)

     This step runs after EVERY event processing (steps 4-7), not just after
     corrections. It ensures that INFERRED stage timestamps are non-decreasing
     by ordinal, clamped between neighboring ACTUAL timestamps.

     Algorithm (pure function: computeReconciledTimestamps):
       a. Reload all history rows for this lead.
       b. Pass 1 — ACTUAL bounds clamping: for each INFERRED row, find the
          nearest ACTUAL below (lower bound) and above (upper bound). If bounds
          are consistent (lower <= upper), clamp the INFERRED timestamp to
          [lower, upper]. If contradictory, leave unchanged.
       c. Pass 2 — Forward sweep: walk stages by ordinal ascending. Track a
          "floor" timestamp. When an ACTUAL stage is encountered, reset floor.
          When an INFERRED stage is below floor, raise it to floor (but only if
          this would not exceed its upper ACTUAL bound).
       d. Apply any timestamp changes via UPDATE deal_stage_history SET entered_at.
       e. Return { updates, hasContradiction }.

     The reconciliation is idempotent and adds one SELECT + 0..N UPDATEs to the
     per-event cost. In practice, most events produce 0 updates (normal order).
```

## 2. Per-Lead Locking

The lead row is locked with `SELECT ... FOR UPDATE` in step 1. This:

- Serializes all processing for the same lead across all concurrent workers.
- Prevents two events (e.g., sales form + call completion, both for Contacted)
  from racing to insert the same stage.
- Is released when the batch transaction commits.

The lock is on `walkin_enquiries`, not on `deal_stage_history`, because the lead
row is the natural serialization point.

## 3. Ordering Guarantees

Events are processed in `id ASC` order within each batch. Since `id` is BIGSERIAL,
this corresponds to insertion order (which approximates event chronological order).

**Late-arriving events (ADL-01):** If an older event (e.g., a call completion from
yesterday) is processed after a newer event (e.g., a site visit scheduled today):

- If the late event's target stage already exists as ACTUAL: no-op.
- If the late event's target stage exists as INFERRED: the row is corrected to
  ACTUAL with the real business timestamp (if earlier than the inferred timestamp).
- The late event cannot create a backward transition (new stages are never inserted
  below the highest existing ordinal).
- The outbox event is always marked 'done' regardless of whether it caused a
  change, a correction, or a no-op.

**Out-of-order insertion:** If outbox events are inserted out of chronological order
(e.g., due to concurrent requests with different transaction durations), the
processor's `highestExisting` check prevents corruption. The worst case is that
an INFERRED stage is recorded when the actual event arrives later — and that
INFERRED stage is then corrected to ACTUAL (ADL-01).

**Exact chronological reconstruction:** Cannot be guaranteed without delaying
processing. The INFERRED→ACTUAL correction mechanism provides eventual accuracy:
once all events for a lead are processed, the history reflects the correct
business timestamps for stages whose actual events were recorded, regardless
of processing order.

## 4. Failure Scenarios

### Scenario A: Processing fails during immediate processing

1. Business hook inserts outbox row, calls processOneEvent within SAVEPOINT.
2. processOneEvent throws (e.g., constraint violation).
3. ROLLBACK TO SAVEPOINT undoes stage history work.
4. Business operation and outbox INSERT survive (outside the savepoint).
5. Outbox row marked `failed` with retry metadata.
6. Opportunistic retry on a future request for the same lead may recover it.

### Scenario B: Transaction crashes before COMMIT

1. Business transaction (e.g., lead creation + outbox INSERT + processing) crashes.
2. PostgreSQL rolls back everything: lead, outbox row, and stage history.
3. The business event itself did not persist — no orphan outbox or history rows.
4. Client receives an error and must retry the business operation.

### Scenario C: Concurrent hooks for the same lead

1. Request A creates outbox event and enters processOneEvent.
2. Request B creates outbox event and enters processOneEvent.
3. processOneEvent's `FOR UPDATE` on `walkin_enquiries` serializes them.
4. Request B blocks until Request A commits.
5. Request B then processes against the up-to-date stage history.

### Scenario D: Opportunistic retry picks up stale event

1. A previous request failed to process event #100 (status='failed', next_retry_at past).
2. A new request for the same lead processes its primary event.
3. Opportunistic retry selects event #100 with `FOR UPDATE SKIP LOCKED`.
4. Event #100 is retried. If it succeeds: `done`. If it fails again: `attempts` incremented.

### Scenario F: Lead deleted while outbox events are pending

1. Admin deletes lead #1234. CASCADE removes deal_stage_history rows.
2. Outbox events for lead #1234 remain (no FK).
3. Processor picks up event, runs `SELECT ... FROM walkin_enquiries WHERE id = 1234`.
4. Lead not found → event marked 'failed' with error "lead not found".
5. After 10 failures, event is dead-lettered. No stage history is created
   (the lead no longer exists to have a stage).

### Scenario G: Booking CTE fails after main transaction commits

1. Main transaction commits: booking created as 'Pending', inventory marked 'booked'.
2. Post-commit CTE (`UPDATE ... SET booking_status = 'Confirmed'`) fails.
3. No Booked outbox event is created (the outbox INSERT is in the CTE).
4. Booking stays 'Pending'. No Booked stage is recorded.
5. This is a pre-existing consistency issue (inventory booked but booking not
   confirmed). The deal stage system is correct: it does not record a stage
   transition that did not actually complete.

## 5. Retry Strategy

| Attempt | Backoff | Cumulative Wait |
|---|---|---|
| 1 | 60s | 1m |
| 2 | 120s | 3m |
| 3 | 240s | 7m |
| 4 | 480s | 15m |
| 5 | 960s | 31m |
| 6 | 1920s | ~63m |
| 7 | 3600s (capped) | ~2.5h |
| 8 | 3600s | ~3.5h |
| 9 | 3600s | ~4.5h |
| 10 | Dead-letter | — |

After 10 failed attempts, `next_retry_at` is set to NULL. The event remains in
`failed` status permanently. An admin can inspect and manually retry or discard.

**Attempt counting:** `attempts` counts FAILED processing attempts. It is
incremented ONLY in the error path (step 3c). A successful first-attempt
processing leaves `attempts = 0`. A successful retry after 3 failures leaves
`attempts = 3` and `status = 'done'`.

## 6. Dead-Letter Handling

Events with `status = 'failed' AND next_retry_at IS NULL` are dead-lettered.

No automatic cleanup. An admin monitoring query:

```sql
SELECT id, lead_id, event_type, error_message, attempts, created_at
  FROM deal_stage_outbox
 WHERE status = 'failed' AND next_retry_at IS NULL
 ORDER BY created_at DESC
```

Manual retry:
```sql
UPDATE deal_stage_outbox
   SET status = 'pending', attempts = 0, next_retry_at = NULL, error_message = NULL
 WHERE id = $1
```

## 7. Outbox Retention (ADL-12)

All outbox rows are retained permanently. There is no automated cleanup of
`done` rows. This provides defense-in-depth idempotency: even if a source
record's SERIAL ID were somehow reused, the full unique index on `event_key`
prevents duplicate processing.

Storage cost is negligible (~1.7 MB/year at 100 events/hour).

Pending or failed events must NEVER be deleted — they represent committed
business events awaiting processing (see ADL-07).

## 8. Monitoring

Immediate processing has no separate monitoring endpoint. The outbox table
itself is the monitoring surface:

```sql
-- Pending events (should be 0 under normal operation)
SELECT COUNT(*) FROM deal_stage_outbox WHERE status = 'pending';

-- Failed events awaiting retry
SELECT COUNT(*) FROM deal_stage_outbox
 WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- Dead-lettered events (require manual intervention)
SELECT id, lead_id, event_type, error_message, attempts, created_at
  FROM deal_stage_outbox
 WHERE status = 'failed' AND next_retry_at IS NULL
 ORDER BY created_at DESC;
```

The manual recovery endpoint returns counts:
```json
{ "processed": 12, "failed": 1, "deadLettered": 0, "durationMs": 850 }
```

Slow-query logging in `lib/db.ts` (threshold 500ms) will surface any outbox
processing queries that are unusually slow.

## 9. Performance Budget

Immediate processing adds ~3-5 queries per business event at 82ms RTT:
~250-400ms of additional latency on the business request. This is acceptable
for CRM operations (lead creation, form submission) which are interactive
but not sub-second-critical.

Opportunistic retry adds 1 query (stale event SELECT) + up to 2 × 250-400ms
for retried events. This is bounded by MAX_OPPORTUNISTIC_RETRIES = 2.
| Estimated batch duration | 12-20s for 50 events | ESTIMATE |
| Neon connections used | 1 (single transaction) | Pool design |
| Cron frequency | 5 minutes (baseline) | vercel.json schedule |
| Estimated throughput | ~600 events/hour at 5-min intervals | ESTIMATE (50/batch × 12/hour) |
| Expected CRM event volume | <100 events/hour | ESTIMATE based on current usage |

**Performance labels:** All throughput and duration figures above are ESTIMATES
based on the measured 82ms Neon RTT and expected query count. They have not
been benchmarked against the actual processor implementation. Required benchmark:
run the processor against a test outbox with 50 events and measure actual
batch duration before production deployment.

Expected CRM event volume is well under 100 events/hour, so even at 5-minute
intervals the system has ~6x headroom.
