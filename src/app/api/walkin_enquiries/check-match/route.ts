// api/walkin_enquiries/check-match/route.ts
//
// Multi-field lead match detection for the Client Enquiry form.
// Called on form field changes (debounced) to detect possible existing customers
// before submission.
//
// Match rules (in priority order):
//   1. Exact normalized primary mobile   → strong match
//   2. Exact normalized alternate mobile  → strong match
//   3. Exact normalized email             → strong match
//   4. Full name + address                → strong match
//   5. Full name + PIN/city               → supporting match
//   Name similarity alone does NOT classify as a revisit.
//
// Security:
//   - Requires authentication. All four employee roles are supported.
//   - Returns phone masked via resolvePhone (LEAD_PHONE scope).
//   - Only returns matches > 24h old (< 24h would 409 on submit anyway).
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession } from "@/lib/serverAuth";
import { resolvePhone } from "@/lib/phoneAccess";
import { batchGetVisitDepths } from "@/lib/visitChain";

export const dynamic = "force-dynamic";

// ── Normalization helpers ──

/** Strip everything except digits, return last 10 digits. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** Trim, lowercase, collapse whitespace. */
function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Trim, lowercase. */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Trim, lowercase, collapse whitespace and punctuation variations. */
function normalizeAddress(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim and strip whitespace for exact comparison. */
function normalizePinCode(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}

export type MatchReason =
  | "primary_mobile"
  | "alternate_mobile"
  | "email"
  | "name_address"
  | "name_pin_city";

export interface MatchedCandidate {
  id: number;
  name: string;
  phone: string; // masked
  assigned_to: string | null;
  created_at: string;
  lead_classification: string;
  visitCount: number;
  matchReasons: MatchReason[];
}

export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;
    const { session } = gate;

    const { searchParams } = new URL(req.url);
    const phone = (searchParams.get("phone") ?? "").trim();
    const altPhone = (searchParams.get("altPhone") ?? "").trim();
    const email = (searchParams.get("email") ?? "").trim();
    const name = (searchParams.get("name") ?? "").trim();
    const address = (searchParams.get("address") ?? "").trim();
    const pinCode = (searchParams.get("pinCode") ?? "").trim();
    const city = (searchParams.get("city") ?? "").trim();

    // Need at least one field to run a query.
    if (!phone && !altPhone && !email && name.length < 3) {
      return NextResponse.json({
        success: true,
        matched: false,
        candidates: [],
      });
    }

    const orgId = await getOrganizationId();

    // Collect matched lead IDs → reasons. A lead can match on multiple fields.
    const matchMap = new Map<number, { row: any; reasons: Set<MatchReason> }>();

    const addMatch = (row: any, reason: MatchReason) => {
      const existing = matchMap.get(row.id);
      if (existing) {
        existing.reasons.add(reason);
      } else {
        matchMap.set(row.id, { row, reasons: new Set([reason]) });
      }
    };

    // ── 1. Primary mobile match ──
    if (phone && normalizePhone(phone).length >= 10) {
      const rows = await query(
        `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                assigned_to, created_at, lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
             = RIGHT(regexp_replace($1, '[^0-9]', '', 'g'), 10)
           AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [phone, orgId]
      );
      for (const row of rows) {
        if (Number(row.seconds_ago) >= 86400) addMatch(row, "primary_mobile");
      }
    }

    // ── 2. Alternate mobile match ──
    // Check incoming phone against existing alt_phone, and incoming altPhone against existing phone & alt_phone.
    if (phone && normalizePhone(phone).length >= 10) {
      const rows = await query(
        `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                assigned_to, created_at, lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE RIGHT(regexp_replace(alt_phone, '[^0-9]', '', 'g'), 10)
             = RIGHT(regexp_replace($1, '[^0-9]', '', 'g'), 10)
           AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [phone, orgId]
      );
      for (const row of rows) {
        if (Number(row.seconds_ago) >= 86400) addMatch(row, "alternate_mobile");
      }
    }

    if (altPhone && normalizePhone(altPhone).length >= 10) {
      // Incoming alt against existing primary
      const rows1 = await query(
        `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                assigned_to, created_at, lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
             = RIGHT(regexp_replace($1, '[^0-9]', '', 'g'), 10)
           AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [altPhone, orgId]
      );
      for (const row of rows1) {
        if (Number(row.seconds_ago) >= 86400) addMatch(row, "alternate_mobile");
      }

      // Incoming alt against existing alt
      const rows2 = await query(
        `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                assigned_to, created_at, lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE RIGHT(regexp_replace(alt_phone, '[^0-9]', '', 'g'), 10)
             = RIGHT(regexp_replace($1, '[^0-9]', '', 'g'), 10)
           AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [altPhone, orgId]
      );
      for (const row of rows2) {
        if (Number(row.seconds_ago) >= 86400) addMatch(row, "alternate_mobile");
      }
    }

    // ── 3. Email match ──
    if (email && email.includes("@")) {
      const normalizedEmail = normalizeEmail(email);
      const rows = await query(
        `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                assigned_to, created_at, lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE LOWER(TRIM(email)) = $1
           AND email IS NOT NULL AND email <> 'N/A' AND email <> ''
           AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [normalizedEmail, orgId]
      );
      for (const row of rows) {
        if (Number(row.seconds_ago) >= 86400) addMatch(row, "email");
      }
    }

    // ── 4. Name + Address match ──
    if (name.length >= 3 && address.length >= 5) {
      const normalizedName = normalizeName(name);
      const normalizedAddr = normalizeAddress(address);
      const rows = await query(
        `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                assigned_to, created_at, lead_classification,
                EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
         FROM walkin_enquiries
         WHERE LOWER(TRIM(regexp_replace(name, '\\s+', ' ', 'g'))) = $1
           AND address IS NOT NULL AND address <> 'N/A' AND address <> ''
           AND LOWER(TRIM(regexp_replace(regexp_replace(address, '[.,;:!?]+', ' ', 'g'), '\\s+', ' ', 'g'))) = $2
           AND organization_id = $3
         ORDER BY created_at DESC
         LIMIT 5`,
        [normalizedName, normalizedAddr, orgId]
      );
      for (const row of rows) {
        if (Number(row.seconds_ago) >= 86400) addMatch(row, "name_address");
      }
    }

    // ── 5. Name + PIN/City match (supporting) ──
    if (name.length >= 3 && (pinCode.length >= 4 || city.length >= 2)) {
      const normalizedName = normalizeName(name);
      let pinCityRows: any[] = [];

      if (pinCode.length >= 4) {
        const normalizedPin = normalizePinCode(pinCode);
        pinCityRows = await query(
          `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                  assigned_to, created_at, lead_classification,
                  EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
           FROM walkin_enquiries
           WHERE LOWER(TRIM(regexp_replace(name, '\\s+', ' ', 'g'))) = $1
             AND pin_code IS NOT NULL AND pin_code <> ''
             AND REPLACE(pin_code, ' ', '') = $2
             AND organization_id = $3
           ORDER BY created_at DESC
           LIMIT 5`,
          [normalizedName, normalizedPin, orgId]
        );
      } else if (city.length >= 2) {
        pinCityRows = await query(
          `SELECT id, name, phone, alt_phone, email, address, pin_code, city,
                  assigned_to, created_at, lead_classification,
                  EXTRACT(EPOCH FROM (NOW() - created_at)) AS seconds_ago
           FROM walkin_enquiries
           WHERE LOWER(TRIM(regexp_replace(name, '\\s+', ' ', 'g'))) = $1
             AND city IS NOT NULL AND city <> ''
             AND LOWER(TRIM(city)) = LOWER(TRIM($2))
             AND organization_id = $3
           ORDER BY created_at DESC
           LIMIT 5`,
          [normalizedName, city.trim().toLowerCase(), orgId]
        );
      }

      for (const row of pinCityRows) {
        if (Number(row.seconds_ago) >= 86400) addMatch(row, "name_pin_city");
      }
    }

    // ── No matches ──
    if (matchMap.size === 0) {
      return NextResponse.json({
        success: true,
        matched: false,
        candidates: [],
      });
    }

    // ── Build candidate list ──
    const actor = {
      _id: session._id ?? (session as any).id,
      name: session.name,
      role: session.role,
    };

    const allIds = Array.from(matchMap.keys());
    const depthMap = await batchGetVisitDepths(allIds, orgId);

    const candidates: MatchedCandidate[] = [];
    for (const [id, { row, reasons }] of matchMap) {
      const maskedPhone = await resolvePhone(
        actor,
        row,
        "LEAD_PHONE",
        orgId,
        row.phone
      );
      candidates.push({
        id,
        name: row.name,
        phone: maskedPhone,
        assigned_to: row.assigned_to ?? null,
        created_at: row.created_at,
        lead_classification: row.lead_classification,
        visitCount: depthMap.get(id) ?? 1,
        matchReasons: Array.from(reasons),
      });
    }

    // Sort: strong matches first (phone/email), then by recency.
    const strongReasons: MatchReason[] = [
      "primary_mobile",
      "alternate_mobile",
      "email",
      "name_address",
    ];
    candidates.sort((a, b) => {
      const aStrong = a.matchReasons.some((r) => strongReasons.includes(r));
      const bStrong = b.matchReasons.some((r) => strongReasons.includes(r));
      if (aStrong && !bStrong) return -1;
      if (!aStrong && bStrong) return 1;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });

    return NextResponse.json({
      success: true,
      matched: true,
      candidates,
    });
  } catch (error: any) {
    console.error("GET check-match Error:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
