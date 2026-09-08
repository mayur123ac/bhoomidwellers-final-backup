import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// PATCH /api/settings/api-keys/[id] — update a key
export async function PATCH(
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

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      sets.push(`name = $${idx++}`);
      vals.push(body.name);
    }
    if (body.scopes !== undefined) {
      sets.push(`scopes = $${idx++}::jsonb`);
      vals.push(JSON.stringify(body.scopes));
    }
    if (body.rateLimitPerMin !== undefined) {
      sets.push(`rate_limit_per_min = $${idx++}`);
      vals.push(body.rateLimitPerMin);
    }
    if (body.ipWhitelist !== undefined) {
      sets.push(`ip_whitelist = $${idx++}::jsonb`);
      vals.push(JSON.stringify(body.ipWhitelist));
    }
    if (body.expiresAt !== undefined) {
      sets.push(`expires_at = $${idx++}`);
      vals.push(body.expiresAt);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, message: "Nothing to update." }, { status: 400 });
    }

    vals.push(keyId);
    await query(
      `UPDATE api_keys SET ${sets.join(", ")} WHERE id = $${idx} AND revoked_at IS NULL`,
      vals
    );

    return NextResponse.json({ success: true, message: "API key updated." });
  } catch (err: any) {
    console.error("[PATCH /api/settings/api-keys/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// DELETE /api/settings/api-keys/[id] — revoke a key
export async function DELETE(
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
    const url = new URL(req.url);
    const reason = url.searchParams.get("reason") || "Manual revocation";

    await query(
      `UPDATE api_keys SET revoked_at = NOW(), revoke_reason = $1 WHERE id = $2`,
      [reason, keyId]
    );

    return NextResponse.json({ success: true, message: "API key revoked." });
  } catch (err: any) {
    console.error("[DELETE /api/settings/api-keys/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
