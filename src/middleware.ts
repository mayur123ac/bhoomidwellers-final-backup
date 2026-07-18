import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // We only care about /dashboard and its subpaths
  if (!pathname.startsWith("/dashboard")) {
    return NextResponse.next();
  }

  // Get the session cookie
  const sessionCookie = request.cookies.get("crm_session")?.value;

  if (!sessionCookie) {
    // No session, redirect to login
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    // Parse the session cookie
    const decodedStr = Buffer.from(sessionCookie, "base64").toString("utf-8");
    const user = JSON.parse(decodedStr);

    if (!user || !user.role) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    const role = user.role.toLowerCase();

    // ─── Role-Based Route Protection ──────────────────────────────────────────

    // 1. Admin
    // Admin has full access to all /dashboard paths.
    if (role === "admin") {
      return NextResponse.next();
    }

    // 2. Sales Manager
    // Can only access /dashboard/sales
    if (role === "sales manager") {
      if (!pathname.startsWith("/dashboard/sales")) {
        return NextResponse.redirect(new URL("/dashboard/sales", request.url));
      }
      return NextResponse.next();
    }

    // 3. Receptionist
    // Can only access /dashboard/receptionist
    if (role === "receptionist") {
      if (!pathname.startsWith("/dashboard/receptionist")) {
        return NextResponse.redirect(
          new URL("/dashboard/receptionist", request.url),
        );
      }
      return NextResponse.next();
    }

    // 4. Site Head
    // Can access /dashboard (limited), but CANNOT access /dashboard/employees or /dashboard/settings
    // or /dashboard/sales or /dashboard/receptionist or caller panel etc.
    if (role === "site_head" || role === "site head") {
      const forbiddenPaths = [
        "/dashboard/employees",
        "/dashboard/settings",
        "/dashboard/caller",
        "/dashboard/sales",
        "/dashboard/receptionist",
      ];

      const isForbidden = forbiddenPaths.some((p) => pathname.startsWith(p));
      if (isForbidden) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
      return NextResponse.next();
    }

    // 5. Caller
    if (role === "caller") {
      if (!pathname.startsWith("/dashboard/caller")) {
        return NextResponse.redirect(new URL("/dashboard/caller", request.url));
      }
      return NextResponse.next();
    }

    // Fallback: If role is unrecognized, redirect to login to be safe.
    return NextResponse.redirect(new URL("/", request.url));
  } catch (error) {
    // Invalid cookie format
    return NextResponse.redirect(new URL("/", request.url));
  }
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: ["/dashboard/:path*"],
};
