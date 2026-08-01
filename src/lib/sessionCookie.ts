// sessionCookie.ts — integrity for the `crm_session` cookie.
//
// The cookie used to be plain base64(JSON). base64 is an encoding, not a
// signature: anyone could craft `{"role":"admin"}`, base64 it, and every route
// in the CRM would treat them as an Admin, because getServerSession() simply
// decoded whatever arrived. httpOnly stops a page script reading the cookie; it
// does nothing about a forged one sent from curl.
//
// The value is now `<payload>.<signature>`, where the signature is HMAC-SHA256
// over the exact payload string, keyed by SESSION_SECRET. A payload edited by
// one byte no longer matches, and the signature cannot be recomputed without the
// server secret.
//
// Web Crypto rather than node:crypto on purpose: middleware.ts runs on the Edge
// runtime, where node:crypto is unavailable, and it must verify the same cookie
// the Node route handlers do. globalThis.crypto.subtle exists in both.
//
// This is integrity only, not encryption — the payload stays readable by anyone
// holding the cookie, exactly as before. It carries id/name/email/role, no
// secrets. Encrypting it would change what every consumer sees for no gain here.

const SIGNED_SEPARATOR = ".";

/**
 * Fail closed. A missing secret means every session is rejected rather than
 * silently falling back to unsigned cookies — a deployment that forgets the
 * variable must break loudly at login, not quietly accept forgeries.
 */
function getSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Backed by an explicit ArrayBuffer so the result types as Uint8Array<ArrayBuffer>
// rather than Uint8Array<ArrayBufferLike>, which crypto.subtle won't accept as a
// BufferSource under TypeScript's typed-array generics.
function b64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Session lifetime, matching the cookie's maxAge.
 *
 * The expiry is carried INSIDE the signed payload, not just as a cookie
 * attribute. maxAge is a hint the browser honours; it is not a control. A cookie
 * value copied out of devtools, a log, or a proxy stays valid forever if the
 * only thing bounding it is the browser's willingness to send it. `exp` is
 * covered by the signature, so it cannot be extended without the secret.
 */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Serialize + sign a session payload for the cookie value.
 * Returns null when no secret is configured, so the caller can refuse to issue a
 * session rather than handing out an unverifiable one.
 */
export async function signSession(payload: Record<string, unknown>): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const withClaims = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };

  const encoded = bytesToB64Url(encoder.encode(JSON.stringify(withClaims)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encoded));
  return `${encoded}${SIGNED_SEPARATOR}${bytesToB64Url(new Uint8Array(signature))}`;
}

/**
 * Verify and parse a cookie value. Returns null for anything that is not a
 * correctly signed payload — including legacy unsigned cookies, which are
 * indistinguishable from a forgery and so are refused rather than grandfathered.
 *
 * crypto.subtle.verify does the comparison, so it is not a plain string equality
 * that leaks timing.
 */
export async function verifySession<T = any>(value: string | undefined | null): Promise<T | null> {
  if (!value) return null;
  const secret = getSecret();
  if (!secret) return null;

  const separatorAt = value.lastIndexOf(SIGNED_SEPARATOR);
  if (separatorAt <= 0 || separatorAt === value.length - 1) return null;

  const encoded = value.slice(0, separatorAt);
  const signature = value.slice(separatorAt + 1);

  try {
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64UrlToBytes(signature),
      encoder.encode(encoded)
    );
    if (!valid) return null;

    const parsed = JSON.parse(decoder.decode(b64UrlToBytes(encoded)));

    // Fail closed on the expiry claim. A payload with no `exp` is either a
    // session issued before expiries existed or one crafted to omit the field —
    // indistinguishable here, and both are refused rather than trusted forever.
    const exp = Number(parsed?.exp);
    if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;

    return parsed as T;
  } catch {
    // Malformed base64, malformed JSON, or a signature that isn't a signature.
    return null;
  }
}

/** Whether a signing secret is configured at all — used for a clear 503 at login. */
export function isSessionSigningConfigured(): boolean {
  return getSecret() !== null;
}
