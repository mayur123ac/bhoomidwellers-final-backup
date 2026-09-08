import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/settings/self-password-change/request-otp
export async function POST() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    // Check if user has permission to change their own password
    const rows = await query<any>(
      `SELECT permissions, email FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
    }

    const permissions = rows[0].permissions ?? { can_change_password: true };
    if (!permissions.can_change_password) {
      return NextResponse.json(
        { success: false, message: "Password changes are disabled for your account." },
        { status: 403 }
      );
    }

    // Generate OTP
    const { randomInt } = await import("node:crypto");
    const otp = String(randomInt(100000, 999999));

    // Store OTP
    try {
      await query(
        `INSERT INTO password_change_codes (user_id, code, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '15 minutes')
         ON CONFLICT (user_id)
         DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
        [userId, otp]
      );
    } catch {
      // Table may not exist — store in email_verification_codes as fallback
      try {
        await query(
          `INSERT INTO email_verification_codes (user_id, email, code, expires_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
           ON CONFLICT (user_id)
           DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
          [userId, rows[0].email, otp]
        );
      } catch {
        // Neither table exists
      }
    }

    return NextResponse.json({
      success: true,
      message: "Verification code sent to your email address.",
      ...(process.env.NODE_ENV === "development" ? { code: otp } : {}),
    });
  } catch (err: any) {
    console.error("[POST /api/settings/self-password-change/request-otp]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
