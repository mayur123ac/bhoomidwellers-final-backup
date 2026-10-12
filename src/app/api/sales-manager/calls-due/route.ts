import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales-manager/calls-due
 *
 * Returns leads assigned to the authenticated Sales Manager that have never
 * been contacted — i.e. no call_session row with a non-null recording_r2_key.
 *
 * This uses the EXACT same eligibility rule as the dashboard-summary "calls_due"
 * count so the two always reconcile:
 *   - organization_id = session org
 *   - assigned_to_user_id = session user
 *   - is_lost_lead = false
 *   - NOT EXISTS (call_sessions with recording_r2_key IS NOT NULL)
 *
 * Supports:
 *   ?q=<search>       free-text search across name, phone, source, cp fields
 *   ?limit=<n>        page size (default 50, max 200)
 *   ?offset=<n>       pagination offset
 *   ?sortKey=<col>    column to sort by
 *   ?sortDir=asc|desc sort direction
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const userId = getSessionUserId(gate.session);
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "Could not resolve user id from session." },
        { status: 401 }
      );
    }

    const orgId = await getOrganizationId();
    const { searchParams } = new URL(req.url);

    // Pagination
    const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);

    // Build WHERE clause — always starts with the three eligibility predicates
    const params: any[] = [orgId, userId];
    let where = [
      "w.organization_id = $1",
      "w.assigned_to_user_id = $2",
      "COALESCE(w.is_lost_lead, false) = false",
      "NOT EXISTS (SELECT 1 FROM call_sessions cs WHERE cs.lead_id = w.id AND cs.organization_id = w.organization_id AND cs.recording_r2_key IS NOT NULL)",
    ].join(" AND ");

    // Free-text search
    const q = (searchParams.get("q") ?? "").trim();
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where += ` AND (
        w.name ILIKE ${p} OR
        w.phone ILIKE ${p} OR
        w.alt_phone ILIKE ${p} OR
        w.source ILIKE ${p} OR
        w.cp_name ILIKE ${p} OR
        w.cp_company ILIKE ${p} OR
        w.cp_phone ILIKE ${p} OR
        w.status ILIKE ${p} OR
        w.budget ILIKE ${p} OR
        w.configuration ILIKE ${p} OR
        CAST(w.sr_no AS TEXT) LIKE ${p} OR
        CAST(w.id AS TEXT) LIKE ${p}
      )`;
    }

    // Sorting — whitelist of allowed columns
    const SORT_COLS: Record<string, string> = {
      lead_no: "w.sr_no",
      name: "w.name",
      call_due_from: "COALESCE(w.assigned_at, w.created_at)",
      status: "w.status",
      source: "w.source",
      budget: "w.budget",
      created_at: "w.created_at",
      cp_name: "w.cp_name",
    };
    const requestedSort = searchParams.get("sortKey");
    const sortCol = requestedSort ? SORT_COLS[requestedSort] : undefined;
    const sortDir = searchParams.get("sortDir") === "asc" ? "ASC" : "DESC";
    const orderBy = sortCol
      ? `${sortCol} ${sortDir} NULLS LAST, w.id ${sortDir}`
      : "COALESCE(w.assigned_at, w.created_at) ASC NULLS LAST, w.id ASC";

    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;

    // Two queries in parallel: data + count (same WHERE)
    const [rows, countRows] = await Promise.all([
      query(
        `SELECT
           w.id,
           w.sr_no,
           w.name,
           w.phone,
           w.alt_phone,
           w.email,
           w.configuration,
           w.budget,
           w.source,
           w.source_other,
           w.status,
           w.is_lost_lead,
           w.lost_lead_reason,
           w.created_at,
           w.assigned_at,
           w.enquiry_date,
           w.auto_date_enabled,
           w.cp_name,
           w.cp_company,
           w.cp_phone,
           w.channel_partner_id,
           w.assigned_to,
           w.assigned_to_user_id,
           w.loan_planned,
           w.purpose,
           w.lead_classification,
           sv_latest.visit_date   AS latest_visit_date,
           sv_latest.status       AS latest_visit_status
         FROM walkin_enquiries w
         LEFT JOIN site_visits sv_latest
           ON sv_latest.id = (
             SELECT sv2.id FROM site_visits sv2
              WHERE sv2.lead_id = w.id
                AND sv2.organization_id = w.organization_id
              ORDER BY sv2.visit_date DESC
              LIMIT 1
           )
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*)::int AS total FROM walkin_enquiries w WHERE ${where}`,
        params
      ),
    ]);

    const total: number = countRows[0]?.total ?? 0;

    return NextResponse.json({
      success: true,
      data: rows,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("[GET /api/sales-manager/calls-due]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
