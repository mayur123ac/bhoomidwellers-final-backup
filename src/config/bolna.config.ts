// config/bolna.config.ts — the only place that reads Bolna environment.
//
// Same two rules as config/whatsapp.config.ts, for the same reasons:
//
//   1. Nothing is read at module scope. `next build` evaluates every route
//      module, possibly without .env.local present.
//   2. Nothing throws. Callers decide what is fatal.
//
// ── What lives here vs. in the database ─────────────────────────────────────
//
// This file holds DEPLOYMENT config — endpoints, timeouts, the webhook secret.
// The CREDENTIALS (API key, agent id, phone number) live in integration_settings
// and are read through lib/bolnaSettings.ts, because an admin enters them in the
// panel at runtime rather than an operator setting them at deploy time.
//
// The one exception is BOLNA_API_KEY: if it is set in the environment it is used
// as a fallback when the database has no row. That makes the integration
// testable from a script before anyone has opened the settings panel, and gives
// a migration path if these credentials ever move back into env.

import { redactSecrets as redactWhatsAppSecrets } from "@/config/whatsapp.config";

export interface BolnaConfig {
  /** No trailing slash. */
  baseUrl: string;
  /**
   * Path of the web-call session mint endpoint, appended to baseUrl.
   *
   * Configurable, and this matters more than it looks. Bolna's SDK doc gives
   * `POST https://api.bolna.ai/v1/web-call/session` but labels it verbatim as an
   * "illustrative URL: swap in your actual Bolna session-mint endpoint" — the
   * feature is in beta and the real path is handed out per account when support
   * enables it. Hard-coding it would mean a code change on the day the account
   * is switched on; an env var means editing .env.local.
   */
  webCallSessionPath: string;
  timeoutMs: number;
  /**
   * Shared secret appended to the webhook URL as ?token=…
   *
   * Bolna does not sign its webhooks. The docs offer only "whitelist source IP
   * 13.203.39.153", which is not something this app can enforce from inside a
   * route handler behind Vercel or any other proxy. An unguessable token in the
   * URL is therefore the actual authentication on that endpoint, and without one
   * anybody who learns the path can write transcripts onto leads.
   */
  webhookToken: string | null;
  /** Optional second factor on the webhook. Empty = no IP check. */
  webhookAllowedIps: string[];
  /** Absolute origin, for building the webhook URL shown in the panel. */
  publicBaseUrl: string | null;
  /** Master switch. Blocks dialling without clearing stored credentials. */
  enabled: boolean;
  /** Browser calling is beta and per-account; off unless explicitly enabled. */
  webCallEnabled: boolean;
  /** Env-var fallback credentials. Database values take precedence. */
  envApiKey: string | null;
  envAgentId: string | null;
  envPhoneNumber: string | null;
}

// ── env readers ──────────────────────────────────────────────────────────────
// Duplicated from whatsapp.config.ts rather than shared. They are six lines
// each, and a shared env-utils module would couple two integrations that should
// be independently deletable.

function envStr(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Absent means the fallback. Only an explicit false-ish value flips it off. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(v)) return false;
  if (["true", "1", "yes", "on"].includes(v)) return true;
  return fallback;
}

/** Reads deployment config. Never throws, never returns partial state. */
export function readBolnaConfig(): BolnaConfig {
  return {
    baseUrl: (envStr("BOLNA_API_BASE_URL") || "https://api.bolna.ai").replace(/\/+$/, ""),
    webCallSessionPath:
      "/" + (envStr("BOLNA_WEB_CALL_SESSION_PATH") || "v1/web-call/session").replace(/^\/+/, ""),
    timeoutMs: envInt("BOLNA_TIMEOUT_MS", 15_000),
    webhookToken: envStr("BOLNA_WEBHOOK_TOKEN") || null,
    webhookAllowedIps: envStr("BOLNA_WEBHOOK_ALLOWED_IPS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    publicBaseUrl:
      (envStr("BOLNA_PUBLIC_BASE_URL", "NEXT_PUBLIC_APP_URL", "APP_URL") || "").replace(
        /\/+$/,
        ""
      ) || null,
    enabled: envBool("BOLNA_ENABLED", true),
    // Defaults false, unlike every other flag here. Browser calling requires
    // Bolna support to switch the account on; leaving it on by default would put
    // a Call button in the CRM that fails with `mint_failed` for every user
    // until someone works out why.
    webCallEnabled: envBool("BOLNA_WEB_CALL_ENABLED", false),
    envApiKey: envStr("BOLNA_API_KEY") || null,
    envAgentId: envStr("BOLNA_AGENT_ID") || null,
    envPhoneNumber: envStr("BOLNA_PHONE_NUMBER") || null,
  };
}

/**
 * The URL to paste into the agent's Extractions tab in the Bolna dashboard.
 *
 * Returns null when the origin is unknown rather than guessing localhost — a
 * webhook URL pointing at a developer's machine looks configured and silently
 * receives nothing, which is worse than the panel saying it cannot tell you.
 */
export function buildWebhookUrl(reqOrigin?: string | null): string | null {
  const cfg = readBolnaConfig();
  const origin = cfg.publicBaseUrl || (reqOrigin ? reqOrigin.replace(/\/+$/, "") : "");
  if (!origin) return null;

  const base = `${origin}/api/webhooks/bolna`;
  return cfg.webhookToken ? `${base}?token=${encodeURIComponent(cfg.webhookToken)}` : base;
}

/**
 * Redaction, the module's security invariant — the same one whatsapp.config.ts
 * documents at length.
 *
 * No string derived from a Bolna response reaches console.*, an HTTP body, or
 * bolna_calls.error_message without passing through here. The choke point is
 * lib/bolna-client.ts, the only module that ever holds the key.
 *
 * Delegates to the WhatsApp redactor first so a single call covers credentials
 * from both integrations — an error body echoing a Meta token should not survive
 * just because it arrived through the Bolna path.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;

  let out = redactWhatsAppSecrets(input);

  // Exact values from the environment.
  for (const name of ["BOLNA_API_KEY", "BOLNA_WEBHOOK_TOKEN", "SECRETS_ENCRYPTION_KEY"]) {
    const v = process.env[name];
    // The length guard stops a short value censoring every occurrence of a
    // common substring. Same reasoning as the WhatsApp redactor.
    if (typeof v === "string" && v.trim().length >= 8) {
      out = out.split(v.trim()).join("***REDACTED***");
    }
  }

  // Bolna keys are `bn-…`; subaccount keys are `sa-…`.
  out = out.replace(/\b(?:bn|sa)-[A-Za-z0-9_-]{16,}/g, "***REDACTED***");
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***REDACTED***");
  // The minted session's SIP password is a live credential for ~120 seconds.
  out = out.replace(/"sip_password"\s*:\s*"[^"]*"/g, '"sip_password":"***REDACTED***"');

  return out;
}

/** Redacts anything, including objects, by round-tripping through JSON. */
export function redactDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(redactSecrets(JSON.stringify(value))) as T;
  } catch {
    return value;
  }
}

/**
 * Safe to hand to an admin over HTTP: which endpoints are in play, whether the
 * webhook is guarded, whether browser calling is on. No secret values.
 */
export function bolnaConfigSummary() {
  const cfg = readBolnaConfig();
  return {
    baseUrl: cfg.baseUrl,
    webCallSessionPath: cfg.webCallSessionPath,
    enabled: cfg.enabled,
    webCallEnabled: cfg.webCallEnabled,
    webhookTokenPresent: cfg.webhookToken !== null,
    webhookIpAllowlist: cfg.webhookAllowedIps.length > 0 ? cfg.webhookAllowedIps : null,
    timeoutMs: cfg.timeoutMs,
  };
}
