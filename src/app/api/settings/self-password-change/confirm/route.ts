import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/settings/self-password-change/confirm
export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const { otp, newPassword } = await req.json();

    if (!otp?.trim()) {
      return NextResponse.json({ success: false, message: "Verification code is required." }, { status: 400 });
    }
    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ success: false, message: "Password must be at least 8 characters." }, { status: 400 });
    }

    // Verify OTP
    let otpValid = false;
    try {
      const rows = await query<any>(
        `SELECT 1 FROM password_change_codes
         WHERE user_id = $1 AND code = $2 AND expires_at > NOW()
         LIMIT 1`,
        [userId, otp.trim()]
      );
      otpValid = rows.length > 0;
      if (otpValid) {
        await query(`DELETE FROM password_change_codes WHERE user_id = $1`, [userId]);
      }
    } catch {
      // Fallback to email_verification_codes
      try {
        const rows = await query<any>(
          `SELECT 1 FROM email_verification_codes
           WHERE user_id = $1 AND code = $2 AND expires_at > NOW()
           LIMIT 1`,
          [userId, otp.trim()]
        );
        otpValid = rows.length > 0;
        if (otpValid) {
          await query(`DELETE FROM email_verification_codes WHERE user_id = $1`, [userId]);
        }
      } catch {
        // Neither table exists — accept any OTP in dev
        if (process.env.NODE_ENV === "development") otpValid = true;
      }
    }

    if (!otpValid) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 400 }
      );
    }

    // Hash the new password
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(newPassword, salt, 64).toString("hex");
    const hashedPassword = `${salt}:${hash}`;

    // Update password and revoke all sessions
    await query(
      `UPDATE users SET
         password = $1,
         password_changed_at = NOW(),
         sessions_revoked_at = NOW()
       WHERE id = $2`,
      [hashedPassword, userId]
    );

    return NextResponse.json({
      success: true,
      message: "Password changed. You will be signed out.",
      reauthRequired: true,
    });
  } catch (err: any) {
    console.error("[POST /api/settings/self-password-change/confirm]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
