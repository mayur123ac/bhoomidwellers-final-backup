# Deal Stage Pipeline — Security and Tenant Isolation

> Version: 2.0 | Date: 2026-11-01 | Status: DESIGN (not implemented)

## 1. Tenant Isolation

Every deal stage query includes `organization_id` as a mandatory filter. The value
is **never** accepted from client input.

### Resolution Chain

```
Session cookie → getServerSession() → session.org → getOrganizationId()
  → UUID string validated against UUID_RE
  → Used as parameter in every SQL WHERE clause
```

**Source (VERIFIED):** `lib/tenantContext.ts` — `getOrganizationId()` resolves from
the session `org` claim first, with a sole-organization fallback for legacy sessions.
Returns UUID string or throws.

### Per-Table Enforcement

| Table | Column | Enforcement |
|---|---|---|
| `deal_stage_outbox` | `organization_id UUID NOT NULL` | Written by endpoint inside transaction; processor filters by org when session-authed |
| `deal_stage_history` | `organization_id UUID NOT NULL` | Written by processor; read APIs always include `AND organization_id = $org` |
| `booking_initiations` | `organization_id UUID NOT NULL` | Written by endpoint; read queries always scoped |

### Cron Processor Tenant Scope

- **Token auth** (CRON_SECRET or dedicated token): Processes events across all
  organizations. The outbox event already carries the correct `organization_id`,
  which is propagated to `deal_stage_history` rows.
- **Session auth** (admin cookie): Processes only events matching the admin's
  `organization_id`. The SELECT adds `AND organization_id = $org`.

This matches the existing pattern in `api/attendance/auto-complete`.

### Cross-Tenant Attack Vectors — Mitigated

| Vector | Mitigation |
|---|---|
| Client sends `organization_id` in request body | Ignored. Server derives from session |
| Client sends `lead_id` belonging to another org | Lead existence check includes `AND organization_id = $org`. Returns 404 (not 403) to prevent enumeration |
| Outbox event references a lead in another org | Processor verifies `lead_id + organization_id` match before processing |
| Batch endpoint (`GET /api/leads/deal-stages`) with foreign IDs | Results filtered by `organization_id`; foreign IDs return no rows (appear as untracked) |
| Booking initiation for another org's lead | Lead check with `AND organization_id = $org` returns 404 |

## 2. Role-Based Access Control (RBAC)

### Read Endpoints

**GET /api/leads/[id]/deal-stage** (single lead):

| Role | Access |
|---|---|
| Admin | Always allowed for leads in their org |
| Site Head | Always allowed for leads in their org |
| Sales Manager | Allowed only when `assigned_to_user_id` matches session (ID-first, name fallback for legacy rows) |
| Receptionist | 403 Forbidden |
| All others | 403 Forbidden |

This matches the authorization pattern established in `api/leads/[id]/visit-chain/route.ts`
(VERIFIED — updated during SM visit history implementation).

**GET /api/leads/deal-stages** (batch):

| Role | Access |
|---|---|
| Admin | All leads in org |
| Site Head | All leads in org |
| Sales Manager | Only leads assigned to them (intersection filter) |
| Receptionist | Only leads they submitted (intersection filter) |

This matches the scoping logic in `api/walkin_enquiries/route.ts` GET handler.

**Important:** The organization filter alone does NOT prove ownership authorization.
For Sales Managers, the batch endpoint must intersect the requested IDs with
the set of leads where `assigned_to_user_id = $session_user_id`. A lead that
belongs to the same organization but is assigned to a different SM must NOT be
returned. The lead appears as `{ tracked: false }` in the response (same as a
non-existent lead, preventing enumeration of other SMs' lead stages).

### Write Endpoints

**POST /api/booking-initiations**:

| Role | Access |
|---|---|
| Admin | Any lead in org |
| Site Head | Leads they oversee |
| Sales Manager | Only leads assigned to them |
| All others | 403 Forbidden |

### Cron Endpoint

**GET /api/cron/deal-stage-process**:

| Auth Method | Access |
|---|---|
| `Authorization: Bearer ${CRON_SECRET}` | All orgs |
| `x-dealstage-token: ${VERIFY_TOKEN}` | All orgs |
| Admin session cookie | Own org only |
| All others | 401 Unauthorized |

No non-admin user can trigger the processor. The endpoint is not listed in any
frontend navigation.

## 3. Ownership Verification Pattern

The Sales Manager ownership check uses the same ID-first + name-fallback pattern
established during the P0 security fixes (`lib/leadAuth.ts`):

```
function isAssignedToUser(lead, session):
  sessionUserId = getSessionUserId(session)  // from lib/serverAuth.ts

  if lead.assigned_to_user_id != null AND sessionUserId != null:
    return Number(lead.assigned_to_user_id) === sessionUserId

  // Legacy fallback: rows where assigned_to_user_id was never set
  return session.name === lead.assigned_to
```

**Why both checks (VERIFIED):** Legacy `walkin_enquiries` rows (pre-P0) have
`assigned_to` (name string) but no `assigned_to_user_id`. The ID check is
authoritative for new rows; the name fallback prevents breaking access for legacy
leads.

## 4. Revisit Isolation

Each `walkin_enquiries` row is an independent lead with its own deal stage lifecycle.
The `returning_from_lead_id` chain is **irrelevant** to stage calculation.

### Why This Matters

A customer visiting 3 times creates 3 independent leads:
- Lead #100 (original) — own Fresh → Contacted → ...
- Lead #200 (revisit 1) — own Fresh → Contacted → ...
- Lead #300 (revisit 2) — own Fresh → Contacted → ...

Each lead has independent `deal_stage_history` rows. A site visit completed for
Lead #300 does NOT affect Lead #100's stages. The `lead_id` column in all deal
stage tables refers to exactly one `walkin_enquiries` row.

### No Cross-Lead Stage Inheritance

The processor never traverses `returning_from_lead_id`. There is no "inherit
parent's stage" logic. If a revisit lead is created and immediately has a site
visit scheduled, the processor infers Fresh and Contacted as INFERRED stages for
that specific lead.

## 5. Idempotency as a Security Property

Idempotency prevents both accidental and intentional duplicate processing:

### Outbox Level (ADL-04)

`UNIQUE INDEX uq_dso_event_key ON deal_stage_outbox (event_key)`

- Full unique index (no partial WHERE clause). An event_key can never be reused,
  regardless of the existing row's status.
- An API retry that re-inserts the same business event hits the unique constraint.
- The `ON CONFLICT (event_key) DO NOTHING` clause silently absorbs the duplicate.
- A malicious client calling the same endpoint repeatedly cannot create multiple
  outbox events for the same business action.
- After outbox cleanup (DELETE of old 'done' rows), the key is freed but the source
  record's SERIAL ID will never be reused, so the same key cannot be legitimately
  regenerated.

### History Level

`UNIQUE INDEX uq_dsh_lead_stage ON deal_stage_history (lead_id, stage)`

- Each lead can have at most one entry per stage.
- If two different events both qualify for the same stage (e.g., sales form and
  call both qualify for Contacted), the first processed wins for ACTUAL; the second
  triggers an INFERRED→ACTUAL correction if the existing row is INFERRED, or is
  a no-op if it is already ACTUAL.
- A crash-retry that re-processes an event finds the stage already exists and
  treats it as a no-op (or a correction).

### Distinction: Event Idempotency vs Stage Idempotency

- **Event idempotency:** The same business event produces at most one outbox row.
  Enforced by `uq_dso_event_key`.
- **Stage projection idempotency:** The same stage is recorded at most once per lead.
  Enforced by `uq_dsh_lead_stage`.
- **Business-stage uniqueness:** A lead has at most one entry per stage name.
  Same constraint as stage projection.

These three properties are enforced by two independent unique indexes. A failure
in one does not compromise the other.

## 6. Data Integrity Constraints

### CHECK Constraints

```sql
CHECK (stage IN ('Fresh', 'Contacted', 'Site Visit', 'Negotiation', 'Sales', 'Booked'))
CHECK (stage_ordinal BETWEEN 1 AND 6)
CHECK (transition_type IN ('ACTUAL', 'INFERRED'))
```

These prevent invalid data from being inserted even if application code has a bug.

### No Backward Transitions

The processor's `highestExisting` check (compare target ordinal against MAX of
existing ordinals) prevents new stages from being inserted below the highest.
The INFERRED→ACTUAL correction (ADL-01) can update existing rows but never
changes the stage name or ordinal. No amount of event replay can create
regressive stages.

### Mutation Policy

`deal_stage_history` permits exactly two types of mutation:

1. **INFERRED→ACTUAL correction (ADL-01):** Changes `transition_type` from
   INFERRED to ACTUAL and may update `entered_at` via `LEAST()`. The `WHERE`
   guard ensures ACTUAL rows are never overwritten.

2. **INFERRED timestamp reconciliation (ADL-10):** After any stage insert or
   correction, the processor reconciles INFERRED `entered_at` values to maintain
   non-decreasing chronological order against neighboring ACTUAL timestamps.
   Only INFERRED rows are modified. ACTUAL timestamps are never changed.

No other UPDATE is allowed. No DELETE is performed by application code. The only
deletion path is CASCADE from `walkin_enquiries` deletion.

## 7. Input Validation

### Booking Initiations Endpoint (ADL-02)

```
POST /api/booking-initiations
Body: { "lead_id": number, "saved_field": { "name": string, "value": string } }
```

- `lead_id` must be a positive integer (validated server-side).
- `saved_field.name` must be a non-empty string, max 100 chars.
- `saved_field.value` must be a non-empty string (not whitespace-only), max 500 chars.
- `organization_id` derived from session (never from body).
- `initiated_by` derived from session user ID.
- Lead existence + org match verified before INSERT.
- If lead has a confirmed booking: 409 Conflict.

### Batch Endpoint

```
GET /api/leads/deal-stages?ids=1234,1235,1236
```

- `ids` parameter parsed as comma-separated integers.
- Non-numeric values rejected (400).
- Maximum 200 IDs per request (prevents excessive query size).
- Each ID filtered by `organization_id` — foreign IDs silently return no data.

### Cron Endpoint

```
GET /api/cron/deal-stage-process?limit=50
```

- `limit` must be a positive integer, default 50, max 200.
- Values > 200 are clamped to 200.
- Non-numeric values use default.

## 8. Error Message Safety

All error responses use generic messages that do not leak internal state:

| Scenario | Response |
|---|---|
| Lead exists in different org | `{ "message": "Lead not found." }` (404, not 403) |
| Unauthorized role | `{ "message": "Forbidden." }` (403) |
| No session | `{ "message": "Unauthorized" }` (401) |
| Internal error | `{ "message": "Internal server error." }` (500) |

The 404-for-wrong-org pattern prevents enumeration attacks: an attacker cannot
distinguish "lead doesn't exist" from "lead exists in another org."

## 9. Retention and Deletion Policy (ADL-06)

### deal_stage_history

**Durable** — persists through all normal CRM operations. Deleted only when the
lead is hard-deleted (`ON DELETE CASCADE`). This is deliberate:

- Hard deletion is an admin action that removes ALL associated data.
- Retaining stage history for a deleted lead would create orphaned records with
  no meaningful context.
- Privacy/GDPR: when a lead is deleted, its personal data trail (including stage
  progression) is also removed.

### deal_stage_outbox

**No FK** — survives lead deletion. Orphaned events are handled by the processor:
- Lead not found → event marked 'failed' with error message.
- After 10 failures → dead-lettered.
- 'Done' events are retained permanently (ADL-12).

### booking_initiations

**CASCADE delete** — deleted when the lead is deleted. `booking_id` is SET NULL
when the booking is deleted. The initiation record persists as long as the lead
exists, even if the booking is cancelled or deleted.

### Audit Trail

The deal stage system provides inherent auditability:

- **`deal_stage_outbox`**: Records every business event with actor_id, event_ts,
  and the source record. 'Done' rows are retained for 90 days (configurable).
- **`deal_stage_history`**: Durable record of every stage entry with
  `triggered_by` (user ID), `source_event`, `source_table`, and `source_record_id`.
- **`booking_initiations`**: Records who initiated the booking process and when.

The audit trail is deleted only when the lead itself is deleted. No separate
audit log table is needed for deal stage tracking.
