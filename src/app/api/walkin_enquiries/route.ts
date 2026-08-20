//walkin_enquiries/route.ts
import { NextResponse } from "next/server";
import { query, transaction, recalculateSrNos } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { isChannelPartnerSource, resolveChannelPartnerId } from "@/lib/cpCommissionEngine";
import { claimPartnerForSourcingManager, resolvePartnerOwner } from "@/lib/sourcingAssignment";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";
import { notifyCpLeadAssigned } from "@/services/whatsapp.service";
import { jsonCompressed } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // This route has no role scoping — it is a plain SELECT * across every lead,
    // CP or not. A Sourcing Manager's only sanctioned view is /api/cp-enquiries,
    // which forces their own id into the WHERE clause; nothing does that here. So
    // rather than widen this endpoint's WHERE clause (and risk missing a caller
    // elsewhere that still expects the full unfiltered set), a Sourcing Manager is
    // refused outright and pointed at the endpoint that is actually scoped for them.
    const session = await getServerSession();
    // MT-08 (CRITICAL, pre-existing): the session was fetched but a NULL one was
    // never rejected. Every check below is `session?.role === ...`, which an
    // anonymous caller fails — so they fell straight through and received the
    // entire lead table: names, phones, emails, addresses. Reject first, then
    // apply the role rule; the Sourcing Manager behaviour below is unchanged.
    if (!session?.role) {
      return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
    }
    if (normalizeRole(session.role) === "sourcing manager") {
      return NextResponse.json(
        {
          success: false,
          message: "Sourcing Managers cannot list all leads. Use /api/cp-enquiries for your assigned channel partners.",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
    // Allow bulk admin fetches (> 1000 = bypass cap), otherwise cap at 500
    const limit = rawLimit > 1000 ? rawLimit : Math.min(rawLimit, 500);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);

    // Because this uses SELECT *, the new Site Head columns will be fetched automatically
    const listOrgId = await getOrganizationId();
    const [rows, countRows] = await Promise.all([
      // The tenant filter goes INSIDE the query, before LIMIT/OFFSET. Paginating
      // an unscoped set and filtering afterwards would make page 1 another
      // organization's rows, and the total would count both builders' leads.
      query(
        "SELECT * FROM walkin_enquiries WHERE organization_id = $3 ORDER BY sr_no DESC NULLS LAST LIMIT $1 OFFSET $2",
        [limit, offset, listOrgId]
      ),
      query("SELECT COUNT(*)::int AS total FROM walkin_enquiries WHERE organization_id = $1", [listOrgId]),
    ]);

    const total: number = countRows[0]?.total ?? 0;
    // Compressed: the admin dashboard requests limit=10000 here, which is ~13 MB
    // of highly repetitive JSON (60 identical keys per row) and gzips ~35×.
    return jsonCompressed(req, { success: true, data: rows, total }, { status: 200 });
  } catch (error: any) {
    console.error("GET Enquiries Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const session = await getServerSession();
    const {
      name, phone, alt_phone, email, address, occupation, organization,
      pin_code, city,          // ← geographic capture; CP-to-area matching comes later
      preferred_location,      // ← where the client wants to buy (≠ their address)
      sourcing_manager_id,     // ← CP enquiries only; assigned at creation by reception
      budget, configuration, purpose, source, source_other,
      referral_name,           // ← ADD THIS
      cp_name, cp_company, cp_phone, loan_planned,
      assignedTo,
      assigned_receptionist,
      status,
      is_global_shared,
      overseeing_site_head,
      enquiry_date,            // ← Backdated enquiry date support
      auto_date_enabled,       // ← Backdated enquiry state
    } = body;

    if (!name || !phone || !assignedTo) {
      return NextResponse.json(
        { success: false, message: "Missing required fields: name, phone, assignedTo" },
        { status: 400 }
      );
    }

    // Server-side duplicate prevention (idempotency check)
    // Reject if the same phone number was submitted within the last 15 seconds
    const duplicateCheck = await query(
      `SELECT id FROM walkin_enquiries WHERE phone = $1 AND created_at >= NOW() - INTERVAL '15 seconds' AND organization_id = $2`,
      [phone, await getOrganizationId()]
    );

    if (duplicateCheck.length > 0) {
      return NextResponse.json(
        { success: false, message: "Enquiry has already been submitted." },
        { status: 409 }
      );
    }

    // Effective source is resolved once so the CP gate and the stored value agree.
    const effectiveSource = source || "Direct Walk-in";
    const isCpEnquiry = isChannelPartnerSource(effectiveSource);
    const sessionRole = normalizeRole(session?.role);
    const actorName = (session?.name || assigned_receptionist || "system").toString();
    const actorUserIdRaw = Number(session?._id ?? session?.id);
    const actorUserId = Number.isInteger(actorUserIdRaw) ? actorUserIdRaw : null;

    if (isCpEnquiry) {
      if (!session?.role) {
        return NextResponse.json(
          { success: false, message: "You must be signed in to create a Channel Partner enquiry." },
          { status: 401 }
        );
      }

      if (!["receptionist", "admin"].includes(sessionRole)) {
        return NextResponse.json(
          { success: false, message: "Only Receptionists and Admins can create Channel Partner enquiries." },
          { status: 403 }
        );
      }
    }

    // CP-sourced enquiries must carry the partner's phone. It is the only
    // high-confidence identity key: without it the partner can only be matched by
    // name, which both creates duplicates and — where two partners share a name —
    // silently merges them, sending commission to the wrong person.
    //
    // New writes only. Historical rows without a phone are untouched and stay valid.
    if (isCpEnquiry && !String(cp_phone || "").trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Channel Partner phone number is required for Channel Partner enquiries.",
          code: "CP_PHONE_REQUIRED",
        },
        { status: 400 }
      );
    }

    const rawSourcingManagerId = isCpEnquiry ? Number(sourcing_manager_id) : null;
    const requestedSourcingManagerId = Number.isInteger(rawSourcingManagerId)
      ? rawSourcingManagerId
      : null;

    if (isCpEnquiry) {
      // Sourcing Manager is optional: a CP enquiry may be saved unassigned and an
      // Admin can assign it later from Channel Partner Management. When the phone
      // resolves to an already-registered partner, resolvePartnerOwner in the
      // transaction below routes the lead to that partner's owner regardless.
      //
      // A supplied id is still validated even when it will be overridden — a bad
      // one means the form is out of sync, and failing loudly beats silently
      // substituting a different manager than the operator saw on screen.
      if (requestedSourcingManagerId !== null) {
        const managerRows = await query(
          // The id comes from the form, so the organization predicate is what
          // stops a manager in another tenant being accepted as the assignee.
          `SELECT id FROM users
            WHERE id = $1
              AND organization_id = $2
              AND is_active = true
              AND REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sourcing manager'
            LIMIT 1`,
          [requestedSourcingManagerId, await getOrganizationId()]
        );

        if (managerRows.length === 0) {
          return NextResponse.json(
            {
              success: false,
              message: "Selected user is not an active Sourcing Manager.",
              code: "INVALID_SOURCING_MANAGER",
            },
            { status: 400 }
          );
        }
      }
    }

    const result = await transaction(async (client) => {
      // MT-05: resolved once per transaction, on this client.
      const orgId = await getOrganizationId(client);
      // Resolve the channel partner (find-or-create) in the same transaction as the
      // enquiry insert, so a failure here rolls back both. Non-CP sources are
      // skipped entirely — their cp_name is sub-source noise, not partner data.
      const channelPartnerId = isCpEnquiry
        ? await resolveChannelPartnerId(
            client,
            { cp_name, cp_company, cp_phone, source: effectiveSource },
            actorName
          )
        : null;

      // ── Route by the partner, not by the dropdown ───────────────────────────
      // The CP phone has now resolved to a partner row. If that partner is already
      // registered under a Sourcing Manager, THEY get the lead — whatever the form
      // sent. A partner belongs to one manager, so every lead they bring must land
      // on the same desk; letting a front-desk pick override that would scatter one
      // partner's leads across managers and break the "who brought us what" view.
      //
      // Checked here rather than trusting the client's pre-submit lookup, so a lead
      // routes correctly even from a stale form or a hand-rolled request.
      const partnerOwner =
        isCpEnquiry && channelPartnerId ? await resolvePartnerOwner(client, channelPartnerId) : null;

      const effectiveSourcingManagerId = partnerOwner?.id ?? requestedSourcingManagerId;
      const routedByPartner =
        !!partnerOwner && partnerOwner.id !== requestedSourcingManagerId;

      const insertRes = await client.query(
        `INSERT INTO walkin_enquiries (
          name, phone, email, address, occupation, organization,
          budget, configuration, purpose, source,
          alt_phone, source_other, referral_name,
          cp_name, cp_company, cp_phone,
          loan_planned, assigned_to, assigned_receptionist, status,
          is_global_shared, overseeing_site_head,
          enquiry_date, auto_date_enabled, channel_partner_id,
          pin_code, city, preferred_location,
          sourcing_manager_id, sourcing_manager_assigned_at, sourcing_manager_assigned_by,
          organization_id
        )
        VALUES (
          $1,  $2,  $3,  $4,  $5,  $6,
          $7,  $8,  $9,  $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22,
          $23, $24, $25,
          $26, $27, $28,
          $29,
          CASE WHEN $29::int IS NULL THEN NULL ELSE now() END,
          CASE WHEN $29::int IS NULL THEN NULL ELSE $30 END,
          $31
        )
        RETURNING id`,
        [
          name,                               // $1
          phone,                              // $2
          email || "N/A",                     // $3
          address || "N/A",                   // $4
          occupation || "N/A",                // $5
          organization || "N/A",              // $6
          budget || "Pending",                // $7
          configuration || "N/A",             // $8
          purpose || "N/A",                   // $9
          effectiveSource,                    // $10
          alt_phone || null,                  // $11
          source_other || null,               // $12
          referral_name || null,              // $13
          cp_name || null,                    // $14
          cp_company || null,                 // $15
          cp_phone || null,                   // $16
          loan_planned || "Pending",          // $17
          assignedTo,                         // $18
          assigned_receptionist || null,      // $19
          status || "Assigned",                // $20
          is_global_shared || false,          // $21
          overseeing_site_head || null,       // $22
          enquiry_date || new Date().toISOString(), // $23
          auto_date_enabled ?? true,          // $24
          channelPartnerId,                   // $25
          // Left NULL rather than defaulted to "N/A": these feed a future
          // pincode/city match against channel partners, and a literal "N/A"
          // would look like a real area value to that query.
          pin_code || null,                   // $26
          city || null,                       // $27
          preferred_location || null,          // $28
          // Only meaningful for Channel Partner sources; every other source sends
          // null and the assigned_at/by columns stay NULL via the CASE above.
          // This is the *effective* manager — the registered partner's owner when
          // there is one, otherwise whoever the form selected.
          effectiveSourcingManagerId,          // $29
          actorName,                           // $30
          orgId,                               // $31
        ]
      );
      
      const newId = insertRes.rows[0].id;

      // A partner with no owner yet — typically one auto-created by this very
      // enquiry — is claimed by the manager the form selected, so their next lead
      // routes automatically via the branch above.
      if (isCpEnquiry && channelPartnerId && effectiveSourcingManagerId) {
        await claimPartnerForSourcingManager(
          client,
          channelPartnerId,
          effectiveSourcingManagerId,
          actorName
        );
      }

      if (isCpEnquiry) {
        await client.query(
          `INSERT INTO cp_assignment_history (
             lead_id,
             previous_sourcing_manager_id,
             new_sourcing_manager_id,
             assigned_by_user_id,
             assigned_by_name,
             assigned_by_role,
             action,
             assigned_at,
             organization_id
           )
           SELECT
             id,
             NULL,
             sourcing_manager_id,
             $2,
             $3,
             $4,
             'assigned',
             COALESCE(sourcing_manager_assigned_at, now()),
             organization_id
           FROM walkin_enquiries
           WHERE id = $1`,
          [newId, actorUserId, actorName, session?.role || null]
        );
      }
      
      // Always recalculate Sr. No. to maintain strictly chronological gapless order
      await recalculateSrNos(client);
      
      const finalRes = await client.query(
        "SELECT * FROM walkin_enquiries WHERE id = $1",
        [newId]
      );
      return { row: finalRes.rows[0], routedByPartner, partnerOwner };
    });

    // ── WhatsApp: tell the Sourcing Manager the lead landed on ───────────────
    // sourcing_manager_id on the saved row is the EFFECTIVE manager — the
    // partner's registered owner when there is one, otherwise the form's pick
    // (see effectiveSourcingManagerId above). So this always pages whoever the
    // lead actually went to, not whoever the receptionist happened to select.
    //
    // result.row is used rather than result.partnerOwner because the latter
    // carries only {id, name} and is null whenever the routing came from the
    // form pick — relying on it would silently skip half the cases.
    //
    // Fires after COMMIT, never awaited. A failure here cannot fail the enquiry.
    if (isCpEnquiry && result.row?.sourcing_manager_id) {
      notifyCpLeadAssigned({ lead: result.row, loggedBy: actorName });
    }

    return NextResponse.json(
      {
        success: true,
        data: result.row,
        // Surfaced so the receptionist is told the lead went somewhere other than
        // the manager shown in the form, rather than discovering it later.
        routedByPartner: result.routedByPartner,
        routedTo: result.partnerOwner?.name ?? null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST Enquiry Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
