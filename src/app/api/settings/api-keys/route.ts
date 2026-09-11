import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const SCOPES = [
  { value: "leads:read", label: "Read Leads", description: "List and retrieve lead records." },
  { value: "leads:write", label: "Write Leads", description: "Create and update lead records." },
  { value: "bookings:read", label: "Read Bookings", description: "List and retrieve booking records." },
  { value: "bookings:write", label: "Write Bookings", description: "Create and update booking records." },
  { value: "users:read", label: "Read Users", description: "List team members." },
  { value: "reports:read", label: "Read Reports", description: "Access dashboard analytics." },
];

// GET /api/settings/api-keys
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;

  try {
    const conditions = ["revoked_at IS NULL"];
    const params: any[] = [];
    let idx = 1;

    if (orgId) {
      conditions.push(`organization_id = $${idx++}`);
      params.push(orgId);
    }

    let keys: any[] = [];
    try {
      keys = await query<any>(
        `SELECT id, name, key_prefix, scopes, rate_limit_per_min, ip_whitelist,
                created_at, last_used_at, expires_at, usage_count
         FROM api_keys
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC`,
        params
      );
    } catch {
      // api_keys table may not exist yet
    }

    return NextResponse.json({
      success: true,
      data: keys,
      scopes: SCOPES,
      defaults: { rateLimitPerMin: 120, maxRateLimitPerMin: 1000 },
    });
  } catch (err: any) {
    console.error("[GET /api/settings/api-keys]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/settings/api-keys — create a new API key
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  const orgId = gate.session.org;
  const userId = gate.userId;

  try {
    const body = await req.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ success: false, message: "Key name is required." }, { status: 400 });
    }

    const { randomBytes, createHash } = await import("node:crypto");
    const rawKey = `bhd_${randomBytes(32).toString("hex")}`;
    const prefix = rawKey.slice(0, 12);
    const hash = createHash("sha256").update(rawKey).digest("hex");

    const scopes = Array.isArray(body.scopes) ? body.scopes : [];
    const rateLimitPerMin = body.rateLimitPerMin || null;
    const ipWhitelist = Array.isArray(body.ipWhitelist) ? body.ipWhitelist : [];
    const expiresAt = body.expiresAt || null;

    const rows = await query<any>(
      `INSERT INTO api_keys (name, key_hash, key_prefix, scopes, rate_limit_per_min,
                             ip_whitelist, organization_id, created_by, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9)
       RETURNING id`,
      [
        body.name.trim(), hash, prefix,
        JSON.stringify(scopes), rateLimitPerMin,
        JSON.stringify(ipWhitelist),
        orgId || null, userId, expiresAt,
      ]
    );

    return NextResponse.json({
      success: true,
      message: "API key created.",
      plaintextKey: rawKey,
      key: {
        id: rows[0]?.id,
        name: body.name.trim(),
        key_prefix: prefix,
        scopes,
      },
    });
  } catch (err: any) {
    console.error("[POST /api/settings/api-keys]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
