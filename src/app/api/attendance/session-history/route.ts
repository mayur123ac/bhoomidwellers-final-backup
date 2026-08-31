import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireRole(["admin", "sales_manager", "sales manager", "site_head", "site head", "receptionist"]);
    if (!auth.isAuthorized) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const dateStr = searchParams.get("date");

    if (!userId) {
      return NextResponse.json({ message: "Missing userId" }, { status: 400 });
    }

    let queryStr = `
      SELECT
        id,
        session_start,
        session_end,
        is_active,
        ip_address,
        device_info,
        session_end_reason,
        login_latitude,
        login_longitude,
        login_location_name,
        login_location_accuracy,
        login_device_name,
        login_device_type,
        login_os,
        login_browser,
        EXTRACT(EPOCH FROM (COALESCE(session_end, NOW()) - session_start)) as session_duration_seconds
      FROM employee_sessions
      WHERE user_id = $1 AND organization_id = $2
    `;
    // userId arrives as a query parameter, so the organization predicate is what
    // stops one tenant's manager reading another tenant's session history by id.
    // It is part of the base clause rather than an optional one, so no branch of
    // this builder can produce an unscoped statement.
    const params: any[] = [userId, await getOrganizationId()];

    if (dateStr) {
      // Cast to DATE to ignore the time component, assuming session_start is timestamp
      queryStr += ` AND DATE(session_start AT TIME ZONE 'Asia/Kolkata') = $3`;
      params.push(dateStr);
    }

    queryStr += ` ORDER BY session_start DESC LIMIT 50`;

    const sessions = await query(queryStr, params);

    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    console.error("Session history error:", error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
