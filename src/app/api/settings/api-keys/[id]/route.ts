// app/api/settings/api-keys/[id]/route.ts — edit and revoke a key.
//
// PATCH changes what a key may do. DELETE revokes it.
//
// There is no endpoint that returns a key's secret, and there never will be —
// the server does not hold it. That is why "lost the key" is answered by Rotate
// (a sibling route) rather than by a reveal.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { diffFields, requestContext, writeAuditLog } from "@/lib/auditLog";
import { clampRateLimit, sanitizeScopes, validateCidr } from "@/lib/apiKeys";

export const dynamic = "force-dynamic";

interface KeyRow {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_min: number | null;
  ip_whitelist: string[];
  expires_at: string | null;
  revoked_at: string | null;
}

// MT-06: the key id is a caller-supplied route parameter and this file EDITS and
// REVOKES. Unscoped, an admin of one workspace could revoke another workspace's
// integration key — a cross-tenant denial of service, and an untraceable one
// because the audit entry would be written against the wrong organization.
// Scoping the load makes a foreign key indistinguishable from a missing one, and
// the mutations below repeat the predicate so neither can act on a row this
// function did not authorise.
async function loadKey(id: number, orgId: string): Promise<KeyRow | null> {
  const rows = await query<KeyRow>(
    `SELECT id, name, key_prefix, scopes, rate_limit_per_min, ip_whitelist,
            expires_at, revoked_at
       FROM api_keys WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId]
  );
  return rows[0] ?? null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, message: "Invalid key id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const orgId = await getOrganizationId();
  const existing = await loadKey(id, orgId);
  if (!existing) {
    return NextResponse.json({ success: false, message: "Key not found." }, { status: 404 });
  }
  if (existing.revoked_at) {
    // Editing a revoked key would produce a row that looks configurable but can
    // never authenticate, which is a confusing state to allow into the UI.
    return NextResponse.json(
      { success: false, message: "This key is revoked and can no longer be edited. Create a new one." },
      { status: 409 }
    );
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) {
      return NextResponse.json({ success: false, message: "Name cannot be empty." }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json(
        { success: false, message: "Name must be 120 characters or fewer." },
        { status: 400 }
      );
    }
    updates.name = name;
  }

  if (body.scopes !== undefined) {
    const scopes = sanitizeScopes(body.scopes);
    if (scopes.length === 0) {
      return NextResponse.json(
        { success: false, message: "Select at least one scope, or revoke the key instead." },
        { status: 400 }
      );
    }
    updates.scopes = scopes;
  }

  if (body.ipWhitelist !== undefined) {
    const list: string[] = Array.isArray(body.ipWhitelist)
      ? body.ipWhitelist.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
      : [];
    for (const entry of list) {
      const problem = validateCidr(entry);
      if (problem) return NextResponse.json({ success: false, message: problem }, { status: 400 });
    }
    updates.ip_whitelist = list;
  }

  if (body.rateLimitPerMin !== undefined) {
    updates.rate_limit_per_min =
      body.rateLimitPerMin === null ? null : clampRateLimit(Number(body.rateLimitPerMin));
  }

  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === "") {
      updates.expires_at = null;
    } else {
      const parsed = new Date(String(body.expiresAt));
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ success: false, message: "Expiry date is not valid." }, { status: 400 });
      }
      updates.expires_at = parsed.toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, message: "Nothing to update." }, { status: 400 });
  }

  // Column names come from the fixed set of keys assigned above, never from the
  // request body, so building the SET clause by interpolation is safe here.
  // Values stay parameterised.
  const columns = Object.keys(updates);
  const setSql = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");

  await query(
    `UPDATE api_keys SET ${setSql}, updated_at = NOW() WHERE id = $1 AND organization_id = $${columns.length + 2}`,
    [id, ...columns.map((c) => updates[c]), orgId]
  );

  const { ip, userAgent } = requestContext(req);
  const before: Record<string, unknown> = {
    name: existing.name,
    scopes: (existing.scopes ?? []).join(","),
    ip_whitelist: (existing.ip_whitelist ?? []).join(","),
    rate_limit_per_min: existing.rate_limit_per_min,
    expires_at: existing.expires_at,
  };
  const after: Record<string, unknown> = { ...before };
  for (const c of columns) {
    after[c] = Array.isArray(updates[c]) ? updates[c].join(",") : updates[c];
  }
  const { old, next, changed } = diffFields(before, after);

  if (changed.length > 0) {
    await writeAuditLog({
      userId: gate.userId,
      actorName: gate.session.name,
      action: "api_key.update",
      entityType: "api_key",
      entityId: id,
      oldValue: old,
      newValue: { ...next, prefix: existing.key_prefix },
      ipAddress: ip,
      userAgent,
    });
  }

  return NextResponse.json({ success: true, message: "Key updated.", changed });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, message: "Invalid key id." }, { status: 400 });
  }

  const reason = String(new URL(req.url).searchParams.get("reason") ?? "").slice(0, 255) || null;

  const orgId = await getOrganizationId();
  const existing = await loadKey(id, orgId);
  if (!existing) {
    return NextResponse.json({ success: false, message: "Key not found." }, { status: 404 });
  }
  if (existing.revoked_at) {
    // Idempotent: revoking twice is not an error, because the caller's intent
    // ("this key must not work") is already satisfied.
    return NextResponse.json({ success: true, message: "Key was already revoked." });
  }

  // Soft delete. The row stays so usage history and audit entries keep resolving,
  // and so the prefix can never be reissued — see the migration's column comment.
  await query(
    `UPDATE api_keys
        SET revoked_at = NOW(), revoked_by = $2, revoked_reason = $3, updated_at = NOW()
      WHERE id = $1 AND organization_id = $4`,
    [id, gate.userId, reason, orgId]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: "api_key.revoke",
    entityType: "api_key",
    entityId: id,
    oldValue: { name: existing.name, prefix: existing.key_prefix, active: true },
    newValue: { active: false, reason },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    message: "Key revoked. Any request using it now fails immediately.",
  });
}
