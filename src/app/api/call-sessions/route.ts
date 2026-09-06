import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export async function POST(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json().catch(() => ({}));
    const { leadId, callerLeadId } = body;

    if (!leadId && !callerLeadId) {
      return NextResponse.json(
        { success: false, message: "leadId or callerLeadId is required" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();
    let phoneNumber: string | null = null;

    // Server resolves phone from DB — never trust client-supplied numbers.
    if (leadId) {
      const rows = await query<{ phone: string }>(
        `SELECT phone FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
        [leadId, orgId]
      );
      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, message: "Lead not found" },
          { status: 404 }
        );
      }
      phoneNumber = rows[0].phone;
    } else if (callerLeadId) {
      const rows = await query<{ phone: string }>(
        `SELECT phone FROM caller_leads WHERE id = $1 AND organization_id = $2`,
        [callerLeadId, orgId]
      );
      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, message: "Caller lead not found" },
          { status: 404 }
        );
      }
      phoneNumber = rows[0].phone;
    }

    if (!phoneNumber || phoneNumber.replace(/\D/g, "").length < 10) {
      return NextResponse.json(
        { success: false, message: "No valid phone number on record" },
        { status: 400 }
      );
    }

    const userName = gate.session.name || gate.session.email || "Unknown";

    const rows = await query<{ id: number; created_at: string }>(
      `INSERT INTO call_sessions
         (organization_id, lead_id, caller_lead_id, user_id, user_name, phone_number, status, direction)
       VALUES ($1, $2, $3, $4, $5, $6, 'initiated', 'outbound')
       RETURNING id, created_at`,
      [orgId, leadId || null, callerLeadId || null, gate.userId, userName, phoneNumber]
    );

    return NextResponse.json({
      success: true,
      callSessionId: rows[0].id,
      phoneNumber: phoneNumber.replace(/\D/g, ""),
      createdAt: rows[0].created_at,
    });
  } catch (error) {
    console.error("POST /api/call-sessions error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to create call session" },
      { status: 500 }
    );
  }
}
