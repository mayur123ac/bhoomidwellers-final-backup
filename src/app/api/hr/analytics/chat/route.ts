// app/api/hr/analytics/chat/route.ts
//
// AI-powered HR Analytics chat. HR asks questions in natural language;
// the system queries org-scoped HR data, computes facts in TypeScript,
// and the LLM phrases them. The SQL is the wall — the model never sees
// data from another org or invents numbers.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { askOpenAI, type ChatTurn, LlmError, MAX_QUESTION_CHARS, isLlmConfigured } from "@/app/api/ai-assistant/llm";

export const dynamic = "force-dynamic";

const HR_SYSTEM_PROMPT = `You are Bhoomi HR Analytics — an AI assistant for the HR department.

RULES:
1. You ONLY answer questions about the HR data provided in the DATA BLOCK below.
2. Every number, total, average, ratio and trend is ALREADY computed. Quote them verbatim. NEVER recompute or estimate.
3. If the data block does not contain information to answer a question, say so clearly. Do NOT guess.
4. Be concise, professional, and use bullet points where helpful.
5. Format currency in INR (use ₹ and L/Cr notation).
6. When discussing individuals, use their name and role.
7. Flag anomalies or concerns proactively when relevant.
8. Never reveal raw SQL, internal IDs, or system details.`;

// ── Build HR data digest ────────────────────────────────────────────────────
async function buildHRDigest(orgId: string): Promise<string> {
  const out: string[] = [];
  out.push(`HR ANALYTICS DIGEST`);
  out.push(`Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  out.push("");

  // 1. Workforce summary
  const employees = await query<any>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            u.department, u.designation, u.employee_code
     FROM users u
     WHERE u.organization_id = $1 AND u.is_active = true
     ORDER BY u.name`,
    [orgId]
  );

  out.push(`WORKFORCE: ${employees.length} active employees`);
  const byRole = new Map<string, number>();
  const byDept = new Map<string, number>();
  for (const e of employees) {
    const r = e.role || "Unassigned";
    byRole.set(r, (byRole.get(r) || 0) + 1);
    const d = e.department || "Unassigned";
    byDept.set(d, (byDept.get(d) || 0) + 1);
  }
  out.push("  By Role:");
  for (const [k, v] of [...byRole.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`    ${k}: ${v}`);
  }
  if ([...byDept.keys()].some((k) => k !== "Unassigned")) {
    out.push("  By Department:");
    for (const [k, v] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`    ${k}: ${v}`);
    }
  }
  out.push("");

  // 2. Attendance (last 30 days)
  // Actual columns: employee_id, attendance_status, login_time, logout_time (no "date", "status", "clock_in/out")
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const attendance = await query<any>(
    `SELECT ar.employee_id AS user_id, u.name,
            DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') AS date,
            ar.attendance_status AS status,
            ar.login_time, ar.logout_time
     FROM attendance_records ar
     JOIN users u ON u.id = ar.employee_id
     WHERE ar.organization_id = $1
       AND DATE(ar.login_time AT TIME ZONE 'Asia/Kolkata') >= $2::date
     ORDER BY ar.login_time DESC`,
    [orgId, thirtyDaysAgo]
  );

  const totalDays = attendance.length;
  const presentDays = attendance.filter((a: any) => (a.status || "").toLowerCase() === "present").length;
  const absentDays = attendance.filter((a: any) => (a.status || "").toLowerCase() === "absent").length;
  const lateDays = attendance.filter((a: any) => (a.status || "").toLowerCase() === "late").length;
  const leaveDays = attendance.filter((a: any) => {
    const s = (a.status || "").toLowerCase();
    return s === "leave" || s === "on_leave" || s.includes("leave");
  }).length;

  out.push("ATTENDANCE (Last 30 days):");
  out.push(`  Total records: ${totalDays}`);
  out.push(`  Present: ${presentDays} | Absent: ${absentDays} | Late: ${lateDays} | On leave: ${leaveDays}`);
  if (totalDays > 0) {
    out.push(`  Attendance rate: ${Math.round((presentDays / totalDays) * 100)}%`);
  }

  // Per-employee attendance summary
  const empAttendance = new Map<number, { name: string; present: number; absent: number; late: number; total: number }>();
  for (const a of attendance) {
    let ea = empAttendance.get(a.user_id);
    if (!ea) { ea = { name: a.name, present: 0, absent: 0, late: 0, total: 0 }; empAttendance.set(a.user_id, ea); }
    ea.total++;
    const st = (a.status || "").toLowerCase();
    if (st === "present") ea.present++;
    else if (st === "absent") ea.absent++;
    else if (st === "late") ea.late++;
  }

  // Flag employees with low attendance
  const lowAttendance = [...empAttendance.entries()]
    .filter(([, v]) => v.total >= 5 && (v.present / v.total) < 0.7)
    .sort((a, b) => (a[1].present / a[1].total) - (b[1].present / b[1].total));

  if (lowAttendance.length > 0) {
    out.push("  LOW ATTENDANCE ALERT (<70%):");
    for (const [, v] of lowAttendance.slice(0, 10)) {
      out.push(`    ${v.name}: ${Math.round((v.present / v.total) * 100)}% (${v.present}/${v.total} days present)`);
    }
  }
  out.push("");

  // 3. Leave summary (table may not be migrated)
  // Actual table: employee_leave_records (not "leave_requests")
  try {
    const leaves = await query<any>(
      `SELECT lr.user_id, u.name, lr.leave_type, lr.status, lr.start_date, lr.end_date, lr.days
       FROM employee_leave_records lr
       JOIN users u ON u.id = lr.user_id
       WHERE lr.organization_id = $1
       ORDER BY lr.created_at DESC
       LIMIT 200`,
      [orgId]
    );

    const approvedLeaves = leaves.filter((l: any) => l.status === "approved");
    const pendingLeaves = leaves.filter((l: any) => l.status === "pending");
    const byLeaveType = new Map<string, number>();
    for (const l of approvedLeaves) {
      const t = l.leave_type || "Unspecified";
      byLeaveType.set(t, (byLeaveType.get(t) || 0) + (l.days || 1));
    }

    out.push("LEAVE SUMMARY:");
    out.push(`  Total leave requests: ${leaves.length}`);
    out.push(`  Approved: ${approvedLeaves.length} | Pending: ${pendingLeaves.length}`);
    const totalLeaveDays = approvedLeaves.reduce((s: number, l: any) => s + (l.days || 1), 0);
    out.push(`  Total approved leave days: ${totalLeaveDays}`);
    if (byLeaveType.size > 0) {
      out.push("  By type (approved days):");
      for (const [k, v] of [...byLeaveType.entries()].sort((a, b) => b[1] - a[1])) {
        out.push(`    ${k}: ${v} days`);
      }
    }
    out.push("");
  } catch { /* employee_leave_records table may not exist */ }

  // 4. Payroll summary
  const payrollPeriods = await query<any>(
    `SELECT pp.id, pp.period_year, pp.period_month, pp.status,
            pp.total_gross, pp.total_deductions, pp.total_net,
            (SELECT COUNT(*) FROM payroll_records pr WHERE pr.payroll_period_id = pp.id) AS record_count,
            (SELECT COUNT(*) FROM payroll_records pr WHERE pr.payroll_period_id = pp.id AND pr.status = 'exception') AS exception_count
     FROM payroll_periods pp
     WHERE pp.organization_id = $1
     ORDER BY pp.period_year DESC, pp.period_month DESC
     LIMIT 12`,
    [orgId]
  );

  out.push("PAYROLL (recent periods):");
  if (payrollPeriods.length === 0) {
    out.push("  No payroll periods found.");
  } else {
    for (const p of payrollPeriods.slice(0, 6)) {
      const monthName = new Date(2000, p.period_month - 1).toLocaleString("en", { month: "short" });
      out.push(
        `  ${monthName} ${p.period_year}: status=${p.status}, employees=${p.record_count}, ` +
        `gross=₹${Number(p.total_gross || 0).toLocaleString("en-IN")}, ` +
        `deductions=₹${Number(p.total_deductions || 0).toLocaleString("en-IN")}, ` +
        `net=₹${Number(p.total_net || 0).toLocaleString("en-IN")}` +
        (p.exception_count > 0 ? ` [${p.exception_count} EXCEPTIONS]` : "")
      );
    }

    // Salary distribution
    const latestPeriod = payrollPeriods[0];
    if (latestPeriod) {
      const records = await query<any>(
        `SELECT pr.user_id, u.name, u.role, pr.base_salary, pr.gross_salary,
                pr.net_payable, pr.status AS record_status, pr.incentive_total
         FROM payroll_records pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.payroll_period_id = $1 AND pr.organization_id = $2
         ORDER BY pr.net_payable DESC`,
        [latestPeriod.id, orgId]
      );

      if (records.length > 0) {
        const salaries = records.map((r: any) => Number(r.net_payable)).filter((n: number) => n > 0);
        const avg = salaries.length ? salaries.reduce((a: number, b: number) => a + b, 0) / salaries.length : 0;
        const sorted = [...salaries].sort((a, b) => a - b);
        const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
        const totalIncentives = records.reduce((s: number, r: any) => s + Number(r.incentive_total || 0), 0);

        out.push("");
        out.push(`  Latest period salary distribution (${records.length} employees):`);
        out.push(`    Average net: ₹${Math.round(avg).toLocaleString("en-IN")}`);
        out.push(`    Median net: ₹${Math.round(median).toLocaleString("en-IN")}`);
        if (sorted.length) {
          out.push(`    Min: ₹${Math.round(sorted[0]).toLocaleString("en-IN")} | Max: ₹${Math.round(sorted[sorted.length - 1]).toLocaleString("en-IN")}`);
        }
        out.push(`    Total incentives: ₹${Math.round(totalIncentives).toLocaleString("en-IN")}`);

        // Top earners
        out.push("    Top 5 by net payable:");
        for (const r of records.slice(0, 5)) {
          out.push(`      ${r.name} (${r.role}): ₹${Number(r.net_payable).toLocaleString("en-IN")}`);
        }
      }
    }
  }
  out.push("");

  // 5. HR Connect requests summary (table may not be migrated)
  try {
    const connectRequests = await query<any>(
      `SELECT r.status, r.category, r.priority, r.created_at
       FROM hr_requests r
       WHERE r.organization_id = $1
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [orgId]
    );

    if (connectRequests.length > 0) {
      const openReqs = connectRequests.filter((r: any) => r.status === "open").length;
      const inProgress = connectRequests.filter((r: any) => r.status === "in_progress").length;
      const resolved = connectRequests.filter((r: any) => r.status === "resolved" || r.status === "closed").length;
      const urgent = connectRequests.filter((r: any) => r.priority === "urgent" || r.priority === "high").length;
      const byCategory = new Map<string, number>();
      for (const r of connectRequests) {
        byCategory.set(r.category, (byCategory.get(r.category) || 0) + 1);
      }

      out.push("HR CONNECT REQUESTS:");
      out.push(`  Total: ${connectRequests.length} | Open: ${openReqs} | In Progress: ${inProgress} | Resolved: ${resolved}`);
      out.push(`  Urgent/High priority: ${urgent}`);
      out.push("  By category:");
      for (const [k, v] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
        out.push(`    ${k}: ${v}`);
      }
      out.push("");
    }
  } catch { /* hr_requests table may not exist */ }

  // 6. Incentives summary (table may not be migrated)
  try {
    const incentives = await query<any>(
      `SELECT ei.user_id, u.name, SUM(ei.amount) AS total_amount, COUNT(*) AS count
       FROM employee_incentives ei
       JOIN users u ON u.id = ei.user_id
       WHERE ei.organization_id = $1
       GROUP BY ei.user_id, u.name
       ORDER BY total_amount DESC`,
      [orgId]
    );

    if (incentives.length > 0) {
      const grandTotal = incentives.reduce((s: number, i: any) => s + Number(i.total_amount), 0);
      out.push("INCENTIVES:");
      out.push(`  Total distributed: ₹${Math.round(grandTotal).toLocaleString("en-IN")} across ${incentives.length} employees`);
      out.push("  Top 5 recipients:");
      for (const i of incentives.slice(0, 5)) {
        out.push(`    ${i.name}: ₹${Number(i.total_amount).toLocaleString("en-IN")} (${i.count} incentives)`);
      }
      out.push("");
    }
  } catch { /* employee_incentives table may not exist */ }

  return out.join("\n");
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response;

  if (!isLlmConfigured()) {
    return NextResponse.json(
      { success: false, message: "AI assistant is not configured (OPENAI_API_KEY missing)." },
      { status: 503 }
    );
  }

  try {
    const orgId = await getOrganizationId();
    const body = await req.json();
    const { question, history } = body;

    if (!question?.trim()) {
      return NextResponse.json(
        { success: false, message: "Question is required." },
        { status: 400 }
      );
    }

    if (question.length > MAX_QUESTION_CHARS) {
      return NextResponse.json(
        { success: false, message: `Question must be under ${MAX_QUESTION_CHARS} characters.` },
        { status: 400 }
      );
    }

    const digest = await buildHRDigest(String(orgId));

    const { answer, usage } = await askOpenAI(
      question.trim(),
      digest,
      (history || []) as ChatTurn[],
      HR_SYSTEM_PROMPT
    );

    return NextResponse.json({
      success: true,
      data: { answer, usage },
    });
  } catch (err: any) {
    if (err instanceof LlmError) {
      return NextResponse.json(
        { success: false, message: err.userMessage },
        { status: err.status }
      );
    }
    console.error("[POST /api/hr/analytics/chat]", err);
    return NextResponse.json(
      { success: false, message: "Failed to process question." },
      { status: 500 }
    );
  }
}
