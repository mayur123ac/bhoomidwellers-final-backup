// api/channel-partners/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import {
  canViewPartners,
  canCreatePartners,
  canEditPartners,
  canSeePartnerCommercials,
  normalizeCpPhone,
} from "@/lib/cpRbac";

export const dynamic = "force-dynamic";

/**
 * Back-compat alias. The original gate was a single admin/sales-manager check
 * called `canManagePartners`; it is now `canEditPartners` in @/lib/cpRbac, which
 * splits view/create/edit/delete so the office-visit flow can widen create only.
 */
export const canManagePartners = canEditPartners;

/**
 * Authoritative role, read from the httpOnly `crm_session` cookie rather than
 * `body.user_role`. The body value is client-supplied — for an admin-only DELETE
 * or a rate change that drives payouts it is not a control at all, it is a hint.
 */
async function authorize(check: (role: any) => boolean) {
  const session = await getServerSession();
  if (!session?.role) {
    return { ok: false as const, res: NextResponse.json(
      { success: false, message: "Not signed in.", code: "UNAUTHORIZED" }, { status: 401 }) };
  }
  if (!check(session.role)) {
    return { ok: false as const, res: NextResponse.json(
      { success: false, message: "Your role cannot perform this action.", code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

// ─── GET — list partners ──────────────────────────────────────────────────
// Filters: status, needs_rate=true (partners with no negotiated rate yet — the
// working queue for the current data gap, where most partners were discovered
// from lead intake and have never had a rate captured).
export async function GET(req: NextRequest) {
  const auth = await authorize(canViewPartners);
  if (!auth.ok) return auth.res;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const needsRate = searchParams.get("needs_rate");

    const where: string[] = [];
    const params: any[] = [];

    if (status) {
      params.push(status);
      where.push(`cp.status = $${params.length}`);
    }
    if (needsRate === "true") {
      where.push(`cp.default_commission_rate IS NULL`);
    }

    // cp.* carries the office-visit profile columns (office_address,
    // owner_contact_person, gst_number) added in the 2026-07-28 ALTER. They are
    // NULL for every partner auto-created from lead intake, so the UI renders
    // "—" rather than assuming they are populated.
    const rows = await query(
      `SELECT cp.*,
              (SELECT COUNT(*) FROM walkin_enquiries w WHERE w.channel_partner_id = cp.id) AS lead_count,
              (SELECT COUNT(*) FROM booking_applications b WHERE b.sourced_by_channel_partner_id = cp.id) AS booking_count
         FROM channel_partners cp
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY cp.name ASC`,
      params
    );

    // Roles without commercial visibility never receive the rate over the wire,
    // so hiding the column in the UI isn't the only thing protecting it.
    const canSeeRate = canSeePartnerCommercials(auth.session.role);
    const data = canSeeRate
      ? rows
      : rows.map(({ default_commission_rate, bank_account_details, ...rest }: any) => rest);

    return NextResponse.json({ success: true, data, count: data.length }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/channel-partners]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create a partner (manual add, or office-visit registration) ────
//
// default_commission_rate is optional: a partner can exist before their
// commercial terms are agreed. computeCPCommission rejects until it is set.
//
// Phone dedup: channel_partners.id is the single source of truth that the
// commission engine reads from, so a second row for a phone number that already
// exists would split that partner's lead and booking attribution. When the
// normalized phone matches, this UPDATEs the existing row instead — which is
// also the backfill path for the partners discovered from lead intake, who have
// a name and phone but none of the office-visit profile fields.
export async function POST(req: NextRequest) {
  const auth = await authorize(canCreatePartners);
  if (!auth.ok) return auth.res;

  try {
    const body = await req.json();
    const actor = (auth.session.name || "system").toString();
    const canSetCommercials = canSeePartnerCommercials(auth.session.role);

    const name = (body.name || "").toString().trim();
    if (!name) {
      return NextResponse.json(
        { success: false, message: "CP name is required." },
        { status: 400 }
      );
    }

    // Receptionist / Sourcing Manager cannot set commercial terms even by
    // crafting the request — these are silently dropped rather than rejected,
    // because their form never offers the fields in the first place.
    const rate = canSetCommercials ? body.default_commission_rate : undefined;
    if (rate !== undefined && rate !== null && rate !== "") {
      const n = Number(rate);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        return NextResponse.json(
          { success: false, message: "default_commission_rate must be between 0 and 100." },
          { status: 400 }
        );
      }
    }

    const profile = {
      company_name: (body.company_name || "").toString().trim() || null,
      rera_registration_no: (body.rera_registration_no || "").toString().trim() || null,
      pan_number: (body.pan_number || "").toString().trim() || null,
      phone: (body.phone || "").toString().trim() || null,
      email: (body.email || "").toString().trim() || null,
      office_address: (body.office_address || "").toString().trim() || null,
      // Area the partner operates in — join keys for future CP-to-enquiry matching
      // against walkin_enquiries.pin_code / .city.
      pin_code: (body.pin_code || "").toString().replace(/\D/g, "").slice(0, 6) || null,
      city: (body.city || "").toString().trim() || null,
      owner_contact_person: (body.owner_contact_person || "").toString().trim() || null,
      // Trimmed but otherwise stored as typed — no casing or format normalization.
      gst_number: (body.gst_number || "").toString().trim() || null,
    };

    const normalizedPhone = normalizeCpPhone(profile.phone);

    const result = await transaction(async (client) => {
      // ── Dedup branch: an existing partner on this phone number ──
      // Runs inside the transaction so a concurrent registration of the same
      // phone can't slip between the SELECT and the write.
      if (normalizedPhone) {
        const hit = await client.query(
          `SELECT id, name FROM channel_partners
            WHERE right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
            ORDER BY id ASC
            LIMIT 1`,
          [normalizedPhone]
        );

        if (hit.rows.length > 0) {
          const existing = hit.rows[0];
          // COALESCE(NULLIF(...)) means blank fields on the form leave stored
          // values alone — a partial office-visit entry tops the record up
          // rather than blanking whatever was already on file.
          //
          // `name` is deliberately NOT updated: normalizePartnerName's contract
          // is that a stored display name keeps the casing and punctuation it
          // was first created with, and the name expression index is built on it.
          const upd = await client.query(
            `UPDATE channel_partners SET
               company_name         = COALESCE(NULLIF($1, ''), company_name),
               rera_registration_no = COALESCE(NULLIF($2, ''), rera_registration_no),
               pan_number           = COALESCE(NULLIF($3, ''), pan_number),
               email                = COALESCE(NULLIF($4, ''), email),
               office_address       = COALESCE(NULLIF($5, ''), office_address),
               owner_contact_person = COALESCE(NULLIF($6, ''), owner_contact_person),
               gst_number           = COALESCE(NULLIF($7, ''), gst_number),
               pin_code             = COALESCE(NULLIF($8, ''), pin_code),
               city                 = COALESCE(NULLIF($9, ''), city),
               updated_by           = $10
             WHERE id = $11
             RETURNING *`,
            [
              profile.company_name ?? "",
              profile.rera_registration_no ?? "",
              profile.pan_number ?? "",
              profile.email ?? "",
              profile.office_address ?? "",
              profile.owner_contact_person ?? "",
              profile.gst_number ?? "",
              profile.pin_code ?? "",
              profile.city ?? "",
              actor,
              existing.id,
            ]
          );
          return { merged: true, matchedName: existing.name, row: upd.rows[0] };
        }
      }

      // ── Create branch ──
      const ins = await client.query(
        `INSERT INTO channel_partners
           (name, company_name, rera_registration_no, pan_number, phone, email,
            office_address, owner_contact_person, gst_number, pin_code, city,
            bank_account_details, default_commission_rate, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, 'active'), $15, $15)
         RETURNING *`,
        [
          name,
          profile.company_name,
          profile.rera_registration_no,
          profile.pan_number,
          profile.phone,
          profile.email,
          profile.office_address,
          profile.owner_contact_person,
          profile.gst_number,
          profile.pin_code,
          profile.city,
          canSetCommercials && body.bank_account_details ? JSON.stringify(body.bank_account_details) : null,
          rate === undefined || rate === null || rate === "" ? null : Number(rate),
          canSetCommercials ? body.status || null : null,
          actor,
        ]
      );
      return { merged: false, matchedName: null, row: ins.rows[0] };
    });

    return NextResponse.json(
      {
        success: true,
        merged: result.merged,
        message: result.merged
          ? `This phone number already belonged to "${result.matchedName}". Their profile has been updated instead of creating a duplicate.`
          : "Channel partner registered.",
        data: result.row,
      },
      { status: result.merged ? 200 : 201 }
    );
  } catch (err: any) {
    console.error("[POST /api/channel-partners]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
