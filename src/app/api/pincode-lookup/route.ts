// api/pincode-lookup/route.ts
//
// "What city is this pincode, and which Sourcing Manager covers it?"
//
// One request answers both, because the Channel Partner form asks both questions
// at the same moment — the operator types 400097 and expects City to fill in and
// the manager to be picked. Two endpoints would mean two round trips for one
// keystroke.
//
// Everything here is best-effort. A pincode with no row in `pincodes` returns
// city: null; one with no territory owner returns sourcingManager: null. Neither
// is an error and neither blocks the form — the operator just types it themselves.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { canCreatePartners } from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

/**
 * Public India Post mirror, used only when the local table has never seen a
 * pincode. The answer is then written into `pincodes`, so each one costs at most
 * a single outbound call in its lifetime and the table fills itself with exactly
 * the areas this business touches — no 19,000-row import to maintain, and nothing
 * to re-seed on another database.
 *
 * Deliberately best-effort: a 3s timeout, every failure swallowed. If this service
 * is slow or down the form simply doesn't autofill and the operator types the city,
 * which is what happened before any of this existed. It is never on the path of a
 * save. Set CP_PINCODE_API_DISABLED=1 to switch the fallback off entirely.
 */
const PINCODE_API = "https://api.postalpincode.in/pincode/";
const API_TIMEOUT_MS = 3000;

async function fetchFromIndiaPost(
  pincode: string
): Promise<{ city: string; district: string | null; state: string | null } | null> {
  if (process.env.CP_PINCODE_API_DISABLED === "1") return null;
  try {
    const res = await fetch(PINCODE_API + pincode, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : null;
    if (entry?.Status !== "Success" || !entry?.PostOffice?.length) return null;

    const po = entry.PostOffice[0];
    // District, not Region: Region is the postal circle, which reads "Mumbai" for
    // Thane pincodes. District is right in the common case — and because the row
    // is cached locally, a wrong one (110001 → "Central Delhi") can be corrected
    // once in the table and stays corrected.
    const city = (po.District || po.Region || "").toString().trim();
    if (!city) return null;
    return {
      city,
      district: po.District ? String(po.District).trim() : null,
      state: po.State ? String(po.State).trim() : null,
    };
  } catch {
    return null; // timeout, DNS, rate limit, malformed body — all the same here
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  // Same gate as the duplicate-phone check: whoever can register a partner needs
  // this, Receptionist and Sourcing Manager included.
  if (!canCreatePartners(session.role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot look up pincodes." },
      { status: 403 }
    );
  }

  const pincode = (req.nextUrl.searchParams.get("pincode") || "").replace(/\D/g, "");
  // Indian pincodes are exactly 6 digits. Anything shorter is still being typed —
  // answering "no match" would clear the city on every keystroke.
  if (pincode.length !== 6) {
    return NextResponse.json(
      { success: true, incomplete: true, pincode: null, city: null, state: null, sourcingManager: null },
      { status: 200 }
    );
  }

  try {
    const rows = await query(
      `SELECT p.city, p.state,
              sm.id   AS sm_id,
              sm.name AS sm_name
         FROM (SELECT $1::varchar AS pin) k
         LEFT JOIN pincodes p ON p.pincode = k.pin
         LEFT JOIN sourcing_manager_pincodes smp ON smp.pincode = k.pin
         -- The territory row is only honoured while it still points at an active
         -- Sourcing Manager. A stale row (role changed, account deactivated) is
         -- ignored rather than assigning the partner somewhere invisible.
         LEFT JOIN users sm
                ON sm.id = smp.user_id
               AND sm.is_active = true
               AND REPLACE(LOWER(TRIM(sm.role)), '_', ' ') = 'sourcing manager'`,
      [pincode]
    );

    const r = rows[0] || {};
    let city: string | null = r.city ?? null;
    let state: string | null = r.state ?? null;
    let source: "local" | "india-post" | null = city ? "local" : null;

    // Local miss → ask India Post once, then remember the answer. The territory
    // lookup above is unaffected either way; only the city is being resolved here.
    if (!city) {
      const remote = await fetchFromIndiaPost(pincode);
      if (remote) {
        city = remote.city;
        state = remote.state;
        source = "india-post";
        // ON CONFLICT DO NOTHING, not DO UPDATE: a row that already exists was
        // either cached earlier or corrected by hand, and a hand correction must
        // never be overwritten by the upstream value it was fixing.
        await query(
          `INSERT INTO pincodes (pincode, city, district, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (pincode) DO NOTHING`,
          [pincode, remote.city, remote.district, remote.state]
        ).catch(() => { /* caching is not worth failing the lookup over */ });
      }
    }

    return NextResponse.json(
      {
        success: true,
        pincode,
        city,
        state,
        source,
        sourcingManager: r.sm_id ? { id: r.sm_id, name: r.sm_name } : null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/pincode-lookup]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
