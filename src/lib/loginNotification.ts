// lib/loginNotification.ts — LoginNotificationService.
//
// Collects sign-in metadata, works out which address was used to sign in,
// resolves recipients through the routing engine, detects new devices, and
// sends the alert. Also owns the failed-login burst alert, because it needs the
// same metadata gathering and the same recipient resolution.
//
// ── Fire-and-forget ─────────────────────────────────────────────────────────
// Nothing here is awaited by the login route. An SMTP handshake takes hundreds
// of milliseconds on a good day and up to the transport's 10s connection timeout
// on a bad one, and no one should wait for their security-alert email to be
// handed to a mail server before their dashboard loads.
//
// That is safe in this app specifically because it runs as a persistent Node
// process — lib/db.ts already depends on the same assumption for its keepalive
// interval. On a per-request serverless runtime a floating promise can be killed
// mid-flight and this would need an after()/waitUntil() wrapper instead.
//
// Every path is wrapped so a mail failure can never surface as a failed login.
// Someone locked out of the CRM because their notification address bounced would
// be a far worse bug than a missing alert.

import { query } from "@/lib/db";
import { writeAuditLog } from "@/lib/auditLog";
import {
  checkAndRecordDevice,
  describeDevice,
  getPreferences,
  resolveRecipients,
} from "@/lib/emailRouting";
import { EmailService } from "@/lib/email/EmailService";
import { resolveApproximateLocation } from "@/lib/email/location";
import {
  describeLockStatus,
  issueDeviceConfirmLinks,
  recordFailedLogin,
  FAILED_LOGIN_THRESHOLD,
  FAILED_LOGIN_WINDOW_MINUTES,
  type FailedAttemptRecord,
} from "@/lib/loginSecurity";

export interface LoginContext {
  userId: number;
  name: string;
  role: string;
  /** The account's own email column. */
  accountEmail: string | null;
  /** Exactly what was typed into the sign-in form. */
  identifierUsed: string;
  ip: string;
  userAgent: string;
  sessionId: number | string | null;
  status: "Successful" | "Failed";
  /** Absolute origin, needed for the "Was this you?" links. */
  origin: string;
}

/* ── Shared metadata ────────────────────────────────────────────────────── */

/** Phone / Tablet / Desktop, from the user agent. Distinct from OS and browser. */
function deviceTypeOf(userAgent: string): string {
  const ua = userAgent || "";
  // Tablet before phone: an iPad UA contains neither "Mobile" nor "iPhone" in
  // desktop mode, but an Android tablet UA contains "Android" without "Mobile".
  if (/ipad|tablet|playbook|silk/i.test(ua)) return "Tablet";
  if (/android/i.test(ua) && !/mobile/i.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|windows phone/i.test(ua)) return "Phone";
  return "Desktop";
}

async function organizationName(): Promise<string> {
  try {
    const rows = await query<{ workspace_name: string | null }>(
      `SELECT workspace_name FROM organization_settings WHERE organization_id = 1 LIMIT 1`
    );
    return rows[0]?.workspace_name?.trim() || "Bhoomi Dwellers";
  } catch {
    return "Bhoomi Dwellers";
  }
}

/**
 * Format a moment in the user's own timezone.
 *
 * Reads users.timezone rather than assuming IST. A login alert whose timestamp
 * is in the wrong timezone is actively harmful: the recipient is being asked
 * "was this you at this time", and a three-hour offset makes a legitimate login
 * look like an intrusion.
 */
async function formatInUserTimezone(
  userId: number,
  when: Date = new Date()
): Promise<{ date: string; time: string; timezone: string }> {
  let timezone = "Asia/Kolkata";

  try {
    const rows = await query<{ timezone: string | null }>(
      `SELECT timezone FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (rows[0]?.timezone) timezone = rows[0].timezone;
  } catch {
    /* fall through to the default */
  }

  try {
    return {
      date: when.toLocaleDateString("en-GB", {
        timeZone: timezone,
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      time: when.toLocaleTimeString("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      timezone,
    };
  } catch {
    // An invalid IANA name in the column would otherwise throw out of the whole
    // notification. UTC with an honest label beats no alert at all.
    return {
      date: when.toISOString().slice(0, 10),
      time: when.toISOString().slice(11, 19),
      timezone: "UTC",
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Sign-in alert
   ══════════════════════════════════════════════════════════════════════════ */

export async function notifyLogin(ctx: LoginContext): Promise<void> {
  try {
    const { browser, os, label } = describeDevice(ctx.userAgent);

    // Device recording only makes sense for a login that actually succeeded.
    // Marking a device "known" on a failed password attempt would let an
    // attacker suppress the new-device warning for their own machine simply by
    // guessing wrong once first.
    const device =
      ctx.status === "Successful"
        ? await checkAndRecordDevice(ctx.userId, ctx.userAgent, ctx.ip)
        : { isNewDevice: false, label, fingerprint: "" };

    const [{ date, time, timezone }, organization, prefs] = await Promise.all([
      formatInUserTimezone(ctx.userId),
      organizationName(),
      getPreferences(ctx.userId),
    ]);

    // The recipient list is computed here purely so the email can SAY where it
    // went. sendToUser resolves it again independently — this is a read for
    // display, not the routing decision, and duplicating the read is cheaper
    // than threading the result out of the send.
    const recipients = prefs ? resolveRecipients(prefs).addresses : [];

    // Which address was typed. Compared case-insensitively against both the
    // account email and the verified alternative; anything else (a username, or
    // the user's name, both of which the login route accepts) is reported as
    // the primary, because that is the account it resolved to.
    const typed = ctx.identifierUsed.trim().toLowerCase();
    const isAlternative =
      Boolean(prefs?.alternativeEmailVerified) &&
      typed.length > 0 &&
      typed === (prefs?.alternativeEmail ?? "").trim().toLowerCase();

    const firstSeen = await deviceFirstSeen(ctx.userId, device.fingerprint);

    // Links only for a new device, and only when the token could be stored.
    let confirmUrl: string | undefined;
    let secureUrl: string | undefined;
    if (device.isNewDevice && device.fingerprint) {
      const links = await issueDeviceConfirmLinks({
        userId: ctx.userId,
        deviceHash: device.fingerprint,
        origin: ctx.origin,
      });
      if (links) {
        confirmUrl = links.confirmUrl;
        secureUrl = links.secureUrl;
      }
    }

    // The service picks the email type from `status` and `isNewDevice`, applies
    // the notification preference, resolves the destinations and audits the
    // outcome. This call site describes the event; it decides nothing about
    // delivery.
    await EmailService.sendLoginAlert(ctx.userId, {
      name: ctx.name,
      employeeId: ctx.userId,
      role: ctx.role || "—",
      organization,
      date,
      time,
      timezone,
      browser,
      operatingSystem: os,
      device: device.label,
      deviceType: deviceTypeOf(ctx.userAgent),
      ipAddress: (ctx.ip || "unknown").split(",")[0].trim(),
      location: resolveApproximateLocation(ctx.ip),
      status: ctx.status,
      sessionId: ctx.sessionId,
      // Password is the only sign-in method this CRM has. Reported literally
      // rather than as a placeholder for an SSO/2FA flow that does not exist.
      loginMethod: "Password",
      loginEmail: ctx.identifierUsed || ctx.accountEmail || "—",
      loginEmailKind: isAlternative ? "Alternative Email" : "Primary Email",
      accountEmail: ctx.accountEmail ?? "—",
      alternativeEmail: prefs?.alternativeEmailVerified ? prefs.alternativeEmail : null,
      notificationRecipients: recipients,
      isNewDevice: device.isNewDevice,
      deviceFirstSeen: firstSeen,
      confirmUrl,
      secureUrl,
    }, { userId: ctx.userId, actorName: ctx.name, ip: ctx.ip, userAgent: ctx.userAgent });
  } catch (err) {
    console.error(
      "[loginNotification] could not send sign-in alert:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function deviceFirstSeen(userId: number, fingerprint: string): Promise<string | null> {
  if (!fingerprint) return null;
  try {
    const rows = await query<{ first_seen_at: string }>(
      `SELECT first_seen_at FROM known_login_devices
        WHERE user_id = $1 AND device_hash = $2 LIMIT 1`,
      [userId, fingerprint]
    );
    if (!rows[0]) return null;
    return new Date(rows[0].first_seen_at).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Failed-login burst alert
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Record a failed attempt and, if it crosses the threshold, send the burst alert.
 *
 * Returns nothing and throws nothing. Call it without awaiting.
 *
 * Attempts against an identifier that matches no account are still RECORDED —
 * that is the pattern worth seeing in the table — but no alert is sent, because
 * there is no one to send it to. Inventing a recipient would mean mailing
 * whoever happens to own that address about an account they do not have.
 */
export async function handleFailedLogin(params: {
  userId: number | null;
  name: string | null;
  role: string | null;
  accountEmail: string | null;
  identifier: string;
  ip: string;
  userAgent: string;
  origin: string;
}): Promise<void> {
  try {
    const outcome = await recordFailedLogin({
      userId: params.userId,
      identifier: params.identifier,
      ip: params.ip,
      userAgent: params.userAgent,
    });

    if (!params.userId) return;

    // The per-attempt alert. Separate from the burst alert below: one says
    // "someone got your password wrong", the other says "someone is working
    // through a list", and they warrant different subjects and urgency.
    await notifyLogin({
      userId: params.userId,
      name: params.name ?? "there",
      role: params.role ?? "—",
      accountEmail: params.accountEmail,
      identifierUsed: params.identifier,
      ip: params.ip,
      userAgent: params.userAgent,
      sessionId: null,
      status: "Failed",
      origin: params.origin,
    });

    if (!outcome.thresholdCrossed) return;

    const organization = await organizationName();

    const attempts = await Promise.all(
      outcome.recent.map(async (attempt: FailedAttemptRecord) => {
        const { date, time, timezone } = await formatInUserTimezone(
          params.userId as number,
          new Date(attempt.created_at)
        );
        return {
          time: `${date} at ${time} (${timezone})`,
          ip: attempt.ip_address ?? "unknown",
          browser: describeDevice(attempt.user_agent ?? "").browser,
          location: resolveApproximateLocation(attempt.ip_address ?? ""),
        };
      })
    );

    await EmailService.sendFailedLoginBurst(
      params.userId,
      {
        name: params.name ?? "there",
        organization,
        attemptCount: outcome.count,
        windowMinutes: FAILED_LOGIN_WINDOW_MINUTES,
        identifierAttempted: params.identifier,
        attempts,
        lockStatus: describeLockStatus(),
      },
      {
        userId: params.userId,
        actorName: params.name,
        ip: params.ip,
        userAgent: params.userAgent,
      }
    );

    await writeAuditLog({
      userId: params.userId,
      actorName: params.name,
      action: "security.failed_login_threshold",
      entityType: "user",
      entityId: params.userId,
      newValue: {
        attempts: outcome.count,
        windowMinutes: FAILED_LOGIN_WINDOW_MINUTES,
        threshold: FAILED_LOGIN_THRESHOLD,
        identifier: params.identifier,
      },
      ipAddress: params.ip,
      userAgent: params.userAgent,
    });
  } catch (err) {
    console.error(
      "[loginNotification] failed-login handling error:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
