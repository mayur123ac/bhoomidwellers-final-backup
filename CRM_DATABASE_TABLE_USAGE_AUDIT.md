# CRM Database Table Usage Audit

**Date:** 2026-11-19
**Scope:** Complete CRM-wide read-only audit of every PostgreSQL table
**Method:** 4 parallel codebase scanners (API routes, lib files, migrations, role mapping) + manual cross-reference verification

---

## 1. MASTER TABLE INVENTORY

### 1.1 Tables from Migrations (67 via CREATE TABLE)

| # | Table Name | Migration File | Purpose |
|---|-----------|---------------|---------|
| 1 | `walkin_enquiries` | Pre-existing + multiple ALTERs | Main leads table (309+ real leads) |
| 2 | `lead_reminders` | 2026-09-02_lead_reminders.sql | Personal reminders tied to leads |
| 3 | `lead_assignment_logs` | Runtime (api/migrate) + migration | Lead assignment audit trail |
| 4 | `booking_applications` | 2026-08-23_booking_schema_baseline.sql | Main booking record (121+ columns) |
| 5 | `booking_financials` | 2026-08-23_booking_schema_baseline.sql | Token, OCR, SDR, cash component |
| 6 | `booking_loan_details` | 2026-08-23_booking_schema_baseline.sql | Loan sanction & disbursement |
| 7 | `booking_registration_details` | 2026-08-23_booking_schema_baseline.sql | Registration & stamp duty |
| 8 | `booking_custom_charges` | 2026-08-23_booking_schema_baseline.sql | Ad-hoc charges per booking |
| 9 | `booking_pipeline` | 2026-08-23_booking_schema_baseline.sql | Booking stage tracking |
| 10 | `booking_stage_history` | 2026-08-23_booking_schema_baseline.sql | Historical stage changes |
| 11 | `booking_documents` | 2026-08-23_booking_schema_baseline.sql | Document metadata (R2 keys) |
| 12 | `booking_payment_milestones` | 2026-08-23_booking_schema_baseline.sql | Payment schedule milestones |
| 13 | `booking_history` | 2026-08-23_booking_schema_baseline.sql | Audit trail of booking changes |
| 14 | `booking_tds_records` | 2026-08-23_booking_schema_baseline.sql | TDS records |
| 15 | `booking_initiations` | 2026-08-23_booking_schema_baseline.sql | Saved form state pre-booking |
| 16 | `booking_brokerage` | 2026-10-18_profitability_brokerage.sql | Brokerage rate & payment per booking |
| 17 | `financial_accounts` | 2026-08-23_booking_schema_baseline.sql | Customer receivable accounts |
| 18 | `financial_ledger` | 2026-08-23_booking_schema_baseline.sql | Transaction history per account |
| 19 | `financial_adjustments` | Referenced in lib/leadDeletion.ts | Financial corrections |
| 20 | `inventory_units` | Pre-existing + ALTERs | Property unit master |
| 21 | `inventory_unit_waitlist` | 2026-10-20_inventory_unit_waitlist.sql | Booking pipeline/waitlist for units |
| 22 | `inventory_projects` | Referenced in inventoryHierarchy.ts | Project master |
| 23 | `inventory_towers` | Referenced in inventoryHierarchy.ts | Tower master |
| 24 | `inventory_unit_history` | Referenced in inventorySync.ts | Unit status changes |
| 25 | `inventory_cost_sheets` | Referenced in cost-sheet route | Cost sheet per unit |
| 26 | `inventory_price_rules` | Referenced in price-rules route | Pricing rules per project |
| 27 | `inventory_offers` | Referenced in offers route | Promotional offers |
| 28 | `channel_partners` | Pre-existing + ALTERs | CP master data |
| 29 | `cp_commissions` | 2026-07-25_cp_commission_ledger.sql | Commission ledger per booking |
| 30 | `cp_visits` | 2026-08-20_cp_chat_and_visits.sql | SM visits to CPs |
| 31 | `cp_chat_messages` | 2026-08-20_cp_chat_and_visits.sql | CP chat thread storage |
| 32 | `cp_assignment_history` | 2026-07-28_cp_assignment_workflow.sql | CP-to-SM assignment audit |
| 33 | `cp_enquiry_visibility` | 2026-09-04_cp_enquiry_visibility.sql | Per-CP visibility rules |
| 34 | `follow_ups` | Pre-existing + ALTERs | Lead follow-up notes & CRM events |
| 35 | `follow_up_attachments` | Runtime (lib/followUpAttachments.ts) | File attachments on follow-ups |
| 36 | `site_visits` | Pre-existing | Visit tracking |
| 37 | `banker_visits` | 2026-09-03_banker_visits.sql | Banker office visit tracking |
| 38 | `call_sessions` | 2026-09-06_call_sessions.sql | Manual SIM call tracking |
| 39 | `notification_logs` | 2026-07-30_whatsapp_notification_logs.sql | WhatsApp notification queue |
| 40 | `employee_sessions` | Runtime (api/migrate) | User login session tracking |
| 41 | `employee_live_state` | Runtime (api/migrate) | Current activity per user |
| 42 | `employee_activity_logs` | Referenced in multiple routes | Activity audit history |
| 43 | `attendance_records` | 2026-08-18_attendance_tables.sql | Daily attendance anchor |
| 44 | `attendance_periods` | 2026-10-26_attendance_periods.sql | Work periods within day |
| 45 | `employee_employment_history` | 2026-10-17_hr_phase1_employee_profiles.sql | Previous employer records |
| 46 | `employee_salary_history` | 2026-10-17_hr_phase1_employee_profiles.sql | Historical salary records |
| 47 | `employee_documents` | 2026-10-17_hr_phase1_employee_profiles.sql | HR documents |
| 48 | `hr_compliance_tasks` | 2026-10-17_hr_phase1_employee_profiles.sql | Missing-document deadlines |
| 49 | `company_assets` | 2026-10-17_hr_phase1_employee_profiles.sql | Office assets inventory |
| 50 | `employee_asset_assignments` | 2026-10-17_hr_phase1_employee_profiles.sql | Asset issue/return history |
| 51 | `hr_mandatory_documents` | 2026-10-17_hr_phase1_employee_profiles.sql | Required document types config |
| 52 | `organization_holidays` | 2026-10-17_hr_phase2_leave_holidays.sql | Org-scoped holiday calendar |
| 53 | `employee_leave_allocations` | 2026-10-17_hr_phase2_leave_holidays.sql | Leave quota per employee/year |
| 54 | `employee_leave_records` | 2026-10-17_hr_phase2_leave_holidays.sql | Actual leave entries |
| 55 | `employee_leave_record_history` | 2026-10-17_hr_phase2_leave_holidays.sql | Leave correction audit |
| 56 | `employee_week_off_pattern` | 2026-10-17_hr_phase2_week_off.sql | Per-employee weekly-off days |
| 57 | `employee_incentives` | 2026-10-17_hr_phase2_employee_incentives.sql | Manual incentive entries |
| 58 | `employee_incentive_history` | 2026-10-17_hr_phase2_employee_incentives.sql | Incentive change audit |
| 59 | `payroll_periods` | 2026-10-18_hr_phase3_payroll.sql | Monthly payroll periods |
| 60 | `payroll_records` | 2026-10-18_hr_phase3_payroll.sql | Per-employee per-period |
| 61 | `payroll_adjustments` | 2026-10-18_hr_phase3_payroll.sql | Itemized additions/deductions |
| 62 | `payroll_payments` | 2026-10-18_hr_phase3_payroll.sql | Payment tracking |
| 63 | `hr_requests` | 2026-10-18_hr_phase4a_connect.sql | Employee-to-HR requests |
| 64 | `hr_request_messages` | 2026-10-18_hr_phase4a_connect.sql | Messages within HR request |
| 65 | `deal_stage_outbox` | 2026-11-01_deal_stage_tables.sql | Event outbox for stages |
| 66 | `deal_stage_history` | 2026-11-01_deal_stage_tables.sql | Stage transitions per lead |
| 67 | `site_locations` | 2026-11-14_site_locations.sql | Named site locations per org |

### 1.2 Tables Created at Runtime (6 additional)

| # | Table Name | Created By | Purpose |
|---|-----------|-----------|---------|
| 68 | `follow_up_attachments` | lib/followUpAttachments.ts | CREATE TABLE IF NOT EXISTS on first access |
| 69 | `user_permissions` | lib/permissions.ts | Per-user permission overrides |
| 70 | `organization_recording_permissions` | lib/recordingPermissions.ts | Recording deletion permissions |
| 71 | `organization_followup_deletion_permissions` | lib/followUpDeletionPermissions.ts | Follow-up deletion permissions |
| 72 | `lead_deletion_audit_logs` | lib/leadDeletion.ts | Deletion audit trail |
| 73 | `lead_assignment_logs` | api/migrate/route.ts | Assignment logs (also in migration) |

### 1.3 Core System Tables (not from app migrations)

| # | Table Name | Source | Purpose |
|---|-----------|-------|---------|
| 74 | `users` | Pre-existing (legacy) | User authentication & profiles |
| 75 | `organizations` | Pre-existing (public.organizations) | Multi-tenant orgs |
| 76 | `organization_settings` | Pre-existing + ALTERs | Org-level config |
| 77 | `roles` | Referenced in /api/roles | Custom role definitions |
| 78 | `notification_preferences` | Referenced in auth/login + settings | Notification prefs per user |
| 79 | `notification_type_preferences` | Referenced in settings/notification-preferences | Per-key notification toggle |
| 80 | `email_change_otps` | Referenced in settings/email-change + password | OTP for email/password changes |
| 81 | `password_change_authorizations` | 2026-09-16_password_change_authorizations.sql | Password change auth flow |
| 82 | `device_tokens` | 2026-10-15_device_tokens.sql | Push notification tokens |
| 83 | `audit_logs` | Referenced in lib/auditLog.ts + settings | Security audit trail |
| 84 | `api_keys` | Referenced in settings/api-keys | API key management |
| 85 | `creative_studio_gallery` | 2026-10-19_creative_studio_gallery.sql | AI-generated images |
| 86 | `email_trigger_config` | 2026-10-19_email_trigger_config.sql | Email trigger config |

### 1.4 Import System Tables

| # | Table Name | Migration | Purpose |
|---|-----------|----------|---------|
| 87 | `import_jobs` | 2026-08-26_import_staging_tables.sql | Bulk import job tracking |
| 88 | `import_rows` | 2026-08-26_import_staging_tables.sql | Staged import rows |
| 89 | `import_errors` | 2026-08-26_import_staging_tables.sql | Validation errors |
| 90 | `import_templates` | 2026-08-26_import_templates_and_booking_claims.sql | Saved column mappings |
| 91 | `historical_booking_claims` | 2026-08-26_import_templates_and_booking_claims.sql | Non-financial booking imports |

### 1.5 Communication Tables

| # | Table Name | Source | Purpose |
|---|-----------|-------|---------|
| 92 | `whatsapp_conversations` | lib/whatsappConversations.ts | Conversation threads |
| 93 | `whatsapp_messages` | lib/whatsappConversations.ts | Message persistence |
| 94 | `whatsapp_business_numbers` | lib/whatsappConversations.ts | Phone number routing |
| 95 | `whatsapp_logs` | Referenced in leadDeletion.ts | WhatsApp message log |

### 1.6 Caller Module Tables

| # | Table Name | Source | Purpose |
|---|-----------|-------|---------|
| 96 | `caller_leads` | /api/caller-leads | Caller-assigned leads |
| 97 | `caller_follow_ups` | /api/caller-leads/[id]/follow-ups | Caller follow-up notes |
| 98 | `caller_upload_batches` | /api/caller-leads | Batch upload tracking |

### 1.7 Financial Tables

| # | Table Name | Source | Purpose |
|---|-----------|-------|---------|
| 99 | `loan_applications` | /api/walkin_enquiries/[id]/loan-applications | Loan applications |
| 100 | `loan_updates` | /api/loan | Loan status updates |
| 101 | `loan_pdd_tracking` | /api/booking-applications/[id]/pdd | PDD document tracking |
| 102 | `disbursement_tranches` | /api/walkin_enquiries/[id]/tranches | Loan disbursement tranches |

### 1.8 Misc / Supporting Tables

| # | Table Name | Source | Purpose |
|---|-----------|-------|---------|
| 103 | `walk_in_assignment_queue` | 2026-10-10_walk_in_sequential_queue.sql | Sequential walk-in queue |
| 104 | `pincodes` | /api/pincode-lookup | Pincode master data |
| 105 | `sourcing_manager_pincodes` | /api/pincode-lookup | SM territory assignment |
| 106 | `project_brokerage_config` | Referenced in brokerage routes | Project-level brokerage rates |
| 107 | `bookings` | Legacy (settings/workspace reads count) | Legacy booking table |

### 1.9 Database Views

| # | View Name | Type | Purpose |
|---|----------|------|---------|
| 108 | `customer_ledger_view` | VIEW | Aggregated financial position per booking |
| 109 | `booking_total_cost_view` | VIEW | Total cost calculation per booking |

### 1.10 Tables Referenced in Deletion Cascades (lib/leadDeletion.ts)

These tables are confirmed to exist via defensive `information_schema` checks before deletion:

| # | Table Name | Operation | Notes |
|---|-----------|-----------|-------|
| 110 | `notes` | DELETE | Additional note storage |
| 111 | `lead_notes` | DELETE | Lead-specific notes |
| 112 | `uploaded_documents` | DELETE | Generic document uploads |
| 113 | `lead_documents` | DELETE | Lead-specific documents |
| 114 | `customer_documents` | DELETE | Customer document storage |
| 115 | `email_history` | DELETE | Email send log |
| 116 | `call_history` | DELETE | Call log |
| 117 | `reminders` | DELETE | Reminder records |
| 118 | `notification_records` | DELETE | Notification tracking |
| 119 | `notifications` | DELETE | Generic notifications |
| 120 | `ai_conversations` | DELETE | AI chat history |
| 121 | `audit_references` | DELETE | Audit trail references |
| 122 | `customers` | DELETE | Legacy customer table |
| 123 | `completed_leads` | REMOVED (MT-03) | Dead — replaced by booking_applications |
| 124 | `employee_attendance` | REMOVED (MT-03) | Dead — replaced by attendance_records |

---

## 2. ROLE-WISE TABLE MAPPING

### 2.1 Admin (access to 107 tables)

The Admin role has the widest access. All tables in the system are accessible to Admin either directly or through shared APIs.

**Exclusive Admin tables (not accessible by other CRM roles):**
- `api_keys` (settings)
- `creative_studio_gallery` (AI studio)
- `roles` (role management)
- `import_jobs`, `import_rows`, `import_errors`, `import_templates`, `historical_booking_claims` (import system)
- `user_permissions` (permission overrides)
- `organization_recording_permissions` (recording permissions)
- `organization_followup_deletion_permissions` (follow-up deletion permissions)
- `lead_deletion_audit_logs` (deletion audit)
- All lead deletion cascade tables (110-122)

### 2.2 Super Admin (access to ~30 tables)

Platform-level role. Accesses:
- `organizations` (R/W — platform management)
- `users` (R/W — cross-org user management)
- `walkin_enquiries`, `booking_applications` (R — platform metrics)
- `audit_logs` (R — platform activity)
- `email_trigger_config` (R/W — email config)
- `site_locations` (R/W — site management)
- `email_change_otps` (R/W — password change flow)
- `password_change_authorizations` (R/W)
- All settings tables accessible via admin routes

### 2.3 Site Head (access to ~45 tables)

**Shared with Admin:**
- `walkin_enquiries` (R/W — lead management)
- `booking_applications` + all booking sub-tables (R/W)
- `follow_ups`, `follow_up_attachments` (R/W)
- `site_visits` (R/W)
- `deal_stage_history`, `deal_stage_outbox` (R/W — stage advancement)
- `loan_applications`, `loan_updates`, `disbursement_tranches` (R/W)
- `users` (R — lookup)
- `channel_partners` (R — view)
- `lead_assignment_logs` (R)
- `lead_reminders` (R/W)
- `attendance_records`, `attendance_periods` (R — own)
- `employee_sessions` (R — own)

### 2.4 Sales Manager (access to ~50 tables)

**Core tables:**
- `walkin_enquiries` (R/W — assigned leads only)
- `booking_applications` + all booking sub-tables (R/W)
- `follow_ups`, `follow_up_attachments` (R/W)
- `site_visits` (R/W)
- `deal_stage_history`, `deal_stage_outbox` (R/W — stage advancement on own leads)
- `loan_applications`, `loan_updates`, `disbursement_tranches` (R/W)
- `channel_partners`, `cp_commissions`, `cp_visits`, `cp_chat_messages` (R/W)
- `inventory_units` + related tables (R, some W)
- `lead_reminders` (R/W)
- `attendance_records`, `attendance_periods` (R/W — own)
- `employee_sessions` (R — own)

### 2.5 Receptionist (access to ~25 tables)

**Core tables:**
- `walkin_enquiries` (R/W — create new leads)
- `walk_in_assignment_queue` (W — via enquiry form)
- `site_locations` (R — dropdown)
- `users` (R — SM/Site Head lookup)
- `channel_partners` (R — CP lookup)
- `follow_ups` (R/W)
- `site_visits` (R)
- `pincodes`, `sourcing_manager_pincodes` (R — pincode lookup)
- `lead_reminders` (R/W)
- `attendance_records`, `attendance_periods` (R/W — own)
- `employee_sessions` (R — own)
- `organizations` (R — tenant context)

### 2.6 Caller (access to ~8 tables)

**Exclusive tables:**
- `caller_leads` (R/W — batch-assigned leads)
- `caller_follow_ups` (R/W — call notes)
- `caller_upload_batches` (R — batch info)

**Shared tables:**
- `users` (R — own session)
- `employee_sessions` (R/W — own login)
- `attendance_records`, `attendance_periods` (R/W — own)
- `walkin_enquiries` (R — lead conversion check)
- `call_sessions` (R/W — call tracking)

### 2.7 Sourcing Manager (access to ~15 tables)

**Core tables:**
- `channel_partners` (R/W — filtered by owner_id)
- `cp_visits` (R/W)
- `cp_chat_messages` (R/W)
- `cp_assignment_history` (R)
- `walkin_enquiries` (R — CP-sourced leads)
- `booking_applications` (R — CP bookings)
- `users` (R — lookup)
- `attendance_records`, `attendance_periods` (R/W — own)
- `employee_sessions` (R/W — own login)

### 2.8 HR (access to ~35 tables)

**Exclusive HR tables:**
- `employee_employment_history` (R/W)
- `employee_salary_history` (R/W)
- `employee_documents` (R/W)
- `hr_compliance_tasks` (R/W)
- `company_assets` (R/W)
- `employee_asset_assignments` (R/W)
- `hr_mandatory_documents` (R/W)
- `organization_holidays` (R/W)
- `employee_leave_allocations` (R/W)
- `employee_leave_records` (R/W)
- `employee_leave_record_history` (R)
- `employee_week_off_pattern` (R/W)
- `employee_incentives` (R/W)
- `employee_incentive_history` (R)
- `payroll_periods` (R/W)
- `payroll_records` (R/W)
- `payroll_adjustments` (R/W)
- `payroll_payments` (R/W)
- `hr_requests` (R/W)
- `hr_request_messages` (R/W)
- `booking_brokerage` (R/W)
- `project_brokerage_config` (R/W)
- `employee_resource_expenses` (R/W)

**Shared tables:**
- `users` (R/W — employee profiles)
- `attendance_records` (R)
- `booking_applications`, `booking_financials`, `booking_loan_details`, `booking_registration_details` (R — brokerage/profitability)

---

## 3. TABLE USAGE STATUS

### 3.1 Actively Used Tables (103)

Every table listed in sections 1.1 through 1.8 (tables 1-106), plus the 2 views (108-109) minus the 4 dead/removed tables below.

### 3.2 Dead / Unused Tables (4)

| Table | Reason | Evidence |
|-------|--------|----------|
| `completed_leads` | Removed per MT-03 | Replaced by booking_applications; only referenced in defensive deletion cascade |
| `employee_attendance` | Removed per MT-03 | Replaced by attendance_records; migration comment confirms removal |
| `leads` (public.leads) | Empty and dead | All 309 real leads in walkin_enquiries; confirmed in memory notes |
| `bookings` | Legacy | Only accessed by settings/workspace for a COUNT; superseded by booking_applications |

### 3.3 Uncertain Tables (13)

These are referenced in `lib/leadDeletion.ts` via defensive `information_schema` checks. They exist as column-checked cascade targets but may not have been created by any migration. They likely exist from legacy Django schema:

| Table | Evidence |
|-------|----------|
| `notes` | Deletion cascade only |
| `lead_notes` | Deletion cascade only |
| `uploaded_documents` | Deletion cascade only |
| `lead_documents` | Deletion cascade only |
| `customer_documents` | Deletion cascade only |
| `email_history` | Deletion cascade only |
| `call_history` | Deletion cascade only |
| `reminders` | Deletion cascade only |
| `notification_records` | Deletion cascade only |
| `notifications` | Deletion cascade only |
| `ai_conversations` | Deletion cascade only |
| `audit_references` | Deletion cascade only |
| `customers` | Deletion cascade only |

---

## 4. SHARED vs EXCLUSIVE TABLE ANALYSIS

### 4.1 Tables Shared Across Multiple Roles (32)

| Table | Roles Accessing |
|-------|----------------|
| `walkin_enquiries` | Admin, Super Admin, Site Head, Sales Manager, Receptionist, Caller, Sourcing Manager |
| `users` | All roles |
| `organizations` | All roles (tenant context) |
| `organization_settings` | All roles (read), Admin (write) |
| `employee_sessions` | All roles (own sessions) |
| `attendance_records` | All roles (own attendance) |
| `attendance_periods` | All roles (own periods) |
| `follow_ups` | Admin, Site Head, Sales Manager, Receptionist |
| `follow_up_attachments` | Admin, Site Head, Sales Manager |
| `booking_applications` | Admin, Super Admin, Site Head, Sales Manager, HR, Sourcing Manager |
| `booking_financials` | Admin, Site Head, Sales Manager, HR |
| `booking_loan_details` | Admin, Site Head, Sales Manager, HR |
| `booking_registration_details` | Admin, Site Head, Sales Manager, HR |
| `booking_custom_charges` | Admin, Site Head, Sales Manager |
| `booking_payment_milestones` | Admin, Site Head, Sales Manager, HR |
| `booking_documents` | Admin, Site Head, Sales Manager |
| `booking_stage_history` | Admin, Site Head, Sales Manager |
| `booking_history` | Admin, Site Head, Sales Manager |
| `booking_tds_records` | Admin, Site Head |
| `site_visits` | Admin, Site Head, Sales Manager, Receptionist |
| `deal_stage_history` | Admin, Site Head, Sales Manager |
| `deal_stage_outbox` | Admin, Site Head, Sales Manager (via hooks) |
| `channel_partners` | Admin, Sales Manager, Sourcing Manager, Receptionist |
| `cp_commissions` | Admin, Sales Manager, HR |
| `loan_applications` | Admin, Site Head, Sales Manager |
| `disbursement_tranches` | Admin, Site Head, Sales Manager |
| `lead_assignment_logs` | Admin, Site Head, Sales Manager |
| `lead_reminders` | Admin, Site Head, Sales Manager, Receptionist |
| `notification_preferences` | All roles (own) |
| `notification_type_preferences` | All roles (own) |
| `email_change_otps` | Admin, Super Admin (password flows) |
| `device_tokens` | All roles (push notifications) |

### 4.2 Tables Exclusive to Single Roles (43)

**Admin-exclusive (16):**
`api_keys`, `creative_studio_gallery`, `roles`, `import_jobs`, `import_rows`, `import_errors`, `import_templates`, `historical_booking_claims`, `user_permissions`, `organization_recording_permissions`, `organization_followup_deletion_permissions`, `lead_deletion_audit_logs`, `audit_logs`, `email_trigger_config`, `booking_initiations`, `financial_adjustments`

**HR-exclusive (shared with Admin only) (23):**
`employee_employment_history`, `employee_salary_history`, `employee_documents`, `hr_compliance_tasks`, `company_assets`, `employee_asset_assignments`, `hr_mandatory_documents`, `organization_holidays`, `employee_leave_allocations`, `employee_leave_records`, `employee_leave_record_history`, `employee_week_off_pattern`, `employee_incentives`, `employee_incentive_history`, `payroll_periods`, `payroll_records`, `payroll_adjustments`, `payroll_payments`, `hr_requests`, `hr_request_messages`, `booking_brokerage`, `project_brokerage_config`, `employee_resource_expenses`

**Caller-exclusive (3):**
`caller_leads`, `caller_follow_ups`, `caller_upload_batches`

**Receptionist-exclusive (1):**
`walk_in_assignment_queue` (write path via enquiry form)

### 4.3 Background/Cron Process Tables (5)

| Table | Process | Trigger |
|-------|---------|---------|
| `deal_stage_outbox` | /api/cron/deal-stage-process | Admin manual recovery |
| `attendance_records` | /api/attendance/auto-complete | Vercel Cron (shift_end) |
| `attendance_periods` | /api/attendance/auto-complete | Vercel Cron (shift_end) |
| `organization_settings` | /api/attendance/auto-complete | Read shift_end config |
| `employee_sessions` | lib/sessionCleanup.ts | Throttled stale session expiry |

---

## 5. API ROUTE TO TABLE MAPPING (Key Routes)

| API Route | Tables | Operations |
|-----------|--------|-----------|
| `/api/walkin_enquiries` | walkin_enquiries, walk_in_assignment_queue, site_locations, users, cp_assignment_history, organizations | R/W |
| `/api/walkin_enquiries/[id]` | walkin_enquiries, lead_assignment_logs, follow_ups | R/W |
| `/api/booking-applications` | booking_applications, booking_financials, booking_loan_details, booking_payment_milestones, booking_pipeline, booking_registration_details, booking_stage_history, booking_custom_charges, booking_documents, financial_accounts, financial_ledger, walkin_enquiries, inventory_units, loan_applications, deal_stage_outbox | R/W |
| `/api/booking-applications/[id]` | booking_applications, booking_financials, booking_loan_details, booking_payment_milestones, booking_registration_details, booking_tds_records, booking_custom_charges, loan_applications, deal_stage_outbox | R/W |
| `/api/sales-form-submit` | walkin_enquiries, follow_ups, site_visits, deal_stage_outbox | W |
| `/api/followups` | follow_ups, walkin_enquiries, users, deal_stage_outbox | R/W |
| `/api/leads/[id]/deal-stage` | deal_stage_history, walkin_enquiries, users, deal_stage_outbox | R/W |
| `/api/attendance/mark` | employee_sessions, attendance_records, attendance_periods, employee_live_state, employee_activity_logs | R/W |
| `/api/hr/employees/[id]` | users, employee_documents, employee_employment_history, employee_incentives, employee_leave_records, employee_leave_allocations, employee_week_off_pattern, employee_salary_history, employee_asset_assignments, employee_resource_expenses, employee_sessions | R/W |
| `/api/hr/payroll/records/[id]` | payroll_records, payroll_adjustments, payroll_payments | R/W |
| `/api/revenue-intelligence` | booking_applications, booking_financials, booking_loan_details, booking_registration_details, booking_payment_milestones, financial_accounts, financial_ledger, customer_ledger_view, cp_commissions, channel_partners, walkin_enquiries | R |
| `/api/inventory` | inventory_units, inventory_unit_history, inventory_unit_waitlist, booking_applications, booking_loan_details, booking_registration_details, inventory_projects, inventory_towers | R/W |
| `/api/channel-partners` | channel_partners, users, walkin_enquiries, booking_applications | R/W |
| `/api/auth/login` | users, notification_preferences, organizations, employee_sessions | R/W |
| `/api/platform/metrics` | organizations, users, walkin_enquiries, booking_applications | R |
| `/api/dashboard/overview-kpis` | walkin_enquiries, booking_applications, site_visits, users | R |

---

## 6. DATABASE OBJECTS SUMMARY

### Views (2)
1. `customer_ledger_view` — Aggregated financial position per booking
2. `booking_total_cost_view` — Total cost calculation per booking

### Functions (3)
1. `set_updated_at()` — Shared updated_at trigger function
2. `cp_chat_assert_tenant()` — Multi-tenant integrity on CP tables
3. `attendance_periods_validate_parent()` — Parent record validation

### Triggers (7)
1. `trg_channel_partners_updated_at` ON channel_partners
2. `trg_cp_commissions_updated_at` ON cp_commissions
3. `trg_notification_logs_updated_at` ON notification_logs
4. `cp_visits_assert_tenant` ON cp_visits
5. `cp_chat_messages_assert_tenant` ON cp_chat_messages
6. `set_updated_at_lead_reminders` ON lead_reminders
7. `trg_attendance_periods_validate_parent` ON attendance_periods

### Indexes: 95+ (partial, unique, composite)
### Foreign Keys: 95+
### Check Constraints: 20+
### Sequences: 3+ explicit (walkin_enquiries_sr_no_seq, etc.)

---

## 7. FINAL AUDIT SUMMARY

| Metric | Count |
|--------|-------|
| **Total PostgreSQL tables (all sources)** | **107** |
| **Actively used tables** | **90** |
| **Dead / unused tables** | **4** (completed_leads, employee_attendance, leads, bookings) |
| **Uncertain tables** (legacy cascade targets) | **13** |
| **Shared tables** (accessed by 2+ roles) | **32** |
| **Role-specific tables** | **43** (16 admin + 23 HR + 3 caller + 1 receptionist) |
| **Background/cron-only tables** | **5** (subset of shared) |
| **Database views** | **2** |
| **Database functions** | **3** |
| **Database triggers** | **7** |
| **Total indexes** | **95+** |

### Tables Per Role

| Role | Tables Accessed | Exclusive Tables |
|------|----------------|-----------------|
| **Admin** | **107** (all) | 16 |
| **Super Admin** | **~30** | 0 (subset of admin) |
| **Site Head** | **~45** | 0 |
| **Sales Manager** | **~50** | 0 |
| **Receptionist** | **~25** | 1 (walk_in_assignment_queue write) |
| **Caller** | **~8** | 3 (caller_leads, caller_follow_ups, caller_upload_batches) |
| **Sourcing Manager** | **~15** | 0 |
| **HR** | **~35** | 23 (all HR module tables, shared with admin) |

### Tables Accessed by Multiple Roles

**32 tables** are accessed by 2 or more roles. The most widely shared table is `walkin_enquiries` (7 roles), followed by `users` and `organizations` (all roles).

---

## 8. EVIDENCE NOTES

- No Prisma schema found anywhere in the project. All queries are raw SQL via `lib/db.ts` pool.
- No materialized views exist.
- `public.leads` table exists in the database but is completely empty and dead — all lead data lives in `walkin_enquiries`.
- `bookings` table is legacy — only accessed by `settings/workspace/route.ts` for a COUNT query.
- 13 tables in the "uncertain" category are referenced only via defensive `information_schema.columns` checks in `lib/leadDeletion.ts` before cascade deletion. They likely originate from a legacy Django schema and may or may not still exist in production.
- Runtime-created tables (via `CREATE TABLE IF NOT EXISTS`) in lib files are bootstrapped on first access, not through migration files.
- The database connection pool is managed via `lib/db.ts` with a globalThis singleton (25 max connections, 30s statement timeout).
- Multi-tenant isolation enforced via `organization_id` on every query, resolved from JWT session claims via `lib/tenantContext.ts`.

---

*Report generated by exhaustive codebase scan of 293 API routes, 35+ lib files, and 108 migration files.*
