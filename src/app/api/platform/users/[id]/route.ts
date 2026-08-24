// api/platform/users/[id]/route.ts — Super Admin actions on ONE tenant user.
//
// Four actions, one route, discriminated by `action` in the body — the same
// shape /api/settings/employees already uses for its administrative verbs, so
// there is one convention rather than two:
//
//   changePassword   set a new password (hashed; revokes their sessions)
//   changeEmail      set a new email address
//   forceLogout      end every live session, for real
//   setStatus        activate / deactivate the account
//
// ── Why these are not the existing Admin endpoints ──────────────────────────
// /api/settings/employees does all four for a TENANT Admin, and would have been
// the right thing to reuse if it could resolve a tenant for this caller. It
// cannot. It scopes every statement with `getOrganizationId()`, which reads the
// `org` claim from the caller's own session — and a Super Admin has no
// organization at all (`organization_id IS NULL` is half of what makes the
// account platform level). Calling that route as Super Admin does not return the
// wrong tenant's data; it throws, because tenant resolution correctly refuses to
// guess.
//
// So the route is separate and the BEHAVIOUR is not: every operation below is a
// call into lib/userSecurity.ts, which is also what the Admin path's policy is
// now expressed in. Password hashing happens in exactly one function
// (lib/passwords.hashPassword) for both. There is no second hashing scheme, no
// second session model, and no second definition of a valid password.
//
// ── Where the organization comes from ───────────────────────────────────────
// From the TARGET USER'S OWN ROW, read server-side. Not from the body, not from
// a query parameter, not from a header. The client sends a user id and nothing
// else that could redirect the write; the tenant every statement is scoped to is
// then whatever the database says that user belongs to. A caller cannot pair
// user 42 with someone else's organization id, because there is nowhere to put
// one.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import {
  isLastActiveAdmin,
  passwordStatusOf,
  revokeUserSessions,
  setUserActive,
  setUserEmail,
  setUserPassword,
} from "@/lib/userSecurity";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface OwnerRow {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  is_active: boolean;
  organization_id: string | null;
  organization_name: string | null;
  has_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

/**
 * Resolves the target and its tenant, or null.
 *
 * `organization_id IS NOT NULL` is a hard condition, not an incidental one: it
 * makes every platform account — including the caller's own — invisible to this
 * route. A Super Admin therefore cannot force-log-out, re-password or
 * deactivate another Super Admin (or themselves) through the tenant management
 * screen; that account is managed from Settings → Account Security, where
 * changing it requires the current password.
 */
async function loadOwner(userId: number): Promise<OwnerRow | null> {
  const rows = await query<OwnerRow>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            u.organization_id,
            o.name AS organization_name,
            (u.password IS NOT NULL AND btrim(u.password) <> '') AS has_password,
            u.last_login_at,
            u.created_at
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = $1
        AND u.organization_id IS NOT NULL
        AND u.deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const id = parseId((await params).id);
  if (id == null) {
    return NextResponse.json({ success: false, message: "Invalid user id." }, { status: 400 });
  }

  const owner = await loadOwner(id);
  if (!owner) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        role: owner.role,
        status: owner.is_active ? "active" : "inactive",
        organizationId: owner.organization_id,
        organization: owner.organization_name,
        // Status only. The hash is not selected above and is not reachable here.
        passwordStatus: passwordStatusOf(owner.has_password === true),
        lastLoginAt: owner.last_login_at,
        createdAt: owner.created_at,
      },
    },
    { status: 200 }
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const id = parseId((await params).id);
  if (id == null) {
    return NextResponse.json({ success: false, message: "Invalid user id." }, { status: 400 });
  }

  const owner = await loadOwner(id);
  if (!owner || !owner.organization_id) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }
  const organizationId = owner.organization_id;

  const { ip, userAgent } = requestContext(req);
  const body = await req.json().catch(() => ({}));
  const action = (body?.action ?? "").toString();

  /** Common audit shape. The target is always named; secrets never are. */
  const audit = (auditAction: string, meta: Record<string, unknown>) =>
    writeAuditLog({
      userId: gate.admin.id,
      actorName: gate.admin.name,
      action: auditAction,
      entityType: "user",
      entityId: owner.id,
      newValue: {
        targetUser: owner.name,
        targetUserId: owner.id,
        organizationId,
        organization: owner.organization_name,
        ...meta,
      },
      ipAddress: ip,
      userAgent,
    });

  try {
    // ── Change password ────────────────────────────────────────────────────
    if (action === "changePassword") {
      const newPassword = (body?.newPassword ?? "").toString();
      const confirmPassword = (body?.confirmPassword ?? "").toString();
      if (newPassword !== confirmPassword) {
        return NextResponse.json(
          { success: false, message: "Passwords do not match." },
          { status: 400 }
        );
      }

      const result = await setUserPassword({ userId: id, organizationId, newPassword });
      if (!result.ok) {
        return NextResponse.json({ success: false, message: result.message }, { status: result.status });
      }

      // The existing password is never read, never compared and never shown. The
      // audit row records that a change happened, to whom, by whom — and no part
      // of either password. Storing "[redacted]" rather than omitting the key
      // makes the absence deliberate and legible in the trail.
      await audit("platform.user.password_change", { password: "[redacted]", sessionsRevoked: true });

      return NextResponse.json(
        {
          success: true,
          message:
            "Password updated. The user's existing sessions have been signed out " +
            "and they must sign in again with the new password.",
        },
        { status: 200 }
      );
    }

    // ── Change email ───────────────────────────────────────────────────────
    if (action === "changeEmail") {
      const newEmail = (body?.newEmail ?? "").toString();
      const result = await setUserEmail({ userId: id, organizationId, newEmail });
      if (!result.ok) {
        return NextResponse.json({ success: false, message: result.message }, { status: result.status });
      }

      await audit("platform.user.email_change", { from: owner.email, to: result.email });

      return NextResponse.json(
        { success: true, message: "Email address updated.", data: { email: result.email } },
        { status: 200 }
      );
    }

    // ── Force logout ───────────────────────────────────────────────────────
    if (action === "forceLogout") {
      // Deliberately NOT guarded by the last-Admin check. Signing someone out is
      // reversible by them signing back in; that is the whole point, and refusing
      // it for the only Admin would make the action useless in the one case an
      // operator most often needs it.
      const result = await revokeUserSessions({
        userId: id,
        organizationId,
        reason: "super_admin_force_logout",
      });
      if (!result.ok) {
        return NextResponse.json({ success: false, message: result.message }, { status: result.status });
      }

      await audit("platform.user.force_logout", { closedSessions: result.closedSessions ?? 0 });

      return NextResponse.json(
        {
          success: true,
          message: "User signed out. Their existing sessions can no longer access the CRM.",
          data: { closedSessions: result.closedSessions ?? 0 },
        },
        { status: 200 }
      );
    }

    // ── Activate / deactivate ──────────────────────────────────────────────
    if (action === "setStatus") {
      const isActive = body?.isActive === true;

      if (!isActive && (await isLastActiveAdmin(id, organizationId))) {
        return NextResponse.json(
          {
            success: false,
            message:
              "That is the organization's only active Admin. Promote someone else " +
              "before deactivating this account.",
          },
          { status: 409 }
        );
      }

      const result = await setUserActive({ userId: id, organizationId, isActive });
      if (!result.ok) {
        return NextResponse.json({ success: false, message: result.message }, { status: result.status });
      }

      await audit(isActive ? "platform.user.reactivate" : "platform.user.deactivate", {
        from: owner.is_active ? "active" : "inactive",
        to: isActive ? "active" : "inactive",
      });

      return NextResponse.json(
        {
          success: true,
          message: isActive
            ? "Account reactivated."
            : "Account deactivated and signed out.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  } catch (err: any) {
    // Generic to the client, detail to the log: a driver error string can echo
    // parameter values, and one of the parameters on this route is a password.
    console.error("[PATCH /api/platform/users/[id]]", action, err?.message);
    return NextResponse.json(
      { success: false, message: "Could not complete that action." },
      { status: 500 }
    );
  }
}
