# Lead Deletion Architecture Audit — Phase 1

**Date:** 2026-10-29
**Scope:** Read-only investigation of all lead deletion functionality
**Status:** Phase 1 complete. Phase 2 (implementation) pending approval.

---

## 1. Deletion Entry Points

### 1A. Single Lead Delete (Context Menu / Toolbar)
- **UI:** `src/components/Enquiryoverviewsection.tsx:631` — context menu "Permanently Delete"
- **UI:** `src/app/dashboard/page.tsx:1756-1841` — DashboardOverview toolbar delete handler
- **Dialog:** `src/components/PermanentLeadDeleteDialog.tsx` — requires typing "DELETE" + optional reason
- **API:** `DELETE /api/walkin_enquiries/[id]`
- **Auth:** `requireRole(["admin"])` — legacy helper, no revocation-cache check
- **Org isolation:** Yes — `WHERE id = $1 AND organization_id = $2` + tenant column cross-check
- **Row lock:** `SELECT * FROM walkin_enquiries WHERE id = $1 FOR UPDATE`
- **Body:** `{ confirmation: "DELETE", reason?: string }`

### 1B. Bulk Delete (Dashboard Toolbar)
- **UI:** `src/app/dashboard/page.tsx:1807-1841` — bulk selection handler
- **Dialog:** `src/components/BulkDeleteLeadsDialog.tsx` — requires typing "DELETE" + optional reason
- **API:** `POST /api/walkin_enquiries/bulk-delete`
- **Auth:** `requireRole(["admin"])` — same legacy helper
- **Org isolation:** Yes — per-lead tenant check inside loop
- **Limit:** Max 100 leads per request (enforced server-side)
- **Transaction:** Single transaction with per-lead SAVEPOINTs; one failure does not abort batch

### 1C. Caller Lead Delete
- **UI:** `src/app/dashboard/employees/page.tsx:893` — caller lead context menu
- **API:** `DELETE /api/caller-leads/[id]`
- **Auth:** `requireRoles(["admin"])` — newer helper WITH revocation-cache check
- **Org isolation:** Yes — `WHERE id = $1 AND organization_id = $2`
- **No row lock, no booking check, no R2 cleanup**
- **Scope:** Only deletes `caller_follow_ups` + `caller_leads`; may also delete the parent `upload_batch` if all batch members are gone

### 1D. Dashboard Employee Page
- **UI:** `src/app/dashboard/page.tsx` — admin-only, same handlers as 1A/1B

**Summary:** All deletion paths are admin-only. No non-admin role can delete leads.

---

## 2. Shared Deletion Library

**File:** `src/lib/leadDeletion.ts` (708 lines)

This is the single source of truth for lead deletion logic, consumed by both single and bulk delete endpoints.

### 2A. Deletion Order (inside transaction)

```
Step 0:  cancelBookingsForLead()          — marks bookings Cancelled, releases inventory units, writes booking_history
Step 1:  cp_commissions                   — DELETE via booking_id subquery (RESTRICT FK to booking_applications)
Step 2:  inventory_units.booking_id       — SET NULL (RESTRICT FK, redundant safety net)
Step 3:  follow_up_attachments            — DELETE via follow_up_id subquery (no FK, would orphan)
Step 4:  LEAD_RELATED_DELETES loop (26 tables in strict order):
         disbursement_tranches → financial_adjustments → loan_applications →
         booking_documents → booking_forms → booking_applications →
         customer_documents → lead_documents → uploaded_documents → loan_updates →
         follow_ups → notes → lead_notes → site_visits → whatsapp_logs →
         email_history → call_history → reminders → lead_reminders →
         notification_records → notifications → ai_conversations →
         audit_references → employee_assignments → lead_assignment_logs →
         employee_activity_logs → bookings → customers
Step 5:  Inventory NULLs (inventory_units.lead_id, held_for_lead_id; inventory_cost_sheets.lead_id; inventory_offers.lead_id)
Step 6:  employee_live_state              — NULL active_lead_id + active_lead_name
Step 7:  DELETE walkin_enquiries           — WHERE id=$1 AND organization_id=$2
Step 8:  recalculateSrNos()               — reindex lead numbers (single-delete only; bulk defers to end)
```

### 2B. R2 Asset Cleanup

**Function:** `deleteLeadAssets()` (lines 353-440)

Collects R2 keys from:
- 5 document tables (booking_documents, uploaded_documents, lead_documents, customer_documents, booking_forms)
- booking_applications URL columns (aadhaar, PAN, signature, PDF keys)
- follow_up_attachments.r2_object_key (via subquery through follow_ups)
- 8 prefix-based listings (`leads/{id}/`, `lead-assets/{id}/`, etc.)
- Booking number prefixes (`bookings/{bookingNumber}/`)

**Execution order:** R2 deletion happens BEFORE database deletion in single-delete. If DB step fails after R2 succeeds, files are gone but data remains (partial cleanup).

### 2C. Audit Logging

**Table:** `lead_deletion_audit_logs` (auto-created via `ensureLeadDeletionAuditTable()`)

| Column | Type | Content |
|--------|------|---------|
| admin_id | TEXT | Deleting admin's user ID |
| admin_name | TEXT | Admin's display name |
| lead_id | INTEGER | Deleted lead's ID |
| lead_number | TEXT | Sr. No (customer-visible) |
| customer_name | TEXT | Lead's name |
| deleted_at | TIMESTAMPTZ | Deletion timestamp |
| reason | TEXT | Optional reason (max 500 chars) |
| deleted_file_count | INTEGER | R2 files removed |
| deleted_local_file_count | INTEGER | Local files removed |
| deleted_records | JSONB | `{table_name: row_count, ...}` |

Also writes to `admin_audit_logs.action` if that table exists.

---

## 3. Complete FK Dependency Map

### 3A. Tables with FK to walkin_enquiries — Handled by leadDeletion.ts

| Table | FK Column | ON DELETE | Handling |
|-------|-----------|-----------|----------|
| follow_ups | lead_id | CASCADE | Explicit DELETE in loop |
| site_visits | lead_id | CASCADE | Explicit DELETE in loop |
| whatsapp_logs | lead_id | CASCADE | Explicit DELETE in loop |
| cp_assignment_history | lead_id | CASCADE | Implicit (DB handles) |
| loan_applications | lead_id | CASCADE | Explicit DELETE in loop |
| booking_documents | lead_id | CASCADE | Explicit DELETE in loop |
| booking_forms | lead_id | CASCADE | Explicit DELETE in loop |
| booking_applications | lead_id | NO ACTION (RESTRICT) | Explicit DELETE after children cleared |
| lead_reminders | lead_id | RESTRICT (no clause) | Explicit DELETE in loop |
| financial_adjustments | lead_id | RESTRICT | Explicit DELETE in loop |
| disbursement_tranches | lead_id | (no FK) | Explicit DELETE in loop |
| loan_updates | lead_id | (no FK) | Explicit DELETE in loop |
| lead_assignment_logs | lead_id | (no FK) | Explicit DELETE in loop |
| inventory_units | lead_id | RESTRICT | SET NULL |
| inventory_units | held_for_lead_id | RESTRICT | SET NULL |
| inventory_cost_sheets | lead_id | RESTRICT | SET NULL |
| inventory_offers | lead_id | RESTRICT | SET NULL |
| bolna_calls | lead_id | SET NULL | DB handles automatically |
| call_sessions | lead_id | SET NULL | DB handles automatically |
| historical_booking_claims | lead_id | SET NULL | DB handles automatically |

### 3B. Tables with FK — NOT in leadDeletion.ts (Gaps)

| Table | FK Column | ON DELETE | Risk |
|-------|-----------|-----------|------|
| walk_in_sequential_queue | lead_id | CASCADE | **Safe** — DB auto-deletes |
| inventory_unit_waitlist | lead_id | CASCADE | **Safe** — DB auto-deletes |
| **walkin_enquiries** | **returning_from_lead_id** | **RESTRICT (no clause)** | **BUG — blocks deletion if another lead references this one as a returning lead** |

### 3C. Tables in LEAD_RELATED_DELETES Without Actual FK

These are cleaned up defensively (safe if table doesn't exist):

| Table | Status |
|-------|--------|
| notes, lead_notes | May not exist in all environments |
| notification_records, notifications | Server-derived system; tables may be empty |
| ai_conversations | AI chat history |
| audit_references | Cross-reference records |
| employee_assignments | Assignment tracking |
| bookings, customers | Legacy tables (may be empty) |

---

## 4. Identified Risks and Bugs

### CRITICAL

#### 4.1 `returning_from_lead_id` RESTRICT FK Blocker
- **Migration:** `2026-09-01_returning_lead_classification.sql:12`
- **Schema:** `ADD COLUMN returning_from_lead_id INTEGER REFERENCES walkin_enquiries(id)` — no ON DELETE clause = RESTRICT
- **Impact:** If Lead B has `returning_from_lead_id = Lead A.id`, deleting Lead A will fail with FK violation
- **Not handled:** `returning_from_lead_id` is not in `LEAD_RELATED_DELETES` and not NULL'd before deletion
- **Fix:** Add `UPDATE walkin_enquiries SET returning_from_lead_id = NULL WHERE returning_from_lead_id = $1` before the final DELETE

#### 4.2 R2 Before DB — Partial Cleanup on DB Failure
- **Scenario:** `deleteLeadAssets()` succeeds (R2 files deleted), then `deleteLeadDatabaseRecords()` fails
- **Result:** Files permanently deleted, but lead + all DB records still exist; no way to re-download deleted documents
- **Current mitigation:** Single-delete returns status `"asset-failed"` if R2 fails, preventing DB deletion. But DB failure AFTER R2 success has no mitigation.
- **Fix:** Either (a) move R2 deletion after DB commit, or (b) use soft-delete markers on R2 objects with deferred purge

### HIGH

#### 4.3 Call Session Recordings Orphaned in R2
- **Table:** `call_sessions` has `recording_r2_key` column storing R2 keys for call recordings
- **ON DELETE:** SET NULL (lead_id becomes NULL, but session row + recording_r2_key survive)
- **Not in KNOWN_ASSET_TABLES:** `call_sessions` is not scanned by `deleteLeadAssets()`
- **Impact:** Recording files accumulate in R2 with no way to trace them back to a lead
- **Fix:** Either add `call_sessions` to KNOWN_ASSET_TABLES, or accept orphaning (recordings have independent value)

#### 4.4 Legacy Auth on Deletion Endpoints (No Revocation Check)
- **Single delete + bulk delete** use `requireRole(["admin"])` — the legacy helper in `serverAuth.ts:267`
- **Caller-lead delete** uses `requireRoles(["admin"])` — the newer helper WITH revocation-cache
- **Impact:** If an admin's session is revoked, they can still call single/bulk delete until the JWT expires
- **Fix:** Migrate single/bulk delete to `requireRoles()` or `requireSession()` + role check

#### 4.5 Historical Metrics Retroactively Affected
- All analytics/reporting queries compute from raw tables at request time
- Deleting a lead retroactively changes historical totals (monthly lead counts, revenue sums, conversion rates)
- No pre-computed snapshots or metrics tables exist
- **Mitigation:** The `lead_deletion_audit_logs.deleted_records` JSONB preserves row counts, but not the actual metric values

### MEDIUM

#### 4.6 No Rate Limiting on Deletion Endpoints
- Neither single nor bulk delete has rate limiting or abuse throttling
- An admin session could theoretically delete all leads in rapid succession
- Bulk delete caps at 100 per request, but nothing prevents repeated requests
- **Mitigation:** Audit log captures every deletion; the confirmation dialog adds friction

#### 4.7 WhatsApp Message Delivery Status Orphaning
- `whatsapp_logs` CASCADE deletes when lead is deleted
- If the two-way `whatsapp_messages` table stores `whatsapp_message_id` (Meta WAMID), future delivery status webhooks cannot correlate back
- **Impact:** Delivery receipts for deleted leads' messages will fail to match

#### 4.8 Bolna Call Context Loss
- `bolna_calls.lead_id` is SET NULL on deletion
- Call recordings, transcripts, and metadata survive but lose lead context
- The `bolna.webhook.ts` handler may fail to resolve organization for future webhook callbacks if the lead was the only tenant identifier

### LOW

#### 4.9 Employee Activity Logs Deleted
- `employee_activity_logs` with this lead_id are permanently deleted
- No historical record of employee actions on the lead survives (except the audit log summary)
- This is by design (the lead never existed), but may affect employee performance reviews

#### 4.10 Notification Feed Derivation
- Notification system is server-derived (no table)
- Deleting the lead removes the source data, so notifications referencing it simply stop appearing
- No orphan risk, but users may lose context about past notifications

---

## 5. Transaction & Error Handling Summary

| Aspect | Single Delete | Bulk Delete | Caller Lead Delete |
|--------|--------------|-------------|-------------------|
| Transaction | Full wrap | Full wrap + per-lead SAVEPOINT | Full wrap |
| Row lock | FOR UPDATE | FOR UPDATE | None |
| R2 cleanup | Yes (before DB) | Yes (per-lead, before DB) | None |
| Local file cleanup | Yes | Yes | None |
| Booking cancellation | Yes (Step 0) | Yes (Step 0 per lead) | N/A |
| Audit log | lead_deletion_audit_logs + admin_audit_logs | Same, per lead | None |
| On failure | Full rollback, 500 | ROLLBACK TO SAVEPOINT, continue batch | Full rollback, 500 |
| Sr.No recalc | Per-delete | Once after batch | N/A |

---

## 6. Test Coverage

**Existing tests:** `src/lib/__tests__/leadDeletion.fk-ordering.test.ts`
- 2 test cases covering FK ordering regression
- Requires `LEAD_DELETION_TEST_DATABASE_URL` (skipped without it)
- Tests: (1) lead with all RESTRICT-FK dependents, (2) lead with lead_reminders only
- Validates: no FK violation, correct row deletion, inventory units preserved with NULLed refs, isolation (other leads untouched)

**Not tested:**
- `returning_from_lead_id` RESTRICT blocker (Bug 4.1)
- R2 asset cleanup correctness
- Bulk delete SAVEPOINT rollback behavior
- Caller lead deletion
- Concurrent deletion race conditions

---

## 7. Phase 2 Recommendations

### P0 — Must Fix Before Next Release

1. **Fix `returning_from_lead_id` RESTRICT blocker** (Bug 4.1)
   - Add to LEAD_RELATED_DELETES or add explicit NULL-out before final DELETE
   - Add regression test

2. **Migrate deletion auth to `requireRoles()`** (Bug 4.4)
   - Replace `requireRole(["admin"])` with `requireRoles(["admin"])` in both walkin_enquiries DELETE and bulk-delete

### P1 — Should Fix

3. **Reorder R2 deletion after DB commit** (Bug 4.2)
   - Move `deleteLeadAssets()` call to after the transaction commits
   - Accept that DB failure leaves files (they can be retried), rather than DB success leaving no files

4. **Add `call_sessions` to R2 asset cleanup** (Bug 4.3)
   - Either add to KNOWN_ASSET_TABLES with `recording_r2_key` column, or add explicit cleanup

5. **Add rate limiting** (Bug 4.6)
   - Simple per-admin rate limit (e.g., max 500 deletions per hour)

### P2 — Consider

6. **Historical metrics preservation** (Bug 4.5)
   - Consider a pre-deletion metrics snapshot in `lead_deletion_audit_logs`
   - Or implement soft-delete with a configurable retention period

7. **WhatsApp/Bolna cleanup** (Bugs 4.7, 4.8)
   - Document the expected behavior (delivery receipts lost, call context lost)
   - Or preserve minimal reference data in the audit log JSONB

8. **Expand test coverage**
   - Add `returning_from_lead_id` regression test
   - Add R2 mock tests
   - Add bulk delete SAVEPOINT test
   - Add concurrent deletion test

---

## Appendix A: File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/leadDeletion.ts` | 1-708 | Shared deletion library (all logic) |
| `src/lib/__tests__/leadDeletion.fk-ordering.test.ts` | 1-408 | FK ordering regression tests |
| `src/app/api/walkin_enquiries/[id]/route.ts` | 384-533 | Single-lead DELETE handler |
| `src/app/api/walkin_enquiries/bulk-delete/route.ts` | 22-152 | Bulk delete POST handler |
| `src/app/api/caller-leads/[id]/route.ts` | 72-113 | Caller lead DELETE handler |
| `src/lib/serverAuth.ts` | 254-299 | `requireRole()` / `requireRoles()` helpers |
| `src/lib/leadAuth.ts` | 69-116 | `canEditLead()` (not used for deletion) |
| `src/lib/r2.ts` | 1-100 | R2 S3Client, upload/delete/list functions |
| `src/lib/tenantContext.ts` | — | `getOrganizationId()` for org scoping |
| `src/lib/inventorySync.ts` | — | `releaseUnitForBooking()` for unit release |
| `src/components/PermanentLeadDeleteDialog.tsx` | — | Single-delete confirmation UI |
| `src/components/BulkDeleteLeadsDialog.tsx` | — | Bulk-delete confirmation UI |
| `src/components/Enquiryoverviewsection.tsx` | 631 | Context menu delete trigger |
| `src/app/dashboard/page.tsx` | 1756-1841 | Dashboard delete handlers |
| `scripts/migrations/2026-08-18_neon_full_schema_sync.sql` | — | Primary FK definitions |
| `scripts/migrations/2026-09-01_returning_lead_classification.sql` | 12 | returning_from_lead_id FK |
| `scripts/migrations/2026-09-02_lead_reminders.sql` | 13 | lead_reminders FK |
| `scripts/migrations/2026-09-06_call_sessions.sql` | 19 | call_sessions FK (SET NULL) |
| `scripts/migrations/2026-10-10_walk_in_sequential_queue.sql` | 29 | queue FK (CASCADE) |
| `scripts/migrations/2026-10-20_inventory_unit_waitlist.sql` | 16 | waitlist FK (CASCADE) |
