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
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { CP_SOURCE_VALUES } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

/**
 * Roles allowed to read CP enquiries at all. Per the Part 10 visibility matrix,
 * Sales Manager and Site Head have NO access to Channel Partner enquiries — this
 * is a different resource from the `channel_partners` partner-master registry,
 * which those two roles can still read via /api/channel-partners.
 */
const VIEW_ROLES = ["admin", "receptionist", "sourcing manager"];

const SELECT_SQL = `
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
    -- Denormalized on the enquiry; used when channel_partner_id never resolved.
    w.cp_name, w.cp_company, w.cp_phone,
    -- Partner master profile (NULL for partners not yet registered via office visit).
    cp.name                 AS partner_name,
    cp.company_name         AS partner_company,
    cp.phone                AS partner_phone,
    cp.office_address, cp.owner_contact_person, cp.gst_number,
    cp.rera_registration_no,
    cp.city AS partner_city, cp.pin_code AS partner_pin_code,
    -- Assignment. sourcing_manager_id is what is stored ON THE ENQUIRY;
    -- effective_sourcing_manager_id is who actually owns it, falling back to the
    -- partner's owner. The joined name/username/email always describe the effective
    -- one, so the UI never has to resolve this itself.
    w.sourcing_manager_id,
    w.sourcing_manager_assigned_at,
    w.sourcing_manager_assigned_by,
    COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id) AS effective_sourcing_manager_id,
    (w.sourcing_manager_id IS NULL AND cp.assigned_sourcing_manager_id IS NOT NULL)
      AS sourcing_manager_inherited,
    -- When inherited, the "assigned on / by" that applies is the partner's, since
    -- nothing was ever recorded against the enquiry itself.
    cp.assigned_sourcing_manager_at AS partner_assigned_at,
    cp.assigned_sourcing_manager_by AS partner_assigned_by,
    sm.name     AS sourcing_manager_name,
    sm.username AS sourcing_manager_username,
    sm.email    AS sourcing_manager_email,
    sm.whatsapp_number AS sourcing_manager_phone
  FROM walkin_enquiries w
  LEFT JOIN channel_partners cp ON cp.id = w.channel_partner_id
  LEFT JOIN users sm
    ON sm.id = COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id)
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
    const params: any[] = [];

    // Only enquiries whose source is a Channel Partner source. Uses the same
    // CP_SOURCE_VALUES list the commission engine gates on, so this page and
    // commission attribution never disagree about what counts as a CP lead.
    params.push(CP_SOURCE_VALUES as unknown as string[]);
    const where: string[] = [`TRIM(w.source) = ANY($${params.length})`];

    // Filtering and scoping both run on the effective owner, not the enquiry
    // column — otherwise the table would show a manager's name in the row while
    // the filter for that same manager returned nothing.
    const EFFECTIVE_SM = `COALESCE(w.sourcing_manager_id, cp.assigned_sourcing_manager_id)`;

    if (role === "sourcing manager") {
      // Forced, not filtered: a Sourcing Manager's own id is the only one they can
      // ever see. Any ?sourcing_manager_id they pass is discarded.
      params.push(Number(session._id));
      where.push(`${EFFECTIVE_SM} = $${params.length}`);
    } else {
      const smFilter = searchParams.get("sourcing_manager_id");
      if (smFilter === "unassigned") {
        // Genuinely ownerless: neither the enquiry nor the partner names anyone.
        where.push(`${EFFECTIVE_SM} IS NULL`);
      } else if (smFilter) {
        params.push(Number(smFilter));
        where.push(`${EFFECTIVE_SM} = $${params.length}`);
      }
    }

    const rows = await query(
      `${SELECT_SQL} WHERE ${where.join(" AND ")} ORDER BY w.created_at DESC`,
      params
    );

    return NextResponse.json(
      { success: true, data: rows, count: rows.length, scopedToSelf: role === "sourcing manager" },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/cp-enquiries]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
