// app/api/settings/notifications/route.ts — the notification preference blob.
//
// ── What is left here ───────────────────────────────────────────────────────
// The `inApp` half only: browser notifications, sound, and do-not-disturb. Those
// are read by the in-app notification UI and have nothing to do with email.
//
// The `email` object and `frequency` in this blob are SUPERSEDED. Per-email
// switches now live in notification_type_preferences and are served by
// /api/settings/notification-preferences, which lib/emailRouting.ts consults
// before every send. This endpoint still merges over the stored value rather
// than the defaults, so the superseded keys are preserved untouched — nothing
// reads them, and dropping them would lose data for no gain.
//
// Do not add new email preferences here. They belong in
// lib/notificationCatalogue.ts.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { isMailConfigured } from "@/lib/email/config";
import {
  DEFAULT_NOTIFICATION_PREFS,
  loadSettingsUser,
  mergeNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/settingsUser";

export const dynamic = "force-dynamic";

const FREQUENCIES = ["instant", "daily", "weekly", "never"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    prefs: mergeNotificationPrefs(row.notification_prefs),
    defaults: DEFAULT_NOTIFICATION_PREFS,
    // Lets the UI state plainly that these are saved but not yet acted on.
    deliveryConfigured: isMailConfigured(),
  });
}

/**
 * Validate and normalise the incoming blob.
 *
 * Merged over the current stored value, not over the defaults, so a screen that
 * posts only its own tab's fields doesn't reset the other tab's toggles.
 */
function normalise(incoming: any, current: NotificationPrefs): NotificationPrefs | string {
  const next: NotificationPrefs = {
    ...current,
    email: { ...current.email },
    inApp: { ...current.inApp },
  };

  if (incoming.frequency !== undefined) {
    if (!FREQUENCIES.includes(incoming.frequency)) return "Unknown notification frequency.";
    next.frequency = incoming.frequency;
  }

  if (incoming.digestTime !== undefined) {
    if (!TIME_RE.test(String(incoming.digestTime))) return "Digest time must be HH:mm.";
    next.digestTime = String(incoming.digestTime);
  }

  if (incoming.digestDay !== undefined) {
    const day = Number(incoming.digestDay);
    if (!Number.isInteger(day) || day < 0 || day > 6) return "Digest day must be 0–6.";
    next.digestDay = day;
  }

  if (incoming.email && typeof incoming.email === "object") {
    for (const key of Object.keys(next.email) as (keyof NotificationPrefs["email"])[]) {
      if (incoming.email[key] !== undefined) next.email[key] = Boolean(incoming.email[key]);
    }
  }

  if (incoming.inApp && typeof incoming.inApp === "object") {
    for (const key of ["browser", "sound", "dndEnabled"] as const) {
      if (incoming.inApp[key] !== undefined) next.inApp[key] = Boolean(incoming.inApp[key]);
    }
    for (const key of ["dndStart", "dndEnd"] as const) {
      if (incoming.inApp[key] !== undefined) {
        if (!TIME_RE.test(String(incoming.inApp[key]))) return "Do-not-disturb times must be HH:mm.";
        next.inApp[key] = String(incoming.inApp[key]);
      }
    }
  }

  return next;
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

  const row = await loadSettingsUser(gate.userId);
  if (!row) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  const current = mergeNotificationPrefs(row.notification_prefs);
  const result = normalise(body, current);
  if (typeof result === "string") {
    return NextResponse.json({ success: false, message: result }, { status: 400 });
  }

  await query(
    `UPDATE users SET notification_prefs = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(result), gate.userId]
  );

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: row.name,
    action: "notifications.update",
    entityType: "user",
    entityId: gate.userId,
    oldValue: current,
    newValue: result,
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({
    success: true,
    prefs: result,
    message: "Notification preferences saved",
  });
}
