import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import {
  loadSettingsUser,
  serializeSettingsUser,
  widgetCatalogueFor,
  DEFAULT_WIDGET_IDS,
} from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

const LANGUAGES = ["en-US", "hi-IN", "mr-IN"];

// GET /api/settings/preferences
export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const row = await loadSettingsUser(userId);
    if (!row) {
      return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
    }

    const user = serializeSettingsUser(row);
    return NextResponse.json({
      success: true,
      user: {
        language: user.language,
        dashboardWidgets: user.dashboardWidgets,
        theme: user.theme,
      },
      catalogue: {
        languages: LANGUAGES,
        widgets: widgetCatalogueFor(row.role),
      },
    });
  } catch (err: any) {
    console.error("[GET /api/settings/preferences]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/settings/preferences
export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (body.language !== undefined) {
      if (!LANGUAGES.includes(body.language)) {
        return NextResponse.json({ success: false, message: "Unknown language." }, { status: 400 });
      }
      sets.push(`language = $${idx++}`);
      params.push(body.language);
    }

    if (body.theme !== undefined) {
      const validThemes = ["light", "dark"];
      if (!validThemes.includes(body.theme)) {
        return NextResponse.json({ success: false, message: "Unknown theme." }, { status: 400 });
      }
      sets.push(`theme_preference = $${idx++}`);
      params.push(body.theme);
    }

    if (body.dashboardWidgets !== undefined) {
      // Load user to check role-based widget catalogue
      const currentRow = await loadSettingsUser(userId);
      const catalogue = widgetCatalogueFor(currentRow?.role);
      if (catalogue.length === 0) {
        return NextResponse.json(
          { success: false, message: "Your role does not have dashboard widgets." },
          { status: 403 }
        );
      }
      const validIds = new Set(catalogue.map((w) => w.id));
      const filtered = (body.dashboardWidgets as string[]).filter((id) => validIds.has(id));
      sets.push(`dashboard_config = jsonb_set(COALESCE(dashboard_config, '{}'), '{widgets}', $${idx++}::jsonb)`);
      params.push(JSON.stringify(filtered));
    }

    if (body.resetDashboard === true) {
      sets.push(`dashboard_config = jsonb_set(COALESCE(dashboard_config, '{}'), '{widgets}', $${idx++}::jsonb)`);
      params.push(JSON.stringify(DEFAULT_WIDGET_IDS));
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, message: "Nothing to update." }, { status: 400 });
    }

    params.push(userId);
    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`, params);

    const row = await loadSettingsUser(userId);
    if (!row) {
      return NextResponse.json({ success: false, message: "User not found after update." }, { status: 500 });
    }

    const user = serializeSettingsUser(row);
    return NextResponse.json({
      success: true,
      message: "Preferences saved.",
      user: {
        language: user.language,
        dashboardWidgets: user.dashboardWidgets,
        theme: user.theme,
      },
      catalogue: {
        languages: LANGUAGES,
        widgets: widgetCatalogueFor(row.role),
      },
    });
  } catch (err: any) {
    console.error("[PATCH /api/settings/preferences]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
