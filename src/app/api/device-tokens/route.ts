// POST /api/device-tokens — register or update an FCM device token.
// DELETE /api/device-tokens — remove a token (logout / permission revoked).
//
// Security:
//   - Session-authenticated (requireSession)
//   - Token can only be registered for the calling user's own account
//   - organization_id comes from the session, never the request body
//   - UPSERT on token ensures one token = one owner; re-login as a
//     different user moves ownership automatically

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession, getSessionUserId } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export async function POST(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const organizationId = await getOrganizationId();
    const userId = getSessionUserId(gate.session);
    if (!userId) {
      return NextResponse.json(
        { message: "User not found." },
        { status: 403 },
      );
    }

    const body = await req.json();
    const { token, platform, deviceInfo } = body;

    if (!token || typeof token !== "string" || token.length < 20) {
      return NextResponse.json(
        { message: "Invalid device token." },
        { status: 400 },
      );
    }

    const safePlatform = ["android", "ios", "web"].includes(platform)
      ? platform
      : "android";

    // Upsert: if this token already exists (same device), update the owner
    // and clear any invalidation. This handles:
    //   - Re-login as same user (refresh updated_at)
    //   - Re-login as different user (move ownership)
    //   - Token was previously invalidated but device re-registered
    await query(
      `INSERT INTO device_tokens (user_id, organization_id, token, platform, device_info)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         organization_id = EXCLUDED.organization_id,
         platform = EXCLUDED.platform,
         device_info = EXCLUDED.device_info,
         updated_at = NOW(),
         invalidated_at = NULL`,
      [userId, organizationId, token, safePlatform, deviceInfo ?? null],
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[device-tokens] POST error:", err);
    return NextResponse.json(
      { message: err.message || "Failed to register device." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const organizationId = await getOrganizationId();
    const userId = getSessionUserId(gate.session);

    const body = await req.json().catch(() => ({}));
    const { token } = body;

    if (token && typeof token === "string") {
      // Remove specific token (e.g. on permission revoke)
      await query(
        `DELETE FROM device_tokens
         WHERE token = $1
           AND user_id = $2
           AND organization_id = $3`,
        [token, userId, organizationId],
      );
    } else {
      // Remove ALL tokens for this user+org (e.g. on logout)
      await query(
        `DELETE FROM device_tokens
         WHERE user_id = $1
           AND organization_id = $2`,
        [userId, organizationId],
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[device-tokens] DELETE error:", err);
    return NextResponse.json(
      { message: err.message || "Failed to remove device." },
      { status: 500 },
    );
  }
}
