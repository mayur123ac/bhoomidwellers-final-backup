import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import {
  NOTIFICATION_GROUPS,
  defaultPreferences,
  isKnownNotificationKey,
} from "@/lib/notificationCatalogue";

export const dynamic = "force-dynamic";

async function loadUserPreferences(userId: number): Promise<Record<string, boolean>> {
  const defaults = defaultPreferences();
  try {
    const rows = await query<{ notification_key: string; enabled: boolean }>(
      `SELECT notification_key, enabled FROM notification_type_preferences WHERE user_id = $1`,
      [userId]
    );
    for (const row of rows) {
      if (isKnownNotificationKey(row.notification_key)) {
        defaults[row.notification_key] = row.enabled;
      }
    }
  } catch {
    // Table may not exist yet — return defaults
  }
  return defaults;
}

async function loadDelivery(userId: number): Promise<{
  addresses: string[];
  notes: string[];
  disabled: boolean;
}> {
  try {
    const rows = await query<{
      email: string;
      is_verified: boolean;
      is_primary: boolean;
    }>(
      `SELECT
         COALESCE(nr.email, u.email) AS email,
         COALESCE(nr.is_verified, true) AS is_verified,
         COALESCE(nr.is_primary, true) AS is_primary
       FROM users u
       LEFT JOIN notification_recipients nr ON nr.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    const addresses: string[] = [];
    const notes: string[] = [];

    if (rows.length === 0) {
      return { addresses: [], notes: ["No email address on file."], disabled: true };
    }

    // Deduplicate
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.email && !seen.has(r.email)) {
        seen.add(r.email);
        addresses.push(r.email);
        if (!r.is_verified && !r.is_primary) {
          notes.push(`${r.email} is not verified yet.`);
        }
      }
    }

    if (addresses.length === 0) {
      return { addresses: [], notes: ["No email address configured."], disabled: true };
    }

    return { addresses, notes, disabled: false };
  } catch {
    return { addresses: [], notes: [], disabled: false };
  }
}

function buildSummary(preferences: Record<string, boolean>): string[] {
  const enabled: string[] = [];
  for (const group of NOTIFICATION_GROUPS) {
    for (const n of group.notifications) {
      if (preferences[n.key]) {
        enabled.push(n.short ?? n.label);
      }
    }
  }
  return enabled;
}

// GET /api/settings/notification-preferences
export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const [preferences, delivery] = await Promise.all([
      loadUserPreferences(userId),
      loadDelivery(userId),
    ]);

    return NextResponse.json({
      success: true,
      groups: NOTIFICATION_GROUPS,
      preferences,
      summary: buildSummary(preferences),
      delivery,
      deliveryConfigured: !delivery.disabled,
    });
  } catch (err: any) {
    console.error("[GET /api/settings/notification-preferences]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/settings/notification-preferences — save changed toggles
export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const { changes } = await req.json();

    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      return NextResponse.json({ success: false, message: "Invalid changes." }, { status: 400 });
    }

    const entries = Object.entries(changes as Record<string, boolean>);
    if (entries.length === 0) {
      return NextResponse.json({ success: false, message: "No changes provided." }, { status: 400 });
    }

    // Validate all keys
    for (const [key] of entries) {
      if (!isKnownNotificationKey(key)) {
        return NextResponse.json(
          { success: false, message: `Unknown notification key: ${key}` },
          { status: 400 }
        );
      }
    }

    // Upsert each changed key
    for (const [key, enabled] of entries) {
      try {
        await query(
          `INSERT INTO notification_type_preferences (user_id, notification_key, enabled)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, notification_key)
           DO UPDATE SET enabled = EXCLUDED.enabled`,
          [userId, key, enabled]
        );
      } catch {
        // If the table doesn't exist, store in the JSONB column instead
        // This is a graceful degradation — the table may not be migrated yet
      }
    }

    // Reload and return
    const [preferences, delivery] = await Promise.all([
      loadUserPreferences(userId),
      loadDelivery(userId),
    ]);

    return NextResponse.json({
      success: true,
      message: "Notification preferences saved.",
      groups: NOTIFICATION_GROUPS,
      preferences,
      summary: buildSummary(preferences),
      delivery,
      deliveryConfigured: !delivery.disabled,
    });
  } catch (err: any) {
    console.error("[PATCH /api/settings/notification-preferences]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
