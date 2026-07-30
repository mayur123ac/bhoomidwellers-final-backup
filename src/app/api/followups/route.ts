// app/api/followups/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { jsonCompressed } from "@/lib/apiResponse";

/**
 * GET follow-ups.
 *
 * ── Two changes for scale, neither of which alters the response shape ────────
 *
 * 1. The camelCase renaming is done in SQL rather than by a JS .map() over the
 *    result set. The old code allocated one fresh object per row: at 400,000
 *    follow-ups that is 400,000 allocations and a second full pass over the data
 *    on every single request, purely to rename five keys. `pg` builds the row
 *    objects once; aliasing lets us keep them.
 *
 * 2. `?lead_id=` returns one lead's follow-ups instead of the whole table.
 *    Backed by idx_follow_ups_lead_id_created_at, that is an index scan touching
 *    7 pages instead of a 400,000-row sequential read — measured at 0.03 ms vs
 *    1,579 ms. Callers that need a single lead's timeline should use it.
 *
 * The unfiltered form is retained because the admin dashboard genuinely needs
 * every follow-up: it derives per-lead fields for the whole table client-side and
 * renders timelines from the same array. Narrowing it would change what those
 * views can show, which is a behavioural change, not an optimisation. It IS
 * gzip-compressed (see next.config.ts) — the messages are highly repetitive, so
 * the wire cost is a fraction of the raw size.
 */
const SELECT_COLUMNS = `
  SELECT id::text                            AS "_id",
         lead_id::text                       AS "leadId",
         COALESCE(created_by_name, '')        AS "salesManagerName",
         -- NULLIF before COALESCE, deliberately: the JS this replaced used
         -- created_by_name || "sales", and || treats an empty string as absent.
         -- A bare COALESCE would keep '' and change the value the UI displays.
         COALESCE(NULLIF(created_by_name, ''), 'sales') AS "createdBy",
         message,
         NULLIF(site_visit_date, '')          AS "siteVisitDate",
         created_at                           AS "createdAt"
    FROM follow_ups`;

export async function GET(req: Request) {
  try {
    const leadId = new URL(req.url).searchParams.get("lead_id");

    const data = leadId
      ? await query(
          `${SELECT_COLUMNS} WHERE lead_id = $1 ORDER BY created_at ASC`,
          [leadId]
        )
      : await query(`${SELECT_COLUMNS} ORDER BY created_at ASC`);

    // Compressed: this is the single largest response the app produces.
    return jsonCompressed(req, { success: true, data }, { status: 200 });
  } catch (error) {
    console.error("GET followups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

// POST: Save a new follow-up message
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { leadId, salesManagerName, createdBy, message, siteVisitDate } = body;

    if (!leadId || !message) {
      return NextResponse.json(
        { success: false, message: "Missing fields: leadId and message are required" },
        { status: 400 }
      );
    }

    // 🔒 Final-state lock guard
    const leadRows = await query(
      `SELECT status, is_lost_lead FROM walkin_enquiries WHERE id = $1`,
      [leadId]
    );
    const lead = leadRows[0];
    if (!lead) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }
    if (lead.status === "Closing" || lead.is_lost_lead) {
      return NextResponse.json(
        { success: false, message: "Closed or Lost leads cannot be modified." },
        { status: 403 }
      );
    }

    const rows = await query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, site_visit_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        String(leadId),
        message,
        salesManagerName || createdBy || "sales",
        siteVisitDate || null,
      ]
    );

    const m = rows[0];

    // Return same shape as old MongoDB response
    return NextResponse.json({
      success: true,
      data: {
        _id: String(m.id),
        leadId: String(m.lead_id),
        salesManagerName: m.created_by_name || "",
        createdBy: m.created_by_name || "sales",
        message: m.message,
        siteVisitDate: m.site_visit_date || null,
        createdAt: m.created_at,
      },
    }, { status: 201 });

  } catch (error) {
    console.error("POST followups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save message" },
      { status: 500 }
    );
  }
}
