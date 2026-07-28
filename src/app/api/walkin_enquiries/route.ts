//walkin_enquiries/route.ts
import { NextResponse } from "next/server";
import { query, transaction, recalculateSrNos } from "@/lib/db";
import { isChannelPartnerSource, resolveChannelPartnerId } from "@/lib/cpCommissionEngine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
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
    const {
      name, phone, alt_phone, email, address, occupation, organization,
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

    // CP-sourced enquiries must carry the partner's phone. It is the only
    // high-confidence identity key: without it the partner can only be matched by
    // name, which both creates duplicates and — where two partners share a name —
    // silently merges them, sending commission to the wrong person.
    //
    // New writes only. Historical rows without a phone are untouched and stay valid.
    if (isChannelPartnerSource(effectiveSource) && !String(cp_phone || "").trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Channel Partner phone number is required for Channel Partner enquiries.",
          code: "CP_PHONE_REQUIRED",
        },
        { status: 400 }
      );
    }

    const result = await transaction(async (client) => {
      // Resolve the channel partner (find-or-create) in the same transaction as the
      // enquiry insert, so a failure here rolls back both. Non-CP sources are
      // skipped entirely — their cp_name is sub-source noise, not partner data.
      const channelPartnerId = isChannelPartnerSource(effectiveSource)
        ? await resolveChannelPartnerId(
            client,
            { cp_name, cp_company, cp_phone, source: effectiveSource },
            assigned_receptionist || assignedTo || "system"
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
          enquiry_date, auto_date_enabled, channel_partner_id
        )
        VALUES (
          $1,  $2,  $3,  $4,  $5,  $6,
          $7,  $8,  $9,  $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22,
          $23, $24, $25
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
        ]
      );
      
      const newId = insertRes.rows[0].id;
      
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