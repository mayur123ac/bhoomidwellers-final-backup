// lib/manualCallingSettings.ts — reads and writes the manual-calling row of
// integration_settings.
//
// Deliberately a sibling of lib/bolnaSettings.ts rather than a new table. That
// migration already made the point: integration_settings is generic "because the
// next integration will want the same three things: some public config, some
// secrets, and a record of whether the credentials last verified." This is that
// next integration, so it needs no schema change at all.
//
// The same boundary applies and is enforced the same way by shape: nothing here
// returns the decrypted key except getManualCallingCredentials(), whose only
// callers are server modules. Route handlers respond with the summary, which
// carries a mask.
//
// ── Two modes ────────────────────────────────────────────────────────────────
//
//   provider  A key is stored. The server asks the telephony provider to ring
//             the agent's own handset and bridge it to the contact. The CRM user
//             never sees the contact's number and the call is logged by the
//             provider.
//   tel       No key. The button falls back to a `tel:` URL and the user's own
//             device places the call.
//
// The button is therefore disabled only when there is no phone number to dial —
// an unconfigured provider degrades rather than dead-ends. This differs from the
// AI call button, which genuinely cannot do anything without Bolna credentials.

import { query } from "@/lib/db";
import { getOrganizationId } from "./tenantContext";
import {
  decryptSecret,
  encryptSecret,
  isSecretsCryptoConfigured,
  maskSecret,
  SecretsCryptoError,
} from "@/lib/secretsCrypto";

const PROVIDER_ROW = "manual_calling";

/** Matches lib/bolnaSettings.ts — this CRM is single-tenant. */

/**
 * Providers whose click-to-call the server can actually perform.
 *
 * Listing a provider here is a claim that dialViaProvider() implements it. The
 * settings form offers only these, because an admin who can select "Knowlarity"
 * and save a key has been told the integration works when it does not.
 */
export const SUPPORTED_MANUAL_PROVIDERS = ["exotel"] as const;
export type ManualProvider = (typeof SUPPORTED_MANUAL_PROVIDERS)[number];

export interface ManualCallingCredentials {
  provider: ManualProvider;
  /** Exotel API token — the secret half of the Basic auth pair. */
  apiToken: string;
  /** Exotel API key — the username half. Not a secret on its own. */
  apiKey: string;
  accountSid: string;
  /** The Exophone shown as caller ID on both legs. */
  callerId: string;
  /** Regional API host, e.g. "api.exotel.com" or "api.in.exotel.com". */
  subdomain: string;
}

export interface ManualCallingSummary {
  /** A usable provider configuration exists. */
  configured: boolean;
  enabled: boolean;
  provider: ManualProvider;
  apiTokenMask: string;
  apiKey: string;
  accountSid: string;
  callerId: string;
  subdomain: string;
  lastVerifiedAt: string | null;
  lastVerifyError: string | null;
  updatedAt: string | null;
  encryptionReady: boolean;
}

interface IntegrationRow {
  settings: Record<string, any> | null;
  secrets: Record<string, any> | null;
  enabled: boolean;
  last_verified_at: Date | null;
  last_verify_error: string | null;
  updated_at: Date | null;
}

async function readRow(orgId?: string): Promise<IntegrationRow | null> {
  const rows = await query<IntegrationRow>(
    `SELECT settings, secrets, enabled, last_verified_at, last_verify_error, updated_at
       FROM integration_settings
      WHERE organization_id = $1 AND provider = $2`,
    [orgId ?? await getOrganizationId(), PROVIDER_ROW]
  );
  return rows[0] ?? null;
}

function normalizeProvider(value: unknown): ManualProvider {
  const v = String(value ?? "").trim().toLowerCase();
  return (SUPPORTED_MANUAL_PROVIDERS as readonly string[]).includes(v)
    ? (v as ManualProvider)
    : "exotel";
}

// ── reading credentials (server-only) ────────────────────────────────────────

/**
 * The decrypted credentials, or null when provider dialling is not available.
 *
 * Null is the ordinary "not set up" answer and callers treat it as the signal to
 * fall back to `tel:`. A decryption fault throws, for the same reason it does in
 * bolnaSettings: a key that exists but cannot be read is a real fault, and
 * reporting it as "not configured" sends an operator to re-enter credentials
 * that were fine.
 */
export async function getManualCallingCredentials(
  orgId?: string
): Promise<ManualCallingCredentials | null> {
  const row = await readRow(orgId);
  if (!row || row.enabled === false) return null;

  const apiToken = row.secrets?.apiToken ? decryptSecret(row.secrets.apiToken) : "";
  const apiKey = String(row.settings?.apiKey ?? "");
  const accountSid = String(row.settings?.accountSid ?? "");
  const callerId = String(row.settings?.callerId ?? "");
  const subdomain = String(row.settings?.subdomain ?? "") || "api.exotel.com";

  // Every field is used on every dial, so a partial configuration is not a
  // usable one — better to fall back to tel: than to fail at the provider.
  if (!apiToken || !apiKey || !accountSid || !callerId) return null;

  return {
    provider: normalizeProvider(row.settings?.provider),
    apiToken,
    apiKey,
    accountSid,
    callerId,
    subdomain,
  };
}

/** Whether provider click-to-call can be used right now. Never throws. */
export async function isManualCallingConfigured(orgId?: string): Promise<boolean> {
  try {
    return (await getManualCallingCredentials(orgId)) !== null;
  } catch {
    return false;
  }
}

// ── the safe projection ──────────────────────────────────────────────────────

/** Everything the settings panel needs, with the token reduced to a mask. */
export async function getManualCallingSummary(
  orgId?: string
): Promise<ManualCallingSummary> {
  const row = await readRow(orgId);
  const encryptionReady = isSecretsCryptoConfigured();

  let apiTokenMask = "";
  let decryptError: string | null = null;

  if (row?.secrets?.apiToken) {
    try {
      // Re-masking from the ciphertext rather than storing a mask proves the
      // stored value is still decryptable with the current key.
      apiTokenMask = maskSecret(decryptSecret(row.secrets.apiToken));
    } catch (err) {
      apiTokenMask = "";
      decryptError =
        err instanceof SecretsCryptoError
          ? err.message
          : "Stored API token could not be read.";
    }
  }

  const apiKey = String(row?.settings?.apiKey ?? "");
  const accountSid = String(row?.settings?.accountSid ?? "");
  const callerId = String(row?.settings?.callerId ?? "");

  return {
    configured: Boolean(apiTokenMask && apiKey && accountSid && callerId),
    enabled: row ? row.enabled : true,
    provider: normalizeProvider(row?.settings?.provider),
    apiTokenMask,
    apiKey,
    accountSid,
    callerId,
    subdomain: String(row?.settings?.subdomain ?? "") || "api.exotel.com",
    lastVerifiedAt: row?.last_verified_at ? row.last_verified_at.toISOString() : null,
    lastVerifyError: decryptError ?? row?.last_verify_error ?? null,
    updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
    encryptionReady,
  };
}

// ── writing ──────────────────────────────────────────────────────────────────

export class ManualCallingConfigError extends Error {}

/**
 * Upserts the credentials.
 *
 * `apiToken` is optional on update so an admin can correct the Exophone or the
 * account SID without re-typing a token they cannot read back; the panel sends
 * it only when the field was edited.
 */
export async function saveManualCallingSettings(params: {
  orgId?: string;
  provider: string;
  apiKey: string;
  accountSid: string;
  callerId: string;
  subdomain?: string;
  /** Omit or pass null to retain the currently stored token. */
  apiToken?: string | null;
  enabled?: boolean;
  updatedBy?: number | null;
}): Promise<void> {
  const orgId = params.orgId ?? await getOrganizationId();

  if (!isSecretsCryptoConfigured()) {
    throw new ManualCallingConfigError(
      "Cannot store the API token: SECRETS_ENCRYPTION_KEY is not set on the server. " +
        "Storing it unencrypted is not an option this app offers."
    );
  }

  const existing = await readRow(orgId);

  let secrets: Record<string, any> = existing?.secrets ?? {};
  if (params.apiToken) {
    secrets = { ...secrets, apiToken: encryptSecret(params.apiToken.trim()) };
  }
  if (!secrets.apiToken) {
    throw new ManualCallingConfigError("An API token is required the first time you save.");
  }

  const settings = {
    ...(existing?.settings ?? {}),
    provider: normalizeProvider(params.provider),
    apiKey: params.apiKey.trim(),
    accountSid: params.accountSid.trim(),
    callerId: params.callerId.trim(),
    subdomain: (params.subdomain ?? "").trim() || "api.exotel.com",
  };

  await query(
    `INSERT INTO integration_settings
       (organization_id, provider, settings, secrets, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (organization_id, provider) DO UPDATE SET
       settings   = EXCLUDED.settings,
       secrets    = EXCLUDED.secrets,
       enabled    = EXCLUDED.enabled,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [
      orgId,
      PROVIDER_ROW,
      JSON.stringify(settings),
      JSON.stringify(secrets),
      params.enabled ?? true,
      params.updatedBy ?? null,
    ]
  );
}

/** Clears the stored credentials, returning the CRM to `tel:` mode. */
export async function clearManualCallingSettings(
  orgId?: string,
  updatedBy?: number | null
) {
  await query(
    `UPDATE integration_settings
        SET secrets = '{}'::jsonb,
            settings = '{}'::jsonb,
            last_verified_at = NULL,
            last_verify_error = NULL,
            updated_by = $2,
            updated_at = NOW()
      WHERE organization_id = $1 AND provider = $3`,
    [orgId ?? await getOrganizationId(), updatedBy ?? null, PROVIDER_ROW]
  );
}
