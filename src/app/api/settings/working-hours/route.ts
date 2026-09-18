// api/settings/working-hours/route.ts
//
// GET  — returns the organization's shift timing (used by useShiftTiming hook).
// POST — saves updated shift timing (used by LiveActivityView admin panel).
//
// Source table: organization_settings (shift_start, shift_end, flexible).
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();

    const rows = await query<{
      shift_start: string;
      shift_end: string;
      flexible: boolean;
    }>(
      `SELECT shift_start, shift_end, flexible
         FROM organization_settings
        WHERE organization_id = $1
        LIMIT 1`,
      [orgId]
    );

    if (rows.length === 0) {
      // No row yet — return sensible defaults matching useShiftTiming's initial state.
      return NextResponse.json({
        loginTime: "11:00",
        logoutTime: "20:00",
        flexible: false,
      });
    }

    const r = rows[0];
    return NextResponse.json({
      loginTime: r.shift_start,
      logoutTime: r.shift_end,
      flexible: r.flexible ?? false,
    });
  } catch (err: any) {
    console.error("[GET /api/settings/working-hours]", err);
    return NextResponse.json(
      { message: "Failed to fetch shift timing" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const orgId = await getOrganizationId();
    const body = await req.json();

    const loginTime = body.loginTime ?? "11:00";
    const logoutTime = body.logoutTime ?? "20:00";
    const flexible = body.flexible ?? false;

    await query(
      `INSERT INTO organization_settings (organization_id, shift_start, shift_end, flexible, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (organization_id)
       DO UPDATE SET shift_start = EXCLUDED.shift_start,
                     shift_end   = EXCLUDED.shift_end,
                     flexible    = EXCLUDED.flexible,
                     updated_at  = NOW()`,
      [orgId, loginTime, logoutTime, flexible]
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[POST /api/settings/working-hours]", err);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}
