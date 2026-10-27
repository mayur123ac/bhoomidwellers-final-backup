// app/api/attendance/remark/route.ts
//
// POST /api/attendance/remark
//
// "Remark Attendance" — starts a new work period for today after a previous
// checkout. Creates a new attendance_periods row and clears logout_time on
// the daily attendance_records anchor so the badge transitions back to ACTIVE.
//
// Preconditions:
//   1. Attendance already marked today (attendance_records row exists)
//   2. Day is completed (logout_time IS NOT NULL)
//   3. No active period exists (the partial UNIQUE index enforces this)

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

    // Find today's attendance record (first punch, same as mark/status/checkout).
    const rows = await query<{
      id: number;
      logout_time: string | null;
    }>(
      `SELECT id, logout_time
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
        { success: false, message: "No attendance record for today. Mark attendance first." },
        { status: 404 }
      );
    }

    const record = rows[0];

    if (!record.logout_time) {
      return NextResponse.json(
        { success: false, message: "Day is still active. Complete the current period first." },
        { status: 409 }
      );
    }

    // Atomic: create new period + clear logout in a single CTE statement.
    // The partial UNIQUE index on attendance_periods (attendance_id) WHERE
    // completed_at IS NULL rejects this INSERT if an active period already exists.
    const result = await query<{
      period_number: number;
      started_at: string;
    }>(
      `WITH next_num AS (
        SELECT COALESCE(MAX(period_number), 0) + 1 AS n
        FROM attendance_periods
        WHERE attendance_id = $1
      ),
      new_period AS (
        INSERT INTO attendance_periods (attendance_id, organization_id, employee_id, period_number, started_at)
        SELECT $1, $2, $3, nn.n, CURRENT_TIMESTAMP
        FROM next_num nn
        RETURNING period_number, started_at
      ),
      clear_logout AS (
        UPDATE attendance_records
        SET logout_time = NULL, working_track = NULL
        WHERE id = $1 AND organization_id = $2
      )
      SELECT np.period_number,
        TO_CHAR(np.started_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at
      FROM new_period np`,
      [record.id, orgId, userId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, message: "Failed to create new period." },
        { status: 500 }
      );
    }

    const { period_number, started_at } = result[0];

    broadcastEvent(orgId, { type: "ATTENDANCE_SYNC", userId }, ["admin", "site_head"]);
    broadcastToOrg(orgId, "activity.attendance_sync", { type: "ATTENDANCE_SYNC", userId });

    return NextResponse.json({
      success: true,
      message: `Period ${period_number} started.`,
      periodNumber: period_number,
      startedAt: started_at,
    });
  } catch (err: unknown) {
    // The partial UNIQUE index violation means an active period already exists
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr?.code === "23505" && pgErr?.constraint?.includes("one_active")) {
      return NextResponse.json(
        { success: false, message: "An active period already exists." },
        { status: 409 }
      );
    }
    console.error("POST /api/attendance/remark error:", err);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
