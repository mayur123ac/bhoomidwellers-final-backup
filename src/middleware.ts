import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/sessionCookie";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Super Admin — platform level, outside the tenant tree ────────────────
  //
  // Handled before the /dashboard check because /super-admin is deliberately
  // not under /dashboard: it operates ON tenants rather than inside one, and
  // the role gates below are all tenant roles.
  //
  // This is the coarse gate. It reads the role from the HMAC-verified cookie,
  // which is enough to keep a tenant Admin out of the page, but a cookie's copy
  // of a role can be stale — so app/super-admin/layout.tsx re-verifies against
  // the live users row, and every /api/platform route calls requireSuperAdmin()
  // independently. Middleware alone is never the authorization.
  if (pathname.startsWith("/super-admin")) {
    const cookie = request.cookies.get("crm_session")?.value;
    if (!cookie) return NextResponse.redirect(new URL("/", request.url));
    try {
      const user = await verifySession<any>(cookie);
      const role = (user?.role ?? "").toString().trim().toLowerCase().replace(/_/g, " ");
      if (role !== "super admin") {
        // Tenant roles are sent back to login rather than to /dashboard: a
        // redirect into the tenant app would confirm the platform route exists.
        return NextResponse.redirect(new URL("/", request.url));
      }
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

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

    // 2. Settings — reachable by every signed-in role.
    //
    // Settings used to be admin-only in practice: Site Head had it on an explicit
    // forbidden list, and every other non-admin role is confined to a single path
    // that isn't this one. That was fine when the page held nothing but admin
    // toggles.
    //
    // It now also holds each person's own profile, password, timezone,
    // notification and session controls, which everyone needs. The admin-only
    // sections inside it are gated server-side by requireRoles(["admin"]) on
    // their API routes and hidden from the sidebar, so opening the path up does
    // not open up what those routes do — this check was never the thing
    // protecting them.
    if (pathname.startsWith("/dashboard/settings")) {
      return NextResponse.next();
    }

    // 3. Sales Manager
    // Can only access /dashboard/sales
    if (role === "sales manager") {
      if (!pathname.startsWith("/dashboard/sales")) {
        return NextResponse.redirect(new URL("/dashboard/sales", request.url));
      }
      return NextResponse.next();
    }

    // 4. Receptionist
    // Can only access /dashboard/receptionist
    if (role === "receptionist") {
      if (!pathname.startsWith("/dashboard/receptionist")) {
        return NextResponse.redirect(
          new URL("/dashboard/receptionist", request.url),
        );
      }
      return NextResponse.next();
    }

    // 5. Site Head
    // Can access /dashboard (limited), but CANNOT access /dashboard/employees
    // or /dashboard/sales or /dashboard/receptionist or caller panel etc.
    // /dashboard/settings is handled above and is no longer forbidden — the
    // admin-only sections within it are gated by their API routes.
    if (role === "site head") {
      const forbiddenPaths = [
        "/dashboard/employees",
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

    // 6. Sourcing Manager
    // Channel Partner management only — no lead, commission or attendance panels.
    if (role === "sourcing manager") {
      if (!pathname.startsWith("/dashboard/sourcing")) {
        return NextResponse.redirect(new URL("/dashboard/sourcing", request.url));
      }
      return NextResponse.next();
    }

    // 7. Caller
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
  // /super-admin joins the matcher so the platform panel is gated at the edge
  // too. Tenant matching is unchanged.
  matcher: ["/dashboard/:path*", "/super-admin/:path*"],
};
