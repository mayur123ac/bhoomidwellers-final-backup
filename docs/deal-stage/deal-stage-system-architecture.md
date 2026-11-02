# Deal Stage Pipeline — System Architecture

> Version: 2.0 | Date: 2026-11-01 | Status: DESIGN (not implemented)

## 1. Overview

The Deal Stage Pipeline tracks every lead through six sequential business stages:

```
Fresh → Contacted → Site Visit → Negotiation → Sales → Booked
```

Each stage is triggered by a specific CRM business event. The system is event-driven,
uses a transactional outbox pattern, and is processed by a bounded cron worker.

## 2. Design Principles

1. **Transactional outbox** — every stage event is captured atomically with its
   originating business operation. No post-commit event writes, except for the
   booking confirmation CTE (see ADL-03).
2. **Durable history** — `deal_stage_history` rows persist through normal operations.
   History is deleted only when the lead itself is hard-deleted (CASCADE). History
   is NOT permanent in the absolute sense — see ADL-06.
3. **Nearly append-only** — history rows are never deleted by application code.
   One specific UPDATE is permitted: correcting an INFERRED stage to ACTUAL when
   the real event arrives later (see ADL-01). No other mutation is allowed.
4. **Idempotent processing** — duplicate outbox events produce no duplicate history.
   The `uq_dsh_lead_stage` unique constraint with `ON CONFLICT ... DO UPDATE` handles
   both idempotency and INFERRED→ACTUAL correction in one operation.
5. **Per-lead serialization** — the processor locks the lead row (`FOR UPDATE`) before
   computing stage transitions, preventing concurrent corruption.
6. **Revisit isolation** — each `walkin_enquiries` row is an independent lead with its
   own stage lifecycle. The `returning_from_lead_id` chain is irrelevant to stage
   calculation.
7. **No regression** — stages only advance forward. Cancellations and reassignments
   do not revert stages.
8. **Inference with correction** — when a later stage event arrives without intermediate
   events, the skipped stages are recorded as INFERRED. If the actual intermediate
   event arrives later, the INFERRED row is corrected to ACTUAL with the real
   business timestamp.

## 3. Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CRM Business Endpoints                      │
│                                                                 │
│  walkin_enquiries POST ─┐                                       │
│  walkInQueue process   ─┤                                       │
│  walkin_enquiries PUT  ─┤  (reassignment — no outbox event)     │
│  bulkInsertLeads       ─┤                                       │
│  sales-form-submit     ─┤                                       │
│  call-sessions complete─┤──→ INSERT deal_stage_outbox            │
│  site-visits POST      ─┤      (inside existing transaction     │
│  site-visits PATCH     ─┤       or new transaction wrapper)     │
│  booking-initiations   ─┤                                       │
│  booking-applications  ─┘  (CTE — see ADL-03)                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    deal_stage_outbox (table)                     │
│                                                                 │
│  Pending events accumulate here. Each row represents one        │
│  business event that may advance a lead's deal stage.           │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              Outbox Processor (Vercel Cron endpoint)             │
│              GET /api/cron/deal-stage-process                    │
│                                                                 │
│  Single transaction per batch — no durable lease (ADL-05).      │
│                                                                 │
│  1. SELECT batch FROM deal_stage_outbox                          │
│     WHERE status IN ('pending','failed-retryable')              │
│     ORDER BY id LIMIT 50                                        │
│     FOR UPDATE SKIP LOCKED                                      │
│                                                                 │
│  2. For each event:                                             │
│     a. SELECT ... FROM walkin_enquiries WHERE id = $1            │
│        FOR UPDATE                           (per-lead lock)     │
│     b. SELECT current history for lead                          │
│     c. Compute stage transition + inferences                    │
│     d. INSERT/UPDATE deal_stage_history (idempotent)            │
│        — INSERT with ON CONFLICT DO UPDATE for INFERRED→ACTUAL  │
│     e. UPDATE outbox SET status = 'done'                        │
│                                                                 │
│  3. On error: UPDATE outbox SET status = 'failed', attempts++   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  deal_stage_history (table)                      │
│                                                                 │
│  Durable record of every stage entry.                           │
│  One row per stage per lead. INFERRED rows may be corrected     │
│  to ACTUAL when the real event arrives (ADL-01).                │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Read APIs                                  │
│                                                                 │
│  GET /api/leads/[id]/deal-stage     — single lead               │
│  GET /api/leads/deal-stages?ids=... — batch for list view       │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Stage Ordering

Stages have a fixed ordinal:

| Ordinal | Stage       | Trigger Event                              |
|---------|-------------|---------------------------------------------|
| 1       | Fresh       | Lead assigned to Sales Manager               |
| 2       | Contacted   | Sales form submitted OR call result recorded  |
| 3       | Site Visit  | Site visit scheduled                         |
| 4       | Negotiation | Site visit marked completed                  |
| 5       | Sales       | First booking field saved to server           |
| 6       | Booked      | Booking confirmed + inventory reserved        |

The ordinal is used to:
- Determine the highest achieved stage.
- Identify which intermediate stages must be inferred.
- Prevent backward transitions.

**Critical invariants:**
- Lead creation without assignment does NOT trigger Fresh. Only actual assignment
  to a Sales Manager does.
- Queue assignment uses the queue's `assigned_at` time, NOT the lead's `created_at`.
- Reassignment and transfer do NOT reset Fresh.
- Booking "initiated" means a booking-form field was saved to the server, not
  that the form was opened in the browser (see ADL-02).
- Booking "confirmed" means `booking_status = 'Confirmed'`, using the
  confirmation timestamp, not `created_at` (see ADL-03).

## 5. Inference Logic

When a stage-N event arrives and the lead's highest recorded stage is M where M < N-1,
the processor inserts INFERRED entries for every skipped stage between M+1 and N-1.

Example: Lead has only Fresh (ordinal 1). Site visit completed event arrives
(Negotiation, ordinal 4).

Result:
```
Fresh       — ordinal 1 — ACTUAL   (already existed)
Contacted   — ordinal 2 — INFERRED (entered_at = event timestamp)
Site Visit  — ordinal 3 — INFERRED (entered_at = event timestamp)
Negotiation — ordinal 4 — ACTUAL   (entered_at = event timestamp)
```

Inferred stages carry the triggering event's timestamp because the actual
intermediate event either happened but was unrecorded, or was skipped entirely.

### Late-Event Correction (ADL-01)

If the actual Contacted event (e.g., sales form submitted at T-2days) arrives
AFTER Negotiation was processed:

1. The processor sees Contacted already exists (INFERRED, entered_at = T).
2. The actual event's timestamp (T-2days) is EARLIER than the inferred timestamp.
3. The processor executes `ON CONFLICT (lead_id, stage) DO UPDATE`:
   - `transition_type` → `ACTUAL`
   - `entered_at` → T-2days (the real business timestamp)
   - `source_event`, `source_record_id`, `source_table`, `triggered_by` updated.
4. The outbox event is marked 'done'.

If the actual event's timestamp is LATER than or equal to the inferred timestamp,
only `transition_type` and source metadata are updated. The earlier `entered_at`
is preserved (it provides a tighter bound on when the stage was reached).

## 6. Duration Calculation

Stage duration is computed at read time, not stored:

```
duration(stage_N) = entered_at(stage_N+1) - entered_at(stage_N)
```

For the current (highest) stage:
```
duration(current_stage) = NOW() - entered_at(current_stage)
```

This eliminates the need for `exited_at` columns and preserves the near-
append-only invariant.

**Non-monotonic timestamps:** When INFERRED stages share the same timestamp as
the triggering event, their duration is zero until corrected. After correction
(ADL-01), durations become accurate. The read API computes durations from the
stored `entered_at` values without special-casing — zero-duration stages are
displayed honestly.

**Tie-breaking:** If two stages have identical `entered_at` timestamps, ordinal
order is used for display. Duration between them is zero.

## 7. Processing Model (ADL-05)

The processor uses a **single-transaction model** with row locks. There is no
durable lease, no intermediate `processing` status, and no two-phase processing.

```
transaction {
  1. SELECT batch ... FOR UPDATE SKIP LOCKED
  2. For each event:
     SAVEPOINT evt_N
     a. Lock lead (FOR UPDATE on walkin_enquiries)
     b. Load history, compute transition, insert/update history
     c. Mark outbox 'done'
     RELEASE SAVEPOINT (on success) / ROLLBACK TO SAVEPOINT (on error)
  3. COMMIT
}
```

On worker crash: PostgreSQL rolls back the uncommitted transaction. All events
return to their previous status. No orphaned locks, no inconsistent state.

## 8. Deployment Model

- **Existing leads:** No historical backfill. Leads created before deployment have no
  `deal_stage_history` rows. Their first qualifying post-deployment event starts
  tracking. The read API returns `{ tracked: false }` for leads with no history.
- **New leads:** The Fresh event is recorded atomically with the assignment operation.
- **Cron schedule:** Every 5 minutes (`*/5 * * * *`) as baseline, matching existing
  attendance cron pattern. Every minute is preferred if Vercel Pro is confirmed.
  See ADL-08 — Vercel plan is UNVERIFIED.

## 9. File Layout (Planned)

```
lib/dealStage.ts                           — central engine
lib/dealStageOutbox.ts                     — outbox writer helper
app/api/cron/deal-stage-process/route.ts   — cron processor
app/api/leads/[id]/deal-stage/route.ts     — single-lead read API
app/api/leads/deal-stages/route.ts         — batch read API
app/api/booking-initiations/route.ts       — booking initiation API
scripts/migrations/YYYY-MM-DD_deal_stage_tables.sql
```

## 10. Dependencies

| Dependency | Status | Required Before | ADL |
|---|---|---|---|
| `POST /api/site-visits` wrapped in `transaction()` | Not yet done | Event hook insertion | ADL-09 |
| `PATCH /api/site-visits` wrapped in `transaction()` | Not yet done | Event hook insertion | ADL-09 |
| Booking CTE extended with outbox INSERT + confirmed_at | Not yet done | Booked event | ADL-03 |
| `booking_initiations` table created | Not yet done | Sales event | ADL-02 |
| Vercel plan confirmed (Pro vs Hobby) | UNVERIFIED | Cron schedule | ADL-08 |
| `confirmed_at` column added to booking_applications | Not yet done | Booked event timestamp | ADL-03 |
