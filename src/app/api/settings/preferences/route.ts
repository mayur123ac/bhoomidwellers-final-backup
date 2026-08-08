// app/api/settings/preferences/route.ts — theme, language, dashboard widgets.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { diffFields, requestContext, writeAuditLog } from "@/lib/auditLog";
import {
  DASHBOARD_WIDGETS,
  DEFAULT_WIDGET_IDS,
  loadSettingsUser,
  serializeSettingsUser,
  widgetCatalogueFor,
} from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

// Two options, not three. "System default" was removed from the UI because it
// is not a theme — it is a rule for picking one, and it made "what did I choose
// last time" unanswerable when the answer depended on the OS at that moment.
//
// Rows written before this change may still hold "system". It is accepted on
// WRITE for exactly that reason (a stale browser tab posting an old value must
// not 400) and resolved to a real theme on READ by normaliseTheme() in
// lib/theme.ts. It is not offered anywhere.
const THEMES = ["light", "dark"];
const LEGACY_THEMES = ["system"];
// Hindi and Marathi are offered because the spec lists them, but no translation
// catalogue exists — the setting is stored and the UI stays English. The
// Preferences screen says so beside the dropdown rather than letting someone
// pick Marathi and wonder why nothing changed.
const LANGUAGES = ["en-US", "hi-IN", "mr-IN"];

const VALID_WIDGET_IDS = new Set<string>(DASHBOARD_WIDGETS.map((w) => w.id));

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  const row = await loadSettingsUser(gate.userId);
  if (!row) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    user: serializeSettingsUser(row),
    // Scoped to the role: empty for anyone whose dashboard has no widget layer,
    // which is how the Preferences screen knows to drop the section entirely.
    catalogue: { widgets: widgetCatalogueFor(row.role), languages: LANGUAGES, themes: THEMES },
  });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json({ success: false, message: "Session carries no user id." }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const before = await loadSettingsUser(gate.userId);
  if (!before) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  const updates: Record<string, any> = {};

  // Widget writes are refused outright for a role with no catalogue, rather
  // than being filtered down to an empty list — filtering would quietly store
  // "no widgets at all", which is a different thing from "this role has no
  // widgets" and would be indistinguishable later.
  const allowedWidgets = widgetCatalogueFor(before.role);
  if (
    allowedWidgets.length === 0 &&
    (body.dashboardWidgets !== undefined || body.resetDashboard === true)
  ) {
    return NextResponse.json(
      { success: false, message: "Dashboard widgets are not configurable for your role." },
      { status: 400 }
    );
  }

  if (body.theme !== undefined) {
    if (!THEMES.includes(body.theme) && !LEGACY_THEMES.includes(body.theme)) {
      return NextResponse.json({ success: false, message: "Unknown theme." }, { status: 400 });
    }
    // A legacy "system" post is normalised on the way in rather than stored, so
    // the column drains of the old value as people use the app instead of
    // needing a migration.
    updates.theme_preference = THEMES.includes(body.theme) ? body.theme : "light";
  }

  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) {
      return NextResponse.json({ success: false, message: "Unsupported language." }, { status: 400 });
    }
    updates.language = body.language;
  }

  if (body.dashboardWidgets !== undefined) {
    if (!Array.isArray(body.dashboardWidgets)) {
      return NextResponse.json(
        { success: false, message: "Widget selection must be a list." },
        { status: 400 }
      );
    }
    // Filter against the catalogue rather than storing whatever arrives, so a
    // stale client cannot persist ids the dashboard will never render.
    const widgets = body.dashboardWidgets
      .map((w: unknown) => String(w))
      .filter((w: string) => VALID_WIDGET_IDS.has(w));
    updates.dashboard_config = JSON.stringify({ widgets });
  }

  // "Reset dashboard to defaults" — an explicit flag rather than the client
  // posting the full default list, so the meaning of "default" stays server-side.
  if (body.resetDashboard === true) {
    updates.dashboard_config = JSON.stringify({ widgets: DEFAULT_WIDGET_IDS });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, message: "Nothing to update." }, { status: 400 });
  }

  const setClauses = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`);
  const values = [...Object.values(updates), gate.userId];

  await query(
    `UPDATE users SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = $${values.length}`,
    values
  );

  const { old, next } = diffFields(before as any, updates);
  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: before.name,
    action: "preferences.update",
    entityType: "user",
    entityId: gate.userId,
    oldValue: old,
    newValue: next,
    ipAddress: ip,
    userAgent,
  });

  const after = await loadSettingsUser(gate.userId);
  return NextResponse.json({
    success: true,
    user: after ? serializeSettingsUser(after) : null,
    message: "Preferences saved",
  });
}
