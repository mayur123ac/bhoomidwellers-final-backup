// app/api/settings/workspace/route.ts — workspace-level settings and stats.
//
// Backed by the single `organization_settings` row (organization_id = 1). There
// is no `organizations` table and this is not multi-tenant; the spec's workspace
// model maps onto that one row.
//
// The lead-sorting and SM-upload toggles already have their own routes
// (../lead-sorting, ../sm-upload) and keep them — the lead-sorting POST also
// triggers a full sr_no recalculation, which is not something to duplicate here.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { diffFields, requestContext, writeAuditLog } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

const INDUSTRIES = ["Real Estate", "Finance", "Other"];
const CURRENCIES = ["INR", "USD", "AED", "GBP", "EUR"];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface WorkspaceRow {
  organization_id: number;
  workspace_name: string | null;
  industry: string | null;
  currency: string | null;
  timezone: string | null;
  logo_key: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  lock_dashboard: boolean | null;
  force_theme: string | null;
  lead_number_sorting_enabled: boolean | null;
  allow_sm_upload: boolean | null;
  shift_start: string | null;
  shift_end: string | null;
}

async function loadWorkspace(): Promise<WorkspaceRow | null> {
  const rows = await query<WorkspaceRow>(
    `SELECT organization_id, workspace_name, industry, currency, timezone,
            logo_key, logo_url, primary_color, secondary_color,
            lock_dashboard, force_theme, lead_number_sorting_enabled,
            allow_sm_upload, shift_start, shift_end
       FROM organization_settings
      WHERE organization_id = 1`
  );
  return rows[0] ?? null;
}

export async function GET() {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  const row = await loadWorkspace();
  if (!row) {
    return NextResponse.json(
      { success: false, message: "Workspace settings row is missing." },
      { status: 404 }
    );
  }

  // Counted live rather than cached. These are small tables and an admin opening
  // this screen a few times a day does not justify a staleness bug.
  const [leads, bookings, users, cps] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM walkin_enquiries`),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM booking_applications`),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE deleted_at IS NULL AND is_active = true`
    ),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM channel_partners`),
  ]);

  return NextResponse.json({
    success: true,
    workspace: {
      name: row.workspace_name || "Bhoomi Dwellers",
      // Read-only in the UI: this deployment has no slug routing, so a workspace
      // URL would be a field that looks editable and controls nothing.
      slug: "bhoomi-dwellers",
      industry: row.industry || "Real Estate",
      currency: row.currency || "INR",
      timezone: row.timezone || "Asia/Kolkata",
      logoUrl: row.logo_key
        ? `/api/r2-proxy?key=${encodeURIComponent(row.logo_key)}`
        : row.logo_url,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      lockDashboard: Boolean(row.lock_dashboard),
      forceTheme: row.force_theme,
      shiftStart: row.shift_start,
      shiftEnd: row.shift_end,
      leadNumberSortingEnabled: Boolean(row.lead_number_sorting_enabled),
      allowSmUpload: Boolean(row.allow_sm_upload),
    },
    stats: {
      leads: Number(leads[0]?.count ?? 0),
      bookings: Number(bookings[0]?.count ?? 0),
      users: Number(users[0]?.count ?? 0),
      channelPartners: Number(cps[0]?.count ?? 0),
    },
    catalogue: { industries: INDUSTRIES, currencies: CURRENCIES },
  });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const before = await loadWorkspace();
  if (!before) {
    return NextResponse.json(
      { success: false, message: "Workspace settings row is missing." },
      { status: 404 }
    );
  }

  const updates: Record<string, any> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 255) {
      return NextResponse.json(
        { success: false, message: "Workspace name is required (max 255 characters)." },
        { status: 400 }
      );
    }
    updates.workspace_name = name;
  }

  if (body.industry !== undefined) {
    if (!INDUSTRIES.includes(body.industry)) {
      return NextResponse.json({ success: false, message: "Unknown industry." }, { status: 400 });
    }
    updates.industry = body.industry;
  }

  if (body.currency !== undefined) {
    if (!CURRENCIES.includes(body.currency)) {
      return NextResponse.json({ success: false, message: "Unsupported currency." }, { status: 400 });
    }
    updates.currency = body.currency;
  }

  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: String(body.timezone) });
    } catch {
      return NextResponse.json({ success: false, message: "Unrecognised timezone." }, { status: 400 });
    }
    updates.timezone = String(body.timezone);
  }

  for (const [field, column] of [
    ["primaryColor", "primary_color"],
    ["secondaryColor", "secondary_color"],
  ] as const) {
    if (body[field] !== undefined) {
      const value = body[field] ? String(body[field]).trim() : null;
      if (value && !HEX_RE.test(value)) {
        return NextResponse.json(
          { success: false, message: "Colours must be 6-digit hex, e.g. #17a2b8." },
          { status: 400 }
        );
      }
      updates[column] = value;
    }
  }

  if (body.lockDashboard !== undefined) {
    updates.lock_dashboard = Boolean(body.lockDashboard);
  }

  if (body.forceTheme !== undefined) {
    const theme = body.forceTheme ? String(body.forceTheme) : null;
    if (theme && !["light", "dark"].includes(theme)) {
      return NextResponse.json(
        { success: false, message: "Forced theme must be light or dark." },
        { status: 400 }
      );
    }
    updates.force_theme = theme;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, message: "Nothing to update." }, { status: 400 });
  }

  const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`);
  const values = [...Object.values(updates), gate.userId];

  await query(
    `UPDATE organization_settings
        SET ${setClauses.join(", ")}, updated_by = $${values.length}, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = 1`,
    values
  );

  const { old, next } = diffFields(before as any, updates);
  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: gate.session.name,
    action: "workspace.update",
    entityType: "workspace",
    entityId: 1,
    oldValue: old,
    newValue: next,
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({ success: true, message: "Workspace settings saved" });
}
