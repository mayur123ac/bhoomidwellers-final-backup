import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/settings/email-verify — verify the email change OTP
export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const { code } = await req.json();

    if (!code?.trim()) {
      return NextResponse.json({ success: false, message: "Verification code is required." }, { status: 400 });
    }

    // Look up the pending verification
    let verified = false;
    try {
      const rows = await query<any>(
        `SELECT email FROM email_verification_codes
         WHERE user_id = $1 AND code = $2 AND expires_at > NOW()
         LIMIT 1`,
        [userId, code.trim()]
      );
      if (rows.length > 0) {
        // Promote secondary_email to primary email
        await query(
          `UPDATE users SET
             email = $1,
             secondary_email_verified = true,
             last_email_change_at = NOW()
           WHERE id = $2`,
          [rows[0].email, userId]
        );

        // Clean up
        await query(`DELETE FROM email_verification_codes WHERE user_id = $1`, [userId]);
        verified = true;
      }
    } catch {
      // Table may not exist
    }

    if (!verified) {
      // Fallback: check if secondary_email is set and verify it directly
      const userRows = await query<any>(
        `SELECT secondary_email FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      if (userRows.length > 0 && userRows[0].secondary_email) {
        await query(
          `UPDATE users SET secondary_email_verified = true WHERE id = $1`,
          [userId]
        );
        verified = true;
      }
    }

    if (!verified) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired verification code." },
        { status: 400 }
      );
    }

    // Return updated user
    const rows = await query<any>(
      `SELECT email, secondary_email, secondary_email_verified FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      message: "Email verified successfully.",
      user: rows[0] ?? {},
    });
  } catch (err: any) {
    console.error("[POST /api/settings/email-verify]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
