// lib/emailRouting.ts — whether a user's notifications are sent, and where.
//
// One decision, made in one place. Before this, "which address" was answered by
// each route reading `users.email` directly, which is why a person could set an
// alternative address and still receive password alerts at the old one.
//
// ── Two questions, two modules ──────────────────────────────────────────────
// WHETHER a notification is sent is lib/notificationPreferenceService.ts, which
// reads the per-type switches on the Notifications settings screen.
// WHERE it goes is this file. sendToUser() applies both, in that order, and is
// the only path the CRM uses to mail a person — so every notification is gated
// by construction rather than by each caller remembering to check.
//
// ── The routing model ───────────────────────────────────────────────────────
// Two independent switches rather than one choice of destination:
//
//   current  alternative   result
//   ───────  ───────────   ──────────────────────────────────────────
//     on         off       current only
//     off        on        alternative only
//     on         on        both
//     off        off       nothing is sent
//
// The last row is a real, saveable state. The UI confirms it explicitly because
// silently disabling security alerts is not something to do on a stray click,
// but it is the user's decision to make and the engine honours it.
//
// ── The failsafe ────────────────────────────────────────────────────────────
// Delivery to the current address failing does not end the attempt: if the
// alternative is enabled AND verified AND fallback is on, the same message is
// sent there instead, and the attempt is logged as `fallback` so the logs show
// the failsafe firing rather than just two configured recipients.
//
// The failsafe deliberately does NOT fire when the alternative is unverified.
// An unverified address is one nobody has proven they control; falling back to
// it would forward security alerts — new-device logins, password changes — to
// an address that could have been typed in by mistake or by someone else.

import crypto from "node:crypto";
import { query } from "@/lib/db";
import { dispatch } from "@/lib/email/provider";
import type { EmailError, EmailMessage, SendOutcome } from "@/lib/email/types";
import { isKnownNotificationKey } from "@/lib/notificationCatalogue";
import { isNotificationEnabled } from "@/lib/notificationPreferenceService";

/* ══════════════════════════════════════════════════════════════════════════
   Email types
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every system email, and the catalogue key whose toggle governs it.
 *
 * ── Why there are two vocabularies ──────────────────────────────────────────
 * `EmailType` is what the SENDING code says: it names a message that exists in
 * lib/email/templates/ and is stamped on every row of email_delivery_attempts,
 * which is why the strings cannot simply be renamed — that column has history in
 * it.
 *
 * `notificationKey` is what the USER sees: an entry in lib/notificationCatalogue.ts
 * with a label, a description and a switch on the settings screen.
 *
 * They are not one-to-one, and forcing them to be would lose something in both
 * directions. Several email types answer to one switch — a single failed sign-in
 * and the five-in-fifteen-minutes burst alert are both "Failed login attempt" to
 * the person reading the list, and splitting them into two switches would ask
 * them a question they have no basis to answer. Meanwhile the catalogue carries
 * keys no email type emits yet (billing, webhooks, 2FA), because a preference is
 * worth storing before the feature that reads it lands.
 *
 * This map is the join. Every type must name a key that exists — assertMapping()
 * below fails at import time otherwise, so a typo here surfaces on boot rather
 * than as a notification that quietly ignores its toggle.
 *
 * ── Security mail is no longer exempt ───────────────────────────────────────
 * An earlier version of this file exempted `security` messages from per-category
 * muting, on the grounds that a compromised account most needs to see them. The
 * notification centre supersedes that: the spec is explicit that the admin has
 * complete control over which emails they receive, and every security key is
 * listed there with its own switch.
 *
 * The protection that remains is the one that matters — security keys default to
 * ON, so silencing them takes a deliberate act rather than an omission. What no
 * longer happens is the CRM overriding a choice the user made on purpose.
 */
export const EMAIL_TYPES = {
  "login.success": {
    group: "security",
    label: "Successful login",
    notificationKey: "security.login_success",
  },
  "login.failed": {
    group: "security",
    label: "Failed login attempt",
    notificationKey: "security.failed_login",
  },
  "login.new_device": {
    group: "security",
    label: "New device login",
    notificationKey: "security.new_device",
  },
  "password.changed": {
    group: "security",
    label: "Password changed",
    notificationKey: "security.password_changed",
  },
  "password.reset": {
    group: "security",
    label: "Password reset",
    notificationKey: "security.password_reset",
  },
  "twofa.enabled": {
    group: "security",
    label: "Two-factor authentication enabled",
    notificationKey: "security.twofa_enabled",
  },
  "twofa.disabled": {
    group: "security",
    label: "Two-factor authentication disabled",
    notificationKey: "security.twofa_disabled",
  },
  "session.revoked": {
    group: "security",
    label: "Session revoked",
    notificationKey: "security.session_revoked",
  },
  "altemail.verified": {
    group: "security",
    label: "Alternative email verified",
    notificationKey: "security.alt_email_verified",
  },
  "apikey.created": {
    group: "developer",
    label: "API key generated",
    notificationKey: "developer.api_key_created",
  },
  "apikey.revoked": {
    group: "developer",
    label: "API key revoked",
    notificationKey: "developer.api_key_revoked",
  },
  // The five-failed-attempts-in-fifteen-minutes burst alert. Shares a switch
  // with login.failed on purpose — see the note above.
  "security.alert": {
    group: "security",
    label: "Security alert",
    notificationKey: "security.failed_login",
  },

  "employee.invited": {
    group: "team",
    label: "Employee invited",
    notificationKey: "team.employee_invited",
  },
  "employee.removed": {
    group: "team",
    label: "Employee removed",
    notificationKey: "team.employee_removed",
  },
  "employee.deactivated": {
    group: "team",
    label: "Employee deactivated",
    notificationKey: "team.employee_deactivated",
  },
  "employee.role_changed": {
    group: "team",
    label: "Role changed",
    notificationKey: "team.role_changed",
  },

  "workspace.changed": {
    group: "workspace",
    label: "Workspace settings changed",
    notificationKey: "workspace.settings_updated",
  },
  "system.announcement": {
    group: "system",
    label: "System announcement",
    notificationKey: "system.feature_announcement",
  },
  "system.security_notice": {
    group: "system",
    label: "Critical security announcement",
    notificationKey: "system.security_announcement",
  },
  "system.maintenance": {
    group: "system",
    label: "Maintenance notice",
    notificationKey: "system.maintenance",
  },
  "system.product_update": {
    group: "system",
    label: "Product update",
    notificationKey: "system.product_updates",
  },
  "support.reply": {
    group: "support",
    label: "Support ticket reply",
    notificationKey: "support.ticket_replied",
  },

  "digest.daily": {
    group: "digest",
    label: "Daily summary",
    notificationKey: "system.digest_daily",
  },
  "digest.weekly": {
    group: "digest",
    label: "Weekly report",
    notificationKey: "system.digest_weekly",
  },
  "digest.monthly": {
    group: "digest",
    label: "Monthly report",
    notificationKey: "system.digest_monthly",
  },
} as const;

export type EmailType = keyof typeof EMAIL_TYPES;

/** The catalogue key whose switch governs an email type. */
export function notificationKeyFor(type: EmailType): string {
  return EMAIL_TYPES[type].notificationKey;
}

// A type whose key is not in the catalogue would be ungovernable: the settings
// screen could not show a switch for it, and isNotificationEnabled() would fall
// through to its unknown-key branch and send it regardless of what the user
// wanted. Checked at import time so the mistake cannot reach production.
for (const [type, definition] of Object.entries(EMAIL_TYPES)) {
  if (!isKnownNotificationKey(definition.notificationKey)) {
    throw new Error(
      `[emailRouting] "${type}" maps to notification key "${definition.notificationKey}", ` +
        `which is not in lib/notificationCatalogue.ts.`
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Preferences
   ══════════════════════════════════════════════════════════════════════════ */

export interface RoutingPreferences {
  userId: number;
  sendCurrentEmail: boolean;
  sendAlternativeEmail: boolean;
  currentEmail: string | null;
  alternativeEmail: string | null;
  alternativeEmailVerified: boolean;
  fallbackEnabled: boolean;
}

// Deliberately stricter than the RFC allows. The point is to reject typos that
// would silently black-hole notifications, not to admit every technically legal
// address — nobody is configuring `"quoted string"@example.com` here.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v.length > 0 && v.length <= 255 && EMAIL_RE.test(v);
}

/**
 * Load a user's routing configuration.
 *
 * Falls back to a synthesised default when no preferences row exists, rather
 * than returning null. A user created after this migration ran — or one whose
 * row was missed by the backfill — must still receive their password-reset
 * email; treating "no row" as "no delivery" would turn a missing INSERT into
 * silent, unattributable mail loss.
 */
export async function getPreferences(userId: number): Promise<RoutingPreferences | null> {
  const rows = await query<{
    user_id: number;
    email: string | null;
    send_current_email: boolean | null;
    send_alternative_email: boolean | null;
    alternative_email: string | null;
    alternative_email_verified: boolean | null;
    fallback_enabled: boolean | null;
  }>(
    `SELECT u.id AS user_id,
            u.email,
            p.send_current_email,
            p.send_alternative_email,
            p.alternative_email,
            p.alternative_email_verified,
            p.fallback_enabled
       FROM users u
       LEFT JOIN notification_preferences p ON p.user_id = u.id
      WHERE u.id = $1
      LIMIT 1`,
    [userId]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    // `?? true` is the no-row default: deliver to the account address.
    sendCurrentEmail: row.send_current_email ?? true,
    sendAlternativeEmail: row.send_alternative_email ?? false,
    currentEmail: row.email,
    alternativeEmail: row.alternative_email,
    alternativeEmailVerified: row.alternative_email_verified ?? false,
    fallbackEnabled: row.fallback_enabled ?? true,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Recipient resolution
   ══════════════════════════════════════════════════════════════════════════ */

export interface ResolvedRecipient {
  email: string;
  destination: "current" | "alternative";
}

export interface RecipientResolution {
  recipients: ResolvedRecipient[];
  /** The plain address list the spec's getRecipients() contract describes. */
  addresses: string[];
  /** Populated when the list is empty or shorter than configured. */
  notes: string[];
}

/**
 * Resolve where a user's mail should go.
 *
 * Applies, in order: enabled flags → address presence → validity →
 * verification (alternative only) → de-duplication.
 *
 * De-duplication is case-insensitive and matters more than it looks: a user who
 * enables both destinations and sets the alternative to the same address as
 * their account email would otherwise receive two copies of every security
 * alert, and the second copy makes the first look like a duplicate attack
 * warning.
 */
export function resolveRecipients(prefs: RoutingPreferences): RecipientResolution {
  const recipients: ResolvedRecipient[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  const add = (email: string, destination: ResolvedRecipient["destination"]) => {
    const key = email.trim().toLowerCase();
    if (seen.has(key)) {
      notes.push(
        `The alternative address is the same as the account address; it was sent once, not twice.`
      );
      return;
    }
    seen.add(key);
    recipients.push({ email: email.trim(), destination });
  };

  if (prefs.sendCurrentEmail) {
    if (isValidEmail(prefs.currentEmail)) {
      add(prefs.currentEmail as string, "current");
    } else {
      notes.push("The account email is missing or invalid, so it was skipped.");
    }
  }

  if (prefs.sendAlternativeEmail) {
    if (!isValidEmail(prefs.alternativeEmail)) {
      notes.push("The alternative email is missing or invalid, so it was skipped.");
    } else if (!prefs.alternativeEmailVerified) {
      notes.push("The alternative email is not verified yet, so it was skipped.");
    } else {
      add(prefs.alternativeEmail as string, "alternative");
    }
  }

  return { recipients, addresses: recipients.map((r) => r.email), notes };
}

/**
 * The contract the spec names: a plain array of addresses for a user.
 *
 * Kept as a thin wrapper over resolveRecipients so callers that only want
 * "where does this go" do not have to destructure a richer result. sendToUser()
 * below is what most code should use — it also handles the failsafe, which this
 * function cannot, because falling back requires knowing that a send failed.
 */
export async function getRecipients(userId: number): Promise<string[]> {
  const prefs = await getPreferences(userId);
  if (!prefs) return [];
  return resolveRecipients(prefs).addresses;
}

/* ══════════════════════════════════════════════════════════════════════════
   Sending
   ══════════════════════════════════════════════════════════════════════════ */

export interface RoutedSendResult {
  /** True when at least one address accepted the message. */
  delivered: boolean;
  // The classified error travels with each attempt rather than being flattened
  // to a string here. EmailService writes `kind` and `retryable` into the audit
  // log, and "every failure last week was `auth`" is a different conclusion from
  // "every failure last week was `timeout`" — one is a wrong password, the other
  // is a network problem. Flattening loses exactly that distinction.
  attempted: { email: string; destination: string; delivered: boolean; error?: EmailError }[];
  /** True when the failsafe fired — current failed and the alternative took it. */
  fallbackUsed: boolean;
  /**
   * True when the user has this notification switched off, so nothing was sent
   * and nothing was attempted.
   *
   * Distinguished from `delivered: false` because they mean opposite things to a
   * caller: a suppressed notification worked exactly as configured, while an
   * undelivered one is a failure worth logging or retrying. Conflating them is
   * how a muted preference ends up in an error dashboard.
   */
  suppressed: boolean;
  /** Diagnostics for the caller to surface or log. */
  notes: string[];
}

async function recordAttempt(params: {
  userId: number;
  emailType: EmailType;
  recipient: string;
  destination: string;
  result: SendOutcome;
}): Promise<void> {
  try {
    // The error column keeps the classified kind alongside the message. Knowing
    // a batch of failures was `auth` rather than `timeout` is the difference
    // between "the password is wrong" and "the network blipped", and the raw
    // message alone does not reliably say which.
    const error = params.result.error
      ? `[${params.result.error.kind}] ${params.result.error.message}`
      : null;

    await query(
      `INSERT INTO email_delivery_attempts
         (user_id, email_type, recipient, destination, delivered, transport, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.userId,
        params.emailType,
        params.recipient.slice(0, 255),
        params.destination,
        params.result.delivered,
        // Column is named `transport` for history; it holds the provider name.
        params.result.provider,
        error,
      ]
    );
  } catch (err) {
    // Never throws, for the same reason writeAuditLog does not: a logging
    // failure must not turn a delivered email into a 500 that makes the caller
    // retry and send it twice.
    console.error(
      "[emailRouting] could not record delivery attempt:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Send a system email to a user, honouring their preferences.
 *
 * This is the function every notification in the CRM should call. `message.to`
 * is ignored — the recipients come from the preferences, which is the whole
 * point — so callers pass a template and let this decide the destination.
 *
 * Two gates, in this order:
 *
 *   1. WHETHER  isNotificationEnabled() — the user's switch for this type.
 *   2. WHERE    resolveRecipients()     — which addresses, if any.
 *
 * The order matters. Checking the switch first means a muted notification costs
 * one indexed read (usually a cache hit) instead of loading routing preferences
 * and resolving addresses for a message that was never going to be sent.
 *
 * There is no bypass parameter, deliberately. The requirement is that no
 * notification skips the preference check, and an `ignorePreferences` flag is
 * exactly the thing that erodes that — it gets added for one urgent case and is
 * copied into the next five. Mail that genuinely must reach an address
 * regardless of preferences is not a notification: OTP codes, verification
 * links and invitations to people who have no account yet all go through
 * directly with an explicit recipient, which is the honest way to say so.
 */
export async function sendToUser(
  userId: number,
  emailType: EmailType,
  message: Omit<EmailMessage, "to">
): Promise<RoutedSendResult> {
  // ── Gate 1: does the user want this notification at all? ──
  const notificationKey = notificationKeyFor(emailType);

  if (!(await isNotificationEnabled(userId, notificationKey))) {
    return {
      delivered: false,
      attempted: [],
      fallbackUsed: false,
      suppressed: true,
      notes: [`"${EMAIL_TYPES[emailType].label}" is switched off in notification settings.`],
    };
  }

  // ── Gate 2: where does it go? ──
  const prefs = await getPreferences(userId);

  if (!prefs) {
    return {
      delivered: false,
      attempted: [],
      fallbackUsed: false,
      suppressed: false,
      notes: ["No such user, so there was nowhere to send."],
    };
  }

  const { recipients, notes } = resolveRecipients(prefs);

  if (recipients.length === 0) {
    return {
      delivered: false,
      attempted: [],
      fallbackUsed: false,
      suppressed: false,
      notes: notes.length > 0 ? notes : ["Email notifications are disabled for this user."],
    };
  }

  const attempted: RoutedSendResult["attempted"] = [];
  let anyDelivered = false;
  let currentFailed = false;
  let alreadySentToAlternative = false;

  for (const recipient of recipients) {
    const result = await dispatch({ ...message, to: recipient.email });

    attempted.push({
      email: recipient.email,
      destination: recipient.destination,
      delivered: result.delivered,
      error: result.error,
    });

    await recordAttempt({
      userId,
      emailType,
      recipient: recipient.email,
      destination: recipient.destination,
      result,
    });

    if (result.delivered) anyDelivered = true;
    if (recipient.destination === "current" && !result.delivered) currentFailed = true;
    if (recipient.destination === "alternative") alreadySentToAlternative = true;
  }

  // ── The failsafe ──
  // Only when the current address actually failed, the alternative was not
  // already in the recipient list, and it is enabled-or-fallback-eligible,
  // verified, and valid.
  //
  // Note the condition is `fallbackEnabled`, not `sendAlternativeEmail`: the
  // failsafe is exactly for the case where the user did NOT choose to receive
  // routine mail at the alternative but does want a safety net when the primary
  // bounces. Requiring the destination to be switched on would make the feature
  // do nothing in the situation it exists for.
  let fallbackUsed = false;

  if (
    currentFailed &&
    !alreadySentToAlternative &&
    prefs.fallbackEnabled &&
    prefs.alternativeEmailVerified &&
    isValidEmail(prefs.alternativeEmail)
  ) {
    const fallbackAddress = (prefs.alternativeEmail as string).trim();

    // Guard against the alternative being the same address that just failed —
    // retrying it would be a pointless second failure and a duplicate log row.
    if (fallbackAddress.toLowerCase() !== (prefs.currentEmail ?? "").trim().toLowerCase()) {
      const result = await dispatch({ ...message, to: fallbackAddress });

      attempted.push({
        email: fallbackAddress,
        destination: "fallback",
        delivered: result.delivered,
        error: result.error,
      });

      await recordAttempt({
        userId,
        emailType,
        recipient: fallbackAddress,
        destination: "fallback",
        result,
      });

      if (result.delivered) {
        anyDelivered = true;
        fallbackUsed = true;
        notes.push(
          "Delivery to the account email failed, so the message was sent to the verified alternative address."
        );
      }
    }
  }

  return { delivered: anyDelivered, attempted, fallbackUsed, suppressed: false, notes };
}

/* ══════════════════════════════════════════════════════════════════════════
   Device fingerprinting
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A stable id for a browser/OS combination.
 *
 * Hashes the user agent with the volatile parts stripped — version numbers
 * change on every browser update, and without this every Chrome auto-update
 * would be reported as a new device.
 */
export function deviceFingerprint(userAgent: string): string {
  const normalised = (userAgent || "unknown")
    .toLowerCase()
    // Drop version numbers: "chrome/121.0.6167.85" → "chrome/"
    .replace(/[\d.]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

export interface DeviceDescription {
  browser: string;
  os: string;
  label: string;
}

/** Human-readable browser and OS, for the login email. */
export function describeDevice(userAgent: string): DeviceDescription {
  const ua = userAgent || "";

  // Order matters throughout: Edge and Opera both contain "Chrome", and Chrome
  // contains "Safari". Testing the more specific string first is the only way
  // these come out right.
  let browser = "Unknown browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = "Opera";
  else if (/chrome\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua)) browser = "Safari";

  let os = "Unknown OS";
  if (/windows nt 10/i.test(ua)) os = "Windows 10/11";
  else if (/windows/i.test(ua)) os = "Windows";
  // iOS before macOS: an iPhone UA contains "like Mac OS X".
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  return { browser, os, label: `${os} / ${browser}` };
}

export interface DeviceCheck {
  isNewDevice: boolean;
  label: string;
  fingerprint: string;
}

/**
 * Record this login's device and report whether it had been seen before.
 *
 * The very first login for an account is NOT reported as a new device. It is
 * technically true and operationally useless: everyone's first login would
 * arrive with a security warning attached, which is how people learn to ignore
 * security warnings.
 */
export async function checkAndRecordDevice(
  userId: number,
  userAgent: string,
  ip: string
): Promise<DeviceCheck> {
  const fingerprint = deviceFingerprint(userAgent);
  const { label } = describeDevice(userAgent);

  try {
    const existing = await query<{ id: number }>(
      `SELECT id FROM known_login_devices WHERE user_id = $1 AND device_hash = $2 LIMIT 1`,
      [userId, fingerprint]
    );

    const knownCount = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM known_login_devices WHERE user_id = $1`,
      [userId]
    );
    const isFirstEverLogin = Number(knownCount[0]?.count ?? 0) === 0;

    await query(
      `INSERT INTO known_login_devices (user_id, device_hash, device_label, last_ip)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, device_hash)
       DO UPDATE SET last_seen_at = NOW(), last_ip = EXCLUDED.last_ip`,
      [userId, fingerprint, label.slice(0, 160), (ip || "").split(",")[0].trim().slice(0, 64)]
    );

    return {
      isNewDevice: existing.length === 0 && !isFirstEverLogin,
      label,
      fingerprint,
    };
  } catch (err) {
    // A device-tracking failure must not fail the login. Reporting "not new"
    // is the quieter wrong answer: a spurious security warning is worse than a
    // missing one here, because the login itself is already audit-logged.
    console.error(
      "[emailRouting] device check failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { isNewDevice: false, label, fingerprint };
  }
}
