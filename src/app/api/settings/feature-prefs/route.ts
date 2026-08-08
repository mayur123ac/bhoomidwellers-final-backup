// app/api/settings/feature-prefs/route.ts — Settings → Additional Features.
//
// Two different kinds of thing come back from GET and they must not be confused:
//
//   `prefs`    — YOUR row. Editable by you, scoped to your session's user id, so
//                there is no target parameter to tamper with.
//   `platform` — org-wide state (click-to-call, Bolna, lead-number sorting) that
//                only an admin can change. Reported here as plain booleans so a
//                Sales Manager can see WHY a feature is or isn't available
//                without being handed a control that would 403, and without the
//                masked credentials that /api/settings/manual-calling returns.
//
// PATCH never touches `platform`. That is the whole security story of this file.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { requestContext, writeAuditLog } from "@/lib/auditLog";
import {
  FEATURE_TOGGLES,
  LEAD_SORT_OPTIONS,
  applyFeaturePrefsPatch,
  mergeFeaturePrefs,
  type FeaturePrefs,
} from "@/lib/featurePrefs";
import { getManualCallingSummary } from "@/lib/manualCallingSettings";
import { isBolnaConfigured } from "@/lib/bolnaSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UserRow {
  name: string | null;
  feature_prefs: any;
}

async function loadPrefs(userId: number): Promise<{ row: UserRow; prefs: FeaturePrefs } | null> {
  const rows = await query<UserRow>(
    `SELECT name, feature_prefs FROM public.users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (!rows[0]) return null;
  return { row: rows[0], prefs: mergeFeaturePrefs(rows[0].feature_prefs) };
}

/**
 * Org-wide availability, reduced to what a non-admin may see.
 *
 * Every lookup is wrapped: these read tables that only exist once their feature
 * has been set up at least once, and "the settings screen 500s because nobody
 * ever configured Bolna" is a worse outcome than "click-to-call shows as
 * unavailable".
 */
async function platformStatus() {
  const [calling, bolna, sorting] = await Promise.all([
    getManualCallingSummary()
      .then((s) => ({ available: Boolean(s.configured && s.enabled), provider: s.provider }))
      .catch(() => ({ available: false, provider: null as string | null })),
    isBolnaConfigured().catch(() => false),
    query<{ lead_number_sorting_enabled: boolean }>(
      `SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = 1`
    )
      .then((r) => r[0]?.lead_number_sorting_enabled === true)
      .catch(() => false),
  ]);

  return {
    clickToCall: calling,
    aiCalling: { available: bolna },
    leadNumberSorting: { enabled: sorting },
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

  const loaded = await loadPrefs(gate.userId);
  if (!loaded) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    prefs: loaded.prefs,
    platform: await platformStatus(),
    catalogue: { toggles: FEATURE_TOGGLES, leadSortOptions: LEAD_SORT_OPTIONS },
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

  const loaded = await loadPrefs(gate.userId);
  if (!loaded) {
    return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
  }

  const applied = applyFeaturePrefsPatch(loaded.prefs, body);
  if (!applied.ok) {
    return NextResponse.json({ success: false, message: applied.message }, { status: 400 });
  }

  await query(`UPDATE public.users SET feature_prefs = $1, updated_at = NOW() WHERE id = $2`, [
    JSON.stringify(applied.next),
    gate.userId,
  ]);

  const { ip, userAgent } = requestContext(req);
  await writeAuditLog({
    userId: gate.userId,
    actorName: loaded.row.name,
    action: "feature_prefs.update",
    entityType: "user",
    entityId: gate.userId,
    oldValue: loaded.prefs,
    newValue: applied.next,
    ipAddress: ip,
    userAgent,
  }).catch(() => {
    /* an audit write must never fail the save it records */
  });

  return NextResponse.json({
    success: true,
    prefs: applied.next,
    message: "Preferences saved",
  });
}
