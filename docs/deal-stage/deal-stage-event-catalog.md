# Deal Stage Pipeline — Event Catalog

> Version: 2.0 | Date: 2026-11-01 | Status: DESIGN (not implemented)

## 1. Event Summary

| # | Event Type | Stage | Source Endpoint | Source Table | Authoritative Timestamp |
|---|---|---|---|---|---|
| 1 | `lead_assigned` | Fresh | POST /api/walkin_enquiries | walkin_enquiries | walkin_enquiries.created_at |
| 2 | `lead_assigned_from_queue` | Fresh | POST /api/sales-form-submit (via processQueueForManager) | walkin_enquiries | NOW() at queue assignment |
| 3 | `lead_assigned_bulk` | Fresh | POST /api/walkin_enquiries/bulk-import | walkin_enquiries | walkin_enquiries.created_at |
| 4 | `sales_form_submitted` | Contacted | POST /api/sales-form-submit | follow_ups | follow_ups.created_at |
| 5 | `call_completed` | Contacted | POST /api/call-sessions/[id]/complete | follow_ups | follow_ups.created_at |
| 6 | `site_visit_scheduled` | Site Visit | POST /api/site-visits | site_visits | site_visits.created_at |
| 7 | `site_visit_scheduled_via_salesform` | Site Visit | POST /api/sales-form-submit | site_visits | site_visits.created_at |
| 8 | `site_visit_completed` | Negotiation | PATCH /api/site-visits | site_visits | site_visits.completed_at |
| 9 | `booking_initiated` | Sales | POST /api/booking-initiations | booking_initiations | booking_initiations.created_at |
| 10 | `booking_confirmed` | Booked | POST /api/booking-applications (CTE) | booking_applications | booking_applications.confirmed_at |

## 2. Event Details

---

### Event 1: lead_assigned (Direct Assignment)

**Trigger:** Lead created via receptionist form with a non-null `assigned_to_user_id`
(not queued — `isQueuedAssignment = false`).

**Source:** `api/walkin_enquiries/route.ts` POST handler, inside `transaction()`.

**Hook location (VERIFIED):** After the main INSERT at line ~703, when
`effectiveAssignedToId` is non-null and `isQueuedAssignment` is false.

**Event key:** `lead_assigned:walkin_enquiries:{new_lead_id}`

**Payload:**
```json
{
  "source_table": "walkin_enquiries",
  "source_record_id": 1234,
  "assigned_to_user_id": 56
}
```

**Event timestamp:** The new lead's `created_at` (which is `DEFAULT NOW()` in the
same transaction). VERIFIED: no separate `assigned_at` is set during INSERT.

**Transaction boundary (VERIFIED):** Inside existing `transaction()` — safe for
atomic outbox insert.

**Duplicate behavior:** The `uq_dso_event_key` unique index prevents a second
outbox row. An API retry that re-creates the same lead is impossible (the lead
already exists with a unique phone+org combination).

---

### Event 2: lead_assigned_from_queue

**Trigger:** `processQueueForManager()` assigns a queued lead to a Sales Manager
after the SM submits their first sales form.

**Source (VERIFIED):** `lib/walkInQueue.ts:82-91`, called from
`api/sales-form-submit/route.ts` inside `transaction()`.

**Hook location:** After the UPDATE at line ~91 of walkInQueue.ts that sets
`assigned_to` and `assigned_to_user_id` on the lead.

**Event key:** `lead_assigned_from_queue:walkin_enquiries:{lead_id}`

**Payload:**
```json
{
  "source_table": "walkin_enquiries",
  "source_record_id": 1234,
  "assigned_to_user_id": 56,
  "queue_entry_id": 789
}
```

**Event timestamp:** `NOW()` at the moment of assignment (same transaction).
VERIFIED: `walk_in_assignment_queue.assigned_at = NOW()` is set at line ~97.
This is the correct Fresh timestamp — NOT the lead's `created_at`, because the
lead was created earlier in a queued/unassigned state.

**Transaction boundary (VERIFIED):** Inside the sales-form-submit `transaction()`.

**Note:** The sales form that triggered the queue processing also generates a
`sales_form_submitted` event for the *triggering* lead (a different lead_id than
the one being dequeued). These are independent events for independent leads.

---

### Event 3: lead_assigned_bulk

**Trigger:** Bulk import creates leads with non-null `assigned_to_user_id`.

**Source (VERIFIED):** `lib/ingestion/bulkInsertLeads.ts:92-149`, inside
`transaction()`.

**Hook location:** After each INSERT that produces a lead (RETURNING id is
non-empty) with a non-null `assignedToUserId` (resolved at line ~68).

**Event key:** `lead_assigned_bulk:walkin_enquiries:{new_lead_id}`

**Payload:**
```json
{
  "source_table": "walkin_enquiries",
  "source_record_id": 1234,
  "assigned_to_user_id": 56,
  "import_batch": true
}
```

**Event timestamp:** The new lead's `created_at`.

**Transaction boundary (VERIFIED):** Inside bulk import `transaction()` — safe.
All leads in the batch share one transaction, so all outbox events are atomic
with the batch.

**Note (VERIFIED):** Bulk import always sets `assigned_to` and `assigned_to_user_id`
(lines 135-136 and 27-28/46-69). Every successfully inserted lead gets an
assignment. Skipped rows (ON CONFLICT DO NOTHING) do NOT produce outbox events.

---

### Event 4: sales_form_submitted

**Trigger:** Sales Manager submits the sales form for a lead.

**Source (VERIFIED):** `api/sales-form-submit/route.ts` POST handler, inside
`transaction()`.

**Hook location:** After the follow_ups INSERT at line ~110 and the
walkin_enquiries UPDATE at line ~121.

**Event key:** `sales_form_submitted:follow_ups:{follow_up_id}`

**Payload:**
```json
{
  "source_table": "follow_ups",
  "source_record_id": 5678,
  "sales_form_submitted_at": "2026-11-01T10:30:00Z"
}
```

**Event timestamp:** The `follow_ups.created_at` returned by the INSERT.

**Transaction boundary (VERIFIED):** Inside existing `transaction()`.

**Duplicate behavior:** Each sales form submission creates a new follow_ups row with
a unique ID. The event_key includes the follow_up ID, so retries don't create
duplicate outbox events. The stage processor handles the case where Contacted already
exists: if ACTUAL, no-op; if INFERRED, corrected to ACTUAL (ADL-01).

**Site visit from sales form:** If the sales form includes a `siteVisitDate`, a
`site_visit_scheduled_via_salesform` event is ALSO emitted (Event 7). Both events
are in the same transaction. VERIFIED: lines 169-174.

---

### Event 5: call_completed

**Trigger:** Manual call session marked as completed with a non-null `lead_id`.

**Source (VERIFIED):** `api/call-sessions/[id]/complete/route.ts` POST handler,
inside `transaction()`.

**Hook location:** After the follow_ups INSERT at line ~101, inside the transaction.

**Event key:** `call_completed:follow_ups:{follow_up_id}`

**Payload:**
```json
{
  "source_table": "follow_ups",
  "source_record_id": 5679,
  "call_session_id": 321,
  "call_status": "recording_unavailable"
}
```

**Event timestamp:** The `follow_ups.created_at` returned by the INSERT.

**Transaction boundary (VERIFIED):** Inside existing `transaction()` (line 99).

**Exclusions (VERIFIED):**
- Calls with `lead_id = NULL` — lines 66-73 handle this case: session is marked
  completed but no follow_up is created. No outbox event.
- Bolna/AI calls — stored in `bolna_calls` table, separate system. No outbox event.

**Idempotency (VERIFIED):** The call completion endpoint prevents double completion
at line 59 (returns 409 if `follow_up_id IS NOT NULL`). Combined with
`uq_dso_event_key`, duplicates are impossible.

---

### Event 6: site_visit_scheduled

**Trigger:** Site visit created directly via the site-visit scheduling UI.

**Source (VERIFIED):** `api/site-visits/route.ts` POST handler.

**PREREQUISITE (ADL-09):** This endpoint must be wrapped in `transaction()` first.
Currently uses bare `query()` calls (verified at lines 72-131).

**Hook location:** After the site_visits INSERT (line ~106), inside the new
transaction. BEFORE the push notification call (`pushSiteVisit`), which must
remain outside the transaction.

**Event key:** `site_visit_scheduled:site_visits:{site_visit_id}`

**Payload:**
```json
{
  "source_table": "site_visits",
  "source_record_id": 890,
  "visit_date": "2026-11-05T10:00:00Z"
}
```

**Event timestamp:** The `site_visits.created_at` returned by the INSERT (via
RETURNING).

**Duplicate behavior (VERIFIED):** The existing duplicate-datetime check (lines
93-103) prevents two visits at the same time. Combined with `uq_dso_event_key`.

**Cancelled visits:** A cancelled site visit does NOT produce a regression event.
The Site Visit stage, once entered, is permanent.

**Side effects (ADL-09):** The POST handler has two external side effects:
1. `pushSiteVisit()` — FCM push notification (fire-and-forget, `.catch(() => {})`)
2. Follow-up INSERT (database, should be inside transaction)

The push notification must be moved OUTSIDE the new transaction wrapper.
The follow-up INSERT stays INSIDE.

---

### Event 7: site_visit_scheduled_via_salesform

**Trigger:** Sales form includes a `siteVisitDate`, which creates a site_visits row
inside the sales-form-submit transaction.

**Source (VERIFIED):** `api/sales-form-submit/route.ts` POST handler, lines 169-175,
inside `transaction()`.

**Hook location:** After the site_visits INSERT at line ~170, inside the existing
transaction.

**Event key:** `site_visit_scheduled:site_visits:{site_visit_id}`

**Note:** Uses the same event_key prefix as Event 6 (`site_visit_scheduled`) because
the stage effect is identical. The `source_table` is `site_visits` in both cases.
The site_visit_id distinguishes them.

**Payload:** Same structure as Event 6.

**Event timestamp:** The `site_visits.created_at`. Currently the INSERT does NOT
use RETURNING (verified line 170-174). The hook must add RETURNING to capture the
created_at and id.

**Transaction boundary (VERIFIED):** Already inside `transaction()`.

---

### Event 8: site_visit_completed

**Trigger:** Site visit status changed to `completed` via PATCH.

**Source (VERIFIED):** `api/site-visits/route.ts` PATCH handler.

**PREREQUISITE (ADL-09):** This endpoint must be wrapped in `transaction()` first.
Currently uses 4+ independent bare `query()` calls (verified lines 159-231).

**Hook location:** After the `completed_at = NOW()` UPDATE (line ~220), inside the
new transaction.

**Event key:** `site_visit_completed:site_visits:{site_visit_id}`

**Payload:**
```json
{
  "source_table": "site_visits",
  "source_record_id": 890
}
```

**Event timestamp:** The `site_visits.completed_at` set by the UPDATE at line ~220.
The UPDATE uses `SET completed_at = NOW()` — this value must be captured via
RETURNING to use as the event_ts.

**Transaction boundary:** Will be inside new `transaction()` wrapper after ADL-09.

**Side effects (ADL-09):** The PATCH handler's side effects within the `completed`
branch (lines 208-224):
1. Follow-up INSERT ("Site Visit marked as Completed") — database, inside transaction.
2. walkin_enquiries UPDATE (`status = 'Site Visit Done'`) — database, inside transaction.
3. completed_at UPDATE — database, inside transaction.

All are database operations. No external side effects in the completion path.
The entire block can safely be wrapped in a single transaction.

---

### Event 9: booking_initiated (ADL-02)

**Trigger:** First successful server-side booking-form field save. The request
must include at least one non-empty field name-value pair as evidence.

**Source:** `api/booking-initiations/route.ts` (NEW endpoint).

**Hook location:** Inside the new endpoint's transaction, after the
`INSERT ... ON CONFLICT DO NOTHING` succeeds (row was actually inserted).

**Event key:** `booking_initiated:booking_initiations:{initiation_id}`

**Payload:**
```json
{
  "source_table": "booking_initiations",
  "source_record_id": 45,
  "saved_field_name": "primary_name"
}
```

**Event timestamp:** The `booking_initiations.created_at`.

**Transaction boundary:** New endpoint uses `transaction()`.

**Idempotency:** The `ON CONFLICT (lead_id) DO NOTHING` means only the first call
per lead creates a row and an outbox event. Subsequent calls return the existing
row without inserting an outbox event.

**What does NOT trigger this event:**
- Opening the booking form in the browser.
- Updating sessionStorage.
- A request with an empty field value.
- A request that is rejected (validation failure, 403, etc.).
- A failed database INSERT.

---

### Event 10: booking_confirmed (ADL-03)

**Trigger:** Booking created, status flipped to Confirmed, and inventory reserved.

**Source (VERIFIED):** `api/booking-applications/route.ts` POST handler.

**Architecture:** The outbox event is written in the post-commit CTE, atomic with
the booking confirmation and lead closure. NOT inside the main transaction.

**Implementation:**

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
  $2, 'booking_confirmed', confirmed_at, $5, $6, $7, $3
FROM confirmed
ON CONFLICT (event_key) DO NOTHING
```

The `SELECT FROM confirmed` ensures the outbox INSERT only executes if the
confirmation UPDATE actually matched a row. If the booking was already confirmed
or doesn't exist, no outbox event is created.

**Event key:** `booking_confirmed:booking_applications:{booking_id}`

**Payload:**
```json
{
  "source_table": "booking_applications",
  "source_record_id": 67,
  "booking_number": "BK-2026-11-01-00067"
}
```

**Event timestamp:** `booking_applications.confirmed_at` — set by the CTE to
`NOW()` at CTE execution time. This is the authoritative confirmation moment,
not `created_at` (which is the booking creation time, potentially seconds earlier).

**Inventory invariant:** `syncBookingUnit()` runs INSIDE the main transaction
(verified: line 767). The inventory unit is marked 'booked' with FOR UPDATE
locking (verified: inventorySync.ts line 111) BEFORE the CTE fires. If the
inventory sync fails, the entire main transaction rolls back, the CTE never
executes, and no Booked event is created.

**Also (post-CTE):** Update the booking_initiations row:
```sql
UPDATE booking_initiations SET booking_id = $1 WHERE lead_id = $2
```
This links the initiation to the completed booking. Best-effort: failure does
not affect the booking or the outbox event.

---

## 3. Events That Do NOT Produce Outbox Entries

| Event | Reason |
|---|---|
| Lead creation without assignment (queued) | No SM assigned yet. Fresh fires only on actual assignment |
| Lead reassignment (PUT /api/walkin_enquiries/[id]) | Preserves existing stage. No new Fresh |
| Lead transfer (POST /api/leads/transfer) | Preserves existing stage. No new Fresh |
| Call session creation (POST /api/call-sessions) | Merely starting a call does not qualify. Only completion does |
| Bolna/AI call completion | Excluded by design. AI calls do not qualify for Contacted |
| Site visit cancellation | No regression. Stage persists |
| Site visit rescheduling | Original Site Visit stage persists |
| Booking cancellation | No regression. Booked stage persists |
| Booking reactivation | No regression. Booked stage already recorded |
| Booking form opened in browser | Browser-only. No server event. See ADL-02 |
| sessionStorage draft save | Browser-only. No server event |
| Booking initiation with empty field value | Rejected by server. No outbox event |

## 4. Late-Event Behavior (ADL-01)

When events are processed out of chronological order:

| Scenario | Result |
|---|---|
| Higher stage processed first, lower stage arrives | Lower stage corrects INFERRED→ACTUAL if applicable |
| Same stage from two events (e.g., sales form + call → Contacted) | First event wins. Second is no-op or corrects INFERRED |
| Event for a stage that is already ACTUAL | No-op. Outbox event marked 'done' |
| Event with timestamp later than existing INFERRED | transition_type corrected to ACTUAL; entered_at kept (earlier value) |
| Event with timestamp earlier than existing INFERRED | transition_type corrected to ACTUAL; entered_at updated to earlier value |
