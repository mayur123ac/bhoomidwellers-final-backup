// src/app/api/auth/logout/route.ts
//
// ── Why this does not call getOrganizationId() ──────────────────────────────
// It used to, and that broke the moment a second organization was created
// (2026-08-21). getOrganizationId() answers from the session's `org` claim, and
// falls back to "the only organization that exists" when there is none — a
// fallback that deliberately THROWS once more than one exists rather than guess.
//
// Two kinds of caller reach this route without a usable claim:
//
//   * a PLATFORM account (Super Admin). It has `organization_id IS NULL` by
//     definition — that is what makes it platform level — so there is no claim
//     to read and no tenant to resolve. Not a degenerate case: the correct
//     answer is "no organization", which resolveSoleOrganization() cannot
//     express.
//   * any session minted before MT-05 stamped the claim.
//
// For both, the throw was swallowed by the catch below, the cookie was still
// cleared, and logout LOOKED fine — while the `employee_sessions` row stayed
// open forever. Fourteen abandoned Super Admin sessions had accumulated by
// 2026-08-24, one per sign-out, each still reading `is_active = true`.
//
// So the organization is read from the user's OWN ROW instead. That is the
// authoritative answer for every caller, it cannot throw, and it returns NULL
// for a platform account rather than refusing to answer.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession, getSessionUserId } from "@/lib/serverAuth";
import { broadcastEvent } from "@/lib/eventBus";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    // Read through the helper rather than `session._id`: the claim is stored
    // stringified and only this helper knows both shapes.
    const userId = session ? getSessionUserId(session) : null;

    if (userId != null) {
      const now = new Date();

      const rows = await query<{ organization_id: string | null }>(
        "SELECT organization_id FROM users WHERE id = $1 LIMIT 1",
        [userId]
      );
      const orgId = rows[0]?.organization_id ?? null;

      // `IS NOT DISTINCT FROM` rather than `=`, because a platform account's
      // session rows carry organization_id NULL (the login INSERT inherits it
      // from the user), and `NULL = NULL` is NULL, not true — so the old
      // predicate could never have matched those rows even without the throw
      // above. This form matches NULL to NULL and a UUID to that same UUID,
      // so the tenant scoping is still real: one tenant's logout cannot close
      // another tenant's rows.
      await query(
        `UPDATE employee_sessions
            SET session_end = $1, is_active = false
          WHERE user_id = $2
            AND is_active = true
            AND organization_id IS NOT DISTINCT FROM $3`,
        [now, userId, orgId]
      );

      // Same push used by the mark route: without it, Admin/Site Head's Live
      // Activity tracker keeps showing this user's timer ticking (and status
      // ACTIVE) until they next reload the page.
      //
      // Skipped for a platform account: it belongs to no tenant, so there is no
      // organization whose admins should be told, and broadcastEvent has no
      // cross-tenant mode by design.
      if (orgId) {
        broadcastEvent(orgId, { type: "ATTENDANCE_SYNC", userId }, ["admin", "site_head"]);
        broadcastToOrg(orgId, "activity.attendance_sync", { type: "ATTENDANCE_SYNC", userId });
      }

      // MT-03: the `UPDATE employee_attendance` that used to sit here has been
      // removed. Attendance moved to `attendance_records` (see api/attendance/*),
      // and nothing in the application ever INSERTed into employee_attendance —
      // so this statement matched zero rows on every logout since the migration,
      // failing silently inside the catch below. The table is slated for DROP.
      // Logout time is derived from employee_sessions.session_end.
    }
  } catch (err) {
    // Still non-fatal: a failure here must not stop the cookie being cleared,
    // because a user who clicks Sign Out must end up signed out either way.
    console.error("Logout DB update error:", err);
  }

  const response = NextResponse.json(
    { message: "Logout successful" },
    { status: 200 }
  );

  // Clear the auth cookie
  response.cookies.set({
    name: "crm_session",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0), // Expire immediately
  });

  return response;
}
