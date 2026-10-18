// app/api/hr/payroll/generate/route.ts
//
// POST — cron endpoint to auto-generate payroll for all orgs for the previous month.
// Auth: shared secret (x-payroll-token header) OR admin session.

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { generateMonthlyPayroll } from "@/lib/hr/payrollEngine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Auth: shared secret or admin session
  const token = req.headers.get("x-payroll-token");
  const expectedToken = process.env.PAYROLL_CRON_TOKEN;

  let isAuthed = false;

  if (expectedToken && token === expectedToken) {
    isAuthed = true;
  } else {
    // Fall back to session auth
    try {
      const { requireRoles } = await import("@/lib/serverAuth");
      const gate = await requireRoles(["admin"]);
      if (gate.ok) isAuthed = true;
    } catch {
      // ignore
    }
  }

  if (!isAuthed) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    // Previous month
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed, so this IS prev month (getMonth() returns 0-11)
    if (month === 0) {
      month = 12;
      year--;
    }

    // Get all orgs
    const orgs = await query<{ id: string }>(
      `SELECT id FROM organizations WHERE deleted_at IS NULL`
    );

    const results: any[] = [];

    for (const org of orgs) {
      try {
        const result = await transaction((client) =>
          generateMonthlyPayroll(client, org.id, year, month, null)
        );
        results.push({ orgId: org.id, ...result });
      } catch (err: any) {
        console.error(`[payroll/generate] Failed for org ${org.id}:`, err?.message);
        results.push({ orgId: org.id, error: err?.message });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} organizations for ${year}-${String(month).padStart(2, "0")}.`,
      results,
    });
  } catch (err: any) {
    console.error("[POST /api/hr/payroll/generate]", err);
    return NextResponse.json(
      { success: false, message: "Cron generation failed." },
      { status: 500 }
    );
  }
}
