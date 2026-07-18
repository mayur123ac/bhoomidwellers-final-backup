// app/api/caller-leads/[id]/route.ts
import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { broadcastUpdate } from "../events/route";

// ── PATCH: Update lead fields ─────────────────────────────────────────────────
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Already has these — verify they're in ALLOWED:
    const ALLOWED = [
      "name", "contact_no", "email", "budget", "location",
      "source", "channel_partner", "assign_manager", "feedback",
      "interest_status", "status", "site_visit_date", "saved_by",
    ] as const;

    const setClauses: string[] = [];
    const values: any[] = [];
    let p = 1;

    for (const key of ALLOWED) {
      if (key in body) {
        setClauses.push(`${key} = $${p++}`);
        values.push(body[key]);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    values.push(parseInt(id, 10));
    const rows = await query(
      `UPDATE caller_leads SET ${setClauses.join(", ")} WHERE id = $${p} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // 🔴 Broadcast lead update
    broadcastUpdate({
      type: "lead_updated",
      leadId: parseInt(id, 10),
      changes: body,
      ts: Date.now(),
    });

    return NextResponse.json(rows[0]);
  } catch (err: any) {
    console.error("[PATCH /api/caller-leads/:id]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── DELETE: Remove single lead ────────────────────────────────────────────────
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leadId = parseInt(id, 10);

    await transaction(async (client) => {
      const { rows: leadRows } = await client.query(
        `SELECT upload_batch FROM caller_leads WHERE id = $1`, [leadId]
      );
      const batchId = leadRows[0]?.upload_batch;

      await client.query(`DELETE FROM caller_follow_ups WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM caller_leads WHERE id = $1`, [leadId]);

      if (batchId) {
        const { rows: remaining } = await client.query(
          `SELECT COUNT(*) as cnt FROM caller_leads WHERE upload_batch = $1`, [batchId]
        );
        if (parseInt(remaining[0].cnt) === 0) {
          await client.query(`DELETE FROM caller_upload_batches WHERE id = $1`, [batchId]);
        }
      }
    });

    // 🔴 Broadcast deletion
    broadcastUpdate({ type: "lead_deleted", leadId, ts: Date.now() });

    return NextResponse.json({ success: true, deletedId: leadId });
  } catch (err: any) {
    console.error("[DELETE /api/caller-leads/:id]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}