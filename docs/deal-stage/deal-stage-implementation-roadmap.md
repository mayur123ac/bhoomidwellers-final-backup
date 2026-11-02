# Deal Stage Pipeline — Implementation Roadmap

> Version: 2.0 | Date: 2026-11-01 | Status: DESIGN (not implemented)

## 1. Phase Overview

| Phase | Name | Scope | Dependency |
|---|---|---|---|
| 0 | Prerequisites | Transaction wrappers for site-visits | None |
| 1 | Database | Migration: 3 tables + indexes + constraints + ALTER | None |
| 2 | Core Engine | `lib/dealStage.ts` + `lib/dealStageOutbox.ts` | Phase 1 |
| 3 | Event Hooks | Outbox INSERTs in 8 source endpoints | Phase 0 + Phase 2 |
| 4 | Processor | Cron endpoint + processing loop | Phase 2 |
| 5 | Read APIs | Single-lead + batch endpoints | Phase 1 |
| 6 | Booking Initiation | New endpoint + booking-applications CTE hook | Phase 2 |
| 7 | Deployment | vercel.json cron + verification | Phase 4 |
| 8 | Frontend | UI components (deferred — separate design) | Phase 5 |

Phases 2-6 can be developed in parallel after Phase 1 is applied.
Phases 0 and 1 have no interdependencies and can also be done in parallel.

## 2. Phase 0 — Prerequisites

### 0A. Wrap `POST /api/site-visits` in transaction() (ADL-09)

**File:** `app/api/site-visits/route.ts` POST handler

**Current (VERIFIED):** Uses bare `query()` calls — 4 sequential queries (lead check,
duplicate check, INSERT site_visit, INSERT follow_up) plus a push notification.

**Change:** Wrap the database operations in `transaction(async (client) => { ... })`,
replacing `query()` calls with `client.query()`.

**Critical:** The push notification call (`pushSiteVisit` at line ~129) must remain
OUTSIDE the transaction (after it returns). It is an FCM push — a fire-and-forget
external network call with `.catch(() => {})`. Holding a database connection open
during an external call is the exact anti-pattern the existing booking endpoint
comments warn about.

**Correct structure:**
```typescript
const result = await transaction(async (client) => {
  // Lead check, duplicate check, INSERT site_visit, INSERT follow_up
  // ... all using client.query() ...
  return { newVisit, lead };
});

// Push notification AFTER commit
if (result.lead.assigned_to) {
  pushSiteVisit(...).catch(() => {});
}
```

**Risk:** Low. The POST handler has no intermediate error handling that depends on
partial commit.

### 0B. Wrap `PATCH /api/site-visits` in transaction() (ADL-09)

**File:** `app/api/site-visits/route.ts` PATCH handler

**Current (VERIFIED):** Uses 4+ independent bare `query()` calls (dynamic UPDATE,
conditional follow_up INSERT, conditional walkin_enquiries UPDATE, conditional
completed_at UPDATE).

**Change:** Same as 0A — wrap all database operations in `transaction()`.

**Side effects in completion branch (VERIFIED):** All operations in the `completed`
branch (lines 208-224) are database queries — no external calls. The entire block
can safely be wrapped in one transaction.

**Risk:** Low. If any operation fails, the entire update is rolled back, which is
strictly better than the current behavior where a partial set of updates could
succeed.

### 0C. Verify booking-applications CTE structure (ADL-03)

**File:** `app/api/booking-applications/route.ts` POST handler

**Current (VERIFIED):** Post-commit CTE at lines 835-843:
```sql
WITH confirmed AS (
  UPDATE booking_applications SET booking_status = 'Confirmed'
   WHERE id = $1 AND organization_id = $3
)
UPDATE walkin_enquiries SET status = 'Closed'
 WHERE id = $2 AND organization_id = $3
```

**Assessment:** The CTE structure supports extension. The `confirmed` CTE can be
modified to also set `confirmed_at = NOW()` and RETURN the timestamp. A third
clause can INSERT into `deal_stage_outbox` using the returned timestamp.

**R2 upload analysis (VERIFIED):** R2 document uploads happen AFTER the CTE
(line 849). They are explicitly designed to be independent of the booking's
database state. Moving the CTE or extending it does NOT affect R2 uploads.

**Pre-existing issue:** If the CTE fails after the main transaction commits,
inventory is marked 'booked' but the booking stays 'Pending'. This is outside
deal stage scope. The deal stage system is correct: no Booked event if
confirmation did not occur.

**Deliverable:** This assessment. No code change in Phase 0.

## 3. Phase 1 — Database Migration

### Migration File

```
scripts/migrations/2026-11-01_deal_stage_tables.sql
```

**Contents (from Database Design v2.0):**
- `CREATE TABLE IF NOT EXISTS deal_stage_outbox` + 4 indexes (including full unique on event_key)
- `CREATE TABLE IF NOT EXISTS deal_stage_history` + 4 indexes + 3 CHECK constraints
- `CREATE TABLE IF NOT EXISTS booking_initiations` + 1 unique index
- `ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`

**Execution:** Manual application to Neon (ep-long-cloud) via psql or pgAdmin.
No migration runner exists in this codebase.

**Idempotent:** All statements use `IF NOT EXISTS` or `IF NOT EXISTS` column check.
Safe to re-run.

**Partial migration safety:** Each statement is independent. If the migration is
interrupted partway, re-running it completes the remaining statements without
affecting already-created objects.

**Rollback (destructive — requires explicit admin approval):**
```sql
-- WARNING: This deletes ALL deal stage data. Confirm before executing.
DROP TABLE IF EXISTS booking_initiations CASCADE;
DROP TABLE IF EXISTS deal_stage_history CASCADE;
DROP TABLE IF EXISTS deal_stage_outbox CASCADE;
-- Optional: remove the added column
-- ALTER TABLE booking_applications DROP COLUMN IF EXISTS confirmed_at;
```

### Verification Queries

After applying:

```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('deal_stage_outbox', 'deal_stage_history', 'booking_initiations');

-- Verify indexes
SELECT indexname FROM pg_indexes
 WHERE tablename IN ('deal_stage_outbox', 'deal_stage_history', 'booking_initiations');

-- Verify constraints
SELECT conname FROM pg_constraint
 WHERE conrelid IN ('deal_stage_history'::regclass);

-- Verify confirmed_at column
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'booking_applications' AND column_name = 'confirmed_at';
```

## 4. Phase 2 — Core Engine

### File: `lib/dealStage.ts`

Central stage computation logic. Pure functions with no database access:

- `STAGE_MAP`: event_type → { stage, ordinal }
- `STAGE_NAMES`: ordinal → stage name
- `mapEventToStage(eventType)`: Returns { stage, ordinal } or throws for unknown types
- `computeInferredStages(highestExisting, targetOrdinal)`: Returns array of
  stages to infer, or null if target already reached
- `computeStageDurations(historyRows)`: Computes duration from consecutive
  entered_at values (handles equal timestamps → 0 duration)
- `buildApiResponse(historyRows, leadId)`: Formats history for API response

### File: `lib/dealStageOutbox.ts`

Outbox writer helper used by all event hooks:

- `insertOutboxEvent(client, params)`: INSERT with ON CONFLICT (event_key) DO NOTHING
- `buildEventKey(eventType, sourceTable, sourceRecordId)`: Formats idempotency key

Both files are testable in isolation (unit tests from testing strategy).

## 5. Phase 3 — Event Hooks

Each hook is a single `INSERT INTO deal_stage_outbox` call added inside an
existing transaction. The hooks are independent and can be implemented in any
order.

| Hook | File | Transaction | Prerequisite |
|---|---|---|---|
| lead_assigned | `api/walkin_enquiries/route.ts` POST | Existing `transaction()` | None |
| lead_assigned_from_queue | `lib/walkInQueue.ts` | Existing (called inside txn) | None |
| lead_assigned_bulk | `lib/ingestion/bulkInsertLeads.ts` | Existing `transaction()` | None |
| sales_form_submitted | `api/sales-form-submit/route.ts` | Existing `transaction()` | None |
| call_completed | `api/call-sessions/[id]/complete/route.ts` | Existing `transaction()` | None |
| site_visit_scheduled | `api/site-visits/route.ts` POST | **New** `transaction()` | Phase 0A |
| site_visit_scheduled_via_salesform | `api/sales-form-submit/route.ts` | Existing `transaction()` | None |
| site_visit_completed | `api/site-visits/route.ts` PATCH | **New** `transaction()` | Phase 0B |

### Implementation Pattern (identical for all hooks)

```typescript
// Inside transaction, after the business INSERT/UPDATE:
await insertOutboxEvent(client, {
  lead_id: leadId,
  event_type: 'sales_form_submitted',
  event_ts: followUpRow.created_at,
  event_key: buildEventKey('sales_form_submitted', 'follow_ups', followUpRow.id),
  actor_id: sessionUserId,
  payload: {
    source_table: 'follow_ups',
    source_record_id: followUpRow.id,
  },
  organization_id: orgId,
});
```

Each hook adds ~5 lines of code to its source file.

**Note for Event 7 (site_visit_scheduled_via_salesform):** The existing INSERT at
`sales-form-submit/route.ts:170-174` does NOT use RETURNING. The hook must modify
the INSERT to add `RETURNING id, created_at` to capture the site_visit_id and
created_at for the event_key and event_ts.

## 6. Phase 4 — Outbox Processor

### File: `app/api/cron/deal-stage-process/route.ts`

Single file containing:
1. Authentication (token or session)
2. Batch SELECT with FOR UPDATE SKIP LOCKED
3. Processing loop with SAVEPOINTs
4. `processOneEvent()` — loads history, computes transition, inserts/corrects
   history rows (including INFERRED→ACTUAL via ON CONFLICT DO UPDATE)
5. Error handling with retry/dead-letter logic (attempts incremented on failure only)
6. Summary response

**Exports:**
```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { ... }
export async function POST(request: NextRequest) { ... } // alias
```

**Size estimate:** ~250 lines (increased from V1 due to INFERRED→ACTUAL correction
logic).

## 7. Phase 5 — Read APIs

### File: `app/api/leads/[id]/deal-stage/route.ts`

Single-lead deal stage history. ~80 lines:
1. Auth (same pattern as visit-chain)
2. Query deal_stage_history for lead
3. Compute durations (handles zero-duration for equal timestamps)
4. Build response with upcomingStages

### File: `app/api/leads/deal-stages/route.ts`

Batch current-stage lookup. ~60 lines:
1. Auth (same scoping as walkin_enquiries GET)
2. Parse + validate IDs (max 200, numeric only)
3. DISTINCT ON query for highest stage per lead
4. Intersect with authorized lead set (SM sees only assigned leads)
5. Build response map

## 8. Phase 6 — Booking Initiation + Confirmation Hook

### File: `app/api/booking-initiations/route.ts` (NEW)

~120 lines:
1. Auth
2. Validate `saved_field` (non-empty name and value)
3. Verify lead exists + authorized
4. Check for existing confirmed booking (409)
5. INSERT ON CONFLICT DO NOTHING + conditional outbox INSERT
6. Return created or existing row

### Modification: `app/api/booking-applications/route.ts`

Extend post-commit CTE (lines 835-843) with:
- `confirmed_at = NOW()` in the confirmed CTE
- `RETURNING confirmed_at` from the confirmed CTE
- `INSERT INTO deal_stage_outbox SELECT ... FROM confirmed`
- `ON CONFLICT (event_key) DO NOTHING`
- `UPDATE booking_initiations SET booking_id = $1 WHERE lead_id = $2`

~25 lines modified in existing file.

## 9. Phase 7 — Deployment

### vercel.json Addition

```json
{
  "path": "/api/cron/deal-stage-process",
  "schedule": "*/5 * * * *"
}
```

Added to the existing `crons` array alongside the attendance auto-complete entries.

**UNVERIFIED (ADL-08):** The schedule `*/5 * * * *` requires Vercel Pro. The
existing attendance crons use the same frequency, suggesting Pro is in use. If
the project is on Hobby, options are:
- Upgrade to Pro.
- Use a third-party cron service (cron-job.org, Upstash QStash).
- Reduce frequency to daily (insufficient for real-time tracking).

### Environment Variables

No new environment variables required. The processor reuses:
- `CRON_SECRET` (already configured for attendance crons)
- Database connection (existing pool)

### Deployment Sequence

1. **Apply migration** to Neon ep-long-cloud (Phase 1).
2. **Verify migration** with the verification queries.
3. **Deploy code** with all phases (0-6).
4. **Add cron entry** to vercel.json (Phase 7) — can be in the same deploy.
5. **Monitor** first few cron invocations via Vercel logs.
6. **Verify** processor returns `{ processed: 0 }` when outbox is empty.
7. **Create a test lead** and verify the pipeline end-to-end.

The cron can be added in the same deployment as the code. Before any business
events trigger outbox INSERTs, the processor will find an empty outbox and
return `{ processed: 0 }`.

## 10. Rollback Plan (ADL-07)

### Application Rollback (safe, non-destructive)

**Code rollback:** Revert the deployment. Event hooks stop firing. Existing
pending outbox events remain in the database untouched.

**Disable processor only:** Remove the cron entry from vercel.json. Events
accumulate in outbox. No data loss. When fixed code is redeployed, add the
cron entry back and processing resumes.

**Events from rolled-back code:** Outbox events created by a code version that
is being rolled back carry valid event_type and event_key values. When the
processor is redeployed, it processes them normally. If a rolled-back version
introduced an unknown event_type, the processor marks it as failed (not a crash).

**NEVER do this during rollback:**
```sql
-- UNSAFE: deletes committed business events
DELETE FROM deal_stage_outbox WHERE status = 'pending';
```

### Schema Rollback (destructive — requires explicit approval)

Only needed if the tables must be removed entirely. This is a **destructive**
operation that permanently deletes ALL deal stage data:

```sql
-- DESTRUCTIVE: requires explicit admin approval
DROP TABLE IF EXISTS booking_initiations CASCADE;
DROP TABLE IF EXISTS deal_stage_history CASCADE;
DROP TABLE IF EXISTS deal_stage_outbox CASCADE;
-- ALTER TABLE booking_applications DROP COLUMN IF EXISTS confirmed_at;
```

No existing tables are modified by the deal stage feature (except the
`confirmed_at` addition to booking_applications, which is nullable and has
no effect on existing code). Schema rollback has zero impact on existing CRM
functionality.

### Partial Rollback

If only the processor has issues but event hooks are working:
- Remove the cron entry from vercel.json.
- Events accumulate in outbox (no processing).
- Fix the processor, redeploy, events process normally.
- No data loss.

## 11. Estimated Implementation Effort

| Phase | Files Changed | Files Created | Lines Added (est.) |
|---|---|---|---|
| 0 | 1 (site-visits/route.ts) | 0 | ~40 (transaction wrappers) |
| 1 | 0 | 1 (migration SQL) | ~90 |
| 2 | 0 | 2 (dealStage.ts, dealStageOutbox.ts) | ~180 |
| 3 | 6 (source endpoints) | 0 | ~50 (5-7 lines × 8 hooks) |
| 4 | 0 | 1 (cron route) | ~250 |
| 5 | 0 | 2 (read API routes) | ~140 |
| 6 | 1 (booking-applications) | 1 (booking-initiations) | ~150 |
| 7 | 1 (vercel.json) | 0 | ~4 |
| **Total** | **9** | **7** | **~904** |

## 12. What Is Explicitly Deferred

| Item | Reason |
|---|---|
| Frontend UI/UX (DealStagePipeline component) | Separate design phase |
| Historical backfill for existing leads | Not needed; leads start tracking on next event |
| Admin dashboard for outbox monitoring | Manual SQL queries sufficient initially |
| Outbox cleanup cron | Manual monthly cleanup sufficient initially |
| Performance benchmarking | ESTIMATE-based headroom appears sufficient; benchmark before scaling |
| Webhook/external notifications on stage change | Not in requirements |
| Vercel plan verification | UNVERIFIED — manual check required before deployment |

## 13. Dependencies Summary

```
Phase 0A ─────┐
Phase 0B ─────┤
              ├──→ Phase 3 (event hooks for site-visit endpoints)
Phase 1 ──┬───┘
           ├──→ Phase 2 ──→ Phase 3 (all other hooks)
           │              ├──→ Phase 4 (processor)
           │              └──→ Phase 6 (booking initiation + CTE hook)
           ├──→ Phase 5 (read APIs)
           └──→ Phase 7 (deployment, after all above)
```

Critical path: Phase 1 → Phase 2 → Phase 4 → Phase 7.

## 14. Pre-Implementation Checklist

Before writing any code, verify:

- [ ] Vercel plan is Pro (or alternative cron solution identified) — ADL-08
- [ ] Migration applied to Neon ep-long-cloud — Phase 1
- [ ] Migration verified with verification queries — Phase 1
- [ ] `confirmed_at` column exists on booking_applications — Phase 1
- [ ] Team acknowledges the pre-existing booking CTE consistency issue — ADL-03
- [ ] Rollback procedures reviewed and approved — ADL-07
