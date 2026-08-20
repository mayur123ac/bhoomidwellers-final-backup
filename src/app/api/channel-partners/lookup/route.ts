// api/channel-partners/lookup/route.ts
//
// "Is this phone number already a registered Channel Partner, and whose is it?"
//
// The walk-in enquiry form calls this the moment a receptionist finishes typing a
// CP phone number, so the answer is on screen before they submit rather than being
// discovered afterwards. Phone is the only reliable partner identity — name and
// company are typed freehand and drift ("Soni Empire" / "soni empire." / "Soni
// Empire Realty") — so the match is on the last 10 digits, the same key
// findOrCreateChannelPartner and the POST dedup index use.
//
// This endpoint only reads. The authoritative routing decision is made again
// server-side in POST /api/walkin_enquiries, because a client that skipped this
// call (or lied about the result) must still land the lead on the right desk.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { canViewAllPartners, normalizeCpPhone } from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

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

  const phone = normalizeCpPhone(req.nextUrl.searchParams.get("phone"));
  // Fewer than 10 digits is a half-typed number, not a miss — answering "no such
  // partner" would flash a misleading "new partner" hint on every keystroke.
  if (!phone) {
    return NextResponse.json(
      { success: true, found: false, incomplete: true, partner: null },
      { status: 200 }
    );
  }

  try {
    const rows = await query(
      `SELECT cp.id, cp.name, cp.company_name, cp.phone, cp.status,
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
        WHERE right(regexp_replace(COALESCE(cp.phone, ''), '\\D', '', 'g'), 10) = $1
        ORDER BY cp.id ASC
        LIMIT 1`,
      [phone]
    );

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
