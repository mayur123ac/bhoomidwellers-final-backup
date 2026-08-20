// app/api/auth/signup/route.ts — admin-only account provisioning.
//
// ── What this route used to be ───────────────────────────────────────────────
// Unauthenticated, and it wrote `role` straight from the request body into the
// users table with `is_active` hardcoded true. A single unauthenticated POST
// carrying `{ role: "Admin" }` produced a working administrator, and
// middleware.ts grants `admin` every /dashboard path — so that account inherited
// every lead, booking, financial ledger row and customer phone number in the
// CRM. It was a complete authentication and authorisation bypass.
//
// Three things now stand between a request and a new account:
//
//   1. requireRoles(["admin"]) — the caller must already be a signed-in Admin.
//   2. ASSIGNABLE_ROLES — a server-side whitelist. "Admin" is not on it, so
//      this endpoint cannot mint another administrator no matter what is sent.
//   3. is_active = false, unconditionally. A new account cannot log in until an
//      Admin activates it.
//
// Note this is NOT the only way to create a user: app/api/employees POST also
// inserts into users. That route is separately gated; this comment exists so the
// next person knows to check both when reasoning about account creation.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireRoles } from "@/lib/serverAuth";

/**
 * The roles this endpoint may assign — the canonical strings from the `roles`
 * table, minus Admin.
 *
 * Taken from the database rather than invented. Values like "sales" or
 * "employee" would insert fine and then strand the user: middleware.ts matches
 * on these exact strings (normalised), so an unrecognised role falls through to
 * its catch-all redirect and the account cannot reach any dashboard.
 *
 * ⚠️ "Closing Manager" is listed because it is a real row in `roles`, but
 * middleware.ts currently has NO branch for it — an account created with that
 * role will be redirected to the login page from every dashboard path until a
 * branch is added. Same caveat applies to "Senior Sales Manager". Both are
 * documented in the audit; neither is fixed here.
 */
const ASSIGNABLE_ROLES = [
  "Receptionist",
  "Sourcing Manager",
  "Sales Manager",
  "Caller",
  "Closing Manager",
  "Site Head",
  "Senior Sales Manager",
] as const;

/**
 * Same normalisation serverAuth.requireRoles and middleware.ts apply, so
 * "sales_manager", "SALES MANAGER" and "Sales Manager" are all understood — and
 * all resolve to the one canonical spelling that gets stored.
 */
const normalizeRole = (r: unknown) =>
  String(r ?? "").trim().toLowerCase().replace(/_/g, " ");

export async function POST(req: Request) {
  // ── 1. Identity, before the body is even read ──────────────────────────────
  // Anything short of a signed-in Admin stops here: requireRoles answers 401 for
  // no/invalid session and 403 for a valid session in the wrong role.
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  try {
    const { name, email, password, role } = await req.json();

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { message: "All fields are required." },
        { status: 400 }
      );
    }

    // ── 2. The role is chosen from a server-side list, never trusted ─────────
    // Resolving the submitted value against ASSIGNABLE_ROLES does the rejection
    // and the canonicalisation in one step: anything not on the list — most
    // importantly "Admin", in any casing or spelling — finds no match and is
    // refused. There is no code path here that can write "Admin".
    const canonicalRole = ASSIGNABLE_ROLES.find(
      (r) => normalizeRole(r) === normalizeRole(role)
    );

    if (!canonicalRole) {
      return NextResponse.json(
        {
          message:
            `"${String(role)}" is not a role this endpoint can assign. ` +
            `Allowed: ${ASSIGNABLE_ROLES.join(", ")}. ` +
            `Administrator accounts cannot be created here.`,
        },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existing = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { message: "Email already exists." },
        { status: 400 }
      );
    }

    // ── 3. Always inactive. `false` is a literal, not a parameter ────────────
    // Written into the SQL text rather than bound as $5 so that no future edit
    // can route a request value into this column by changing the params array.
    //
    // Activation flow (verified to exist): PUT /api/employees runs
    // `UPDATE users SET is_active = $1 WHERE id = $2` — the enable/disable
    // toggle on the admin Employees screen. An Admin flips the new account on
    // there once they have confirmed it.
    await query(
      // This route is gated by requireRoles(["admin"]) — there is no public
      // self-signup — so the new user joins the creating Admin's organization.
      // That is a trustworthy tenant source, not a fallback.
      `INSERT INTO users (name, email, password, role, is_active, organization_id)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        password,
        canonicalRole, // whitelisted value, not the raw request field
        await getOrganizationId(),
      ]
    );

    return NextResponse.json(
      {
        message:
          `Account created for ${email.trim().toLowerCase()} as ${canonicalRole}. ` +
          `It is inactive — activate it from the Employees screen before they can sign in.`,
      },
      { status: 201 }
    );

  } catch (error) {
    console.error("SIGNUP ERROR:", error);
    return NextResponse.json(
      { message: "An error occurred during registration." },
      { status: 500 }
    );
  }
}