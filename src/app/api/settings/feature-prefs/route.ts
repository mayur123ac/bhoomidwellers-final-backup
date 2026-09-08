import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import {
  mergeFeaturePrefs,
  applyFeaturePrefsPatch,
  LEAD_SORT_OPTIONS,
  FEATURE_TOGGLES,
} from "@/lib/featurePrefs";

export const dynamic = "force-dynamic";

async function loadFeaturePrefsColumn(userId: number): Promise<unknown> {
  try {
    const rows = await query<any>(
      `SELECT feature_prefs FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return rows[0]?.feature_prefs ?? null;
  } catch {
    // Column may not exist yet
    return null;
  }
}

async function loadPlatformInfo(orgId: string | undefined) {
  const clickToCall = { available: false, provider: null as string | null };
  const aiCalling = { available: false };
  const leadNumberSorting = { enabled: false };

  try {
    if (orgId) {
      const rows = await query<any>(
        `SELECT
           bolna_api_key IS NOT NULL AND bolna_agent_id IS NOT NULL AS ai_calling,
           manual_calling_provider AS call_provider,
           lead_number_sorting_enabled
         FROM organization_settings
         WHERE organization_id = $1
         LIMIT 1`,
        [orgId]
      );
      if (rows.length > 0) {
        const r = rows[0];
        aiCalling.available = Boolean(r.ai_calling);
        if (r.call_provider) {
          clickToCall.available = true;
          clickToCall.provider = r.call_provider;
        }
        leadNumberSorting.enabled = Boolean(r.lead_number_sorting_enabled);
      }
    }
  } catch {
    // organization_settings may not exist
  }

  return { clickToCall, aiCalling, leadNumberSorting };
}

// GET /api/settings/feature-prefs
export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const stored = await loadFeaturePrefsColumn(userId);
    const prefs = mergeFeaturePrefs(stored);
    const platform = await loadPlatformInfo(gate.session.org);

    return NextResponse.json({
      success: true,
      prefs,
      platform,
      catalogue: {
        toggles: FEATURE_TOGGLES,
        leadSortOptions: LEAD_SORT_OPTIONS,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/settings/feature-prefs]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// PATCH /api/settings/feature-prefs
export async function PATCH(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  if (!userId) {
    return NextResponse.json({ success: false, message: "Session carries no user ID." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const stored = await loadFeaturePrefsColumn(userId);
    const current = mergeFeaturePrefs(stored);
    const result = applyFeaturePrefsPatch(current, body);

    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: 400 });
    }

    try {
      await query(
        `UPDATE users SET feature_prefs = $1::jsonb WHERE id = $2`,
        [JSON.stringify(result.next), userId]
      );
    } catch {
      // Column may not exist — the preference still returns merged defaults
    }

    return NextResponse.json({
      success: true,
      message: "Feature preferences saved.",
      prefs: result.next,
    });
  } catch (err: any) {
    console.error("[PATCH /api/settings/feature-prefs]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
