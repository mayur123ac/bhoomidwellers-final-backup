// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (session) {
      const userId = session._id;
      const now = new Date();

      // Close the active session
      await query(
        `UPDATE employee_sessions
         SET session_end = $1, is_active = false
         WHERE user_id = $2 AND is_active = true AND organization_id = $3`,
        [now, userId, await getOrganizationId()]
      );

      // MT-03: the `UPDATE employee_attendance` that used to sit here has been
      // removed. Attendance moved to `attendance_records` (see api/attendance/*),
      // and nothing in the application ever INSERTed into employee_attendance —
      // so this statement matched zero rows on every logout since the migration,
      // failing silently inside the catch below. The table is slated for DROP.
      // Logout time is derived from employee_sessions.session_end.
    }
  } catch (err) {
    console.error("Logout DB update error:", err);
  }

  const response = NextResponse.json(
    { message: "Logout successful" },
    { status: 200 }
  );

  // Clear the auth cookie
  response.cookies.set({
    name: "crm_session",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0), // Expire immediately
  });

  return response;
}
