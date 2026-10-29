// app/api/attendance/auto-complete/route.ts
//
// Cron endpoint: automatically completes attendance records left open at the
// end of an IST calendar day.
//
// Two modes:
//
//   1. **End-of-day** (mode=endofday) — scheduled at 23:58 IST (18:28 UTC).
//      Completes today's open records with logout_time = today 23:58:00 IST.
//      This is the primary production mode configured in vercel.json.
//
//   2. **Midnight** (default) — legacy mode for backfill / manual cleanup.
//      Completes the PREVIOUS IST day's records with logout_time = midnight
//      boundary (00:00:00 next day IST).
//
// Auth: Vercel CRON_SECRET (Authorization: Bearer), shared VERIFY_TOKEN
// (x-cron-token header), or admin session cookie.
//
// GET and POST both work (cron services frequently only issue GET).
//
// Behaviour:
//   1. Identifies attendance_records whose logout_time IS NULL for the target
//      IST date.
//   2. Sets logout_time to the completion boundary.
//   3. Computes working_track = boundary - submitted_at.
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
  // 1. Vercel Cron secret (CRON_SECRET env var → Authorization: Bearer header)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (authHeader && cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, via: "vercel-cron" };
  }

  // 2. Shared secret in x-cron-token header (constant-time comparison)
  const header = req.headers.get("x-cron-token");
  const expected = getVerifyToken();
  if (header && expected && safeEqual(header, expected)) return { ok: true, via: "token" };

  // 3. Admin session cookie (for manual trigger from browser)
  const session = await getServerSession();
  const role = (session?.role ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (role === "admin" || role === "super admin") return { ok: true, via: "session" };

  return { ok: false };
}

// ── Core logic (exported for testing) ───────────────────────────────────────

export interface AutoCompleteReport {
  targetDate: string;
  completionBoundary: string;
  completed: number;
  periodsCompleted: number;
  skipped: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

export interface AutoCompleteOptions {
  /**
   * Completion time in IST as HH:MM:SS (e.g. "23:58:00").
   *
   * When set:
   * - Default target date = today IST (not yesterday).
   * - Completion boundary = target_date at this time in IST.
   * - Today's date is allowed (the is_future guard permits same-day).
   *
   * When omitted (default / midnight mode):
   * - Default target date = yesterday IST.
   * - Completion boundary = midnight (00:00:00 next day IST).
   * - Only fully elapsed IST days are allowed.
   */
  completionTimeIst?: string;
}

/**
 * Auto-complete attendance records for a specific IST date.
 *
 * @param targetIstDate — the IST date whose records to finalize (YYYY-MM-DD).
 *   Defaults to today (end-of-day mode) or yesterday (midnight mode).
 * @param options — optional configuration for completion time.
 */
export async function autoCompleteAttendance(
  targetIstDate?: string,
  options?: AutoCompleteOptions,
): Promise<AutoCompleteReport> {
  const start = Date.now();
  const completionTimeIst = options?.completionTimeIst ?? null;

  // Compute target date, completion boundary, and safety check in SQL
  // to avoid Node timezone issues.
  //
  // End-of-day mode (completionTimeIst set):
  //   target_date defaults to today IST.
  //   completion_boundary = target_date at completionTimeIst in IST.
  //   is_future = target_date > today IST (rejects tomorrow+, allows today).
  //
  // Midnight mode (completionTimeIst null):
  //   target_date defaults to yesterday IST.
  //   completion_boundary = (target_date + 1 day) at 00:00:00 IST.
  //   is_future = target_date >= today IST (rejects today+, only past days).
  const dateResult = await query<{
    target_date: string;
    completion_boundary: string;
    is_future: boolean;
  }>(`
    WITH params AS (
      SELECT
        COALESCE(
          $1::date,
          CASE WHEN $2::text IS NOT NULL
            THEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
            ELSE ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - INTERVAL '1 day')::date
          END
        ) AS td,
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
    )
    SELECT
      td::text AS target_date,
      CASE WHEN $2::text IS NOT NULL THEN
        (td::text || ' ' || $2::text)::timestamp AT TIME ZONE 'Asia/Kolkata'
      ELSE
        (td + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata'
      END AS completion_boundary,
      CASE WHEN $2::text IS NOT NULL THEN
        td > today_ist
      ELSE
        td >= today_ist
      END AS is_future
    FROM params
  `, [targetIstDate ?? null, completionTimeIst]);

  const targetDate = dateResult[0].target_date;
  const completionBoundary = dateResult[0].completion_boundary;
  const isFuture = dateResult[0].is_future;

  const report: AutoCompleteReport = {
    targetDate,
    completionBoundary,
    completed: 0,
    periodsCompleted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    durationMs: 0,
  };

  // Safety: refuse to auto-complete future IST dates.
  if (isFuture) {
    const modeLabel = completionTimeIst ? "end-of-day" : "midnight";
    report.errors.push(
      `Refused: target date ${targetDate} is in the future (IST, ${modeLabel} mode).`
    );
    report.failed = 1;
    report.durationMs = Date.now() - start;
    console.log(
      `[auto-complete] REFUSED date=${targetDate} mode=${modeLabel} (future IST)`
    );
    return report;
  }

  try {
    // Steps 1 + 2 run inside a single transaction so that period completion
    // and parent-record completion are atomic. If either fails, both roll back.
    await query("BEGIN");

    // Step 1: Complete active attendance_periods for eligible records.
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
    `, [targetDate, completionBoundary]);

    report.periodsCompleted = periodsResult.length;

    // Step 2: Complete the attendance_records themselves.
    // working_track = gross span from submitted_at to completion boundary.
    //
    // submitted_at is TIMESTAMP (no timezone) on Neon, stored as UTC wall-clock.
    // `submitted_at AT TIME ZONE 'UTC'` reinterprets it as TIMESTAMPTZ for safe
    // subtraction against the completion boundary (also TIMESTAMPTZ).
    const recordsResult = await query<{ id: number }>(`
      UPDATE attendance_records
      SET logout_time   = $2::timestamptz,
          working_track = EXTRACT(EPOCH FROM ($2::timestamptz - (submitted_at AT TIME ZONE 'UTC')))::integer
      WHERE logout_time IS NULL
        AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
      RETURNING id
    `, [targetDate, completionBoundary]);

    report.completed = recordsResult.length;

    await query("COMMIT");

    // Count records that already had logout_time set (manually completed).
    const skippedResult = await query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM attendance_records
      WHERE logout_time IS NOT NULL
        AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
    `, [targetDate]);

    report.skipped = parseInt(skippedResult[0]?.count || "0", 10);

  } catch (err: unknown) {
    try { await query("ROLLBACK"); } catch { /* ignore rollback errors */ }
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push(msg);
    report.failed = 1;
    console.error("[auto-complete] Error:", msg);
  }

  report.durationMs = Date.now() - start;

  const modeLabel = completionTimeIst ? `endofday@${completionTimeIst}` : "midnight";
  console.log(
    `[auto-complete] mode=${modeLabel} date=${report.targetDate} ` +
    `boundary=${report.completionBoundary} completed=${report.completed} ` +
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
      { success: false, message: "Unauthorized. Send an admin session, a valid x-cron-token, or CRON_SECRET." },
      { status: 401 },
    );
  }

  // mode=endofday → complete today's records at 23:58 IST.
  // Default (no mode) → midnight mode for yesterday.
  const mode = req.nextUrl.searchParams.get("mode");
  const dateParam = req.nextUrl.searchParams.get("date") || undefined;

  const options: AutoCompleteOptions | undefined =
    mode === "endofday" ? { completionTimeIst: "23:58:00" } : undefined;

  try {
    const report = await autoCompleteAttendance(dateParam, options);
    return NextResponse.json({
      success: report.failed === 0,
      mode: mode || "midnight",
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
