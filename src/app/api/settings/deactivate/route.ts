// api/settings/deactivate/route.ts
//
// POST — self-deactivate the signed-in user's account.
// Verifies the password, sets is_active=false, ends all sessions, clears cookie.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { verifyPassword } from "@/lib/passwords";

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
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { success: false, message: "Password is required." },
        { status: 400 }
      );
    }

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

    const ok = await verifyPassword(password, rows[0].password);
    if (!ok) {
      return NextResponse.json(
        { success: false, message: "Incorrect password." },
        { status: 403 }
      );
    }

    // Deactivate account and end all sessions.
    await query(
      `UPDATE users SET is_active = false, deactivated_at = NOW() WHERE id = $1`,
      [userId]
    );
    await query(
      `UPDATE employee_sessions
          SET is_active = false, session_end = NOW()
        WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    const response = NextResponse.json({
      success: true,
      message: "Your account has been deactivated.",
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
    console.error("[POST /api/settings/deactivate]", err);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}
