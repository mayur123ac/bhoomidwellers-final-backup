// app/api/attendance/auto-complete/route.ts
//
// Cron endpoint: automatically completes attendance records left open at the
// end of an IST calendar day.
//
// Three modes:
//
//   1. **Scheduled** (mode=scheduled) — runs every 5 minutes via Vercel cron.
//      Reads each org's `organization_settings.shift_end` (+ flexible flag).
//      For every org whose configured shift_end has passed in IST today,
//      completes open attendance records with logout_time = shift_end IST.
//      This is the primary production mode for per-org auto-completion.
//
//   2. **End-of-day** (mode=endofday) — scheduled at 23:58 IST (18:28 UTC).
//      Safety-net: completes ALL remaining open records (any org) at 23:58 IST.
//
//   3. **Midnight** (default) — legacy mode for backfill / manual cleanup.
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
//      IST date (optionally scoped to a single organization).
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

  /**
   * When set, only attendance records belonging to this organization are
   * processed. Used by the scheduled evaluator for per-org shift_end
   * completion.
   *
   * When omitted, ALL organizations are processed (end-of-day / midnight
   * safety-net behavior).
   */
  organizationId?: string;
}

/**
 * Auto-complete attendance records for a specific IST date.
 *
 * @param targetIstDate — the IST date whose records to finalize (YYYY-MM-DD).
 *   Defaults to today (end-of-day mode) or yesterday (midnight mode).
 * @param options — optional configuration for completion time and org scope.
 */
export async function autoCompleteAttendance(
  targetIstDate?: string,
  options?: AutoCompleteOptions,
): Promise<AutoCompleteReport> {
  const start = Date.now();
  const completionTimeIst = options?.completionTimeIst ?? null;
  const organizationId = options?.organizationId ?? null;

  const dateResult = await query<{
    target_date: string;
    completion_boundary: string;
    is_future: boolean;
    is_premature: boolean;
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
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS today_ist,
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::time AS now_ist
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
      END AS is_future,
      -- Premature: completionTimeIst is set, target is today, but the
      -- configured completion time has NOT been reached yet in IST.
      -- This prevents a manual or early-fired cron from closing records
      -- before the intended cutoff.
      CASE WHEN $2::text IS NOT NULL AND td = today_ist
           AND now_ist < ($2::text)::time
      THEN true ELSE false END AS is_premature
    FROM params
  `, [targetIstDate ?? null, completionTimeIst]);

  const targetDate = dateResult[0].target_date;
  const completionBoundary = dateResult[0].completion_boundary;
  const isFuture = dateResult[0].is_future;
  const isPremature = dateResult[0].is_premature;

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

  if (isPremature) {
    report.errors.push(
      `Refused: completion time ${completionTimeIst} has not been reached yet today (IST).`
    );
    report.failed = 1;
    report.durationMs = Date.now() - start;
    console.log(
      `[auto-complete] PREMATURE date=${targetDate} cutoff=${completionTimeIst} (not yet reached in IST)`
    );
    return report;
  }

  try {
    await query("BEGIN");

    // Step 1: Complete active attendance_periods for eligible records.
    // $3 is the optional org filter — when NULL, all orgs are processed.
    const periodsResult = await query<{ id: number }>(`
      WITH eligible_records AS (
        SELECT ar.id
        FROM attendance_records ar
        WHERE ar.logout_time IS NULL
          AND DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
          AND ($3::uuid IS NULL OR ar.organization_id = $3::uuid)
      )
      UPDATE attendance_periods ap
      SET completed_at     = $2::timestamptz,
          duration_seconds = EXTRACT(EPOCH FROM ($2::timestamptz - ap.started_at))::integer,
          updated_at       = CURRENT_TIMESTAMP
      FROM eligible_records er
      WHERE ap.attendance_id = er.id
        AND ap.completed_at IS NULL
      RETURNING ap.id
    `, [targetDate, completionBoundary, organizationId]);

    report.periodsCompleted = periodsResult.length;

    // Step 2: Complete the attendance_records themselves.
    const recordsResult = await query<{ id: number }>(`
      UPDATE attendance_records
      SET logout_time   = $2::timestamptz,
          working_track = EXTRACT(EPOCH FROM ($2::timestamptz - (submitted_at AT TIME ZONE 'UTC')))::integer
      WHERE logout_time IS NULL
        AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
        AND ($3::uuid IS NULL OR organization_id = $3::uuid)
      RETURNING id
    `, [targetDate, completionBoundary, organizationId]);

    report.completed = recordsResult.length;

    await query("COMMIT");

    // Count records already completed (manually or by a prior run).
    const skippedResult = await query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM attendance_records
      WHERE logout_time IS NOT NULL
        AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $1::date
        AND ($2::uuid IS NULL OR organization_id = $2::uuid)
    `, [targetDate, organizationId]);

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
  const orgLabel = organizationId ? ` org=${organizationId}` : "";
  console.log(
    `[auto-complete] mode=${modeLabel}${orgLabel} date=${report.targetDate} ` +
    `boundary=${report.completionBoundary} completed=${report.completed} ` +
    `periods=${report.periodsCompleted} skipped=${report.skipped} ` +
    `failed=${report.failed} duration=${report.durationMs}ms`
  );

  return report;
}

// ── Scheduled evaluator ─────────────────────────────────────────────────────

export interface ScheduledReport {
  orgsEvaluated: number;
  orgsProcessed: number;
  orgsSkipped: number;
  orgsFailed: number;
  totalCompleted: number;
  totalPeriodsCompleted: number;
  details: Array<{
    organizationId: string;
    shiftEnd: string;
    report: AutoCompleteReport;
  }>;
  durationMs: number;
}

/**
 * Evaluate all organizations with a configured shift_end. For each org
 * whose shift_end has already passed today in IST, auto-complete open
 * attendance records at that configured time.
 *
 * Only orgs with `flexible = true` are processed. Non-flexible orgs
 * rely on the 23:58 end-of-day fallback to preserve existing behavior.
 */
export async function evaluateScheduledCompletions(): Promise<ScheduledReport> {
  const start = Date.now();

  const result: ScheduledReport = {
    orgsEvaluated: 0,
    orgsProcessed: 0,
    orgsSkipped: 0,
    orgsFailed: 0,
    totalCompleted: 0,
    totalPeriodsCompleted: 0,
    details: [],
    durationMs: 0,
  };

  // Find all flexible-mode orgs whose configured shift_end has passed for
  // today in IST. The comparison is done entirely in SQL.
  const eligibleOrgs = await query<{
    organization_id: string;
    shift_end: string;
    today_ist: string;
  }>(`
    SELECT
      os.organization_id,
      os.shift_end,
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date::text AS today_ist
    FROM organization_settings os
    WHERE os.flexible = true
      AND os.shift_end IS NOT NULL
      AND os.shift_end <> ''
      AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::time
          >= (os.shift_end || ':00')::time
  `);

  result.orgsEvaluated = eligibleOrgs.length;

  for (const org of eligibleOrgs) {
    try {
      // Normalize shift_end to HH:MM:SS for the completion boundary.
      const shiftEndNormalized = org.shift_end.includes(":")
        ? (org.shift_end.split(":").length === 2 ? org.shift_end + ":00" : org.shift_end)
        : org.shift_end + ":00:00";

      const report = await autoCompleteAttendance(org.today_ist, {
        completionTimeIst: shiftEndNormalized,
        organizationId: org.organization_id,
      });

      result.details.push({
        organizationId: org.organization_id,
        shiftEnd: org.shift_end,
        report,
      });

      if (report.failed > 0) {
        result.orgsFailed++;
      } else if (report.completed > 0) {
        result.orgsProcessed++;
        result.totalCompleted += report.completed;
        result.totalPeriodsCompleted += report.periodsCompleted;
      } else {
        result.orgsSkipped++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[auto-complete:scheduled] org=${org.organization_id} error:`, msg);
      result.orgsFailed++;
      result.details.push({
        organizationId: org.organization_id,
        shiftEnd: org.shift_end,
        report: {
          targetDate: org.today_ist,
          completionBoundary: "",
          completed: 0,
          periodsCompleted: 0,
          skipped: 0,
          failed: 1,
          errors: [msg],
          durationMs: 0,
        },
      });
    }
  }

  result.durationMs = Date.now() - start;

  console.log(
    `[auto-complete:scheduled] evaluated=${result.orgsEvaluated} ` +
    `processed=${result.orgsProcessed} skipped=${result.orgsSkipped} ` +
    `failed=${result.orgsFailed} totalCompleted=${result.totalCompleted} ` +
    `totalPeriods=${result.totalPeriodsCompleted} duration=${result.durationMs}ms`
  );

  return result;
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

  const mode = req.nextUrl.searchParams.get("mode");
  const dateParam = req.nextUrl.searchParams.get("date") || undefined;

  try {
    // ── Scheduled mode: per-org shift_end evaluation ──
    if (mode === "scheduled") {
      const result = await evaluateScheduledCompletions();
      return NextResponse.json({
        success: result.orgsFailed === 0,
        mode: "scheduled",
        ...result,
        via: auth.via,
      });
    }

    // ── End-of-day mode: all-org 23:58 IST safety net ──
    // ── Midnight mode (default): yesterday backfill ──
    const options: AutoCompleteOptions | undefined =
      mode === "endofday" ? { completionTimeIst: "23:58:00" } : undefined;

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
