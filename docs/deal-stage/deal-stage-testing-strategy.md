# Deal Stage Pipeline — Testing Strategy

> Version: 2.1 | Date: 2026-11-01 | Status: PARTIALLY IMPLEMENTED

## 1. Test Categories

| Category | Scope | Runner | Count Estimate |
|---|---|---|---|
| Unit — Stage Engine | `lib/dealStage.ts` pure functions | Vitest | ~34 **(IMPLEMENTED)** |
| Unit — Outbox Writer | `lib/dealStageOutbox.ts` | Vitest | ~10 |
| Integration — Event Hooks | Each source endpoint's outbox INSERT | Vitest + real DB | ~18 |
| Integration — Processor | Cron endpoint batch processing | Vitest + real DB | ~28 |
| Integration — Read APIs | GET endpoints for single + batch | Vitest + real DB | ~14 |
| Integration — Booking Initiation | POST /api/booking-initiations | Vitest + real DB | ~12 |
| Concurrency | Race conditions, duplicate events | Vitest + real DB + concurrent clients | ~8 |
| Authorization | RBAC for every endpoint | Vitest (mocked session) | ~18 |
| Late Events & Corrections | INFERRED→ACTUAL, out-of-order processing | Vitest + real DB | ~10 |
| Failure & Recovery | Crashes, rollbacks, dead-lettering | Vitest + real DB | ~12 |
| **Total** | | | **~164** |

## 2. Unit Tests — Stage Engine (IMPLEMENTED)

File: `lib/dealStage.test.ts` — 34 tests, all passing.

Runner: Vitest (project uses `vitest.config.ts`, not Jest).

### Stage Mapping

```
Test: mapEventToStage returns correct ordinal for each event type
  - lead_assigned → 1 (Fresh)
  - lead_assigned_from_queue → 1 (Fresh)
  - lead_assigned_bulk → 1 (Fresh)
  - sales_form_submitted → 2 (Contacted)
  - call_completed → 2 (Contacted)
  - site_visit_scheduled → 3 (Site Visit)
  - site_visit_scheduled_via_salesform → 3 (Site Visit)
  - site_visit_completed → 4 (Negotiation)
  - booking_initiated → 5 (Sales)
  - booking_confirmed → 6 (Booked)
  - unknown_event → throws Error
```

### Inference Logic

```
Test: computeInferredStages with no existing history
  Input:  highestExisting=0, targetOrdinal=4
  Output: [
    { stage: 'Fresh', ordinal: 1, type: 'INFERRED' },
    { stage: 'Contacted', ordinal: 2, type: 'INFERRED' },
    { stage: 'Site Visit', ordinal: 3, type: 'INFERRED' }
  ]

Test: computeInferredStages with partial history
  Input:  highestExisting=2, targetOrdinal=5
  Output: [
    { stage: 'Site Visit', ordinal: 3, type: 'INFERRED' },
    { stage: 'Negotiation', ordinal: 4, type: 'INFERRED' }
  ]

Test: computeInferredStages when target is next stage (no gap)
  Input:  highestExisting=3, targetOrdinal=4
  Output: [] (empty — no inference needed)

Test: computeInferredStages when target already reached
  Input:  highestExisting=5, targetOrdinal=3
  Output: null (signal: correction path, not new stage insertion)
```

### Duration Calculation

```
Test: computeStageDurations from history array
  Input:  [
    { stage: 'Fresh', entered_at: T },
    { stage: 'Contacted', entered_at: T+2days },
    { stage: 'Site Visit', entered_at: T+8days }
  ]
  Output: [
    { stage: 'Fresh', durationSeconds: 172800 },
    { stage: 'Contacted', durationSeconds: 518400 },
    { stage: 'Site Visit', durationSeconds: null }  // current stage
  ]

Test: computeStageDurations with single stage
  Input:  [{ stage: 'Fresh', entered_at: T }]
  Output: [{ stage: 'Fresh', durationSeconds: null }]

Test: computeStageDurations with empty array
  Input:  []
  Output: []

Test: computeStageDurations with equal timestamps (inferred stages)
  Input:  [
    { stage: 'Fresh', entered_at: T },
    { stage: 'Contacted', entered_at: T },
    { stage: 'Site Visit', entered_at: T }
  ]
  Output: [
    { stage: 'Fresh', durationSeconds: 0, duration_clamped: false },
    { stage: 'Contacted', durationSeconds: 0, duration_clamped: false },
    { stage: 'Site Visit', durationSeconds: null }
  ]

Test: computeStageDurations clamps negative durations and flags them
  Input: contradictory ACTUALs (Fresh@Nov10, Contacted@Nov5)
  Output: Fresh.duration_ms=0, Fresh.duration_clamped=true

Test: buildApiResponse sets timelineConsistent=false when durations are clamped
Test: buildApiResponse sets timelineConsistent=true for normal progressions
```

### Timeline Reconciliation (ADL-10) — IMPLEMENTED

```
Test: computeReconciledTimestamps — empty input
Test: computeReconciledTimestamps — all ACTUAL and chronological (no updates)
Test: Higher-stage event processed first, INFERRED clamped to upper ACTUAL
Test: Multiple INFERRED stages clamped between ACTUAL bounds
Test: INFERRED timestamps within bounds are preserved (no unnecessary changes)
Test: Contradictory ACTUALs detected and flagged
Test: INFERRED stages between contradictory ACTUALs are not modified
Test: Forward sweep enforces non-decreasing among consecutive INFERRED stages
Test: All-INFERRED stages (no ACTUAL bounds) — forward sweep enforces ordering
Test: Cascading corrections produce correct final timeline
Test: Two ACTUAL events for same stage — reconciliation is no-op
Test: Repeated reconciliation is idempotent (second pass = no changes)
Test: Processing order does not alter final projection (4-stage scenario)
Test: Processing order convergence (6-stage scenario with 3 ACTUALs)
```

## 3. Unit Tests — Outbox Writer

File: `lib/__tests__/dealStageOutbox.test.ts`

```
Test: insertOutboxEvent builds correct SQL with all parameters
Test: insertOutboxEvent uses ON CONFLICT DO NOTHING for idempotency
Test: insertOutboxEvent generates correct event_key format
Test: insertOutboxEvent passes organization_id from context, not from input
Test: buildEventKey for each event type matches expected pattern
  - lead_assigned → "lead_assigned:walkin_enquiries:{id}"
  - sales_form_submitted → "sales_form_submitted:follow_ups:{id}"
  - call_completed → "call_completed:follow_ups:{id}"
  - site_visit_scheduled → "site_visit_scheduled:site_visits:{id}"
  - site_visit_completed → "site_visit_completed:site_visits:{id}"
  - booking_initiated → "booking_initiated:booking_initiations:{id}"
  - booking_confirmed → "booking_confirmed:booking_applications:{id}"
Test: insertOutboxEvent rejects unknown event types
```

## 4. Integration Tests — Event Hooks

Each source endpoint gets tests verifying the outbox INSERT is atomic with the
business operation.

### Lead Assignment (Fresh)

File: `app/api/walkin_enquiries/__tests__/dealStageHook.test.ts`

```
Test: POST with direct assignment creates outbox event
  - Create lead with assigned_to_user_id
  - Verify deal_stage_outbox row exists with event_type='lead_assigned'
  - Verify event_key matches "lead_assigned:walkin_enquiries:{id}"
  - Verify organization_id matches session org
  - Verify event_ts matches the lead's created_at

Test: POST with queued assignment (no SM) does NOT create outbox event
  - Create lead that goes to queue (no assigned_to_user_id)
  - Verify NO deal_stage_outbox row for this lead

Test: Queue processing creates outbox event
  - Trigger processQueueForManager
  - Verify deal_stage_outbox row with event_type='lead_assigned_from_queue'
  - Verify event_ts is the queue assignment time, NOT lead created_at

Test: Bulk import creates outbox events for assigned leads
  - Import 3 leads, 2 with assignment, 1 skipped (duplicate)
  - Verify exactly 2 outbox rows with event_type='lead_assigned_bulk'

Test: Outbox event is rolled back if lead INSERT fails
  - Force a constraint violation in the lead INSERT
  - Verify NO outbox row exists (atomic rollback)

Test: Reassignment does NOT create new outbox event
  - Create lead (gets Fresh event)
  - Reassign to different SM via PUT
  - Verify no new outbox event after reassignment
```

### Sales Form (Contacted)

File: `app/api/sales-form-submit/__tests__/dealStageHook.test.ts`

```
Test: Sales form creates outbox event with event_type='sales_form_submitted'
  - Verify event_ts matches follow_ups.created_at

Test: Sales form with siteVisitDate creates TWO outbox events
  - One 'sales_form_submitted' and one 'site_visit_scheduled_via_salesform'
  - Verify both have distinct event_keys

Test: Second sales form for same lead creates new outbox event (different follow_up_id)
  - Processor handles the duplicate stage via uq_dsh_lead_stage

Test: Outbox event uses follow_ups.created_at as event_ts, not NOW()
```

### Call Completion (Contacted)

File: `app/api/call-sessions/__tests__/dealStageHook.test.ts`

```
Test: Call completion with lead_id creates outbox event
Test: Call completion without lead_id does NOT create outbox event
Test: Double-completion returns 409 and no duplicate outbox event
```

### Site Visits (Site Visit + Negotiation)

File: `app/api/site-visits/__tests__/dealStageHook.test.ts`

```
Test: POST site-visit creates outbox event with event_type='site_visit_scheduled'
Test: PATCH to completed creates outbox event with event_type='site_visit_completed'
  - Verify event_ts is the completed_at timestamp
Test: PATCH to cancelled does NOT create outbox event
Test: Duplicate datetime rejection prevents duplicate outbox events
Test: Push notification fires AFTER transaction commit, not inside
```

### Booking (Sales + Booked)

File: `app/api/booking-initiations/__tests__/route.test.ts`

```
Test: First initiation with valid field creates row + outbox event (201)
  - Verify saved_field is persisted in JSONB
  - Verify event_ts matches created_at

Test: Second initiation returns existing row, no new outbox event (200)

Test: Initiation with empty field value returns 400
Test: Initiation with whitespace-only field value returns 400
Test: Initiation for lead with confirmed booking returns 409
Test: Initiation by unassigned SM returns 403
Test: Initiation for non-existent lead returns 404
Test: Initiation for lead in different org returns 404
```

File: `app/api/booking-applications/__tests__/dealStageHook.test.ts`

```
Test: Booking confirmation CTE creates outbox event with event_type='booking_confirmed'
  - Verify event_ts is confirmed_at (not created_at)
  - Verify confirmed_at column is set on booking_applications

Test: Outbox event is atomic with booking_status='Confirmed' and lead status='Closed'
  - Verify all three operations succeed or none do

Test: Booking initiation booking_id is updated after confirmation
```

## 5. Integration Tests — Processor

File: `app/api/cron/deal-stage-process/__tests__/route.test.ts`

### Happy Path

```
Test: Processes pending events and creates history rows
  - Insert 3 outbox events for 3 different leads
  - Call processor
  - Verify 3 deal_stage_history rows created
  - Verify 3 outbox rows marked 'done'
  - Verify response: { processed: 3, failed: 0 }

Test: Processes events in id ASC order
```

### Inference

```
Test: Infers missing intermediate stages
  - Lead has no history. Event: site_visit_completed (ordinal 4)
  - Verify 4 history rows: Fresh(INFERRED), Contacted(INFERRED),
    Site Visit(INFERRED), Negotiation(ACTUAL)
  - Assert entered_at on all 4 rows equals the event_ts
  - Assert transition_type is correct for each row

Test: Infers only the gap
  - Lead has Fresh + Contacted. Event: booking_initiated (ordinal 5)
  - Verify 3 new rows: Site Visit(INFERRED), Negotiation(INFERRED), Sales(ACTUAL)

Test: No inference when stages are sequential
  - Lead has Fresh. Event: sales_form_submitted (ordinal 2)
  - Verify 1 new row: Contacted(ACTUAL), no INFERRED rows
```

### Late Events and INFERRED→ACTUAL Correction (ADL-01)

```
Test: Actual event corrects INFERRED stage
  - Process site_visit_completed → creates Fresh(I), Contacted(I), SiteVisit(I), Negotiation(A)
  - Process sales_form_submitted with earlier timestamp
  - Verify Contacted row: transition_type='ACTUAL', entered_at=earlier timestamp

Test: Actual event with later timestamp corrects type but keeps earlier entered_at
  - Process site_visit_completed at T → Contacted(INFERRED, entered_at=T)
  - Process sales_form_submitted at T+1day
  - Verify Contacted: transition_type='ACTUAL', entered_at=T (LEAST preserved)

Test: Two Contacted events — first ACTUAL wins, second is no-op
  - Process sales_form_submitted → Contacted(ACTUAL)
  - Process call_completed for same lead
  - Verify Contacted row unchanged (still first event's data)
  - Verify both outbox events are 'done'

Test: Late event after already-ACTUAL stage is no-op
  - Insert Contacted as ACTUAL via sales form
  - Process call_completed event
  - Verify no change to Contacted row

Test: Duration recalculation after INFERRED→ACTUAL correction
  - Process events out of order
  - Read via GET /api/leads/[id]/deal-stage
  - Verify durationSeconds reflect corrected entered_at timestamps
```

### Idempotency

```
Test: Duplicate outbox event for same event_key is rejected
  - Insert outbox event, process it (done)
  - Attempt to insert same event_key again → unique violation

Test: Lower stage event after higher stage is a no-op
  - Lead has Negotiation (ordinal 4). Process lead_assigned event (ordinal 1)
  - Verify no new history rows (Fresh already exists as INFERRED)
  - Verify outbox event marked 'done'
```

### Failure Handling

```
Test: Event for deleted lead is marked failed
  - Insert outbox event, then delete the lead
  - Process batch
  - Verify outbox row: status='failed', error_message contains 'lead not found'
  - Verify attempts=1

Test: Failed event retries with backoff
  - Insert event that will fail (deleted lead)
  - Process once → verify attempts=1, next_retry_at is set, status='failed'
  - Process again before next_retry_at → verify event is skipped
  - Advance clock past next_retry_at → verify event is retried, attempts=2

Test: Event dead-letters after 10 failed attempts
  - Set attempts=9 on a failing event
  - Process → verify attempts=10, next_retry_at=NULL, status='failed'
  - Process again → verify event is not picked up

Test: One failed event does not block others in batch
  - Insert 3 events: good, bad (deleted lead), good
  - Process batch
  - Verify: 2 done, 1 failed, response: { processed: 2, failed: 1 }

Test: Attempts count only failures (not total processing)
  - Process event successfully on first try
  - Verify attempts=0, status='done'
```

### Batch Limits

```
Test: Respects limit parameter
  - Insert 10 events, call with ?limit=3
  - Verify only 3 processed
  - Call again → 3 more processed

Test: Default limit is 50
Test: Limit clamped to 200 maximum
```

## 6. Integration Tests — Read APIs

File: `app/api/leads/[id]/deal-stage/__tests__/route.test.ts`

```
Test: Returns full history with durations for tracked lead
  - Assert each stage has correct ordinal, entered_at, transition_type
  - Assert durationSeconds is computed correctly

Test: Returns { tracked: false } for lead with no history
Test: Returns upcomingStages for partially progressed lead
Test: Returns empty upcomingStages for Booked lead
Test: currentStageDurationSeconds is positive and reasonable
Test: durationSeconds is 0 for consecutive stages with same entered_at
Test: 404 for non-existent lead
Test: 404 for lead in different organization (not 403)
Test: 403 for unassigned Sales Manager
Test: 200 for assigned Sales Manager
```

File: `app/api/leads/deal-stages/__tests__/route.test.ts`

```
Test: Returns current stage for multiple leads
Test: Returns { tracked: false } for leads with no history
Test: Filters results to authorized leads for Sales Manager
  - SM sees own leads' stages, other SMs' leads appear as untracked
Test: Maximum 200 IDs enforced
Test: Invalid IDs return 400
Test: Empty ids parameter returns empty stages object
Test: Cross-tenant IDs silently return untracked (not error)
```

## 7. Concurrency Tests

File: `lib/__tests__/dealStageConcurrency.test.ts`

```
Test: Two events for same lead, same stage — only one history row created
  - Insert two outbox events: sales_form_submitted + call_completed (both → Contacted)
  - Process both concurrently
  - Verify exactly ONE Contacted row in deal_stage_history
  - Verify both outbox events are 'done'

Test: Two events for same lead, different stages — both processed correctly
  - Insert: sales_form_submitted (Contacted) + site_visit_scheduled (Site Visit)
  - Process concurrently
  - Verify both stages exist in history with correct ordinals

Test: FOR UPDATE SKIP LOCKED prevents batch contention
  - Insert 10 events
  - Start two processor calls with limit=10 concurrently
  - Verify all 10 events processed exactly once (no duplicates)

Test: Per-lead FOR UPDATE serializes processing
  - Insert 5 events for the same lead
  - Process all in one batch
  - Verify history is consistent (no race-condition duplicates)

Test: Concurrent first booking-field saves for same lead
  - Two calls to POST /api/booking-initiations for same lead
  - Verify exactly one booking_initiations row created
  - Verify exactly one outbox event created

Test: Booking form opened by multiple employees — only first creates initiation
  - Employee A saves field → 201 Created
  - Employee B saves field → 200 OK (existing)
  - Verify initiated_by is Employee A
```

## 8. Authorization Tests

File: `__tests__/dealStageAuth.test.ts`

### Single Lead Endpoint

```
Test: Admin can read any lead's deal stage in their org
Test: Site Head can read any lead's deal stage in their org
Test: Assigned SM can read their lead's deal stage
Test: Unassigned SM gets 403
Test: Receptionist gets 403
Test: No session gets 401
Test: Admin cannot read lead from different org (404, not 403)
```

### Batch Endpoint

```
Test: Admin gets all requested leads
Test: SM gets only assigned leads (others appear as untracked, not 403)
Test: Receptionist gets only submitted leads
Test: Cross-tenant IDs return untracked (not error)
```

### Booking Initiations

```
Test: Assigned SM can initiate booking
Test: Unassigned SM gets 403
Test: Admin can initiate for any lead in org
Test: Lead in different org returns 404
```

### Cron Processor

```
Test: Valid CRON_SECRET header → 200
Test: Valid dedicated token → 200
Test: Admin session → 200 (own org only)
Test: SM session → 401
Test: No auth → 401
```

## 9. Failure and Recovery Tests

File: `__tests__/dealStageRecovery.test.ts`

```
Test: Worker crash during processing — all events revert to previous status
  - Simulate by throwing inside transaction after partial processing
  - Verify no history rows created (transaction rolled back)
  - Verify outbox events are still 'pending'

Test: Lead deleted while outbox events are pending (Scenario F)
  - Create lead, insert outbox event, delete lead
  - Process → event marked 'failed' with 'lead not found'

Test: Booking CTE fails after main transaction (Scenario G)
  - Simulate CTE failure
  - Verify no outbox event created
  - Verify booking stays 'Pending'

Test: Code rollback with pending events
  - Insert outbox events
  - Verify events persist untouched after simulated "rollback" (no processing)
  - Resume processing → events processed correctly

Test: Vercel execution timeout mid-batch
  - Process large batch, simulate timeout after N events
  - Transaction rolls back
  - Next invocation reprocesses all events
  - Verify no partial state

Test: Outbox cleanup does not affect pending/failed events
  - Mix of 'done', 'pending', 'failed' events
  - Run cleanup (DELETE WHERE status='done' AND processed_at < cutoff)
  - Verify pending and failed events are untouched

Test: Schema partially applied (table exists, index missing)
  - Verify processor handles gracefully or fails with clear error

Test: Revisit lead lifecycle isolation
  - Create 3 revisit leads in a chain
  - Process events for each independently
  - Verify each has its own independent history
  - Verify no cross-lead contamination
```

## 10. Test Infrastructure

### Database Setup

Tests use the same `transaction()` helper from `lib/db.ts` with a test database.
Each test suite:

1. Runs inside a transaction that is rolled back after the suite (or uses
   per-test cleanup with DELETE statements).
2. Creates minimal fixture data: one organization, one admin user, one SM user,
   a few leads.

### Fixtures

```typescript
const TEST_ORG_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ADMIN_USER = { id: 1, role: 'admin', organization_id: TEST_ORG_ID };
const SM_USER = { id: 2, role: 'sales manager', organization_id: TEST_ORG_ID };
const OTHER_ORG_ID = '11111111-2222-3333-4444-555555555555';

function createTestLead(client, overrides = {}) { ... }
function createTestOutboxEvent(client, leadId, eventType, overrides = {}) { ... }
function getHistoryForLead(client, leadId) { ... }
```

### Session Mocking

Use the same pattern as existing test files (`jest.mock('@/lib/serverAuth')`):

```typescript
vi.mock('@/lib/serverAuth', () => ({
  getServerSessionOrThrow: vi.fn(),
  getSessionUserId: vi.fn(),
}));

(getServerSessionOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
  role: 'sales manager',
  name: 'Test SM',
  org: TEST_ORG_ID,
});
(getSessionUserId as ReturnType<typeof vi.fn>).mockReturnValue(SM_USER.id);
```

### Assertion Patterns

Tests must assert:
- **Timestamps:** `entered_at` matches expected business event time, not processing time.
- **Transition types:** ACTUAL vs INFERRED is correct for each row.
- **Stage order:** `stage_ordinal` is monotonically increasing per lead.
- **Durations:** Computed from consecutive `entered_at` values, not stored.
- **Row counts:** Exact number of history/outbox rows, not just "at least one."
- **Idempotency:** Re-processing produces no additional rows or changes.

## 11. Test Execution Order

Tests should be independent and parallelizable. However, the recommended
execution order for CI is:

1. **Unit tests** — fast, no DB, catch logic errors early.
2. **Authorization tests** — catch permission issues before functional tests.
3. **Integration tests (hooks)** — verify outbox events are written correctly.
4. **Integration tests (processor)** — verify events are processed correctly.
5. **Integration tests (read APIs)** — verify data is returned correctly.
6. **Late events & corrections** — verify ADL-01 behavior.
7. **Failure & recovery** — verify crash/rollback behavior.
8. **Concurrency tests** — slowest, run last.

### CI Command

```bash
npx vitest run --reporter=verbose src/lib/dealStage.test.ts
```

`--runInBand` for integration tests to avoid database contention. Unit tests
can run in parallel.

## 12. What Is NOT Tested

- **Frontend UI rendering** — deferred (separate design phase).
- **Vercel Cron scheduling** — verified manually in deployment.
- **Neon connection drops** — PostgreSQL guarantees transaction rollback on
  disconnect; this is infrastructure-level, not application-level.
- **Performance under load** — the system has 6x+ headroom at 5-minute cron
  intervals. Load testing is not warranted at current scale. All throughput
  figures are ESTIMATES and require benchmarking before production.
- **Actual Vercel plan limits** — UNVERIFIED. Manual verification required.
