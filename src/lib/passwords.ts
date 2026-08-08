// lib/passwords.ts — password hashing and verification.
//
// ── The state this replaces ─────────────────────────────────────────────────
// Passwords in this CRM are stored in plaintext. /api/auth/login compared
// `user.password.trim() !== password.trim()`, and /api/employees SELECTs the
// column and ships it to the admin browser, where the directory renders it
// behind a show/hide toggle. Anyone with a database dump, a Neon console login,
// or that one admin screen has every user's actual password — and people reuse
// passwords across services, so the blast radius is not just this CRM.
//
// ── Why this is a fallback and not a migration ──────────────────────────────
// Hashes are one-way, so existing plaintext rows cannot be converted without
// each user's password. Rewriting them all to random values would lock 11 people
// out of a live CRM. Instead:
//
//   * verifyPassword() accepts BOTH formats. A stored value starting with the
//     `scrypt$` marker is verified cryptographically; anything else is treated
//     as a legacy plaintext row and compared directly.
//   * Every path that WRITES a password from here on writes a hash.
//
// So the plaintext rows drain away as people change their passwords, and nothing
// breaks on the way. `needsRehash()` lets a caller upgrade a row opportunistically
// the next time it sees the correct plaintext — which is what the login route does.
//
// ── Why scrypt and not bcrypt ───────────────────────────────────────────────
// scrypt ships inside node:crypto. bcrypt would mean adding a dependency to a
// project that has none for this, and `bcrypt` proper needs a native build. The
// parameters below are Node's defaults scaled to the OWASP-recommended N=2^16,
// which costs ~100ms per verification — deliberate, and the point.

import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "crypto";
import { promisify } from "util";

// promisify() resolves to scrypt's 3-argument overload, which drops the options
// parameter that carries N/r/p and maxmem. The cast picks the 4-argument form.
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

const SCHEME = "scrypt";
const N = 65536; // 2^16
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// scrypt needs memory proportional to 128 * N * r — ~64MB at these settings.
// Node's default maxmem is 32MB and would throw, so it is raised explicitly
// rather than quietly weakening N to fit.
const MAX_MEM = 128 * N * BLOCK_SIZE * 2;

/** Stored format: scrypt$<N>$<r>$<p>$<salt-hex>$<hash-hex> */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scrypt(plain.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEM,
  })) as Buffer;

  return [
    SCHEME,
    N,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/** True when `stored` is one of our hashes rather than a legacy plaintext row. */
export function isHashed(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(`${SCHEME}$`);
}

/**
 * True when the stored value should be replaced with a fresh hash — i.e. it is
 * still plaintext. Callers that hold the verified plaintext can upgrade the row
 * in place.
 */
export function needsRehash(stored: string | null | undefined): boolean {
  return !isHashed(stored);
}

/**
 * Verify a candidate password against a stored value in either format.
 *
 * The legacy branch keeps the exact comparison the login route used —
 * `.trim()` on both sides — because tightening it here would lock out anyone
 * whose stored password has a stray space, which is precisely the kind of row
 * plaintext storage produces.
 */
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!stored || !plain) return false;

  if (!isHashed(stored)) {
    // Legacy plaintext row. Constant-time is pointless here — the value is
    // already readable to anyone who can reach the column — but it costs nothing.
    const a = Buffer.from(plain.trim());
    const b = Buffer.from(stored.trim());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const parts = stored.split("$");
  if (parts.length !== 6) return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = (await scrypt(plain.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    })) as Buffer;

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export interface PasswordRuleResult {
  length: boolean;
  upper: boolean;
  lower: boolean;
  number: boolean;
  special: boolean;
}

/**
 * The rules the spec's checklist renders. Mirrors validatePassword() in the
 * existing employees page so the two screens cannot disagree about what a valid
 * password is; `lower` is included here because that screen already enforces it.
 */
export function checkPasswordRules(password: string): PasswordRuleResult {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export function passwordMeetsRules(password: string): boolean {
  return Object.values(checkPasswordRules(password)).every(Boolean);
}
