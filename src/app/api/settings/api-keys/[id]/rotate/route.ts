// app/api/settings/api-keys/[id]/rotate/route.ts — replace a key's secret.
//
// Rotation issues a NEW row carrying the old one's configuration, then revokes
// the old one and links the two via rotated_to_id.
//
// ── Why a new row rather than a new hash on the same row ────────────────────
// Overwriting key_hash in place would be simpler and is what "rotate" sounds
// like. It was rejected because the usage history in api_key_usage is keyed by
// api_key_id: reusing the row would silently merge the old key's traffic with
// the new one's, and the question rotation exists to answer — "is anything still
// calling with the compromised key?" — would become unanswerable at the moment
// it matters most.
//
// With two rows, a leaked key that is still in use shows up as continuing
// traffic on a revoked key, which is exactly the alarm an admin needs.
//
// ── The grace period ────────────────────────────────────────────────────────
// `graceMinutes` keeps the old key working briefly so a running integration can
// be updated without a hard outage. It defaults to 0 — the safe default, since
// the common reason to rotate is that a key leaked. A grace period is opt-in and
// capped at 24h.

import { NextRequest, NextResponse } from "next/server";
import { transaction } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { errorText, generateApiKey } from "@/lib/apiKeys";

export const dynamic = "force-dynamic";

const MAX_GRACE_MINUTES = 24 * 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, message: "Invalid key id." }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional for this route — an empty POST means "rotate now, no grace".
  }

  const graceMinutes = Math.min(
    Math.max(Math.trunc(Number(body?.graceMinutes ?? 0)) || 0, 0),
    MAX_GRACE_MINUTES
  );

  const generated = generateApiKey();

  // A transaction because a half-applied rotation is genuinely dangerous in both
  // directions: a new key without the old one revoked leaves the leaked
  // credential live, and a revoked old key without a new one breaks the
  // integration with nothing to replace it.
  let result: { newId: number; oldName: string; oldPrefix: string } | null = null;

  try {
    result = await transaction(async (client) => {
      const existingRes = await client.query(
        `SELECT id, name, key_prefix, scopes, rate_limit_per_min, ip_whitelist,
                expires_at, revoked_at
           FROM api_keys
          WHERE id = $1
          FOR UPDATE`,
        [id]
      );

      const existing = existingRes.rows[0];
      if (!existing) throw new Error("NOT_FOUND");
      if (existing.revoked_at) throw new Error("ALREADY_REVOKED");

      const insertRes = await client.query(
        `INSERT INTO api_keys
           (name, key_prefix, key_hash, scopes, rate_limit_per_min, ip_whitelist,
            created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          existing.name,
          generated.prefix,
          generated.hash,
          existing.scopes,
          existing.rate_limit_per_min,
          existing.ip_whitelist,
          gate.userId,
          existing.expires_at,
        ]
      );

      const newId = insertRes.rows[0].id as number;

      // Grace is expressed by setting the OLD key's expiry rather than delaying
      // its revocation, so there is no scheduled job to run. authenticateApiKey
      // already rejects an expired key, so the deadline enforces itself.
      if (graceMinutes > 0) {
        await client.query(
          `UPDATE api_keys
              SET expires_at = NOW() + ($2 || ' minutes')::interval,
                  rotated_to_id = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [id, String(graceMinutes), newId]
        );
      } else {
        await client.query(
          `UPDATE api_keys
              SET revoked_at = NOW(), revoked_by = $2, revoked_reason = 'rotated',
                  rotated_to_id = $3, updated_at = NOW()
            WHERE id = $1`,
          [id, gate.userId, newId]
        );
      }

      return { newId, oldName: existing.name, oldPrefix: existing.key_prefix };
    });
  } catch (err) {
    // The transaction body signals the two expected outcomes by throwing, so
    // that the ROLLBACK happens for them too — returning a response from inside
    // the callback would commit the partial work.
    const reason = errorText(err);

    if (reason === "NOT_FOUND") {
      return NextResponse.json({ success: false, message: "Key not found." }, { status: 404 });
    }
    if (reason === "ALREADY_REVOKED") {
      return NextResponse.json(
        { success: false, message: "This key is revoked; create a new one instead of rotating." },
        { status: 409 }
      );
    }
    console.error("[api-keys] rotate failed", reason);
    return NextResponse.json(
      { success: false, message: "Rotation failed. The old key is unchanged." },
      { status: 500 }
    );
  }

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: "api_key.rotate",
    entityType: "api_key",
    entityId: id,
    oldValue: { prefix: result.oldPrefix },
    newValue: { prefix: generated.prefix, newKeyId: result.newId, graceMinutes },
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    message:
      graceMinutes > 0
        ? `Key rotated. The previous key keeps working for ${graceMinutes} minute(s).`
        : "Key rotated. The previous key stopped working immediately.",
    data: { id: result.newId, prefix: generated.prefix, graceMinutes },
    plaintextKey: generated.plaintext,
  });
}
