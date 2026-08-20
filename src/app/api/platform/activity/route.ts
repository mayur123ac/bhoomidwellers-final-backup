// api/platform/activity/route.ts — platform activity, from the existing audit trail.
//
// No new table. `audit_logs` already records what this page needs (396 rows at
// time of writing: logins, failed logins, preference changes, email delivery,
// alternate-email verification), and it is the right source for a *platform*
// feed precisely because of a property that would be a bug anywhere else: it has
// no organization_id column. Tenancy is derived by joining the actor, which is
// exactly the shape a cross-tenant view wants.
//
// ── old_value / new_value are deliberately not returned ─────────────────────
// Those two columns are free-form JSON written by a dozen different call sites.
// Some of it is innocuous (`{"theme_preference":"dark"}`); some is not — the
// `login.failed` rows carry the identifier that was typed, and the
// `alt_email.*` rows carry email addresses mid-verification. Forwarding a
// free-form column to a UI means forwarding whatever the next call site decides
// to put in it, so the detail string is *derived* from the action and entity
// instead. Same allow-list reasoning as /api/platform/users.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/superAdmin";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;

/**
 * Severity for the UI's coloured dot.
 *
 * Derived from the action name rather than stored, because audit_logs has no
 * severity column and inventing one would be a schema change this phase does
 * not need.
 */
function severityOf(action: string): "info" | "notice" | "warning" {
  const a = (action || "").toLowerCase();
  if (a.includes("failed") || a.includes("denied") || a.includes("lock")) return "warning";
  if (a.includes("delete") || a.includes("deactivat") || a.includes("suspend")) return "notice";
  return "info";
}

/** A readable label from the stored action key, e.g. "alt_email.otp_sent". */
function labelOf(action: string): string {
  const a = (action || "").trim();
  if (!a) return "Activity";
  return a
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\w/, c => c.toUpperCase());
}

export async function GET(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, MAX_LIMIT);

  try {
    const rows = await query(
      `SELECT
         a.id,
         a.created_at,
         a.action,
         a.entity_type,
         a.entity_id,
         -- actor_name is denormalised on the row, so an entry survives the user
         -- being deleted; the join only adds role and tenant when still present.
         COALESCE(NULLIF(btrim(a.actor_name), ''), u.name, 'System') AS actor,
         u.role AS actor_role,
         o.name AS organization
       FROM audit_logs a
       LEFT JOIN users u         ON u.id = a.user_id
       LEFT JOIN organizations o ON o.id = u.organization_id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $1`,
      [limit]
    );

    return NextResponse.json(
      {
        success: true,
        data: rows.map(r => ({
          id: String(r.id),
          at: r.created_at,
          actor: r.actor,
          actorRole: r.actor_role || "System",
          // A platform-level action (or one by a deleted user) has no tenant.
          organization: r.organization ?? null,
          action: labelOf(r.action),
          // Entity reference only — never the value columns.
          detail: r.entity_type ? `${r.entity_type}${r.entity_id ? ` #${r.entity_id}` : ""}` : "",
          severity: severityOf(r.action),
        })),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET /api/platform/activity]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
