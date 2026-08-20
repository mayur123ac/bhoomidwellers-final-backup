// app/api/settings/profile/route.ts — the signed-in user's own profile.
//
// Scoped to the caller by construction: the user id comes from the verified
// session cookie and is never read from the request body, so there is no
// parameter to tamper with in order to edit somebody else's profile. Editing
// OTHER people is a separate, admin-gated route (/api/settings/employees).

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { diffFields, requestContext, writeAuditLog } from "@/lib/auditLog";
import {
  joinName,
  loadSettingsUser,
  serializeSettingsUser,
} from "@/lib/settingsUser";
import { describePropagation, propagateUserRename } from "@/lib/renameUserReferences";
import {
  APP_TIMEZONE,
  TIMEZONE_LOCKED,
  isAllowedTimezone,
  isValidWeekStartDay,
} from "@/lib/timePreferences";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  // (no organization-scoped query remains in this handler: name and email are
  //  platform-wide login identifiers — decision 2026-08-19)
  if (!gate.userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user id." },
      { status: 400 }
    );
  }

  const row = await loadSettingsUser(gate.userId);
  if (!row) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, user: serializeSettingsUser(row) });
}

/**
 * Valid IANA zone check via the Intl API — no timezone table to maintain, and it
 * agrees with whatever the runtime will actually use to format dates.
 *
 * Still used as the second gate below: while TIMEZONE_LOCKED holds, the
 * allow-list is the binding constraint and this only matters if that lock is
 * ever lifted.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user id." },
      { status: 400 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const before = await loadSettingsUser(gate.userId);
  if (!before) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  const updates: Record<string, any> = {};

  // ── Name ──
  // Email is NOT accepted here. Changing it goes through the OTP flow in
  // /api/settings/email-change; allowing a plain PATCH would make that flow
  // decorative.
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const firstName = String(body.firstName ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();

    if (!firstName) {
      return NextResponse.json(
        { success: false, message: "First name is required." },
        { status: 400 }
      );
    }
    if (firstName.length > 50 || lastName.length > 50) {
      return NextResponse.json(
        { success: false, message: "Names are limited to 50 characters each." },
        { status: 400 }
      );
    }

    const nextName = joinName(firstName, lastName);

    // users.name doubles as a login identifier (the login route matches
    // LOWER(name) as well as LOWER(email)), so a collision would make two
    // accounts indistinguishable at sign-in.
    const clash = await query<{ id: number }>(
      // Name is also a LOGIN IDENTIFIER (login matches LOWER(u.name)), so its
      // uniqueness must be platform-wide for the same reason email is: a
      // per-organization check would let two organizations hold the same name and
      // make the login lookup ambiguous.
      `SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`,
      [nextName, gate.userId]
    );
    if (clash.length > 0) {
      return NextResponse.json(
        { success: false, message: "Another account already uses that name." },
        { status: 409 }
      );
    }

    updates.name = nextName;
  }

  // ── Phone ──
  if (body.phone !== undefined) {
    const phone = String(body.phone ?? "").trim();
    if (phone && !/^[+\d][\d\s-]{6,19}$/.test(phone)) {
      return NextResponse.json(
        { success: false, message: "Enter a valid phone number." },
        { status: 400 }
      );
    }
    updates.phone = phone || null;
  }

  // ── WhatsApp number ──
  // Carried over from the previous Settings page, which had its own card and its
  // own endpoint (/api/users/update-whatsapp). That route still exists for its
  // other callers; this just folds the field into the one profile save so there
  // is a single Save button rather than two that look alike.
  if (body.whatsappNumber !== undefined) {
    const whatsapp = String(body.whatsappNumber ?? "").trim();
    // Country code, no plus — the format the WhatsApp logging code expects.
    if (whatsapp && !/^\d{10,15}$/.test(whatsapp)) {
      return NextResponse.json(
        {
          success: false,
          message: "Enter digits only, including country code and no + sign (e.g. 919876543210).",
        },
        { status: 400 }
      );
    }
    updates.whatsapp_number = whatsapp || null;
  }

  // ── Time preferences ──
  if (body.timezone !== undefined) {
    const tz = String(body.timezone ?? "").trim();
    if (!isValidTimezone(tz)) {
      return NextResponse.json(
        { success: false, message: `"${tz}" is not a recognised timezone.` },
        { status: 400 }
      );
    }
    // The UI locks this field, but the endpoint is reachable directly and the
    // rest of the CRM formats everything in APP_TIMEZONE. Accepting some other
    // zone here would store a preference nothing honours — the exact problem
    // the lock exists to remove. See lib/timePreferences.ts.
    if (TIMEZONE_LOCKED && !isAllowedTimezone(tz)) {
      return NextResponse.json(
        {
          success: false,
          message: `This workspace operates in ${APP_TIMEZONE} and the timezone cannot be changed.`,
        },
        { status: 400 }
      );
    }
    updates.timezone = tz;
  }

  if (body.weekStartDay !== undefined) {
    const day = Number(body.weekStartDay);
    // Only the three the spec offers: Sunday, Monday, Saturday.
    if (!isValidWeekStartDay(day)) {
      return NextResponse.json(
        { success: false, message: "Week can start on Sunday, Monday or Saturday." },
        { status: 400 }
      );
    }
    updates.week_start_day = day;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { success: false, message: "Nothing to update." },
      { status: 400 }
    );
  }

  // Only write columns whose value actually differs, per the spec's "save only
  // changed fields" — and so the audit entry lists real changes.
  const { old, next, changed } = diffFields(before as any, updates);
  if (changed.length === 0) {
    return NextResponse.json({
      success: true,
      user: serializeSettingsUser(before),
      message: "No changes to save.",
    });
  }

  const setClauses = changed.map((col, i) => `${col} = $${i + 1}`);
  const values = changed.map((col) => updates[col]);
  values.push(gate.userId);

  await query(
    `UPDATE users SET ${setClauses.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length}`,
    values
  );

  // Lead ownership is keyed on users.name, not users.id, so a rename has to
  // carry the assignments with it or the user's leads disappear from their own
  // dashboard. See lib/renameUserReferences.ts.
  const moved = updates.name
    ? await propagateUserRename(before.name, updates.name)
    : [];

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: before.name,
    action: "profile.update",
    entityType: "user",
    entityId: gate.userId,
    oldValue: old,
    newValue: moved.length > 0 ? { ...next, reassigned: moved } : next,
    ipAddress: ip,
    userAgent,
  });

  const after = await loadSettingsUser(gate.userId);
  const propagationNote = describePropagation(moved);

  return NextResponse.json({
    success: true,
    user: after ? serializeSettingsUser(after) : null,
    message: propagationNote
      ? `Profile updated successfully. ${propagationNote}`
      : "Profile updated successfully",
  });
}
