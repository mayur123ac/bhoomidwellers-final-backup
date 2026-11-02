# Deal Stage Pipeline — API Contracts

> Version: 2.0 | Date: 2026-11-01 | Status: DESIGN (not implemented)

## 1. GET /api/leads/[id]/deal-stage

Returns the complete deal stage history and current stage for a single lead.

### Authorization

Same pattern as `api/leads/[id]/visit-chain/route.ts`:
- Admin / Site Head: always allowed.
- Assigned Sales Manager: allowed when `assigned_to_user_id` matches session
  (ID-first, name fallback for legacy rows).
- All others: 403.

Tenant isolation: lead must exist in the caller's organization (from
`getOrganizationId()`, never from client input).

### Request

```
GET /api/leads/1234/deal-stage
Authorization: (session cookie)
```

No query parameters.

### Response — 200 OK (tracked lead)

```json
{
  "success": true,
  "tracked": true,
  "currentStage": "Negotiation",
  "currentStageOrdinal": 4,
  "currentStageSince": "2026-10-28T14:30:00.000Z",
  "currentStageDurationSeconds": 259200,
  "stages": [
    {
      "stage": "Fresh",
      "ordinal": 1,
      "enteredAt": "2026-10-20T09:00:00.000Z",
      "transitionType": "ACTUAL",
      "sourceEvent": "lead_assigned",
      "sourceTable": "walkin_enquiries",
      "sourceRecordId": 1234,
      "durationSeconds": 172800
    },
    {
      "stage": "Contacted",
      "ordinal": 2,
      "enteredAt": "2026-10-22T09:00:00.000Z",
      "transitionType": "ACTUAL",
      "sourceEvent": "sales_form_submitted",
      "sourceTable": "follow_ups",
      "sourceRecordId": 5678,
      "durationSeconds": 518400
    },
    {
      "stage": "Site Visit",
      "ordinal": 3,
      "enteredAt": "2026-10-28T09:00:00.000Z",
      "transitionType": "INFERRED",
      "sourceEvent": "site_visit_completed",
      "sourceTable": "site_visits",
      "sourceRecordId": 890,
      "durationSeconds": 19800
    },
    {
      "stage": "Negotiation",
      "ordinal": 4,
      "enteredAt": "2026-10-28T14:30:00.000Z",
      "transitionType": "ACTUAL",
      "sourceEvent": "site_visit_completed",
      "sourceTable": "site_visits",
      "sourceRecordId": 890,
      "durationSeconds": null
    }
  ],
  "upcomingStages": ["Sales", "Booked"]
}
```

**Duration calculation:**
- `durationSeconds` for completed stages = `enteredAt(next stage) - enteredAt(this stage)` in seconds.
- `durationSeconds` for the current stage = `null` (the frontend computes live duration from `currentStageSince`).
- `currentStageDurationSeconds` at the response level = `NOW() - currentStageSince` (snapshot).
- If two consecutive stages have the same `enteredAt`, `durationSeconds` is 0.

### Response — 200 OK (untracked lead)

For leads created before deployment with no qualifying events:

```json
{
  "success": true,
  "tracked": false,
  "currentStage": null,
  "stages": [],
  "upcomingStages": ["Fresh", "Contacted", "Site Visit", "Negotiation", "Sales", "Booked"]
}
```

### Response — 404

```json
{ "success": false, "message": "Lead not found." }
```

Returned for both non-existent leads and leads in a different organization
(prevents enumeration).

### Response — 403

```json
{ "success": false, "message": "Forbidden." }
```

### Implementation Notes

Query:
```sql
SELECT stage, stage_ordinal, entered_at, transition_type,
       source_event, source_table, source_record_id, triggered_by
  FROM deal_stage_history
 WHERE lead_id = $1 AND organization_id = $2
 ORDER BY stage_ordinal ASC
```

Duration is computed in application code from consecutive `entered_at` values.

---

## 2. GET /api/leads/deal-stages

Batch retrieval of current stage for multiple leads. Used by lead list tables.

### Authorization

Same pattern as the list endpoint in `api/walkin_enquiries/route.ts` GET:
- Admin / Site Head: can query any lead in their organization.
- Sales Manager: results are filtered to only leads assigned to them.
- Receptionist: results filtered to leads they submitted.

### Request

```
GET /api/leads/deal-stages?ids=1234,1235,1236,1237
Authorization: (session cookie)
```

Query parameter `ids`: comma-separated walkin_enquiries IDs. Maximum 200.

### Response — 200 OK

```json
{
  "success": true,
  "stages": {
    "1234": { "stage": "Negotiation", "ordinal": 4, "enteredAt": "2026-10-28T14:30:00Z", "tracked": true },
    "1235": { "stage": "Fresh", "ordinal": 1, "enteredAt": "2026-10-30T09:00:00Z", "tracked": true },
    "1236": { "tracked": false },
    "1237": { "stage": "Booked", "ordinal": 6, "enteredAt": "2026-10-25T16:00:00Z", "tracked": true }
  }
}
```

### Response — 400

```json
{ "success": false, "message": "Invalid or missing ids parameter." }
```

### Implementation Notes

Query:
```sql
SELECT DISTINCT ON (lead_id)
       lead_id, stage, stage_ordinal, entered_at
  FROM deal_stage_history
 WHERE lead_id = ANY($1) AND organization_id = $2
 ORDER BY lead_id, stage_ordinal DESC
```

Returns one row per lead: the highest achieved stage.

Leads with no history rows are returned as `{ tracked: false }`.

The ownership filter is applied by intersecting `$1` with the caller's authorized
lead set (using the same scoping logic as the walkin_enquiries GET handler).

---

## 3. POST /api/booking-initiations (ADL-02)

Records the first successful server-side booking-form field save. Triggers the
Sales stage.

### Authorization

- Admin: always allowed.
- Sales Manager: allowed only for leads assigned to them.
- Site Head: allowed for leads they oversee.
- All others: 403.

### Request

```json
POST /api/booking-initiations
Content-Type: application/json

{
  "lead_id": 1234,
  "saved_field": {
    "name": "primary_name",
    "value": "John Doe"
  }
}
```

Required fields:
- `lead_id` — integer, the walkin_enquiries ID.
- `saved_field` — object with `name` (non-empty string) and `value` (non-empty string).

`organization_id` and `initiated_by` are derived server-side from the session.

### Validation

- `lead_id` must be a positive integer.
- `saved_field.name` must be a non-empty string (max 100 chars).
- `saved_field.value` must be a non-empty string (max 500 chars).
- An empty or whitespace-only value is rejected (400).

### Response — 201 Created (first initiation)

```json
{
  "success": true,
  "created": true,
  "initiation": {
    "id": 45,
    "leadId": 1234,
    "initiatedBy": 56,
    "savedField": { "name": "primary_name", "value": "John Doe" },
    "createdAt": "2026-11-01T10:30:00.000Z",
    "bookingId": null
  }
}
```

### Response — 200 OK (already initiated)

```json
{
  "success": true,
  "created": false,
  "initiation": {
    "id": 45,
    "leadId": 1234,
    "initiatedBy": 56,
    "savedField": { "name": "primary_name", "value": "John Doe" },
    "createdAt": "2026-11-01T10:30:00.000Z",
    "bookingId": null
  }
}
```

### Response — 409 Conflict

If the lead already has a confirmed booking:

```json
{
  "success": false,
  "message": "Lead already has a confirmed booking.",
  "bookingId": 67
}
```

### Response — 404

```json
{ "success": false, "message": "Lead not found." }
```

### Implementation Notes

Transaction:
```
transaction(client) {
  1. Verify lead exists and is authorized (with org scope)
  2. Check for existing confirmed booking (409 if exists)
  3. INSERT INTO booking_initiations (lead_id, initiated_by, organization_id, saved_field)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lead_id) DO NOTHING
     RETURNING *
  4. If row returned (was inserted):
     INSERT INTO deal_stage_outbox (...)
     — event_type: 'booking_initiated'
     — event_ts: the new row's created_at
     — event_key: 'booking_initiated:booking_initiations:{id}'
  5. If no row returned (conflict):
     SELECT * FROM booking_initiations WHERE lead_id = $1
     — Return existing row, created = false
}
```

**Concurrent first-save behavior:** Two employees saving the first field
simultaneously for the same lead: `ON CONFLICT (lead_id) DO NOTHING` ensures
exactly one INSERT succeeds. The second call returns the existing row (step 5).
Only one outbox event is created.

**Behavior when booking is abandoned:** The initiation record persists. The
Sales stage remains valid. `booking_id` stays NULL. No cleanup is needed.

**Multiple employees continuing the same booking:** Only the first call per lead
creates an initiation. Subsequent calls from any employee return the existing row.
The `initiated_by` records who first saved a field, not who completed the booking.

---

## 4. GET /api/cron/deal-stage-process

Outbox processor. Invoked by Vercel Cron or third-party cron.

### Authentication

Three methods (matching existing cron pattern from `api/attendance/auto-complete`):
1. Vercel CRON_SECRET: `Authorization: Bearer ${CRON_SECRET}`
2. Dedicated token: `x-dealstage-token: ${VERIFY_TOKEN}` (reuse existing secret)
3. Admin session cookie (role = admin or super_admin)

Token auth processes all organizations. Session auth processes only the admin's org.

### Request

```
GET /api/cron/deal-stage-process?limit=50
```

Query parameters:
- `limit`: maximum events to process per invocation (default 50, max 200).
  Values > 200 are clamped. Non-numeric values use default.

### Response — 200 OK

```json
{
  "success": true,
  "processed": 12,
  "failed": 1,
  "skipped": 0,
  "durationMs": 850
}
```

**Note:** There is no `processing` count. Events go directly from `pending`/`failed`
to `done`/`failed`. See ADL-05.

### Response — 401 Unauthorized

```json
{ "success": false, "message": "Unauthorized" }
```

### Implementation Notes

```
1. Authenticate (token or session)
2. SELECT ... FROM deal_stage_outbox
    WHERE status = 'pending'
       OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
    ORDER BY id
    LIMIT $limit
    FOR UPDATE SKIP LOCKED

3. For each event:
   SAVEPOINT evt_N
   a. Process event (see deal-stage-processing-and-recovery.md)
   b. On success: UPDATE outbox SET status = 'done', processed_at = NOW()
   c. On error:
      ROLLBACK TO SAVEPOINT evt_N
      newAttempts = attempts + 1
      - If newAttempts >= 10: UPDATE outbox SET status = 'failed',
        attempts = newAttempts, next_retry_at = NULL
      - Else: UPDATE outbox SET status = 'failed',
        attempts = newAttempts,
        next_retry_at = NOW() + (2^newAttempts * INTERVAL '30 seconds'),
        error_message = LEFT($error, 500)

4. Return summary
```

GET and POST both supported (Vercel cron sends GET).

Runtime: `export const dynamic = "force-dynamic"; export const runtime = "nodejs";`

---

## 5. Booking Application POST — Outbox Hook (ADL-03)

Not a new endpoint. The existing `POST /api/booking-applications` is extended with
an outbox INSERT in the post-commit CTE.

After the booking is confirmed, the lead is closed, and the outbox event is written:

```sql
WITH confirmed AS (
  UPDATE booking_applications
     SET booking_status = 'Confirmed',
         confirmed_at = NOW()
   WHERE id = $1 AND organization_id = $3
   RETURNING confirmed_at
),
closed AS (
  UPDATE walkin_enquiries SET status = 'Closed'
   WHERE id = $2 AND organization_id = $3
)
INSERT INTO deal_stage_outbox
  (lead_id, event_type, event_ts, event_key, actor_id, payload, organization_id)
SELECT
  $2, 'booking_confirmed', confirmed_at,
  'booking_confirmed:booking_applications:' || $1,
  $6, $7, $3
FROM confirmed
ON CONFLICT (event_key) DO NOTHING
```

Also: after the CTE succeeds, update the booking_initiations row:

```sql
UPDATE booking_initiations SET booking_id = $1 WHERE lead_id = $2
```

---

## 6. Error Responses (Common)

All deal-stage endpoints use the standard CRM response shape:

```json
{ "success": false, "message": "Human-readable error" }
```

Status codes:
- 200: Success (read, or idempotent create that already existed)
- 201: Created (new resource)
- 400: Bad request (invalid lead_id, missing params, empty field value)
- 401: Unauthorized (no session, no token)
- 403: Forbidden (wrong role, not assigned)
- 404: Lead not found (also returned for cross-tenant access — prevents enumeration)
- 409: Conflict (lead already has confirmed booking)
- 500: Internal error
