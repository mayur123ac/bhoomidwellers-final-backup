// api/channel-partners/lookup/route.ts
//
// "Does this CP (by phone, name, or company) exist in the registry, and whose is it?"
//
// The walk-in enquiry form calls this as the receptionist types into any one of
// the three CP fields so auto-fill is on screen before submit. Three modes:
//
//   ?phone=<digits>   — last-10-digit normalized match on channel_partners.phone
//   ?name=<string>    — case/whitespace-insensitive exact match on cp.name
//   ?company=<string> — case/whitespace-insensitive exact match on cp.company_name
//
// Phone is the strongest identity key (used by findOrCreateChannelPartner).
// Name and company are convenience look-ups — useful when the receptionist
// knows who the CP is but does not have the number handy.
//
// All three modes are scoped by organization_id so one tenant cannot see
// another tenant's partners.
//
// This endpoint only reads. The authoritative routing decision is made again
// server-side in POST /api/walkin_enquiries, because a client that skipped this
// call (or lied about the result) must still land the lead on the right desk.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { canViewAllPartners, normalizeCpPhone } from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

// Shared SELECT + FROM + JOIN — the WHERE clause differs by search mode.
const PARTNER_SELECT = `
  SELECT cp.id, cp.name, cp.company_name, cp.phone, cp.status,
         cp.office_address, cp.gst_number, cp.rera_registration_no,
         cp.owner_contact_person, cp.city, cp.pin_code,
         cp.assigned_sourcing_manager_id,
         cp.assigned_sourcing_manager_at,
         cp.assigned_sourcing_manager_by,
         sm.name     AS assigned_sourcing_manager_name,
         sm.username AS assigned_sourcing_manager_username,
         sm.is_active AS assigned_sourcing_manager_active,
         -- Normalized here too: the role may have been changed after the
         -- assignment was made, and routing to a non-Sourcing-Manager would
         -- put the lead somewhere no panel displays.
         (REPLACE(LOWER(TRIM(sm.role)), '_', ' ') = 'sourcing manager') AS assigned_sourcing_manager_is_sm,
         (SELECT COUNT(*) FROM walkin_enquiries w
           WHERE w.channel_partner_id = cp.id AND w.organization_id = cp.organization_id) AS lead_count
    FROM channel_partners cp
    LEFT JOIN users sm
           ON sm.id = cp.assigned_sourcing_manager_id AND sm.organization_id = cp.organization_id
`;

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  // Registry-wide by nature — it answers questions about partners the caller may
  // not own — so it is limited to the roles that can see the whole registry. This
  // is the enquiry form's helper; a Sourcing Manager never calls it, and their
  // registration form gets its duplicate warning from POST /api/channel-partners
  // instead, which reveals only that the number is taken.
  if (!canViewAllPartners(session.role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot look up channel partners." },
      { status: 403 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const phoneRaw = sp.get("phone");
  const nameRaw  = (sp.get("name")    ?? "").trim();
  const companyRaw = (sp.get("company") ?? "").trim();

  // Determine search mode (priority: phone > name > company).
  // For phone: the param must be present AND normalize to 10 digits.
  // For name/company: at least 2 characters (prevents single-letter false matches).
  let searchMode: "phone" | "name" | "company" | null = null;
  if (phoneRaw !== null) {
    // Phone param was explicitly passed — guard against partial numbers.
    const phone = normalizeCpPhone(phoneRaw);
    if (!phone) {
      // Fewer than 10 digits: half-typed, not a miss.
      return NextResponse.json(
        { success: true, found: false, incomplete: true, partner: null },
        { status: 200 }
      );
    }
    searchMode = "phone";
  } else if (nameRaw.length >= 2) {
    searchMode = "name";
  } else if (companyRaw.length >= 2) {
    searchMode = "company";
  }

  if (!searchMode) {
    return NextResponse.json(
      { success: true, found: false, incomplete: true, partner: null },
      { status: 200 }
    );
  }

  try {
    const orgId = await getOrganizationId();
    let rows: any[];

    if (searchMode === "phone") {
      const phone = normalizeCpPhone(phoneRaw)!;
      rows = await query(
        `${PARTNER_SELECT}
          WHERE right(regexp_replace(COALESCE(cp.phone, ''), '\\D', '', 'g'), 10) = $1
            AND cp.organization_id = $2
          ORDER BY cp.id ASC
          LIMIT 1`,
        [phone, orgId]
      );
    } else if (searchMode === "name") {
      rows = await query(
        `${PARTNER_SELECT}
          WHERE LOWER(TRIM(cp.name)) = LOWER(TRIM($1))
            AND cp.organization_id = $2
          ORDER BY cp.id ASC
          LIMIT 1`,
        [nameRaw, orgId]
      );
    } else {
      // company
      rows = await query(
        `${PARTNER_SELECT}
          WHERE LOWER(TRIM(cp.company_name)) = LOWER(TRIM($1))
            AND cp.organization_id = $2
          ORDER BY cp.id ASC
          LIMIT 1`,
        [companyRaw, orgId]
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { success: true, found: false, partner: null },
        { status: 200 }
      );
    }

    const partner = rows[0];
    // "Routable" is stricter than "assigned": a partner whose owner has since been
    // deactivated or moved to another role is treated as unowned, so the lead falls
    // back to a manual pick instead of vanishing onto a dead account.
    const routable =
      partner.assigned_sourcing_manager_id != null &&
      partner.assigned_sourcing_manager_active === true &&
      partner.assigned_sourcing_manager_is_sm === true;

    return NextResponse.json(
      { success: true, found: true, routable, partner },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/channel-partners/lookup]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
