// app/api/hr/connect/requests/[id]/messages/route.ts
//
// POST — add a message (reply) to an HR Connect request.
// Employees can reply to their own requests. HR can reply to any.
// HR can also post internal notes (is_internal = true).

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastToUser, broadcastToOrg } from "@/lib/supabase/broadcast";

export const dynamic = "force-dynamic";

const HR_ROLES = ["hr", "admin", "super_admin"];
const norm = (r: unknown) => String(r ?? "").trim().toLowerCase().replace(/_/g, " ");

export async function POST(
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
    const { body: messageBody, isInternal, attachmentKey, attachmentName } = body;

    if (!messageBody?.trim()) {
      return NextResponse.json(
        { success: false, message: "Message body is required." },
        { status: 400 }
      );
    }

    // Verify request exists and user has access
    const rows = await query<any>(
      `SELECT r.id, r.requester_id, r.status, r.subject, r.organization_id
       FROM hr_requests r
       WHERE r.id = $1 AND r.organization_id = $2`,
      [requestId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Request not found." },
        { status: 404 }
      );
    }

    const request = rows[0];

    // Non-HR can only message their own requests
    if (!isHR && request.requester_id !== userId) {
      return NextResponse.json(
        { success: false, message: "Access denied." },
        { status: 403 }
      );
    }

    // Don't allow messages on closed requests
    if (request.status === "closed") {
      return NextResponse.json(
        { success: false, message: "Cannot add messages to a closed request." },
        { status: 400 }
      );
    }

    // Only HR can post internal notes
    const internal = isHR && isInternal === true;

    const msgRows = await query<any>(
      `INSERT INTO hr_request_messages
         (organization_id, request_id, sender_id, body, attachment_key, attachment_name, is_internal)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [orgId, requestId, userId, messageBody.trim(),
       attachmentKey || null, attachmentName || null, internal]
    );

    // Update request timestamp
    await query(
      `UPDATE hr_requests SET updated_at = now() WHERE id = $1`,
      [requestId]
    );

    // Notify
    if (isHR && !internal) {
      // HR replied — notify employee
      broadcastToUser(String(orgId), request.requester_id, "hr_connect:new_message", {
        requestId,
        subject: request.subject,
        senderId: userId,
      });
    } else if (!isHR) {
      // Employee replied — notify HR org-wide
      broadcastToOrg(String(orgId), "hr_connect:employee_reply", {
        requestId,
        subject: request.subject,
        senderId: userId,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        messageId: msgRows[0].id,
        createdAt: msgRows[0].created_at,
      },
      message: internal ? "Internal note added." : "Message sent.",
    }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/hr/connect/requests/[id]/messages]", err);
    return NextResponse.json(
      { success: false, message: "Failed to send message." },
      { status: 500 }
    );
  }
}
