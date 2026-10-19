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
import { activeProvider, isCustomerEnquiryEmailEnabled, isMailConfigured, readSenderConfig } from "./config";
import { dispatch, verifyProvider } from "./provider";
import { loadTriggerConfig } from "./triggerConfig";
import type { EmailError, SendOutcome } from "./types";
import { esc, renderEmail } from "./templates/layout";
import {
  employeeInvitationTemplate,
  enquiryConfirmationTemplate,
  failedLoginBurstTemplate,
  loginAlertTemplate,
  otpTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  subscriptionTemplate,
  supportReplyTemplate,
  systemNotificationTemplate,
  testEmailTemplate,
  type EnquiryConfirmationInput,
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
   Trigger configuration gate
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Check the admin-configured enabled/disabled state for a trigger and load
 * any custom subject/body.
 *
 * Returns { skip: true } when the trigger is explicitly disabled, with a
 * pre-built result the caller can return immediately. The audit log records
 * the intentional skip as "email.admin_disabled" — distinct from both
 * "email.suppressed" (user preference) and "email.failed" (delivery error).
 *
 * When the trigger is enabled (or unknown/errored — fail-safe), returns the
 * custom subject and body so the caller can apply overrides before sending.
 */
interface TriggerGate {
  skip: boolean;
  directResult?: DirectSendResult;
  customSubject?: string | null;
  customBody?: string | null;
}

async function checkTrigger(
  triggerKey: string,
  auditAction: string,
  recipient: string,
  context: AuditContext
): Promise<TriggerGate> {
  const config = await loadTriggerConfig(triggerKey);
  if (config && !config.enabled) {
    await record(
      "email.admin_disabled",
      recipient || "(trigger disabled)",
      { delivered: false, provider: "disabled" },
      context,
      { triggerKey, type: auditAction }
    );
    return { skip: true, directResult: { delivered: false, provider: "disabled" } };
  }
  return {
    skip: false,
    customSubject: config?.subject ?? null,
    customBody: config?.body ?? null,
  };
}

/**
 * Apply admin-customised subject and/or body to a built template.
 *
 * Escaping strategy (context-dependent):
 *
 *   Subject    — plain text. Variable values inserted verbatim; the provider's
 *                `sanitiseHeader()` strips newlines/control chars at the
 *                transport boundary.
 *
 *   HTML body  — resolve variables with plain values, then `esc()` the ENTIRE
 *                result once. This escapes both the admin's template text and
 *                every variable value uniformly. Newlines become `<br/>` AFTER
 *                escaping. The result is wrapped in the branded email layout
 *                (header, footer, logo, company name are always preserved).
 *
 *   Plain text — variable values inserted verbatim (no escaping needed).
 *
 * Custom body replaces only the content area, never the structural shell.
 */
function applyOverrides(
  template: Template,
  gate: TriggerGate,
  vars: Record<string, string>
): Template {
  if (!gate.customSubject && !gate.customBody) return template;

  const resolve = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);

  let result = template;

  if (gate.customSubject) {
    result = { ...result, subject: resolve(gate.customSubject) };
  }

  if (gate.customBody) {
    const plainText = resolve(gate.customBody);
    // Escape the entire resolved text (template + values) once, then convert
    // newlines. This prevents any variable value from introducing HTML tags.
    const safeHtml = esc(plainText).replace(/\r?\n/g, "<br/>");

    const heading = gate.customSubject
      ? resolve(gate.customSubject)
      : template.subject;

    const rendered = renderEmail({
      preview: heading,
      heading,
      bodyHtml: `<p style="margin:0 0 14px;line-height:1.7;">${safeHtml}</p>`,
      bodyText: plainText,
    });
    result = {
      ...result,
      html: rendered.html,
      text: rendered.text,
      attachments: rendered.attachments,
    };
  }

  return result;
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
    const triggerKey = /reset.*password/i.test(input.purpose) ? "password_reset" : "otp_verification";
    const gate = await checkTrigger(triggerKey, "email.otp_sent", to, context);
    if (gate.skip) return gate.directResult!;
    const vars = { name: input.name, code: input.code, expiry_minutes: String(input.expiryMinutes), purpose: input.purpose };
    return sendDirect(to, applyOverrides(otpTemplate(input), gate, vars), "email.otp_sent", context, {
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
    const gate = await checkTrigger("login_alert", "email.login_alert_sent", "", context);
    if (gate.skip) return { delivered: false, suppressed: true, attempted: [], fallbackUsed: false, notes: ["admin_disabled"] };
    const emailType: EmailType = input.isNewDevice
      ? "login.new_device"
      : input.status === "Failed"
        ? "login.failed"
        : "login.success";
    const vars = { name: input.name, date: input.date, time: input.time, device: input.device, browser: input.browser, ip_address: input.ipAddress, location: input.location };

    return sendRouted(
      userId,
      emailType,
      applyOverrides(loginAlertTemplate(input), gate, vars),
      "email.login_alert_sent",
      context
    );
  },

  /**
   * Notify an admin about another user's login.
   *
   * Direct, not routed: the admin's interest in team logins is not governed
   * by the signing-in user's notification preferences.
   *
   * Accepts BOTH the pre-built template (for the default path) AND the raw
   * alert input (for the custom-template path). When a custom subject/body
   * is configured, `applyOverrides` resolves the admin-notification variables
   * into it; otherwise the caller's pre-built template is sent unchanged.
   */
  async sendAdminLoginNotification(
    to: string,
    template: Template,
    context: AuditContext = {},
    extra?: Record<string, unknown>,
    alertInput?: LoginAlertInput
  ): Promise<DirectSendResult> {
    const gate = await checkTrigger("admin_login_notification", "email.admin_login_alert_sent", to, context);
    if (gate.skip) return gate.directResult!;
    const vars: Record<string, string> = alertInput
      ? {
          employee_name: alertInput.name,
          role: alertInput.role,
          date: alertInput.date,
          time: alertInput.time,
          device: alertInput.device,
          ip_address: alertInput.ipAddress,
          location: alertInput.location,
        }
      : {};
    return sendDirect(to, applyOverrides(template, gate, vars), "email.admin_login_alert_sent", context, extra);
  },

  async sendFailedLoginBurst(
    userId: number,
    input: FailedLoginBurstInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    const gate = await checkTrigger("failed_login_burst", "email.security_alert_sent", "", context);
    if (gate.skip) return { delivered: false, suppressed: true, attempted: [], fallbackUsed: false, notes: ["admin_disabled"] };
    const vars = { name: input.name, organization: input.organization };
    return sendRouted(
      userId,
      "security.alert",
      applyOverrides(failedLoginBurstTemplate(input), gate, vars),
      "email.security_alert_sent",
      context
    );
  },

  async sendPasswordChanged(
    userId: number,
    input: PasswordChangedInput,
    context: AuditContext = {}
  ): Promise<RoutedSendResult> {
    const gate = await checkTrigger("password_changed", "email.password_changed_sent", "", context);
    if (gate.skip) return { delivered: false, suppressed: true, attempted: [], fallbackUsed: false, notes: ["admin_disabled"] };
    const vars = { name: input.name, date: input.timestamp, time: input.timestamp };
    return sendRouted(
      userId,
      "password.changed",
      applyOverrides(passwordChangedTemplate(input), gate, vars),
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
    const gate = await checkTrigger("password_reset", "email.password_reset_sent", to, context);
    if (gate.skip) return gate.directResult!;
    const vars = { name: input.name, expiry_minutes: String(input.expiryMinutes) };
    return sendDirect(to, applyOverrides(passwordResetTemplate(input), gate, vars), "email.password_reset_sent", context, {
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
    const gate = await checkTrigger("employee_invitation", "email.invitation_sent", to, context);
    if (gate.skip) return gate.directResult!;
    const vars = { name: input.name, organization: input.organization, role: input.role };
    return sendDirect(
      to,
      applyOverrides(employeeInvitationTemplate(input), gate, vars),
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
    const gate = await checkTrigger("support_reply", "email.support_reply_sent", "", context);
    if (gate.skip) return { delivered: false, suppressed: true, attempted: [], fallbackUsed: false, notes: ["admin_disabled"] };
    const vars = { name: input.name };
    return sendRouted(
      userId,
      "support.reply",
      applyOverrides(supportReplyTemplate(input), gate, vars),
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
    const gate = await checkTrigger("subscription_email", "email.subscription_sent", "", context);
    if (gate.skip) return { delivered: false, suppressed: true, attempted: [], fallbackUsed: false, notes: ["admin_disabled"] };
    const vars = { name: input.name };
    return sendRouted(
      userId,
      emailType,
      applyOverrides(subscriptionTemplate(input), gate, vars),
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
    const gate = await checkTrigger("system_notification", "email.system_notification_sent", "", context);
    if (gate.skip) return { delivered: false, suppressed: true, attempted: [], fallbackUsed: false, notes: ["admin_disabled"] };
    const vars = { name: input.name };
    return sendRouted(
      userId,
      emailType,
      applyOverrides(systemNotificationTemplate(input), gate, vars),
      "email.system_notification_sent",
      context
    );
  },

  /* ── Walk-in enquiries ── */

  /**
   * Confirmation email to the customer immediately after a walk-in enquiry is
   * registered. Goes directly to the customer's address — there is no CRM user
   * account to route through. Fire-and-forget at the call site; SMTP failure
   * must never fail the enquiry.
   *
   * Gated by CUSTOMER_ENQUIRY_EMAILS_ENABLED. When false, returns immediately
   * without opening a transport connection. All other email types are unaffected.
   * To re-enable: set CUSTOMER_ENQUIRY_EMAILS_ENABLED=true (or remove the var).
   */
  async sendEnquiryConfirmation(
    to: string,
    input: EnquiryConfirmationInput,
    context: AuditContext = {}
  ): Promise<DirectSendResult> {
    if (!isCustomerEnquiryEmailEnabled()) {
      return { delivered: false, provider: "disabled" };
    }
    const gate = await checkTrigger("enquiry_confirmation", "email.enquiry_confirmation_sent", to, context);
    if (gate.skip) return gate.directResult!;
    const vars = { customer_name: input.clientName, organization: input.orgName, assigned_to: input.assignedTo ?? "" };
    return sendDirect(
      to,
      applyOverrides(enquiryConfirmationTemplate(input), gate, vars),
      "email.enquiry_confirmation_sent",
      context,
      { orgName: input.orgName, assignedTo: input.assignedTo }
    );
  },

  /* ── Diagnostics ── */

  /** Send a test message to prove the configuration works end to end. */
  async sendTestEmail(to: string, context: AuditContext = {}): Promise<DirectSendResult> {
    const gate = await checkTrigger("test_email", "email.test_sent", to, context);
    if (gate.skip) return gate.directResult!;
    const vars = { provider: activeProvider() };
    return sendDirect(to, applyOverrides(testEmailTemplate(activeProvider()), gate, vars), "email.test_sent", context);
  },
};

export type EmailServiceType = typeof EmailService;
