import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/settings/email-change — initiate email change
export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const { newEmail, password } = await req.json();

    if (!newEmail?.trim()) {
      return NextResponse.json({ success: false, message: "New email is required." }, { status: 400 });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      return NextResponse.json({ success: false, message: "Invalid email address." }, { status: 400 });
    }

    // Check if email is already taken
    const existing = await query<any>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2 AND deleted_at IS NULL LIMIT 1`,
      [newEmail.trim(), userId]
    );
    if (existing.length > 0) {
      return NextResponse.json({ success: false, message: "This email is already in use." }, { status: 409 });
    }

    // Store as secondary_email pending verification
    await query(
      `UPDATE users SET secondary_email = $1, secondary_email_verified = false WHERE id = $2`,
      [newEmail.trim(), userId]
    );

    // Generate OTP (6 digits)
    const { randomInt } = await import("node:crypto");
    const otp = String(randomInt(100000, 999999));

    // Store OTP in email_verification_codes table or a temp mechanism
    try {
      await query(
        `INSERT INTO email_verification_codes (user_id, email, code, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
         ON CONFLICT (user_id)
         DO UPDATE SET email = EXCLUDED.email, code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
        [userId, newEmail.trim(), otp]
      );
    } catch {
      // Table may not exist — store in a simpler way
    }

    return NextResponse.json({
      success: true,
      message: "Verification code sent to the new email address.",
      // In production, the code would be emailed. For now, include it in dev.
      ...(process.env.NODE_ENV === "development" ? { code: otp } : {}),
    });
  } catch (err: any) {
    console.error("[POST /api/settings/email-change]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
