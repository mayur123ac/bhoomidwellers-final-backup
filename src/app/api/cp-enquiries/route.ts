// api/cp-enquiries/route.ts — Channel Partner enquiries, role-scoped.
//
// One endpoint serves all three panels. The scoping is done here rather than in
// each page's fetch, because "Sourcing Manager must never see another Sourcing
// Manager's partners" is only a real guarantee if the rows never leave the server.
// A Sourcing Manager's own id is forced into the WHERE clause and any
// sourcing_manager_id query param they send is ignored outright.
//
// Office Address / Owner-Contact / GST / RERA / CP city+pincode live on
// channel_partners, not on the enquiry, so they come from the LEFT JOIN. The join
// is LEFT because a CP enquiry created before the partner master existed (or one
// whose cp_name was too vague to resolve) has channel_partner_id NULL — those rows
// must still appear, with the denormalized cp_name/cp_company/cp_phone captured on
// the enquiry itself as the fallback.
//
// ── Effective Sourcing Manager ────────────────────────────────────────────────
// Ownership is answered by COALESCE(w.sourcing_manager_id,
// cp.assigned_sourcing_manager_id), not by the enquiry column alone.
//
// Two levels exist and both are real: the enquiry may name a manager explicitly
// (set at intake), and the partner has an owner. Reading only the enquiry column
// made assigning a partner to a manager do nothing for the leads that partner had
// already brought in — every enquiry logged before ownership existed has a NULL
// there, so a manager with a busy partner still saw an empty table.
//
// Explicit beats inherited: an enquiry deliberately routed to one manager stays
// with them even if the partner is later reassigned. Everything else follows the
// partner, which means an Admin reassigning a partner moves that partner's whole
// back catalogue in one action instead of lead by lead — and there is no
// denormalized copy to drift out of sync.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { CP_SOURCE_VALUES } from "@/lib/cpCommissionEngine";
import { jsonCompressed } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

/**
 * Roles allowed to read CP enquiries. Sales Manager was added so they can see
 * CP enquiries assigned to partners they own (via assigned_sales_manager_id).
 * Their view is scoped to their own assignments, same as Sourcing Manager.
 */
const VIEW_ROLES = ["admin", "receptionist", "sourcing manager", "sales manager", "site head"];

// ── Lead-primary query (Admin / Receptionist / Sourcing Manager) ─────────────
// Starts from walkin_enquiries so orphan enquiries (channel_partner_id IS NULL,
// ~129 historical rows) remain visible. The CP profile is optional.
const SELECT_SQL_LEAD_PRIMARY = `
  SELECT
    w.id, w.sr_no, w.created_at, w.enquiry_date, w.status,
    w.name  AS client_name,
    w.phone AS client_phone,
    w.alt_phone, w.email, w.address,
    w.city AS client_city, w.pin_code AS client_pin_code,
    w.preferred_location, w.budget, w.configuration, w.purpose,
    w.occupation, w.organization, w.loan_planned,
    w.source, w.assigned_to, w.assigned_receptionist,
    w.channel_partner_id,
    w.cp_name, w.cp_company, w.cp_phone,
    cp.name                 AS partner_name,
    cp.company_name         AS partner_company,
    cp.phone                AS partner_phone,
    cp.office_address, cp.owner_contact_person, cp.gst_number,
    cp.rera_registration_no,
    cp.city AS partner_city, cp.pin_code AS partner_pin_code,
    w.sourcing_manager_id,
    w.sourcing_manager_assigned_at,
    w.sourcing_manager_assigned_by,
    COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id) AS effective_sourcing_manager_id,
    (w.sourcing_manager_id IS NULL AND cp.assigned_sourcing_manager_id IS NOT NULL)
      AS sourcing_manager_inherited,
    cp.assigned_sourcing_manager_at AS partner_assigned_at,
    cp.assigned_sourcing_manager_by AS partner_assigned_by,
    sm.name     AS sourcing_manager_name,
    sm.username AS sourcing_manager_username,
    sm.email    AS sourcing_manager_email,
    sm.whatsapp_number AS sourcing_manager_phone,
    cp.assigned_sales_manager_id,
    cp.assigned_sales_manager_at,
    cp.assigned_sales_manager_by,
    slm.name     AS sales_manager_name,
    slm.username AS sales_manager_username,
    slm.email    AS sales_manager_email,
    slm.whatsapp_number AS sales_manager_phone
  FROM walkin_enquiries w
  LEFT JOIN channel_partners cp
         ON cp.id = w.channel_partner_id AND cp.organization_id = w.organization_id
  LEFT JOIN users sm
    ON sm.id = COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id)
   AND sm.organization_id = w.organization_id
  LEFT JOIN users slm
    ON slm.id = cp.assigned_sales_manager_id
   AND slm.organization_id = w.organization_id
`;

// ── CP-primary query (Sales Manager) ────────────────────────────────────────
// Starts from channel_partners so a CP with zero enquiries still produces one
// row (with NULL lead fields). A CP with N enquiries produces N rows — no data
// is collapsed or lost. The source filter is in the JOIN condition, not WHERE,
// so it does not eliminate CPs that have no matching enquiries.
const SELECT_SQL_CP_PRIMARY = `
  SELECT
    w.id, w.sr_no,
    COALESCE(w.created_at, cp.created_at) AS created_at,
    w.enquiry_date, w.status,
    w.name  AS client_name,
    w.phone AS client_phone,
    w.alt_phone, w.email, w.address,
    w.city AS client_city, w.pin_code AS client_pin_code,
    w.preferred_location, w.budget, w.configuration, w.purpose,
    w.occupation, w.organization, w.loan_planned,
    w.source, w.assigned_to, w.assigned_receptionist,
    cp.id   AS channel_partner_id,
    w.cp_name, w.cp_company, w.cp_phone,
    cp.name                 AS partner_name,
    cp.company_name         AS partner_company,
    cp.phone                AS partner_phone,
    cp.office_address, cp.owner_contact_person, cp.gst_number,
    cp.rera_registration_no,
    cp.city AS partner_city, cp.pin_code AS partner_pin_code,
    w.sourcing_manager_id,
    w.sourcing_manager_assigned_at,
    w.sourcing_manager_assigned_by,
    COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id) AS effective_sourcing_manager_id,
    (w.sourcing_manager_id IS NULL AND cp.assigned_sourcing_manager_id IS NOT NULL)
      AS sourcing_manager_inherited,
    cp.assigned_sourcing_manager_at AS partner_assigned_at,
    cp.assigned_sourcing_manager_by AS partner_assigned_by,
    sm.name     AS sourcing_manager_name,
    sm.username AS sourcing_manager_username,
    sm.email    AS sourcing_manager_email,
    sm.whatsapp_number AS sourcing_manager_phone,
    cp.assigned_sales_manager_id,
    cp.assigned_sales_manager_at,
    cp.assigned_sales_manager_by,
    slm.name     AS sales_manager_name,
    slm.username AS sales_manager_username,
    slm.email    AS sales_manager_email,
    slm.whatsapp_number AS sales_manager_phone
  FROM channel_partners cp
  LEFT JOIN walkin_enquiries w
    ON w.channel_partner_id = cp.id
   AND w.organization_id = cp.organization_id
   AND TRIM(w.source) = ANY($1)
  LEFT JOIN users sm
    ON sm.id = COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id)
   AND sm.organization_id = cp.organization_id
  LEFT JOIN users slm
    ON slm.id = cp.assigned_sales_manager_id
   AND slm.organization_id = cp.organization_id
`;

// ── CP-standalone query (Admin / Site Head / Receptionist "CP Enquiry" tab) ──
// Pure channel_partners — NO walkin_enquiries join. One row per CP record.
// This is the correct data source for "CP Enquiry" = standalone CP records.
const SELECT_SQL_CP_STANDALONE = `
  SELECT
    cp.id   AS channel_partner_id,
    cp.name                 AS partner_name,
    cp.company_name         AS partner_company,
    cp.phone                AS partner_phone,
    cp.office_address, cp.owner_contact_person, cp.gst_number,
    cp.rera_registration_no,
    cp.city AS partner_city, cp.pin_code AS partner_pin_code,
    cp.status AS cp_status,
    cp.created_at,
    cp.created_by,
    cp.assigned_sourcing_manager_id AS effective_sourcing_manager_id,
    cp.assigned_sourcing_manager_at AS partner_assigned_at,
    cp.assigned_sourcing_manager_by AS partner_assigned_by,
    sm.name     AS sourcing_manager_name,
    sm.username AS sourcing_manager_username,
    sm.email    AS sourcing_manager_email,
    sm.whatsapp_number AS sourcing_manager_phone,
    cp.assigned_sales_manager_id,
    cp.assigned_sales_manager_at,
    cp.assigned_sales_manager_by,
    slm.name     AS sales_manager_name,
    slm.username AS sales_manager_username,
    slm.email    AS sales_manager_email,
    slm.whatsapp_number AS sales_manager_phone
  FROM channel_partners cp
  LEFT JOIN users sm
    ON sm.id = cp.assigned_sourcing_manager_id
   AND sm.organization_id = cp.organization_id
  LEFT JOIN users slm
    ON slm.id = cp.assigned_sales_manager_id
   AND slm.organization_id = cp.organization_id
`;

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const role = normalizeRole(session.role);
  if (!VIEW_ROLES.includes(role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot view channel partner enquiries." },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const orgId = await getOrganizationId();

    const viewParam = searchParams.get("view");

    // ── CP-standalone query ──────────────────────────────────────────────────
    // Pure channel_partners, no walkin_enquiries join. One row per CP.
    // Used by the "CP Enquiry" tab in Admin, Site Head, Receptionist.
    if (viewParam === "cp_standalone" && ["admin", "site head", "receptionist"].includes(role)) {
      const rows = await query(
        `${SELECT_SQL_CP_STANDALONE} WHERE cp.organization_id = $1 ORDER BY cp.created_at DESC`,
        [orgId]
      );

      return jsonCompressed(
        req,
        { success: true, data: rows, count: rows.length },
        { status: 200 }
      );
    }

    // ── CP-primary query (Sales Manager) ─────────────────────────────────────
    // Starts from channel_partners, LEFT JOINs walkin_enquiries.
    // One row per lead (a CP with N leads = N rows). Sales Manager only.
    if (role === "sales manager") {
      const params: any[] = [
        CP_SOURCE_VALUES as unknown as string[],  // $1 — JOIN condition
        orgId,                                     // $2 — tenant
        Number(session._id),                       // $3 — forced scope
      ];
      const where = [
        `cp.organization_id = $2`,
        `cp.assigned_sales_manager_id = $3`,
      ];

      const rows = await query(
        `${SELECT_SQL_CP_PRIMARY} WHERE ${where.join(" AND ")} ORDER BY COALESCE(w.created_at, cp.created_at) DESC`,
        params
      );

      return jsonCompressed(
        req,
        { success: true, data: rows, count: rows.length, scopedToSelf: true },
        { status: 200 }
      );
    }

    // ── All other roles / views: lead-primary query ──────────────────────────
    const params: any[] = [];

    params.push(CP_SOURCE_VALUES as unknown as string[]);
    const where: string[] = [`TRIM(w.source) = ANY($${params.length})`];

    params.push(orgId);
    where.push(`w.organization_id = $${params.length}`);

    const EFFECTIVE_SM = `COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id)`;

    if (role === "sourcing manager") {
      params.push(Number(session._id));
      where.push(`${EFFECTIVE_SM} = $${params.length}`);
    } else {
      const smFilter = searchParams.get("sourcing_manager_id");
      if (smFilter === "unassigned") {
        where.push(`${EFFECTIVE_SM} IS NULL`);
      } else if (smFilter) {
        params.push(Number(smFilter));
        where.push(`${EFFECTIVE_SM} = $${params.length}`);
      }
    }

    const rows = await query(
      `${SELECT_SQL_LEAD_PRIMARY} WHERE ${where.join(" AND ")} ORDER BY w.created_at DESC`,
      params
    );

    return jsonCompressed(
      req,
      { success: true, data: rows, count: rows.length, scopedToSelf: role === "sourcing manager" },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/cp-enquiries]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
