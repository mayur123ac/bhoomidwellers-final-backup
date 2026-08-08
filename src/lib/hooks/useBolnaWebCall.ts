"use client";
// lib/hooks/useBolnaWebCall.ts — React binding for Bolna's Web Call SDK.
//
// The SDK has no framework binding of its own. This hook supplies one instance
// per component, tears it down on unmount, and mirrors the SDK's state machine
// into React state.
//
// ── Why the SDK is loaded from /vendor rather than imported ──────────────────
//
// `@bolna/web-call` is not on npm — `npm install` returns 404. The SDK is beta
// and distributed as a jsDelivr build from the GitHub repo, so the file is
// vendored into public/vendor/bolna-web-call.min.js (v3.0.0) and loaded with a
// script tag at first use.
//
// Vendoring rather than hot-linking the CDN buys three things that matter for a
// CRM: calls do not break when jsDelivr is unreachable, no third-party origin is
// contacted from an authenticated page, and the exact bytes are pinned. The cost
// is that upgrades are manual — re-download the file and bump SDK_VERSION below.
//
// Lazy-loading it at first click rather than on page load keeps 230 KB out of
// the bundle for the great majority of page views where nobody calls anyone.

import { useCallback, useEffect, useRef, useState } from "react";

/** Keep in step with the vendored file. Used only for cache-busting and logs. */
export const SDK_VERSION = "3.0.0";
const SDK_SRC = `/vendor/bolna-web-call.min.js?v=${SDK_VERSION}`;

/** The SDK's five states, plus our own pre-connection phase. */
export type CallState = "idle" | "connecting" | "ringing" | "active" | "ended";

/**
 * The mint response, proxied verbatim by /api/bolna/session.
 *
 * Structurally identical to BolnaWebCallSession in types/bolna.types.ts, but
 * declared here rather than imported: that module also exports BolnaError, which
 * pulls server-only shapes into a "use client" bundle for no benefit. The SDK is
 * the only consumer and it only reads these fields.
 */
interface MintedSession {
  run_id: string;
  agent_id: string;
  expires_in: number;
  [key: string]: unknown;
}

/** What /api/bolna/session returns on failure. Every field is optional. */
interface MintErrorBody {
  success?: boolean;
  /** Our vocabulary: WEB_CALL_UNAVAILABLE, AUTH_FAILED, NOT_CONFIGURED, … */
  code?: string;
  message?: string;
  /** Bolna's own HTTP status, when the failure came from upstream. */
  upstreamStatus?: number | null;
}

interface BolnaWebCallInstance {
  start(opts?: { userData?: Record<string, unknown> }): Promise<void>;
  stop(): Promise<void>;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  getState(): CallState;
  getRunId(): string | null;
  on(event: string, handler: (payload?: any) => void): void;
  off?(event: string, handler: (payload?: any) => void): void;
}

declare global {
  interface Window {
    BolnaWebCall?: new (options: Record<string, unknown>) => BolnaWebCallInstance;
  }
}

let sdkPromise: Promise<void> | null = null;

/**
 * Injects the SDK script once per page.
 *
 * The promise is cached at module scope so several call widgets mounted at the
 * same time (a list of contacts, each with a Call button) share one load rather
 * than racing to append four script tags.
 */
function loadSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not in a browser."));
  if (window.BolnaWebCall) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-bolna-sdk]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Bolna SDK failed to load.")));
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.dataset.bolnaSdk = SDK_VERSION;
    script.onload = () => {
      if (window.BolnaWebCall) resolve();
      else reject(new Error("Bolna SDK loaded but did not register."));
    };
    script.onerror = () => {
      // Cleared so a later attempt can retry rather than being stuck on a
      // permanently rejected cached promise.
      sdkPromise = null;
      reject(new Error("Bolna SDK could not be loaded from /vendor/bolna-web-call.min.js."));
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

/**
 * Turns a failed mint into the sentence the user should read.
 *
 * Our own `code` is trusted ahead of the HTTP status, because the status alone
 * is ambiguous: /api/bolna/session answers 400 both for "Bolna rejected the key"
 * and for "that endpoint does not exist on this account", and those need
 * opposite fixes. `upstreamStatus` carries Bolna's real status for the cases
 * where no code was set.
 */
function describeMintFailure(httpStatus: number, body: MintErrorBody | null): string {
  const code = body?.code;
  const upstream = body?.upstreamStatus ?? null;

  // ── Conditions our own route diagnosed ──
  switch (code) {
    case "WEB_CALL_DISABLED":
      return (
        "Browser calling is switched off on this server. Once Bolna has enabled the " +
        "beta for your account, set BOLNA_WEB_CALL_ENABLED=true and restart."
      );
    case "NOT_CONFIGURED":
      return (
        "Bolna is not set up yet. Ask an admin to add the API key, agent ID and " +
        "phone number in Settings → Calling Integration."
      );
    case "WEB_CALL_UNAVAILABLE":
      // The case this whole path exists for. Bolna's public API answers 404 on
      // the documented session URL *before* checking the key — the endpoint is
      // handed out per account when the beta is switched on, so a 404 means
      // "not enabled for you", not "your credentials are wrong".
      return (
        "Browser calling is not enabled on this Bolna account yet. Email " +
        "support@bolna.dev to activate it. If they have already enabled it, set " +
        "BOLNA_WEB_CALL_SESSION_PATH to the endpoint they gave you."
      );
    case "AUTH_FAILED":
      return (
        "Bolna rejected the API key. Check it in Settings → Calling Integration."
      );
    case "INSUFFICIENT_BALANCE":
      return "The Bolna account has insufficient balance. Top up in the Bolna dashboard.";
    case "RATE_LIMITED":
      return "Bolna is rate-limiting requests. Wait a moment and try again.";
    case "TIMEOUT":
    case "NETWORK":
      return "Could not reach Bolna. Check your connection and try again.";
  }

  // ── No code: fall back to whichever status we have ──
  const status = upstream ?? httpStatus;

  if (status === 401 || status === 403) {
    return (
      "Browser calling is not enabled on this Bolna account yet. Contact " +
      "support@bolna.dev to activate it."
    );
  }
  if (status === 404) {
    return (
      "Session endpoint not found. Check BOLNA_WEB_CALL_SESSION_PATH in your environment."
    );
  }
  if (status >= 500) {
    return "Could not reach Bolna. Check your API key and try again.";
  }

  return body?.message || "Could not start the call. Check the browser console for details.";
}

/**
 * Mints a session by calling our own route, so the reason for a failure is
 * readable.
 *
 * This exists because of a specific hole. In the SDK's `sessionUrl` mode the SDK
 * performs this fetch itself, and on any non-2xx it discards the response body
 * and emits a single generic `mint_failed`. Our route already returns a precise
 * diagnosis — which credential is wrong, whether the beta is enabled — and every
 * word of it was being thrown away before it could reach the screen. That is why
 * clicking the button looked like it did nothing.
 *
 * Doing the fetch here means `getSession` mode, and Bolna's docs are emphatic
 * about the consequence: the SDK has no request of its own to inject `userData`
 * into, so `user_data` must be included in this POST by hand or the agent's
 * prompt variables are silently empty with no error anywhere.
 *
 * It also fixes a real linkage bug. In `sessionUrl` mode the SDK sends only
 * `{ user_data }` — the top-level `leadId` and `toNumber` the route reads to
 * attach the call to a lead never arrived, so every browser call was recorded
 * with a null lead_id.
 */
async function mintSession(
  url: string,
  payload: { user_data: Record<string, unknown>; leadId: number | null; toNumber: string | null }
): Promise<MintedSession> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    // The CRM server itself was unreachable — a dropped connection or an offline
    // tab. Distinct from Bolna being unreachable, which the route reports.
    throw new Error("Could not reach the server to start the call. Check your network connection.");
  }

  // .text() then parse: the route can answer with a proxy's HTML error page,
  // and an unguarded res.json() would throw a SyntaxError that hides the status.
  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    throw new Error(describeMintFailure(res.status, parsed as MintErrorBody | null));
  }

  const session = parsed as MintedSession | null;
  if (!session?.run_id) {
    throw new Error("Bolna returned an unexpected session response. Check the browser console.");
  }
  return session;
}

/** Human text for the SDK's documented error codes. */
function describeSdkError(code: string, message: string, scope?: string): string {
  switch (code) {
    case "mint_failed":
      // Now largely unreachable: mintSession runs before the SDK is constructed
      // and throws its own diagnosed message, so a mint failure surfaces from
      // there. This remains for the case where the SDK rejects a session that
      // was minted successfully but that it considers malformed.
      return message || "The call session was rejected. Check the browser console for details.";
    case "at_capacity":
      return scope === "customer"
        ? "All your Bolna call lines are busy. Try again in a moment."
        : scope === "not_enabled"
          ? "Browser calling is not enabled on this Bolna account yet."
          : "Bolna is at capacity right now. Try again shortly.";
    case "microphone_denied":
      return "Microphone access was blocked. Allow it in your browser's address-bar settings and try again.";
    case "connect_failed":
      return "Could not connect the call. Check your network and try again.";
    case "call_rejected":
      return "Bolna declined the call. The agent configuration may be wrong.";
    case "autoplay_blocked":
      return "Your browser blocked audio playback. Click the Call button directly to start.";
    case "already_active":
      return "A call is already in progress.";
    default:
      return message || "The call failed.";
  }
}

/**
 * Last line of defence: whatever start() rejected with becomes a sentence.
 *
 * Three shapes arrive here and all three used to end up as "nothing happened":
 *
 *   - an Error thrown by mintSession, already carrying a diagnosed message
 *   - a DOMException from getUserMedia when the user blocks the microphone —
 *     `name` is NotAllowedError and `message` is browser-specific jargon
 *     ("Permission denied by system"), useless to show verbatim
 *   - an SDK error object carrying `code` but not extending Error
 */
function describeStartFailure(err: unknown): string {
  // Microphone refusal, checked before anything else: getUserMedia rejects with
  // a DOMException whose name is the only reliable part across browsers.
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return "Microphone access denied. Allow microphone in browser settings and try again.";
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return "No microphone was found. Connect one and try again.";
    }
    if (err.name === "NotReadableError") {
      return "Your microphone is already in use by another application.";
    }
  }

  const maybe = err as { code?: unknown; name?: unknown; message?: unknown } | null;

  // Some browsers surface a denied getUserMedia as a plain object rather than a
  // DOMException, so the name is checked again independently of the type.
  if (maybe?.name === "NotAllowedError" || maybe?.name === "PermissionDeniedError") {
    return "Microphone access denied. Allow microphone in browser settings and try again.";
  }

  if (typeof maybe?.code === "string") {
    return describeSdkError(maybe.code, typeof maybe.message === "string" ? maybe.message : "");
  }

  if (typeof maybe?.message === "string" && maybe.message.trim()) {
    return maybe.message;
  }

  return "Something went wrong. Check the browser console for details.";
}

export interface UseBolnaWebCall {
  state: CallState;
  /**
   * A ready-to-display sentence, or null. Deliberately a plain string rather
   * than a {code, message} pair: every consumer rendered `.message` and nothing
   * branched on the code, so the pair was a shape that invited a caller to
   * render "[object Object]".
   */
  error: string | null;
  muted: boolean;
  /** Agent audio level 0–1, ~10×/sec while active. Drives the level meter. */
  volume: number;
  runId: string | null;
  starting: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggleMute: () => void;
  clearError: () => void;
}

/**
 * One live call, bound to one component.
 *
 * Uses the SDK's `getSession` mode rather than `sessionUrl`, so that a failed
 * mint produces a specific, actionable sentence instead of the SDK's single
 * generic `mint_failed`. See the note on mintSession.
 */
export function useBolnaWebCall(options: {
  sessionUrl?: string;
  userData?: Record<string, unknown>;
  /** Sent alongside user_data so the server can link the call to a lead. */
  leadId?: number | null;
  toNumber?: string | null;
  onEnded?: (runId: string | null, reason: string) => void;
}): UseBolnaWebCall {
  const { sessionUrl = "/api/bolna/session", userData, leadId, toNumber, onEnded } = options;

  const callRef = useRef<BolnaWebCallInstance | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // onEnded is read through a ref so a caller passing an inline arrow function
  // does not have to memoize it to avoid re-registering listeners.
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  // Hang up if the component unmounts mid-call. Without this, navigating away
  // from the lead page leaves the call running and the microphone live.
  useEffect(() => {
    return () => {
      callRef.current?.stop().catch(() => {});
      callRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    // Cleared on every attempt, so a retry after granting mic permission does
    // not sit behind the previous failure's message.
    setError(null);
    setStarting(true);

    try {
      await loadSdk();
    } catch {
      setError("Bolna browser SDK failed to load. Check your network connection.");
      setStarting(false);
      setState("ended");
      return;
    }

    if (!window.BolnaWebCall) {
      setError("Bolna browser SDK failed to load. Check your network connection.");
      setStarting(false);
      setState("ended");
      return;
    }

    try {
      // A fresh instance per call. The SDK allows one call at a time per
      // instance and mints a new session inside each start(), so reusing an
      // instance buys nothing and risks `already_active` after a failed teardown.
      const call = new window.BolnaWebCall({
        // getSession, not sessionUrl — see mintSession. The SDK awaits this and
        // surfaces a throw as a rejected start(), which the catch below turns
        // into the message we built rather than a generic mint_failed.
        getSession: () =>
          mintSession(sessionUrl, {
            user_data: userData ?? {},
            // Top level, where the route actually reads them.
            leadId: leadId ?? null,
            toNumber: toNumber ?? null,
          }),
      });

      call.on("state-change", (s: CallState) => setState(s));
      call.on("media-permission", () => setError(null));
      call.on("call-start", () => {
        setState("active");
        setRunId(call.getRunId?.() ?? null);
      });
      call.on("call-end", (payload: { reason?: string } = {}) => {
        setState("ended");
        setVolume(0);
        const id = call.getRunId?.() ?? null;
        setRunId(id);
        onEndedRef.current?.(id, payload?.reason ?? "ended");
      });
      call.on("error", (e: { code?: string; message?: string; scope?: string } = {}) => {
        setError(describeSdkError(e.code ?? "unknown", e.message ?? "", e.scope));
        setState("ended");
        setVolume(0);
      });
      call.on("volume-level", (v: number) => setVolume(typeof v === "number" ? v : 0));

      callRef.current = call;

      // start() rejects as well as emitting `error`. Both paths are handled —
      // the SDK's FAQ notes an unhandled rejection here is the usual reason a
      // failed call looks like nothing happening at all.
      await call.start();
      setRunId(call.getRunId?.() ?? null);
    } catch (err: unknown) {
      setError(describeStartFailure(err));
      setState("ended");
      setVolume(0);
    } finally {
      setStarting(false);
    }
  }, [sessionUrl, userData, leadId, toNumber]);

  const stop = useCallback(async () => {
    try {
      await callRef.current?.stop();
    } catch {
      // stop() is documented as safe from any state; a throw here means the call
      // was already gone, which is the state we wanted anyway.
    }
    setState("ended");
    setVolume(0);
  }, []);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !call.isMuted();
    call.setMuted(next);
    setMuted(next);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { state, error, muted, volume, runId, starting, start, stop, toggleMute, clearError };
}
