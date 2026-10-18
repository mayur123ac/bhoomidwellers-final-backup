// app/api/hr/connect/requests/[id]/route.ts
//
// GET   — single request detail with messages
// PATCH — update status, priority, assignment (HR only) or close (requester)

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastToUser, broadcastToOrg } from "@/lib/supabase/broadcast";

export const dynamic = "force-dynamic";

const HR_ROLES = ["hr", "admin", "super_admin"];
const norm = (r: unknown) => String(r ?? "").trim().toLowerCase().replace(/_/g, " ");
const VALID_STATUSES = ["open", "in_progress", "awaiting_employee", "resolved", "closed"];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(gate.session._id);
    const role = norm(gate.session.role);
    const isHR = HR_ROLES.includes(role);
    const { id } = await params;
    const requestId = Number(id);

    const rows = await query<any>(
      `SELECT r.*, u.name AS requester_name, u.email AS requester_email,
              h.name AS assigned_hr_name
       FROM hr_requests r
       JOIN users u ON u.id = r.requester_id
       LEFT JOIN users h ON h.id = r.assigned_hr_id
       WHERE r.id = $1 AND r.organization_id = $2`,
      [requestId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Request not found." },
        { status: 404 }
      );
    }

    const r = rows[0];

    // Non-HR can only see their own requests
    if (!isHR && r.requester_id !== userId) {
      return NextResponse.json(
        { success: false, message: "Access denied." },
        { status: 403 }
      );
    }

    // Load messages (non-HR don't see internal notes)
    const messages = await query<any>(
      `SELECT m.id, m.sender_id, m.body, m.attachment_key, m.attachment_name,
              m.is_internal, m.created_at, u.name AS sender_name
       FROM hr_request_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.request_id = $1 AND m.organization_id = $2
       ${isHR ? "" : "AND m.is_internal = FALSE"}
       ORDER BY m.created_at ASC`,
      [requestId, orgId]
    );

    return NextResponse.json({
      success: true,
      data: {
        request: {
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
          resolvedAt: r.resolved_at,
          closedAt: r.closed_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
        messages: messages.map((m: any) => ({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          body: m.body,
          attachmentKey: m.attachment_key,
          attachmentName: m.attachment_name,
          isInternal: m.is_internal,
          createdAt: m.created_at,
        })),
      },
    });
  } catch (err: any) {
    console.error("[GET /api/hr/connect/requests/[id]]", err);
    return NextResponse.json(
      { success: false, message: "Failed to load request." },
      { status: 500 }
    );
  }
}

// ── PATCH ───────────────────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const userId = Number(gate.session._id);
    const role = norm(gate.session.role);
    const isHR = HR_ROLES.includes(role);
    const { id } = await params;
    const requestId = Number(id);
    const body = await req.json();

    // Load request
    const rows = await query<any>(
      `SELECT * FROM hr_requests WHERE id = $1 AND organization_id = $2`,
      [requestId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Request not found." },
        { status: 404 }
      );
    }

    const request = rows[0];

    // Non-HR can only close their own requests
    if (!isHR) {
      if (request.requester_id !== userId) {
        return NextResponse.json(
          { success: false, message: "Access denied." },
          { status: 403 }
        );
      }
      // Employees can only close
      if (body.status && body.status !== "closed") {
        return NextResponse.json(
          { success: false, message: "You can only close your own requests." },
          { status: 400 }
        );
      }
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let p = 1;

    if (body.status && VALID_STATUSES.includes(body.status)) {
      setClauses.push(`status = $${p++}`);
      values.push(body.status);

      if (body.status === "resolved" && request.status !== "resolved") {
        setClauses.push(`resolved_at = now()`);
      }
      if (body.status === "closed" && request.status !== "closed") {
        setClauses.push(`closed_at = now()`);
      }
    }

    if (isHR && body.priority && VALID_PRIORITIES.includes(body.priority)) {
      setClauses.push(`priority = $${p++}`);
      values.push(body.priority);
    }

    if (isHR && body.assignedHrId !== undefined) {
      setClauses.push(`assigned_hr_id = $${p++}`);
      values.push(body.assignedHrId || null);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, message: "No fields to update." },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = now()`);
    values.push(requestId, orgId);

    await query(
      `UPDATE hr_requests SET ${setClauses.join(", ")}
       WHERE id = $${p} AND organization_id = $${p + 1}`,
      values
    );

    // Notify the requester about status changes
    if (body.status && isHR) {
      broadcastToUser(String(orgId), request.requester_id, "hr_connect:status_changed", {
        requestId,
        newStatus: body.status,
        subject: request.subject,
      });
    }

    return NextResponse.json({ success: true, message: "Request updated." });
  } catch (err: any) {
    console.error("[PATCH /api/hr/connect/requests/[id]]", err);
    return NextResponse.json(
      { success: false, message: "Failed to update request." },
      { status: 500 }
    );
  }
}
