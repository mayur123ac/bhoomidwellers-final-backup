// lib/bolna-client.ts — the only module that talks to Bolna, and the only one
// that ever holds the API key.
//
// Transport concerns exclusively: build the request, set the Bearer header,
// apply the timeout, classify the failure. It knows nothing about the database
// and imports nothing from next/*, so it can be exercised from a plain node
// script.
//
// ── The redaction choke point ────────────────────────────────────────────────
// Because this is the only place the key exists, it is also the only place a key
// could leak. Every string this module puts into a BolnaError — message or
// details — goes through redactSecrets() first, and request headers are never
// serialized anywhere. Everything downstream inherits that guarantee without
// having to remember it.
//
// ── No retry ladder ──────────────────────────────────────────────────────────
// Unlike whatsapp-client.ts, which retries because a dropped notification is
// invisible until someone complains. Every call here is synchronous with a user
// waiting on a button, and the two operations that could be retried are the two
// that must not be: retrying POST /call double-dials the customer, and a minted
// web-call session is single-use and expires in 120 seconds, so by the time a
// retry would help the session is already dead. Failures surface immediately and
// the user clicks again.

import {
  BolnaError,
  type BolnaExecution,
  type BolnaMakeCallResponse,
  type BolnaPhoneNumber,
  type BolnaWebCallSession,
} from "@/types/bolna.types";
import { readBolnaConfig, redactSecrets } from "@/config/bolna.config";

// ── error classification ─────────────────────────────────────────────────────

/**
 * Turns a non-2xx Bolna response into a classified BolnaError.
 *
 * The classification is what decides which sentence the admin reads, so it is
 * worth being precise. Bolna returns `{ error, message }` on failure and uses
 * plain HTTP status codes; 400 covers a wide range, so the message body is
 * pattern-matched to separate "your agent id is wrong" from "your phone number
 * is wrong" — both are 400 and an admin fixing the wrong field is a long
 * afternoon.
 */
function classifyBolnaError(httpStatus: number, body: unknown, rawText: string): BolnaError {
  const parsed = (body ?? {}) as { message?: unknown; error?: unknown; detail?: unknown };
  const rawMessage =
    (typeof parsed.message === "string" && parsed.message) ||
    (typeof parsed.detail === "string" && parsed.detail) ||
    (typeof parsed.error === "string" && parsed.error) ||
    rawText ||
    `Bolna returned HTTP ${httpStatus}`;

  const message = redactSecrets(String(rawMessage));
  const lower = message.toLowerCase();
  const details = { httpStatus, body: redactSecrets(rawText).slice(0, 500) };

  if (httpStatus === 401 || httpStatus === 403) {
    return new BolnaError("AUTH_FAILED", message, { httpStatus, details });
  }

  if (httpStatus === 429) {
    return new BolnaError("RATE_LIMITED", message, { httpStatus, details, retryable: true });
  }

  if (httpStatus === 404) {
    // A 404 from /v2/agent/{id} means the agent, not a routing mistake.
    return new BolnaError("AGENT_NOT_FOUND", message, { httpStatus, details });
  }

  if (httpStatus >= 500) {
    return new BolnaError("UPSTREAM", message, { httpStatus, details, retryable: true });
  }

  if (httpStatus === 400 || httpStatus === 422) {
    if (lower.includes("agent")) {
      return new BolnaError("AGENT_NOT_FOUND", message, { httpStatus, details });
    }
    if (lower.includes("from_phone_number") || lower.includes("from phone")) {
      return new BolnaError("NUMBER_NOT_OWNED", message, { httpStatus, details });
    }
    if (lower.includes("balance") || lower.includes("credit")) {
      return new BolnaError("INSUFFICIENT_BALANCE", message, { httpStatus, details });
    }
    return new BolnaError("INVALID_REQUEST", message, { httpStatus, details });
  }

  return new BolnaError("UNKNOWN", message, { httpStatus, details });
}

// ── the request primitive ────────────────────────────────────────────────────

interface RequestOptions {
  method: "GET" | "POST" | "DELETE";
  path: string;
  apiKey: string;
  body?: unknown;
  /** Overrides the configured timeout. Used by the save-time validation probe. */
  timeoutMs?: number;
}

/**
 * Every Bolna HTTP call goes through here.
 *
 * AbortController rather than Promise.race: race leaves the underlying socket
 * open and the response still arrives, held by a promise nobody reads, which on
 * a busy CRM is a slow connection leak. Abort actually cancels it, and the
 * `finally` clears the timer so a fast response does not keep an event-loop
 * handle alive for the full timeout.
 */
async function bolnaRequest<T>(opts: RequestOptions): Promise<T> {
  const cfg = readBolnaConfig();
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
  const url = `${cfg.baseUrl}${opts.path.startsWith("/") ? "" : "/"}${opts.path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new BolnaError("TIMEOUT", `Bolna did not respond within ${timeoutMs}ms.`, {
        retryable: true,
      });
    }
    // A fetch rejection can carry the request URL, and the URL is clean — but
    // `cause` chains sometimes carry more, so it is redacted like everything else.
    throw new BolnaError("NETWORK", redactSecrets(String(err?.message ?? err)), {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  // .text() first, then parse. Bolna returns HTML from its edge on some 5xx and
  // an unguarded res.json() would throw a SyntaxError that masks the real status.
  const rawText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) throw classifyBolnaError(res.status, parsed, rawText);

  return parsed as T;
}

// ── the operations ───────────────────────────────────────────────────────────

/**
 * GET /phone-numbers/all — every number on the account.
 *
 * Doubles as the API-key check in the save-time validation probe: it is the
 * cheapest authenticated endpoint that has no other required input, so a 200
 * proves the key without needing a valid agent id first. That ordering is what
 * lets the panel say "your key is fine, your agent id is wrong" rather than
 * failing on the first thing it tried.
 */
export async function listPhoneNumbers(apiKey: string, timeoutMs?: number): Promise<BolnaPhoneNumber[]> {
  const res = await bolnaRequest<BolnaPhoneNumber[]>({
    method: "GET",
    path: "/phone-numbers/all",
    apiKey,
    timeoutMs,
  });
  return Array.isArray(res) ? res : [];
}

/** GET /v2/agent/{agent_id} — confirms the agent exists and names it. */
export async function getAgent(
  apiKey: string,
  agentId: string,
  timeoutMs?: number
): Promise<Record<string, any>> {
  return bolnaRequest<Record<string, any>>({
    method: "GET",
    path: `/v2/agent/${encodeURIComponent(agentId)}`,
    apiKey,
    timeoutMs,
  });
}

/**
 * POST /call — places an outbound phone call from the agent to a number.
 *
 * `from_phone_number` is optional to Bolna (it falls back to the account
 * default) but is always sent here, because the whole point of configuring a
 * number in the panel is that calls visibly come from it.
 */
export async function makeCall(
  apiKey: string,
  params: {
    agentId: string;
    recipientPhoneNumber: string;
    fromPhoneNumber?: string | null;
    userData?: Record<string, unknown> | null;
  }
): Promise<BolnaMakeCallResponse> {
  const body: Record<string, unknown> = {
    agent_id: params.agentId,
    recipient_phone_number: params.recipientPhoneNumber,
  };
  if (params.fromPhoneNumber) body.from_phone_number = params.fromPhoneNumber;
  if (params.userData && Object.keys(params.userData).length > 0) {
    body.user_data = params.userData;
  }

  return bolnaRequest<BolnaMakeCallResponse>({
    method: "POST",
    path: "/call",
    apiKey,
    body,
  });
}

/** GET /executions/{id} — the full call record. Used to reconcile a stale row. */
export async function getExecution(apiKey: string, executionId: string): Promise<BolnaExecution> {
  return bolnaRequest<BolnaExecution>({
    method: "GET",
    path: `/executions/${encodeURIComponent(executionId)}`,
    apiKey,
  });
}

/**
 * Mints a single-use, ~120-second web-call session for the browser.
 *
 * The returned object is proxied to the client byte-for-byte — it contains SIP
 * credentials and TURN servers the SDK needs, and reshaping it would break the
 * SDK for no gain. It is also the one response in this module that must never be
 * logged: `sip_password` is a live credential until it is consumed. That is why
 * redactSecrets() has a rule for it.
 *
 * The endpoint path is configurable (see BolnaConfig.webCallSessionPath) because
 * Bolna's SDK doc marks the URL as illustrative and the feature is beta,
 * enabled per account on request. A 404 here almost always means the account has
 * not been switched on rather than that the path is wrong, so it is reported as
 * WEB_CALL_UNAVAILABLE with the instruction to email support — the message an
 * admin can actually act on.
 */
export async function mintWebCallSession(
  apiKey: string,
  params: { agentId: string; userData?: Record<string, unknown> | null }
): Promise<BolnaWebCallSession> {
  const cfg = readBolnaConfig();

  try {
    return await bolnaRequest<BolnaWebCallSession>({
      method: "POST",
      path: cfg.webCallSessionPath,
      apiKey,
      body: {
        agent_id: params.agentId,
        user_data: params.userData ?? {},
      },
    });
  } catch (err) {
    if (err instanceof BolnaError) {
      // AGENT_NOT_FOUND here is the 404 classifier firing on a path that does
      // not exist on this account, not on a missing agent — the agent id was
      // validated when the credentials were saved.
      if (err.code === "AGENT_NOT_FOUND" || err.httpStatus === 404 || err.httpStatus === 501) {
        throw new BolnaError(
          "WEB_CALL_UNAVAILABLE",
          `Bolna's web-call session endpoint (${cfg.webCallSessionPath}) is not available on ` +
            `this account. Browser calling is in beta and enabled per account — email ` +
            `support@bolna.dev to request it. If it is already enabled, set ` +
            `BOLNA_WEB_CALL_SESSION_PATH to the path Bolna gave you.`,
          { httpStatus: err.httpStatus, details: err.details }
        );
      }
    }
    throw err;
  }
}

/**
 * Normalizes any thrown value into a BolnaError.
 *
 * Route handlers catch broadly and need one shape to respond with. Without this
 * every handler grows its own `err instanceof BolnaError ? … : …` ladder, and
 * the non-Bolna branch is exactly where an unredacted message slips into a
 * response body.
 */
export function toBolnaError(err: unknown): BolnaError {
  if (err instanceof BolnaError) return err;
  const message = redactSecrets(String((err as any)?.message ?? err ?? "Unknown error"));
  return new BolnaError("UNKNOWN", message);
}
