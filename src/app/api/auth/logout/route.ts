// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const response = NextResponse.json(
    { message: "Logout successful" },
    { status: 200 }
  );

  // Clear the auth cookie
  response.cookies.set({
    name: "crm_session",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0), // Expire immediately
  });

  return response;
}
