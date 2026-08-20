// api/channel-partners/[id]/chat/route.ts
//
// The Channel Partner conversation: real messages plus the CRM events that are
// safe to surface to that partner, in one ordered thread, with every item
// attributed to the employee who actually generated it.
//
// ── Why CRM events are derived, not copied ──────────────────────────────────
// A booking confirmation could be written into cp_chat_messages the moment the
// booking is confirmed. It deliberately is not, for three reasons:
//
//   1. booking_applications stays the single source of truth. Booking 21 was
//      confirmed and later cancelled; a copied message would still be sitting in
//      the partner's thread announcing a booking that no longer exists.
//   2. Bookings and site visits that predate this feature would never appear,
//      because no write hook ran for them.
//   3. Hooking the booking/site-visit write paths would change existing CRM
//      behaviour, which this work must not do.
//
// So cp_chat_messages stores what people type (and CP visits), and CRM events
// are projected here at read time from the authoritative tables. Nothing is
// duplicated, and a cancelled booking's card disappears by itself.
//
// ── The disclosure chain ────────────────────────────────────────────────────
// Section 10 of the brief: before an event is displayed, event → lead → channel
// partner → organization must be provable. Every query below joins that whole
// chain explicitly and scopes each table to the caller's organization. A booking
// is matched to a partner only through its own sourced_by_channel_partner_id, or
// through its lead when that column is NULL — never through both loosely, which
// would let a lead belonging to partner A surface a booking attributed to B.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { getServerSession, getSessionUserId } from "@/lib/serverAuth";
import { canViewPartners, canViewAllPartners } from "@/lib/cpRbac";
import { resolveSender, formatUnitConfig, clean } from "@/lib/cpChat";

export const dynamic = "force-dynamic";

const THREAD_LIMIT = 200;
const MAX_MESSAGE_LENGTH = 4000;

/** Milliseconds for sorting; the thread is assembled from five different date columns. */
const at = (v: any) => (v ? new Date(v).getTime() : 0);

/**
 * Resolves the partner and proves the caller may see it.
 *
 * Returns the partner row, or a ready-made 404 response. A Sourcing Manager who
 * asks for someone else's partner gets 404 rather than 403 for the same reason
 * the overview route does: 403 would confirm the partner exists.
 */
async function loadPartner(cpId: number, session: any, orgId: string) {
  const rows = await query(
    `SELECT cp.id, cp.name, cp.company_name, cp.phone, cp.email,
            cp.office_address, cp.city, cp.pin_code, cp.status,
            cp.owner_contact_person, cp.created_at, cp.updated_at,
            cp.assigned_sourcing_manager_id, cp.assigned_sourcing_manager_at,
            sm.name AS assigned_sourcing_manager_name,
            sm.role AS assigned_sourcing_manager_role
       FROM channel_partners cp
       LEFT JOIN users sm
              ON sm.id = cp.assigned_sourcing_manager_id
             AND sm.organization_id = cp.organization_id
      WHERE cp.id = $1 AND cp.organization_id = $2`,
    [cpId, orgId]
  );
  if (rows.length === 0) return { partner: null as any, denied: true };
  if (
    !canViewAllPartners(session.role) &&
    String(rows[0].assigned_sourcing_manager_id ?? "") !== String(session._id ?? session.id ?? "")
  ) {
    return { partner: null as any, denied: true };
  }
  return { partner: rows[0], denied: false };
}

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
    const orgId = await getOrganizationId();
    const { partner, denied } = await loadPartner(cpId, session, orgId);
    if (denied) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }

    const [
      persisted, cpVisits, siteVisitEvents, bookingEvents,
      registrationEvents, disbursementEvents, about,
    ] = await Promise.all([
      // ── 1. Real CP-level messages ──────────────────────────────────────
      // Sender comes from the sender_user_id FK, so attribution here is exact.
      query(
        `SELECT m.id, m.message_type, m.message_text, m.sent_at, m.edited_at,
                m.sender_user_id, m.visit_id,
                m.attachment_key, m.attachment_name, m.attachment_type, m.attachment_size,
                u.name AS sender_name, u.role AS sender_role
           FROM cp_chat_messages m
           LEFT JOIN users u ON u.id = m.sender_user_id AND u.organization_id = m.organization_id
          WHERE m.organization_id = $1 AND m.channel_partner_id = $2
          ORDER BY m.sent_at DESC
          LIMIT ${THREAD_LIMIT}`,
        [orgId, cpId]
      ),

      // ── 2. Sourcing Manager visits to this partner ─────────────────────
      query(
        `SELECT v.id, v.visit_at, v.person_met, v.notes, v.location_name,
                v.latitude, v.longitude, v.photo_key,
                u.name AS visited_by_name, u.role AS visited_by_role
           FROM cp_visits v
           LEFT JOIN users u ON u.id = v.visited_by AND u.organization_id = v.organization_id
          WHERE v.organization_id = $1 AND v.channel_partner_id = $2
          ORDER BY v.visit_at DESC
          LIMIT ${THREAD_LIMIT}`,
        [orgId, cpId]
      ),

      // ── 3. Customer site visits ────────────────────────────────────────
      // Chain: site_visits → walkin_enquiries (same org) → channel_partner_id.
      // Only the four approved fields leave the server. w.phone, w.email and
      // w.alt_phone are never selected.
      query(
        `SELECT v.id, v.visit_date, v.created_at, v.status, v.notes,
                v.created_by AS stored_by, v.role AS stored_role,
                w.name AS customer_name, w.sr_no, w.id AS lead_id,
                u.name AS user_name, u.role AS user_role
           FROM site_visits v
           JOIN walkin_enquiries w
             ON w.id = v.lead_id
            AND w.organization_id = v.organization_id
           LEFT JOIN users u
             ON lower(btrim(u.name)) = lower(btrim(v.created_by))
            AND u.organization_id = v.organization_id
          WHERE v.organization_id = $1
            AND w.organization_id = $1
            AND w.channel_partner_id = $2
          ORDER BY v.visit_date DESC NULLS LAST, v.id DESC
          LIMIT ${THREAD_LIMIT}`,
        [orgId, cpId]
      ),

      // ── 4. Confirmed bookings ──────────────────────────────────────────
      // Only Confirmed. A cancelled booking produces no card at all, and one
      // cancelled after confirmation stops producing one the moment it changes.
      //
      // The partner match is strict: the booking's own sourced_by column, or the
      // lead's partner when that column is NULL. Never a loose OR across both.
      query(
        `SELECT b.id, b.booking_number, b.booking_date, b.created_at, b.booking_status,
                b.property_type, b.tower, b.wing, b.floor_number,
                b.apartment_name, b.project_name,
                b.created_by AS stored_by, b.created_role AS stored_role,
                w.name AS customer_name, w.sr_no,
                u.name AS user_name, u.role AS user_role
           FROM booking_applications b
           JOIN walkin_enquiries w
             ON w.id = b.lead_id
            AND w.organization_id = b.organization_id
           LEFT JOIN users u
             ON lower(btrim(u.name)) = lower(btrim(b.created_by))
            AND u.organization_id = b.organization_id
          WHERE b.organization_id = $1
            AND w.organization_id = $1
            AND b.booking_status = 'Confirmed'
            AND (
                  b.sourced_by_channel_partner_id = $2
               OR (b.sourced_by_channel_partner_id IS NULL AND w.channel_partner_id = $2)
            )
          ORDER BY COALESCE(b.booking_date, b.created_at::date) DESC, b.id DESC
          LIMIT ${THREAD_LIMIT}`,
        [orgId, cpId]
      ),

      // ── 5. Registration progress ───────────────────────────────────────
      // Status and date only. Stamp duty, registration fees and the registration
      // number are financial/legal detail and are not selected.
      query(
        `SELECT b.id, b.booking_number, w.name AS customer_name,
                r.registration_status, r.actual_registration_date,
                r.expected_registration_date, r.updated_at,
                b.created_by AS stored_by, b.created_role AS stored_role,
                u.name AS user_name, u.role AS user_role
           FROM booking_registration_details r
           JOIN booking_applications b
             ON b.id = r.booking_id AND b.organization_id = r.organization_id
           JOIN walkin_enquiries w
             ON w.id = b.lead_id AND w.organization_id = b.organization_id
           LEFT JOIN users u
             ON lower(btrim(u.name)) = lower(btrim(b.created_by))
            AND u.organization_id = b.organization_id
          WHERE r.organization_id = $1
            AND b.organization_id = $1
            AND b.booking_status = 'Confirmed'
            AND r.registration_status IS NOT NULL
            AND btrim(r.registration_status) NOT IN ('', 'Pending')
            AND (
                  b.sourced_by_channel_partner_id = $2
               OR (b.sourced_by_channel_partner_id IS NULL AND w.channel_partner_id = $2)
            )
          ORDER BY r.updated_at DESC NULLS LAST, b.id DESC
          LIMIT ${THREAD_LIMIT}`,
        [orgId, cpId]
      ),

      // ── 6. Disbursement progress ───────────────────────────────────────
      // Status and date only — never the amount, the bank, or the sanction.
      query(
        `SELECT b.id, b.booking_number, w.name AS customer_name,
                l.disbursement_status, l.actual_disbursement_date, l.updated_at,
                b.created_by AS stored_by, b.created_role AS stored_role,
                u.name AS user_name, u.role AS user_role
           FROM booking_loan_details l
           JOIN booking_applications b
             ON b.id = l.booking_id AND b.organization_id = l.organization_id
           JOIN walkin_enquiries w
             ON w.id = b.lead_id AND w.organization_id = b.organization_id
           LEFT JOIN users u
             ON lower(btrim(u.name)) = lower(btrim(b.created_by))
            AND u.organization_id = b.organization_id
          WHERE l.organization_id = $1
            AND b.organization_id = $1
            AND b.booking_status = 'Confirmed'
            AND l.disbursement_status IS NOT NULL
            AND btrim(l.disbursement_status) NOT IN ('', 'Pending')
            AND (
                  b.sourced_by_channel_partner_id = $2
               OR (b.sourced_by_channel_partner_id IS NULL AND w.channel_partner_id = $2)
            )
          ORDER BY l.updated_at DESC NULLS LAST, b.id DESC
          LIMIT ${THREAD_LIMIT}`,
        [orgId, cpId]
      ),

      // ── 7. About-panel aggregates ──────────────────────────────────────
      // Counted in SQL rather than by measuring the arrays above, which are
      // capped at THREAD_LIMIT and would understate a busy partner.
      query(
        `SELECT
           (SELECT count(*)::int FROM walkin_enquiries w
             WHERE w.channel_partner_id = $2 AND w.organization_id = $1) AS total_leads,
           (SELECT count(*)::int FROM site_visits v
              JOIN walkin_enquiries w ON w.id = v.lead_id AND w.organization_id = v.organization_id
             WHERE w.channel_partner_id = $2 AND v.organization_id = $1) AS total_site_visits,
           (SELECT count(*)::int FROM booking_applications b
             WHERE b.organization_id = $1 AND b.booking_status = 'Confirmed'
               AND b.sourced_by_channel_partner_id = $2) AS total_bookings,
           (SELECT count(*)::int FROM cp_visits v
             WHERE v.organization_id = $1 AND v.channel_partner_id = $2) AS total_cp_visits,
           (SELECT max(v.visit_at) FROM cp_visits v
             WHERE v.organization_id = $1 AND v.channel_partner_id = $2) AS last_cp_visit,
           (SELECT max(m.sent_at) FROM cp_chat_messages m
             WHERE m.organization_id = $1 AND m.channel_partner_id = $2) AS last_message_at,
           (SELECT max(w.created_at) FROM walkin_enquiries w
             WHERE w.channel_partner_id = $2 AND w.organization_id = $1) AS last_lead_at,
           -- followup_date is a varchar of mixed formats; only rows that parse as
           -- a future date are considered, and a bad value must not 500 the panel.
           (SELECT min(f.followup_date) FROM follow_ups f
              JOIN walkin_enquiries w ON w.id = f.lead_id AND w.organization_id = f.organization_id
             WHERE w.channel_partner_id = $2 AND f.organization_id = $1
               AND f.followup_date ~ '^\\d{4}-\\d{2}-\\d{2}'
               AND f.followup_date >= to_char(now(), 'YYYY-MM-DD')) AS next_follow_up`,
        [orgId, cpId]
      ),
    ]);

    const items: any[] = [];

    for (const m of persisted) {
      items.push({
        id: `m${m.id}`,
        kind: m.message_type,
        ts: at(m.sent_at),
        sender: resolveSender(m.sender_role, m.sender_name),
        senderUserId: m.sender_user_id,
        text: m.message_text || "",
        edited: !!m.edited_at,
        visitId: m.visit_id,
        attachment: m.attachment_key
          ? { name: m.attachment_name, type: m.attachment_type, size: m.attachment_size }
          : null,
        source: "cp_chat_messages",
      });
    }

    for (const v of cpVisits) {
      items.push({
        id: `v${v.id}`,
        kind: "visit",
        ts: at(v.visit_at),
        sender: resolveSender(v.visited_by_role, v.visited_by_name),
        title: "CP Visit",
        personMet: clean(v.person_met),
        location: clean(v.location_name),
        gps: v.latitude && v.longitude ? `${v.latitude}, ${v.longitude}` : "",
        notes: clean(v.notes),
        hasPhoto: !!v.photo_key,
        source: "cp_visits",
      });
    }

    for (const v of siteVisitEvents) {
      items.push({
        id: `sv${v.id}`,
        kind: "customer_update",
        ts: at(v.visit_date || v.created_at),
        sender: resolveSender(v.user_role, v.user_name, v.stored_role, v.stored_by),
        title: "Site Visit Update",
        customer: clean(v.customer_name),
        leadRef: `#${v.sr_no || v.lead_id}`,
        status: clean(v.status)
          ? v.status.replace(/\b\w/g, (c: string) => c.toUpperCase())
          : "Logged",
        feedback: clean(v.notes),
        source: "site_visits",
      });
    }

    for (const b of bookingEvents) {
      items.push({
        id: `b${b.id}`,
        kind: "booking_update",
        ts: at(b.booking_date || b.created_at),
        sender: resolveSender(b.user_role, b.user_name, b.stored_role, b.stored_by),
        title: "Booking Confirmed",
        bookingNo: clean(b.booking_number) || `BK-${b.id}`,
        customer: clean(b.customer_name),
        unitConfig: formatUnitConfig(b.property_type),
        // "Building" in the brief is the project/apartment the unit sits in.
        building: clean(b.apartment_name) || clean(b.project_name),
        tower: clean(b.tower),
        wing: clean(b.wing),
        floor: clean(b.floor_number),
        source: "booking_applications",
      });
    }

    for (const r of registrationEvents) {
      items.push({
        id: `rg${r.id}`,
        kind: "booking_update",
        ts: at(r.actual_registration_date || r.updated_at),
        sender: resolveSender(r.user_role, r.user_name, r.stored_role, r.stored_by),
        title: "Registration Update",
        bookingNo: clean(r.booking_number) || `BK-${r.id}`,
        customer: clean(r.customer_name),
        status: clean(r.registration_status),
        onDate: r.actual_registration_date || null,
        source: "booking_registration_details",
      });
    }

    for (const d of disbursementEvents) {
      items.push({
        id: `db${d.id}`,
        kind: "booking_update",
        ts: at(d.actual_disbursement_date || d.updated_at),
        sender: resolveSender(d.user_role, d.user_name, d.stored_role, d.stored_by),
        title: "Disbursement Update",
        bookingNo: clean(d.booking_number) || `BK-${d.id}`,
        customer: clean(d.customer_name),
        status: clean(d.disbursement_status),
        onDate: d.actual_disbursement_date || null,
        source: "booking_loan_details",
      });
    }

    // follow_ups is deliberately NOT read into this thread.
    //
    // It looked like free history worth keeping — the messages typed into this
    // panel before cp_chat_messages existed landed there. But the same table
    // also collects the CRM's own auto-generated notes, and those spell out
    // exactly what a partner must not see. A live example on lead #206:
    //
    //   "📋 Booking Application Submitted by Vinesh Singh (Sales Manager)
    //    • Booking No: BK-…-00023 • Flat: A-1402, Floor: 14
    //    • Amount: 4480000 • Date: 2026-08-15"
    //
    // 29 of the CP-linked follow_ups carry a six-figure amount or the words
    // loan/PAN/Aadhaar. Filtering them by pattern would be a deny-list over
    // free text written by other people, which is not a boundary anyone can
    // hold. So the thread shows only what this feature owns: cp_chat_messages,
    // cp_visits, and the allow-listed CRM projections above. The follow_ups
    // rows themselves are untouched and still render wherever the lead's own
    // follow-up history is shown.
    const sessionUserId = getSessionUserId(session);
    for (const it of items) {
      // "Mine" drives bubble alignment, and is only ever true for a message
      // this user actually wrote — matched on user id, never on name.
      it.mine = it.source === "cp_chat_messages"
        && it.senderUserId != null && it.senderUserId === sessionUserId;
    }

    items.sort((a, b) => a.ts - b.ts);

    const agg = about[0] || {};
    return NextResponse.json(
      {
        success: true,
        data: {
          messages: items,
          about: {
            profile: {
              name: partner.name,
              company: partner.company_name,
              phone: partner.phone,
              email: partner.email,
              address: partner.office_address,
              city: partner.city,
              pin: partner.pin_code,
              contactPerson: partner.owner_contact_person,
              sourcingManager: partner.assigned_sourcing_manager_name,
              status: partner.status,
              createdOn: partner.created_at,
            },
            business: {
              totalLeads: agg.total_leads ?? 0,
              totalSiteVisits: agg.total_site_visits ?? 0,
              totalBookings: agg.total_bookings ?? 0,
              lastActivity: [agg.last_message_at, agg.last_lead_at, agg.last_cp_visit, partner.updated_at]
                .filter(Boolean)
                .sort((a: any, b: any) => at(b) - at(a))[0] ?? null,
              lastCpVisit: agg.last_cp_visit ?? null,
            },
            relationship: {
              sourcingManager: partner.assigned_sourcing_manager_name,
              managerSince: partner.assigned_sourcing_manager_at,
              lastInteraction: items.length ? items[items.length - 1].ts : null,
              nextFollowUp: agg.next_follow_up ?? null,
              totalCpVisits: agg.total_cp_visits ?? 0,
            },
          },
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/channel-partners/[id]/chat]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

/**
 * Posts a CP-level message.
 *
 * Writes to cp_chat_messages and nowhere else — in particular never to
 * follow_ups, which is lead-scoped and was only ever a stand-in. organization_id
 * comes from the tenant context and sender_user_id from the verified session, so
 * neither can be supplied by the caller; the database trigger rejects the write
 * anyway if either fails to match the partner's organization.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!canViewPartners(session.role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot message channel partners." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const cpId = Number(id);
  if (!Number.isInteger(cpId)) {
    return NextResponse.json({ success: false, message: "Invalid partner id." }, { status: 400 });
  }

  const senderUserId = getSessionUserId(session);
  if (senderUserId == null) {
    return NextResponse.json(
      { success: false, message: "Your session does not identify a user." },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const text = (body?.text ?? body?.message ?? "").toString().trim();
    if (!text) {
      return NextResponse.json({ success: false, message: "Message is empty." }, { status: 400 });
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { success: false, message: `Message is longer than ${MAX_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const orgId = await getOrganizationId();
    const { partner, denied } = await loadPartner(cpId, session, orgId);
    if (denied) {
      return NextResponse.json(
        { success: false, message: `Channel partner ${id} not found.` },
        { status: 404 }
      );
    }

    const rows = await query(
      `INSERT INTO cp_chat_messages
         (organization_id, channel_partner_id, sender_user_id, message_type, message_text)
       VALUES ($1, $2, $3, 'text', $4)
       RETURNING id, sent_at`,
      [orgId, partner.id, senderUserId, text]
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          id: `m${rows[0].id}`,
          ts: at(rows[0].sent_at),
          kind: "text",
          text,
          sender: resolveSender(session.role, session.name),
          mine: true,
          source: "cp_chat_messages",
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/channel-partners/[id]/chat]", err);
    // The tenant trigger raises check_violation for a cross-organization write.
    if (err?.code === "23514") {
      return NextResponse.json(
        { success: false, message: "That partner belongs to another organization." },
        { status: 403 }
      );
    }
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
