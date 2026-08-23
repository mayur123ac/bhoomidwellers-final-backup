//api/site-visits/all
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

/**
 * Which roles see the WHOLE calendar, and which see only their own leads' visits.
 *
 * This route used to answer every signed-in session with every site visit in the
 * organization — lead name, phone and status included — and left the narrowing
 * to the caller. SiteVisitOverview does filter client-side (`allLeads` decides
 * what renders), so the Sales Manager and Site Head screens LOOKED correct while
 * the browser had been handed the entire company's customer list. "Only my
 * leads" enforced in React is a display preference, not access control: the
 * payload is one devtools tab away.
 *
 * So the predicate moves into the SQL. The client-side filter stays as it is —
 * it is still what decides which of the rows a screen draws — but it is no
 * longer the only thing standing between a receptionist and 300 phone numbers.
 */
const FULL_CALENDAR_ROLES = new Set(["admin", "sales manager"]);

/** walkin_enquiries columns that make a lead this user's, per role. */
const OWN_LEAD_COLUMNS: Record<string, string[]> = {
  receptionist: ["assigned_to", "assigned_receptionist"],
  "site head": ["assigned_to", "overseeing_site_head"],
};

// GET site visits with lead info joined — the whole organization for the roles
// that own the calendar, and only the caller's own leads for everyone else.
export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // Underscores normalized to spaces, matching middleware and cpRbac: the
    // users table holds both "site_head" and "Site Head".
    const role = String(gate.session.role ?? "").trim().toLowerCase().replace(/_/g, " ");
    const viewerName = String(gate.session.name ?? "").trim();
    const seesEverything = FULL_CALENDAR_ROLES.has(role);
    const ownColumns = OWN_LEAD_COLUMNS[role] ?? ["assigned_to"];

    // A restricted role with no name on the session cannot be matched to any
    // lead. Returning nothing is the safe reading; returning everything is how
    // this kind of check usually fails.
    if (!seesEverything && !viewerName) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    let sql = `
      SELECT 
        sv.id,
        sv.lead_id,
        sv.visit_date,
        sv.created_by,
        sv.role,
        sv.status,
        sv.notes,
        sv.created_at,
        we.name    AS lead_name,
        we.phone   AS lead_phone,
        we.status  AS lead_status,
        we.assigned_to,
        we.assigned_receptionist
      FROM public.site_visits sv
      JOIN public.walkin_enquiries we
        ON we.id = sv.lead_id AND we.organization_id = sv.organization_id
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    // Pushed first so it holds $1 regardless of which optional date filters the
    // caller supplied; the conditions below number from there.
    params.push(await getOrganizationId());
    conditions.push(`sv.organization_id = $${params.length}`);

    if (from) {
      conditions.push(`sv.visit_date >= $${params.length + 1}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`sv.visit_date <= $${params.length + 1}`);
      params.push(to);
    }

    // The ownership predicate. One bind for the name, reused by each column;
    // the name is BOUND, never interpolated, and comes from the signed session
    // rather than the query string — a caller cannot ask for someone else's
    // calendar by passing a different name.
    if (!seesEverything) {
      params.push(viewerName);
      const idx = params.length;
      const ors = ownColumns
        .map((col) => `LOWER(TRIM(COALESCE(we.${col}, ''))) = LOWER(TRIM($${idx}))`)
        .join(" OR ");
      conditions.push(`(${ors})`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY sv.visit_date DESC`;

    const rows = await query(sql, params);

    return NextResponse.json({ success: true, data: rows });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// DELETE a site visit by id
export async function DELETE(req: Request) {
  try {
    // Was reachable anonymously and deletes the row outright — no soft-delete,
    // no history. Restricted to the roles that own the visit calendar.
    const gate = await requireRoles(["admin", "sales manager", "receptionist"]);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, message: "Missing id" }, { status: 400 });
    }

    await query(`DELETE FROM public.site_visits WHERE id = $1 AND organization_id = $2`, [id, await getOrganizationId()]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
