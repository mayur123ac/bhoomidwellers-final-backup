// lib/apiKeys.ts — issuing, authenticating and rate-limiting API keys.
//
// This is the authentication layer whose absence made the Developer API section
// unbuildable. It is deliberately separate from lib/serverAuth.ts: that module
// gates the ~110 cookie-authenticated dashboard routes, and an API key must
// never be an alternative way in to those. A key authenticates against /api/v1/*
// only. Keeping the two gates in different files makes it hard to blur that by
// accident.
//
// ── Key format ──────────────────────────────────────────────────────────────
//
//   bk_live_7f3a9c21e40b5d68_qMv3…                (72 chars)
//   └──────┬──────┘└───────┬──────┘ └─────┬─────┘
//    env marker      key id (public)    secret (32 random bytes, base64url)
//
// The `bk_live_` marker exists so a key pasted into a chat or a log is
// recognisable as a Bhoomi CRM credential — the same reason Stripe and GitHub
// prefix theirs. It also lets secret-scanning tooling match on a stable pattern.
//
// The middle segment is the public key id: stored in clear, uniquely indexed,
// and used to find the row. The trailing secret is never stored, only its
// SHA-256. Losing it means rotating, not recovering.

import crypto from "node:crypto";
import { query } from "@/lib/db";

/**
 * Message text from a caught value.
 *
 * `catch (err)` gives `unknown`, and `err.message` on it is both a type error
 * and a runtime hazard — code can throw a string, or null. Everything that logs
 * a caught error in this module and lib/apiV1.ts goes through here.
 */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ══════════════════════════════════════════════════════════════════════════
   Scopes
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The complete scope catalogue. Every /api/v1 route names exactly one of these,
 * and the UI builds its checkbox list from this array — so a scope cannot exist
 * in the picker without a route honouring it, or vice versa.
 *
 * Read and write are split because the overwhelmingly common integration case
 * (a dashboard, a report, a Zapier trigger) needs read only, and handing it a
 * key that can also delete leads is an avoidable blast radius.
 */
export const API_SCOPES = [
  { value: "leads:read", label: "Leads — read", description: "List and fetch walk-in enquiries." },
  { value: "leads:write", label: "Leads — write", description: "Create and update enquiries." },
  { value: "bookings:read", label: "Bookings — read", description: "List and fetch bookings." },
  { value: "inventory:read", label: "Inventory — read", description: "Read towers, units and availability." },
  { value: "followups:read", label: "Follow-ups — read", description: "Read follow-up history for a lead." },
  { value: "employees:read", label: "Employees — read", description: "Read the user directory (no contact details)." },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["value"];

const VALID_SCOPES = new Set<string>(API_SCOPES.map((s) => s.value));

/** Filters caller-supplied scopes down to ones that actually exist. */
export function sanitizeScopes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    const s = String(raw ?? "").trim();
    if (VALID_SCOPES.has(s)) seen.add(s);
  }
  return [...seen].sort();
}

/* ══════════════════════════════════════════════════════════════════════════
   Generation
   ══════════════════════════════════════════════════════════════════════════ */

const KEY_MARKER = "bk_live_";
const SECRET_BYTES = 32;

/** Default requests-per-minute when a key does not set its own. */
export const DEFAULT_RATE_LIMIT_PER_MIN = 120;

/** Ceiling an admin can set. Above this a key can starve the pg pool (max: 10). */
export const MAX_RATE_LIMIT_PER_MIN = 1000;

export interface GeneratedKey {
  /** Shown to the admin exactly once, then unrecoverable. */
  plaintext: string;
  /** Stored in clear; the lookup handle. */
  prefix: string;
  /** Stored; SHA-256 hex of `plaintext`. */
  hash: string;
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): GeneratedKey {
  const keyId = crypto.randomBytes(8).toString("hex"); // 16 chars
  const secret = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  const prefix = `${KEY_MARKER}${keyId}`;
  const plaintext = `${prefix}_${secret}`;
  return { plaintext, prefix, hash: hashApiKey(plaintext) };
}

/**
 * Display form for a key that has already been stored: `bk_live_7f3a9c21…`.
 * There is no masked form showing the tail, unlike lib/secretsCrypto.ts's
 * maskSecret — that function masks a value it still holds, whereas here the
 * secret genuinely no longer exists to reveal four characters of.
 */
export function displayKey(prefix: string): string {
  return `${prefix}${"…"}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   IP whitelisting
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Validates a CIDR or bare address as an admin types it, so a typo is rejected
 * at save time with a pointable message rather than silently locking out a key.
 * Returns null when valid, or the reason it is not.
 */
export function validateCidr(entry: string): string | null {
  const value = entry.trim();
  if (!value) return "Empty entry.";

  const [addr, bits] = value.split("/");

  const isV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(addr);
  const isV6 = addr.includes(":") && /^[0-9a-fA-F:]+$/.test(addr);

  if (!isV4 && !isV6) return `"${value}" is not a valid IP address.`;

  if (isV4) {
    const octets = addr.split(".").map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return `"${value}" has an octet outside 0–255.`;
    }
  }

  if (bits !== undefined) {
    const n = Number(bits);
    const max = isV4 ? 32 : 128;
    if (!Number.isInteger(n) || n < 0 || n > max) {
      return `"${value}" has a prefix length outside 0–${max}.`;
    }
  }

  return null;
}

function ipv4ToInt(addr: string): number | null {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  // >>> 0 keeps it unsigned; a /0 mask would otherwise go negative.
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Whether `clientIp` falls inside any entry of `whitelist`.
 *
 * IPv4 gets real CIDR maths. IPv6 is compared literally after normalising case
 * and zone suffix — implementing IPv6 prefix arithmetic correctly is more code
 * than this earns, and a wrong implementation of an allow-list is worse than an
 * honestly narrow one. An admin entering an IPv6 CIDR is told at validation time
 * that only exact IPv6 addresses match.
 */
export function ipMatchesWhitelist(clientIp: string, whitelist: string[]): boolean {
  if (!whitelist || whitelist.length === 0) return true; // no restriction configured

  // x-forwarded-for is a comma-separated chain; the client is the first entry.
  const raw = (clientIp || "").split(",")[0].trim();
  // Strip an IPv4-mapped IPv6 prefix (::ffff:203.0.113.7) and any :port.
  const ip = raw.replace(/^::ffff:/i, "").replace(/%.*$/, "");

  const asInt = ipv4ToInt(ip);

  for (const entryRaw of whitelist) {
    const entry = entryRaw.trim();
    if (!entry) continue;

    const [addr, bitsRaw] = entry.split("/");

    if (asInt !== null) {
      const target = ipv4ToInt(addr);
      if (target === null) continue; // an IPv6 entry cannot match an IPv4 client
      const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      // A /0 mask must be 0, but 1<<32 overflows to 1 in JS bit ops — special-cased.
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((asInt & mask) === (target & mask)) return true;
    } else {
      if (addr.toLowerCase() === ip.toLowerCase()) return true;
    }
  }

  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   Authentication
   ══════════════════════════════════════════════════════════════════════════ */

export interface ApiKeyRow {
  id: number;
  /**
   * MT-05: the tenant this key belongs to.
   *
   * v1 traffic carries no session cookie, so getOrganizationId() would fall
   * back to sole-organization resolution — a guess that stops being correct the
   * moment a second tenant exists. The KEY is the tenant for this API, and it
   * is server-side data: the caller presents a secret, not an organization.
   */
  organization_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  rate_limit_per_min: number | null;
  ip_whitelist: string[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export type ApiAuthFailure =
  | "MISSING_KEY"
  | "MALFORMED_KEY"
  | "UNKNOWN_KEY"
  | "REVOKED"
  | "EXPIRED"
  | "IP_NOT_ALLOWED"
  | "INSUFFICIENT_SCOPE"
  | "RATE_LIMITED";

export type ApiAuthResult =
  | { ok: true; key: ApiKeyRow; clientIp: string }
  | {
      ok: false;
      code: ApiAuthFailure;
      message: string;
      status: 401 | 403 | 429;
      retryAfter?: number;
      /**
       * Set only once the presented key has been proven genuine — i.e. for
       * REVOKED, EXPIRED, IP_NOT_ALLOWED, INSUFFICIENT_SCOPE and RATE_LIMITED,
       * never for MISSING/MALFORMED/UNKNOWN. Those three have no verified
       * identity to attribute usage to, and attributing them by prefix alone
       * would let anyone inflate another key's usage by guessing its public
       * prefix. lib/apiV1.ts records usage only when this is present.
       */
      keyId?: number;
    };

/** Pulls the bearer token out of Authorization, or the X-API-Key fallback. */
function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  // Accepted because several no-code tools (Make, some Zapier actions) cannot
  // set an Authorization header but can set an arbitrary one.
  const header = req.headers.get("x-api-key");
  return header ? header.trim() : null;
}

export function clientIpOf(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Authenticate a request against the api_keys table and check one scope.
 *
 * Order matters and is not arbitrary: identity is established before anything
 * else is checked, so that a revoked/expired/rate-limited answer is only ever
 * given to someone who actually holds a real key. Answering "this key is
 * revoked" to an unauthenticated guess would confirm the key exists.
 */
export async function authenticateApiKey(
  req: Request,
  /**
   * The scope this route needs, or null for routes that require only a valid
   * key. Only /api/v1/ping passes null — it exists so an integrator can verify
   * credentials before they have decided which scopes to grant.
   */
  requiredScope: ApiScope | null
): Promise<ApiAuthResult> {
  const presented = extractKey(req);

  if (!presented) {
    return {
      ok: false,
      code: "MISSING_KEY",
      status: 401,
      message:
        "No API key supplied. Send it as `Authorization: Bearer bk_live_…` or `X-API-Key: bk_live_…`.",
    };
  }

  if (!presented.startsWith(KEY_MARKER)) {
    return {
      ok: false,
      code: "MALFORMED_KEY",
      status: 401,
      message: `API key is not in the expected format (should begin with \`${KEY_MARKER}\`).`,
    };
  }

  // prefix = marker + 16 hex id, i.e. everything before the second underscore
  // after the marker. Split rather than slice by length so a future format
  // change does not silently truncate.
  const body = presented.slice(KEY_MARKER.length);
  const keyId = body.split("_")[0];
  const prefix = `${KEY_MARKER}${keyId}`;

  const rows = await query<ApiKeyRow>(
    `SELECT id, organization_id, name, key_prefix, key_hash, scopes, rate_limit_per_min,
            ip_whitelist, expires_at, revoked_at, last_used_at
       FROM api_keys
      WHERE key_prefix = $1
      LIMIT 1`,
    [prefix]
  );

  const key = rows[0];

  // Compare even when the row is missing, against a dummy of the same length, so
  // that "unknown prefix" and "known prefix, wrong secret" take the same time.
  const presentedHash = hashApiKey(presented);
  const storedHash = key?.key_hash ?? "0".repeat(64);
  const matches = crypto.timingSafeEqual(
    Buffer.from(presentedHash, "hex"),
    Buffer.from(storedHash, "hex")
  );

  if (!key || !matches) {
    return { ok: false, code: "UNKNOWN_KEY", status: 401, message: "API key is not valid." };
  }

  if (key.revoked_at) {
    return {
      ok: false,
      code: "REVOKED",
      status: 401,
      keyId: key.id,
      message: "This API key has been revoked.",
    };
  }

  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      code: "EXPIRED",
      status: 401,
      keyId: key.id,
      message: `This API key expired on ${new Date(key.expires_at).toISOString().slice(0, 10)}.`,
    };
  }

  const clientIp = clientIpOf(req);
  if (!ipMatchesWhitelist(clientIp, key.ip_whitelist ?? [])) {
    return {
      ok: false,
      code: "IP_NOT_ALLOWED",
      status: 403,
      keyId: key.id,
      message: `Requests from ${clientIp.split(",")[0].trim()} are not permitted for this key.`,
    };
  }

  if (requiredScope !== null && !(key.scopes ?? []).includes(requiredScope)) {
    return {
      ok: false,
      code: "INSUFFICIENT_SCOPE",
      status: 403,
      keyId: key.id,
      message: `This key does not have the \`${requiredScope}\` scope.`,
    };
  }

  const limit = clampRateLimit(key.rate_limit_per_min);
  const used = await currentMinuteCount(key.id);
  if (used >= limit) {
    // Seconds until the current minute bucket rolls over.
    const retryAfter = 60 - new Date().getSeconds();
    return {
      ok: false,
      code: "RATE_LIMITED",
      status: 429,
      retryAfter,
      keyId: key.id,
      message: `Rate limit of ${limit} requests/minute exceeded for this key.`,
    };
  }

  return { ok: true, key, clientIp };
}

export function clampRateLimit(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_RATE_LIMIT_PER_MIN;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_RATE_LIMIT_PER_MIN);
}

async function currentMinuteCount(apiKeyId: number): Promise<number> {
  const rows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(request_count), 0)::text AS total
       FROM api_key_usage
      WHERE api_key_id = $1
        AND bucket_start = date_trunc('minute', NOW())`,
    [apiKeyId]
  );
  return Number(rows[0]?.total ?? 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   Usage recording
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Records one request against the per-minute bucket.
 *
 * Never throws, for the same reason writeAuditLog does not: a telemetry write
 * failing must not convert a served response into a 500. A missing usage row
 * under-counts the rate limit slightly, which is the safe direction to fail.
 */
export async function recordApiUsage(params: {
  apiKeyId: number;
  endpoint: string;
  status: number;
  durationMs: number;
  clientIp?: string;
}): Promise<void> {
  const statusClass = Math.trunc(params.status / 100);
  try {
    await query(
      // Organization inherited from the key itself: this runs on API-key traffic,
      // which carries no session cookie to read a claim from.
      `INSERT INTO api_key_usage
         (api_key_id, bucket_start, endpoint, status_class, request_count, total_duration_ms, organization_id)
       VALUES ($1, date_trunc('minute', NOW()), $2, $3, 1, $4,
               (SELECT organization_id FROM api_keys WHERE id = $1))
       ON CONFLICT (api_key_id, bucket_start, endpoint, status_class)
       DO UPDATE SET request_count     = api_key_usage.request_count + 1,
                     total_duration_ms = api_key_usage.total_duration_ms + EXCLUDED.total_duration_ms`,
      [params.apiKeyId, params.endpoint.slice(0, 160), statusClass, Math.max(0, Math.trunc(params.durationMs))]
    );

    // last_used_at at most once a minute per key. Without the WHERE clause this
    // would be a row update on api_keys for every single request, contending on
    // the same row that authentication reads.
    await query(
      `UPDATE api_keys
          SET last_used_at = NOW(), last_used_ip = $2
        WHERE id = $1
          AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute')`,
      [params.apiKeyId, (params.clientIp ?? "").split(",")[0].trim().slice(0, 64) || null]
    );

    // Opportunistic retention sweep — see the note at the foot of
    // developer_api_2026-08-07.sql. Roughly 1 request in 500 pays for it.
    if (Math.random() < 0.002) {
      await query(`DELETE FROM api_key_usage WHERE bucket_start < NOW() - INTERVAL '90 days'`);
    }
  } catch (err) {
    console.error("[apiKeys] usage write failed", errorText(err));
  }
}
