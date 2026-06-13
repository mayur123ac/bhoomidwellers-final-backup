// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (session) {
      const userId = session._id;
      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Close the active session
      await query(
        `UPDATE employee_sessions 
         SET session_end = $1, is_active = false 
         WHERE user_id = $2 AND is_active = true`,
        [now, userId]
      );

      // Update attendance logout time and recalculate working hours
      await query(
        `UPDATE employee_attendance 
         SET last_logout = $1,
             working_hours = ROUND(CAST(EXTRACT(EPOCH FROM ($1 - first_login))/3600 AS NUMERIC), 2)
         WHERE user_id = $2 AND date = $3`,
        [now, userId, today]
      );
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
