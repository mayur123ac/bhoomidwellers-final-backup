//walkin_enquiries/route.ts
import { NextResponse } from "next/server";
import { query, transaction, recalculateSrNos } from "@/lib/db";
import { isChannelPartnerSource, resolveChannelPartnerId } from "@/lib/cpCommissionEngine";
import { getServerSession } from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/cpRbac";

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
    if (session?.role && normalizeRole(session.role) === "sourcing manager") {
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
    const [rows, countRows] = await Promise.all([
      query(
        "SELECT * FROM walkin_enquiries ORDER BY sr_no DESC NULLS LAST LIMIT $1 OFFSET $2",
        [limit, offset]
      ),
      query("SELECT COUNT(*)::int AS total FROM walkin_enquiries"),
    ]);

    const total: number = countRows[0]?.total ?? 0;
    return NextResponse.json({ success: true, data: rows, total }, { status: 200 });
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
      `SELECT id FROM walkin_enquiries WHERE phone = $1 AND created_at >= NOW() - INTERVAL '15 seconds'`,
      [phone]
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

    const requestedSourcingManagerId = isCpEnquiry ? Number(sourcing_manager_id) : null;
    if (isCpEnquiry) {
      if (!Number.isInteger(requestedSourcingManagerId)) {
        return NextResponse.json(
          {
            success: false,
            message: "Assign Sourcing Manager is required for Channel Partner enquiries.",
            code: "SOURCING_MANAGER_REQUIRED",
          },
          { status: 400 }
        );
      }

      const managerRows = await query(
        `SELECT id FROM users
          WHERE id = $1
            AND is_active = true
            AND REPLACE(LOWER(TRIM(role)), '_', ' ') = 'sourcing manager'
          LIMIT 1`,
        [requestedSourcingManagerId]
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

    const result = await transaction(async (client) => {
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
          sourcing_manager_id, sourcing_manager_assigned_at, sourcing_manager_assigned_by
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
          CASE WHEN $29::int IS NULL THEN NULL ELSE $30 END
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
          requestedSourcingManagerId,          // $29
          actorName,                           // $30
        ]
      );
      
      const newId = insertRes.rows[0].id;

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
             assigned_at
           )
           SELECT
             id,
             NULL,
             sourcing_manager_id,
             $2,
             $3,
             $4,
             'assigned',
             COALESCE(sourcing_manager_assigned_at, now())
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
      return finalRes.rows[0];
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error: any) {
    console.error("POST Enquiry Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
