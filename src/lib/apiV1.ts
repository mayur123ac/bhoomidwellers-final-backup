// lib/apiV1.ts — the wrapper every /api/v1 route handler goes through.
//
// This exists for the same reason lib/serverAuth.ts's comment gives for its own
// existence: removing the discretion to write a bespoke check. A v1 route does
// not call authenticateApiKey directly and does not assemble its own error body.
// It calls withApiKey(scope, handler) and returns data. Everything else —
// authentication, scope enforcement, rate limiting, usage recording, error
// shape, rate-limit headers — happens here, once.
//
// ── Why the response shape differs from the dashboard's ─────────────────────
// Internal routes return `{ success, message, data }`. This surface returns
// `{ data, meta }` on success and `{ error: { code, message } }` on failure,
// with the HTTP status carrying the outcome. That is what an external client
// library expects, and a machine-readable `code` is what lets an integrator
// branch on "rate limited" versus "scope missing" without string-matching prose.
//
// The internal shape is not reused precisely because these are different
// audiences: dashboard code is deployed with the API and can be changed
// together, whereas someone else's Zapier action cannot.

import { NextResponse } from "next/server";
import {
  authenticateApiKey,
  clampRateLimit,
  errorText,
  recordApiUsage,
  type ApiScope,
  type ApiKeyRow,
} from "@/lib/apiKeys";

export interface ApiV1Context {
  key: ApiKeyRow;
  clientIp: string;
  /** Parsed, clamped `?limit=` / `?offset=`. */
  limit: number;
  offset: number;
  searchParams: URLSearchParams;
}

/** What a handler returns. `meta` is merged into the envelope's meta object. */
export interface ApiV1Payload {
  data: unknown;
  meta?: Record<string, unknown>;
  status?: number;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * Thrown by a handler to return a client error in the standard envelope.
 *
 * Without this, a route needing to reject bad input has to either return a
 * success-shaped body with an `error` key inside it — which would make the
 * envelope a lie — or build its own NextResponse and bypass the usage recording
 * and rate-limit headers this wrapper adds. Throwing keeps one exit path.
 *
 * The message IS echoed to the caller, unlike an unexpected exception's: these
 * are deliberate, written-for-humans validation messages, not database internals.
 */
export class ApiV1Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ApiV1Error";
    this.code = code;
    this.status = status;
  }
}

/**
 * Wraps a v1 handler.
 *
 * `endpoint` is the route template, passed explicitly rather than read from the
 * URL. Reading req.url would put query strings — which carry filter values, i.e.
 * what someone is searching for — into the usage table. See the column comment
 * in developer_api_2026-08-07.sql.
 */
export function withApiKey(
  endpoint: string,
  scope: ApiScope | null,
  handler: (ctx: ApiV1Context) => Promise<ApiV1Payload>
) {
  return async function route(req: Request): Promise<NextResponse> {
    const startedAt = Date.now();

    const auth = await authenticateApiKey(req, scope);

    if (!auth.ok) {
      const res = NextResponse.json(errorBody(auth.code, auth.message), { status: auth.status });

      if (auth.code === "RATE_LIMITED" && auth.retryAfter != null) {
        res.headers.set("Retry-After", String(auth.retryAfter));
      }
      // WWW-Authenticate on 401 is what makes this a well-behaved bearer-token
      // API rather than one that merely returns the right number.
      if (auth.status === 401) {
        res.headers.set("WWW-Authenticate", 'Bearer realm="bhoomi-crm"');
      }

      // A rejected request is still a request the key made: it counts toward the
      // limit and shows up in statistics. Not recording failures would let a key
      // hammer the auth path for free, and would hide a misconfigured
      // integration from the very statistics page meant to reveal it.
      //
      // `keyId` is set only for rejections where the key was proven genuine.
      // Unknown and malformed keys have no verified identity to attribute usage
      // to, so they are not recorded — see the field's comment in lib/apiKeys.ts.
      if (auth.keyId) {
        await recordApiUsage({
          apiKeyId: auth.keyId,
          endpoint,
          status: auth.status,
          durationMs: Date.now() - startedAt,
        });
      }

      return res;
    }

    const url = new URL(req.url);
    const searchParams = url.searchParams;

    // The null check is load-bearing and easy to lose: `Number(null)` is 0, not
    // NaN, so testing only Number.isFinite() treats an ABSENT limit as a
    // supplied 0, which then clamps up to the minimum of 1. Every endpoint
    // called without an explicit ?limit= returned exactly one row.
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    const rawLimit = limitParam === null ? NaN : Number(limitParam);
    const rawOffset = offsetParam === null ? NaN : Number(offsetParam);

    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;

    let status = 200;
    let res: NextResponse;

    try {
      const payload = await handler({
        key: auth.key,
        clientIp: auth.clientIp,
        limit,
        offset,
        searchParams,
      });

      status = payload.status ?? 200;
      res = NextResponse.json(
        {
          data: payload.data,
          meta: { limit, offset, ...(payload.meta ?? {}) },
        },
        { status }
      );
    } catch (err) {
      if (err instanceof ApiV1Error) {
        status = err.status;
        res = NextResponse.json(errorBody(err.code, err.message), { status });
      } else {
        status = 500;
        // The message is deliberately not echoed: a Postgres error can contain
        // column names, and occasionally values, from a query an external caller
        // should not be learning the shape of. It is logged in full instead.
        console.error(
          `[api/v1] ${endpoint} failed`,
          errorText(err),
          err instanceof Error ? err.stack : undefined
        );
        res = NextResponse.json(
          errorBody("INTERNAL_ERROR", "The request could not be completed."),
          { status: 500 }
        );
      }
    }

    const limitPerMin = clampRateLimit(auth.key.rate_limit_per_min);
    res.headers.set("X-RateLimit-Limit", String(limitPerMin));

    await recordApiUsage({
      apiKeyId: auth.key.id,
      endpoint,
      status,
      durationMs: Date.now() - startedAt,
      clientIp: auth.clientIp,
    });

    return res;
  };
}
