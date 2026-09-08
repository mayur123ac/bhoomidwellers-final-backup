import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/settings/api-keys/[id]/rotate — rotate a key
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const keyId = parseInt(id, 10);
  if (!Number.isFinite(keyId)) {
    return NextResponse.json({ success: false, message: "Invalid key ID." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const graceMinutes = Math.max(0, parseInt(body.graceMinutes ?? "0", 10));

    // Load the existing key
    const existing = await query<any>(
      `SELECT name, scopes, rate_limit_per_min, ip_whitelist, organization_id
       FROM api_keys
       WHERE id = $1 AND revoked_at IS NULL
       LIMIT 1`,
      [keyId]
    );

    if (existing.length === 0) {
      return NextResponse.json({ success: false, message: "Key not found." }, { status: 404 });
    }

    const old = existing[0];

    // Generate new key
    const { randomBytes, createHash } = await import("node:crypto");
    const rawKey = `bhd_${randomBytes(32).toString("hex")}`;
    const prefix = rawKey.slice(0, 12);
    const hash = createHash("sha256").update(rawKey).digest("hex");

    // Create the replacement key
    await query(
      `INSERT INTO api_keys (name, key_hash, key_prefix, scopes, rate_limit_per_min,
                             ip_whitelist, organization_id, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8)`,
      [
        old.name, hash, prefix,
        JSON.stringify(old.scopes ?? []),
        old.rate_limit_per_min,
        JSON.stringify(old.ip_whitelist ?? []),
        old.organization_id,
        gate.userId,
      ]
    );

    // Revoke the old key (with optional grace period)
    if (graceMinutes > 0) {
      await query(
        `UPDATE api_keys SET revoked_at = NOW() + $1 * INTERVAL '1 minute',
                             revoke_reason = 'Rotated (grace period)'
         WHERE id = $2`,
        [graceMinutes, keyId]
      );
    } else {
      await query(
        `UPDATE api_keys SET revoked_at = NOW(), revoke_reason = 'Rotated'
         WHERE id = $1`,
        [keyId]
      );
    }

    return NextResponse.json({
      success: true,
      message: graceMinutes > 0
        ? `Key rotated. Old key remains valid for ${graceMinutes} minutes.`
        : "Key rotated. Old key revoked immediately.",
      plaintextKey: rawKey,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/api-keys/[id]/rotate]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
