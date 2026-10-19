// app/api/hr/profitability/route.ts
//
// GET — aggregated profitability dashboard data for the HR panel.
// Brokerage revenue from booking_brokerage, employee costs from payroll_records,
// resource costs from employee_resource_expenses.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  try {
    const orgId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = sp.get("from") || firstOfMonth.toISOString().slice(0, 10);
    const to = sp.get("to") || now.toISOString().slice(0, 10);

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const fromYM = fromDate.getFullYear() * 100 + (fromDate.getMonth() + 1);
    const toYM = toDate.getFullYear() * 100 + (toDate.getMonth() + 1);

    // ── 1. Brokerage summary ──────────────────────────────────────────────────
    const brokerageRows = await query<any>(
      `SELECT
        COALESCE(SUM(CASE WHEN status IN ('received','partially_received','expected') THEN brokerage_amount ELSE 0 END), 0) AS total_rev,
        COALESCE(SUM(received_amount), 0) AS received,
        COALESCE(SUM(CASE WHEN status = 'expected' THEN brokerage_amount ELSE 0 END), 0) AS expected
      FROM booking_brokerage
      WHERE organization_id = $1
        AND created_at >= $2::date
        AND created_at < ($3::date + interval '1 day')`,
      [orgId, from, to]
    );
    const br = brokerageRows[0] || {};
    const totalBrokerageRevenue = Number(br.total_rev ?? 0);
    const receivedBrokerage = Number(br.received ?? 0);
    const expectedBrokerage = Number(br.expected ?? 0);
    const pendingBrokerage = totalBrokerageRevenue - receivedBrokerage;

    // ── 2. Employee costs (payroll) ───────────────────────────────────────────
    const payrollRows = await query<any>(
      `SELECT COALESCE(SUM(pr.gross_salary + pr.total_additions), 0) AS cost
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id AND pp.organization_id = pr.organization_id
       WHERE pr.organization_id = $1
         AND pp.status IN ('approved','submitted')
         AND (pp.period_year * 100 + pp.period_month) >= $2
         AND (pp.period_year * 100 + pp.period_month) <= $3`,
      [orgId, fromYM, toYM]
    );
    const totalEmployeeCosts = Number(payrollRows[0]?.cost ?? 0);

    // ── 3. Resource costs ─────────────────────────────────────────────────────
    const resourceRows = await query<any>(
      `SELECT COALESCE(SUM(
        CASE
          WHEN allocation_method = 'one_time' THEN purchase_cost
          WHEN allocation_method = 'monthly' THEN
            monthly_amount * GREATEST(1,
              (EXTRACT(YEAR FROM LEAST($3::date, COALESCE(allocation_end, $3::date))) * 12
               + EXTRACT(MONTH FROM LEAST($3::date, COALESCE(allocation_end, $3::date))))
              - (EXTRACT(YEAR FROM GREATEST($2::date, allocation_start)) * 12
                 + EXTRACT(MONTH FROM GREATEST($2::date, allocation_start)))
              + 1)
          ELSE 0
        END
       ), 0) AS cost
       FROM employee_resource_expenses
       WHERE organization_id = $1
         AND status = 'active'
         AND is_company_expense = true
         AND (
           (allocation_method = 'one_time' AND purchase_date >= $2::date AND purchase_date <= $3::date)
           OR
           (allocation_method = 'monthly' AND allocation_start <= $3::date AND COALESCE(allocation_end, $3::date) >= $2::date)
         )`,
      [orgId, from, to]
    );
    const totalResourceCosts = Number(resourceRows[0]?.cost ?? 0);
    const totalCosts = totalEmployeeCosts + totalResourceCosts;

    // ── 4. Profitability ──────────────────────────────────────────────────────
    const netContribution = totalBrokerageRevenue - totalCosts;
    const profitMargin = totalBrokerageRevenue > 0
      ? Math.round((netContribution / totalBrokerageRevenue) * 10000) / 100
      : 0;

    // ── 4b. Booking counts — from booking_applications directly ────────────────
    // The canonical source of bookings is booking_applications, NOT booking_brokerage.
    // A booking exists even if brokerage has not been configured for it yet.

    // All-time org bookings (excluding cancelled)
    const allTimeRows = await query<any>(
      `SELECT COUNT(*)::int AS cnt,
              COALESCE(SUM(CASE WHEN agreement_value IS NOT NULL THEN agreement_value ELSE 0 END), 0) AS val
       FROM booking_applications
       WHERE organization_id = $1
         AND LOWER(COALESCE(booking_status, '')) <> 'cancelled'`,
      [orgId]
    );
    const allTimeBookings = Number(allTimeRows[0]?.cnt ?? 0);
    const allTimeBookingValue = Number(allTimeRows[0]?.val ?? 0);

    // Date-range bookings
    const rangeRows = await query<any>(
      `SELECT COUNT(*)::int AS cnt,
              COALESCE(SUM(CASE WHEN agreement_value IS NOT NULL THEN agreement_value ELSE 0 END), 0) AS val
       FROM booking_applications
       WHERE organization_id = $1
         AND LOWER(COALESCE(booking_status, '')) <> 'cancelled'
         AND (booking_date >= $2::date AND booking_date <= $3::date
              OR (booking_date IS NULL AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')))`,
      [orgId, from, to]
    );
    const completedBookings = Number(rangeRows[0]?.cnt ?? 0);
    const totalBookingValue = Number(rangeRows[0]?.val ?? 0);

    // Brokerage configuration status
    const configRows = await query<any>(
      `SELECT
         COUNT(ba.id)::int AS total,
         COUNT(bb.id)::int AS configured,
         (COUNT(ba.id) - COUNT(bb.id))::int AS unconfigured
       FROM booking_applications ba
       LEFT JOIN booking_brokerage bb ON bb.booking_id = ba.id AND bb.organization_id = ba.organization_id
       WHERE ba.organization_id = $1
         AND LOWER(COALESCE(ba.booking_status, '')) <> 'cancelled'`,
      [orgId]
    );
    const brokerageConfigured = Number(configRows[0]?.configured ?? 0);
    const brokerageUnconfigured = Number(configRows[0]?.unconfigured ?? 0);

    const summary = {
      totalBrokerageRevenue, receivedBrokerage, pendingBrokerage, expectedBrokerage,
      totalEmployeeCosts, totalResourceCosts, totalCosts,
      netContribution, profitMargin, completedBookings, totalBookingValue,
      allTimeBookings, allTimeBookingValue,
      brokerageConfigured, brokerageUnconfigured,
    };

    // ── 5. Monthly chart (last 6 months) ──────────────────────────────────────
    const chartRows = await query<any>(
      `WITH months AS (
        SELECT to_char(d, 'YYYY-MM') AS month
        FROM generate_series(
          date_trunc('month', NOW() - interval '5 months'),
          date_trunc('month', NOW()),
          interval '1 month') AS d
       ),
       rev AS (
        SELECT to_char(created_at, 'YYYY-MM') AS month,
               COALESCE(SUM(brokerage_amount), 0) AS revenue
        FROM booking_brokerage
        WHERE organization_id = $1
          AND status IN ('received','partially_received','expected')
          AND created_at >= date_trunc('month', NOW() - interval '5 months')
        GROUP BY 1
       ),
       costs AS (
        SELECT pp.period_year || '-' || LPAD(pp.period_month::text, 2, '0') AS month,
               COALESCE(SUM(pr.gross_salary + pr.total_additions), 0) AS cost
        FROM payroll_records pr
        JOIN payroll_periods pp ON pp.id = pr.payroll_period_id AND pp.organization_id = pr.organization_id
        WHERE pr.organization_id = $1
          AND pp.status IN ('approved','submitted')
          AND pp.period_year * 100 + pp.period_month >=
              EXTRACT(YEAR FROM NOW() - interval '5 months')::int * 100
              + EXTRACT(MONTH FROM NOW() - interval '5 months')::int
        GROUP BY pp.period_year, pp.period_month
       )
       SELECT m.month,
              COALESCE(r.revenue, 0) AS revenue,
              COALESCE(c.cost, 0) AS costs
       FROM months m
       LEFT JOIN rev r ON r.month = m.month
       LEFT JOIN costs c ON c.month = m.month
       ORDER BY m.month`,
      [orgId]
    );

    const chart = chartRows.map((r: any) => ({
      month: r.month,
      revenue: Number(r.revenue ?? 0),
      costs: Number(r.costs ?? 0),
    }));

    // ── 6. Employee profitability table ────────────────────────────────────────
    const empRows = await query<any>(
      `WITH eb AS (
        SELECT ba.created_by AS uname,
               COALESCE(SUM(bb.brokerage_amount), 0) AS brok
        FROM booking_applications ba
        JOIN booking_brokerage bb ON bb.booking_id = ba.id AND bb.organization_id = ba.organization_id
        WHERE ba.organization_id = $1
          AND bb.status IN ('received','partially_received','expected')
          AND bb.created_at >= $2::date AND bb.created_at < ($3::date + interval '1 day')
        GROUP BY ba.created_by
       ),
       ep AS (
        SELECT pr.user_id,
               COALESCE(SUM(pr.gross_salary + pr.total_additions), 0) AS cost
        FROM payroll_records pr
        JOIN payroll_periods pp ON pp.id = pr.payroll_period_id AND pp.organization_id = pr.organization_id
        WHERE pr.organization_id = $1
          AND pp.status IN ('approved','submitted')
          AND pp.period_year * 100 + pp.period_month >= $4
          AND pp.period_year * 100 + pp.period_month <= $5
        GROUP BY pr.user_id
       ),
       er AS (
        SELECT user_id,
               COALESCE(SUM(CASE WHEN allocation_method = 'one_time' THEN purchase_cost ELSE monthly_amount END), 0) AS rcost
        FROM employee_resource_expenses
        WHERE organization_id = $1 AND status = 'active' AND is_company_expense = true
        GROUP BY user_id
       )
       SELECT u.id AS user_id, u.name, u.role,
              COALESCE(eb.brok, 0) AS brokerage_generated,
              COALESCE(ep.cost, 0) AS employee_cost,
              COALESCE(er.rcost, 0) AS resource_cost,
              (COALESCE(eb.brok, 0) - COALESCE(ep.cost, 0) - COALESCE(er.rcost, 0)) AS net_contribution
       FROM users u
       LEFT JOIN eb ON eb.uname = u.name
       LEFT JOIN ep ON ep.user_id = u.id
       LEFT JOIN er ON er.user_id = u.id
       WHERE u.organization_id = $1
         AND u.is_active = true
         AND (eb.brok IS NOT NULL OR ep.cost IS NOT NULL OR er.rcost IS NOT NULL)
       ORDER BY net_contribution DESC
       LIMIT 20`,
      [orgId, from, to, fromYM, toYM]
    );

    const employees = empRows.map((r: any) => ({
      userId: r.user_id,
      name: r.name,
      role: r.role,
      brokerageGenerated: Number(r.brokerage_generated ?? 0),
      employeeCost: Number(r.employee_cost ?? 0),
      resourceCost: Number(r.resource_cost ?? 0),
      netContribution: Number(r.net_contribution ?? 0),
    }));

    return NextResponse.json({ success: true, data: { summary, chart, employees } });
  } catch (err: any) {
    console.error("[HR Profitability]", err);

    // If the brokerage tables haven't been migrated yet, still return
    // booking counts from booking_applications (which does exist).
    const msg = String(err.message || "");
    if (msg.includes("does not exist") && (msg.includes("booking_brokerage") || msg.includes("employee_resource_expenses"))) {
      try {
        const orgId = await getOrganizationId();
        const sp = req.nextUrl.searchParams;
        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const from = sp.get("from") || firstOfMonth.toISOString().slice(0, 10);
        const to = sp.get("to") || now.toISOString().slice(0, 10);

        const allTimeRows = await query<any>(
          `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(CASE WHEN agreement_value IS NOT NULL THEN agreement_value ELSE 0 END), 0) AS val
           FROM booking_applications WHERE organization_id = $1 AND LOWER(COALESCE(booking_status, '')) <> 'cancelled'`,
          [orgId]
        );
        const rangeRows = await query<any>(
          `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(CASE WHEN agreement_value IS NOT NULL THEN agreement_value ELSE 0 END), 0) AS val
           FROM booking_applications WHERE organization_id = $1 AND LOWER(COALESCE(booking_status, '')) <> 'cancelled'
           AND (booking_date >= $2::date AND booking_date <= $3::date OR (booking_date IS NULL AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')))`,
          [orgId, from, to]
        );

        const empty = {
          totalBrokerageRevenue: 0, receivedBrokerage: 0, pendingBrokerage: 0, expectedBrokerage: 0,
          totalEmployeeCosts: 0, totalResourceCosts: 0, totalCosts: 0,
          netContribution: 0, profitMargin: 0,
          completedBookings: Number(rangeRows[0]?.cnt ?? 0),
          totalBookingValue: Number(rangeRows[0]?.val ?? 0),
          allTimeBookings: Number(allTimeRows[0]?.cnt ?? 0),
          allTimeBookingValue: Number(allTimeRows[0]?.val ?? 0),
          brokerageConfigured: 0,
          brokerageUnconfigured: Number(allTimeRows[0]?.cnt ?? 0),
        };
        return NextResponse.json({
          success: true,
          data: { summary: empty, chart: [], employees: [] },
          _migrationPending: true,
        });
      } catch {
        // booking_applications itself failed — return full zeros
        const empty = {
          totalBrokerageRevenue: 0, receivedBrokerage: 0, pendingBrokerage: 0, expectedBrokerage: 0,
          totalEmployeeCosts: 0, totalResourceCosts: 0, totalCosts: 0,
          netContribution: 0, profitMargin: 0, completedBookings: 0, totalBookingValue: 0,
          allTimeBookings: 0, allTimeBookingValue: 0,
          brokerageConfigured: 0, brokerageUnconfigured: 0,
        };
        return NextResponse.json({
          success: true,
          data: { summary: empty, chart: [], employees: [] },
          _migrationPending: true,
        });
      }
    }

    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
