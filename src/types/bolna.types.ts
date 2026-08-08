// types/bolna.types.ts — shared vocabulary for the Bolna voice integration.
//
// Imports nothing from next/*, node:*, or the database, so it can be pulled into
// a client component, a route handler, or a plain node script alike.

// ── Credentials ──────────────────────────────────────────────────────────────

/** What an admin types into the settings panel. */
export interface BolnaCredentials {
  /** `bn-…` for a main account, `sa-…` for a subaccount. Never leaves the server. */
  apiKey: string;
  /** UUID of the voice agent that will handle calls. */
  agentId: string;
  /** E.164, e.g. "+918035739222". The outbound caller id for phone calls. */
  phoneNumber: string;
}

/**
 * The safe projection: everything the settings panel needs to render, with the
 * API key reduced to a mask. This is the ONLY shape any Bolna route returns to
 * the browser — see lib/bolnaSettings.ts.
 */
export interface BolnaSettingsSummary {
  configured: boolean;
  enabled: boolean;
  /** `bn-••••••••4f2a`, or "" when nothing is stored. */
  apiKeyMask: string;
  agentId: string;
  phoneNumber: string;
  /** Null when the credentials have never passed a validation probe. */
  lastVerifiedAt: string | null;
  lastVerifyError: string | null;
  updatedAt: string | null;
  /** False when SECRETS_ENCRYPTION_KEY is absent; saving is blocked until set. */
  encryptionReady: boolean;
  /** Whether the browser-calling path is usable. See config.webCallEnabled. */
  webCallEnabled: boolean;
  /** Absolute URL to paste into the agent's Extractions tab. */
  webhookUrl: string | null;
}

/**
 * GET /api/bolna/status — capability booleans, readable by ANY signed-in user.
 *
 * Deliberately carries no `agentId` or `phoneNumber`. This endpoint exists so
 * non-admin surfaces (a leads table, a lead detail panel) can decide whether to
 * draw a Call affordance; answering that question needs three booleans and
 * nothing else. Adding configuration values here would hand every signed-in
 * user a read of the integration's setup, which is what /api/settings/bolna is
 * for and why that one is admin-gated.
 */
export interface BolnaStatusResponse {
  success: boolean;
  /** API key + agent stored, decryptable, and not disabled. */
  configured: boolean;
  /** The BOLNA_ENABLED master switch. */
  enabled: boolean;
  /**
   * Browser (WebRTC) calling is available: the beta is switched on for this
   * account AND credentials exist. Named to match the route and the rest of the
   * module — Bolna calls the feature "Web Call", not "browser call".
   */
  webCallEnabled: boolean;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type BolnaFieldName = "apiKey" | "agentId" | "phoneNumber";

/**
 * The result of probing credentials against Bolna's API on save.
 *
 * `warnings` exists because one of the checks is genuinely advisory: a number
 * whose inbound `agent_id` points at a different agent still works perfectly
 * well as an outbound caller id, so refusing the save would be wrong. Blocking
 * on it would also make the common "one number, several agents" setup
 * unconfigurable.
 */
export interface BolnaValidationResult {
  ok: boolean;
  /** Keyed by field so the panel can highlight the offending input. */
  fieldErrors: Partial<Record<BolnaFieldName, string>>;
  /** Not attached to any one field — connectivity, plan limits. */
  formError: string | null;
  warnings: string[];
  /** Numbers on the account, so the panel can offer them as suggestions. */
  availableNumbers: BolnaPhoneNumber[];
  agentName: string | null;
}

// ── Bolna API shapes ─────────────────────────────────────────────────────────

/** GET /phone-numbers/all */
export interface BolnaPhoneNumber {
  id: string;
  phone_number: string;
  /** The agent bound for INBOUND calls on this number. Not an outbound gate. */
  agent_id: string | null;
  telephony_provider: string | null;
  rented: boolean | null;
  price: string | null;
  renewal_at: string | null;
}

/** POST /call */
export interface BolnaMakeCallResponse {
  message: string;
  status: string;
  execution_id: string;
}

/**
 * POST to Bolna's web-call session mint. Proxied to the browser byte-for-byte —
 * the SDK consumes exactly this shape.
 */
export interface BolnaWebCallSession {
  run_id: string;
  agent_id: string;
  sip_username: string;
  sip_password: string;
  sip_domain: string;
  wss_url: string;
  sip_register: boolean;
  /** Seconds. ~120. */
  expires_in: number;
  ice_servers: unknown[];
}

/**
 * Bolna's execution record — the GET /executions/{id} response, and byte-identical
 * to the webhook body. Partial because the shape varies by status: everything
 * below `status` is null or zero until the call reaches a terminal state.
 */
export interface BolnaExecution {
  id: string;
  agent_id?: string;
  status: BolnaCallStatus | string;
  conversation_duration?: number | null;
  total_cost?: number | null;
  transcript?: string | null;
  user_number?: string | null;
  agent_number?: string | null;
  extracted_data?: Record<string, any> | null;
  telephony_data?: {
    duration?: number | null;
    recording_url?: string | null;
    call_type?: string | null;
    provider?: string | null;
    hangup_by?: string | null;
    hangup_reason?: string | null;
  } | null;
  cost_breakdown?: Record<string, number> | null;
  latency_data?: Record<string, number> | null;
  batch_id?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

/** Bolna's documented status vocabulary, stored unmapped in bolna_calls.status. */
export type BolnaCallStatus =
  | "queued"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "call-disconnected"
  | "completed"
  | "no-answer"
  | "busy"
  | "failed"
  | "canceled"
  | "stopped"
  | "error"
  | "balance-low";

/**
 * Statuses after which nothing further arrives.
 *
 * `call-disconnected` is deliberately absent, and this is the single most
 * important detail in the webhook handler. Bolna's docs: "The call-disconnected
 * event fires the instant the line drops, but conversation_duration, total_cost,
 * recording_url, and extracted_data are not yet populated." Treating it as
 * terminal means every call is recorded with a null transcript.
 */
export const TERMINAL_CALL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "stopped",
  "error",
  "balance-low",
]);

/** Terminal statuses that mean the conversation never happened. */
export const FAILED_CALL_STATUSES: ReadonlySet<string> = new Set([
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "error",
  "balance-low",
]);

// ── Call records ─────────────────────────────────────────────────────────────

/** A row of bolna_calls, as returned to the CRM UI. */
export interface BolnaCallRecord {
  id: number;
  executionId: string | null;
  leadId: number | null;
  callerLeadId: number | null;
  agentId: string | null;
  channel: "phone" | "web";
  direction: string;
  status: string;
  fromNumber: string | null;
  toNumber: string | null;
  initiatedByName: string | null;
  durationSeconds: number | null;
  totalCost: number | null;
  recordingUrl: string | null;
  transcript: string | null;
  summary: string | null;
  extractedData: Record<string, any> | null;
  hangupReason: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type BolnaErrorCode =
  | "CONFIG_MISSING"
  | "NOT_CONFIGURED"
  | "DISABLED"
  | "AUTH_FAILED"
  | "AGENT_NOT_FOUND"
  | "NUMBER_NOT_OWNED"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "INSUFFICIENT_BALANCE"
  | "WEB_CALL_UNAVAILABLE"
  | "NETWORK"
  | "TIMEOUT"
  | "UPSTREAM"
  | "UNKNOWN";

/**
 * Every failure this integration surfaces. `message` has already been through
 * redactSecrets() by the time it is constructed inside lib/bolna-client.ts — see
 * the note there about the redaction choke point.
 */
export class BolnaError extends Error {
  readonly code: BolnaErrorCode;
  readonly httpStatus: number | null;
  readonly details: Record<string, unknown> | null;
  readonly retryable: boolean;

  constructor(
    code: BolnaErrorCode,
    message: string,
    opts?: {
      httpStatus?: number | null;
      details?: Record<string, unknown> | null;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = "BolnaError";
    this.code = code;
    this.httpStatus = opts?.httpStatus ?? null;
    this.details = opts?.details ?? null;
    this.retryable = opts?.retryable ?? false;
  }
}

/**
 * The message an admin should see for each failure code.
 *
 * Centralized because the same condition surfaces in three places — the settings
 * panel on save, the call widget on dial, the webhook's error column — and three
 * hand-written phrasings of "your API key is wrong" is how a support conversation
 * ends up unable to establish which check actually failed.
 */
export function describeBolnaError(err: BolnaError): string {
  switch (err.code) {
    case "CONFIG_MISSING":
    case "NOT_CONFIGURED":
      return "Bolna is not configured yet. Add the API key, agent ID and phone number in Settings → Calling Integration.";
    case "DISABLED":
      return "The Bolna integration is switched off in Settings → Calling Integration.";
    case "AUTH_FAILED":
      return "Bolna rejected the API key. Check it in your Bolna dashboard under Developers → API Keys, and re-save it here.";
    case "AGENT_NOT_FOUND":
      return "No agent with that ID exists on this Bolna account. Copy the agent ID from the agent's page in the Bolna dashboard.";
    case "NUMBER_NOT_OWNED":
      return "That phone number is not on this Bolna account. Use a number you have purchased or connected via SIP trunk in Bolna.";
    case "INSUFFICIENT_BALANCE":
      return "The Bolna account has insufficient balance to place calls. Top up in the Bolna dashboard.";
    case "RATE_LIMITED":
      return "Bolna is rate-limiting requests. Wait a moment and try again.";
    case "WEB_CALL_UNAVAILABLE":
      return "Browser calling is not enabled on this Bolna account. It is in beta — email support@bolna.dev to have it switched on.";
    case "TIMEOUT":
      return "Bolna did not respond in time. Check your connection and try again.";
    case "NETWORK":
      return "Could not reach Bolna. Check your network connection.";
    case "INVALID_REQUEST":
      return err.message;
    default:
      return err.message || "Something went wrong talking to Bolna.";
  }
}
