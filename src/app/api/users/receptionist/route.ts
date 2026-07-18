// app/api/users/receptionist/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const receptionists = await query(
      `SELECT id, name, username, email, role, is_active as "isActive"
       FROM users
       WHERE LOWER(role) = 'receptionist'
         AND is_active = true
       ORDER BY name ASC`
    );

    // Map id → _id so any frontend code using _id keeps working
    const mapped = receptionists.map(u => ({ ...u, _id: String(u.id) }));

    return NextResponse.json(
      { success: true, data: mapped },
      { status: 200 }
    );

  } catch (error) {
    console.error("Error fetching receptionists:", error);
    return NextResponse.json(
      { success: false, message: "Server Error fetching receptionists" },
      { status: 500 }
    );
  }
}