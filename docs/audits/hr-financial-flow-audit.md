# Full CRM Financial Flow Audit — Brokerage, Payroll, Incentives & Employee Expenses

**Audit Date:** 2026-10-19
**Auditor:** Claude Opus 4.6
**Scope:** End-to-end financial data flows across Revenue Intelligence, Brokerage, Payroll, Incentives, Resource Expenses, and HR Profitability Dashboard

---

## A. Executive Summary

The BhoomiDwellers CRM has a well-architected financial system with clear separation of concerns. However, **one critical blocker** prevents the HR Financial Overview from reporting trustworthy profitability: the brokerage and resource expense tables (`booking_brokerage`, `project_brokerage_config`, `employee_resource_expenses`, `brokerage_audit_log`) have **not been migrated to production Neon (ep-long-cloud)**. All profitability metrics currently fall back to zero.

**Top risks:**
1. **Migration blocker** — 4 tables pending on production; all brokerage and resource expense features return fallback zeros.
2. **No transaction wrapper on payroll adjustments** — multi-step INSERT + UPDATE sequence can partially fail.
3. **Incentives are manual-only** — no automatic calculation from booking events; relies entirely on HR data entry.
4. **No automatic brokerage on booking creation** — brokerage must be manually applied per-booking after setting default rates.
5. **Security info-disclosure** — `/api/_envcheck` diagnostic endpoint still deployed.

**What works end-to-end (post-migration):**
- Booking creation → Revenue Intelligence → HR booking list ✓
- Brokerage config → rate precedence → calculation → collection tracking → profitability ✓
- Salary config → payroll generation → approval → employee costs ✓
- Resource expense entry → allocation → profitability costs ✓
- Tenant isolation on all financial routes ✓

---

## B. Architecture and Dependency Map

### B.1 Booking → Revenue Intelligence → HR

```
booking_applications (canonical source, 121 columns)
├── booking_financials (token, OCR, cash)
├── booking_loan_details (sanction, disbursement, bank)
├── booking_registration_details (stamp duty, registration fee)
├── booking_pipeline (stage tracking)
├── customer_ledger_view (derived: gross_collection, developer_revenue, outstanding)
├── booking_total_cost_view (derived: total_cost_to_customer)
├── financial_accounts + financial_ledger (receipt/payment tracking)
└── disbursement_tranches (bank disbursement installments)

Revenue Intelligence (/api/revenue-intelligence)
├── Auth: requireRole(["admin"]) — admin only
├── Status filter: confirmed, approved only
├── Joins: 7 tables (financials, loan, registration, pipeline, ledger view, CP commission)
└── Frontend: RevenueIntelligenceView.tsx

HR Brokerage Center (/api/hr/brokerage-center)
├── Auth: requireRoles(["hr", "admin"])
├── Status filter: excludes cancelled only (wider than Revenue Intelligence)
├── Joins: 6 tables (financials, loan, registration, walkin_enquiries, booking_brokerage)
└── Frontend: HRBrokerageCenter.tsx
```

### B.2 Brokerage Configuration → Calculation → Collection → Profitability

```
organization_settings
├── default_brokerage_rate, default_brokerage_method, brokerage_calculation_basis
│
project_brokerage_config
├── Per-project rate overrides (effective_from/to dated)
│
POST /api/hr/booking-brokerage  (Apply brokerage to a booking)
├── Rate precedence: explicit param > project override > global default
├── Basis: agreement_value | booking_amount | ocr_amount | disbursement_amount
├── Calculation: percentage → base_value × rate / 100; fixed → rate as amount
├── Creates: booking_brokerage row (status=expected, source=precedence_level)
├── Snapshots: agreement_value_snapshot + calculation_basis at creation time
└── Audit: brokerage_audit_log entry

PATCH /api/hr/booking-brokerage/[id]  (Mark received / update)
├── Status transitions: expected → received | partially_received | pending | reversed
├── Recalculates brokerage_amount if rate/method changed
└── Audit: brokerage_audit_log entry

GET /api/hr/profitability  (Dashboard aggregation)
├── Brokerage revenue = SUM(brokerage_amount) WHERE status IN (received, partially_received, expected)
├── Received = SUM(received_amount)
├── Pending = totalRevenue - received
└── Expected = SUM WHERE status = 'expected'
```

### B.3 Payroll → Employee Costs → Profitability

```
employee_salary_history (effective-dated salary records)
│
payrollEngine.ts (generation)
├── For each active employee:
│   ├── Fetch salary (latest effective in period)
│   ├── Attendance (DISTINCT dates from attendance_records, IST timezone)
│   ├── Leave days (approved employee_leave_records)
│   ├── Week-offs (employee_week_off_pattern)
│   ├── Holidays (organization_holidays)
│   ├── Approved incentives → added as payroll_adjustments (source='incentive')
│   └── Creates payroll_records row (gross_salary + total_additions - total_deductions = net_payable)
│
Approval flow:
├── HR submit: draft → submitted (cascades records)
├── Admin approve: submitted → approved (cascades records)
├── Admin reject: submitted → rejected → draft (for re-editing)
│
GET /api/hr/profitability
├── Employee costs = SUM(gross_salary + total_additions)
│   FROM payroll_records WHERE period status IN (approved, submitted)
└── Period matching: period_year * 100 + period_month for date range
```

### B.4 Incentives → Payroll → Employee Costs

```
employee_incentives (manual HR entry)
├── Status: pending → approved → paid (or → reversed)
├── Optional booking_id link (dedup constraint per employee+booking)
├── Audit: employee_incentive_history (immutable)
│
Payroll inclusion:
├── At generation time: approved incentives in period → payroll_adjustments (source='incentive')
├── Appear in payroll_records.total_additions
└── Flow into employee costs via profitability query
```

### B.5 Resource Expenses → Profitability

```
employee_resource_expenses
├── Types: phone, laptop, furniture, travel, software, other
├── Allocation: one_time (full cost at purchase_date) | monthly (spread over N months)
├── Classification: is_company_expense (true = counted in profitability)
│
GET /api/hr/profitability
├── One-time: purchase_cost if purchase_date in [from, to]
├── Monthly: monthly_amount × months_overlapping_range
└── Only active + is_company_expense = true
```

---

## C. Completion Matrix

| Module | Flow | Status | Evidence |
|--------|------|--------|----------|
| Booking creation | POST /api/booking-applications → 10+ tables | **WORKING** | Transaction-wrapped, tenant-scoped, audit-logged |
| Booking editing | PUT /api/booking-applications/[id] → UPSERT sub-tables | **WORKING** | Handles flat changes, status transitions, milestones |
| Revenue Intelligence | GET /api/revenue-intelligence → dashboard | **WORKING** | 7-table CTE, admin-only, confirmed+approved filter |
| HR booking list | GET /api/hr/brokerage-center → Management Center | **WORKING** | 6-table join, hr+admin, excludes cancelled |
| Brokerage config (global) | POST /api/hr/brokerage-config → org settings | **PARTIAL** | Code complete; **table columns not migrated to Neon** |
| Brokerage config (project) | POST /api/hr/brokerage-config → project_brokerage_config | **PARTIAL** | Code complete; **table not migrated to Neon** |
| Brokerage apply to booking | POST /api/hr/booking-brokerage | **PARTIAL** | Code complete; **booking_brokerage table not migrated** |
| Brokerage collection tracking | PATCH /api/hr/booking-brokerage/[id] | **PARTIAL** | Checkbox + drawer working in UI; **table not migrated** |
| Brokerage → profitability | profitability route aggregates booking_brokerage | **PARTIAL** | Fallback returns zeros + `_migrationPending: true` |
| Salary configuration | POST /api/hr/employees/[id]/salary | **WORKING** | Effective-dated, immutable history, unique active constraint |
| Payroll generation | POST /api/hr/payroll/generate (cron or manual) | **WORKING** | Engine handles attendance, leave, holidays, incentives |
| Payroll approval | PATCH /api/hr/payroll/periods/[id] | **WORKING** | HR submit → admin approve; separation of duties |
| Payroll → employee costs | profitability sums approved/submitted records | **WORKING** | Uses gross_salary + total_additions |
| Payroll adjustments | POST /api/hr/payroll/records/[id]/adjustments | **BROKEN** | Multi-step writes **not wrapped in transaction** |
| Payroll payments | POST /api/hr/payroll/records/[id]/payments | **WORKING** | Admin-only, unique payment reference, dedup constraint |
| Incentive creation | POST /api/hr/employees/[id]/incentives | **WORKING** | Manual entry, optional booking link, dedup constraint |
| Incentive approval | PATCH /api/hr/employees/[id]/incentives/[incId] | **WORKING** | approve/reverse/adjust with row locking + audit |
| Incentive → payroll | payrollEngine includes approved incentives as additions | **WORKING** | source='incentive' adjustments auto-created |
| Incentive → profitability | Via payroll_records.total_additions | **WORKING** | No double-counting (incentives only enter via payroll) |
| Resource expense CRUD | /api/hr/resource-expenses | **PARTIAL** | Code complete; **table not migrated to Neon** |
| Resource expense → profitability | profitability route aggregates expenses | **PARTIAL** | Fallback returns zeros when table missing |
| HR Financial Overview | GET /api/hr/profitability | **PARTIAL** | Booking counts work; brokerage + resources return zeros pre-migration |
| Profitability chart | Monthly revenue vs costs (6 months) | **PARTIAL** | Revenue side zeros pre-migration; payroll costs work |
| Employee profitability | Top 20 by net contribution | **PARTIAL** | Brokerage side zeros pre-migration |
| Audit logging (brokerage) | brokerage_audit_log with old/new JSONB | **PARTIAL** | Code complete; **table not migrated** |
| Audit logging (payroll) | None | **UNWIRED** | No per-change audit trail for payroll edits |
| Audit logging (resource expenses) | created_by + timestamps only | **UNWIRED** | No before/after change log |
| Automatic brokerage on booking | N/A | **UNWIRED** | Must manually apply via UI or API per booking |
| Automatic incentive calculation | N/A | **UNWIRED** | All incentives require manual HR entry |
| Booking cancellation → brokerage | N/A | **UNWIRED** | Cancelling a booking does not auto-reverse brokerage |

---

## D. Findings

### D.1 — CRITICAL: Profitability migration not applied to Neon

- **Severity:** Critical
- **Status:** PARTIAL
- **Files:** `scripts/migrations/2026-10-18_hr_profitability_production.sql`
- **Tables:** booking_brokerage, project_brokerage_config, employee_resource_expenses, brokerage_audit_log, organization_settings (3 new columns)
- **Root cause:** Migration file exists but has not been executed against ep-long-cloud
- **Business impact:** All brokerage revenue, resource costs, and profitability metrics show ₹0 in production. Booking counts work via fallback.
- **Fix:** Apply `2026-10-18_hr_profitability_production.sql` to ep-long-cloud via Neon SQL Editor. All statements use IF NOT EXISTS — safe to run.
- **Dependencies:** None; all FK targets (users, organizations, booking_applications) already exist.

### D.2 — BROKEN: Payroll adjustments not wrapped in transaction

- **Severity:** High
- **Status:** BROKEN
- **Files:** `src/app/api/hr/payroll/records/[id]/adjustments/route.ts` (lines 74–111)
- **Tables:** payroll_adjustments, payroll_records, payroll_periods
- **Root cause:** Three sequential `query()` calls (INSERT adjustment → SELECT totals → UPDATE record → UPDATE period) without `transaction()` wrapper
- **Business impact:** If any query fails mid-sequence, adjustment row exists but record/period totals are stale. No rollback mechanism.
- **Fix:** Wrap the 4 queries in `transaction(async (client) => { ... })`, using `client.query()` instead of `query()`.
- **Dependencies:** None.

### D.3 — HIGH: Security info-disclosure endpoint

- **Severity:** High
- **Status:** BROKEN
- **Files:** `src/app/api/_envcheck/route.ts`
- **Root cause:** Temporary diagnostic endpoint that reveals SESSION_SECRET presence and length
- **Business impact:** Information disclosure; aids session-forgery attacks
- **Fix:** Delete the file.
- **Dependencies:** None.

### D.4 — HIGH: No automatic brokerage reversal on booking cancellation

- **Severity:** High
- **Status:** UNWIRED
- **Files:** `src/app/api/booking-applications/[id]/route.ts` (PUT handler, status change logic)
- **Tables:** booking_brokerage
- **Root cause:** When booking_status changes to 'cancelled', no code checks for or reverses the corresponding booking_brokerage record
- **Business impact:** Cancelled bookings continue to show as "expected" brokerage revenue, inflating profitability.
- **Fix:** In the PUT handler, when status → cancelled: PATCH booking_brokerage SET status='reversed', reversal_reason='Booking cancelled'.
- **Dependencies:** Requires booking_brokerage table to exist (migration D.1).

### D.5 — MEDIUM: Payroll record PATCH not in transaction

- **Severity:** Medium
- **Status:** BROKEN
- **Files:** `src/app/api/hr/payroll/records/[id]/route.ts`
- **Root cause:** PATCH updates record fields then separately updates period totals — two queries, no transaction
- **Business impact:** Period totals could drift from record sums if second query fails
- **Fix:** Wrap in `transaction()`.

### D.6 — MEDIUM: Resource expense edits lack audit trail

- **Severity:** Medium
- **Status:** UNWIRED
- **Files:** `src/app/api/hr/resource-expenses/[id]/route.ts`
- **Tables:** employee_resource_expenses
- **Root cause:** PATCH and DELETE update rows in-place with only `updated_at` timestamp; no before/after log
- **Business impact:** Cannot trace who changed an expense amount or wrote it off
- **Fix:** Add entries to brokerage_audit_log (entity_type='resource_expense') or create a dedicated audit table.

### D.7 — MEDIUM: Silent error catches mask migration failures

- **Severity:** Medium
- **Status:** PARTIAL
- **Files:** 48+ instances across `/api/hr/*` routes, HRConnect.tsx, HRBrokerageConfig.tsx
- **Root cause:** `catch { /* silent */ }` or `catch {}` patterns swallow errors
- **Business impact:** Schema mismatches, missing tables, and query failures are invisible
- **Fix:** Replace with `catch (e) { console.error("[route-name]", e); }` at minimum.

### D.8 — MEDIUM: booking_brokerage.calculation_basis CHECK constraint too narrow

- **Severity:** Medium
- **Status:** PARTIAL
- **Files:** `scripts/migrations/2026-10-18_hr_profitability_production.sql`
- **Root cause:** The `calculation_basis` column on `booking_brokerage` table has CHECK constraint `IN ('agreement_value', 'booking_amount')` but the org settings and API now support 4 values including `ocr_amount` and `disbursement_amount`
- **Business impact:** If admin sets basis to `ocr_amount`, the INSERT into booking_brokerage will fail the CHECK constraint
- **Fix:** The migration already handles DROP + re-ADD for the org_settings constraint; need to also update booking_brokerage.calculation_basis CHECK.

### D.9 — MEDIUM: requireRole vs requireRoles return type inconsistency

- **Severity:** Medium
- **Status:** PARTIAL
- **Files:** `src/lib/serverAuth.ts`
- **Root cause:** `requireRole()` returns `{ isAuthorized, session, error, status }` while `requireRoles()` returns `{ ok, response, session, userId }`. Different calling conventions.
- **Business impact:** Developer confusion; Revenue Intelligence uses requireRole, HR uses requireRoles — mixing them causes runtime errors
- **Fix:** Deprecate requireRole() and migrate all callers to requireRoles().

### D.10 — LOW: Super Admin module uses hardcoded mock data

- **Severity:** Low
- **Status:** PARTIAL
- **Files:** `src/components/superadmin/mockData.ts`
- **Root cause:** Phase 1 placeholder; 6 mock orgs, 9 mock users, 6 mock activities
- **Business impact:** Super Admin dashboard shows fake data, not real tenant data
- **Fix:** Phase 2 replacement — wire to actual database queries.

### D.11 — LOW: No payroll change audit trail

- **Severity:** Low
- **Status:** UNWIRED
- **Files:** `src/app/api/hr/payroll/records/[id]/route.ts`
- **Root cause:** PATCH updates payroll_records but does not log old/new values
- **Business impact:** Cannot trace who edited a salary figure or why
- **Fix:** Add audit log entries (model after brokerage_audit_log pattern).

---

## E. Financial Reconciliation

### E.1 Booking Count Reconciliation

| Source | Filter | Expected Count |
|--------|--------|---------------|
| Revenue Intelligence | confirmed + approved | Subset of all bookings |
| HR Brokerage Center | excludes cancelled only | Wider than Revenue Intelligence |
| HR Profitability (all-time) | excludes cancelled | Same as Brokerage Center |
| booking_applications table | all statuses | Total including cancelled |

**Finding:** Revenue Intelligence shows fewer bookings than HR because it excludes pending/draft. This is **by design** — Revenue Intelligence tracks confirmed revenue only, while HR tracks all non-cancelled bookings for brokerage planning. The counts are consistent within their respective filters.

### E.2 Brokerage Revenue vs Property Payment Revenue

**These are correctly separated:**
- **Brokerage revenue** = commission from booking_brokerage table (what the firm earns)
- **Property payment revenue** = OCR, disbursement, registration from booking sub-tables (what the customer pays the developer)
- **Profitability uses brokerage revenue only** — property payments are contextual data shown in the detail drawer but never added to brokerage totals

### E.3 Employee Cost Components

```
Total Employee Costs = Payroll Costs + Resource Costs

Payroll Costs = SUM(gross_salary + total_additions)
  where total_additions includes:
    - Manual adjustments (source='manual')
    - Approved incentives (source='incentive')
    - System adjustments (source='system')

Resource Costs = SUM(
  one_time: purchase_cost if in date range
  monthly: monthly_amount × overlapping months
) WHERE is_company_expense = true AND status = 'active'
```

**Finding:** No double-counting risk identified:
- Incentives enter costs only via payroll_adjustments (never counted separately in profitability)
- Resource expenses are filtered by `is_company_expense = true` (personal expenses excluded)
- Written-off expenses (`status = 'written_off'`) are excluded from totals

### E.4 Profitability Formula Verification

```
Net Operating Contribution = Recognized Brokerage Revenue − Total Employee Costs
Profit Margin = (Net Contribution / Recognized Brokerage Revenue) × 100
```

**Verified:** The formula in `profitability/route.ts` (lines 93-96) correctly implements this. Division-by-zero is handled (returns 0 when revenue is 0). Rounding uses `Math.round(... * 10000) / 100` for 2 decimal places.

**Risk:** "Recognized Brokerage Revenue" currently includes `expected` status bookings alongside `received` and `partially_received`. This means **uncommitted expected brokerage inflates the revenue number**. Consider distinguishing "recognized" (received only) from "pipeline" (expected + partially_received).

---

## F. Prioritized Remediation Plan

### Priority 1 — Critical Financial Correctness & Security

| # | Action | Files | Effort |
|---|--------|-------|--------|
| F.1 | Apply profitability migration to Neon ep-long-cloud | `2026-10-18_hr_profitability_production.sql` | 5 min |
| F.2 | Delete `_envcheck` diagnostic endpoint | `src/app/api/_envcheck/route.ts` | 1 min |
| F.3 | Fix booking_brokerage.calculation_basis CHECK constraint to include all 4 values | Migration SQL | 5 min |

### Priority 2 — Broken API/Database Integrations

| # | Action | Files | Effort |
|---|--------|-------|--------|
| F.4 | Wrap payroll adjustments in transaction() | `src/app/api/hr/payroll/records/[id]/adjustments/route.ts` | 15 min |
| F.5 | Wrap payroll record PATCH in transaction() | `src/app/api/hr/payroll/records/[id]/route.ts` | 15 min |
| F.6 | Auto-reverse brokerage on booking cancellation | `src/app/api/booking-applications/[id]/route.ts` | 30 min |

### Priority 3 — Missing Workflow Connections

| # | Action | Files | Effort |
|---|--------|-------|--------|
| F.7 | Add audit logging for resource expense changes | `src/app/api/hr/resource-expenses/[id]/route.ts` | 30 min |
| F.8 | Add audit logging for payroll record changes | `src/app/api/hr/payroll/records/[id]/route.ts` | 30 min |
| F.9 | Replace silent catch blocks with proper error logging | 48+ files | 1 hour |

### Priority 4 — UI and Reporting Inconsistencies

| # | Action | Files | Effort |
|---|--------|-------|--------|
| F.10 | Separate "recognized" (received) from "pipeline" (expected) brokerage in profitability KPIs | `profitability/route.ts`, `HRProfitability.tsx` | 1 hour |
| F.11 | Deprecate requireRole() in favor of requireRoles() | `src/lib/serverAuth.ts` + callers | 2 hours |
| F.12 | Replace super admin mock data with real database queries | `src/components/superadmin/` | 2 hours |

### Priority 5 — Performance and Maintainability

| # | Action | Files | Effort |
|---|--------|-------|--------|
| F.13 | Add test coverage for HR payroll and brokerage API routes | New test files | 4 hours |
| F.14 | Consider automatic brokerage application on booking creation (event-driven) | booking POST + brokerage POST | 2 hours |
| F.15 | Consider rule-based incentive calculation from booking events | New engine file | 4 hours |

---

## G. Test Evidence and Manual Steps

### G.1 TypeScript Compilation

```
$ npx tsc --noEmit --pretty 2>&1 | grep "^src/app/(api/hr|dashboard/hr)"
(zero output — no errors in HR files)
```

All 16 pre-existing errors are in `src/components/InventoryManagementView.colors.test.tsx` (`.ink` property issue) — unrelated to HR/financial modules.

### G.2 Migration Verification Steps (for Neon ep-long-cloud)

```sql
-- Step 1: Check if tables exist
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('booking_brokerage', 'project_brokerage_config',
                     'employee_resource_expenses', 'brokerage_audit_log');
-- Expected: 0 rows (tables don't exist yet)

-- Step 2: Apply migration
-- Paste contents of scripts/migrations/2026-10-18_hr_profitability_production.sql
-- into Neon SQL Editor and execute

-- Step 3: Verify
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('booking_brokerage', 'project_brokerage_config',
                     'employee_resource_expenses', 'brokerage_audit_log');
-- Expected: 4 rows

-- Step 4: Verify org settings columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'organization_settings'
  AND column_name IN ('default_brokerage_rate', 'default_brokerage_method',
                      'brokerage_calculation_basis');
-- Expected: 3 rows
```

### G.3 Unverified Scenarios (require production access)

1. Whether existing bookings on Neon have matching walkin_enquiries records (sales_manager resolution)
2. Whether approved payroll periods on Neon have correct total_gross values (the SUM bug fix was applied but existing periods may need recalculation)
3. Whether HR Connect migration (`2026-10-18_hr_phase4a_connect.sql`) is applied — memory says applied 2026-10-18 but should verify
4. Whether the CP commission LATERAL join in Revenue Intelligence handles orgs without cp_commissions table gracefully

### G.4 Auth Pattern Summary

| Route Family | Auth Function | Roles | Session Revocation Check |
|---|---|---|---|
| /api/booking-applications/* | requireSession() | Any authenticated | Yes (via requireSession) |
| /api/revenue-intelligence | requireRole(["admin"]) | Admin only | No (legacy pattern) |
| /api/hr/brokerage-center | requireRoles(["hr","admin"]) | HR + Admin | Yes |
| /api/hr/brokerage-config | requireRoles(["hr","admin"]) | HR + Admin | Yes |
| /api/hr/booking-brokerage | requireRoles(["hr","admin"]) | HR + Admin | Yes |
| /api/hr/booking-brokerage/[id] | requireRoles(["hr","admin"]) | HR + Admin | Yes |
| /api/hr/profitability | requireRoles(["hr","admin"]) | HR + Admin | Yes |
| /api/hr/resource-expenses GET | requireRoles(["hr","admin"]) | HR + Admin | Yes |
| /api/hr/resource-expenses POST | requireRoles(["admin"]) | Admin only | Yes |
| /api/hr/payroll/periods | requireRoles(["hr","admin"]) | HR + Admin | Yes |
| /api/hr/payroll/periods/[id] PATCH | requireRoles(["admin"]) for approve | Admin only | Yes |
| /api/hr/payroll/generate | Token OR admin session | Cron/Admin | Partial |

### G.5 Tenant Isolation Verification

All financial API routes verified to include `WHERE organization_id = $orgId` on every query. No cross-tenant IDOR vectors detected. The `getOrganizationId()` function resolves from session claim `org` (signed, never from client input).

---

*End of audit report.*
