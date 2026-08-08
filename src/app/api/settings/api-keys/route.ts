// app/api/settings/api-keys/route.ts — list and issue API keys.
//
// Admin-only, like every other workspace-level settings route. This is stricter
// than it may look: an API key is a credential that works outside a browser
// session, has no MFA in front of it and does not expire unless someone sets a
// date. Letting a manager mint one would put a permanent, unattended door into
// lead data outside the role model that governs everything else.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import {
  API_SCOPES,
  DEFAULT_RATE_LIMIT_PER_MIN,
  MAX_RATE_LIMIT_PER_MIN,
  clampRateLimit,
  generateApiKey,
  sanitizeScopes,
  validateCidr,
} from "@/lib/apiKeys";

export const dynamic = "force-dynamic";

/**
 * The list. Never selects key_hash — not because a hash is directly usable, but
 * because a column that is never read cannot be leaked by a future change to
 * this handler that widens the projection.
 */
export async function GET() {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const rows = await query(
    `SELECT k.id, k.name, k.key_prefix, k.scopes, k.rate_limit_per_min,
            k.ip_whitelist, k.created_at, k.updated_at, k.last_used_at,
            k.last_used_ip, k.expires_at, k.revoked_at, k.revoked_reason,
            k.rotated_to_id,
            c.name AS created_by_name,
            r.name AS revoked_by_name,
            -- Calls in the trailing 24h, so the list can show which keys are
            -- actually in use without a second round trip per row.
            COALESCE((
              SELECT SUM(u.request_count)
                FROM api_key_usage u
               WHERE u.api_key_id = k.id
                 AND u.bucket_start >= NOW() - INTERVAL '24 hours'
            ), 0)::int AS calls_24h
       FROM api_keys k
       LEFT JOIN users c ON c.id = k.created_by
       LEFT JOIN users r ON r.id = k.revoked_by
      ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`
  );

  return NextResponse.json({
    success: true,
    data: rows,
    // Shipped with the list so the UI's scope picker cannot drift from the
    // catalogue the server actually enforces.
    scopes: API_SCOPES,
    defaults: {
      rateLimitPerMin: DEFAULT_RATE_LIMIT_PER_MIN,
      maxRateLimitPerMin: MAX_RATE_LIMIT_PER_MIN,
    },
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { success: false, message: "Give the key a name so it can be identified later." },
      { status: 400 }
    );
  }
  if (name.length > 120) {
    return NextResponse.json(
      { success: false, message: "Name must be 120 characters or fewer." },
      { status: 400 }
    );
  }

  const scopes = sanitizeScopes(body.scopes);
  if (scopes.length === 0) {
    return NextResponse.json(
      { success: false, message: "Select at least one scope, or the key cannot do anything." },
      { status: 400 }
    );
  }

  // Whitelist entries are validated individually so the message names the bad
  // one. "Invalid IP whitelist" against a textarea of twelve CIDRs is unactionable.
  const ipWhitelist: string[] = Array.isArray(body.ipWhitelist)
    ? body.ipWhitelist.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
    : [];
  for (const entry of ipWhitelist) {
    const problem = validateCidr(entry);
    if (problem) return NextResponse.json({ success: false, message: problem }, { status: 400 });
  }

  const rateLimit = body.rateLimitPerMin == null ? null : clampRateLimit(Number(body.rateLimitPerMin));

  let expiresAt: string | null = null;
  if (body.expiresAt) {
    const parsed = new Date(String(body.expiresAt));
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ success: false, message: "Expiry date is not valid." }, { status: 400 });
    }
    if (parsed.getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, message: "Expiry date must be in the future." },
        { status: 400 }
      );
    }
    expiresAt = parsed.toISOString();
  }

  const generated = generateApiKey();

  const inserted = await query<{ id: number; key_prefix: string; created_at: string }>(
    `INSERT INTO api_keys
       (name, key_prefix, key_hash, scopes, rate_limit_per_min, ip_whitelist,
        created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, key_prefix, created_at`,
    [
      name,
      generated.prefix,
      generated.hash,
      scopes,
      rateLimit,
      ipWhitelist,
      gate.userId,
      expiresAt,
    ]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: "api_key.create",
    entityType: "api_key",
    entityId: inserted[0].id,
    // The prefix, never the key. An audit log is read by more people, and
    // retained longer, than almost anything else in the system.
    newValue: { name, prefix: generated.prefix, scopes, rateLimit, ipWhitelist, expiresAt },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json(
    {
      success: true,
      message: "API key created.",
      data: { id: inserted[0].id, prefix: generated.prefix, createdAt: inserted[0].created_at },
      // The only time this value ever leaves the server. The UI must make that
      // unmistakable — there is no endpoint that can return it again.
      plaintextKey: generated.plaintext,
    },
    { status: 201 }
  );
}
