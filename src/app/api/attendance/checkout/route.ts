// app/api/attendance/checkout/route.ts
//
// POST /api/attendance/checkout
//
// "Done for the Day" — records the employee's self-declared end-of-work time
// by writing logout_time to today's attendance_records row.
//
// IMPORTANT — employee_sessions is intentionally NOT touched here.
// The heartbeat route (api/attendance/heartbeat) treats a session row with
// is_active = false as a forced logout signal and returns { forceLogout: true }
// with a 401, which the client's useActivityTracker immediately responds to by
// calling clearCrmSession() and redirecting to "/". Closing the session here
// would therefore log the user out of the CRM, which is not what "Done for the
// Day" means — the user may still be using the CRM after checking out of their
// attendance record.
//
// Idempotent: if logout_time is already set, returns the existing value with
// success: true and no DB mutation.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { broadcastEvent } from "@/lib/eventBus";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const auth = await requireRole([
      "admin",
      "site_head", "site head",
      "sales manager", "sales_manager",
      "receptionist",
      "sourcing_manager", "sourcing manager",
      "caller", "telecaller",
      "channel partner manager",
    ]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const userId = getSessionUserId(auth.session);
    if (userId === null) {
      return NextResponse.json(
        { success: false, message: "Cannot determine current user" },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();

    // Find today's attendance record (same IST-day logic as mark and status routes).
    // ORDER BY id ASC to match the mark/status routes — always anchor to the
    // employee's first punch of the day, not a later duplicate.
    const rows = await query<{
      id: number;
      login_time: string;
      logout_time: string | null;
      working_track: number | null;
    }>(
      `SELECT id, login_time, logout_time, working_track
         FROM attendance_records
        WHERE employee_id = $1
          AND organization_id = $2
          AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        ORDER BY id ASC
        LIMIT 1`,
      [userId, orgId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "No attendance record found for today. Please mark attendance first." },
        { status: 404 }
      );
    }

    const record = rows[0];

    // Idempotent: already checked out — return the existing values.
    if (record.logout_time) {
      return NextResponse.json({
        success: true,
        message: "Already checked out for today.",
        logoutTime: record.logout_time,
        workingTrack: record.working_track ?? null,
        alreadyCompleted: true,
      });
    }

    // Write logout_time and working_track atomically.
    // login_time is TIMESTAMPTZ (confirmed: mark route inserts via ::timestamptz
    // cast and route comments state "genuine timestamptz in production").
    // CURRENT_TIMESTAMP is also TIMESTAMPTZ. Subtracting two TIMESTAMPTZ values
    // gives a pure elapsed-time INTERVAL independent of session timezone — the
    // correct formula regardless of whether the DB session runs UTC or IST.
    // Do NOT use AT TIME ZONE here: (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
    // produces a naive TIMESTAMP, and TIMESTAMP - TIMESTAMPTZ forces the TIMESTAMP
    // back through the session timezone (UTC on Neon), introducing a ±5.5h error.
    const updated = await query<{ logout_time: string; working_track: number }>(
      `UPDATE attendance_records
          SET logout_time   = CURRENT_TIMESTAMP,
              working_track = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - login_time))::integer
        WHERE id = $1 AND organization_id = $2
        RETURNING logout_time, working_track`,
      [record.id, orgId]
    );

    const logoutTime = updated[0]?.logout_time ?? new Date().toISOString();
    const workingTrack: number | null = updated[0]?.working_track ?? null;

    // Broadcast so admin/site-head Live Activity view reflects the checkout.
    broadcastEvent(orgId, { type: "ATTENDANCE_SYNC", userId }, ["admin", "site_head"]);
    broadcastToOrg(orgId, "activity.attendance_sync", { type: "ATTENDANCE_SYNC", userId });

    return NextResponse.json({
      success: true,
      message: "Checked out successfully.",
      logoutTime,
      workingTrack,
      alreadyCompleted: false,
    });
  } catch (err) {
    console.error("POST /api/attendance/checkout error:", err);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
