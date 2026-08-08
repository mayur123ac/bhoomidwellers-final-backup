// lib/bolnaSettings.ts — reads and writes the Bolna row of integration_settings.
//
// The boundary this file defends: NOTHING here returns the decrypted API key
// except getBolnaCredentials(), and every caller of that is a server module.
// Route handlers respond with toSummary()'s output, which carries a mask.
//
// The rule is enforced by shape rather than by discipline. There is no function
// that returns "the settings" in a form containing the key, so a route handler
// cannot leak one by reaching for the convenient thing.

import { query } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
  isSecretsCryptoConfigured,
  maskSecret,
  SecretsCryptoError,
} from "@/lib/secretsCrypto";
import { buildWebhookUrl, readBolnaConfig } from "@/config/bolna.config";
import { getAgent, listPhoneNumbers, toBolnaError } from "@/lib/bolna-client";
import { toE164 } from "@/lib/phone";
import {
  BolnaError,
  type BolnaCredentials,
  type BolnaSettingsSummary,
  type BolnaValidationResult,
} from "@/types/bolna.types";

const PROVIDER = "bolna";

/**
 * This CRM is single-tenant. organization_settings hard-codes `const orgId = 1`
 * in every route, and integration_settings follows the same convention rather
 * than inventing a tenancy model the rest of the app does not have. The column
 * and the unique index are there so that adding real multi-tenancy later is a
 * change to this constant and its callers, not a migration.
 */
export const DEFAULT_ORG_ID = 1;

interface IntegrationRow {
  settings: Record<string, any> | null;
  secrets: Record<string, any> | null;
  enabled: boolean;
  last_verified_at: Date | null;
  last_verify_error: string | null;
  updated_at: Date | null;
}

async function readRow(orgId = DEFAULT_ORG_ID): Promise<IntegrationRow | null> {
  const rows = await query<IntegrationRow>(
    `SELECT settings, secrets, enabled, last_verified_at, last_verify_error, updated_at
       FROM integration_settings
      WHERE organization_id = $1 AND provider = $2`,
    [orgId, PROVIDER]
  );
  return rows[0] ?? null;
}

// ── reading credentials (server-only) ────────────────────────────────────────

/**
 * The decrypted credentials, or null when the integration is not usable.
 *
 * Returns null rather than throwing for the ordinary "not set up yet" case,
 * because half the callers (the settings panel, a status badge) treat that as
 * normal. It DOES throw on a decryption failure — a key that exists but cannot
 * be read is a real fault an operator must see, and quietly reporting it as
 * "not configured" would send them to re-enter credentials that were fine.
 *
 * Environment variables are the fallback, not the override. Once an admin has
 * saved credentials in the panel, those are what the CRM uses; a stale
 * BOLNA_API_KEY left in .env.local from testing must not silently win.
 */
export async function getBolnaCredentials(
  orgId = DEFAULT_ORG_ID
): Promise<BolnaCredentials | null> {
  const cfg = readBolnaConfig();
  const row = await readRow(orgId);

  if (row && row.enabled === false) return null;

  let apiKey = "";
  if (row?.secrets?.apiKey) {
    // Deliberately unguarded: a SecretsCryptoError propagates with its own
    // actionable message (wrong key / tampered value), which is far more useful
    // than falling through to an env var that probably is not set either.
    apiKey = decryptSecret(row.secrets.apiKey);
  }
  if (!apiKey) apiKey = cfg.envApiKey ?? "";

  const agentId = String(row?.settings?.agentId ?? "") || cfg.envAgentId || "";
  const phoneNumber = String(row?.settings?.phoneNumber ?? "") || cfg.envPhoneNumber || "";

  // The agent id is as required as the key: every operation this integration
  // performs names an agent, so two-thirds-configured is not a usable state.
  if (!apiKey || !agentId) return null;

  return { apiKey, agentId, phoneNumber };
}

/** Whether a call can actually be placed right now. Never throws. */
export async function isBolnaConfigured(orgId = DEFAULT_ORG_ID): Promise<boolean> {
  if (!readBolnaConfig().enabled) return false;
  try {
    return (await getBolnaCredentials(orgId)) !== null;
  } catch {
    return false;
  }
}

// ── the safe projection ──────────────────────────────────────────────────────

/**
 * Everything the settings panel needs, with the key reduced to a mask.
 *
 * The mask is computed by decrypting and re-masking rather than by storing a
 * mask alongside the ciphertext. That costs one AES operation per page load and
 * buys a guarantee: a mask that renders proves the stored value is decryptable
 * with the current key. Storing the mask separately would let the panel show a
 * confident `bn-••••••••4f2a` for a secret that has been unreadable since
 * someone rotated SECRETS_ENCRYPTION_KEY.
 */
export async function getBolnaSettingsSummary(
  orgId = DEFAULT_ORG_ID,
  reqOrigin?: string | null
): Promise<BolnaSettingsSummary> {
  const cfg = readBolnaConfig();
  const row = await readRow(orgId);
  const encryptionReady = isSecretsCryptoConfigured();

  let apiKeyMask = "";
  let decryptError: string | null = null;

  if (row?.secrets?.apiKey) {
    try {
      apiKeyMask = maskSecret(decryptSecret(row.secrets.apiKey));
    } catch (err) {
      apiKeyMask = "";
      decryptError =
        err instanceof SecretsCryptoError
          ? err.message
          : "Stored API key could not be read.";
    }
  } else if (cfg.envApiKey) {
    // Shown so an admin looking at a working integration with an empty panel
    // understands where the credentials are actually coming from.
    apiKeyMask = `${maskSecret(cfg.envApiKey)} (from BOLNA_API_KEY)`;
  }

  const agentId = String(row?.settings?.agentId ?? "") || cfg.envAgentId || "";
  const phoneNumber = String(row?.settings?.phoneNumber ?? "") || cfg.envPhoneNumber || "";

  return {
    configured: Boolean(apiKeyMask && agentId),
    enabled: row ? row.enabled : cfg.enabled,
    apiKeyMask,
    agentId,
    phoneNumber,
    lastVerifiedAt: row?.last_verified_at ? row.last_verified_at.toISOString() : null,
    // A decryption fault outranks whatever the last save recorded: it is the
    // thing currently broken.
    lastVerifyError: decryptError ?? row?.last_verify_error ?? null,
    updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
    encryptionReady,
    webCallEnabled: cfg.webCallEnabled,
    webhookUrl: buildWebhookUrl(reqOrigin),
  };
}

// ── validation ───────────────────────────────────────────────────────────────

/**
 * Probes credentials against Bolna's live API before they are stored.
 *
 * Ordering is the whole design here, because every one of these failures comes
 * back from Bolna as a 400 or 401 and an admin who is told the wrong field is
 * an admin who edits a correct value until it becomes an incorrect one:
 *
 *   1. Shape checks locally. A malformed UUID needs no round trip.
 *   2. GET /phone-numbers/all — proves the API KEY. Cheapest authenticated call
 *      with no other input, so its failure is unambiguous.
 *   3. Membership of the phone number in that list — proves the NUMBER, locally,
 *      from data step 2 already fetched. No extra request.
 *   4. GET /v2/agent/{id} — proves the AGENT ID.
 *
 * Deliberately NOT a test call. The brief suggested one, and it would be a real
 * outbound call: it costs money, it rings a real handset, and there is no
 * "test" mode in Bolna's /call endpoint to make it harmless. Every credential
 * can be proven with read-only endpoints, so placing a call to validate a
 * settings form would be a side effect nobody asked for on a Save button.
 */
export async function validateBolnaCredentials(
  creds: BolnaCredentials
): Promise<BolnaValidationResult> {
  const result: BolnaValidationResult = {
    ok: false,
    fieldErrors: {},
    formError: null,
    warnings: [],
    availableNumbers: [],
    agentName: null,
  };

  // ── 1. local shape ──
  const apiKey = creds.apiKey.trim();
  const agentId = creds.agentId.trim();
  const phoneRaw = creds.phoneNumber.trim();

  if (!apiKey) {
    result.fieldErrors.apiKey = "API key is required.";
  } else if (!/^(bn|sa)-/.test(apiKey)) {
    // A warning, not an error. The prefix is documented for subaccounts only,
    // so rejecting on it would be guessing about main-account key formats we
    // have not seen — and locking an admin out of their own settings panel over
    // a format assumption is worse than one extra round trip.
    result.warnings.push(
      "The API key does not start with `bn-` or `sa-`, which is unusual for Bolna keys. It will still be tested against the API."
    );
  }

  if (!agentId) {
    result.fieldErrors.agentId = "Agent ID is required.";
  } else if (
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(agentId)
  ) {
    result.fieldErrors.agentId =
      "Agent ID must be a UUID, like 123e4567-e89b-12d3-a456-426655440000. Copy it from the agent's page in the Bolna dashboard.";
  }

  let phoneE164 = "";
  if (!phoneRaw) {
    result.fieldErrors.phoneNumber = "Phone number is required.";
  } else {
    const e = toE164(phoneRaw);
    if (!e.ok) {
      result.fieldErrors.phoneNumber =
        "Enter the number in international format, e.g. +918035739222.";
    } else {
      phoneE164 = e.e164;
    }
  }

  if (Object.keys(result.fieldErrors).length > 0) return result;

  // ── 2. the API key ──
  // A shorter timeout than the configured default: this runs while an admin
  // watches a spinner on a Save button, and 15s of nothing is indistinguishable
  // from a hung page.
  const probeTimeout = 10_000;

  try {
    result.availableNumbers = await listPhoneNumbers(apiKey, probeTimeout);
  } catch (err) {
    const be = toBolnaError(err);
    if (be.code === "AUTH_FAILED") {
      result.fieldErrors.apiKey =
        "Bolna rejected this API key. Check it under Developers → API Keys in the Bolna dashboard.";
    } else {
      result.formError = `Could not reach Bolna to verify the credentials: ${be.message}`;
    }
    return result;
  }

  // ── 3. the phone number ──
  const normalize = (n: unknown) => String(n ?? "").replace(/[^\d]/g, "");
  const wanted = normalize(phoneE164);
  const match = result.availableNumbers.find((n) => normalize(n.phone_number) === wanted);

  if (!match) {
    const owned = result.availableNumbers.map((n) => n.phone_number).filter(Boolean);
    result.fieldErrors.phoneNumber = owned.length
      ? `${phoneE164} is not on this Bolna account. Numbers available: ${owned.join(", ")}.`
      : `${phoneE164} is not on this Bolna account, and the account has no phone numbers yet. Buy or connect one in the Bolna dashboard first.`;
  } else if (match.agent_id && match.agent_id !== agentId) {
    // Advisory, and this is the case the brief asked to catch. `agent_id` on a
    // number is its INBOUND binding — which agent answers calls TO it. Outbound
    // `from_phone_number` only requires that the account owns the number, so a
    // mismatch is a perfectly valid configuration (one number, several outbound
    // agents) and must not block the save. It is surfaced because it is also
    // what a genuine copy-paste mistake looks like.
    result.warnings.push(
      `${phoneE164} is linked to a different agent (${match.agent_id}) for inbound calls. ` +
        `Outbound calls from this agent will still work — the number only needs to belong to the account.`
    );
  }

  // ── 4. the agent ──
  try {
    const agent = await getAgent(apiKey, agentId, probeTimeout);
    result.agentName =
      (agent?.agent_config?.agent_name as string) ??
      (agent?.agent_name as string) ??
      (agent?.name as string) ??
      null;
  } catch (err) {
    const be = toBolnaError(err);
    if (be.code === "AGENT_NOT_FOUND" || be.httpStatus === 404 || be.httpStatus === 400) {
      result.fieldErrors.agentId =
        "No agent with this ID exists on the account this API key belongs to.";
    } else if (be.code === "AUTH_FAILED") {
      result.fieldErrors.apiKey = "Bolna rejected this API key.";
    } else {
      result.formError = `Could not verify the agent: ${be.message}`;
    }
    return result;
  }

  result.ok = Object.keys(result.fieldErrors).length === 0 && !result.formError;
  return result;
}

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Upserts the credentials.
 *
 * The API key is optional on update so an admin can change the agent id or the
 * phone number without re-typing a key they cannot read back — the panel sends
 * the key only when the field was actually edited. Passing a blank key when no
 * key is stored is rejected upstream by validate; passing one here keeps
 * whatever is already in the column.
 *
 * jsonb_set-style merging is avoided in favour of writing `secrets` whole. There
 * is one secret today, and a partial-merge write is how a future second secret
 * gets silently dropped by a code path that only knew about the first.
 */
export async function saveBolnaSettings(params: {
  orgId?: number;
  agentId: string;
  phoneNumber: string;
  /** Omit or pass null to retain the currently stored key. */
  apiKey?: string | null;
  enabled?: boolean;
  updatedBy?: number | null;
  verified: boolean;
  verifyError?: string | null;
}): Promise<void> {
  const orgId = params.orgId ?? DEFAULT_ORG_ID;

  if (!isSecretsCryptoConfigured()) {
    throw new BolnaError(
      "CONFIG_MISSING",
      "Cannot store the API key: SECRETS_ENCRYPTION_KEY is not set on the server. " +
        "Storing it unencrypted is not an option this app offers."
    );
  }

  const existing = await readRow(orgId);

  let secrets: Record<string, any> = existing?.secrets ?? {};
  if (params.apiKey) {
    secrets = { ...secrets, apiKey: encryptSecret(params.apiKey.trim()) };
  }
  if (!secrets.apiKey) {
    throw new BolnaError("CONFIG_MISSING", "An API key is required the first time you save.");
  }

  const settings = {
    ...(existing?.settings ?? {}),
    agentId: params.agentId.trim(),
    phoneNumber: params.phoneNumber.trim(),
  };

  await query(
    `INSERT INTO integration_settings
       (organization_id, provider, settings, secrets, enabled,
        last_verified_at, last_verify_error, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (organization_id, provider) DO UPDATE SET
       settings          = EXCLUDED.settings,
       secrets           = EXCLUDED.secrets,
       enabled           = EXCLUDED.enabled,
       last_verified_at  = EXCLUDED.last_verified_at,
       last_verify_error = EXCLUDED.last_verify_error,
       updated_by        = EXCLUDED.updated_by,
       updated_at        = NOW()`,
    [
      orgId,
      PROVIDER,
      JSON.stringify(settings),
      JSON.stringify(secrets),
      params.enabled ?? true,
      params.verified ? new Date() : existing?.last_verified_at ?? null,
      params.verifyError ?? null,
      params.updatedBy ?? null,
    ]
  );
}

/** Clears the stored credentials. The row is kept so `enabled` and audit survive. */
export async function clearBolnaSettings(orgId = DEFAULT_ORG_ID, updatedBy?: number | null) {
  await query(
    `UPDATE integration_settings
        SET secrets = '{}'::jsonb,
            settings = '{}'::jsonb,
            last_verified_at = NULL,
            last_verify_error = NULL,
            updated_by = $2,
            updated_at = NOW()
      WHERE organization_id = $1 AND provider = $3`,
    [orgId, updatedBy ?? null, PROVIDER]
  );
}
