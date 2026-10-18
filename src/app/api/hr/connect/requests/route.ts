// app/api/hr/connect/requests/route.ts
//
// GET  — list requests (HR sees all for org, employees see only their own)
// POST — create a new request (any authenticated user)

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

export const dynamic = "force-dynamic";

const HR_ROLES = ["hr", "admin", "super_admin"];
const norm = (r: unknown) => String(r ?? "").trim().toLowerCase().replace(/_/g, " ");

const VALID_CATEGORIES = ["leave", "salary", "attendance", "documents", "policy", "grievance", "other"];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(gate.session._id);
    const role = norm(gate.session.role);
    const isHR = HR_ROLES.includes(role);

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || null;
    const category = sp.get("category") || null;
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "50")));
    const offset = Math.max(0, Number(sp.get("offset") || "0"));

    const conditions: string[] = ["r.organization_id = $1"];
    const values: any[] = [orgId];
    let idx = 2;

    // Non-HR users can only see their own requests
    if (!isHR) {
      conditions.push(`r.requester_id = $${idx++}`);
      values.push(userId);
    }

    if (status) {
      conditions.push(`r.status = $${idx++}`);
      values.push(status);
    }
    if (category) {
      conditions.push(`r.category = $${idx++}`);
      values.push(category);
    }

    const where = conditions.join(" AND ");

    const rows = await query<any>(
      `SELECT r.id, r.requester_id, r.assigned_hr_id, r.category, r.subject,
              r.priority, r.status, r.resolved_at, r.closed_at,
              r.created_at, r.updated_at,
              u.name AS requester_name, u.email AS requester_email,
              h.name AS assigned_hr_name,
              (SELECT COUNT(*) FROM hr_request_messages m
               WHERE m.request_id = r.id
               ${isHR ? "" : "AND m.is_internal = FALSE"}) AS message_count
       FROM hr_requests r
       JOIN users u ON u.id = r.requester_id
       LEFT JOIN users h ON h.id = r.assigned_hr_id
       WHERE ${where}
       ORDER BY
         CASE r.status
           WHEN 'open' THEN 0
           WHEN 'in_progress' THEN 1
           WHEN 'awaiting_employee' THEN 2
           WHEN 'resolved' THEN 3
           WHEN 'closed' THEN 4
         END,
         CASE r.priority
           WHEN 'urgent' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           WHEN 'low' THEN 3
         END,
         r.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    const countResult = await query<any>(
      `SELECT COUNT(*) AS total FROM hr_requests r WHERE ${where}`,
      values
    );

    return NextResponse.json({
      success: true,
      data: {
        requests: rows.map((r: any) => ({
          id: r.id,
          requesterId: r.requester_id,
          requesterName: r.requester_name,
          requesterEmail: r.requester_email,
          assignedHrId: r.assigned_hr_id,
          assignedHrName: r.assigned_hr_name,
          category: r.category,
          subject: r.subject,
          priority: r.priority,
          status: r.status,
          messageCount: Number(r.message_count),
          resolvedAt: r.resolved_at,
          closedAt: r.closed_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
        total: Number(countResult[0]?.total || 0),
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/connect/requests]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load requests." },
      { status: 500 }
    );
  }
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(gate.session._id);
    const body = await req.json();

    const { category, subject, priority, body: messageBody } = body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { success: false, message: `Category must be one of: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!subject?.trim()) {
      return NextResponse.json(
        { success: false, message: "Subject is required." },
        { status: 400 }
      );
    }
    if (!messageBody?.trim()) {
      return NextResponse.json(
        { success: false, message: "Message body is required." },
        { status: 400 }
      );
    }
    const prio = priority && VALID_PRIORITIES.includes(priority) ? priority : "normal";

    // Create request
    const rows = await query<any>(
      `INSERT INTO hr_requests (organization_id, requester_id, category, subject, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [orgId, userId, category, subject.trim(), prio]
    );
    const requestId = rows[0].id;

    // Create initial message
    await query(
      `INSERT INTO hr_request_messages (organization_id, request_id, sender_id, body)
       VALUES ($1, $2, $3, $4)`,
      [orgId, requestId, userId, messageBody.trim()]
    );

    // Broadcast to HR
    broadcastToOrg(String(orgId), "hr_connect:new_request", {
      requestId,
      category,
      subject: subject.trim(),
      requesterId: userId,
    });

    return NextResponse.json(
      { success: true, data: { requestId }, message: "Request submitted to HR." },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/hr/connect/requests]", err);
    return NextResponse.json(
      { success: false, message: "Failed to create request." },
      { status: 500 }
    );
  }
}
