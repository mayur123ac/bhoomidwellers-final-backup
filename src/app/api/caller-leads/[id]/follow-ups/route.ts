// app/api/caller-leads/[id]/follow-ups/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { message, created_by } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const rows = await query(
      `INSERT INTO caller_follow_ups (lead_id, message, created_by_name)
       VALUES ($1, $2, $3) RETURNING *`,
      [parseInt(id, 10), message.trim(), created_by ?? "Caller"]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/caller-leads/:id/follow-ups]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}