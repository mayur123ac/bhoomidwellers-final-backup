// src/app/api/caller-leads/route.ts
import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { broadcastUpdate } from "./events/route";

// ── POST: Bulk insert leads from Excel upload ─────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { leads = [], fileName, uploadedBy, assignedTo } = body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: "No leads provided" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      const { rows: batchRows } = await client.query(
        `INSERT INTO caller_upload_batches (file_name, row_count, uploaded_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [fileName ?? "upload", leads.length, uploadedBy ?? "unknown"]
      );
      const batchId = batchRows[0].id;

      const ids: number[] = [];
      for (const lead of leads) {
        const { rows } = await client.query(
          `INSERT INTO caller_leads
              (upload_batch, batch_name, sr_no, form_no, lead_date, name,
               contact_no, email, source, channel_partner, assign_manager,
               feedback, uploaded_by, assigned_to, saved_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id`,
          [
            batchId, fileName ?? null,
            lead.sr_no ?? null, lead.form_no ?? null, lead.lead_date ?? null,
            lead.name ?? "Unknown", lead.contact_no ?? null, lead.email ?? null,
            lead.source ?? null, lead.channel_partner ?? null,
            lead.assign_manager ?? null, lead.feedback ?? "",
            uploadedBy ?? "unknown",
            (assignedTo || uploadedBy) ?? "unknown",
            null,
          ]
        );
        ids.push(rows[0].id);
      }
      return { batchId, ids };
    });

    broadcastUpdate({
      type: "leads_uploaded",
      batchId: result.batchId,
      count: leads.length,
      fileName,
      uploadedBy,
      assignedTo: assignedTo || uploadedBy,
      ts: Date.now(),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/caller-leads]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── GET: Fetch all leads ──────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const batch      = searchParams.get("batch");
    const batchesOnly = searchParams.get("batches_only");

    if (batchesOnly === "1") {
      const rows = await query(
        `SELECT id, file_name, row_count, uploaded_by, created_at
         FROM caller_upload_batches ORDER BY created_at DESC`
      );
      return NextResponse.json({ batches: rows });
    }

    const rows = await query(
      `SELECT cl.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id', cf.id, 'message', cf.message,
               'created_by_name', cf.created_by_name, 'created_at', cf.created_at
             ) ORDER BY cf.created_at ASC
           ) FILTER (WHERE cf.id IS NOT NULL), '[]'
         ) AS follow_ups
       FROM caller_leads cl
       LEFT JOIN caller_follow_ups cf ON cf.lead_id = cl.id
       ${batch ? "WHERE cl.upload_batch::text = $1" : ""}
       GROUP BY cl.id
       ORDER BY cl.created_at DESC`,
      batch ? [batch] : []
    );

    return NextResponse.json({ leads: rows });
  } catch (err: any) {
    console.error("[GET /api/caller-leads]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── DELETE: Delete entire batch ───────────────────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const { batchId } = await req.json();
    if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

    await transaction(async (client) => {
      await client.query(
        `DELETE FROM caller_follow_ups
         WHERE lead_id IN (SELECT id FROM caller_leads WHERE upload_batch::text = $1)`,
        [batchId]
      );
      await client.query(`DELETE FROM caller_leads WHERE upload_batch::text = $1`, [batchId]);
      await client.query(`DELETE FROM caller_upload_batches WHERE id::text = $1`, [batchId]);
    });

    broadcastUpdate({ type: "batch_deleted", batchId, ts: Date.now() });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[DELETE /api/caller-leads]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}