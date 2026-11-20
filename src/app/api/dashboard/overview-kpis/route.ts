// GET /api/dashboard/overview-kpis
//
// Returns operational KPI counts and per-employee performance data for the
// redesigned Admin / Site Head dashboard overview. Revenue and expenditure
// fields are server-gated to admin only and never included for site heads.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// IST-aware SQL expressions
const TS = `(NOW() AT TIME ZONE 'Asia/Kolkata')`;
const MONTH_START = `(date_trunc('month', ${TS}) AT TIME ZONE 'Asia/Kolkata')`;

// ── Schema metadata cache ─────────────────────────────────────────────────
// Tables and columns don't change between requests. Caching these avoids 5-8
// information_schema lookups per request, each costing a pool checkout + 82ms
// Neon RTT. Cache TTL is 5 minutes — long enough to survive a burst of
// dashboard loads, short enough to pick up a migration within minutes.
const SCHEMA_CACHE_TTL_MS = 5 * 60_000;
const schemaCache = new Map<string, { exists: boolean; at: number }>();

/** Check if a table exists so we can degrade gracefully on un-migrated DBs. */
async function tableExists(name: string): Promise<boolean> {
  const key = `t:${name}`;
  const cached = schemaCache.get(key);
  if (cached && Date.now() - cached.at < SCHEMA_CACHE_TTL_MS) return cached.exists;

  const rows = await query<{ n: string }>(
    `SELECT 1 AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [name],
  );
  const exists = rows.length > 0;
  schemaCache.set(key, { exists, at: Date.now() });
  return exists;
}

/** Check if a column exists on a table. */
async function columnExists(table: string, column: string): Promise<boolean> {
  const key = `c:${table}.${column}`;
  const cached = schemaCache.get(key);
  if (cached && Date.now() - cached.at < SCHEMA_CACHE_TTL_MS) return cached.exists;

  const rows = await query<{ n: string }>(
    `SELECT 1 AS n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column],
  );
  const exists = rows.length > 0;
  schemaCache.set(key, { exists, at: Date.now() });
  return exists;
}

export async function GET() {
  // ── Auth: admin + site head only ────────────────────────────────────────
  const gate = await requireRoles(["admin", "site head", "site_head"]);
  if (!gate.ok) return gate.response;

  const role = (gate.session.role ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
  const isAdmin = role === "admin";
  const orgId = await getOrganizationId();

  try {
    // ── Pre-flight: check for tables/columns that may not be migrated yet ──
    const [hasCallSessions, hasSiteVisits, hasBookingApps, hasSvCompletedAt, hasSvCreatedById] =
      await Promise.all([
        tableExists("call_sessions"),
        tableExists("site_visits"),
        tableExists("booking_applications"),
        columnExists("site_visits", "completed_at"),
        columnExists("site_visits", "created_by_id"),
      ]);

    // ── Parallel queries ────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic SQL result shapes
    const queries: Promise<any>[] = [
      // 0. Calls due (org-wide): leads that have NEVER had a completed call
      //    If call_sessions table doesn't exist, count all eligible leads as "due"
      query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM walkin_enquiries w
         WHERE w.organization_id = $1
           AND COALESCE(w.is_lost_lead, false) = false
           AND w.status NOT IN ('Closing', 'Closed')
           AND w.assigned_to_user_id IS NOT NULL
           ${hasCallSessions
             ? `AND NOT EXISTS (
                  SELECT 1 FROM call_sessions cs
                  WHERE cs.lead_id = w.id
                    AND cs.organization_id = w.organization_id
                    AND cs.recording_r2_key IS NOT NULL
                )`
             : ""}`,
        [orgId],
      ),

      // 1. Visits today: site_visits scheduled for today (IST)
      hasSiteVisits
        ? query<{ count: string }>(
            `SELECT COUNT(*) AS count
             FROM site_visits sv
             WHERE sv.organization_id = $1
               AND sv.status NOT IN ('cancelled')
               AND (sv.visit_date AT TIME ZONE 'Asia/Kolkata')::date = (${TS})::date`,
            [orgId],
          )
        : Promise.resolve([{ count: "0" }]),

      // 2. In closing: leads currently in Closing stage
      query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM walkin_enquiries w
         WHERE w.organization_id = $1
           AND w.status IN ('Closing', 'Closed')`,
        [orgId],
      ),

      // 3. Confirmed bookings (overall + this month)
      hasBookingApps
        ? query<{ total: string; this_month: string }>(
            `SELECT
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ba.booking_date >= ${MONTH_START}
                                OR (ba.booking_date IS NULL AND ba.created_at >= ${MONTH_START})) AS this_month
             FROM booking_applications ba
             WHERE ba.organization_id = $1
               AND LOWER(COALESCE(ba.booking_status, '')) IN ('confirmed', 'approved')`,
            [orgId],
          )
        : Promise.resolve([{ total: "0", this_month: "0" }]),

      // 4. Site visits completed (overall + this month)
      hasSiteVisits
        ? query<{ total: string; this_month: string }>(
            `SELECT
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ${hasSvCompletedAt
                 ? `sv.completed_at >= ${MONTH_START} OR (sv.completed_at IS NULL AND sv.created_at >= ${MONTH_START})`
                 : `sv.created_at >= ${MONTH_START}`
               }) AS this_month
             FROM site_visits sv
             WHERE sv.organization_id = $1
               AND sv.status = 'completed'`,
            [orgId],
          )
        : Promise.resolve([{ total: "0", this_month: "0" }]),

      // 5. Employee roster (active, CRM roles)
      query<{ id: number; name: string; role: string }>(
        `SELECT id, name, role
         FROM users
         WHERE organization_id = $1
           AND is_active = true
           AND LOWER(REPLACE(role, '_', ' ')) IN ('sales manager', 'site head', 'receptionist')
         ORDER BY role, name`,
        [orgId],
      ),

      // 6. Per-employee lead counts (overall + this month) by assigned_to_user_id
      query<{ user_id: string; total: string; this_month: string }>(
        `SELECT
           w.assigned_to_user_id AS user_id,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE w.created_at >= ${MONTH_START}) AS this_month
         FROM walkin_enquiries w
         WHERE w.organization_id = $1
           AND w.assigned_to_user_id IS NOT NULL
         GROUP BY w.assigned_to_user_id`,
        [orgId],
      ),

      // 7. Per-employee completed site visits (overall + this month)
      hasSiteVisits && hasSvCreatedById
        ? query<{ user_id: string; total: string; this_month: string }>(
            `SELECT
               sv.created_by_id AS user_id,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ${hasSvCompletedAt
                 ? `sv.completed_at >= ${MONTH_START} OR (sv.completed_at IS NULL AND sv.created_at >= ${MONTH_START})`
                 : `sv.created_at >= ${MONTH_START}`
               }) AS this_month
             FROM site_visits sv
             WHERE sv.organization_id = $1
               AND sv.status = 'completed'
               AND sv.created_by_id IS NOT NULL
             GROUP BY sv.created_by_id`,
            [orgId],
          )
        : Promise.resolve([]),

      // 8. Per-employee confirmed bookings (overall + this month)
      hasBookingApps
        ? query<{ user_id: string; total: string; this_month: string }>(
            `SELECT
               ba.created_by_id AS user_id,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ba.booking_date >= ${MONTH_START}
                                OR (ba.booking_date IS NULL AND ba.created_at >= ${MONTH_START})) AS this_month
             FROM booking_applications ba
             WHERE ba.organization_id = $1
               AND LOWER(COALESCE(ba.booking_status, '')) IN ('confirmed', 'approved')
               AND ba.created_by_id IS NOT NULL
             GROUP BY ba.created_by_id`,
            [orgId],
          )
        : Promise.resolve([]),
    ];

    // 9. Revenue summary — admin only, never fetched for site heads
    if (isAdmin) {
      const hasFinancials = await tableExists("booking_financials");
      const hasLedger = await tableExists("customer_ledger_view");

      if (hasBookingApps && hasFinancials) {
        queries.push(
          query<Record<string, string>>(
            `SELECT
               COALESCE(SUM(ba.agreement_value), 0)::numeric AS total_booked_value,
               COALESCE(SUM(ba.agreement_value) FILTER (
                 WHERE ba.booking_date >= ${MONTH_START}
                    OR (ba.booking_date IS NULL AND ba.created_at >= ${MONTH_START})
               ), 0)::numeric AS this_month_booked_value,
               COALESCE(SUM(bf.token_amount), 0)::numeric AS total_token,
               COALESCE(SUM(bf.token_amount) FILTER (
                 WHERE ba.booking_date >= ${MONTH_START}
                    OR (ba.booking_date IS NULL AND ba.created_at >= ${MONTH_START})
               ), 0)::numeric AS this_month_token,
               COALESCE(SUM(COALESCE(bf.ocr_amount, 0) + COALESCE(bf.cash_component, 0)), 0)::numeric AS total_ocr_cash,
               ${hasLedger
                 ? `COALESCE(SUM(clv.developer_revenue), 0)::numeric AS total_received,
                    COALESCE(SUM(clv.outstanding_balance), 0)::numeric AS total_outstanding`
                 : `COALESCE(SUM(
                     COALESCE(ba.booking_amount, 0) +
                     COALESCE(bf.ocr_amount, 0) +
                     COALESCE(bf.cash_component, 0)
                   ), 0)::numeric AS total_received,
                    0::numeric AS total_outstanding`
               }
             FROM booking_applications ba
             LEFT JOIN booking_financials bf ON bf.booking_id = ba.id
             ${hasLedger ? `LEFT JOIN customer_ledger_view clv ON clv.booking_id = ba.id` : ""}
             WHERE ba.organization_id = $1
               AND LOWER(COALESCE(ba.booking_status, '')) IN ('confirmed', 'approved')`,
            [orgId],
          ),
        );
      } else {
        // Push a null placeholder so index stays consistent
        queries.push(Promise.resolve(null));
      }

      // 10. Payroll expenditure — admin only
      const hasPayroll = await tableExists("payroll_records");
      if (hasPayroll) {
        queries.push(
          query<{ user_id: string; total_gross: string; total_incentive: string }>(
            `SELECT
               pr.user_id::text AS user_id,
               SUM(pr.gross_salary + COALESCE(pr.total_additions, 0))::numeric AS total_gross,
               SUM(COALESCE(pr.incentive_total, 0))::numeric AS total_incentive
             FROM payroll_records pr
             WHERE pr.organization_id = $1
               AND pr.status IN ('approved', 'paid')
             GROUP BY pr.user_id`,
            [orgId],
          ),
        );
      } else {
        queries.push(Promise.resolve([]));
      }
    }

    const results = await Promise.all(queries);

    const callsDue = Number(results[0]?.[0]?.count || 0);
    const visitsToday = Number(results[1]?.[0]?.count || 0);
    const inClosing = Number(results[2]?.[0]?.count || 0);
    const confirmedBookingsRow = results[3]?.[0] || {};
    const siteVisitsCompletedRow = results[4]?.[0] || {};
    const roster: Array<{ id: number; name: string; role: string }> = results[5] || [];
    const leadStats: Array<{ user_id: string; total: string; this_month: string }> = results[6] || [];
    const visitStats: Array<{ user_id: string; total: string; this_month: string }> = results[7] || [];
    const bookingStats: Array<{ user_id: string; total: string; this_month: string }> = results[8] || [];

    // Index per-employee stats by user_id
    const leadMap = new Map(leadStats.map(r => [Number(r.user_id), r]));
    const visitMap = new Map(visitStats.map(r => [Number(r.user_id), r]));
    const bookingMap = new Map(bookingStats.map(r => [Number(r.user_id), r]));

    // Payroll map (admin only)
    const payrollMap = new Map<number, { gross: number; incentive: number }>();
    if (isAdmin && results[10]) {
      for (const r of results[10]) {
        payrollMap.set(Number(r.user_id), {
          gross: Number(r.total_gross || 0),
          incentive: Number(r.total_incentive || 0),
        });
      }
    }

    // Build per-employee records
    const employees = roster.map(u => {
      const ls = leadMap.get(u.id);
      const vs = visitMap.get(u.id);
      const bs = bookingMap.get(u.id);
      const ps = payrollMap.get(u.id);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic shape varies by role
      const emp: Record<string, any> = {
        id: u.id,
        name: u.name,
        role: u.role,
        totalLeads: Number(ls?.total || 0),
        totalLeadsThisMonth: Number(ls?.this_month || 0),
        siteVisitsCompleted: Number(vs?.total || 0),
        siteVisitsCompletedThisMonth: Number(vs?.this_month || 0),
        confirmedBookings: Number(bs?.total || 0),
        confirmedBookingsThisMonth: Number(bs?.this_month || 0),
      };

      if (isAdmin && ps) {
        emp.spent = ps.gross + ps.incentive;
        emp.spentBreakdown = { salary: ps.gross, incentives: ps.incentive };
      } else if (isAdmin) {
        emp.spent = 0;
        emp.spentBreakdown = { salary: 0, incentives: 0 };
      }
      // Site heads get NO spent data — fields are simply absent

      return emp;
    });

    // Aggregate "All Team" totals (distinct records, no double-count risk since
    // assigned_to_user_id is unique per lead and created_by_id is unique per visit/booking)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic shape varies by role
    const allTeam: Record<string, any> = {
      totalLeads: employees.reduce((s, e) => s + e.totalLeads, 0),
      totalLeadsThisMonth: employees.reduce((s, e) => s + e.totalLeadsThisMonth, 0),
      siteVisitsCompleted: Number(siteVisitsCompletedRow.total || 0),
      siteVisitsCompletedThisMonth: Number(siteVisitsCompletedRow.this_month || 0),
      confirmedBookings: Number(confirmedBookingsRow.total || 0),
      confirmedBookingsThisMonth: Number(confirmedBookingsRow.this_month || 0),
    };

    if (isAdmin) {
      allTeam.spent = employees.reduce((s, e) => s + (e.spent || 0), 0);
      allTeam.spentBreakdown = {
        salary: employees.reduce((s, e) => s + (e.spentBreakdown?.salary || 0), 0),
        incentives: employees.reduce((s, e) => s + (e.spentBreakdown?.incentives || 0), 0),
      };
    }

    // Revenue summary — admin only
    let revenue = null;
    if (isAdmin && results[9]) {
      const r = Array.isArray(results[9]) ? results[9][0] : results[9];
      if (r) {
        const totalBookedValue = Number(r.total_booked_value || 0);
        const totalReceived = Number(r.total_received || 0);
        revenue = {
          totalBookedValue,
          thisMonthBookedValue: Number(r.this_month_booked_value || 0),
          totalReceived,
          thisMonthReceived: Number(r.this_month_token || 0),
          outstandingBalance: Number(r.total_outstanding || 0) || Math.max(totalBookedValue - totalReceived, 0),
          totalConfirmedBookings: Number(confirmedBookingsRow.total || 0),
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        operational: {
          callsDue,
          visitsToday,
          inClosing,
          confirmedBookings: Number(confirmedBookingsRow.total || 0),
          siteVisitsCompleted: Number(siteVisitsCompletedRow.total || 0),
          siteVisitsCompletedThisMonth: Number(siteVisitsCompletedRow.this_month || 0),
        },
        employees,
        allTeam,
        ...(isAdmin && revenue ? { revenue } : {}),
      },
    });
  } catch (err: unknown) {
    console.error("[GET /api/dashboard/overview-kpis]", err);
    const message = err instanceof Error ? err.message : "Dashboard KPI fetch failed";
    return NextResponse.json(
      { success: false, message },
      { status: 500 },
    );
  }
}
