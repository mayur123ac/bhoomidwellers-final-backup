import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
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

    // Forcefully end all active sessions for this user
    await query(`
      UPDATE employee_sessions 
      SET is_active = false, session_end = NOW(), session_end_reason = 'forced_logout'
      WHERE user_id = $1
    `, [user_id]);

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
