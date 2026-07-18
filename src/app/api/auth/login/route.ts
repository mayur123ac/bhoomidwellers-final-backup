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

    // Extract IP and Device Info
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "Unknown";
    const userAgent = req.headers.get("user-agent") || "Unknown Device";
    
    let device_info = userAgent;
    if (userAgent.includes("Windows")) device_info = "Windows PC";
    else if (userAgent.includes("Mac OS")) device_info = "Mac";
    else if (userAgent.includes("Android")) device_info = "Android Device";
    else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) device_info = "iOS Device";
    else if (userAgent.includes("Linux")) device_info = "Linux PC";
    
    if (userAgent.includes("Chrome") && !userAgent.includes("Edge") && !userAgent.includes("OPR")) device_info += " / Chrome";
    else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) device_info += " / Safari";
    else if (userAgent.includes("Firefox")) device_info += " / Firefox";
    else if (userAgent.includes("Edge")) device_info += " / Edge";

    const now = new Date();
    const sessionRes = await query(
      `INSERT INTO employee_sessions (user_id, session_start, last_heartbeat, ip_address, device_info, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [user.id, now, now, ip, device_info]
    );
    const loginSessionId = sessionRes[0].id;

    // Record Attendance (Auto-mark Present on first login of the day)
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const attendanceRes = await query(
      `SELECT id FROM attendance_records WHERE employee_id = $1 AND DATE(login_time AT TIME ZONE 'Asia/Kolkata') = $2 LIMIT 1`,
      [user.id, today]
    );

    if (attendanceRes.length === 0) {
      await query(
        `INSERT INTO attendance_records (organization_id, employee_id, login_session_id, attendance_status, login_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [1, user.id, loginSessionId, 'Present', now]
      );
    }

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
    return NextResponse.json({ message: "Login failed. Something went wrong." }, { status: 500 });
  }
}
