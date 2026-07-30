// config/whatsapp.config.ts — the only place that reads WhatsApp environment.
//
// Two rules govern this file, and both exist because of how Next builds:
//
//   1. NOTHING is read at module scope. `next build` evaluates every route
//      module, and .env.local may be absent in that environment. A config
//      module that reads env into a top-level const would freeze whatever was
//      there at import time; one that throws would turn "credentials not set up
//      yet" into "the app does not build".
//
//   2. NOTHING throws except assertConfigured(), which is opt-in by name.
//      readConfig() reports what is missing; callers decide whether that is
//      fatal. Before go-live it is not — the trigger paths record a `skipped`
//      row and carry on.
//
// readConfig() re-reads process.env on every call. That is a dozen property
// reads, immeasurably cheap, and it means editing .env.local and restarting
// picks up cleanly with no stale cache.
//
// ── Environment variable names ────────────────────────────────────────────
// The four required names are the ones specified for this project. The more
// explicit aliases are accepted as a fallback so that either spelling works and
// nobody loses an afternoon to a variable that is set but not seen.

import { WhatsAppError } from "@/types/whatsapp.types";

/** Reported verbatim in `missing[]`, so use the names to be typed into .env.local. */
export const WHATSAPP_REQUIRED_ENV = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "VERIFY_TOKEN",
] as const;

export interface WhatsAppConfig {
  baseUrl: string;
  apiVersion: string;
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  /** Optional. When null, webhook signature verification is skipped. */
  appSecret: string | null;
  timeoutMs: number;
  maxRetries: number;
  /** Length need not equal maxRetries; the last value repeats. */
  retryDelaysMs: number[];
  templateLanguage: string;
  defaultCountryCode: string;
  enabled: boolean;
  /** 0 disables the in-process sweep interval. See whatsapp.service.ts. */
  sweepIntervalMs: number;
}

export type ConfigResult =
  | { ok: true; config: WhatsAppConfig; missing: [] }
  | { ok: false; config: null; missing: string[] };

export interface ConfigSummary {
  configured: boolean;
  enabled: boolean;
  missing: string[];
  apiVersion: string;
  baseUrl: string;
  /** Last 4 digits only. */
  phoneNumberId: string;
  businessAccountIdPresent: boolean;
  verifyTokenPresent: boolean;
  appSecretPresent: boolean;
  signatureVerification: "enforced" | "disabled";
  templateLanguage: string;
  defaultCountryCode: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelaysMs: number[];
  sweepIntervalMs: number;
}

// ── env readers ──────────────────────────────────────────────────────────────

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

/** "30000,120000,600000" → [30000, 120000, 600000]. Bad input keeps the default. */
function envDelays(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parts = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parts.length > 0 ? parts : fallback;
}

/** Absent means true. Only an explicit "false"/"0"/"no" switches sending off. */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(v)) return false;
  if (["true", "1", "yes", "on"].includes(v)) return true;
  return fallback;
}

// ── the ladder ───────────────────────────────────────────────────────────────

/** 30 seconds → 2 minutes → 10 minutes. Overridable via WHATSAPP_RETRY_DELAYS_MS. */
export const DEFAULT_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];

/**
 * Reads the environment. Never throws.
 *
 * `missing` uses the primary names from WHATSAPP_REQUIRED_ENV even when an
 * alias would also have been accepted, because the caller is an admin about to
 * edit .env.local and needs to know what to type, not what else would work.
 */
export function readConfig(): ConfigResult {
  const accessToken = envStr("WHATSAPP_TOKEN", "WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = envStr("WHATSAPP_PHONE_NUMBER_ID");
  const businessAccountId = envStr("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const verifyToken = envStr("VERIFY_TOKEN", "WHATSAPP_VERIFY_TOKEN");

  const missing: string[] = [];
  if (!accessToken) missing.push("WHATSAPP_TOKEN");
  if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!businessAccountId) missing.push("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (!verifyToken) missing.push("VERIFY_TOKEN");

  if (missing.length > 0) return { ok: false, config: null, missing };

  return {
    ok: true,
    missing: [],
    config: {
      baseUrl: (envStr("WHATSAPP_GRAPH_BASE_URL") || "https://graph.facebook.com").replace(/\/+$/, ""),
      apiVersion: envStr("WHATSAPP_API_VERSION") || "v21.0",
      accessToken,
      phoneNumberId,
      businessAccountId,
      verifyToken,
      appSecret: envStr("WHATSAPP_APP_SECRET") || null,
      timeoutMs: envInt("WHATSAPP_TIMEOUT_MS", 10_000),
      maxRetries: envInt("WHATSAPP_MAX_RETRIES", 3),
      retryDelaysMs: envDelays("WHATSAPP_RETRY_DELAYS_MS", DEFAULT_RETRY_DELAYS_MS),
      templateLanguage: envStr("WHATSAPP_TEMPLATE_LANG") || "en_US",
      defaultCountryCode: envStr("WHATSAPP_DEFAULT_CC") || "91",
      enabled: envBool("WHATSAPP_ENABLED", true),
      sweepIntervalMs: envInt("WHATSAPP_SWEEP_INTERVAL_MS", 0),
    },
  };
}

/**
 * True when a send can actually be attempted.
 *
 * Deliberately requires all four variables plus `enabled`, even though a send
 * technically only needs the token and the phone number id. Treating the set as
 * atomic is what makes "fill in four variables and it works" true — the
 * alternative is a half-configured state where messages send but delivery
 * receipts silently never arrive because the verify token was never set.
 */
export function isConfigured(): boolean {
  const r = readConfig();
  return r.ok && r.config.enabled;
}

/** Throws WhatsAppError instead of returning. For call sites that cannot proceed. */
export function assertConfigured(): WhatsAppConfig {
  const r = readConfig();
  if (!r.ok) {
    throw new WhatsAppError(
      "CONFIG_MISSING",
      `WhatsApp is not configured. Missing: ${r.missing.join(", ")}`,
      { details: { missing: r.missing } }
    );
  }
  if (!r.config.enabled) {
    throw new WhatsAppError("DISABLED", "WhatsApp sending is disabled (WHATSAPP_ENABLED=false).");
  }
  return r.config;
}

/** The webhook GET handler only needs the verify token, not the send credentials. */
export function isWebhookVerifyConfigured(): boolean {
  return envStr("VERIFY_TOKEN", "WHATSAPP_VERIFY_TOKEN") !== "";
}

/** Raw verify token, for constant-time comparison by the webhook and the sweep. */
export function getVerifyToken(): string {
  return envStr("VERIFY_TOKEN", "WHATSAPP_VERIFY_TOKEN");
}

// ── redaction ────────────────────────────────────────────────────────────────

/**
 * The module's single security invariant:
 *
 *   No string reaches console.*, notification_logs.last_error,
 *   notification_logs.payload, or any HTTP response body without passing
 *   through this function — and request headers are never serialized anywhere.
 *
 * The choke point is whatsapp-client.ts, the only module that ever holds the
 * token. Everything downstream inherits the guarantee.
 *
 * The regex passes exist for tokens that leak from somewhere other than the env
 * vars we know about: a value pasted into a different variable, a curl command
 * copied into an error message, a token echoed back inside a Meta error body.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;

  // Exact values first — the cheapest and most certain match.
  for (const name of [
    "WHATSAPP_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_APP_SECRET",
    "VERIFY_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
  ]) {
    const v = process.env[name];
    // The length guard stops a short or empty value turning every string into
    // redaction noise (VERIFY_TOKEN=x would otherwise censor every letter x).
    if (typeof v === "string" && v.trim().length >= 8) {
      out = out.split(v.trim()).join("***REDACTED***");
    }
  }

  // Meta user and system tokens all begin EAA.
  out = out.replace(/EAA[A-Za-z0-9_-]{20,}/g, "***REDACTED***");
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***REDACTED***");
  out = out.replace(/access_token=[^&\s"']+/gi, "access_token=***REDACTED***");

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
 * Safe to hand to an admin over HTTP. Carries enough to diagnose a misconfigured
 * integration — which variables are missing, whether signatures are enforced,
 * which API version and locale are in play — and no secret values at all.
 */
export function configSummary(): ConfigSummary {
  const r = readConfig();
  const phoneId = envStr("WHATSAPP_PHONE_NUMBER_ID");
  const appSecretPresent = envStr("WHATSAPP_APP_SECRET") !== "";

  return {
    configured: r.ok,
    enabled: r.ok ? r.config.enabled : envBool("WHATSAPP_ENABLED", true),
    missing: r.ok ? [] : r.missing,
    apiVersion: envStr("WHATSAPP_API_VERSION") || "v21.0",
    baseUrl: (envStr("WHATSAPP_GRAPH_BASE_URL") || "https://graph.facebook.com").replace(/\/+$/, ""),
    phoneNumberId: phoneId ? `…${phoneId.slice(-4)}` : "",
    businessAccountIdPresent: envStr("WHATSAPP_BUSINESS_ACCOUNT_ID") !== "",
    verifyTokenPresent: isWebhookVerifyConfigured(),
    appSecretPresent,
    signatureVerification: appSecretPresent ? "enforced" : "disabled",
    templateLanguage: envStr("WHATSAPP_TEMPLATE_LANG") || "en_US",
    defaultCountryCode: envStr("WHATSAPP_DEFAULT_CC") || "91",
    timeoutMs: envInt("WHATSAPP_TIMEOUT_MS", 10_000),
    maxRetries: envInt("WHATSAPP_MAX_RETRIES", 3),
    retryDelaysMs: envDelays("WHATSAPP_RETRY_DELAYS_MS", DEFAULT_RETRY_DELAYS_MS),
    sweepIntervalMs: envInt("WHATSAPP_SWEEP_INTERVAL_MS", 0),
  };
}
