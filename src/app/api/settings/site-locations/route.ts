import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/site-locations
 * Returns all site locations for the admin's organization.
 * Admin only.
 */
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  // Auto-provision default location if none exists yet
  await ensureDefaultLocation(orgId);

  const rows = await query<{
    id: number;
    name: string;
    display_name: string | null;
    is_default: boolean;
    created_at: string;
  }>(
    `SELECT id, name, display_name, is_default, created_at
     FROM site_locations
     WHERE organization_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [orgId]
  );

  return NextResponse.json({ success: true, locations: rows });
}

/**
 * POST /api/settings/site-locations
 * Add a new site location to the admin's organization.
 * Admin only.
 */
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const displayName = body.display_name != null ? String(body.display_name).trim() || null : null;

  if (!name) {
    return NextResponse.json(
      { success: false, message: "Location name is required." },
      { status: 400 }
    );
  }
  if (name.length > 255 || (displayName && displayName.length > 255)) {
    return NextResponse.json(
      { success: false, message: "Name and display label must be under 255 characters." },
      { status: 400 }
    );
  }

  // Check for duplicates (case-insensitive)
  const existing = await query(
    `SELECT id FROM site_locations
     WHERE organization_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))
     LIMIT 1`,
    [orgId, name]
  );
  if (existing.length > 0) {
    return NextResponse.json(
      { success: false, message: "A location with this name already exists." },
      { status: 409 }
    );
  }

  const rows = await query<{ id: number; name: string; display_name: string | null; is_default: boolean; created_at: string }>(
    `INSERT INTO site_locations (organization_id, name, display_name, is_default)
     VALUES ($1, $2, $3, false)
     RETURNING id, name, display_name, is_default, created_at`,
    [orgId, name, displayName]
  );

  return NextResponse.json({ success: true, location: rows[0] }, { status: 201 });
}

/**
 * PATCH /api/settings/site-locations
 * Update an existing non-default site location.
 * Admin only.
 */
export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  const body = await req.json();
  const id = Number(body.id);
  const name = body.name != null ? String(body.name).trim() : null;
  // display_name: explicit empty string → clear it (set NULL); undefined → don't touch
  const hasDisplayName = "display_name" in body;
  const displayName = hasDisplayName
    ? (body.display_name ? String(body.display_name).trim() : null)
    : undefined; // undefined = not provided, won't update

  if (!id) {
    return NextResponse.json(
      { success: false, message: "Location ID is required." },
      { status: 400 }
    );
  }
  if (name != null && name.length > 255) {
    return NextResponse.json(
      { success: false, message: "Location name must be under 255 characters." },
      { status: 400 }
    );
  }
  if (displayName && displayName.length > 255) {
    return NextResponse.json(
      { success: false, message: "Display label must be under 255 characters." },
      { status: 400 }
    );
  }

  // Verify the location belongs to this org
  const loc = await query<{ is_default: boolean }>(
    `SELECT is_default FROM site_locations WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  );
  if (loc.length === 0) {
    return NextResponse.json(
      { success: false, message: "Location not found." },
      { status: 404 }
    );
  }

  // Default locations: name cannot change, but display_name CAN be set
  if (loc[0].is_default && name != null) {
    return NextResponse.json(
      { success: false, message: "The default location name cannot be changed. You can set a display label instead." },
      { status: 403 }
    );
  }

  // Name collision check (only when name is being changed)
  if (name != null && !loc[0].is_default) {
    const dup = await query(
      `SELECT id FROM site_locations
       WHERE organization_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND id != $3
       LIMIT 1`,
      [orgId, name, id]
    );
    if (dup.length > 0) {
      return NextResponse.json(
        { success: false, message: "A location with this name already exists." },
        { status: 409 }
      );
    }
  }

  // Build SET clause dynamically based on what was provided
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (name != null && !loc[0].is_default) {
    sets.push(`name = $${idx++}`);
    vals.push(name);
  }
  if (hasDisplayName) {
    sets.push(`display_name = $${idx++}`);
    vals.push(displayName); // null clears it
  }

  if (sets.length === 0) {
    return NextResponse.json({ success: true, message: "Nothing to update." });
  }

  sets.push("updated_at = now()");
  vals.push(id, orgId);
  await query(
    `UPDATE site_locations SET ${sets.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx}`,
    vals
  );

  return NextResponse.json({ success: true, message: "Location updated." });
}

/**
 * DELETE /api/settings/site-locations
 * Remove a non-default site location.
 * Admin only.
 */
export async function DELETE(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));

  if (!id) {
    return NextResponse.json(
      { success: false, message: "Location ID is required." },
      { status: 400 }
    );
  }

  // Verify ownership and non-default
  const loc = await query<{ is_default: boolean }>(
    `SELECT is_default FROM site_locations WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  );
  if (loc.length === 0) {
    return NextResponse.json(
      { success: false, message: "Location not found." },
      { status: 404 }
    );
  }
  if (loc[0].is_default) {
    return NextResponse.json(
      { success: false, message: "The default location cannot be deleted." },
      { status: 403 }
    );
  }

  // Nullify any enquiries referencing this location before deleting
  await query(
    `UPDATE walkin_enquiries SET site_location_id = NULL WHERE site_location_id = $1`,
    [id]
  );
  await query(
    `DELETE FROM site_locations WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  );

  return NextResponse.json({ success: true, message: "Location deleted." });
}

/**
 * Auto-provision the default location (org name) if it doesn't exist yet.
 * This handles organizations that existed before the migration ran.
 */
async function ensureDefaultLocation(orgId: string) {
  const existing = await query(
    `SELECT id FROM site_locations WHERE organization_id = $1 AND is_default = true LIMIT 1`,
    [orgId]
  );
  if (existing.length > 0) return;

  const orgRows = await query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );
  if (orgRows.length === 0) return;

  await query(
    `INSERT INTO site_locations (organization_id, name, is_default)
     VALUES ($1, $2, true)
     ON CONFLICT DO NOTHING`,
    [orgId, orgRows[0].name]
  );
}
