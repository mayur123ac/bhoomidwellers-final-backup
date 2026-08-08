// api/settings/bolna/route.ts — the Calling Integration panel's backend.
//
// GET  → the masked summary. Never contains the API key.
// POST → validate against Bolna's live API, then store.
// DELETE → clear the stored credentials.
//
// Admin-only on all three. The settings panel already hides the section for
// other roles, but that is presentation: the gate is here, because a role check
// in a client component is a suggestion.

import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";
import {
  clearBolnaSettings,
  getBolnaSettingsSummary,
  saveBolnaSettings,
  validateBolnaCredentials,
} from "@/lib/bolnaSettings";
import { isSecretsCryptoConfigured, KEY_SETUP_HINT } from "@/lib/secretsCrypto";
import { redactSecrets } from "@/config/bolna.config";
import { BolnaError } from "@/types/bolna.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only these roles can see or change third-party credentials. */
const ADMIN_ROLES = ["admin"];

export async function GET(req: NextRequest) {
  const gate = await requireRoles(ADMIN_ROLES);
  if (!gate.ok) return gate.response;

  try {
    // req.nextUrl.origin so the panel can show a working webhook URL on a
    // deployment where BOLNA_PUBLIC_BASE_URL was never set.
    const summary = await getBolnaSettingsSummary(undefined, req.nextUrl.origin);
    return NextResponse.json({ success: true, settings: summary });
  } catch (err: any) {
    console.error("[GET /api/settings/bolna]", redactSecrets(String(err?.message ?? err)));
    return NextResponse.json(
      { success: false, message: "Could not load the Bolna settings." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(ADMIN_ROLES);
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json().catch(() => ({}));

    const agentId = String(body.agentId ?? "").trim();
    const phoneNumber = String(body.phoneNumber ?? "").trim();
    // Empty string means "unchanged" — the panel leaves the field blank when a
    // key is already stored, because it has no way to render one back.
    const submittedApiKey = String(body.apiKey ?? "").trim();
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    // Checked before anything else: without a key there is nowhere safe to put
    // the credentials, and every later error would be a distraction from that.
    if (!isSecretsCryptoConfigured()) {
      return NextResponse.json(
        {
          success: false,
          message:
            "The server cannot encrypt secrets yet, so the API key cannot be stored.\n\n" +
            KEY_SETUP_HINT,
          code: "ENCRYPTION_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    const current = await getBolnaSettingsSummary();

    // Validation needs a real key. When the admin is editing only the agent id
    // or the number, the stored one is used for the probe.
    let apiKeyForValidation = submittedApiKey;
    if (!apiKeyForValidation) {
      const { getBolnaCredentials } = await import("@/lib/bolnaSettings");
      const creds = await getBolnaCredentials().catch(() => null);
      apiKeyForValidation = creds?.apiKey ?? "";
    }

    if (!apiKeyForValidation) {
      return NextResponse.json(
        {
          success: false,
          message: "Enter the Bolna API key.",
          fieldErrors: { apiKey: "API key is required." },
        },
        { status: 400 }
      );
    }

    const validation = await validateBolnaCredentials({
      apiKey: apiKeyForValidation,
      agentId,
      phoneNumber,
    });

    if (!validation.ok) {
      // Nothing is written on a failed probe. Storing credentials known to be
      // wrong would leave the CRM showing a configured integration that fails
      // on every call.
      return NextResponse.json(
        {
          success: false,
          message:
            validation.formError ??
            "Some of the details were rejected by Bolna. Check the highlighted fields.",
          fieldErrors: validation.fieldErrors,
          warnings: validation.warnings,
        },
        { status: 400 }
      );
    }

    await saveBolnaSettings({
      agentId,
      phoneNumber,
      apiKey: submittedApiKey || null,
      enabled,
      updatedBy: gate.userId,
      verified: true,
      verifyError: null,
    });

    // Audit trail, matching the working-hours route. The key is not in this
    // string and must never be — `updated` is a fact about a field, not a value.
    const changed = [
      submittedApiKey ? "API key" : null,
      current.agentId !== agentId ? "agent ID" : null,
      current.phoneNumber !== phoneNumber ? "phone number" : null,
      current.enabled !== enabled ? `enabled=${enabled}` : null,
    ].filter(Boolean);

    await query(`INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)`, [
      gate.userId,
      `Admin updated Bolna calling integration (${
        changed.length ? changed.join(", ") : "re-verified"
      }); agent ${agentId}, number ${phoneNumber}`,
    ]).catch(() => {
      // The audit insert must not fail the save. The credentials are already
      // committed at this point and reporting an error would invite a retry
      // that changes nothing.
    });

    const summary = await getBolnaSettingsSummary(undefined, req.nextUrl.origin);

    return NextResponse.json({
      success: true,
      message: validation.agentName
        ? `Connected to Bolna agent "${validation.agentName}".`
        : "Bolna credentials verified and saved.",
      warnings: validation.warnings,
      settings: summary,
    });
  } catch (err: any) {
    if (err instanceof BolnaError) {
      return NextResponse.json({ success: false, message: err.message }, { status: 400 });
    }
    const message = redactSecrets(String(err?.message ?? err));
    console.error("[POST /api/settings/bolna]", message);
    return NextResponse.json(
      { success: false, message: "Could not save the Bolna settings." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const gate = await requireRoles(ADMIN_ROLES);
  if (!gate.ok) return gate.response;

  try {
    await clearBolnaSettings(undefined, gate.userId);
    await query(`INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)`, [
      gate.userId,
      "Admin disconnected the Bolna calling integration",
    ]).catch(() => {});

    return NextResponse.json({ success: true, message: "Bolna credentials removed." });
  } catch (err: any) {
    console.error("[DELETE /api/settings/bolna]", redactSecrets(String(err?.message ?? err)));
    return NextResponse.json(
      { success: false, message: "Could not remove the Bolna settings." },
      { status: 500 }
    );
  }
}
