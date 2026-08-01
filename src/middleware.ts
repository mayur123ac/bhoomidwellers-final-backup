import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/sessionCookie";

export async function middleware(request: NextRequest) {
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
    // HMAC-verified, not just decoded: the role read below decides which panels
    // this request may reach, so an unsigned or edited payload must not get past
    // here. verifySession uses Web Crypto, which the Edge runtime provides.
    const user = await verifySession<any>(sessionCookie);

    if (!user || !user.role) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    // Underscores normalized to spaces: the users table holds both "site_head"
    // and "Site Head", and the same is true for any multi-word role added later.
    const role = user.role.toLowerCase().trim().replace(/_/g, " ");

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
    if (role === "site head") {
      const forbiddenPaths = [
        "/dashboard/employees",
        "/dashboard/settings",
        "/dashboard/caller",
        "/dashboard/sales",
        "/dashboard/receptionist",
        "/dashboard/sourcing",
      ];

      const isForbidden = forbiddenPaths.some((p) => pathname.startsWith(p));
      if (isForbidden) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
      return NextResponse.next();
    }

    // 5. Sourcing Manager
    // Channel Partner management only — no lead, commission or attendance panels.
    if (role === "sourcing manager") {
      if (!pathname.startsWith("/dashboard/sourcing")) {
        return NextResponse.redirect(new URL("/dashboard/sourcing", request.url));
      }
      return NextResponse.next();
    }

    // 6. Caller
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
