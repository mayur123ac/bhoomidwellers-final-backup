// services/reminder.service.ts — the durable reminder processor.
//
// Called by the cron endpoint (/api/reminders/process). Queries due reminders,
// marks them notified, broadcasts SSE, logs to follow_ups, and dispatches to
// external channels (Web Push, FCM — when registered).
//
// Mirrors the whatsapp.service.ts processDue() pattern:
//   FOR UPDATE SKIP LOCKED — safe for concurrent cron invocations
//   Batch limit — prevents runaway processing
//   Per-row error isolation — one failure doesn't stop the batch

import { query, transaction } from "@/lib/db";
import {
  broadcastReminderDue,
  dispatchToExternalChannels,
  type ReminderPayload,
} from "@/lib/reminderEvents";

interface ProcessReport {
  processed: number;
  failed: number;
  errors: { reminderId: number; error: string }[];
}

/**
 * Process all reminders that are due.
 *
 * @param limit   Max reminders to process in one sweep (default 100).
 * @param orgId   If set, only process reminders for this organization.
 *                null = process all organizations (platform cron).
 */
export async function processReminders(
  limit = 100,
  orgId: string | null = null,
): Promise<ProcessReport> {
  const report: ProcessReport = { processed: 0, failed: 0, errors: [] };

  // ── 1. Fetch due reminders with FOR UPDATE SKIP LOCKED ────────────────
  //
  // SKIP LOCKED: if two cron invocations overlap, the second one skips rows
  // already locked by the first. No duplicate processing.
  const orgClause = orgId ? "AND r.organization_id = $2" : "";
  const params: any[] = [limit];
  if (orgId) params.push(orgId);

  const dueRows = await query<{
    id: number;
    lead_id: number;
    organization_id: string;
    assigned_user_id: number;
    created_by_name: string;
    reminder_type: string;
    note: string | null;
    remind_at: string;
    status: string;
    created_at: string;
    lead_name: string;
    lead_phone: string;
    assigned_user_name: string;
  }>(
    `SELECT r.id, r.lead_id, r.organization_id, r.assigned_user_id,
            r.created_by_name, r.reminder_type, r.note, r.remind_at,
            r.status, r.created_at,
            w.name AS lead_name, w.phone AS lead_phone,
            u.name AS assigned_user_name
       FROM lead_reminders r
       JOIN walkin_enquiries w ON w.id = r.lead_id
       JOIN users u ON u.id = r.assigned_user_id
      WHERE r.status = 'pending'
        AND r.remind_at <= NOW()
        ${orgClause}
      ORDER BY r.remind_at ASC
      LIMIT $1
        FOR UPDATE OF r SKIP LOCKED`,
    params,
  );

  // ── 2. Process each reminder ──────────────────────────────────────────
  for (const row of dueRows) {
    try {
      await transaction(async (client) => {
        // Mark notified (atomic — the FOR UPDATE lock is on the connection that
        // fetched the rows, but we're in a new transaction here. The SKIP LOCKED
        // above ensures no other worker has this row. We re-check status to be
        // safe against race conditions.)
        const updated = await client.query(
          `UPDATE lead_reminders
              SET status = 'notified', notified_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING *`,
          [row.id],
        );

        if (updated.rows.length === 0) {
          // Another worker got it, or it was cancelled in the meantime. Skip.
          return;
        }

        const notified = updated.rows[0];

        // Auto-log to follow_ups
        const reminderLabel = row.reminder_type === "follow_up"
          ? "Follow-up"
          : row.reminder_type === "callback"
          ? "Callback"
          : row.reminder_type === "site_visit"
          ? "Site Visit"
          : row.reminder_type === "payment"
          ? "Payment"
          : row.reminder_type === "document"
          ? "Document"
          : "Follow-up";

        const noteText = row.note ? `: ${row.note}` : "";
        await client.query(
          `INSERT INTO follow_ups (lead_id, message, created_by_name, organization_id)
           VALUES ($1, $2, $3, $4)`,
          [
            row.lead_id,
            `\uD83D\uDD14 ${reminderLabel} reminder is due${noteText}`,
            row.created_by_name,
            row.organization_id,
          ],
        );

        // Build payload for SSE + external channels
        const payload: ReminderPayload = {
          id: row.id,
          leadId: row.lead_id,
          leadName: row.lead_name,
          leadPhone: row.lead_phone,
          assignedUserId: row.assigned_user_id,
          assignedUserName: row.assigned_user_name,
          createdByName: row.created_by_name,
          reminderType: row.reminder_type,
          note: row.note,
          remindAt: row.remind_at,
          status: "notified",
          notifiedAt: notified.notified_at?.toISOString?.() ?? new Date().toISOString(),
          completedAt: null,
          cancelledAt: null,
          createdAt: row.created_at,
        };

        // SSE broadcast (synchronous, in-process)
        broadcastReminderDue(row.organization_id, payload);

        // External channels (Web Push, FCM — when registered)
        const channelErrors = await dispatchToExternalChannels(row.organization_id, payload);
        if (channelErrors.length > 0) {
          console.warn(
            `[REMINDER] id=${row.id} external channel errors:`,
            channelErrors,
          );
        }
      });

      report.processed++;
    } catch (err: any) {
      report.failed++;
      report.errors.push({ reminderId: row.id, error: err.message });
      console.error(`[REMINDER] failed to process id=${row.id}:`, err.message);
    }
  }

  if (report.processed > 0 || report.failed > 0) {
    console.log(
      `[REMINDER] processed=${report.processed} failed=${report.failed}`,
    );
  }

  return report;
}
