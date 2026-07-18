// app/api/leads/route.ts
// ─────────────────────────────────────────────
// POST /api/leads  — bulk insert leads from Excel upload
// GET  /api/leads  — fetch all leads (optional batch filter)
// ─────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";

// ── POST — save uploaded leads to DB ──────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { leads, fileName, uploadedBy } = body as {
      leads: LeadInput[];
      fileName?: string;
      uploadedBy?: string;
    };

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: "No leads provided" }, { status: 400 });
    }

    const result = await transaction(async (client) => {
      // 1. Create upload batch record
      const batchRes = await client.query(
        `INSERT INTO upload_batches (file_name, row_count, uploaded_by)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [fileName ?? "unknown.xlsx", leads.length, uploadedBy ?? "Caller"]
      );
      const batchId: string = batchRes.rows[0].id;

      // 2. Bulk-insert leads using a single multi-row INSERT
      //    Build parameterised placeholders: ($1,$2,...), ($n+1,...)
      const values: any[] = [];
      const placeholders = leads.map((lead, i) => {
        const base = i * 10;
        values.push(
          batchId,
          lead.sr_no        ?? null,
          lead.form_no      ?? null,
          lead.lead_date    ?? null,
          lead.name,
          lead.contact_no   ?? null,
          lead.source       ?? null,
          lead.channel_partner ?? null,
          lead.assign_manager  ?? null,
          lead.feedback        ?? ""
        );
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10})`;
      });

      const insertRes = await client.query(
        `INSERT INTO leads
           (upload_batch, sr_no, form_no, lead_date, name, contact_no,
            source, channel_partner, assign_manager, feedback)
         VALUES ${placeholders.join(",")}
         RETURNING id, name, contact_no`,
        values
      );

      return { batchId, inserted: insertRes.rowCount ?? 0 };
    });

    return NextResponse.json({
      success: true,
      batchId:  result.batchId,
      inserted: result.inserted,
    });
  } catch (err: any) {
    console.error("[POST /api/leads]", err);
    return NextResponse.json({ error: err.message ?? "Database error" }, { status: 500 });
  }
}

// ── GET — fetch leads (all or by batch) ────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get("batch");
    const limit   = Math.min(Number(searchParams.get("limit") ?? 500), 1000);
    const offset  = Number(searchParams.get("offset") ?? 0);

    let sql = `
      SELECT
        l.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id',         f.id,
              'message',    f.message,
              'created_by', f.created_by,
              'created_at', f.created_at
            ) ORDER BY f.created_at
          ) FILTER (WHERE f.id IS NOT NULL),
          '[]'
        ) AS follow_ups
      FROM leads l
      LEFT JOIN follow_ups f ON f.lead_id = l.id
    `;
    const params: any[] = [];

    if (batchId) {
      sql += " WHERE l.upload_batch = $1";
      params.push(batchId);
    }

    sql += ` GROUP BY l.id ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const rows = await query(sql, params);

    return NextResponse.json({ leads: rows, count: rows.length });
  } catch (err: any) {
    console.error("[GET /api/leads]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Types ──────────────────────────────────────
interface LeadInput {
  sr_no?:           string;
  form_no?:         string;
  lead_date?:       string;
  name:             string;
  contact_no?:      string;
  source?:          string;
  channel_partner?: string;
  assign_manager?:  string;
  feedback?:        string;
}