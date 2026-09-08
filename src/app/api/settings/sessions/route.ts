// api/settings/sessions/route.ts
//
// GET    — list the signed-in user's sessions.
// DELETE — sign out a specific session (or all).
// Consumed by /dashboard/settings/account-security → SessionManager.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "No user ID." }, { status: 400 });
  }

  try {
    const orgId = await getOrganizationId();

    const rows = await query<{
      id: number;
      session_start: string;
      session_end: string | null;
      is_active: boolean;
      device_info: string | null;
      ip_address: string | null;
    }>(
      `SELECT id, session_start, session_end, is_active, device_info, ip_address
         FROM employee_sessions
        WHERE user_id = $1 AND organization_id = $2
        ORDER BY session_start DESC
        LIMIT 20`,
      [userId, orgId]
    );

    // The "current" session is the most recent active one.
    const currentId = rows.find((r) => r.is_active)?.id ?? null;

    const sessions = rows.map((r) => ({
      id: r.id,
      device: r.device_info,
      ipAddress: r.ip_address,
      startedAt: r.session_start,
      endedAt: r.session_end,
      isActive: r.is_active,
      isCurrent: r.id === currentId,
    }));

    return NextResponse.json({ success: true, sessions });
  } catch (err: any) {
    console.error("[GET /api/settings/sessions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "No user ID." }, { status: 400 });
  }

  try {
    const orgId = await getOrganizationId();
    const body = await req.json().catch(() => ({}));
    const sessionId = (body as any).sessionId ?? null;

    if (sessionId) {
      // Sign out a specific session.
      await query(
        `UPDATE employee_sessions
            SET is_active = false, session_end = NOW()
          WHERE id = $1 AND user_id = $2 AND organization_id = $3 AND is_active = true`,
        [sessionId, userId, orgId]
      );
      return NextResponse.json({ success: true, message: "Session signed out." });
    } else {
      // Sign out ALL sessions for this user.
      const result = await query(
        `UPDATE employee_sessions
            SET is_active = false, session_end = NOW()
          WHERE user_id = $1 AND organization_id = $2 AND is_active = true`,
        [userId, orgId]
      );
      return NextResponse.json({ success: true, message: "All sessions signed out." });
    }
  } catch (err: any) {
    console.error("[DELETE /api/settings/sessions]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
