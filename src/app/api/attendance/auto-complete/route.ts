// app/api/attendance/auto-complete/route.ts
//
// Cron endpoint: automatically completes attendance records left open at the
// end of an IST calendar day.
//
// Intended schedule: midnight IST daily (18:30 UTC previous day).
// Point an external cron at:
//   curl -H "x-cron-token: $VERIFY_TOKEN" https://www.bhoomidwellers.com/api/attendance/auto-complete
//
// Auth: shared secret (VERIFY_TOKEN) in x-cron-token header, OR admin session.
// GET and POST both work (cron services frequently only issue GET).
//
// Behaviour:
//   1. Identifies attendance_records from the PREVIOUS IST day whose
//      logout_time IS NULL (day never completed).
//   2. Sets logout_time to the IST midnight boundary (start of today).
//   3. Computes working_track = midnight - submitted_at.
//   4. Completes any active attendance_periods for those records.
//   5. Skips records already completed manually.
//   6. Idempotent: re-running does nothing once all records are complete.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { getVerifyToken } from "@/config/whatsapp.config";
import { safeEqual } from "@/lib/whatsapp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Auth ────────────────────────────────────────────────────────────────────

async function authorize(req: NextRequest): Promise<{ ok: boolean; via?: string }> {
  // 1. Shared secret in header (constant-time comparison)
  const header = req.headers.get("x-cron-token");
  const expected = getVerifyToken();
  if (header && expected && safeEqual(header, expected)) return { ok: true, via: "token" };

  // 2. Admin session cookie (for manual trigger from browser)
  const session = await getServerSession();
  const role = (session?.role ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (role === "admin" || role === "super admin") return { ok: true, via: "session" };

  return { ok: false };
}

// ── Core logic (exported for testing) ───────────────────────────────────────

export interface AutoCompleteReport {
  targetDate: string;
  midnightBoundary: string;
  completed: number;
  periodsCompleted: number;
  skipped: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

/**
 * Auto-complete attendance records for a specific IST date.
 *
 * @param targetIstDate — the IST date whose records to finalize (YYYY-MM-DD).
 *   Defaults to yesterday IST. Future dates are rejected.
 */
export async function autoCompleteAttendance(
  targetIstDate?: string,
): Promise<AutoCompleteReport> {
  const start = Date.now();

  // The IST midnight boundary is 00:00:00 of the NEXT IST day.
  // For records on 2026-10-26 IST, completion = 2026-10-27 00:00:00 IST.
  // In UTC that is (next day) - 05:30 = previous day 18:30:00 UTC.
  //
  // We compute this entirely in SQL to avoid Node timezone issues.

  const dateResult = await query<{
    target_date: string;
    midnight_boundary: string;
    is_future: boolean;
  }>(`
    SELECT
      COALESCE($1::date,
        ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day')::date
      )::text AS target_date,
      -- Midnight boundary = start of the day AFTER target_date, in IST,
      -- expressed as TIMESTAMPTZ.
      (
        (COALESCE($1::date,
          ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day')::date
        ) + INTERVAL '1 day')::text || ' 00:00:00'
      )::timestamp AT TIME ZONE 'Asia/Kolkata' AS midnight_boundary,
      -- Safety: reject if target date is today or later in IST.
      -- Only past IST days are eligible for auto-completion.
      COALESCE($1::date,
        ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day')::date
      ) >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS is_future
  `, [targetIstDate ?? null]);

  const targetDate = dateResult[0].target_date;
  const midnightBoundary = dateResult[0].midnight_boundary;
  const isFuture = dateResult[0].is_future;

  const report: AutoCompleteReport = {
    targetDate,
    midnightBoundary,
    completed: 0,
    periodsCompleted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    durationMs: 0,
  };

  // Safety: refuse to auto-complete today or any future IST date.
  // Only fully elapsed IST days are eligible.
  if (isFuture) {
    report.errors.push(`Refused: target date ${targetDate} is today or in the future (IST).`);
    report.failed = 1;
    report.durationMs = Date.now() - start;
    console.log(
      `[auto-complete] REFUSED date=${targetDate} (today or future IST)`
    );
    return report;
  }

  try {
    // Steps 1 + 2 run inside a single transaction so that period completion
    // and parent-record completion are atomic. If either fails, both roll back
    // — no orphaned completed periods with still-open parent records.
    await query("BEGIN");

    // Step 1: Complete active attendance_periods for eligible records.
    // Only close periods on records from the target IST date that are still open
    // (logout_time IS NULL). The period's duration is computed from its started_at
    // to the midnight boundary.
    const periodsResult = await query<{ id: number }>(`
      WITH eligible_records AS (
        SELECT ar.id
        FROM attendance_records ar
        WHERE ar.logout_time IS NULL
          AND DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
      )
      UPDATE attendance_periods ap
      SET completed_at     = $2::timestamptz,
          duration_seconds = EXTRACT(EPOCH FROM ($2::timestamptz - ap.started_at))::integer,
          updated_at       = CURRENT_TIMESTAMP
      FROM eligible_records er
      WHERE ap.attendance_id = er.id
        AND ap.completed_at IS NULL
      RETURNING ap.id
    `, [targetDate, midnightBoundary]);

    report.periodsCompleted = periodsResult.length;

    // Step 2: Complete the attendance_records themselves.
    // Sets logout_time to the midnight boundary and computes working_track
    // as the gross span from submitted_at to midnight.
    //
    // submitted_at is TIMESTAMP (no timezone) on Neon, stored as UTC wall-clock.
    // `submitted_at AT TIME ZONE 'UTC'` reinterprets it as TIMESTAMPTZ for safe
    // subtraction against the midnight boundary (also TIMESTAMPTZ).
    const recordsResult = await query<{ id: number }>(`
      UPDATE attendance_records
      SET logout_time   = $2::timestamptz,
          working_track = EXTRACT(EPOCH FROM ($2::timestamptz - (submitted_at AT TIME ZONE 'UTC')))::integer
      WHERE logout_time IS NULL
        AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
      RETURNING id
    `, [targetDate, midnightBoundary]);

    report.completed = recordsResult.length;

    await query("COMMIT");

    // Count records that already had logout_time set (manually completed).
    // Outside the transaction — this is a read-only informational count.
    const skippedResult = await query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM attendance_records
      WHERE logout_time IS NOT NULL
        AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
    `, [targetDate]);

    report.skipped = parseInt(skippedResult[0]?.count || "0", 10);

  } catch (err: unknown) {
    // Roll back the transaction on any error.
    try { await query("ROLLBACK"); } catch { /* ignore rollback errors */ }
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push(msg);
    report.failed = 1;
    console.error("[auto-complete] Error:", msg);
  }

  report.durationMs = Date.now() - start;

  console.log(
    `[auto-complete] date=${report.targetDate} completed=${report.completed} ` +
    `periods=${report.periodsCompleted} skipped=${report.skipped} ` +
    `failed=${report.failed} duration=${report.durationMs}ms`
  );

  return report;
}

// ── HTTP handlers ───────────────────────────────────────────────────────────

async function handle(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, message: "Unauthorized. Send an admin session or a valid x-cron-token." },
      { status: 401 },
    );
  }

  // Optional: override the target date via query param (for backfill/testing).
  const dateParam = req.nextUrl.searchParams.get("date") || undefined;

  try {
    const report = await autoCompleteAttendance(dateParam);
    return NextResponse.json({
      success: report.failed === 0,
      ...report,
      via: auth.via,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auto-complete] Unhandled:", msg);
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
