import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastEvent } from "@/lib/eventBus";

export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return NextResponse.json({ message: "Missing user_id" }, { status: 400 });
    }

    // Forcefully end all active sessions for this user.
    //
    // user_id arrives in the request body, so it is a client-supplied id: without
    // the organization predicate an admin of one tenant could sign out a user of
    // another simply by guessing their id. The organization comes from the signed
    // session, never from the body.
    await query(`
      UPDATE employee_sessions 
      SET is_active = false, session_end = NOW(), session_end_reason = 'forced_logout'
      WHERE user_id = $1 AND organization_id = $2
    `, [user_id, await getOrganizationId()]);

    // Instantly notify the target user's SSE client to terminate session
    broadcastEvent({ type: "FORCE_LOGOUT" }, undefined, user_id);

    // Also notify admins that the user was forcefully logged out
    broadcastEvent({ 
      type: "SESSION_UPDATE", 
      userId: user_id,
      status: "OFFLINE",
      message: "Forcefully Terminated"
    }, ["admin", "site_head"]);

    return NextResponse.json({ success: true, message: "User forcefully logged out." });
  } catch (error) {
    console.error("Force logout error:", error);
    return NextResponse.json({ message: "Internal error" }, { status: 500 });
  }
}
