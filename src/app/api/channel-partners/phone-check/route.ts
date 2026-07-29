// api/channel-partners/phone-check/route.ts
//
// "Is this phone number already taken by a Channel Partner?" — asked by the
// registration form while the number is still being typed, so a duplicate is a red
// error on the field rather than a surprise after saving.
//
// Separate from /lookup, which answers a richer question (who owns this partner,
// how many leads have they brought) and is therefore limited to roles that can see
// the whole registry. This one has to be callable by everyone who can register a
// partner — Receptionist and Sourcing Manager included — so it returns the bare
// minimum: whether the number is taken, and a name only when the caller is
// entitled to see that partner anyway.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { canCreatePartners, canViewAllPartners, normalizeCpPhone } from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!canCreatePartners(session.role)) {
    return NextResponse.json(
      { success: false, message: "Your role cannot register channel partners." },
      { status: 403 }
    );
  }

  const phone = normalizeCpPhone(req.nextUrl.searchParams.get("phone"));
  // Editing a partner must not flag that partner's own number as a duplicate.
  const excludeIdRaw = Number(req.nextUrl.searchParams.get("exclude_id"));
  const excludeId = Number.isInteger(excludeIdRaw) ? excludeIdRaw : null;

  // Fewer than 10 digits is a half-typed number, not a free one — answering
  // "available" here would clear the error on every keystroke of a number that is
  // in fact taken.
  if (!phone) {
    return NextResponse.json(
      { success: true, exists: false, incomplete: true, partner: null },
      { status: 200 }
    );
  }

  try {
    const rows = await query(
      `SELECT cp.id, cp.name, cp.company_name, cp.status,
              cp.assigned_sourcing_manager_id,
              sm.name AS assigned_sourcing_manager_name
         FROM channel_partners cp
         LEFT JOIN users sm ON sm.id = cp.assigned_sourcing_manager_id
        WHERE right(regexp_replace(COALESCE(cp.phone, ''), '\\D', '', 'g'), 10) = $1
          AND ($2::int IS NULL OR cp.id <> $2::int)
        ORDER BY cp.id ASC
        LIMIT 1`,
      [phone, excludeId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: true, exists: false, partner: null }, { status: 200 });
    }

    const hit = rows[0];
    const selfId = String(session._id ?? session.id ?? "");
    const mine = String(hit.assigned_sourcing_manager_id ?? "") === selfId;
    const canSeeIt = canViewAllPartners(session.role) || mine;

    return NextResponse.json(
      {
        success: true,
        exists: true,
        // Owned by someone else and the caller cannot see the registry: they still
        // need to know the number is taken — otherwise they retry forever — but not
        // who holds it. Mirrors what POST already discloses in the same situation.
        ownedByOther: !canSeeIt,
        partner: canSeeIt
          ? {
              id: hit.id,
              name: hit.name,
              company_name: hit.company_name,
              status: hit.status,
              assigned_sourcing_manager_name: hit.assigned_sourcing_manager_name,
            }
          : null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/channel-partners/phone-check]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
