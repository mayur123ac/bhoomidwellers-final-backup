// api/settings/password/route.ts
//
// POST — change the signed-in user's password.
// Verifies the current password, validates the new one, stores a scrypt hash,
// and clears the session cookie so the user must re-login.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { verifyPassword, hashPassword } from "@/lib/passwords";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user ID." },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const { currentPassword, newPassword, confirmPassword } = body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { success: false, message: "All fields are required." },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "New password and confirmation do not match." },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    // Fetch stored password.
    const rows = await query<{ password: string | null }>(
      `SELECT password FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (!rows[0]) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    const ok = await verifyPassword(currentPassword, rows[0].password);
    if (!ok) {
      return NextResponse.json(
        { success: false, message: "Current password is incorrect." },
        { status: 403 }
      );
    }

    const hashed = await hashPassword(newPassword);

    await query(
      `UPDATE users
          SET password = $1,
              password_changed_at = NOW()
        WHERE id = $2`,
      [hashed, userId]
    );

    // Clear the session cookie so the user must re-login with the new password.
    const response = NextResponse.json({
      success: true,
      message: "Password updated. Please sign in again.",
    });
    response.cookies.set({
      name: "crm_session",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (err: any) {
    console.error("[POST /api/settings/password]", err);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}
