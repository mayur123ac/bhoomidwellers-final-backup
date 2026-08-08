// api/settings/manual-calling/route.ts — admin CRUD for click-to-call creds.
//
// Mirrors api/settings/bolna/route.ts, including the rule that matters: GET
// never returns the API token. It returns the summary, whose token field is a
// mask computed by decrypting and re-masking. A route that returned the token so
// the form could prefill it would put a live credential into the page's HTML.

import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import {
  clearManualCallingSettings,
  getManualCallingSummary,
  ManualCallingConfigError,
  saveManualCallingSettings,
  SUPPORTED_MANUAL_PROVIDERS,
} from "@/lib/manualCallingSettings";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["admin"];

/** Best-effort; an audit write must never fail the operation it records. */
function audit(adminId: number | null, action: string) {
  query(`INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)`, [
    adminId,
    action,
  ]).catch(() => {});
}

export async function GET() {
  const gate = await requireRoles(ADMIN_ROLES);
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ success: true, settings: await getManualCallingSummary() });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err?.message || "Could not read the settings." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(ADMIN_ROLES);
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}) as Record<string, any>);

  const provider = String(body.provider ?? "exotel").trim().toLowerCase();
  const apiKey = String(body.apiKey ?? "").trim();
  const accountSid = String(body.accountSid ?? "").trim();
  const callerId = String(body.callerId ?? "").trim();
  const subdomain = String(body.subdomain ?? "").trim();
  // Absent means "keep the stored token"; the form sends it only when edited.
  const apiToken =
    typeof body.apiToken === "string" && body.apiToken.trim() ? body.apiToken.trim() : null;

  const fieldErrors: Record<string, string> = {};

  if (!(SUPPORTED_MANUAL_PROVIDERS as readonly string[]).includes(provider)) {
    // Offering a provider the server cannot dial would be worse than refusing:
    // the admin would save a key and believe calling was configured.
    fieldErrors.provider = `Only ${SUPPORTED_MANUAL_PROVIDERS.join(", ")} is implemented so far.`;
  }
  if (!apiKey) fieldErrors.apiKey = "API key is required.";
  if (!accountSid) fieldErrors.accountSid = "Account SID is required.";
  if (!callerId) fieldErrors.callerId = "Caller ID (Exophone) is required.";

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ success: false, fieldErrors }, { status: 400 });
  }

  try {
    await saveManualCallingSettings({
      provider,
      apiKey,
      accountSid,
      callerId,
      subdomain,
      apiToken,
      enabled: body.enabled !== false,
      updatedBy: gate.userId,
    });
    audit(gate.userId, "manual_calling.settings.saved");
    return NextResponse.json({ success: true, settings: await getManualCallingSummary() });
  } catch (err: any) {
    const status = err instanceof ManualCallingConfigError ? 400 : 500;
    return NextResponse.json(
      { success: false, message: err?.message || "Could not save the settings." },
      { status }
    );
  }
}

export async function DELETE() {
  const gate = await requireRoles(ADMIN_ROLES);
  if (!gate.ok) return gate.response;

  try {
    await clearManualCallingSettings(undefined, gate.userId);
    audit(gate.userId, "manual_calling.settings.cleared");
    return NextResponse.json({ success: true, settings: await getManualCallingSummary() });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: err?.message || "Could not clear the settings." },
      { status: 500 }
    );
  }
}
