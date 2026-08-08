// app/api/settings/notification-preferences/route.ts — the notification centre.
//
// ── One request, whole screen ───────────────────────────────────────────────
// GET returns the catalogue, the user's resolved preferences, the delivery
// preview and the transport status together. The screen renders roughly fifty
// switches across seven groups, and the alternative — a request per group, or a
// catalogue request followed by a preferences request — is a loading state that
// fills in unevenly and a set of failure modes where half the page is real.
//
// The catalogue travels with the response rather than being duplicated in the
// component. That is what makes the notification types not hardcoded in the UI:
// adding one to lib/notificationCatalogue.ts makes it appear here, and the
// screen renders whatever arrives.
//
// ── PATCH takes a batch ─────────────────────────────────────────────────────
// The screen accumulates changes locally and sends them on Save, as one object.
// A call per toggle would be forty requests for one "Enable all", each able to
// fail independently, leaving a state neither the user nor the server intended.
//
// Only CHANGED keys are sent, not the full set. Posting all fifty every time
// would write an explicit row for every key the user never touched, which
// destroys the sparse-storage property the whole design rests on — see the
// header of notification_type_preferences_2026-08-07.sql.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import { isMailConfigured } from "@/lib/email/config";
import { getPreferences, resolveRecipients } from "@/lib/emailRouting";
import { NOTIFICATION_GROUPS, isKnownNotificationKey } from "@/lib/notificationCatalogue";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  summarise,
} from "@/lib/notificationPreferenceService";

export const dynamic = "force-dynamic";

/** Guards against a client posting an unbounded object. */
const MAX_CHANGES_PER_REQUEST = 200;

/**
 * Where this user's mail would go right now.
 *
 * Computed from the same functions the send path uses, not re-derived, so the
 * preview cannot drift from the behaviour it is previewing.
 */
async function deliveryPreview(userId: number) {
  const routing = await getPreferences(userId);

  if (!routing) {
    return { addresses: [] as string[], notes: ["User not found."], disabled: true };
  }

  const { addresses, notes } = resolveRecipients(routing);

  return {
    addresses,
    notes,
    // Both destinations off is a legitimate, saveable state; the screen says so
    // rather than showing an empty list with no explanation.
    disabled: addresses.length === 0,
  };
}

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user id." },
      { status: 400 }
    );
  }

  const preferences = await getNotificationPreferences(gate.userId);

  return NextResponse.json({
    success: true,
    groups: NOTIFICATION_GROUPS,
    preferences,
    summary: summarise(preferences),
    delivery: await deliveryPreview(gate.userId),
    // Lets the screen say plainly that preferences are stored but nothing is
    // sending yet, rather than implying mail is flowing.
    deliveryConfigured: isMailConfigured(),
  });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  if (!gate.userId) {
    return NextResponse.json(
      { success: false, message: "Session carries no user id." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const incoming =
    body && typeof body === "object" ? (body as { changes?: unknown }).changes : undefined;

  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json(
      { success: false, message: "Expected a `changes` object of notification key to boolean." },
      { status: 400 }
    );
  }

  const keys = Object.keys(incoming);

  if (keys.length > MAX_CHANGES_PER_REQUEST) {
    return NextResponse.json(
      { success: false, message: `Too many changes in one request (max ${MAX_CHANGES_PER_REQUEST}).` },
      { status: 400 }
    );
  }

  // Validated here rather than inside the service so an unknown key is a 400
  // the caller can act on. The service also filters — it is reachable from
  // server code that never sees this route — but a silent drop is the wrong
  // answer to a browser posting something this build does not recognise,
  // because the user would watch their toggle revert with no explanation.
  const unknown = keys.filter((key) => !isKnownNotificationKey(key));
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        success: false,
        message: `Unknown notification ${unknown.length === 1 ? "key" : "keys"}: ${unknown
          .slice(0, 5)
          .join(", ")}. Reload the page — these settings are from an older version.`,
      },
      { status: 400 }
    );
  }

  const raw = incoming as Record<string, unknown>;
  const changes: Record<string, boolean> = {};
  for (const key of keys) changes[key] = Boolean(raw[key]);

  // Read before writing, so the audit log records what actually changed rather
  // than everything the client happened to send.
  const before = await getNotificationPreferences(gate.userId);

  await setNotificationPreferences(gate.userId, changes);

  const preferences = await getNotificationPreferences(gate.userId);

  const changed: Record<string, { from: boolean; to: boolean }> = {};
  for (const key of keys) {
    if (before[key] !== preferences[key]) {
      changed[key] = { from: before[key], to: preferences[key] };
    }
  }

  // A no-op save is not worth an audit entry — the screen can post a batch that
  // nets out to nothing if a user toggles something and toggles it back.
  if (Object.keys(changed).length > 0) {
    const { ip, userAgent } = requestContext(req);
    await writeAuditLog({
      userId: gate.userId,
      actorName: gate.session.name,
      action: "notification_preferences.update",
      entityType: "user",
      entityId: gate.userId,
      oldValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
      newValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
      ipAddress: ip,
      userAgent,
    });
  }

  const count = Object.keys(changed).length;

  return NextResponse.json({
    success: true,
    preferences,
    summary: summarise(preferences),
    delivery: await deliveryPreview(gate.userId),
    deliveryConfigured: isMailConfigured(),
    message:
      count === 0
        ? "No changes to save"
        : `${count} notification ${count === 1 ? "preference" : "preferences"} saved`,
  });
}
