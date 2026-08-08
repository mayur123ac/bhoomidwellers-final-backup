// lib/email/templates/index.ts — every email the CRM sends.
//
// Each function takes plain data and returns a ready message: subject, HTML,
// text and attachments. None of them sends anything, none touches the database,
// and none knows which provider is in use — which is what makes them testable
// by calling them and reading the output.
//
// All interpolation goes through `esc()` in layout.ts. Subjects are sanitised at
// the provider boundary, so a display name containing a newline cannot inject a
// header no matter which template built the subject.

import {
  button,
  callout,
  codeBlock,
  detailTable,
  detailText,
  esc,
  renderEmail,
  safeUrl,
  type DetailRow,
} from "./layout";
import { readSenderConfig } from "../config";
import type { EmailAttachment } from "../types";

export interface Template {
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
}

function build(
  subject: string,
  options: Parameters<typeof renderEmail>[0]
): Template {
  const rendered = renderEmail(options);
  return { subject, html: rendered.html, text: rendered.text, attachments: rendered.attachments };
}

/** A paragraph, escaped. */
function p(text: string): string {
  return `<p style="margin:0 0 14px;">${esc(text)}</p>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   OTP verification
   ══════════════════════════════════════════════════════════════════════════ */

export interface OtpTemplateInput {
  name: string;
  code: string;
  expiryMinutes: number;
  /** What the code authorises, e.g. "verify this address for notifications". */
  purpose: string;
  /** Optional single-click alternative to typing the code. */
  verifyUrl?: string | null;
  requestedFromIp?: string | null;
  requestedFromDevice?: string | null;
}

export function otpTemplate(input: OtpTemplateInput): Template {
  const link = safeUrl(input.verifyUrl);

  const context: DetailRow[] = [
    { label: "Requested from", value: input.requestedFromIp },
    { label: "Device", value: input.requestedFromDevice },
  ];

  return build("Your verification code - Bhoomi Dwellers CRM", {
    // The code is deliberately NOT in the preheader or the subject. Both are
    // visible on a locked phone screen, which would defeat the point of a
    // second factor the moment someone glances at the notification.
    preview: `Your verification code expires in ${input.expiryMinutes} minutes.`,
    heading: "Verify your email address",
    bodyHtml: `
${p(`Hi ${input.name},`)}
${p(`Use this code to ${input.purpose}.`)}
${codeBlock(input.code)}
${p(`The code expires in ${input.expiryMinutes} minutes and can be used once.`)}
${link ? button("Verify without typing the code", link) : ""}
${detailTable(context)}
`,
    bodyText: `Hi ${input.name},

Use this code to ${input.purpose}:

    ${input.code}

The code expires in ${input.expiryMinutes} minutes and can be used once.
${link ? `\nOr verify in one click:\n${link}\n` : ""}
${detailText(context)}`,
    securityNote:
      "Nobody from Bhoomi Dwellers will ever ask you for this code. If you did not request " +
      "it, you can ignore this email — nothing changes until the code is entered.",
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Login alert
   ══════════════════════════════════════════════════════════════════════════ */

export interface LoginAlertInput {
  name: string;
  employeeId: number | string;
  role: string;
  organization: string;
  date: string;
  time: string;
  timezone: string;
  browser: string;
  operatingSystem: string;
  device: string;
  deviceType: string;
  ipAddress: string;
  location: string;
  status: "Successful" | "Failed";
  sessionId: string | number | null;
  loginMethod: string;
  loginEmail: string;
  loginEmailKind: "Primary Email" | "Alternative Email";
  accountEmail: string;
  alternativeEmail: string | null;
  notificationRecipients: string[];
  isNewDevice: boolean;
  deviceFirstSeen: string | null;
  confirmUrl?: string | null;
  secureUrl?: string | null;
}

export function loginAlertTemplate(d: LoginAlertInput): Template {
  const subject = d.isNewDevice
    ? "New device login detected - Bhoomi CRM"
    : d.status === "Failed"
      ? "Failed login attempt - Bhoomi CRM"
      : "New login detected - Bhoomi CRM";

  const rows: DetailRow[] = [
    { label: "Status", value: d.status },
    { label: "Employee name", value: d.name },
    { label: "Employee ID", value: d.employeeId },
    { label: "Role", value: d.role },
    { label: "Organization", value: d.organization },
    { label: "Date & time", value: `${d.date} at ${d.time}` },
    { label: "Timezone", value: d.timezone },
    { label: "Browser", value: d.browser },
    { label: "Operating system", value: d.operatingSystem },
    { label: "Device", value: d.device },
    { label: "Device type", value: d.deviceType },
    { label: "IP address", value: d.ipAddress },
    { label: "Approximate location", value: d.location },
    { label: "Session ID", value: d.sessionId ?? "—" },
    { label: "Login method", value: d.loginMethod },
    { label: "Signed in using", value: `${d.loginEmail} (${d.loginEmailKind})` },
  ];

  const addresses: DetailRow[] = [
    { label: "Account email", value: d.accountEmail },
    { label: "Alternative email", value: d.alternativeEmail ?? "Not set" },
  ];

  // The warning banner and the call to action appear only for a new device. A
  // "was this you?" button on every routine sign-in is how people learn to
  // ignore the button.
  const warning = d.isNewDevice
    ? callout(
        "warning",
        "New device detected",
        `This sign-in came from a device that has not been used with this account before. ` +
          `First seen ${esc(d.deviceFirstSeen ?? "just now")}.`
      )
    : d.status === "Failed"
      ? callout(
          "danger",
          "This sign-in did not succeed",
          "Someone entered credentials for your account and was refused."
        )
      : "";

  const cta =
    d.isNewDevice && safeUrl(d.confirmUrl) && safeUrl(d.secureUrl)
      ? `
${button("Yes, this was me", d.confirmUrl)}
<p style="margin:0 0 14px;font-size:13px;">Not you? <a href="${safeUrl(d.secureUrl)}" style="color:#B91C1C;font-weight:700;">Secure my account</a> — this ends every active session immediately and marks the device as untrusted.</p>`
      : "";

  const delivered =
    d.notificationRecipients.length > 0
      ? `<p style="margin:18px 0 0;font-size:12px;color:#6B7280;">Delivered to: ${d.notificationRecipients.map((r) => esc(r)).join(", ")}</p>`
      : "";

  const closing =
    d.status === "Failed"
      ? "If this was not you, someone may be attempting to access your account. Change your password immediately."
      : "If this was not you, change your password immediately and tell your administrator.";

  return build(subject, {
    preview: d.isNewDevice
      ? `A new device signed in to your account from ${d.location}.`
      : `${d.status} sign-in from ${d.browser} on ${d.operatingSystem}.`,
    heading: d.isNewDevice ? "New device signed in" : `${d.status} sign-in recorded`,
    bodyHtml: `
${warning}
${p(`Hi ${d.name},`)}
${p(`A sign-in to ${d.organization} on Bhoomi Dwellers CRM was recorded.`)}
${detailTable(rows)}
<p style="margin:22px 0 6px;font-size:13px;font-weight:700;color:#1A1A1A;">Account addresses on file</p>
${detailTable(addresses)}
${cta}
${p(closing)}
${delivered}
`,
    bodyText: `${d.isNewDevice ? "** NEW DEVICE DETECTED **\n\n" : ""}Hi ${d.name},

A sign-in to ${d.organization} on Bhoomi Dwellers CRM was recorded.

${detailText(rows)}

Account addresses on file:

${detailText(addresses)}
${
  d.isNewDevice && d.confirmUrl && d.secureUrl
    ? `\nWas this you?\n  Yes, it was me     ${d.confirmUrl}\n  Secure my account  ${d.secureUrl}\n\n"Secure my account" ends every active session immediately.\n`
    : ""
}
${closing}
${
  d.notificationRecipients.length > 0
    ? `\nDelivered to:\n${d.notificationRecipients.map((r) => `  - ${r}`).join("\n")}`
    : ""
}`,
    securityNote:
      "Bhoomi Dwellers will never ask for your password by email. Review your active sessions " +
      "in Settings → Account & Security.",
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Repeated failed logins
   ══════════════════════════════════════════════════════════════════════════ */

export interface FailedLoginBurstInput {
  name: string;
  organization: string;
  attemptCount: number;
  windowMinutes: number;
  identifierAttempted: string;
  attempts: { time: string; ip: string; browser: string; location: string }[];
  lockStatus: string;
}

export function failedLoginBurstTemplate(d: FailedLoginBurstInput): Template {
  const summary: DetailRow[] = [
    { label: "Email attempted", value: d.identifierAttempted },
    { label: "Failed attempts", value: `${d.attemptCount} in ${d.windowMinutes} minutes` },
    { label: "Account status", value: d.lockStatus },
  ];

  const list = d.attempts
    .map(
      (a) => `
      <tr>
        <td style="padding:8px 12px 8px 0;font-size:12px;color:#1A1A1A;white-space:nowrap;">${esc(a.time)}</td>
        <td style="padding:8px 12px 8px 0;font-size:12px;color:#6B7280;">${esc(a.ip)}</td>
        <td style="padding:8px 12px 8px 0;font-size:12px;color:#6B7280;">${esc(a.browser)}</td>
        <td style="padding:8px 0;font-size:12px;color:#6B7280;">${esc(a.location)}</td>
      </tr>`
    )
    .join("");

  return build("Security alert: repeated failed logins - Bhoomi CRM", {
    preview: `${d.attemptCount} failed sign-in attempts on your account in ${d.windowMinutes} minutes.`,
    heading: "Repeated failed sign-in attempts",
    bodyHtml: `
${callout("danger", "Security alert", `There have been ${d.attemptCount} failed sign-in attempts on your ${esc(d.organization)} account in the last ${d.windowMinutes} minutes.`)}
${p(`Hi ${d.name},`)}
${detailTable(summary)}
<p style="margin:22px 0 6px;font-size:13px;font-weight:700;color:#1A1A1A;">Attempts</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${list}</table>
${p("If this was you, no action is needed — sign in again carefully.")}
${p("If it was not, someone is trying to guess your password. Change it now from Settings → Account & Security, and tell your administrator.")}
`,
    bodyText: `SECURITY ALERT

Hi ${d.name},

There have been ${d.attemptCount} failed sign-in attempts on your ${d.organization}
account in the last ${d.windowMinutes} minutes.

${detailText(summary)}

Attempts:

${d.attempts.map((a) => `  ${a.time}\n    IP        ${a.ip}\n    Browser   ${a.browser}\n    Location  ${a.location}`).join("\n\n")}

If this was you, no action is needed — sign in again carefully.

If it was not, someone is trying to guess your password. Change it now from
Settings → Account & Security, and tell your administrator.`,
    securityNote: "Bhoomi Dwellers will never ask for your password by email.",
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Passwords
   ══════════════════════════════════════════════════════════════════════════ */

export interface PasswordChangedInput {
  name: string;
  timestamp: string;
  ipAddress: string;
  device?: string | null;
}

export function passwordChangedTemplate(d: PasswordChangedInput): Template {
  const rows: DetailRow[] = [
    { label: "Changed at", value: d.timestamp },
    { label: "IP address", value: d.ipAddress },
    { label: "Device", value: d.device },
  ];

  return build("Your password has been changed - Bhoomi CRM", {
    preview: "Your CRM password was changed. If this was not you, act now.",
    heading: "Your password was changed",
    bodyHtml: `
${p(`Hi ${d.name},`)}
${p("The password on your Bhoomi Dwellers CRM account was just changed.")}
${detailTable(rows)}
${callout("warning", "Not you?", "Contact your administrator immediately — someone else may have access to your account.")}
`,
    bodyText: `Hi ${d.name},

The password on your Bhoomi Dwellers CRM account was just changed.

${detailText(rows)}

If this was not you, contact your administrator immediately — someone else may
have access to your account.`,
    securityNote: "Bhoomi Dwellers will never ask for your password by email.",
  });
}

export interface PasswordResetInput {
  name: string;
  resetUrl: string;
  expiryMinutes: number;
  ipAddress?: string | null;
}

export function passwordResetTemplate(d: PasswordResetInput): Template {
  const link = safeUrl(d.resetUrl);
  const rows: DetailRow[] = [{ label: "Requested from", value: d.ipAddress }];

  return build("Reset your password - Bhoomi CRM", {
    preview: `Your password reset link expires in ${d.expiryMinutes} minutes.`,
    heading: "Reset your password",
    bodyHtml: `
${p(`Hi ${d.name},`)}
${p("Use the button below to choose a new password for your Bhoomi Dwellers CRM account.")}
${button("Choose a new password", link)}
${p(`This link expires in ${d.expiryMinutes} minutes and can be used once.`)}
${link ? `<p style="margin:0 0 14px;font-size:12px;color:#6B7280;word-break:break-all;">If the button does not work, paste this into your browser:<br/>${esc(link)}</p>` : ""}
${detailTable(rows)}
`,
    bodyText: `Hi ${d.name},

Use this link to choose a new password for your Bhoomi Dwellers CRM account:

${link ?? "(link unavailable — no application URL is configured)"}

This link expires in ${d.expiryMinutes} minutes and can be used once.

${detailText(rows)}`,
    securityNote:
      "If you did not request this, ignore this email — your password will not change until " +
      "the link above is used.",
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Employee invitation
   ══════════════════════════════════════════════════════════════════════════ */

export interface InvitationInput {
  name: string;
  organization: string;
  role: string;
  inviteUrl: string;
  expiryDays: number;
  invitedBy?: string | null;
}

export function employeeInvitationTemplate(d: InvitationInput): Template {
  const link = safeUrl(d.inviteUrl);
  const rows: DetailRow[] = [
    { label: "Organization", value: d.organization },
    { label: "Role", value: d.role },
    { label: "Invited by", value: d.invitedBy },
    { label: "Expires", value: `${d.expiryDays} days from now` },
  ];

  return build(`Join ${d.organization} on Bhoomi Dwellers CRM`, {
    preview: `You have been invited to join ${d.organization} as a ${d.role}.`,
    heading: `You have been invited to ${d.organization}`,
    bodyHtml: `
${p(`Hi ${d.name},`)}
${p(`You have been invited to join ${d.organization} on Bhoomi Dwellers CRM as a ${d.role}.`)}
${detailTable(rows)}
${button("Set up your account", link)}
${link ? `<p style="margin:0 0 14px;font-size:12px;color:#6B7280;word-break:break-all;">If the button does not work, paste this into your browser:<br/>${esc(link)}</p>` : ""}
${p(`This invitation expires in ${d.expiryDays} days.`)}
`,
    bodyText: `Hi ${d.name},

You have been invited to join ${d.organization} on Bhoomi Dwellers CRM as a ${d.role}.

${detailText(rows)}

Set up your account:
${link ?? "(link unavailable — no application URL is configured)"}

This invitation expires in ${d.expiryDays} days.`,
    securityNote:
      "If you were not expecting this invitation, you can ignore it. No account is created " +
      "until the link is used.",
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Support
   ══════════════════════════════════════════════════════════════════════════ */

export interface SupportReplyInput {
  name: string;
  ticketRef: string;
  subject: string;
  /** The reply body, as plain text. Escaped, never interpreted as HTML. */
  message: string;
  agentName?: string | null;
  ticketUrl?: string | null;
  status?: string | null;
}

export function supportReplyTemplate(d: SupportReplyInput): Template {
  const rows: DetailRow[] = [
    { label: "Ticket", value: d.ticketRef },
    { label: "Subject", value: d.subject },
    { label: "Status", value: d.status },
    { label: "Replied by", value: d.agentName },
  ];

  // The reply is agent-authored free text. Escaped, then newlines turned into
  // <br/> AFTER escaping — doing it the other way round would let the escape
  // pass over markup this function itself introduced.
  const body = esc(d.message).replace(/\r?\n/g, "<br/>");

  return build(`Re: ${d.subject} [${d.ticketRef}]`, {
    preview: `${d.agentName ?? "Support"} replied to your ticket ${d.ticketRef}.`,
    heading: "Your support ticket has a reply",
    bodyHtml: `
${p(`Hi ${d.name},`)}
${detailTable(rows)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
  <tr><td style="padding:16px;background:#FAFBFC;border:1px solid #E4E7EE;border-radius:8px;font-size:14px;line-height:1.7;color:#1A1A1A;">${body}</td></tr>
</table>
${d.ticketUrl ? button("View the ticket", d.ticketUrl) : ""}
`,
    bodyText: `Hi ${d.name},

${detailText(rows)}

${d.message}
${d.ticketUrl ? `\nView the ticket: ${d.ticketUrl}` : ""}`,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Subscription & billing
   ══════════════════════════════════════════════════════════════════════════ */

export interface SubscriptionInput {
  name: string;
  heading: string;
  /** One or two sentences describing what happened. */
  summary: string;
  details?: DetailRow[];
  actionLabel?: string | null;
  actionUrl?: string | null;
  tone?: "info" | "warning" | "danger" | "success";
  /** Overrides the derived subject when a specific one is wanted. */
  subject?: string;
}

/**
 * Subscription, plan, invoice and payment mail.
 *
 * One template rather than nine. The nine notification keys in the billing group
 * differ only in their wording and a details table — an invoice-generated email
 * and a payment-failed email have identical structure — so nine near-identical
 * files would be nine places to fix the same layout bug.
 */
export function subscriptionTemplate(d: SubscriptionInput): Template {
  const rows = d.details ?? [];
  const tone = d.tone ?? "info";

  return build(d.subject ?? `${d.heading} - Bhoomi CRM`, {
    preview: d.summary,
    heading: d.heading,
    bodyHtml: `
${tone !== "info" ? callout(tone, d.heading, esc(d.summary)) : ""}
${p(`Hi ${d.name},`)}
${tone === "info" ? p(d.summary) : ""}
${rows.length > 0 ? detailTable(rows) : ""}
${d.actionUrl && d.actionLabel ? button(d.actionLabel, d.actionUrl) : ""}
`,
    bodyText: `Hi ${d.name},

${d.summary}
${rows.length > 0 ? `\n${detailText(rows)}` : ""}
${d.actionUrl && d.actionLabel ? `\n${d.actionLabel}: ${d.actionUrl}` : ""}`,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   System notifications
   ══════════════════════════════════════════════════════════════════════════ */

export interface SystemNotificationInput {
  name: string;
  heading: string;
  /** Paragraphs of plain text. Escaped; never interpreted as HTML. */
  paragraphs: string[];
  details?: DetailRow[];
  actionLabel?: string | null;
  actionUrl?: string | null;
  tone?: "info" | "warning" | "danger" | "success";
  subject?: string;
  securityNote?: string;
}

/** Maintenance windows, outages, feature announcements and product updates. */
export function systemNotificationTemplate(d: SystemNotificationInput): Template {
  const rows = d.details ?? [];
  const tone = d.tone ?? "info";

  return build(d.subject ?? `${d.heading} - Bhoomi CRM`, {
    preview: d.paragraphs[0] ?? d.heading,
    heading: d.heading,
    bodyHtml: `
${tone !== "info" && d.paragraphs[0] ? callout(tone, d.heading, esc(d.paragraphs[0])) : ""}
${p(`Hi ${d.name},`)}
${(tone !== "info" ? d.paragraphs.slice(1) : d.paragraphs).map(p).join("\n")}
${rows.length > 0 ? detailTable(rows) : ""}
${d.actionUrl && d.actionLabel ? button(d.actionLabel, d.actionUrl) : ""}
`,
    bodyText: `Hi ${d.name},

${d.paragraphs.join("\n\n")}
${rows.length > 0 ? `\n${detailText(rows)}` : ""}
${d.actionUrl && d.actionLabel ? `\n${d.actionLabel}: ${d.actionUrl}` : ""}`,
    securityNote: d.securityNote,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Diagnostics
   ══════════════════════════════════════════════════════════════════════════ */

/** The "send a test email" message from Settings → Email Senders. */
export function testEmailTemplate(providerName: string): Template {
  const sender = readSenderConfig();

  const rows: DetailRow[] = [
    { label: "Provider", value: providerName },
    { label: "From", value: `${sender.fromName} <${sender.fromEmail}>` },
    { label: "Reply-to", value: sender.replyTo },
    { label: "Sent at", value: new Date().toISOString() },
  ];

  return build("Test email - Bhoomi CRM", {
    preview: "Your CRM mail configuration is working.",
    heading: "Your mail configuration works",
    bodyHtml: `
${callout("success", "Delivery confirmed", "This message was sent by your CRM, which means the transport, credentials and sender address are all correct.")}
${detailTable(rows)}
`,
    bodyText: `This message was sent by your CRM, which means the transport, credentials
and sender address are all correct.

${detailText(rows)}`,
  });
}
