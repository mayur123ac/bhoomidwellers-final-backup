# Deal Stage Pipeline — Database Design

> Version: 2.0 | Date: 2026-11-01 | Status: DESIGN (not implemented)

## 1. New Tables

Three new tables are required. No existing table can serve as deal stage history.

### 1A. deal_stage_outbox

Captures business events that may advance a lead's deal stage. Every row is written
inside the same database transaction as the originating business operation (except
for booking confirmation — see ADL-03).

```sql
CREATE TABLE deal_stage_outbox (
  id               BIGSERIAL    PRIMARY KEY,
  lead_id          INTEGER      NOT NULL,
  event_type       TEXT         NOT NULL,
  event_ts         TIMESTAMPTZ  NOT NULL,
  event_key        TEXT         NOT NULL,
  actor_id         INTEGER,
  payload          JSONB        NOT NULL DEFAULT '{}',
  organization_id  UUID         NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'pending',
  attempts         INTEGER      NOT NULL DEFAULT 0,
  next_retry_at    TIMESTAMPTZ,
  processed_at     TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**Column rationale:**

| Column | Purpose |
|---|---|
| `id` | BIGSERIAL — monotonically increasing, used for ordering and batch cursors |
| `lead_id` | FK to walkin_enquiries. Not declared as REFERENCES because the outbox must survive lead deletion (orphaned events are marked failed by the processor) |
| `event_type` | Discriminator: `lead_assigned`, `lead_assigned_from_queue`, `lead_assigned_bulk`, `sales_form_submitted`, `call_completed`, `site_visit_scheduled`, `site_visit_scheduled_via_salesform`, `site_visit_completed`, `booking_initiated`, `booking_confirmed` |
| `event_ts` | Authoritative business-event timestamp. Not the same as `created_at` (which is insertion time). For assignment, this is the walkin_enquiries.created_at or the queue assignment moment. For call completion, this is the follow_up.created_at |
| `event_key` | Idempotency key. Format: `{event_type}:{source_table}:{source_record_id}`. Example: `call_completed:follow_ups:4821`. Prevents duplicate outbox rows |
| `actor_id` | users.id of the person who caused the event. NULL for system events (queue processing) |
| `payload` | Additional context: `{ source_table, source_record_id, ... }`. Kept minimal — the processor reads authoritative data from source tables |
| `organization_id` | UUID — matches `getOrganizationId()` return type and Neon production column type |
| `status` | `pending` → `done` or `failed`. No intermediate `processing` state (see ADL-05) |
| `attempts` | Incremented on each FAILED processing attempt. Used for retry backoff and dead-letter threshold. Success does not increment |
| `next_retry_at` | NULL for pending. Set to a future timestamp on failure for exponential backoff. NULL when dead-lettered (attempts >= 10) |
| `processed_at` | Timestamp when the event was successfully processed |
| `error_message` | Last error message on failure. Truncated to 500 chars |
| `created_at` | Row insertion time. Always NOW() |

**Status values:**
- `pending` — awaiting first processing attempt.
- `done` — successfully processed.
- `failed` — processing failed. If `next_retry_at IS NOT NULL`, the event will
  be retried. If `next_retry_at IS NULL`, the event is dead-lettered.

There is NO `processing` status. See ADL-05 for rationale.

**Indexes:**

```sql
-- Primary processing query: pending events in order
CREATE INDEX idx_dso_pending
  ON deal_stage_outbox (id)
  WHERE status = 'pending';

-- Retry query: failed events whose retry time has passed
CREATE INDEX idx_dso_retry
  ON deal_stage_outbox (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- Idempotency: permanent — no event_key can ever be reused (ADL-04)
CREATE UNIQUE INDEX uq_dso_event_key
  ON deal_stage_outbox (event_key);

-- Lookup by lead (debugging, admin view)
CREATE INDEX idx_dso_lead
  ON deal_stage_outbox (lead_id);
```

**Lifecycle:**
- Created inside business transaction (or booking CTE — ADL-03).
- Processed by cron worker.
- `done` rows can be purged after 90 days (optional cleanup cron).
  Purging DELETE removes the row and frees the event_key, but the source
  record ID in the key is a SERIAL that will never be reused.
- `failed` rows with `attempts >= 10` are dead-lettered (status stays `failed`,
  `next_retry_at` set to NULL — processor ignores them).

---

### 1B. deal_stage_history

Durable record of deal stage entries. Each lead has at most one row per stage.

```sql
CREATE TABLE deal_stage_history (
  id               SERIAL       PRIMARY KEY,
  lead_id          INTEGER      NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  stage            TEXT         NOT NULL,
  stage_ordinal    SMALLINT     NOT NULL,
  entered_at       TIMESTAMPTZ  NOT NULL,
  transition_type  TEXT         NOT NULL DEFAULT 'ACTUAL',
  source_event     TEXT         NOT NULL,
  source_record_id INTEGER,
  source_table     TEXT,
  triggered_by     INTEGER,
  organization_id  UUID         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**Column rationale:**

| Column | Purpose |
|---|---|
| `id` | SERIAL PK |
| `lead_id` | FK to walkin_enquiries with CASCADE delete. History is deleted when the lead is deleted (ADL-06) |
| `stage` | One of: `Fresh`, `Contacted`, `Site Visit`, `Negotiation`, `Sales`, `Booked` |
| `stage_ordinal` | Integer 1-6 matching stage order. Stored for efficient MAX() queries without text comparison |
| `entered_at` | When the lead entered this stage. For ACTUAL stages, this is the business event timestamp. For INFERRED stages, this starts as the triggering event's timestamp and may be corrected (ADL-01) |
| `transition_type` | `ACTUAL` — a real business event triggered this stage. `INFERRED` — an intermediate stage was backfilled. May be updated from INFERRED to ACTUAL (ADL-01) |
| `source_event` | The outbox event_type that caused this history row |
| `source_record_id` | The originating record ID (follow_ups.id, site_visits.id, etc.) |
| `source_table` | The originating table name |
| `triggered_by` | users.id who caused the event. NULL for system events |
| `organization_id` | UUID — tenant isolation |
| `created_at` | Row insertion time (processing time, not event time) |

**Constraints:**

```sql
-- Stage must be valid
ALTER TABLE deal_stage_history
  ADD CONSTRAINT chk_dsh_stage
  CHECK (stage IN ('Fresh', 'Contacted', 'Site Visit', 'Negotiation', 'Sales', 'Booked'));

-- Stage ordinal must match stage
ALTER TABLE deal_stage_history
  ADD CONSTRAINT chk_dsh_ordinal
  CHECK (stage_ordinal BETWEEN 1 AND 6);

-- Transition type must be valid
ALTER TABLE deal_stage_history
  ADD CONSTRAINT chk_dsh_transition
  CHECK (transition_type IN ('ACTUAL', 'INFERRED'));
```

**Indexes:**

```sql
-- Primary read query: all stages for one lead, in order
CREATE INDEX idx_dsh_lead_entered
  ON deal_stage_history (lead_id, entered_at);

-- Batch read: current stage per lead (MAX ordinal)
CREATE INDEX idx_dsh_lead_ordinal
  ON deal_stage_history (lead_id, stage_ordinal DESC);

-- Tenant-scoped queries
CREATE INDEX idx_dsh_org
  ON deal_stage_history (organization_id);

-- One entry per stage per lead. Used for both idempotency and
-- INFERRED→ACTUAL correction via ON CONFLICT ... DO UPDATE.
CREATE UNIQUE INDEX uq_dsh_lead_stage
  ON deal_stage_history (lead_id, stage);
```

**Mutation policy (ADL-01 + ADL-10):**

Two mutations are permitted on this table. No other UPDATE or DELETE is performed
by application code. The only deletion path is CASCADE from `walkin_enquiries`.

**Mutation 1: INFERRED→ACTUAL correction (ADL-01)**

```sql
INSERT INTO deal_stage_history (lead_id, stage, stage_ordinal, entered_at,
  transition_type, source_event, source_record_id, source_table, triggered_by,
  organization_id)
VALUES ($1, $2, $3, $4, 'ACTUAL', $5, $6, $7, $8, $9)
ON CONFLICT (lead_id, stage) DO UPDATE
  SET transition_type  = EXCLUDED.transition_type,
      entered_at       = LEAST(deal_stage_history.entered_at, EXCLUDED.entered_at),
      source_event     = EXCLUDED.source_event,
      source_record_id = EXCLUDED.source_record_id,
      source_table     = EXCLUDED.source_table,
      triggered_by     = EXCLUDED.triggered_by
  WHERE deal_stage_history.transition_type = 'INFERRED'
```

The `WHERE` guard ensures:
- ACTUAL rows are never overwritten (a second ACTUAL event for the same stage
  is silently discarded — the first one wins).
- INFERRED rows are corrected to ACTUAL with the real business data.
- `entered_at` takes the EARLIER of the two timestamps (LEAST), preserving the
  tightest bound on when the stage was actually reached.

**Mutation 2: INFERRED timestamp reconciliation (ADL-10)**

After any stage insert or INFERRED→ACTUAL correction, the processor reconciles
INFERRED stage timestamps to maintain non-decreasing chronological order.

```sql
UPDATE deal_stage_history SET entered_at = $1 WHERE id = $2
```

This UPDATE is applied only to INFERRED rows, only by the processor, and only
when the current timestamp violates the ordering constraint established by
neighboring ACTUAL stages. The reconciliation algorithm:

1. Each INFERRED stage is clamped to the interval defined by its nearest ACTUAL
   stages below (lower bound) and above (upper bound).
2. A forward sweep enforces non-decreasing order among consecutive INFERRED
   stages that share the same consistent ACTUAL bounds.
3. ACTUAL timestamps are never modified.
4. When ACTUAL bounds are contradictory (earlier ordinal has later timestamp),
   INFERRED stages caught between them are left unchanged — the contradiction
   is flagged in the API response (`timelineConsistent: false`).

The reconciliation is idempotent: running it twice on the same state produces
no additional changes.

**Retention policy (ADL-06):**

History is **durable** — it persists through all normal CRM operations (status
changes, reassignment, transfer, booking, cancellation). History is **deleted**
only when the lead itself is hard-deleted (via `ON DELETE CASCADE`). This is
deliberate: hard deletion is an admin action that removes all traces of the lead.

---

### 1C. booking_initiations

Records the first successful server-side booking-form field save (ADL-02).

```sql
CREATE TABLE booking_initiations (
  id              SERIAL       PRIMARY KEY,
  lead_id         INTEGER      NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  initiated_by    INTEGER      NOT NULL REFERENCES users(id),
  organization_id UUID         NOT NULL,
  saved_field     JSONB        NOT NULL,
  booking_id      INTEGER      REFERENCES booking_applications(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One initiation per lead
CREATE UNIQUE INDEX uq_bi_lead
  ON booking_initiations (lead_id);
```

**Column rationale:**

| Column | Purpose |
|---|---|
| `lead_id` | The walkin_enquiries.id this initiation belongs to. UNIQUE — only one per lead |
| `initiated_by` | users.id of the employee who first saved a booking field |
| `organization_id` | UUID — tenant isolation |
| `saved_field` | JSONB evidence of the first field save. Format: `{ "name": "primary_name", "value": "John Doe" }`. Proves a real data entry occurred, not just a form open |
| `booking_id` | NULL initially. Updated to the booking_applications.id when the booking is completed. SET NULL on booking delete |
| `created_at` | Authoritative timestamp for the Sales stage |

**Lifecycle:**
1. Employee opens booking form and types a value into any field.
2. Frontend detects first meaningful field interaction (non-empty value) and
   calls `POST /api/booking-initiations`.
3. `INSERT ... ON CONFLICT (lead_id) DO NOTHING RETURNING *` — idempotent.
4. If inserted (new): outbox event `booking_initiated` is written in the same
   transaction.
5. If conflict (existing): no outbox event, return existing row.
6. When booking POST succeeds: `UPDATE booking_initiations SET booking_id = $1
   WHERE lead_id = $2`.
7. If employee abandons the form: the initiation remains. Sales stage is valid.

---

## 2. Schema Change to Existing Table

### booking_applications — confirmed_at column (ADL-03)

```sql
ALTER TABLE booking_applications
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
```

Set in the post-commit CTE alongside `booking_status = 'Confirmed'`. The value
is `NOW()` at CTE execution time, which represents the actual confirmation
moment. Used as the authoritative Booked event timestamp.

---

## 3. Relationships

```
walkin_enquiries (1) ──→ (N) deal_stage_outbox     (no FK — survives lead deletion)
walkin_enquiries (1) ──→ (N) deal_stage_history     (CASCADE delete)
walkin_enquiries (1) ──→ (0..1) booking_initiations (CASCADE delete)
booking_applications (1) ──→ (0..1) booking_initiations.booking_id (SET NULL)
users (1) ──→ (N) booking_initiations.initiated_by
users (1) ──→ (N) deal_stage_history.triggered_by  (no FK — nullable)
```

## 4. Organization ID Type

All new tables use `UUID NOT NULL` for `organization_id`.

**Justification (VERIFIED):** `getOrganizationId()` in `lib/tenantContext.ts`
returns a UUID string validated against `UUID_RE`. Neon production has UUID
columns on `organization_settings`, `booking_applications`, `users`, and other
tables. The walkin_enquiries table uses UUID for organization_id.

Other ID types (VERIFIED from source code):
- `lead_id`: INTEGER (SERIAL on walkin_enquiries)
- `booking_id`: INTEGER (SERIAL on booking_applications)
- `user_id / actor_id`: INTEGER (SERIAL on users)
- `site_visit_id`: INTEGER (SERIAL on site_visits)
- `follow_up_id`: INTEGER (SERIAL on follow_ups)

## 5. Migration Sequence

A single migration file creates all three tables and their indexes:

```
scripts/migrations/2026-11-01_deal_stage_tables.sql
```

The migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`).

Contents:
1. `deal_stage_outbox` table + 4 indexes
2. `deal_stage_history` table + 4 indexes + 3 CHECK constraints
3. `booking_initiations` table + 1 unique index
4. `ALTER TABLE booking_applications ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`

No data migration or backfill is included. Existing leads begin tracking on their
next qualifying event after deployment.

**Partial migration safety:** Each statement is independent (IF NOT EXISTS). If the
migration is interrupted partway, re-running it completes the remaining statements
without affecting already-created objects.
