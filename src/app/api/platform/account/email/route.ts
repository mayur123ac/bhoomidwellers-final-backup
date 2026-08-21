// api/platform/account/email/route.ts — change the platform account's email.
//
// ── Which account is changed ────────────────────────────────────────────────
// The one in the session, always. The body carries a new email and the current
// password, and nothing else is read from it — no user id, no target email, no
// organization_id. Supplying them changes nothing, because the UPDATE's WHERE
// clause is built from `gate.admin.id` and never from input.
//
// The WHERE clause also re-asserts the platform invariants
// (`organization_id IS NULL`, role is super admin). They are already true — that
// is how the gate let the request through — but restating them means this
// statement cannot be made to touch a tenant row even if the gate were ever
// loosened. Neither `role` nor `organization_id` appears in the SET list, so
// both are preserved by construction.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { verifyPassword } from "@/lib/passwords";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const newEmail = (body?.newEmail ?? "").toString().trim().toLowerCase();
    const currentPassword = (body?.currentPassword ?? "").toString();

    if (!currentPassword) return bad("Your current password is required.");
    if (!newEmail) return bad("A new email address is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return bad("That is not a valid email address.");
    if (newEmail.length > 254) return bad("That email address is too long.");

    // Re-authenticate. The stored value is read only to verify against, is never
    // returned, and never leaves this function.
    const secret = await query<{ password: string; email: string }>(
      "SELECT password, email FROM users WHERE id = $1 LIMIT 1",
      [gate.admin.id]
    );
    if (secret.length === 0) return bad("Account not found.", 404);
    if (!(await verifyPassword(currentPassword, secret[0].password))) {
      return bad("Current password is incorrect.", 401);
    }

    if (newEmail === (secret[0].email ?? "").toLowerCase()) {
      return bad("That is already your email address.");
    }

    // Duplicate check, global and against BOTH columns. `users.email` has no
    // unique constraint in this schema, and the login route resolves an
    // identifier with `LOWER(email) = $1 OR LOWER(name) = $1 ... LIMIT 1` — so an
    // address that matches another row's *name* is just as ambiguous as one that
    // matches its email.
    const clash = await query<{ id: number }>(
      `SELECT id FROM users
        WHERE id <> $1
          AND deleted_at IS NULL
          AND (LOWER(email) = $2 OR LOWER(name) = $2)
        LIMIT 1`,
      [gate.admin.id, newEmail]
    );
    if (clash.length > 0) return bad("That email address is already in use.", 409);

    const updated = await query<{ id: number; email: string; role: string; organization_id: string | null }>(
      `UPDATE users
          SET email = $2, updated_at = now()
        WHERE id = $1
          AND organization_id IS NULL
          AND deleted_at IS NULL
          AND lower(btrim(replace(role, '_', ' '))) = 'super admin'
      RETURNING id, email, role, organization_id`,
      [gate.admin.id, newEmail]
    );
    if (updated.length === 0) return bad("Could not update the account.", 409);

    return NextResponse.json(
      {
        success: true,
        message: "Email address updated.",
        data: {
          email: updated[0].email,
          // Echoed back so the panel can show that the invariants held, without
          // having to trust that they did.
          role: updated[0].role,
          organizationId: updated[0].organization_id,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    // The message is deliberately generic and the detail goes to the server log:
    // a database error string can carry column values.
    console.error("[POST /api/platform/account/email]", err?.message);
    return NextResponse.json(
      { success: false, message: "Could not update the email address." },
      { status: 500 }
    );
  }
}
