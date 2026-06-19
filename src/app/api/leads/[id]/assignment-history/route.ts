// app/api/leads/[id]/assignment-history/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const leadId = Number(id);
    if (Number.isNaN(leadId)) {
      return NextResponse.json(
        { success: false, message: "Invalid lead ID" },
        { status: 400 }
      );
    }

    const rows = await query(
      `
        SELECT id, lead_id, assigned_to, assigned_by, assigned_at, reason
        FROM lead_assignment_logs
        WHERE lead_id = $1
        ORDER BY assigned_at DESC, id DESC
      `,
      [leadId]
    );

    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (error: any) {
    console.error(`[GET /api/leads/${id}/assignment-history]`, error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to load assignment history" },
      { status: 500 }
    );
  }
}
