import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import {
  loadSettingsUser,
  mergeNotificationPrefs,
} from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

// GET /api/settings/notifications — returns the user's notification prefs (inApp section)
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

    const prefs = mergeNotificationPrefs(row.notification_prefs);
    return NextResponse.json({ success: true, prefs, message: "OK" });
  } catch (err: any) {
    console.error("[GET /api/settings/notifications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/settings/notifications — update the inApp portion of notification_prefs
export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const body = await req.json();

    // Load current prefs
    const row = await loadSettingsUser(userId);
    if (!row) {
      return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
    }

    const current = mergeNotificationPrefs(row.notification_prefs);

    // Merge the inApp portion from the request body over the current value
    if (body.inApp && typeof body.inApp === "object") {
      const patch = body.inApp;
      if (typeof patch.browser === "boolean") current.inApp.browser = patch.browser;
      if (typeof patch.sound === "boolean") current.inApp.sound = patch.sound;
      if (typeof patch.dndEnabled === "boolean") current.inApp.dndEnabled = patch.dndEnabled;
      if (typeof patch.dndStart === "string") current.inApp.dndStart = patch.dndStart;
      if (typeof patch.dndEnd === "string") current.inApp.dndEnd = patch.dndEnd;
    }

    // Write back the whole blob, preserving the email/frequency portions
    await query(
      `UPDATE users SET notification_prefs = $1::jsonb WHERE id = $2`,
      [JSON.stringify(current), userId]
    );

    return NextResponse.json({
      success: true,
      prefs: current,
      message: "Notification preferences saved.",
    });
  } catch (err: any) {
    console.error("[PATCH /api/settings/notifications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
