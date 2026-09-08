// api/settings/account/route.ts
//
// GET — returns account & security data for the signed-in user.
// Consumed by /dashboard/settings/account-security.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { loadSettingsUser, serializeSettingsUser } from "@/lib/settingsUser";
import { isHashed } from "@/lib/passwords";

export const dynamic = "force-dynamic";

export async function GET() {
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
    const row = await loadSettingsUser(userId);
    if (!row) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    // Count active sessions for this user.
    const sessionRows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM employee_sessions
        WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
    const activeSessions = Number(sessionRows[0]?.count ?? 0);

    // Check whether the stored password is hashed.
    const pwRows = await query<{ password: string | null }>(
      `SELECT password FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const passwordHashed = isHashed(pwRows[0]?.password);

    const user = serializeSettingsUser(row);

    return NextResponse.json({
      success: true,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
      },
      account: {
        status: row.is_active ? "active" : "suspended",
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        firstLoginAt: user.firstLoginAt,
        passwordChangedAt: user.passwordChangedAt,
        passwordHashed,
        activeSessions,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/settings/account]", err);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}
