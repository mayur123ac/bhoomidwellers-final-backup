// lib/secretsCrypto.ts — envelope encryption for secrets held in the database.
//
// Until now every credential in this CRM lived in .env.local: Twilio's auth
// token, Meta's access token, the session HMAC key. That works when there is one
// deployment and one operator, and it is why nothing here existed before.
//
// Bolna breaks the pattern, because its credentials are entered by an admin in
// the settings panel at runtime rather than by an operator at deploy time. They
// have to land in Postgres. A Bolna API key placed on a plaintext column is then
// readable by anyone with a database URL, a Neon console login, a `pg_dump`, or
// a SQL-injection foothold anywhere in the app — and it can place billable calls
// on the account. So it gets encrypted before it is stored.
//
// ── The threat this does and does not address ────────────────────────────────
//
// Encrypting at rest with a key from the environment defends against exposure of
// the database alone: a leaked dump, a backup on someone's laptop, a read-only
// replica, an over-broad SELECT. It does not defend against an attacker who has
// the application's environment, because then they have the key too. That is the
// standard trade and it is worth being explicit about rather than implying more.
//
// ── AES-256-GCM ──────────────────────────────────────────────────────────────
//
// Authenticated, so a tampered ciphertext fails loudly at decrypt instead of
// producing garbage that gets sent to Bolna as a Bearer token. A fresh 12-byte
// IV per encryption (GCM's native size — no truncation, no reuse).
//
// The envelope is JSON so it can sit in a jsonb column and be inspected without
// decoding anything, and versioned so a future algorithm change is a migration
// rather than a guess.

import crypto from "node:crypto";

/** Bump when the envelope shape or algorithm changes. Decrypt refuses others. */
const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** The env var an operator sets. Documented in the settings panel's error text. */
export const SECRETS_KEY_ENV = "SECRETS_ENCRYPTION_KEY";

export interface SecretEnvelope {
  v: number;
  alg: string;
  /** base64 IV. */
  iv: string;
  /** base64 GCM auth tag. */
  tag: string;
  /** base64 ciphertext. */
  ct: string;
  /**
   * First 8 hex chars of SHA-256 over the key. Not a secret — 8 chars of a hash
   * of a 32-byte key is not a meaningful oracle — and it turns "the key was
   * rotated and every stored secret is now undecryptable" from a mysterious
   * auth failure into a specific, reportable error.
   */
  kid: string;
}

export class SecretsCryptoError extends Error {
  readonly code: "KEY_MISSING" | "KEY_INVALID" | "DECRYPT_FAILED" | "KEY_MISMATCH";

  constructor(code: SecretsCryptoError["code"], message: string) {
    super(message);
    this.name = "SecretsCryptoError";
    this.code = code;
  }
}

/**
 * How to produce a key, quoted back to the admin whenever one is missing. Kept
 * next to the code that needs it so the two cannot drift.
 */
export const KEY_SETUP_HINT =
  `Set ${SECRETS_KEY_ENV} in .env.local to a 32-byte random value. Generate one with:\n` +
  `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"\n` +
  `Use the same value in every environment that reads this database, and treat ` +
  `it like a password — rotating it makes every already-stored secret unreadable.`;

/**
 * Resolves the master key from the environment.
 *
 * Read on every call rather than cached at module scope, for the reason set out
 * at the top of config/whatsapp.config.ts: `next build` evaluates route modules
 * with an environment that may not have .env.local in it, and a module-scope
 * read would freeze that absence into the build.
 *
 * Three input formats are accepted because operators reasonably produce keys
 * three different ways, and rejecting two of them is a support ticket:
 *
 *   base64 (44 chars) — what the hint above generates
 *   hex    (64 chars) — what `openssl rand -hex 32` produces
 *   anything else     — treated as a passphrase and stretched with scrypt
 *
 * The scrypt branch uses a fixed salt. A random salt cannot work here: the salt
 * would have to be stored somewhere to reproduce the key, and the only place to
 * store it is the same database whose compromise we are defending against, so it
 * would add ceremony without adding security. A passphrase is weaker than a
 * random 32-byte key either way, which is why the hint recommends the latter.
 */
function resolveKey(): Buffer {
  const raw = (process.env[SECRETS_KEY_ENV] ?? "").trim();

  if (!raw) {
    throw new SecretsCryptoError(
      "KEY_MISSING",
      `${SECRETS_KEY_ENV} is not set, so secrets cannot be encrypted or read.\n${KEY_SETUP_HINT}`
    );
  }

  // Hex first: a 64-char hex string is also valid base64url-ish input, and
  // decoding it as base64 would silently yield 48 wrong bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  if (/^[A-Za-z0-9+/]{43}=$|^[A-Za-z0-9+/]{44}$/.test(raw)) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === KEY_BYTES) return buf;
  }

  if (raw.length < 16) {
    throw new SecretsCryptoError(
      "KEY_INVALID",
      `${SECRETS_KEY_ENV} is too short to be usable (needs at least 16 characters as a ` +
        `passphrase, or 32 bytes as base64/hex).\n${KEY_SETUP_HINT}`
    );
  }

  return crypto.scryptSync(raw, "bhoomi-crm-secrets-v1", KEY_BYTES);
}

/** Stable, non-secret identifier for whichever key is currently configured. */
function keyId(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** True when a usable key is configured. For preflight checks that must not throw. */
export function isSecretsCryptoConfigured(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts a UTF-8 string into a storable envelope. Throws if no key is set. */
export function encryptSecret(plaintext: string): SecretEnvelope {
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
    kid: keyId(key),
  };
}

/**
 * Reverses encryptSecret.
 *
 * The `kid` comparison happens before the decrypt attempt purely so the error
 * message is useful. GCM would reject a wrong key anyway, but as an
 * indistinguishable "unable to authenticate data" — which sends whoever is
 * debugging it looking for corruption rather than for the key someone rotated.
 */
export function decryptSecret(envelope: unknown): string {
  const env = envelope as SecretEnvelope | null;

  if (!env || typeof env !== "object" || typeof env.ct !== "string") {
    throw new SecretsCryptoError("DECRYPT_FAILED", "Stored secret is not a valid envelope.");
  }
  if (env.v !== ENVELOPE_VERSION || env.alg !== ALGORITHM) {
    throw new SecretsCryptoError(
      "DECRYPT_FAILED",
      `Stored secret uses an unsupported format (v${env.v}, ${env.alg}).`
    );
  }

  const key = resolveKey();

  if (env.kid && env.kid !== keyId(key)) {
    throw new SecretsCryptoError(
      "KEY_MISMATCH",
      `Stored secret was encrypted with a different ${SECRETS_KEY_ENV} (expected key ` +
        `${env.kid}, current key is ${keyId(key)}). Restore the previous key, or re-enter ` +
        `the credentials in the settings panel to re-encrypt them with the current one.`
    );
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(env.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The underlying message is always "unable to authenticate data" and adds
    // nothing; swallowing it avoids implying the ciphertext is recoverable.
    throw new SecretsCryptoError(
      "DECRYPT_FAILED",
      "Stored secret could not be decrypted. It may have been altered in the database."
    );
  }
}

/**
 * The masked form shown in the settings panel: `bn-••••••••4f2a`.
 *
 * Enough for an admin to confirm which key is installed against what they hold
 * in their password manager, and not enough to reconstruct it. Values short
 * enough that a 4-char tail would be a large fraction of the whole are masked
 * completely.
 */
export function maskSecret(plaintext: string): string {
  const s = String(plaintext ?? "");
  if (s.length <= 8) return "•".repeat(Math.max(s.length, 4));

  // Bolna keys are prefixed `bn-` (and `sa-` for subaccounts). Keeping the
  // prefix visible makes a subaccount key pasted into a main-account field
  // obvious at a glance.
  const prefixMatch = s.match(/^(bn-|sa-)/);
  const prefix = prefixMatch ? prefixMatch[1] : "";

  return `${prefix}${"•".repeat(8)}${s.slice(-4)}`;
}
