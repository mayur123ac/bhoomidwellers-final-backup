# Deal Stage Comprehensive Audit Report

**Date:** 2026-11-20
**Auditor:** Claude Opus 4.6 (Senior PostgreSQL DBA + Next.js Backend Architect)
**Database:** Neon ep-long-cloud-a1d5t8of (production)
**Method:** Live schema verification via pg_indexes/pg_constraint/pg_stat_user_indexes + EXPLAIN ANALYZE

---

## 1. Files Inspected

### Core Engine
| File | Purpose |
|---|---|
| `lib/dealStage.ts` | Stage mapping, processOneEvent, reconciliation, buildApiResponse |
| `lib/dealStageOutbox.ts` | Outbox writer, SAVEPOINT isolation, opportunistic retry |
| `lib/dealProgressScore.ts` | Pure score computation (no DB) |

### API Routes
| File | Purpose |
|---|---|
| `api/leads/[id]/deal-stage/route.ts` | GET (single lead) + POST (manual advance) |
| `api/leads/deal-stages/route.ts` | GET (batch read, up to 200 IDs) |
| `api/cron/deal-stage-process/route.ts` | Admin recovery endpoint |

### Hook Sites (15 total)
| File:Line | Event Type | In Transaction |
|---|---|---|
| `walkin_enquiries/route.ts:801` | lead_assigned | Yes |
| `walkInQueue.ts:113` | lead_assigned_from_queue | Yes |
| `ingestion/bulkInsertLeads.ts` | lead_assigned_bulk | Yes |
| `sales-form-submit/route.ts:121` | sales_form_submitted | Yes |
| `sales-form-submit/route.ts:194` | site_visit_scheduled_via_salesform | Yes |
| `call-sessions/[id]/complete/route.ts:119` | call_completed | Yes |
| `site-visits/route.ts:111` | site_visit_scheduled | Yes |
| `site-visits/route.ts:240` | site_visit_completed | Yes |
| `booking-applications/route.ts:781` | booking_initiated | Yes |
| `booking-applications/route.ts:905` | booking_confirmed | Yes |
| `booking-applications/[id]/route.ts:637` | booking_confirmed (reactivate) | Yes |
| `booking-applications/[id]/route.ts:714` | booking_confirmed (pending recovery) | Yes |
| `leads/[id]/deal-stage/route.ts:331` | manual_advance_N | Yes |
| `followups/route.ts:430` | follow_up_created | Yes |

All 15 hooks are inside transactions. All include source_table and source_record_id in payload.

### Frontend Components
| File | Purpose |
|---|---|
| `components/DealStageTimeline.tsx` | Pipeline bar, history panel, advance modal |
| `components/leads/LeadDealStagePanel.tsx` | Wrapper (theme/role passthrough) |
| `components/leads/LeadDetailsPanel.tsx` | Host — passes onDataLoaded callback |
| `components/leads/LeadDetailsHeader.tsx` | Score ring display |

### Migration
| File | Applied to Neon |
|---|---|
| `scripts/migrations/2026-11-01_deal_stage_tables.sql` | Yes (verified) |

### Test Files
| File |
|---|
| `lib/dealStage.test.ts` |
| `lib/dealStage.audit.test.ts` |
| `lib/dealStageHooks.audit.test.ts` |
| `lib/dealStagePhase4.test.ts` |
| `lib/dealStage.integration.test.ts` |
| `lib/dealStage.sitevisit.integration.test.ts` |

---

## 2. Database Tables Involved

| Table | Row Count | Purpose |
|---|---|---|
| `deal_stage_history` | 1,253 | Stage progression records |
| `deal_stage_outbox` | 1,226 | Event outbox (all status=done) |
| `booking_initiations` | 0 | Booking initiation tracking |
| `walkin_enquiries` | 829 | Leads table (FK target) |

---

## 3. PostgreSQL Index Inventory (Verified Live)

### deal_stage_history

| Index Name | Definition | Valid | Ready | Scans | Useful? |
|---|---|---|---|---|---|
| `deal_stage_history_pkey` | UNIQUE btree (id) | Yes | Yes | 0 | PK — required but zero direct scans (no query looks up by id alone) |
| `idx_dsh_lead_entered` | btree (lead_id, entered_at) | Yes | Yes | **0** | **UNUSED** — no query uses ORDER BY entered_at |
| `idx_dsh_lead_ordinal` | btree (lead_id, stage_ordinal DESC) | Yes | Yes | 813 | **PRIMARY workhorse** — used by all single/batch history reads |
| `idx_dsh_org` | btree (organization_id) | Yes | Yes | **0** | **UNUSED** — org is always paired with lead_id; standalone org scan never happens |
| `uq_dsh_lead_stage` | UNIQUE btree (lead_id, stage) | Yes | Yes | 1,274 | **HIGHEST usage** — ON CONFLICT (lead_id, stage) in every INSERT |

### deal_stage_outbox

| Index Name | Definition | Valid | Ready | Scans | Useful? |
|---|---|---|---|---|---|
| `deal_stage_outbox_pkey` | UNIQUE btree (id) | Yes | Yes | 32 | PK — used in UPDATE by id |
| `idx_dso_lead` | btree (lead_id) | Yes | Yes | 2 | Low usage — opportunistic retry only |
| `idx_dso_pending` | btree (id) WHERE status='pending' | Yes | Yes | **0** | Zero scans — all events process immediately |
| `idx_dso_retry` | btree (next_retry_at) WHERE status='failed' AND next_retry_at IS NOT NULL | Yes | Yes | 29 | Used by recovery batch |
| `uq_dso_event_key` | UNIQUE btree (event_key) | Yes | Yes | 1,287 | **HIGHEST usage** — idempotency check on every INSERT |

### booking_initiations

| Index Name | Definition | Valid | Ready | Scans | Useful? |
|---|---|---|---|---|---|
| `booking_initiations_pkey` | UNIQUE btree (id) | Yes | Yes | 0 | PK — table is empty |
| `uq_bi_lead` | UNIQUE btree (lead_id) | Yes | Yes | 2 | Constraint enforcement |

### walkin_enquiries (relevant subset)

| Index Name | Used by Deal Stage? |
|---|---|
| `walkin_enquiries_pkey` | Yes — lead lookup by id uses PK scan (0.04ms) |
| `idx_walkin_org` | No — org filter is applied as a post-PK filter |

---

## 4. Missing Index Report

| Table | Missing Index | Justification | Severity |
|---|---|---|---|
| None critical | — | — | — |

**Analysis:** The current query patterns are well-served by existing indexes:

- **Single-lead history**: `idx_dsh_lead_ordinal` covers `WHERE lead_id = $1 ORDER BY stage_ordinal ASC` perfectly (index scan backward, 0.04ms).
- **Batch history**: Same index handles `WHERE lead_id = ANY($1::int[])` with incremental sort (1.8ms for 5 leads).
- **Lead lookup**: PK index on walkin_enquiries (0.04ms).
- **Outbox idempotency**: `uq_dso_event_key` (0.04ms).
- **Recovery batch**: `idx_dso_pending` + `idx_dso_retry` via BitmapOr (0.06ms).

**Composite index (organization_id, lead_id) on deal_stage_history**: NOT needed. The planner uses `idx_dsh_lead_ordinal` on lead_id and applies organization_id as a cheap filter. With max 6 rows per lead, the filter cost is negligible.

**Index (organization_id, current_stage)**: NOT applicable — there is no `current_stage` column; it's computed from MAX(stage_ordinal).

---

## 5. Duplicate/Redundant Index Report

| Index | Status | Recommendation | Severity |
|---|---|---|---|
| `idx_dsh_lead_entered` | 0 scans, NEVER used | **DROP** — no query orders by entered_at; all use stage_ordinal | LOW |
| `idx_dsh_org` | 0 scans, NEVER used | **DROP** — organization_id is always combined with lead_id | LOW |
| `idx_dso_pending` | 0 scans | **KEEP** — safety net for recovery; near-zero maintenance cost on 1,226 rows | — |

These two unused indexes (`idx_dsh_lead_entered`, `idx_dsh_org`) consume space and slow writes marginally but are not causing performance problems at current scale. Dropping is recommended for hygiene, not urgency.

---

## 6. Query Performance Report

| Query / Operation | Plan | Time | Problem? |
|---|---|---|---|
| Single lead history (GET) | Index Scan Backward on idx_dsh_lead_ordinal | 0.04ms exec | No |
| Batch history (5 leads) | Index Scan + Incremental Sort | 1.8ms exec | No |
| Lead lookup by PK + org | Index Scan on walkin_enquiries_pkey | 0.04ms exec | No |
| Outbox event_key lookup | Index Scan on uq_dso_event_key | 0.04ms exec | No |
| Recovery batch (pending+failed) | BitmapOr on idx_dso_pending + idx_dso_retry | 0.06ms exec | No |
| Lead FOR UPDATE lock | Index Scan on walkin_enquiries_pkey | 0.04ms exec | No |

**All queries use index scans. Zero sequential scans detected.**

### Query Count per Operation

| Operation | Queries | Notes |
|---|---|---|
| GET single lead (tracked) | 4-6 | lead+history parallel (2), userNames+manualReasons parallel (2), total 4 |
| GET single lead (untracked, auto-seed) | 5 | lead+history (2), INSERT (1 txn), re-fetch (1), return (1) |
| GET batch (N leads) | 2 | leads query (1) + history query (1) |
| POST manual advance | 4-7 | lead lock (1), current max (1), outbox insert+process (variable), queue trigger (optional) |

No N+1 patterns. No SELECT *. No redundant queries.

---

## 7. Connection Pool & Neon Audit

| Setting | Value | Assessment |
|---|---|---|
| Pool max | 25 | Adequate for Neon pooler (100+ downstream) |
| Idle timeout | 30s | Good |
| Connection timeout | 15s | Accounts for Neon cold-start |
| Statement timeout | 30s | Safety net for runaway queries |
| allowExitOnIdle | true | Correct for Vercel serverless |
| globalThis singleton | Yes | Prevents HMR pool leak |
| acquireClient retry | Yes | 1 retry on transient connect errors |
| safeRelease(destroy) | Yes | Broken connections destroyed, not returned to pool |

**Deal Stage connection patterns:**
- GET single-lead: 2 parallel queries (Promise.all) + 2 parallel queries = max 2 concurrent connections
- GET batch: 2 sequential queries = 1 connection at a time
- POST manual advance: 1 transaction = 1 connection held for ~5-10 queries
- processOneEvent: runs within caller's transaction, no extra connection

**Pool exhaustion risk: LOW.** The heaviest path (POST manual advance) holds 1 connection. Even with 25 concurrent users advancing stages simultaneously, pool capacity is sufficient.

**Transaction duration:** processOneEvent runs 4-7 queries within a single transaction. At ~82ms RTT per query (Neon), the transaction holds a connection for ~330-580ms. This is acceptable.

---

## 8. Data Integrity Audit

| Check | Result | Severity |
|---|---|---|
| Duplicate lead+stage rows | **PASS** — 0 found | — |
| Orphaned history (no matching lead) | **PASS** — 0 found | — |
| Stage name vs ordinal consistency | **PASS** — all match | — |
| Cross-tenant history rows | **PASS** — 0 found | — |
| Stage ordinal gaps | **PASS** — 0 found | — |
| Outbox dead-lettered events | **PASS** — 0 found | — |
| Outbox status distribution | 1,226 done, 0 pending, 0 failed | Healthy |
| Timeline monotonicity | **6 violations** (see below) | LOW |
| Leads without history | **41 leads** (see below) | MEDIUM |

### Timeline Monotonicity Violations (6 leads)

All 6 cases follow the same pattern: a site visit was scheduled BEFORE the sales form was submitted. Example — Lead 50:
- Stage 2 (Contacted): 2026-06-20 09:27 — sales_form_submitted (ACTUAL)
- Stage 3 (Site Visit): 2026-06-19 13:56 — site_visit_scheduled (ACTUAL)

**Root cause:** The real-world workflow allows a site visit to be scheduled before the sales form is completed. Both events arrive as ACTUAL with their real timestamps, so the reconciliation engine correctly refuses to modify either.

**Impact:** `computeStageDurations` clamps negative durations to 0 and sets `duration_clamped: true`. The UI shows a "Timeline has inconsistent ordering" warning. This is correct behavior — the data accurately reflects what happened.

**Verdict:** NOT a bug. The reconciliation engine works as designed.

### Leads Without History (41 leads)

| Organization | Count |
|---|---|
| d2f5f87d (primary) | 27 |
| 9cf52f13 | 12 |
| 9e652ad6 | 2 |

**Root cause:** These leads were created before the deal-stage pipeline was deployed, or in orgs where hooks haven't fired yet.

**Mitigation:** The GET handler auto-seeds a "Fresh" INFERRED entry on first access (`deal-stage/route.ts:116-150`). Opening any of these leads in the UI will auto-create their history.

**Impact:** No functional impact — these leads show "No stage data yet" until opened, then auto-populate.

---

## 9. Concurrency & Race Condition Audit

| Scenario | Protection | Assessment |
|---|---|---|
| Two users advance same lead | `SELECT ... FOR UPDATE` on walkin_enquiries | Serialized — second request waits for first |
| Duplicate outbox events | UNIQUE index on event_key + ON CONFLICT DO NOTHING | Idempotent |
| Duplicate history rows | UNIQUE index on (lead_id, stage) + ON CONFLICT handling | Idempotent |
| Processing failure mid-transaction | SAVEPOINT ds_process + ROLLBACK TO SAVEPOINT | Outbox row survives; business operation unaffected |
| Auto-seed race (two GET requests) | ON CONFLICT (lead_id, stage) DO NOTHING | Only one wins; both return consistent data |
| Reactivation duplicate key | forceRetryStuckEvent picks up stuck event | Correctly handles |

**No unprotected race conditions found.**

---

## 10. Multi-Tenant Security & RBAC Audit

### GET /api/leads/[id]/deal-stage

| Check | Status |
|---|---|
| `requireSession()` | Yes — returns 401 if no session |
| `getOrganizationId()` from session | Yes — never from client |
| `organization_id` in all queries | Yes — walkin_enquiries + deal_stage_history |
| Admin / Site Head | Full access within org |
| Sales Manager | Only assigned leads (user_id match + name fallback) |
| Receptionist | Blocked (403) |
| Cross-tenant IDOR | **PASS** — lead must belong to session's org |

### POST /api/leads/[id]/deal-stage

| Check | Status |
|---|---|
| `requireSession()` | Yes |
| Role gate: Admin / Site Head / SM | Yes (line 231) |
| SM can only advance own leads | Yes (line 308-316) |
| Lead locked FOR UPDATE within org | Yes (line 288-301) |
| Input validation (target_ordinal, reason, event_ts) | Yes |
| Cross-tenant IDOR | **PASS** |

### GET /api/leads/deal-stages (batch)

| Check | Status |
|---|---|
| `requireSession()` | Yes |
| Role gate: Admin / Site Head / SM / Receptionist | Yes |
| ID limit: max 200 | Yes |
| SM sees only assigned leads | Yes (user_id + name fallback) |
| Receptionist sees only submitted leads | Yes (receptionist_user_id + name fallback) |
| Unauthorized IDs return `tracked: false` (no enumeration) | Yes |
| Cross-tenant IDOR | **PASS** |

### GET/POST /api/cron/deal-stage-process

| Check | Status |
|---|---|
| `requireSession()` | Yes |
| Admin/Super Admin only | Yes (line 120-125) |
| Organization-scoped | Yes |

**No RBAC or tenant isolation vulnerabilities found.**

---

## 11. Frontend Performance Audit

| Check | Finding | Severity |
|---|---|---|
| Duplicate API fetch | **FIXED** — onDataLoaded callback eliminates second fetch | — |
| Polling/interval refetch | None — data fetched once per lead open + on refreshKey change | — |
| refreshKey trigger | `followUps.length` — refetches only when follow-up count changes | LOW (see note) |
| Re-render on lead switch | New leadId causes one fetch (correct) | — |
| Animation cleanup | useEffect returns cleanup for RAF + timeout | — |
| Memory leaks | No dangling event listeners or intervals | — |
| Portal cleanup | AdvanceModal uses createPortal, unmounts with component | — |
| Optimistic update | Not implemented (fetches after advance) | LOW |
| Cache | No client-side cache; each lead open refetches | LOW |

**Note on refreshKey:** `dealStageRefreshKey = followUps.length` triggers a deal-stage refetch whenever a new follow-up is created. This is intentional (follow-ups trigger the follow_up_created hook which advances to Contacted). The refetch is bounded — it only fires on actual follow-up count changes, not on polling ticks.

**Note on missing optimistic update:** After manual advance, the UI refetches rather than optimistically updating. Given the sub-2ms query times, this is acceptable. An optimistic update would add complexity without meaningful UX improvement.

---

## 12. Bugs Discovered

### No application-level bugs found.

The codebase is clean. All 15 hook sites are properly wired, all within transactions, all with source metadata. The outbox pattern is correctly implemented with SAVEPOINT isolation. The reconciliation engine handles all edge cases (contradictory timestamps, INFERRED→ACTUAL correction, gap-filling).

---

## 13. Proposed Migration: Drop Unused Indexes

```sql
-- Deal Stage Audit: Drop unused indexes
-- Date: 2026-11-20
-- Impact: Removes 2 indexes with 0 scans since creation
-- Risk: LOW — no query pattern uses these indexes

-- idx_dsh_lead_entered: (lead_id, entered_at) — all queries use stage_ordinal ordering
DROP INDEX IF EXISTS idx_dsh_lead_entered;

-- idx_dsh_org: (organization_id) — always combined with lead_id in WHERE clauses
DROP INDEX IF EXISTS idx_dsh_org;
```

**Impact:** Marginal write performance improvement (2 fewer index updates per INSERT/UPDATE on deal_stage_history). No read impact — these indexes are never used by the planner.

**NOT auto-applied. Awaiting approval.**

---

## 14. Remaining Risks

| Risk | Severity | Mitigation |
|---|---|---|
| 41 leads without stage history | MEDIUM | Auto-seed on GET handles this; consider a one-time backfill script |
| 6 timeline monotonicity violations | LOW | By design — ACTUAL timestamps reflect real-world order; UI warns correctly |
| `idx_dso_pending` has 0 scans | LOW | Keep — it's the safety net for the recovery endpoint |
| No client-side deal-stage cache | LOW | At current scale (829 leads), sub-2ms queries make caching unnecessary |
| Outbox table grows unbounded | LOW | 1,226 rows after months of use; consider archiving `done` rows at 100k+ |

---

## 15. Severity Summary

| Severity | Count | Items |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | 41 leads without history (self-healing on access) |
| LOW | 4 | 2 unused indexes, 6 monotonicity violations (by design), no client cache |

---

## 16. Final Verdict

### Is Deal Stage properly indexed and optimized for production?

## **YES.**

**Evidence:**

1. **All 12 indexes are valid and ready** (pg_index.indisvalid = true, indisready = true).
2. **Zero sequential scans** — every query uses index scans (verified via EXPLAIN ANALYZE).
3. **Sub-2ms execution times** on all queries (the slowest is 1.8ms for a 5-lead batch).
4. **The two most-used indexes** (`uq_dsh_lead_stage` at 1,274 scans, `idx_dsh_lead_ordinal` at 813 scans) directly serve the primary query patterns.
5. **Data integrity is clean**: zero duplicates, zero orphans, zero cross-tenant rows, zero dead-lettered events.
6. **Concurrency is properly serialized** via FOR UPDATE locks and SAVEPOINT isolation.
7. **Multi-tenant security is enforced** at every endpoint via server-side organization_id from signed session.
8. **Connection pool is correctly configured** (max 25, globalThis singleton, cold-start retry, safe release).
9. **Two unused indexes** (`idx_dsh_lead_entered`, `idx_dsh_org`) are candidates for cleanup but do not impact production performance.

The Deal Stage pipeline is production-ready, properly indexed, and operating within normal performance parameters for a Neon-hosted PostgreSQL deployment.
