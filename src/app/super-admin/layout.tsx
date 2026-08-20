// app/super-admin/layout.tsx — the authoritative gate on the panel itself.
//
// A server component, so this runs before any Super Admin markup is generated
// and cannot be skipped by a client that ignores a redirect.
//
// It exists in addition to the middleware check because the two verify
// different things. Middleware reads the role from the signed cookie, at the
// edge, without a database — fast, and enough to turn away a tenant Admin. This
// re-reads the live `users` row, so a session minted before the account was
// demoted, deactivated, deleted, or given an organization stops working here
// even though its cookie still says "super_admin".
//
// Every /api/platform route repeats the same check independently: a page guard
// protects the page, not the data behind it.
import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/superAdmin";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getSuperAdmin();

  // Sent to login rather than to /dashboard. A tenant user who guesses this URL
  // learns nothing about whether the route exists, and a genuine Super Admin
  // whose session lapsed lands where they can sign in again.
  if (!admin) redirect("/");

  return <>{children}</>;
}
