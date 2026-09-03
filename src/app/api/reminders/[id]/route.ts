// api/reminders/[id]/route.ts — Update a reminder (complete, cancel, reschedule).
//
// PATCH: transition reminder state.
//   action: 'complete' | 'cancel' | 'reschedule'
//   remindAt: required for 'reschedule' only
//
// Authorization:
//   - Owner (assigned_user_id = session user): complete, cancel, reschedule
//   - Admin: complete, cancel any reminder in org (not reschedule others')

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastReminderUpdated, type ReminderPayload } from "@/lib/reminderEvents";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = getSessionUserId(gate.session);
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Could not resolve user id." },
      { status: 401 },
    );
  }

  const orgId = await getOrganizationId();
  const { id: idParam } = await params;
  const reminderId = Number(idParam);
  if (!Number.isFinite(reminderId) || reminderId <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid reminder id." },
      { status: 400 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { action, remindAt } = body;
  if (!action || !["complete", "cancel", "reschedule"].includes(action)) {
    return NextResponse.json(
      { success: false, message: "action must be 'complete', 'cancel', or 'reschedule'." },
      { status: 400 },
    );
  }

  // ── Fetch the reminder (org-scoped) ─────────────────────────────────────
  const existing = await query<any>(
    `SELECT r.*, w.name AS lead_name, w.phone AS lead_phone, u.name AS assigned_user_name
       FROM lead_reminders r
       JOIN walkin_enquiries w ON w.id = r.lead_id
       JOIN users u ON u.id = r.assigned_user_id
      WHERE r.id = $1 AND r.organization_id = $2`,
    [reminderId, orgId],
  );

  if (existing.length === 0) {
    return NextResponse.json(
      { success: false, message: "Reminder not found." },
      { status: 404 },
    );
  }

  const reminder = existing[0];

  // ── Authorization ───────────────────────────────────────────────────────
  const isOwner = reminder.assigned_user_id === userId;
  const role = (gate.session.role ?? "").trim().toLowerCase().replace(/_/g, " ");
  const isAdmin = role === "admin" || role === "super admin";

  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { success: false, message: "You can only modify your own reminders." },
      { status: 403 },
    );
  }

  // Admin cannot reschedule someone else's reminder (only owner can)
  if (action === "reschedule" && !isOwner) {
    return NextResponse.json(
      { success: false, message: "Only the reminder owner can reschedule." },
      { status: 403 },
    );
  }

  // ── State transition validation ─────────────────────────────────────────
  // complete: pending | notified -> completed
  // cancel:   pending | notified -> cancelled
  // reschedule: pending | notified -> pending (with new remind_at)
  if (reminder.status === "completed" || reminder.status === "cancelled") {
    return NextResponse.json(
      { success: false, message: `Cannot ${action} a ${reminder.status} reminder.` },
      { status: 409 },
    );
  }

  let updated: any;
  let followUpMessage: string;

  if (action === "complete") {
    const rows = await query<any>(
      `UPDATE lead_reminders
          SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'notified')
        RETURNING *`,
      [reminderId],
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Reminder already transitioned." },
        { status: 409 },
      );
    }
    updated = rows[0];
    const noteLabel = reminder.note ? `: ${reminder.note}` : "";
    followUpMessage = `\u2705 Reminder completed${noteLabel}`;

  } else if (action === "cancel") {
    const rows = await query<any>(
      `UPDATE lead_reminders
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'notified')
        RETURNING *`,
      [reminderId],
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Reminder already transitioned." },
        { status: 409 },
      );
    }
    updated = rows[0];
    const noteLabel = reminder.note ? `: ${reminder.note}` : "";
    followUpMessage = `\u274C Reminder cancelled${noteLabel}`;

  } else {
    // reschedule
    if (!remindAt) {
      return NextResponse.json(
        { success: false, message: "remindAt is required for reschedule." },
        { status: 400 },
      );
    }
    const newDate = new Date(remindAt);
    if (Number.isNaN(newDate.getTime())) {
      return NextResponse.json(
        { success: false, message: "Invalid remindAt datetime." },
        { status: 400 },
      );
    }
    if (newDate.getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, message: "remindAt must be in the future." },
        { status: 400 },
      );
    }
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    if (newDate.getTime() > Date.now() + ninetyDaysMs) {
      return NextResponse.json(
        { success: false, message: "remindAt must be within 90 days." },
        { status: 400 },
      );
    }

    const rows = await query<any>(
      `UPDATE lead_reminders
          SET status = 'pending', remind_at = $2, notified_at = NULL, updated_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'notified')
        RETURNING *`,
      [reminderId, newDate.toISOString()],
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Reminder already transitioned." },
        { status: 409 },
      );
    }
    updated = rows[0];
    const dateLabel = newDate.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    followUpMessage = `\uD83D\uDD14 Reminder rescheduled to ${dateLabel}`;
  }

  // ── Auto-log to follow_ups ──────────────────────────────────────────────
  await query(
    `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, organization_id)
     VALUES ($1, $2, $3, $5, $4)`,
    [reminder.lead_id, followUpMessage, gate.session.name, orgId, gate.userId],
  );

  // ── Broadcast SSE ───────────────────────────────────────────────────────
  const payload: ReminderPayload = {
    id: updated.id,
    leadId: updated.lead_id,
    leadName: reminder.lead_name,
    leadPhone: reminder.lead_phone,
    assignedUserId: updated.assigned_user_id,
    assignedUserName: reminder.assigned_user_name,
    createdByName: updated.created_by_name,
    reminderType: updated.reminder_type,
    note: updated.note,
    remindAt: updated.remind_at?.toISOString?.() ?? "",
    status: updated.status,
    notifiedAt: updated.notified_at?.toISOString?.() ?? null,
    completedAt: updated.completed_at?.toISOString?.() ?? null,
    cancelledAt: updated.cancelled_at?.toISOString?.() ?? null,
    createdAt: updated.created_at?.toISOString?.() ?? "",
  };
  broadcastReminderUpdated(orgId, payload);

  return NextResponse.json({ success: true, data: payload });
}
