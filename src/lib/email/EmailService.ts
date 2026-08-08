// lib/email/EmailService.ts — the one way the CRM sends email.
//
// Every transactional email in the application is one method call here. Nothing
// outside lib/email/ builds a message, picks a provider, or opens a transport.
//
// ── Two kinds of send, and why the distinction matters ──────────────────────
//
//   sendRouted()   goes to a USER. Resolved through lib/emailRouting.ts, which
//                  applies the notification preference for the type, the
//                  current/alternative destination flags, and the failsafe.
//
//   sendDirect()   goes to an ADDRESS. Used only where routing would be wrong:
//                  an OTP must reach the address being tested, and an invitation
//                  must reach someone who has no account and therefore no
//                  preferences.
//
// Getting this backwards is a real bug with a quiet failure mode. Routing a
// verification code through the preference engine delivers it to the addresses
// already configured — never to the one under test — so the code never arrives
// and the address can never be verified. The two methods make the choice
// explicit at each call site instead of hiding it behind one send().
//
// ── Audit logging ───────────────────────────────────────────────────────────
// Every method records what happened, success or failure, with the recipient
// and a timestamp. Failures carry the classified error kind, so "why did nobody
// get their password alerts last Tuesday" is answerable from the activity log
// rather than from server logs that have since rotated away.
//
// Logging never throws. A failed audit write must not turn a delivered email
// into a 500 that makes the caller retry and send it twice.

import { writeAuditLog } from "@/lib/auditLog";
import { sendToUser, type EmailType, type RoutedSendResult } from "@/lib/emailRouting";
import { activeProvider, isMailConfigured, readSenderConfig } from "./config";
import { dispatch, verifyProvider } from "./provider";
import type { EmailError, SendOutcome } from "./types";
import {
  employeeInvitationTemplate,
  failedLoginBurstTemplate,
  loginAlertTemplate,
  otpTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  subscriptionTemplate,
  supportReplyTemplate,
  systemNotificationTemplate,
  testEmailTemplate,
  type FailedLoginBurstInput,
  type InvitationInput,
  type LoginAlertInput,
  type OtpTemplateInput,
  type PasswordChangedInput,
  type PasswordResetInput,
  type SubscriptionInput,
  type SupportReplyInput,
  type SystemNotificationInput,
  type Template,
} from "./templates";

/* ══════════════════════════════════════════════════════════════════════════
   Results
   ══════════════════════════════════════════════════════════════════════════ */

export interface DirectSendResult {
  delivered: boolean;
  provider: string;
  messageId?: string;
  error?: EmailError;
}

/* ══════════════════════════════════════════════════════════════════════════
   Audit
   ══════════════════════════════════════════════════════════════════════════ */

interface AuditContext {
  userId?: number | null;
  actorName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

async function record(
  action: string,
  recipient: string,
  outcome: { delivered: boolean; provider?: string; error?: EmailError },
  context: AuditContext,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    await writeAuditLog({
      userId: context.userId ?? null,
      actorName: context.actorName ?? null,
      // Delivered and failed are separate actions rather than one action with a
      // flag, so the activity-log filter can show "every email that failed"
      // without reading the payload of every row.
      action: outcome.delivered ? action : "email.failed",
      entityType: "email",
      entityId: recipient,
      newValue: {
        type: action,
        recipient,
        provider: outcome.provider ?? activeProvider(),
        delivered: outcome.delivered,
        sentAt: new Date().toISOString(),
        ...(outcome.error
          ? { errorKind: outcome.error.kind, error: outcome.error.message, retryable: outcome.error.retryable }
          : {}),
        ...extra,
      },
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
  } catch (err) {
    console.error(
      "[email] could not write audit entry:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   The two send paths
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Send to an explicit address, bypassing notification preferences.
 *
 * Correct only where the address IS the subject of the email — a code sent to
 * prove control of an address, or an invitation to someone with no account.
 */
async function sendDirect(
  to: string,
  template: Template,
  auditAction: string,
  context: AuditContext,
  extra?: Record<string, unknown>
): Promise<DirectSendResult> {
  const outcome: SendOutcome = await dispatch({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
    attachments: template.attachments,
  });

  await record(auditAction, to, outcome, context, extra);

  return {
    delivered: outcome.delivered,
    provider: outcome.provider,
    messageId: outcome.messageId,
    error: outcome.error,
  };
}

/**
 * Send to a user, through their notification preferences.
 *
 * The heavy lifting is lib/emailRouting.ts: it checks whether the notification
 * type is switched on at all, resolves the current/alternative destinations, and
 * fires the fallback if the primary address bounces. This wraps it so every
 * routed send is audited the same way as a direct one.
 */
async function sendRouted(
  userId: number,
  emailType: EmailType,
  template: Template,
  auditAction: string,
  context: AuditContext
): Promise<RoutedSendResult> {
  const result = await sendToUser(userId, emailType, {
    subject: template.subject,
    text: template.text,
    html: template.html,
    attachments: template.attachments,
  });

  // A suppressed send is not a failure — the user switched it off — so it is
  // recorded as its own action rather than counted among delivery errors.
  if (result.suppressed) {
    await record(
      "email.suppressed",
      "(none — notification disabled)",
      { delivered: false },
      { ...context, userId },
      { type: auditAction, emailType, notes: result.notes }
    );
    return result;
  }

  for (const attempt of result.attempted) {
    await record(
      auditAction,
      attempt.email,
      // The routing engine already carries the classified error, so it is passed
      // through rather than rebuilt — reconstructing it here would flatten every
      // failure to `unknown` and lose the kind the classifier worked out.
      { delivered: attempt.delivered, error: attempt.error },
      { ...context, userId },
      { emailType, destination: attempt.destination, fallbackUsed: result.fallbackUsed }
    );
  }

  return result;
}

/* ══════════════════════════════════════════════════════════════════════════
   EmailService
   ══════════════════════════════════════════════════════════════════════════ */

export const EmailService = {
  /* ── Configuration ── */

  isConfigured: isMailConfigured,
  provider: activeProvider,
  sender: readSenderConfig,

  /** Open a connection and authenticate without sending. */
  verify: verifyProvider,

  /* ── Verification codes ── */

  /**
   * A one-time code, to the address being verified.
   *
   * Direct, never routed: the entire point is to prove control of THIS address.
   *
   * Hashing, expiry, the attempt cap and the per-hour rate limit belong to the
   * caller (lib/alternativeEmailVerification.ts), which owns the state. This
   * method renders and sends; it deliberately never sees the hash, and it never
   * logs the code — an OTP in the activity log is a live credential readable by
   * anyone with log access.
   */
  async sendOTP(
    to: string,
    input: OtpTemplateInput,
    context: AuditContext = {}
  ): Promise<DirectSendResult> {
    return sendDirect(to, otpTemplate(input), "email.otp_sent", context, {
      purpose: input.purpose,
      expiryMinutes: input.expiryMinutes,
    });
  },

  /* ── Security ── */

  async sendLoginAlert(
    userId: number,
    input: LoginAlertInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    const emailType: EmailType = input.isNewDevice
      ? "login.new_device"
      : input.status === "Failed"
        ? "login.failed"
        : "login.success";

    return sendRouted(
      userId,
      emailType,
      loginAlertTemplate(input),
      "email.login_alert_sent",
      context
    );
  },

  async sendFailedLoginBurst(
    userId: number,
    input: FailedLoginBurstInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    return sendRouted(
      userId,
      "security.alert",
      failedLoginBurstTemplate(input),
      "email.security_alert_sent",
      context
    );
  },

  async sendPasswordChanged(
    userId: number,
    input: PasswordChangedInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    return sendRouted(
      userId,
      "password.changed",
      passwordChangedTemplate(input),
      "email.password_changed_sent",
      context
    );
  },

  /**
   * A password reset link.
   *
   * Direct, not routed, and the reason is worth stating: someone who cannot sign
   * in cannot change their notification preferences either, so honouring a
   * "password reset" toggle would let a user lock themselves out permanently
   * with a setting they made months earlier. The reset link goes to the address
   * that asked for it.
   */
  async sendPasswordReset(
    to: string,
    input: PasswordResetInput,
    context: AuditContext = {}
  ): Promise<DirectSendResult> {
    return sendDirect(to, passwordResetTemplate(input), "email.password_reset_sent", context, {
      expiryMinutes: input.expiryMinutes,
    });
  },

  /* ── Team ── */

  /**
   * An invitation, to someone who does not have an account yet.
   *
   * Direct by necessity: there is no user row, so there are no preferences to
   * route through.
   */
  async sendEmployeeInvitation(
    to: string,
    input: InvitationInput,
    context: AuditContext = {}
  ): Promise<DirectSendResult> {
    return sendDirect(
      to,
      employeeInvitationTemplate(input),
      "email.invitation_sent",
      context,
      { organization: input.organization, role: input.role }
    );
  },

  /* ── Support ── */

  async sendSupportReply(
    userId: number,
    input: SupportReplyInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    return sendRouted(
      userId,
      "support.reply",
      supportReplyTemplate(input),
      "email.support_reply_sent",
      context
    );
  },

  /* ── Subscription & billing ── */

  /**
   * Subscription, plan, invoice and payment mail.
   *
   * `emailType` selects which notification switch governs it — the billing group
   * has nine keys and they are genuinely separate choices, so the caller names
   * the one it means rather than having them collapsed into a single "billing"
   * toggle.
   */
  async sendSubscriptionEmail(
    userId: number,
    emailType: EmailType,
    input: SubscriptionInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    return sendRouted(
      userId,
      emailType,
      subscriptionTemplate(input),
      "email.subscription_sent",
      context
    );
  },

  /* ── System ── */

  async sendSystemNotification(
    userId: number,
    emailType: EmailType,
    input: SystemNotificationInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    return sendRouted(
      userId,
      emailType,
      systemNotificationTemplate(input),
      "email.system_notification_sent",
      context
    );
  },

  /* ── Diagnostics ── */

  /** Send a test message to prove the configuration works end to end. */
  async sendTestEmail(to: string, context: AuditContext = {}): Promise<DirectSendResult> {
    return sendDirect(to, testEmailTemplate(activeProvider()), "email.test_sent", context);
  },
};

export type EmailServiceType = typeof EmailService;
