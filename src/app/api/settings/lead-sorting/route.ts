// app/api/settings/lead-sorting/route.ts
import { NextResponse } from "next/server";
import { query, recalculateSrNos } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/settings/lead-sorting
// Returns the current lead number sorting toggle state
export async function GET() {
  try {
    const res = await query(
      `SELECT lead_number_sorting_enabled 
       FROM organization_settings 
       WHERE organization_id = 1`
    );

    if (res.length === 0) {
      return NextResponse.json({ enabled: false });
    }

    return NextResponse.json({
      enabled: res[0].lead_number_sorting_enabled === true,
    });
  } catch (error) {
    console.error("[GET /api/settings/lead-sorting]", error);
    return NextResponse.json({ enabled: false });
  }
}

// POST /api/settings/lead-sorting
// Admin-only: toggle lead number sorting mode and immediately recalculate
export async function POST(req: Request) {
  try {
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Admins only" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { enabled } = body;

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { success: false, message: "Invalid value: 'enabled' must be a boolean" },
        { status: 400 }
      );
    }

    // Save the setting
    await query(
      `INSERT INTO organization_settings (organization_id, shift_start, shift_end, flexible, lead_number_sorting_enabled)
       VALUES (1, '11:00', '20:00', false, $1)
       ON CONFLICT (organization_id) DO UPDATE
         SET lead_number_sorting_enabled = EXCLUDED.lead_number_sorting_enabled,
             updated_at = CURRENT_TIMESTAMP`,
      [enabled]
    );

    // Immediately recalculate all sr_nos with the new algorithm
    await recalculateSrNos();

    return NextResponse.json({
      success: true,
      message: `Lead number sorting ${enabled ? "enabled (Backdated-priority mode)" : "disabled (Default mode)"}`,
      enabled,
    });
  } catch (error: any) {
    console.error("[POST /api/settings/lead-sorting]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
