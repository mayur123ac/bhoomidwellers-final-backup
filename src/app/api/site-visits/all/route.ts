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

/** walkin_enquiries varchar columns that identify a lead's owner, per role. */
const OWN_LEAD_COLUMNS: Record<string, string[]> = {
  receptionist: ["assigned_to", "assigned_receptionist"],
  "site head": ["assigned_to", "overseeing_site_head"],
};

/** Corresponding FK columns for each varchar ownership column. */
const FK_COLUMN: Record<string, string> = {
  assigned_to: "assigned_to_user_id",
  assigned_receptionist: "assigned_receptionist_user_id",
  overseeing_site_head: "overseeing_site_head_user_id",
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
    const viewerUserId = gate.userId;
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

    // ID-first ownership predicate: for each ownership column, use the FK
    // user-id column when it is set, fall back to the name string for rows
    // created before the FK migration. Identity comes from the signed session.
    if (!seesEverything) {
      const ors: string[] = [];
      for (const col of ownColumns) {
        const fkCol = FK_COLUMN[col];
        if (fkCol && viewerUserId !== null) {
          params.push(viewerUserId);
          const uidx = params.length;
          params.push(viewerName);
          const nidx = params.length;
          ors.push(
            `(we.${fkCol} = $${uidx} OR (we.${fkCol} IS NULL AND LOWER(TRIM(COALESCE(we.${col}, ''))) = LOWER(TRIM($${nidx}))))`
          );
        } else {
          // No user ID available — name-only fallback (covers null-id sessions).
          params.push(viewerName);
          ors.push(`LOWER(TRIM(COALESCE(we.${col}, ''))) = LOWER(TRIM($${params.length}))`);
        }
      }
      conditions.push(`(${ors.join(" OR ")})`);
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
