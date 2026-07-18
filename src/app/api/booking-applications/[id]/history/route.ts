// app/api/booking-applications/[id]/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Check if table exists (in case there are no history entries yet)
    await query(`
      CREATE TABLE IF NOT EXISTS booking_history (
          id SERIAL PRIMARY KEY,
          booking_id INT REFERENCES booking_applications(id) ON DELETE CASCADE,
          updated_by VARCHAR(255) NOT NULL,
          user_role VARCHAR(100) NOT NULL,
          changed_fields JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const rows = await query(
      `SELECT * FROM booking_history WHERE booking_id = $1 ORDER BY created_at DESC`,
      [Number(id)]
    );
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]/history]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
