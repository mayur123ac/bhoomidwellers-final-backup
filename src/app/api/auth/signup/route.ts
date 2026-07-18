// app/api/auth/signup/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { name, email, password, role } = await req.json();

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { message: "All fields are required." },
        { status: 400 }
      );
    }

    // Check if email already exists
    const existing = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { message: "Email already exists." },
        { status: 400 }
      );
    }

    // Create user — is_active true so they can log in instantly
    await query(
      `INSERT INTO users (name, email, password, role, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        password,
        role, // keeps exact casing e.g. "Admin", "Sales Manager"
      ]
    );

    return NextResponse.json(
      { message: "Account registered successfully." },
      { status: 201 }
    );

  } catch (error) {
    console.error("SIGNUP ERROR:", error);
    return NextResponse.json(
      { message: "An error occurred during registration." },
      { status: 500 }
    );
  }
}