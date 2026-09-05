// api/walkin_enquiries/check-match/route.ts
//
// Real-time lead match detection for the Client Enquiry form.
// Called on phone/name change (debounced) to tell the receptionist that an
// existing lead with the same phone exists before they submit.
//
// Security:
//   - Requires authentication. All four employee roles are supported.
//   - Returns phone masked via resolvePhone (LEAD_PHONE scope).
//   - Only returns matches > 24h old (< 24h would 409 on submit anyway).
//   - No follow-ups are returned here — those come from revisit-history.
//   - matchType distinguishes a definite phone match from a possible name match.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";
import { resolvePhone } from "@/lib/phoneAccess";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const { searchParams } = new URL(req.url);
    const phone = (searchParams.get("phone") ?? "").trim();
    const name = (searchParams.get("name") ?? "").trim();

    // At least one of phone or name must be non-empty to run a query.
    if (!phone && !name) {
      return NextResponse.json({ success: true, matched: false, matchType: null, lead: null, age_hours: null });
    }

    const orgId = await getOrganizationId();

    let matchedRow: any = null;
    let matchType: "phone" | "name" | null = null;

    // Phone match takes precedence — last-10-digit normalization uses the same
    // index as the duplicate gate in the POST handler. A phone match is a
    // definite identity signal; a name match is only a possibility.
    if (phone && phone.replace(/\D/g, "").length >= 10) {
      const rows = await query(
        `SELECT id, name, phone, assigned_to, created_at,
                lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
             = RIGHT(regexp_replace($1, '[^0-9]', '', 'g'), 10)
           AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [phone, orgId]
      );
      if (rows.length > 0) {
        const row = rows[0];
        const secondsAgo = Number(row.seconds_ago);
        // Only surface if > 24h old — within 24h the POST will 409 anyway,
        // and showing a match warning for something the server will reject
        // as a same-day duplicate would confuse the receptionist.
        if (secondsAgo >= 86400) {
          matchedRow = row;
          matchType = "phone";
        }
      }
    }

    // Name fallback — only when no phone match was found.
    // A name-only match signals a POSSIBLE customer, not a confirmed one.
    // The UI must present it with lower confidence and require explicit
    // confirmation before the receptionist can check "Mark as Revisit".
    if (!matchedRow && name.length >= 3) {
      const rows = await query(
        `SELECT id, name, phone, assigned_to, created_at,
                lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE name ILIKE $1
           AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${name}%`, orgId]
      );
      if (rows.length > 0) {
        const row = rows[0];
        const secondsAgo = Number(row.seconds_ago);
        if (secondsAgo >= 86400) {
          matchedRow = row;
          matchType = "name";
        }
      }
    }

    if (!matchedRow) {
      return NextResponse.json({ success: true, matched: false, matchType: null, lead: null, age_hours: null });
    }

    const actor = {
      _id: session._id ?? (session as any).id,
      name: session.name,
      role: session.role,
    };

    // Mask the matched lead's phone before returning it.
    const maskedPhone = await resolvePhone(actor, matchedRow, "LEAD_PHONE", orgId, matchedRow.phone);

    const ageHours = Math.floor(Number(matchedRow.seconds_ago) / 3600);

    return NextResponse.json({
      success: true,
      matched: true,
      // "phone" = definite match on normalized last-10-digit phone.
      // "name"  = possible match by name ILIKE — requires explicit confirmation.
      matchType,
      lead: {
        id: matchedRow.id,
        name: matchedRow.name,
        phone: maskedPhone,
        assigned_to: matchedRow.assigned_to,
        created_at: matchedRow.created_at,
        lead_classification: matchedRow.lead_classification,
      },
      age_hours: ageHours,
    });
  } catch (error: any) {
    console.error("GET check-match Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
