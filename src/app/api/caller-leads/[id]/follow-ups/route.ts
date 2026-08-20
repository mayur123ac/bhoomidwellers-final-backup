// app/api/caller-leads/[id]/follow-ups/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const { message, created_by } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const rows = await query(
      // Organization inherited from the caller lead in SQL, which also makes a
      // follow-up under another tenant's lead impossible.
      `INSERT INTO caller_follow_ups (lead_id, message, created_by_name, organization_id)
       VALUES ($1, $2, $3,
               (SELECT organization_id FROM caller_leads WHERE id = $1)) RETURNING *`,
      [parseInt(id, 10), message.trim(), created_by ?? "Caller"]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/caller-leads/:id/follow-ups]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}