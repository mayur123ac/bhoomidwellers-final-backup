# Deal Stage Pipeline — Architecture Decision Log

> Version: 3.0 | Date: 2026-11-02 | Status: PARTIALLY IMPLEMENTED

---

## ADL-01: Late-Event Handling — INFERRED→ACTUAL Correction

**Problem:** Outbox events are processed in insertion order (id ASC), but business
events may have different chronological timestamps. When a higher-stage event is
processed before a lower-stage event, the lower stage is recorded as INFERRED. If
the actual lower-stage event arrives later, the current design discards it (no-op).
This loses the actual business timestamp and the ACTUAL transition classification.

**Alternatives Considered:**

A. **No-op for late events** (V1 design) — simple but loses data.
B. **Delayed per-lead processing window** — hold events for N seconds before
   processing. Reduces late arrivals but adds latency and complexity.
C. **Event-time ordering** — sort by event_ts instead of id. Requires buffering
   and breaks the natural idempotency of insertion-order processing.
D. **Conditional UPDATE of INFERRED→ACTUAL** — allow a single mutation type on
   history rows when the real event arrives for a previously inferred stage.
E. **Separate event ledger and stage projection** — keep raw events and
   recompute the projection. Most flexible but doubles storage and complexity.

**Chosen:** D — Conditional UPDATE of INFERRED→ACTUAL.

**Reason:** Minimal deviation from append-only. The mutation is bounded: only
`transition_type`, `entered_at`, `source_event`, `source_record_id`,
`source_table`, and `triggered_by` can change, and only when the existing row
is INFERRED. The stage name, ordinal, lead_id, and organization_id never change.
This preserves correct chronology for duration calculations without introducing
buffering, recomputation, or a separate event store.

**Trade-offs:**
- History is no longer perfectly append-only. One specific UPDATE is permitted.
- The `uq_dsh_lead_stage` unique constraint must use `ON CONFLICT ... DO UPDATE`
  with a WHERE guard, not `DO NOTHING`.
- Duration calculations become more accurate when late events arrive.
- If the actual event has a timestamp LATER than the inferred timestamp, the
  update is skipped (the inferred time is already the best approximation).

**Impacted documents:** System Architecture, Database Design, Event Catalog,
Processing and Recovery, Testing Strategy.

**Verification:** DECIDED.

---

## ADL-02: Booking Initiation Must Prove Server-Side Field Save

**Problem:** The V1 design proposed `POST /api/booking-initiations` with only
`{ "lead_id": 1234 }`. This fires the Sales stage on form open, not on actual
data entry. No booking-form field is persisted individually before the final
booking POST — verified by reading `BookingFormModal.tsx` (sessionStorage only)
and all booking APIs (no draft/partial-save endpoint exists).

**Alternatives Considered:**

A. **Initiation on form open** (V1) — records intent, not action. Rejected by
   business rule.
B. **Full booking draft persistence** — excessive; introduces a draft table,
   autosave polling, conflict resolution. User explicitly rejected this.
C. **Minimal field-save endpoint** — new endpoint accepts lead_id plus at least
   one field name-value pair. Persists the evidence of a real data entry. The
   initiation record and outbox event are atomic with the field save.
D. **Piggyback on booking POST** — Sales fires only when the booking is fully
   submitted. This collapses Sales and Booked into near-simultaneous events.

**Chosen:** C — Minimal field-save endpoint.

**Reason:** Proves a real server-side data save without full draft persistence.
Lightweight: one JSONB column stores `{ field_name: field_value }` as evidence.
The form's existing submit-all-at-once flow is unchanged. Only the first call
per lead creates a record (idempotent). Subsequent calls are no-ops.

**Exact trigger:** The frontend calls `POST /api/booking-initiations` when the
user saves any booking-form field for the first time. The request includes
`lead_id` and `saved_field` (a `{ name: string, value: string }` object). The
endpoint validates that the field value is non-empty.

**Trade-offs:**
- Requires a single new frontend call (on first meaningful field interaction).
- If the field save succeeds but the user never completes the booking, the Sales
  stage remains (by business rule: "If the employee abandons the booking
  afterward, the Sales stage remains").
- The `booking_initiations` table stores minimal evidence, not a full draft.

**Impacted documents:** Database Design, Event Catalog, API Contracts, System
Architecture, Testing Strategy, Implementation Roadmap.

**Verification:** VERIFIED — BookingFormModal.tsx uses sessionStorage only; no
server-side field save exists. The booking-applications POST receives FormData
with all fields at once.

---

## ADL-03: Booked Event Timestamp and Confirmation Atomicity

**Problem:** The booking flow creates the booking as 'Pending' inside a
transaction, then flips it to 'Confirmed' in a post-commit CTE. The V1 design
used `booking_applications.created_at` as the Booked timestamp, which represents
creation time, not confirmation time. No `confirmed_at` column exists.

**Repository evidence (VERIFIED):**
- `booking-applications/route.ts:508-828` — main transaction creates booking as
  'Pending', calls `syncBookingUnit()` (inventory marked 'booked' inside txn).
- `booking-applications/route.ts:835-843` — post-commit CTE updates
  `booking_status = 'Confirmed'` and `walkin_enquiries.status = 'Closed'`.
- R2 document uploads happen AFTER the CTE (line 849).
- `syncBookingUnit()` runs INSIDE the transaction with `FOR UPDATE` locking.
- No `confirmed_at` column exists anywhere in the codebase.

**Alternatives Considered:**

A. **Use created_at** (V1) — incorrect; confirmation may be seconds after creation.
B. **Move confirmation into main transaction** — atomic but changes failure
   semantics: currently a CTE failure leaves booking 'Pending' with inventory
   'booked' (a pre-existing bug, but one the team may rely on for recovery).
   R2 uploads already happen after the CTE and are unaffected.
C. **Extend post-commit CTE** — add `confirmed_at = NOW()` and the outbox INSERT
   to the existing CTE. Confirmation, lead closure, and outbox event are atomic
   with each other but separate from the main transaction.
D. **Two-phase with confirmed_at** — add the column, set it in the CTE, and
   write the outbox event in the same CTE.

**Chosen:** C — Extend the post-commit CTE.

**Reason:** Minimal change to existing flow. The CTE already atomically confirms
the booking and closes the lead. Adding `confirmed_at = NOW()` and the outbox
INSERT to the same CTE makes all three operations atomic with each other.

**Invariant:** The outbox event for `booking_confirmed` exists if and only if
`booking_status = 'Confirmed'`. If the CTE fails, neither the confirmation
nor the outbox event persists.

**Pre-existing issue (documented, not fixed):** If the CTE fails after the
main transaction commits, inventory is 'booked' but booking stays 'Pending'.
This is outside deal stage scope. The deal stage system is correct: no Booked
event is created because confirmation did not occur.

**Event timestamp:** `NOW()` from the CTE execution, which IS the confirmation
moment. A new `confirmed_at` column is added to `booking_applications` to
persist this timestamp.

**Trade-offs:**
- The outbox INSERT is outside the main transaction (post-commit). If the
  process crashes between main COMMIT and CTE execution, neither confirmation
  nor outbox event occurs — consistent but the booking stays Pending.
- Adding `confirmed_at` requires a schema change to booking_applications.
  This is a single ALTER TABLE ADD COLUMN, nullable, no data migration.
- R2 uploads remain unaffected (they already happen after the CTE).

**Impacted documents:** System Architecture, Database Design, Event Catalog,
Processing and Recovery, Testing Strategy, Implementation Roadmap.

**Verification:** VERIFIED — source code confirms the post-commit CTE structure
and the absence of confirmed_at.

---

## ADL-04: Outbox Event Identity — Full Unique Index

**Problem:** The V1 partial unique index
`UNIQUE (event_key) WHERE status != 'done'` does not provide permanent
idempotency. Once an event is marked 'done', a new event with the same key
can be inserted.

**Analysis:** The practical risk is low because event_keys include the source
record ID (e.g., `call_completed:follow_ups:4821`), and a legitimate API retry
that created a new source record would get a different key. However, the partial
index creates a subtle gap during outbox cleanup: if 'done' events are deleted
and the API retries, reinsertion is possible.

**Alternatives Considered:**

A. **Keep partial index** (V1) — gap exists but is unlikely to manifest.
B. **Full unique index on event_key** — permanent idempotency, no gaps.
C. **Composite unique on (organization_id, event_key)** — allows same event_key
   across tenants. Unnecessary because event_keys already embed source record
   IDs which are globally unique (SERIAL).

**Chosen:** B — Full unique index: `UNIQUE (event_key)`.

**Reason:** Simpler, stronger, no edge cases. The cost is that 'done' events
cannot have their keys reused, which is correct behavior (a business event
should produce exactly one outbox entry, ever). Outbox cleanup can still
DELETE old 'done' rows — the key space is freed, but the practical risk of
the same source record being re-created is zero (SERIAL IDs don't recycle).

**Trade-offs:**
- Outbox cleanup (DELETE of old done rows) technically frees the key for
  reinsertion. Acceptable: the source record that created the key still exists,
  and the business flow will not recreate it.
- Slightly larger index (no partial filter), negligible at expected volume.

**History uniqueness interaction:**
- `uq_dsh_lead_stage` UNIQUE (lead_id, stage) prevents duplicate history rows.
- Multiple ACTUAL Contacted events (sales form + call) → first wins, second
  is a no-op at the history level.
- An ACTUAL event arriving after an INFERRED stage → triggers the
  INFERRED→ACTUAL correction (ADL-01), not a new row.
- Revisit leads have different lead_ids, so their stages are fully independent.

**Impacted documents:** Database Design, Processing and Recovery, Security,
Testing Strategy.

**Verification:** DECIDED.

---

## ADL-05: Processing Model — Single Transaction, No Lease

**Problem:** The V1 documents describe `processing` as a "lease" but use
`FOR UPDATE SKIP LOCKED` inside a single transaction. A status written inside an
uncommitted transaction is invisible to other workers and is not a durable lease.

**Alternatives Considered:**

A. **Single transaction with row locks** — `FOR UPDATE SKIP LOCKED` prevents
   contention. On crash, the entire transaction rolls back. No intermediate
   state is visible.
B. **Durable lease** — claim rows in a short transaction, process outside,
   finalize in another transaction. Requires lease expiry, recovery, and
   additional schema.

**Chosen:** A — Single transaction with row locks.

**Reason:** Matches the existing `transaction()` helper exactly. At expected
volume (<100 events/hour, batch of 50), the transaction holds one connection
for 12-20 seconds — well within Vercel function timeout and pool capacity
(max 10 connections). A durable lease adds complexity (lease schema, expiry
timer, recovery algorithm) without benefit at this scale.

**Consequences:**
- The `processing` intermediate status is REMOVED. It was never visible to
  other workers (written inside an uncommitted transaction) and served no
  diagnostic purpose. Events go directly from `pending`/`failed` to
  `done`/`failed`.
- Retry attempt accounting: `attempts` is incremented exactly ONCE per
  processing attempt, in the failure path only. Success does not increment.
  This means `attempts` counts failures, not total tries.
- Concurrent cron invocations: `SKIP LOCKED` ensures non-overlapping batches.
  Two processors for the same lead serialize via `FOR UPDATE` on
  `walkin_enquiries`.

**Impacted documents:** System Architecture, Database Design, Processing and
Recovery, API Contracts, Testing Strategy, Implementation Roadmap.

**Verification:** VERIFIED — `lib/db.ts:transaction()` is BEGIN/fn/COMMIT with
ROLLBACK on error. Pool max is 10. Existing cron pattern uses the same helper.

---

## ADL-06: History Retention on Lead Deletion

**Problem:** The V1 design declares history "permanent and append-only" but uses
`ON DELETE CASCADE` on the FK to walkin_enquiries. A lead deletion cascades to
history deletion.

**Repository evidence (VERIFIED):**
- `walkin_enquiries/[id]/route.ts` has a DELETE handler that performs hard
  deletion with R2 asset cleanup.
- Leads are also soft-deleted via status changes (Lost, Closed) but hard
  deletion IS an available admin operation.

**Alternatives Considered:**

A. **CASCADE with honest documentation** — history lives as long as the lead.
   Deletion is a deliberate admin action that removes all traces.
B. **Remove CASCADE, orphan history** — history survives lead deletion but
   FK integrity is lost. Reads must handle missing leads.
C. **Soft-delete only** — prevent hard deletion of leads with history. This
   changes an existing business operation.
D. **Archive before cascade** — copy history to an archive table before deletion.
   Adds complexity.

**Chosen:** A — CASCADE with honest documentation.

**Reason:** Lead deletion is a deliberate admin action (with R2 cleanup and
audit logging). When an admin deletes a lead, they intend to remove ALL
associated data. Retaining deal stage history for a deleted lead would:
- Violate the privacy intent of deletion (potential GDPR issue).
- Create orphaned rows with no meaningful lead context.
- Require special handling in all read APIs.

The outbox table deliberately has NO FK (as in V1) so orphaned events are
gracefully handled by the processor (marked failed with "lead not found").

**Terminology correction:** History is "durable" (persists through normal
operations), not "permanent" (implies survives deletion). Updated across all
documents.

**Impacted documents:** Database Design, Security and Tenant Isolation,
Processing and Recovery, Testing Strategy, Implementation Roadmap.

**Verification:** VERIFIED — DELETE handler exists at walkin_enquiries/[id].

---

## ADL-07: Rollback Must Preserve Business Events

**Problem:** The V1 roadmap included
`DELETE FROM deal_stage_outbox WHERE status = 'pending'` as a rollback step.
Pending outbox rows represent committed CRM business events and must not be
deleted.

**Chosen approach:**

1. **Code rollback:** Revert the deployment. Outbox events accumulate safely.
   When fixed code is redeployed, processing resumes from where it stopped.
2. **Disable processor:** Remove the cron entry from vercel.json. Events
   remain in the outbox. No data loss.
3. **Schema rollback:** Only with explicit admin approval. Dropping tables
   destroys ALL deal stage data (history + pending events). This is a
   destructive operation documented as such.
4. **Version compatibility:** Events created by a rolled-back code version
   carry the same schema (event_type, event_key, payload). The processor
   handles unknown event types by marking them failed, not by crashing.

**Impacted documents:** Implementation Roadmap, Processing and Recovery,
System Architecture.

**Verification:** DECIDED.

---

## ADL-08: Vercel Cron Schedule and Plan

**Problem:** The V1 design specifies `* * * * *` (every minute) cron. Vercel
Hobby plan supports only daily cron jobs. Vercel Pro supports down to every
minute.

**Repository evidence:**
- `vercel.json` has two crons: `*/5 12-18 * * *` and `28 18 * * *`.
- These schedules require Vercel Pro (every-5-minute schedule).

**Status:** UNVERIFIED — the actual Vercel plan cannot be confirmed from the
repository alone. The existing crons suggest Pro is in use (they would fail
on Hobby), but this requires manual verification.

**Chosen approach:**
- Design for `*/5 * * * *` (every 5 minutes) as baseline, matching the
  existing attendance cron pattern.
- Document `* * * * *` (every minute) as the preferred schedule if Pro is
  confirmed.
- At 50 events per batch and 5-minute intervals, throughput is ~600 events/hour,
  still 6x above expected volume.
- Note: a third-party cron service (cron-job.org, Upstash) is an alternative
  if the Vercel plan does not support the desired frequency.

**Impacted documents:** System Architecture, Implementation Roadmap.

**Verification:** UNVERIFIED — requires manual confirmation of Vercel plan.

---

## ADL-09: Site Visit Endpoint Transaction Safety

**Problem:** Both POST and PATCH handlers in `api/site-visits/route.ts` use
bare `query()` calls without transaction boundaries. Outbox events must be
inserted atomically with the business operation.

**Repository evidence (VERIFIED):**
- POST handler (lines 58-136): 4 sequential `query()` calls (lead check,
  duplicate check, INSERT site_visit, INSERT follow_up) plus a push
  notification.
- PATCH handler (lines 159-231): dynamic UPDATE + conditional follow_up INSERT
  + conditional walkin_enquiries UPDATE + conditional completed_at UPDATE.
- Neither uses `transaction()`.
- The push notification (`pushSiteVisit`) is a fire-and-forget external call
  with `.catch(() => {})`.

**Chosen approach:**
- Wrap both handlers in `transaction()`, replacing `query()` with
  `client.query()` for all database operations.
- The push notification call (`pushSiteVisit`) must remain OUTSIDE the
  transaction (after commit). It is an external side effect (FCM push) and
  must not hold the database connection. Its `.catch(() => {})` already
  handles failures silently.
- The follow_up INSERT for the "Site Visit marked as Completed" message is
  inside the transaction (database operation, must be atomic with the
  site_visit update).

**Trade-offs:**
- The push notification may fire even if the transaction rolls back (if placed
  after commit). This is acceptable: a spurious push is less harmful than
  holding a DB connection during an external network call.
- Actually, if placed after `transaction()` returns, it only fires on commit.
  This is the correct placement.

**Impacted documents:** Event Catalog, Implementation Roadmap, Testing Strategy.

**Verification:** VERIFIED — source code confirms bare `query()` usage and
fire-and-forget push notification pattern. IMPLEMENTED in Phase 0.

---

## ADL-10: INFERRED Timestamp Reconciliation

**Problem:** When a higher-stage event is processed first, intermediate stages
are inferred using the higher event's timestamp. A later actual event can correct
its own stage via LEAST(), but other INFERRED stages retain stale timestamps.
This produces non-chronological timelines and negative stage durations.

Example: `site_visit_completed` at Nov 10 infers Fresh(Nov10), Contacted(Nov10),
SiteVisit(Nov10). Later, `sales_form_submitted` at Nov 5 corrects Contacted to
ACTUAL(Nov5). Fresh remains at Nov10 — non-chronological.

**Alternatives Considered:**

| Option | Trade-off |
|---|---|
| A. Ignore — clamp durations to 0 | Silent data quality issue. Durations are wrong. Users cannot trust the timeline. |
| B. Re-infer all INFERRED stages on every correction | Correct, but loses LEAST() semantics — timestamps would jump around. Also requires tracking which events created which inferred stages. |
| C. Deterministic reconciliation against ACTUAL bounds | Correct, idempotent, convergent. Two-pass algorithm (clamp + sweep). Small per-event cost. |

**Chosen approach: Option C — deterministic reconciliation.**

After every event processing (not just corrections), the processor runs
`reconcileInferredTimestamps()`:

1. **Pass 1 — ACTUAL bounds clamping:** Each INFERRED stage is clamped to the
   interval [nearest ACTUAL below, nearest ACTUAL above]. If bounds are
   contradictory (lower > upper), the INFERRED stage is left unchanged.

2. **Pass 2 — Forward sweep:** Walks stages by ordinal ascending, tracking a
   "floor" timestamp. ACTUAL stages reset the floor. INFERRED stages below the
   floor are raised to it, unless this would exceed their upper ACTUAL bound.

**Properties:**
- ACTUAL timestamps are never modified (requirement 5).
- Contradictory ACTUAL timestamps are preserved and flagged as
  `hasContradiction: true` (requirement 6).
- The reconciliation is idempotent: running it twice produces no additional
  changes.
- Processing order does not affect the final projection: the same set of ACTUAL
  events always produces the same reconciled timeline (requirement 10).
- Duration calculations clamp negatives to 0 and flag them with
  `duration_clamped: true`. The API response includes `timelineConsistent: false`
  when any duration was clamped (requirement 7).

**Second permitted mutation on deal_stage_history:**

This introduces `UPDATE deal_stage_history SET entered_at = $1 WHERE id = $2` as
a second permitted mutation alongside ADL-01's INFERRED→ACTUAL correction. It is
restricted to:
- INFERRED rows only (ACTUAL rows are never touched).
- Only the `entered_at` column (transition_type, source_event, etc. are unchanged).
- Only by the processor (not by any other endpoint).

**Implementation:** `computeReconciledTimestamps()` is a pure function tested
with 34 unit tests covering all 10 required test categories. The DB wrapper
`reconcileInferredTimestamps()` is called at the end of `processOneEvent()`.

**Impacted documents:** Database Design, Processing and Recovery, Security and
Tenant Isolation, Testing Strategy, this ADL.

**Verification:** IMPLEMENTED — `lib/dealStage.ts`, 34 tests passing.

---

## ADL-11: First-ACTUAL-Wins Policy — ACCEPTED

**Problem:** When two ACTUAL events target the same stage (e.g., a sales form
submission and a call completion both map to Contacted), the `entered_at`
timestamp and `source_event` depend on which event is processed first. The second
ACTUAL is silently discarded by the `ON CONFLICT DO NOTHING` (for new stages) or
the `WHERE transition_type = 'INFERRED'` guard (for existing stages).

**Analysis (Audit A):**

- **Stage projection is order-independent.** Both processing orders produce the
  same set of stages with the same ordinals. The lead's current stage is
  identical regardless of order.
- **`entered_at` is order-dependent.** The first-processed ACTUAL's timestamp
  wins. The second ACTUAL's timestamp is lost.
- **Reconciliation cannot fix this.** Both rows are ACTUAL; reconciliation only
  modifies INFERRED rows.

**Decision:** ACCEPTED. The first-ACTUAL-wins behavior is a known, documented
trade-off. The timestamp difference is bounded by the time between the two
business events (typically minutes). The stage projection — which determines the
lead's pipeline position — is always correct.

**Alternatives rejected:**

- **MIN(entered_at) policy:** Would require `ON CONFLICT DO UPDATE SET
  entered_at = LEAST(...)` for ACTUAL→ACTUAL conflicts. Adds complexity and
  changes the semantics (the "winner" would be the earlier business event, not
  the first-processed event). Not worth the complexity for a scenario that
  affects only timestamp precision, not stage accuracy.

**Status:** ACCEPTED — no code change needed.

---

## ADL-12: Permanent Outbox Retention — ACCEPTED

**Problem:** The original design included a 90-day cleanup of `done` outbox rows.
Deleting `done` rows frees the `event_key` in the unique index. If a SERIAL ID
were ever reused (e.g., after `TRUNCATE ... RESTART IDENTITY`), the same
`event_key` could be legitimately regenerated, breaking idempotency.

**Analysis (Audit C):**

- PostgreSQL SERIAL IDs are monotonically increasing by default. They do NOT
  cycle. The only way to reuse a SERIAL ID is manual admin action (`TRUNCATE
  ... RESTART IDENTITY` or `ALTER SEQUENCE ... RESTART`).
- The outbox `event_key` format is `{event_type}:{source_table}:{source_record_id}`.
  If the source record's SERIAL ID is never reused, the key is never reused,
  regardless of whether old outbox rows are deleted.
- However, retaining all `done` rows provides defense-in-depth: even in the
  unlikely event of an ID reuse, the unique index prevents duplicate processing.
- Storage cost is negligible: each outbox row is ~200 bytes. At 100 events/hour,
  that's ~1.7 MB/year.

**Decision:** ACCEPTED. No outbox cleanup. All `done` rows are retained
indefinitely. The cleanup SQL and documentation referencing 90-day retention
are removed.

**Status:** ACCEPTED — cleanup section removed from Processing and Recovery doc.

---

## ADL-13: Immediate Processing — Cron Removed

**Problem:** The original Phase 4 design used a cron-triggered batch processor.
This introduced a Vercel Pro dependency (Hobby limits cron to 1/day), added
latency between business event and stage update, and created an external
scheduling dependency for a workflow that should be self-contained.

**Decision:** Event-driven immediate processing. Each business hook calls
`insertAndProcessOutboxEvent()` which:

1. Inserts the outbox row (idempotent via event_key UNIQUE).
2. Wraps `processOneEvent()` in a SAVEPOINT within the caller's transaction.
3. On success: marks the outbox row `done`. Stage history is updated immediately.
4. On failure: ROLLBACK TO SAVEPOINT. The business operation and outbox INSERT
   survive. The outbox row is marked `failed` with retry metadata.

**Recovery without cron:**
- **Opportunistic retry**: after processing the primary event, the hook picks up
  up to 2 stale failed events for the same lead (using `FOR UPDATE SKIP LOCKED`).
- **Manual admin endpoint**: `POST /api/cron/deal-stage-process` (admin session
  only, tenant-scoped) batch-processes pending/retryable events.

**What was removed:**
- `CRON_SECRET` authentication tier.
- `DEALSTAGE_PROCESS_TOKEN` authentication tier.
- Vercel cron schedule dependency.
- External cron service dependency.

**What was preserved:**
- Transactional outbox (ADL-12: permanent retention).
- Event-key idempotency (UNIQUE index).
- ADL-11 conflict policy (first-ACTUAL-wins for ACTUAL→ACTUAL).
- Exponential backoff and dead-lettering (≥10 attempts).
- SAVEPOINT isolation (processing failure ≠ business failure).
- `processOneEvent()` core logic unchanged.

**Status:** IMPLEMENTED — `lib/dealStageOutbox.ts`, recovery endpoint retained.
