// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { identifier, password } = await req.json();

    if (!identifier || !password) {
      return NextResponse.json(
        { message: "Please provide both a username/email and password." },
        { status: 400 },
      );
    }

    const cleanIdentifier = identifier.trim();

    // ✅ Removed username — your users table only has email and name
    const rows = await query(
      `SELECT * FROM users
       WHERE LOWER(email) = LOWER($1)
          OR LOWER(name)  = LOWER($1)
       LIMIT 1`,
      [cleanIdentifier],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { message: "No account found with that email or username." },
        { status: 401 },
      );
    }

    const user = rows[0];

    if (!user.password || user.password.trim() !== password.trim()) {
      return NextResponse.json(
        { message: "Incorrect password. Please try again." },
        { status: 401 },
      );
    }

    if (user.is_active === false) {
      return NextResponse.json(
        { message: "Account deactivated. Please contact admin." },
        { status: 403 },
      );
    }

    const userData = {
      _id: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.is_active,
    };

    const response = NextResponse.json(
      {
        message: "Login successful.",
        user: { ...userData, password: user.password },
      },
      { status: 200 },
    );

    // Set HttpOnly cookie for session (valid for 7 days)
    response.cookies.set({
      name: "crm_session",
      value: Buffer.from(JSON.stringify(userData)).toString("base64"),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error: any) {
    console.error("Login error:", error);
    // ✅ Return actual error message so you can debug from browser
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
