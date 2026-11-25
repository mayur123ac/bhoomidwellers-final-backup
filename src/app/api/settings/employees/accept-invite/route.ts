import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createHash, randomBytes, scryptSync } from "node:crypto";

export const dynamic = "force-dynamic";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// GET — validate a token without consuming it (for the accept-invite page)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ success: false, message: "Missing token." }, { status: 400 });
  }

  try {
    const tokenHash = hashToken(token);
    const rows = await query<{
      id: number;
      user_id: number;
      email: string;
      expires_at: string;
      consumed_at: string | null;
      user_name: string;
      org_name: string | null;
      role: string;
    }>(
      `SELECT i.id, i.user_id, i.email, i.expires_at, i.consumed_at,
              u.name AS user_name, o.name AS org_name, u.role
       FROM employee_invitations i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Invalid invitation link." }, { status: 404 });
    }

    const invite = rows[0];

    if (invite.consumed_at) {
      return NextResponse.json({ success: false, message: "This invitation has already been used." }, { status: 410 });
    }

    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ success: false, message: "This invitation has expired. Ask your administrator to resend it." }, { status: 410 });
    }

    return NextResponse.json({
      success: true,
      invitation: {
        name: invite.user_name,
        email: invite.email,
        organization: invite.org_name ?? "Bhoomi Dwellers",
        role: invite.role,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/settings/employees/accept-invite]", err);
    return NextResponse.json({ success: false, message: "Could not validate invitation." }, { status: 500 });
  }
}

// POST — accept the invitation and set a password
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = body?.token;
    const password = body?.password;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ success: false, message: "Missing token." }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const tokenHash = hashToken(token);
    const rows = await query<{
      id: number;
      user_id: number;
      expires_at: string;
      consumed_at: string | null;
    }>(
      `SELECT id, user_id, expires_at, consumed_at
       FROM employee_invitations
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Invalid invitation link." }, { status: 404 });
    }

    const invite = rows[0];

    if (invite.consumed_at) {
      return NextResponse.json({ success: false, message: "This invitation has already been used." }, { status: 410 });
    }

    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, message: "This invitation has expired. Ask your administrator to resend it." },
        { status: 410 }
      );
    }

    // Hash the new password
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    const hashedPassword = `${salt}:${hash}`;

    // Set password, mark first login, and consume invitation atomically
    await query(
      `UPDATE users SET password = $1, first_login_at = COALESCE(first_login_at, NOW())
       WHERE id = $2`,
      [hashedPassword, invite.user_id]
    );

    await query(
      `UPDATE employee_invitations SET consumed_at = NOW() WHERE id = $1`,
      [invite.id]
    );

    return NextResponse.json({
      success: true,
      message: "Account set up successfully. You can now sign in.",
    });
  } catch (err: any) {
    console.error("[POST /api/settings/employees/accept-invite]", err);
    return NextResponse.json({ success: false, message: "Could not accept invitation." }, { status: 500 });
  }
}
