// api/platform/account/password/route.ts — change the platform account's password.
//
// Same identity rule as the email route: the account changed is the one in the
// session, never one named in the body.
//
// ── Why this also logs everyone out ─────────────────────────────────────────
// `password_changed_at` is set in the same statement as the new hash. Sessions
// are stateless signed cookies carrying an `iat`, and lib/superAdmin.ts refuses
// any whose `iat` predates `password_changed_at` — so committing this UPDATE
// revokes every session issued under the old password, including the caller's.
// That is the intended behaviour: the caller must sign in again, and so must
// anyone else holding a copy of the old session.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { verifyPassword, hashPassword, passwordMeetsRules } from "@/lib/passwords";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const currentPassword = (body?.currentPassword ?? "").toString();
    const newPassword = (body?.newPassword ?? "").toString();
    const confirmPassword = (body?.confirmPassword ?? "").toString();

    if (!currentPassword) return bad("Your current password is required.");
    if (!newPassword) return bad("A new password is required.");
    if (newPassword !== confirmPassword) return bad("New passwords do not match.");
    if (!passwordMeetsRules(newPassword)) {
      return bad("Password must be at least 8 characters and include upper case, lower case, a number and a symbol.");
    }
    if (newPassword === currentPassword) {
      return bad("The new password must be different from the current one.");
    }

    const secret = await query<{ password: string }>(
      "SELECT password FROM users WHERE id = $1 LIMIT 1",
      [gate.admin.id]
    );
    if (secret.length === 0) return bad("Account not found.", 404);
    if (!(await verifyPassword(currentPassword, secret[0].password))) {
      return bad("Current password is incorrect.", 401);
    }

    // scrypt, via the project's own helper — the same format the login route
    // verifies and the seed script writes. Nothing here ever stores, logs or
    // returns the plaintext.
    const hashed = await hashPassword(newPassword);

    const updated = await query<{ id: number; role: string; organization_id: string | null }>(
      `UPDATE users
          SET password = $2,
              password_changed_at = now(),
              updated_at = now()
        WHERE id = $1
          AND organization_id IS NULL
          AND deleted_at IS NULL
          AND lower(btrim(replace(role, '_', ' '))) = 'super admin'
      RETURNING id, role, organization_id`,
      [gate.admin.id, hashed]
    );
    if (updated.length === 0) return bad("Could not update the account.", 409);

    // The caller's own cookie is now stale by the rule above. Clearing it here
    // means the browser is not left holding a token every request will reject.
    const res = NextResponse.json(
      {
        success: true,
        message: "Password updated. All sessions have been signed out.",
        data: {
          sessionsRevoked: true,
          role: updated[0].role,
          organizationId: updated[0].organization_id,
        },
      },
      { status: 200 }
    );
    res.cookies.set({
      name: "crm_session",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err: any) {
    // Generic message, detail to the log, and never the password: an error
    // string from the driver can echo parameter values.
    console.error("[POST /api/platform/account/password]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not update the password." },
      { status: 500 }
    );
  }
}
