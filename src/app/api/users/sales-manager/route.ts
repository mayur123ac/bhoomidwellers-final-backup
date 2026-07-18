// app/api/users/sales-manager/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    // Case-insensitive match — same behaviour as the old MongoDB $regex
    const managers = await query(
      `SELECT id, name
       FROM users
       WHERE LOWER(role) = 'sales manager'
         AND is_active = true
       ORDER BY name ASC`
    );

    // Return { success, data } — same shape the receptionist page already expects
    return NextResponse.json(
      { success: true, data: managers },
      { status: 200 }
    );

  } catch (error) {
    console.error("GET /api/users/sales-manager error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch managers" },
      { status: 500 }
    );
  }
}
