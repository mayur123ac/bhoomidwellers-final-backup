import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

/**
 * GET /api/site-locations
 * Returns all site locations for the current user's organization.
 * Available to any authenticated user (receptionist, caller, admin, etc.).
 * Used by the Client Enquiry Form dropdown.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session?.role) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const orgId = await getOrganizationId();

  // Auto-provision default location if none exists (handles pre-migration orgs)
  const existing = await query(
    `SELECT id FROM site_locations WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  if (existing.length === 0) {
    const orgRows = await query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId]
    );
    if (orgRows.length > 0) {
      await query(
        `INSERT INTO site_locations (organization_id, name, is_default)
         VALUES ($1, $2, true)
         ON CONFLICT DO NOTHING`,
        [orgId, orgRows[0].name]
      );
    }
  }

  const rows = await query<{
    id: number;
    name: string;
    display_name: string | null;
    is_default: boolean;
  }>(
    `SELECT id, name, display_name, is_default
     FROM site_locations
     WHERE organization_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [orgId]
  );

  return NextResponse.json({ success: true, locations: rows });
}
