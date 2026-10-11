// src/lib/walkInQueue.ts
//
// Shared queue logic for sequential walk-in lead assignment.
//
// A manager is ELIGIBLE for the next queued walk-in enquiry when they have NO
// currently active receptionist_submitted lead whose sales form has not yet been
// submitted (i.e. sales_form_submitted_at IS NULL).
//
// "Active" means: assigned_to_user_id = smUserId, receptionist_submitted = true,
//   sales_form_submitted_at IS NULL, not lost, status not terminal.
//
// Concurrency: callers must hold pg_advisory_xact_lock(hashtext('wiq_' || orgId || '_' || smUserId))
// before calling isManagerEligible or processQueueForManager so that two concurrent
// receptionist submissions for the same SM do not race.

import type { PoolClient } from "pg";

/**
 * Returns true when the SM has no outstanding unreworked receptionist lead.
 * Must be called inside a transaction that holds the per-SM advisory lock.
 */
export async function isManagerEligible(
  client: PoolClient,
  smUserId: number,
  orgId: string
): Promise<boolean> {
  const res = await client.query<{ id: number }>(
    `SELECT id
     FROM walkin_enquiries
     WHERE assigned_to_user_id   = $1
       AND organization_id       = $2
       AND receptionist_submitted = true
       AND sales_form_submitted_at IS NULL
       AND is_lost_lead           = false
       AND status NOT IN ('Closing', 'Closed', 'Pending Assignment')
     LIMIT 1`,
    [smUserId, orgId]
  );
  return res.rows.length === 0;
}

/**
 * Assigns the oldest pending queue entry for this SM, if any.
 * Must be called inside the same transaction as the sales-form commit.
 *
 * Returns the assigned lead_id on success, or null if the queue was empty.
 */
export async function processQueueForManager(
  client: PoolClient,
  smUserId: number,
  smName: string,
  orgId: string
): Promise<number | null> {
  // Lock the oldest pending queue row — SKIP LOCKED means two concurrent callers
  // (e.g. two simultaneous form submissions) each get a different row rather than
  // blocking each other.
  const queueRes = await client.query<{ queue_id: number; lead_id: number }>(
    `SELECT id AS queue_id, lead_id
     FROM walk_in_assignment_queue
     WHERE organization_id   = $1
       AND target_sm_user_id = $2
       AND status            = 'pending'
     ORDER BY queued_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [orgId, smUserId]
  );

  if (queueRes.rows.length === 0) return null;

  const { queue_id, lead_id } = queueRes.rows[0];

  // Assign the lead to the SM.
  await client.query(
    `UPDATE walkin_enquiries
     SET assigned_to         = $1,
         assigned_to_user_id = $2,
         status              = 'Assigned',
         last_activity_at    = NOW()
     WHERE id              = $3
       AND organization_id = $4`,
    [smName, smUserId, lead_id, orgId]
  );

  // Mark the queue entry as fulfilled.
  await client.query(
    `UPDATE walk_in_assignment_queue
     SET status      = 'assigned',
         assigned_at = NOW()
     WHERE id = $1`,
    [queue_id]
  );

  // Audit trail — mirrors the pattern in the [id] PUT route.
  await client.query(
    `INSERT INTO lead_assignment_logs
       (lead_id, assigned_to, assigned_by, assigned_at, reason, organization_id)
     VALUES ($1, $2, 'system (sequential queue)', NOW(),
             'Walk-in sequential queue assignment', $3)`,
    [lead_id, smName, orgId]
  );

  return lead_id;
}
