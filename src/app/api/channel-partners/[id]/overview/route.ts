// api/channel-partners/[id]/overview/route.ts
//
// Everything known about one Channel Partner, in a single round trip: the master
// profile, their assigned Sourcing Manager, and the activity that hangs off them.
//
// "Visit history / follow-ups / notes" have no partner-level tables — the CRM
// records all three against the *lead*, so they are reached through the partner's
// enquiries (walkin_enquiries.channel_partner_id):
//
//   Office visit    channel_partners.created_at / created_by — the registration
//                   itself, which is the one visit the partner made in person
//   Walk-in visits  the enquiries they brought in (one row per client walk-in)
//   Site visits     site_visits on those enquiries, including their notes column
//   Follow-ups      follow_ups on those enquiries (message + scheduled dates)
//   Bookings        booking_applications sourced by this partner
//
// No commercial figures are returned here at all — not even for roles that could
// see them elsewhere. This endpoint exists to serve the Sourcing Manager panel,
// whose remit is the partner's business profile; commission history has its own
// route (/api/channel-partners/[id]/commissions) with its own gate.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession } from "@/lib/serverAuth";
import { canViewPartners, canViewAllPartners } from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

/** Activity lists are capped — a long-standing partner should not return
 *  hundreds of rows into a drawer that shows a scrollable recent history. */
const ACTIVITY_LIMIT = 100;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!canViewPartners(session.role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot view channel partners." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const cpId = Number(id);
  if (!Number.isInteger(cpId)) {
    return NextResponse.json({ success: false, message: "Invalid partner id." }, { status: 400 });
  }

  try {
    const partnerRows = await query(
      `SELECT cp.id, cp.name, cp.company_name, cp.rera_registration_no, cp.pan_number,
              cp.phone, cp.email, cp.office_address, cp.pin_code, cp.city,
              cp.owner_contact_person, cp.gst_number, cp.status,
              cp.created_by, cp.created_at, cp.updated_by, cp.updated_at,
              cp.assigned_sourcing_manager_id,
              cp.assigned_sourcing_manager_at,
              cp.assigned_sourcing_manager_by,
              sm.name            AS assigned_sourcing_manager_name,
              sm.username        AS assigned_sourcing_manager_username,
              sm.email           AS assigned_sourcing_manager_email,
              sm.whatsapp_number AS assigned_sourcing_manager_phone,
              sm.is_active       AS assigned_sourcing_manager_active
         FROM channel_partners cp
         LEFT JOIN users sm
                ON sm.id = cp.assigned_sourcing_manager_id AND sm.organization_id = cp.organization_id
        WHERE cp.id = $1 AND cp.organization_id = $2`,
      [cpId, await getOrganizationId()]
    );

    if (partnerRows.length === 0) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }

    // A Sourcing Manager may only open partners assigned to them. This is the
    // richest CP endpoint — client names, phone numbers, follow-up notes — so the
    // scope check matters more here than anywhere else. Answered as 404, since a
    // 403 would still confirm the partner exists and belongs to someone else.
    if (
      !canViewAllPartners(session.role) &&
      String(partnerRows[0].assigned_sourcing_manager_id ?? "") !==
        String(session._id ?? session.id ?? "")
    ) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }

    // Four independent reads against the same partner — run together rather than
    // sequentially, since none of them depends on another's result.
    // cpId comes from the URL. Every read below is organization-scoped so a
    // partner id belonging to another builder yields nothing rather than their
    // client list.
    const cpOrgId = await getOrganizationId();
    const [enquiries, siteVisits, followUps, bookings] = await Promise.all([
      query(
        `SELECT w.id, w.sr_no, w.created_at, w.enquiry_date, w.status,
                w.name AS client_name, w.phone AS client_phone, w.alt_phone, w.email,
                w.city, w.pin_code, w.preferred_location,
                w.budget, w.configuration, w.purpose, w.loan_planned,
                w.assigned_to, w.assigned_receptionist,
                w.sourcing_manager_id,
                sm.name AS sourcing_manager_name
           FROM walkin_enquiries w
           LEFT JOIN users sm
             ON sm.id = w.sourcing_manager_id AND sm.organization_id = w.organization_id
          WHERE w.channel_partner_id = $1 AND w.organization_id = $2
          ORDER BY w.created_at DESC
          LIMIT ${ACTIVITY_LIMIT}`,
        [cpId, cpOrgId]
      ),
      query(
        `SELECT v.id, v.lead_id, v.visit_date, v.status, v.notes,
                v.created_by, v.role, v.created_at,
                w.name AS client_name
           FROM site_visits v
           JOIN walkin_enquiries w
             ON w.id = v.lead_id AND w.organization_id = v.organization_id
          WHERE w.channel_partner_id = $1 AND v.organization_id = $2
          ORDER BY v.visit_date DESC NULLS LAST, v.id DESC
          LIMIT ${ACTIVITY_LIMIT}`,
        [cpId, cpOrgId]
      ),
      query(
        `SELECT f.id, f.lead_id, f.message, f.created_by_name, f.created_at,
                f.followup_date, f.site_visit_date,
                w.name AS client_name
           FROM follow_ups f
           JOIN walkin_enquiries w
             ON w.id = f.lead_id AND w.organization_id = f.organization_id
          WHERE w.channel_partner_id = $1 AND f.organization_id = $2
          ORDER BY f.created_at DESC
          LIMIT ${ACTIVITY_LIMIT}`,
        [cpId, cpOrgId]
      ),
      query(
        // The two expected dates live in the booking's child tables, not on the
        // application row — joined here so the CP chat's BOOKING UPDATE card can
        // state them instead of leaving the partner to ask.
        `SELECT b.id, b.booking_number, b.lead_id, b.created_at,
                b.booking_status, b.booking_date,
                r.expected_registration_date,
                l.expected_disbursement_date
           FROM booking_applications b
           LEFT JOIN booking_registration_details r ON r.booking_id = b.id
           LEFT JOIN booking_loan_details          l ON l.booking_id = b.id
          WHERE b.sourced_by_channel_partner_id = $1 AND b.organization_id = $2
          ORDER BY b.created_at DESC
          LIMIT ${ACTIVITY_LIMIT}`,
        [cpId, cpOrgId]
      ),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          partner: partnerRows[0],
          enquiries,
          siteVisits,
          followUps,
          bookings,
          counts: {
            enquiries: enquiries.length,
            siteVisits: siteVisits.length,
            followUps: followUps.length,
            bookings: bookings.length,
          },
          // The UI says "showing the most recent N" rather than implying the
          // lists are complete when a partner is busy enough to hit the cap.
          truncated: {
            enquiries: enquiries.length === ACTIVITY_LIMIT,
            siteVisits: siteVisits.length === ACTIVITY_LIMIT,
            followUps: followUps.length === ACTIVITY_LIMIT,
            bookings: bookings.length === ACTIVITY_LIMIT,
          },
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/channel-partners/[id]/overview]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
