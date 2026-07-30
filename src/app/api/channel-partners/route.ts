// api/channel-partners/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import {
  canViewPartners,
  canCreatePartners,
  canEditPartners,
  canSeePartnerCommercials,
  canViewAllPartners,
  normalizeCpPhone,
  normalizeRole,
} from "@/lib/cpRbac";
import {
  parseAssignee,
  isActiveSourcingManager,
  countActiveSourcingManagers,
} from "@/lib/sourcingAssignment";
import { notifyChannelPartnerRegistered } from "@/services/whatsapp.service";

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
// Filters:
//   status
//   needs_rate=true                 partners with no negotiated rate yet — the
//                                   working queue for the current data gap
//   assigned_sourcing_manager_id    a specific manager's partners, or the literal
//                                   "unassigned" for partners with no owner
//   assigned_to_me=true             shorthand for the signed-in user's own id
//
// Scoping: a Sourcing Manager only ever receives the partners assigned to them.
// Their own id is FORCED into the WHERE clause and any assignment filter they send
// is discarded — the same guarantee /api/cp-enquiries gives, and for the same
// reason: "a Sourcing Manager cannot see another manager's partners" is only real
// if the rows never leave the server. Every other role sees the full registry.
export async function GET(req: NextRequest) {
  const auth = await authorize(canViewPartners);
  if (!auth.ok) return auth.res;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const needsRate = searchParams.get("needs_rate");
    const assignedFilter = searchParams.get("assigned_sourcing_manager_id");
    const assignedToMe = searchParams.get("assigned_to_me") === "true";
    const scopedToSelf = !canViewAllPartners(auth.session.role);

    const where: string[] = [];
    const params: any[] = [];

    if (status) {
      params.push(status);
      where.push(`cp.status = $${params.length}`);
    }
    if (needsRate === "true") {
      where.push(`cp.default_commission_rate IS NULL`);
    }

    if (scopedToSelf || assignedToMe) {
      const selfId = Number(auth.session._id ?? auth.session.id);
      if (Number.isInteger(selfId)) {
        params.push(selfId);
        where.push(`cp.assigned_sourcing_manager_id = $${params.length}`);
      } else {
        // A session without a usable id would otherwise match every row via a NULL
        // comparison. An impossible predicate returns nothing, which is the safe
        // reading of "partners assigned to me" — and the only safe one when the
        // role is being scoped rather than merely filtered.
        where.push(`FALSE`);
      }
    } else if (assignedFilter === "unassigned") {
      where.push(`cp.assigned_sourcing_manager_id IS NULL`);
    } else if (assignedFilter) {
      params.push(Number(assignedFilter));
      where.push(`cp.assigned_sourcing_manager_id = $${params.length}`);
    }

    // cp.* carries the office-visit profile columns (office_address,
    // owner_contact_person, gst_number) added in the 2026-07-28 ALTER. They are
    // NULL for every partner auto-created from lead intake, so the UI renders
    // "—" rather than assuming they are populated.
    //
    // The assigned manager is joined rather than denormalized so a renamed or
    // deactivated employee is reflected everywhere at once.
    const rows = await query(
      `SELECT cp.*,
              sm.name            AS assigned_sourcing_manager_name,
              sm.username        AS assigned_sourcing_manager_username,
              sm.email           AS assigned_sourcing_manager_email,
              sm.whatsapp_number AS assigned_sourcing_manager_phone,
              sm.is_active       AS assigned_sourcing_manager_active,
              (SELECT COUNT(*) FROM walkin_enquiries w WHERE w.channel_partner_id = cp.id) AS lead_count,
              (SELECT COUNT(*) FROM booking_applications b WHERE b.sourced_by_channel_partner_id = cp.id) AS booking_count
         FROM channel_partners cp
         LEFT JOIN users sm ON sm.id = cp.assigned_sourcing_manager_id
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

    return NextResponse.json(
      { success: true, data, count: data.length, scopedToSelf },
      { status: 200 }
    );
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
// exists would split that partner's lead and booking attribution.
//
// A duplicate phone is therefore REFUSED (409 DUPLICATE_PHONE) rather than quietly
// merged. Merging silently was the old behaviour and it was invisible: the operator
// asked to create a partner, got a success, and no new row appeared.
//
// Topping up an existing record is still available — it is the backfill path for
// partners discovered from lead intake, who have a name and phone but none of the
// office-visit profile fields — but the caller must now ask for it explicitly with
// allow_merge, which the form only sends after the operator confirms the prompt.
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

    // Whether this request will create a partner or update an existing one is
    // decided by the phone number, and it changes what the request must carry — so
    // it is settled before validation rather than inside the transaction.
    const phoneKey = normalizeCpPhone(body.phone);
    const existingForPhone = phoneKey
      ? await query(
          `SELECT id FROM channel_partners
            WHERE right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
            LIMIT 1`,
          [phoneKey]
        )
      : [];
    const willUpdateExisting = existingForPhone.length > 0;

    // ── Sourcing Manager ownership ──────────────────────────────────────────
    // Required for the office-visit registration path (Receptionist and Sourcing
    // Manager, i.e. the roles without commercial visibility): a partner who walks
    // in must leave with an owner, otherwise they land in a registry nobody is
    // watching. Admin and Sales Manager may create without one — they are working
    // the commercial queue, not the front desk, and an Admin can assign later.
    //
    // Two exceptions:
    //   no Sourcing Manager accounts exist — a walk-in partner must never be turned
    //     away over an empty employee list; registration proceeds unassigned.
    //   the phone matches an existing partner — nothing is being created, and that
    //     partner already has whatever owner they have. Demanding one here would
    //     block the profile top-up that the "Profile Incomplete" backlog depends on.
    // A Sourcing Manager always registers onto their own book. Their own id is
    // substituted for whatever the body carried, rather than validated against it:
    // they cannot browse other managers' partners (canViewAllPartners excludes the
    // role) and reassignment is Admin-only, so letting a hand-rolled POST name a
    // different owner would be a way around both gates. Derived from the session
    // cookie, never the body.
    const selfIsSourcingManager = normalizeRole(auth.session.role) === "sourcing manager";
    const selfId = Number(auth.session._id ?? auth.session.id);
    const assignee =
      selfIsSourcingManager && Number.isInteger(selfId)
        ? ({ kind: "id", id: selfId } as const)
        : parseAssignee(body.assigned_sourcing_manager_id);
    if (assignee.kind === "invalid") {
      return NextResponse.json(
        {
          success: false,
          message: "assigned_sourcing_manager_id must be a Sourcing Manager's user id.",
          code: "INVALID_SOURCING_MANAGER",
        },
        { status: 400 }
      );
    }
    if (assignee.kind === "id" && !(await isActiveSourcingManager(assignee.id))) {
      return NextResponse.json(
        {
          success: false,
          message: "Selected user is not an active Sourcing Manager.",
          code: "INVALID_SOURCING_MANAGER",
        },
        { status: 400 }
      );
    }
    if (assignee.kind !== "id" && !canSetCommercials && !willUpdateExisting) {
      if ((await countActiveSourcingManagers()) > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Assign a Sourcing Manager before registering this channel partner.",
            code: "SOURCING_MANAGER_REQUIRED",
          },
          { status: 400 }
        );
      }
    }
    const assignedSourcingManagerId = assignee.kind === "id" ? assignee.id : null;

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

    // Recomputed from the trimmed profile value; identical to phoneKey above, and
    // re-derived here so the transaction does not depend on the pre-check's timing.
    const normalizedPhone = normalizeCpPhone(profile.phone);
    // Opt-in to updating an existing partner instead of being refused. Only ever
    // sent after the operator has seen the duplicate warning and confirmed it.
    const allowMerge = body.allow_merge === true;

    const result = await transaction(async (client) => {
      // ── Dedup branch: an existing partner on this phone number ──
      // Runs inside the transaction so a concurrent registration of the same
      // phone can't slip between the SELECT and the write.
      if (normalizedPhone) {
        const hit = await client.query(
          `SELECT id, name, assigned_sourcing_manager_id FROM channel_partners
            WHERE right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
            ORDER BY id ASC
            LIMIT 1`,
          [normalizedPhone]
        );

        if (hit.rows.length > 0) {
          const existing = hit.rows[0];

          // Refused unless the caller explicitly opted in. Thrown as a sentinel and
          // caught outside the transaction so the whole thing rolls back cleanly.
          if (!allowMerge) {
            const err: any = new Error("DUPLICATE_PHONE");
            err.duplicate = existing;
            throw err;
          }
          // COALESCE(NULLIF(...)) means blank fields on the form leave stored
          // values alone — a partial office-visit entry tops the record up
          // rather than blanking whatever was already on file.
          //
          // `name` is deliberately NOT updated: normalizePartnerName's contract
          // is that a stored display name keeps the casing and punctuation it
          // was first created with, and the name expression index is built on it.
          //
          // The assignment follows the same "top up, never overwrite" rule via
          // COALESCE on the *stored* value: a partner who already has an owner
          // keeps them. Re-registering an existing partner is a profile update,
          // and it must not silently move them to whoever the operator happened
          // to pick this time — reassignment is an explicit Admin action.
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
               assigned_sourcing_manager_id =
                 COALESCE(assigned_sourcing_manager_id, $10::int),
               assigned_sourcing_manager_at =
                 CASE WHEN assigned_sourcing_manager_id IS NULL AND $10::int IS NOT NULL
                      THEN now() ELSE assigned_sourcing_manager_at END,
               assigned_sourcing_manager_by =
                 CASE WHEN assigned_sourcing_manager_id IS NULL AND $10::int IS NOT NULL
                      THEN $11 ELSE assigned_sourcing_manager_by END,
               updated_by           = $11
             WHERE id = $12
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
              assignedSourcingManagerId,
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
            bank_account_details, default_commission_rate, status, created_by, updated_by,
            assigned_sourcing_manager_id, assigned_sourcing_manager_at, assigned_sourcing_manager_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14, 'active'), $15, $15,
                 $16,
                 CASE WHEN $16::int IS NULL THEN NULL ELSE now() END,
                 -- Cast needed: $15 is otherwise inferred from the NULL branch here
                 -- and conflicts with its varchar use as created_by/updated_by.
                 CASE WHEN $16::int IS NULL THEN NULL ELSE $15::varchar END)
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
          assignedSourcingManagerId,
        ]
      );
      return { merged: false, matchedName: null, row: ins.rows[0] };
    });

    // ── WhatsApp: tell the assigned Sourcing Manager ─────────────────────────
    // NEW REGISTRATIONS ONLY. A merge is deliberately excluded: the merged row
    // can belong to a DIFFERENT Sourcing Manager (see keptDifferentOwner just
    // below), and its profile is redacted for out-of-scope callers a few lines
    // further down (outOfScope). Notifying on a merge would page the wrong
    // manager with precisely the fields this route refuses to return.
    //
    // Not additionally gated on assigned_sourcing_manager_id: an unassigned new
    // partner records a skipped/NO_ASSIGNEE row, which is a visible "nobody is
    // watching this partner" signal on the admin feed rather than silence.
    //
    // Fires after COMMIT and is never awaited — a Meta outage, a missing token
    // or a dropped connection must not turn a successful registration into a 500.
    if (!result.merged) {
      notifyChannelPartnerRegistered({ partner: result.row, registeredBy: actor });
    }

    // A merge that kept a different owner is worth saying out loud: the operator
    // picked a Sourcing Manager and the saved record shows someone else, which
    // reads as a bug unless the reason is stated.
    const keptDifferentOwner =
      result.merged &&
      assignedSourcingManagerId !== null &&
      Number(result.row?.assigned_sourcing_manager_id) !== assignedSourcingManagerId;

    let message: string;
    if (!result.merged) {
      message = "Channel partner registered.";
    } else {
      message = `This phone number already belonged to "${result.matchedName}". Their profile has been updated instead of creating a duplicate.`;
      if (keptDifferentOwner) {
        message += " They already have an assigned Sourcing Manager, which has been left unchanged — an Admin can reassign them.";
      }
    }

    // A merge can return a partner the caller is not otherwise allowed to see: a
    // Sourcing Manager registering an office visit whose phone already belongs to
    // another manager's partner. The dedup notice itself has to stand — otherwise
    // they would keep trying and a duplicate would eventually be created — but the
    // full profile must not ride along with it.
    const outOfScope =
      result.merged &&
      !canViewAllPartners(auth.session.role) &&
      String(result.row?.assigned_sourcing_manager_id ?? "") !==
        String(auth.session._id ?? auth.session.id ?? "");

    const data = outOfScope
      ? { id: result.row.id, name: result.row.name, assigned_to_another_manager: true }
      : result.row;

    return NextResponse.json(
      {
        success: true,
        merged: result.merged,
        assignmentKept: keptDifferentOwner,
        message: outOfScope
          ? `This phone number already belongs to a registered Channel Partner assigned to another Sourcing Manager. Their profile has been updated instead of creating a duplicate.`
          : message,
        data,
      },
      { status: result.merged ? 200 : 201 }
    );
  } catch (err: any) {
    if (err?.message === "DUPLICATE_PHONE" && err.duplicate) {
      const dup = err.duplicate;
      const selfId = String(auth.session._id ?? auth.session.id ?? "");
      // The partner's name is disclosed only to someone entitled to see that
      // partner. Everyone else is told the number is taken and nothing more —
      // enough to stop them retrying, without naming another manager's partner.
      const canSeeIt =
        canViewAllPartners(auth.session.role) ||
        String(dup.assigned_sourcing_manager_id ?? "") === selfId;

      return NextResponse.json(
        {
          success: false,
          code: "DUPLICATE_PHONE",
          message: canSeeIt
            ? `This phone number is already registered to "${dup.name}".`
            : "This phone number is already registered to a Channel Partner assigned to another Sourcing Manager.",
          // The form uses these to offer "update that partner instead" rather than
          // leaving the operator at a dead end.
          duplicate: canSeeIt ? { id: dup.id, name: dup.name } : null,
          canMerge: canSeeIt,
        },
        { status: 409 }
      );
    }
    console.error("[POST /api/channel-partners]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
