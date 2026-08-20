// app/api/settings/sessions/route.ts — active login sessions.
//
// Backed by `employee_sessions`, which the login route already writes and the
// attendance heartbeat already updates. Nothing new is recorded here.
//
// ── What "sign out" can and cannot do ───────────────────────────────────────
// Auth is a stateless signed cookie with no server-side revocation list, so
// closing a row here ends the TRACKED session — it stops the heartbeat, ends the
// attendance timer, and removes it from this list — but it does not tear up a
// cookie already sitting in another browser. That browser keeps working until
// its 7-day TTL expires.
//
// Real remote revocation needs a `session_version` on users, stamped into the
// signed payload and compared in middleware. That is a change to the auth core
// and is listed in the handover rather than half-done here. The UI says
// "Sign out" and the copy beneath it explains the limit rather than implying
// more than the mechanism delivers.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: number;
  session_start: string;
  last_heartbeat: string | null;
  session_end: string | null;
  ip_address: string | null;
  device_info: string | null;
  is_active: boolean;
}

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const rows = await query<SessionRow>(
    `SELECT id, session_start, last_heartbeat, session_end, ip_address, device_info, is_active
       FROM employee_sessions
      WHERE user_id = $1 AND organization_id = $2
      ORDER BY is_active DESC, session_start DESC
      LIMIT 25`,
    [gate.userId, await getOrganizationId()]
  );

  // The newest active row is this browser, near enough: the login that created
  // this cookie is the most recent one for the user. Flagged so the UI can label
  // it "This device" and warn before signing it out.
  const currentId = rows.find((r) => r.is_active)?.id ?? null;

  return NextResponse.json({
    success: true,
    sessions: rows.map((r) => ({
      id: r.id,
      startedAt: r.session_start,
      lastSeenAt: r.last_heartbeat,
      endedAt: r.session_end,
      ipAddress: r.ip_address,
      device: r.device_info,
      isActive: r.is_active,
      isCurrent: r.id === currentId,
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* no body = sign out everything */
  }

  const sessionId = body?.sessionId != null ? Number(body.sessionId) : null;

  // user_id is always in the WHERE clause, so a guessed session id from another
  // account matches nothing rather than ending a stranger's session.
  const sessionsOrgId = await getOrganizationId();

  const closed = sessionId
    ? await query<{ id: number }>(
        `UPDATE employee_sessions
            SET is_active = false, session_end = NOW(), session_end_reason = 'signed_out_remotely'
          WHERE id = $1 AND user_id = $2 AND organization_id = $3 AND is_active = true
        RETURNING id`,
        [sessionId, gate.userId, sessionsOrgId]
      )
    : await query<{ id: number }>(
        `UPDATE employee_sessions
            SET is_active = false, session_end = NOW(), session_end_reason = 'signed_out_all'
          WHERE user_id = $1 AND organization_id = $2 AND is_active = true
        RETURNING id`,
        [gate.userId, sessionsOrgId]
      );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: sessionId ? "session.signout" : "session.signout_all",
    entityType: "session",
    entityId: sessionId,
    newValue: { closed: closed.length },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    closed: closed.length,
    message:
      closed.length === 0
        ? "No matching active session."
        : `Signed out ${closed.length} session${closed.length === 1 ? "" : "s"}.`,
  });
}
