import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/settings/working-hours
// Returns the centralized shift timing for the organization
export async function GET() {
  try {
    const orgId = 1; // Default organization for now

    const res = await query(
      `SELECT shift_start, shift_end, flexible FROM organization_settings WHERE organization_id = $1`,
      [orgId]
    );

    if (res.length > 0) {
      return NextResponse.json({
        loginTime: res[0].shift_start,
        logoutTime: res[0].shift_end,
        flexible: res[0].flexible,
      });
    }

    // If not found, insert default and return
    await query(
      `INSERT INTO organization_settings (organization_id, shift_start, shift_end, flexible) VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id) DO NOTHING`,
      [orgId, "11:00", "20:00", false]
    );

    return NextResponse.json({
      loginTime: "11:00",
      logoutTime: "20:00",
      flexible: false,
    });
  } catch (error) {
    console.error("Error fetching working hours:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/settings/working-hours
// Updates the centralized shift timing (admin only)
export async function POST(req: Request) {
  try {
    // ONLY Admin controls shift timings
    const auth = await requireRole(["admin"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized: Admins only" }, { status: 401 });
    }

    const body = await req.json();
    const { loginTime, logoutTime, flexible } = body;
    const orgId = 1; // Default organization

    // Server-Side Validation
    if (typeof flexible !== "boolean") {
      return NextResponse.json({ message: "Invalid flexible flag" }, { status: 400 });
    }

    if (!flexible) {
      if (!loginTime || !logoutTime) {
        return NextResponse.json({ message: "Start and end times are required" }, { status: 400 });
      }

      // Valid HH:mm format regex
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(loginTime) || !timeRegex.test(logoutTime)) {
        return NextResponse.json({ message: "Invalid time format. Use HH:mm" }, { status: 400 });
      }

      // start < end validation
      if (loginTime >= logoutTime) {
        return NextResponse.json({ message: "Start time must be before end time" }, { status: 400 });
      }
    }

    // Fetch previous timing for audit logging
    const prevRes = await query(
      `SELECT shift_start, shift_end FROM organization_settings WHERE organization_id = $1`,
      [orgId]
    );
    const prevStart = prevRes.length > 0 ? prevRes[0].shift_start : "N/A";
    const prevEnd = prevRes.length > 0 ? prevRes[0].shift_end : "N/A";

    // Update database
    await query(
      `
      INSERT INTO organization_settings (organization_id, shift_start, shift_end, flexible, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id) DO UPDATE SET
        shift_start = EXCLUDED.shift_start,
        shift_end = EXCLUDED.shift_end,
        flexible = EXCLUDED.flexible,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
      `,
      [orgId, loginTime || "11:00", logoutTime || "20:00", flexible, auth.session._id]
    );

    // Add Audit Log
    const actionText = `Admin changed shift timing from ${prevStart}-${prevEnd} to ${loginTime}-${logoutTime} (Flexible: ${flexible})`;
    await query(
      `INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)`,
      [auth.session._id, actionText]
    );

    return NextResponse.json({ success: true, message: "Shift timing updated successfully" });
  } catch (error) {
    console.error("Error updating working hours:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
