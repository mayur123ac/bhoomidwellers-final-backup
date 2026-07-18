import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// GET /api/receptionist/leads?name=Receptionist
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { success: false, message: "Query param 'name' is required" },
        { status: 400 }
      );
    }

    const rows = await query(
      `SELECT * FROM walkin_enquiries
       WHERE assigned_receptionist = $1
       ORDER BY created_at DESC`,
      [name] // <-- 'name' is the 1st item in the array, so it is $1
    );

    return NextResponse.json({ success: true, data: rows, total: rows.length }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}