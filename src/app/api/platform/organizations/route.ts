// api/platform/organizations/route.ts — every tenant on the platform.
//
// ── Why these queries have no organization_id filter ────────────────────────
// Every other read in this codebase is tenant-scoped, and correctly so. This one
// must not be: a platform operator asking "which organizations exist" cannot be
// answered by a query confined to one organization. The isolation that matters
// here is at the gate, not in the WHERE clause — requireSuperAdmin() is the
// first statement, and nothing below runs without it.
//
// The counts are GROUPed BY organization_id rather than fetched per tenant, so
// adding the hundredth organization does not add a hundred queries.
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { hashPassword, passwordMeetsRules } from "@/lib/passwords";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  try {
    const rows = await query(
      `SELECT
         o.id,
         o.name,
         o.slug,
         -- status is a real column on organizations; defaulted rather than
         -- invented so a NULL reads as active instead of blank in the UI.
         COALESCE(NULLIF(btrim(o.status), ''), 'active') AS status,
         o.created_at,
         COALESCE(u.total, 0)    AS users,
         COALESCE(u.admins, 0)   AS admins,
         COALESCE(l.total, 0)    AS leads,
         COALESCE(b.total, 0)    AS bookings,
         COALESCE(p.total, 0)    AS projects,
         -- "Last activity" is the most recent of the signals a tenant actually
         -- produces. GREATEST ignores NULLs only if every argument is NULL, so
         -- each is coalesced to a floor date and the result nulled back out.
         NULLIF(GREATEST(
           COALESCE(l.last_at,  'epoch'::timestamptz),
           COALESCE(b.last_at,  'epoch'::timestamptz),
           COALESCE(s.last_at,  'epoch'::timestamptz),
           COALESCE(o.updated_at, 'epoch'::timestamptz)
         ), 'epoch'::timestamptz) AS last_activity
       FROM organizations o
       LEFT JOIN (
         SELECT organization_id,
                count(*)::int AS total,
                count(*) FILTER (
                  WHERE lower(btrim(replace(role, '_', ' '))) = 'admin'
                )::int AS admins
           FROM users
          WHERE deleted_at IS NULL
          GROUP BY organization_id
       ) u ON u.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, count(*)::int AS total, max(created_at) AS last_at
           FROM walkin_enquiries GROUP BY organization_id
       ) l ON l.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, count(*)::int AS total, max(created_at) AS last_at
           FROM booking_applications GROUP BY organization_id
       ) b ON b.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, count(*)::int AS total
           FROM inventory_projects GROUP BY organization_id
       ) p ON p.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, max(session_start) AS last_at
           FROM employee_sessions GROUP BY organization_id
       ) s ON s.organization_id = o.id
       ORDER BY o.created_at DESC NULLS LAST, o.name`
    );

    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/platform/organizations]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

/** Default roles copied into a new tenant. See the note inside POST for why. */
const DEFAULT_ROLES = [
  "Admin", "Receptionist", "Sourcing Manager", "Sales Manager",
  "Caller", "Closing Manager", "Site Head", "Senior Sales Manager",
];

/**
 * Derives a slug satisfying `organizations_slug_format`
 * (`^[a-z0-9]+(-[a-z0-9]+)*$`) and the UNIQUE constraint on it.
 *
 * The form deliberately does not ask for a slug — one more field to get wrong —
 * so it is derived. A name that reduces to nothing (all punctuation) falls back
 * to "org", and a collision gets a numeric suffix rather than failing the call.
 */
async function deriveSlug(client: any, name: string): Promise<string> {
  const base =
    name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 48) || "org";

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { rows } = await client.query("SELECT 1 FROM organizations WHERE slug = $1", [candidate]);
    if (rows.length === 0) return candidate;
  }
  throw new Error("Could not derive a unique slug for that organization name.");
}

/**
 * Creates a tenant and its first Admin, atomically.
 *
 * ── What the client is not allowed to decide ────────────────────────────────
 * The body carries five values: organization name, admin name, admin email,
 * password, confirmation. It does NOT carry an organization id or a role, and
 * neither is read from it even if sent:
 *
 *   - the organization id comes from Postgres (`gen_random_uuid()`), so a caller
 *     cannot choose which tenant a user lands in, nor target an existing
 *     organization by supplying its id;
 *   - the role is the literal 'Admin' in the INSERT, so this endpoint cannot
 *     mint a second Super Admin. The platform gate also requires
 *     `organization_id IS NULL`, and this row always has one — the account is
 *     structurally incapable of being platform level.
 *
 * ── Atomicity ───────────────────────────────────────────────────────────────
 * Organization, Admin and the tenant's role list are written in one transaction.
 * If the user INSERT fails, the organization rolls back with it, so a failed
 * attempt cannot leave an empty tenant nobody can sign in to.
 */
export async function POST(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const bad = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status });

  try {
    const body = await req.json().catch(() => ({}));
    const organizationName = (body?.organizationName ?? "").toString().trim();
    const adminName = (body?.adminName ?? "").toString().trim();
    const adminEmail = (body?.adminEmail ?? "").toString().trim().toLowerCase();
    const password = (body?.password ?? "").toString();
    const confirmPassword = (body?.confirmPassword ?? "").toString();

    if (!organizationName) return bad("Organization name is required.");
    if (organizationName.length > 120) return bad("Organization name is too long.");
    if (!adminName) return bad("Admin name is required.");
    if (!adminEmail) return bad("Admin email is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return bad("That is not a valid email address.");
    if (!password) return bad("Admin password is required.");
    if (password !== confirmPassword) return bad("Passwords do not match.");
    if (!passwordMeetsRules(password)) {
      return bad("Password must be at least 8 characters and include upper case, lower case, a number and a symbol.");
    }

    // Hashed before the transaction opens: scrypt at N=65536 takes real time, and
    // holding a pooled connection through it would be a slow transaction for
    // nothing.
    const hashed = await hashPassword(password);

    const created = await transaction(async client => {
      // Duplicate organization name. The schema makes only `slug` unique, but two
      // tenants sharing a display name are indistinguishable in this very panel,
      // so it is refused as a business rule.
      const dupOrg = await client.query(
        "SELECT id FROM organizations WHERE lower(btrim(name)) = lower(btrim($1)) LIMIT 1",
        [organizationName]
      );
      if (dupOrg.rows.length > 0) {
        throw Object.assign(new Error("An organization with that name already exists."), { status: 409 });
      }

      // Duplicate admin identity. `users.email` has NO unique constraint here —
      // uniqueness is an application rule, the same one /api/employees applies.
      // It must be checked GLOBALLY rather than per organization, because the
      // login route resolves an identifier with
      // `LOWER(email) = $1 OR LOWER(name) = $1 ... LIMIT 1`; a second row sharing
      // either column makes which account you reach depend on row order. That is
      // also why the name is compared against both columns.
      const dupUser = await client.query(
        `SELECT id FROM users
          WHERE deleted_at IS NULL
            AND (LOWER(email) = $1 OR LOWER(name) = $1
              OR LOWER(email) = LOWER($2) OR LOWER(name) = LOWER($2))
          LIMIT 1`,
        [adminEmail, adminName]
      );
      if (dupUser.rows.length > 0) {
        throw Object.assign(
          new Error("That admin email or name is already in use by another account."),
          { status: 409 }
        );
      }

      const slug = await deriveSlug(client, organizationName);

      // id is DEFAULT gen_random_uuid(), never supplied. legacy_int_id stays NULL:
      // it exists only to map pre-MT-02 integer tenants, and a new organization
      // has no legacy identity.
      const org = await client.query(
        `INSERT INTO organizations (name, slug, status)
         VALUES ($1, $2, 'active')
         RETURNING id, name, slug, status, created_at`,
        [organizationName, slug]
      );
      const organizationId = org.rows[0].id;

      // username is left NULL: it is UNIQUE globally and per organization, and
      // Postgres allows many NULLs, so tenants that never set usernames do not
      // collide with each other.
      const user = await client.query(
        `INSERT INTO users (name, email, password, role, is_active, organization_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'Admin', true, $4, now(), now())
         RETURNING id, name, email, role, organization_id, created_at`,
        [adminName, adminEmail, hashed, organizationId]
      );

      // The tenant's role list. Not in the brief, but without it the new Admin
      // opens Settings -> Employees to an empty role dropdown and cannot add a
      // single colleague: /api/roles and /api/settings/employees both read
      // `roles WHERE organization_id = $1`, and a fresh tenant has no rows. The
      // set mirrors what the existing organization already has. Inside the same
      // transaction, so a failure here rolls the whole tenant back.
      for (const roleName of DEFAULT_ROLES) {
        await client.query(
          "INSERT INTO roles (name, organization_id) VALUES ($1, $2)",
          [roleName, organizationId]
        );
      }

      return { org: org.rows[0], user: user.rows[0] };
    });

    // No password, no hash, and nothing about the admin beyond what the panel
    // needs to confirm the write.
    return NextResponse.json(
      {
        success: true,
        data: {
          id: created.org.id,
          name: created.org.name,
          slug: created.org.slug,
          status: created.org.status,
          created_at: created.org.created_at,
          adminEmail: created.user.email,
          adminName: created.user.name,
          adminRole: created.user.role,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    // 409s are expected outcomes (duplicate name/email), not server faults.
    const status = err?.status ?? 500;
    if (status === 500) console.error("[POST /api/platform/organizations]", err);
    return NextResponse.json(
      { success: false, message: status === 500 ? "Could not create the organization." : err.message },
      { status }
    );
  }
}
