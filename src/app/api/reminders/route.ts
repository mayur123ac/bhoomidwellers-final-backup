// api/reminders/route.ts — Create and list lead reminders.
//
// POST: create a reminder for the current user on a specific lead.
// GET:  list reminders (own or org-wide depending on role).
//
// Security:
//   - assigned_user_id is ALWAYS the session user (never from request)
//   - lead_id is verified to belong to the session's organization
//   - organization_id comes from the signed session via getOrganizationId()

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastReminderCreated, type ReminderPayload } from "@/lib/reminderEvents";

export const dynamic = "force-dynamic";

// ── POST: Create reminder ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = getSessionUserId(gate.session);
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Could not resolve user id from session." },
      { status: 401 },
    );
  }

  const orgId = await getOrganizationId();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { leadId, remindAt, note, reminderType } = body;

  // ── Validate required fields ────────────────────────────────────────────
  if (!leadId || !remindAt) {
    return NextResponse.json(
      { success: false, message: "Missing required fields: leadId, remindAt." },
      { status: 400 },
    );
  }

  const numericLeadId = Number(leadId);
  if (!Number.isFinite(numericLeadId) || numericLeadId <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid leadId." },
      { status: 400 },
    );
  }

  // ── Validate remindAt ───────────────────────────────────────────────────
  const remindAtDate = new Date(remindAt);
  if (Number.isNaN(remindAtDate.getTime())) {
    return NextResponse.json(
      { success: false, message: "Invalid remindAt datetime." },
      { status: 400 },
    );
  }
  if (remindAtDate.getTime() <= Date.now()) {
    return NextResponse.json(
      { success: false, message: "remindAt must be in the future." },
      { status: 400 },
    );
  }
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  if (remindAtDate.getTime() > Date.now() + ninetyDaysMs) {
    return NextResponse.json(
      { success: false, message: "remindAt must be within 90 days." },
      { status: 400 },
    );
  }

  // ── Validate note length ────────────────────────────────────────────────
  const trimmedNote = note ? String(note).trim().slice(0, 500) : null;

  // ── Validate reminderType ───────────────────────────────────────────────
  const validTypes = ["follow_up", "callback", "site_visit", "payment", "document"];
  const type = reminderType && validTypes.includes(reminderType) ? reminderType : "follow_up";

  // ── Verify lead belongs to this organization ────────────────────────────
  const leadRows = await query<{ id: number; name: string; phone: string; status: string; is_lost_lead: boolean }>(
    `SELECT id, name, phone, status, COALESCE(is_lost_lead, false) AS is_lost_lead
       FROM walkin_enquiries
      WHERE id = $1 AND organization_id = $2`,
    [numericLeadId, orgId],
  );

  if (leadRows.length === 0) {
    return NextResponse.json(
      { success: false, message: "Lead not found." },
      { status: 404 },
    );
  }

  // ── INSERT reminder ─────────────────────────────────────────────────────
  const rows = await query<any>(
    `INSERT INTO lead_reminders
       (lead_id, organization_id, assigned_user_id, created_by_id, created_by_name,
        reminder_type, note, remind_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      numericLeadId,
      orgId,
      userId,              // assigned_user_id = session user, never from request
      userId,              // created_by_id = session user
      gate.session.name,   // denormalized display name
      type,
      trimmedNote,
      remindAtDate.toISOString(),
    ],
  );

  const reminder = rows[0];

  // ── Auto-log to follow_ups ──────────────────────────────────────────────
  const dateLabel = remindAtDate.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const noteLabel = trimmedNote ? `: ${trimmedNote}` : "";
  await query(
    `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, organization_id)
     VALUES ($1, $2, $3, $5, $4)`,
    [
      numericLeadId,
      `\uD83D\uDD14 Follow-up reminder set for ${dateLabel}${noteLabel}`,
      gate.session.name,
      orgId,
      gate.userId,
    ],
  );

  // ── Broadcast SSE ───────────────────────────────────────────────────────
  const lead = leadRows[0];
  const payload: ReminderPayload = {
    id: reminder.id,
    leadId: reminder.lead_id,
    leadName: lead.name,
    leadPhone: lead.phone,
    assignedUserId: reminder.assigned_user_id,
    assignedUserName: gate.session.name,
    createdByName: reminder.created_by_name,
    reminderType: reminder.reminder_type,
    note: reminder.note,
    remindAt: reminder.remind_at?.toISOString?.() ?? remindAtDate.toISOString(),
    status: reminder.status,
    notifiedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: reminder.created_at?.toISOString?.() ?? new Date().toISOString(),
  };
  broadcastReminderCreated(orgId, payload);

  return NextResponse.json(
    { success: true, data: payload },
    { status: 201 },
  );
}

// ── GET: List reminders ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = getSessionUserId(gate.session);
  const orgId = await getOrganizationId();

  const params = req.nextUrl.searchParams;
  const leadIdParam = params.get("lead_id");
  const statusParam = params.get("status");
  const assignedTo = params.get("assigned_to"); // "me" or omitted

  // ── Role-based scoping ──────────────────────────────────────────────────
  // Admin / Site Head: see all org reminders (unless filtered to "me")
  // Everyone else: only own reminders
  const role = (gate.session.role ?? "").trim().toLowerCase().replace(/_/g, " ");
  const isWholeSite = role === "admin" || role === "site head" || role === "super admin";
  const onlyMine = !isWholeSite || assignedTo === "me";

  // ── Build query ─────────────────────────────────────────────────────────
  const conditions: string[] = ["r.organization_id = $1"];
  const queryParams: any[] = [orgId];
  let paramIdx = 2;

  if (onlyMine && userId) {
    conditions.push(`r.assigned_user_id = $${paramIdx}`);
    queryParams.push(userId);
    paramIdx++;
  }

  if (leadIdParam) {
    const lid = Number(leadIdParam);
    if (Number.isFinite(lid) && lid > 0) {
      conditions.push(`r.lead_id = $${paramIdx}`);
      queryParams.push(lid);
      paramIdx++;
    }
  }

  if (statusParam) {
    const validStatuses = ["pending", "notified", "completed", "cancelled"];
    const statuses = statusParam.split(",").filter((s) => validStatuses.includes(s));
    if (statuses.length > 0) {
      conditions.push(`r.status = ANY($${paramIdx})`);
      queryParams.push(statuses);
      paramIdx++;
    }
  } else {
    // Default: pending + notified (active reminders)
    conditions.push(`r.status IN ('pending', 'notified')`);
  }

  const whereClause = conditions.join(" AND ");

  const rows = await query<any>(
    `SELECT r.id, r.lead_id, r.organization_id, r.assigned_user_id,
            r.created_by_id, r.created_by_name, r.reminder_type, r.note,
            r.remind_at, r.status, r.notified_at, r.completed_at,
            r.cancelled_at, r.created_at, r.updated_at,
            w.name AS lead_name, w.phone AS lead_phone, w.sr_no,
            w.budget, w.configuration, w.property_type,
            u.name AS assigned_user_name
       FROM lead_reminders r
       JOIN walkin_enquiries w ON w.id = r.lead_id
       JOIN users u ON u.id = r.assigned_user_id
      WHERE ${whereClause}
      ORDER BY r.remind_at ASC
      LIMIT 200`,
    queryParams,
  );

  const data = rows.map((r: any) => ({
    id: r.id,
    leadId: r.lead_id,
    leadName: r.lead_name,
    leadPhone: r.lead_phone,
    leadSrNo: r.sr_no,
    leadBudget: r.budget,
    leadConfiguration: r.configuration,
    leadPropertyType: r.property_type,
    assignedUserId: r.assigned_user_id,
    assignedUserName: r.assigned_user_name,
    createdById: r.created_by_id,
    createdByName: r.created_by_name,
    reminderType: r.reminder_type,
    note: r.note,
    remindAt: r.remind_at,
    status: r.status,
    notifiedAt: r.notified_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({ success: true, data });
}
