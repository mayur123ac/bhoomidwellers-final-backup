// app/api/lost-lead/route.ts
// ─────────────────────────────────────────────
// POST /api/lost-lead  — Mark a lead as lost/ghosted
// PUT  /api/lost-lead  — Restore a lost lead to active
// ─────────────────────────────────────────────

import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// ── POST — Mark lead as lost ──────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { lead_id, reason, marked_by } = body as {
      lead_id: number | string;
      reason: string;
      marked_by: string;
    };

    // Validation
    if (!lead_id || !reason || !marked_by) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: lead_id, reason, marked_by" },
        { status: 400 }
      );
    }

    if (reason.trim().length < 10) {
      return NextResponse.json(
        { success: false, message: "Reason must be at least 10 characters long." },
        { status: 400 }
      );
    }

    // Check lead exists
    const existing = await query(
      `SELECT id, name, sr_no, is_lost_lead FROM walkin_enquiries WHERE id = $1`,
      [lead_id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 }
      );
    }

    if (existing[0].is_lost_lead) {
      return NextResponse.json(
        { success: false, message: "Lead is already marked as lost." },
        { status: 400 }
      );
    }

    // Update lead as lost
    const updatedRows = await query(
      `UPDATE walkin_enquiries
       SET is_lost_lead = TRUE,
           lost_lead_reason = $1,
           lost_lead_marked_at = NOW(),
           lost_lead_marked_by = $2
       WHERE id = $3
       RETURNING *`,
      [reason.trim(), marked_by, lead_id]
    );

    // Create activity log entry via follow_ups
    const leadNo = existing[0].sr_no || lead_id;
    const logMessage = `🚨 Marked as Lost Lead\nReason: ${reason.trim()}\nBy: ${marked_by}`;

    try {
      await query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date)
         VALUES ($1, $2, $3, $4)`,
        [String(lead_id), logMessage, marked_by, null]
      );
    } catch (fuErr: any) {
      console.warn("[lost-lead] follow_ups insert failed:", fuErr.message);
    }

    return NextResponse.json(
      {
        success: true,
        message: `Lead #${leadNo} marked as lost.`,
        data: updatedRows[0],
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[POST /api/lost-lead]", error);
    return NextResponse.json(
      { success: false, message: error.message ?? "Failed to mark lead as lost." },
      { status: 500 }
    );
  }
}

// ── PUT — Restore a lost lead ─────────────────
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { lead_id, restored_by } = body as {
      lead_id: number | string;
      restored_by: string;
    };

    if (!lead_id || !restored_by) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: lead_id, restored_by" },
        { status: 400 }
      );
    }

    // Check lead exists and is actually lost
    const existing = await query(
      `SELECT id, name, sr_no, is_lost_lead FROM walkin_enquiries WHERE id = $1`,
      [lead_id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found." },
        { status: 404 }
      );
    }

    if (!existing[0].is_lost_lead) {
      return NextResponse.json(
        { success: false, message: "Lead is not marked as lost." },
        { status: 400 }
      );
    }

    // Restore lead
    const updatedRows = await query(
      `UPDATE walkin_enquiries
       SET is_lost_lead = FALSE,
           lost_lead_reason = NULL,
           lost_lead_marked_at = NULL,
           lost_lead_marked_by = NULL
       WHERE id = $1
       RETURNING *`,
      [lead_id]
    );

    // Create activity log entry
    const leadNo = existing[0].sr_no || lead_id;
    const logMessage = `✅ Restored from Lost Lead to Active Pipeline\nBy: ${restored_by}`;

    try {
      await query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date)
         VALUES ($1, $2, $3, $4)`,
        [String(lead_id), logMessage, restored_by, null]
      );
    } catch (fuErr: any) {
      console.warn("[lost-lead] follow_ups insert failed:", fuErr.message);
    }

    return NextResponse.json(
      {
        success: true,
        message: `Lead #${leadNo} restored to active.`,
        data: updatedRows[0],
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[PUT /api/lost-lead]", error);
    return NextResponse.json(
      { success: false, message: error.message ?? "Failed to restore lead." },
      { status: 500 }
    );
  }
}
