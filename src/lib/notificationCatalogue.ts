// lib/notificationCatalogue.ts — the list of things the CRM can email you about.
//
// One module, read by three consumers that must not disagree:
//
//   the settings UI       renders whatever is here, in this order
//   the API               validates incoming keys against it
//   the send path         resolves a key's default when a user has no row
//
// The UI hardcodes nothing. It receives this catalogue from
// GET /api/settings/notification-preferences and builds the groups, cards,
// toggles and search index from it, so adding a notification type is an entry in
// the array below and nothing else — no migration, no component change.
//
// ── Scope: what is deliberately NOT here ────────────────────────────────────
// This is the account/security/workspace/employee/subscription/system notice
// board. Notifications about CRM *work* are explicitly out of scope and must not
// be added here:
//
//   walk-in enquiries, walk-in leads, lead creation, lead assignment,
//   lead updates, lead status changes, lead follow-ups, lead deletion
//
// Those are high-volume, role-specific, and belong to a per-role routing model
// rather than one admin's mailbox preferences. `assertScope()` at the bottom of
// this file fails the build if one creeps in.
//
// ── `status`, and why half of these say "planned" ───────────────────────────
// The spec lists every notification an enterprise CRM might send. This
// deployment emits some of them today and not others: there is no billing
// provider (settings/billing is a PlannedSection), no 2FA, no ticketing backend,
// no outbound webhook dispatcher.
//
// The catalogue lists them anyway, because a preference is useful the moment the
// feature lands and a user who set it a month earlier should not have to come
// back. But each carries `status`, and the UI labels the planned ones rather
// than presenting a switch that implies mail is flowing. That matches how the
// rest of Settings handles unbuilt features — see components/Settings/
// PlannedSection.tsx. Flip a key to "live" in the same commit that starts
// emitting it.
//
// ── `defaultEnabled` ────────────────────────────────────────────────────────
// A user with no stored row gets this value. Security and billing failures
// default ON — the cost of a missed "your password was changed" is much higher
// than the cost of an unwanted one. Marketing-adjacent and digest mail defaults
// OFF, because opting people in to summaries they never asked for is how the
// whole notification centre ends up muted.

/* ══════════════════════════════════════════════════════════════════════════
   Shapes
   ══════════════════════════════════════════════════════════════════════════ */

export type NotificationStatus = "live" | "planned";

export interface NotificationDefinition {
  /** Stable id. Written to notification_type_preferences.notification_key. */
  key: string;
  label: string;
  /** One line, shown under the label. Says when the mail actually fires. */
  description: string;
  defaultEnabled: boolean;
  status: NotificationStatus;
  /**
   * Extra search terms. The search box already matches the label, description
   * and key; this covers the words people actually type that appear in none of
   * them — "2fa" for two-factor, "mfa", "invoice" for billing.
   */
  keywords?: string[];
  /**
   * Short form for the "You will receive" preview, which lists many items in a
   * small space. Falls back to `label`.
   */
  short?: string;
}

export interface NotificationGroup {
  id: string;
  label: string;
  /** Shown under the group heading. */
  description: string;
  notifications: NotificationDefinition[];
}

/* ══════════════════════════════════════════════════════════════════════════
   The catalogue
   ══════════════════════════════════════════════════════════════════════════ */

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    id: "security",
    label: "Security & Login",
    description: "Account access, credentials, and anything that looks like someone else.",
    notifications: [
      {
        key: "security.login_success",
        label: "Successful login",
        description: "Every time your account signs in, with the device and approximate location.",
        defaultEnabled: true,
        status: "live",
        keywords: ["sign in", "signin", "access"],
        short: "Successful logins",
      },
      {
        key: "security.failed_login",
        label: "Failed login attempt",
        description: "After five failed sign-ins against your account within fifteen minutes.",
        defaultEnabled: true,
        status: "live",
        keywords: ["password", "wrong password", "brute force", "lockout"],
        short: "Failed login attempts",
      },
      {
        key: "security.new_device",
        label: "New device login",
        description: "The first time a browser or operating system we have not seen before signs in.",
        defaultEnabled: true,
        status: "live",
        keywords: ["unknown device", "browser", "unrecognised"],
        short: "New device logins",
      },
      {
        key: "security.password_changed",
        label: "Password changed",
        description: "When your password is changed, whether by you or by an administrator.",
        defaultEnabled: true,
        status: "live",
        keywords: ["credentials", "reset"],
        short: "Password changes",
      },
      {
        key: "security.password_reset",
        label: "Password reset requested",
        description: "When a password reset is requested for your account.",
        defaultEnabled: true,
        // No self-service reset flow exists — /api/auth has login, logout and
        // signup only. Passwords are changed from Settings, which is covered by
        // security.password_changed above.
        status: "planned",
        keywords: ["forgot password", "recovery"],
        short: "Password resets",
      },
      {
        key: "security.twofa_enabled",
        label: "Two-factor authentication enabled",
        description: "When a second authentication factor is switched on for your account.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["2fa", "mfa", "totp", "authenticator"],
        short: "Two-factor changes",
      },
      {
        key: "security.twofa_disabled",
        label: "Two-factor authentication disabled",
        description: "When a second authentication factor is switched off. Always worth reading.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["2fa", "mfa", "totp", "authenticator"],
        short: "Two-factor changes",
      },
      {
        key: "security.session_revoked",
        label: "Session revoked",
        description: "When one of your active sessions is signed out from another device.",
        defaultEnabled: true,
        // Sessions are listed and revocable today (/api/settings/sessions); the
        // revocation does not yet send mail.
        status: "planned",
        keywords: ["sign out", "logout", "device"],
        short: "Session revocations",
      },
      {
        key: "security.alt_email_verified",
        label: "Alternative email verified",
        description: "When a backup delivery address completes verification.",
        defaultEnabled: true,
        status: "live",
        keywords: ["secondary email", "backup address", "otp"],
        short: "Alternative email verification",
      },
    ],
  },

  {
    id: "team",
    label: "Employee Management",
    description: "Changes to who is in this workspace and what they can do.",
    notifications: [
      {
        key: "team.employee_invited",
        label: "Employee invitation",
        description: "When someone is invited to join the workspace.",
        defaultEnabled: true,
        status: "live",
        keywords: ["invite", "onboarding", "new joiner"],
        short: "Employee invitations",
      },
      {
        key: "team.employee_activated",
        label: "Employee account activated",
        description: "When an invited employee accepts and their account goes live.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["enabled", "reactivated", "signup"],
        short: "Account activations",
      },
      {
        key: "team.employee_deactivated",
        label: "Employee account deactivated",
        description: "When an employee's access is suspended without removing their records.",
        defaultEnabled: true,
        status: "live",
        keywords: ["suspended", "disabled", "offboarding"],
        short: "Account deactivations",
      },
      {
        key: "team.role_changed",
        label: "Role changed",
        description: "When an employee's role changes, which changes what they can see and do.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["permission", "access level", "promotion"],
        short: "Role changes",
      },
      {
        key: "team.employee_removed",
        label: "Employee removed",
        description: "When an employee is removed from the workspace.",
        defaultEnabled: true,
        status: "live",
        keywords: ["deleted", "offboarding", "left"],
        short: "Employee removals",
      },
    ],
  },

  {
    id: "workspace",
    label: "Workspace",
    description: "Configuration that applies to everyone in the organisation.",
    notifications: [
      {
        key: "workspace.settings_updated",
        label: "Workspace settings updated",
        description: "When workspace-wide configuration changes.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["configuration", "preferences", "admin"],
        short: "Workspace settings changes",
      },
      {
        key: "workspace.business_info_updated",
        label: "Business information updated",
        description: "Changes to the company name, address, GST details or branding.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["company", "gst", "address", "legal"],
        short: "Business information changes",
      },
      {
        key: "workspace.organization_changed",
        label: "Organization settings changed",
        description: "Changes to organisation-level policy such as data retention or defaults.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["policy", "org", "defaults"],
        short: "Organisation settings changes",
      },
      {
        key: "workspace.working_hours_updated",
        label: "Working hours updated",
        description: "When the office schedule or holiday calendar changes.",
        defaultEnabled: false,
        status: "planned",
        keywords: ["schedule", "shift", "office timings", "holidays"],
        short: "Working hours changes",
      },
      {
        key: "workspace.export_completed",
        label: "Workspace export completed",
        description: "When a data export you requested has finished and is ready to download.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["download", "backup", "csv", "data export"],
        short: "Completed exports",
      },
      {
        key: "workspace.import_completed",
        label: "Workspace import completed",
        description: "When a bulk import finishes, with a count of what succeeded and failed.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["upload", "bulk", "csv", "data import"],
        short: "Completed imports",
      },
    ],
  },

  {
    id: "billing",
    label: "Subscription & Billing",
    description: "Payments, invoices and plan changes.",
    notifications: [
      {
        key: "billing.subscription_activated",
        label: "Subscription activated",
        description: "When a subscription starts.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["plan", "started"],
        short: "Subscription changes",
      },
      {
        key: "billing.plan_upgraded",
        label: "Plan upgraded",
        description: "When the workspace moves to a higher tier.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["tier", "upgrade"],
        short: "Plan changes",
      },
      {
        key: "billing.plan_downgraded",
        label: "Plan downgraded",
        description: "When the workspace moves to a lower tier, and what stops being included.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["tier", "downgrade"],
        short: "Plan changes",
      },
      {
        key: "billing.payment_success",
        label: "Payment successful",
        description: "A receipt each time a payment goes through.",
        defaultEnabled: false,
        status: "planned",
        keywords: ["receipt", "charged", "card"],
        short: "Payment receipts",
      },
      {
        key: "billing.payment_failed",
        label: "Payment failed",
        description: "When a payment is declined. Left on by default — this one costs you access.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["declined", "card", "overdue"],
        short: "Failed payments",
      },
      {
        key: "billing.invoice_generated",
        label: "Invoice generated",
        description: "When a new invoice is raised against the workspace.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["bill", "statement"],
        short: "New invoices",
      },
      {
        key: "billing.invoice_paid",
        label: "Invoice paid",
        description: "Confirmation that an invoice has been settled.",
        defaultEnabled: false,
        status: "planned",
        keywords: ["bill", "receipt", "settled"],
        short: "Paid invoices",
      },
      {
        key: "billing.renewal_reminder",
        label: "Subscription renewal reminder",
        description: "Ahead of an automatic renewal, so it is never a surprise on the statement.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["auto renew", "reminder"],
        short: "Renewal reminders",
      },
      {
        key: "billing.expiring_soon",
        label: "Subscription expiring soon",
        description: "When a subscription is approaching its end date without renewing.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["expiry", "lapse", "ending"],
        short: "Expiry warnings",
      },
    ],
  },

  {
    id: "developer",
    label: "Developer & API",
    description: "API credentials, integrations, and anything machine-to-machine.",
    notifications: [
      {
        key: "developer.api_key_created",
        label: "API key generated",
        description: "When a new API key is issued. A key you did not create is worth knowing about.",
        defaultEnabled: true,
        // lib/apiKeys.ts issues and authenticates keys today, but the routes do
        // not mail on issue. Flip to "live" when they do.
        status: "planned",
        keywords: ["token", "credentials", "secret"],
        short: "API key alerts",
      },
      {
        key: "developer.api_key_revoked",
        label: "API key revoked",
        description: "When a key is revoked or rotated, and anything using it stops working.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["token", "rotate", "deleted"],
        short: "API key alerts",
      },
      {
        key: "developer.api_usage_warning",
        label: "API usage limit warning",
        description: "When an API key approaches its rate or quota limit.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["rate limit", "quota", "throttle", "429"],
        short: "API usage warnings",
      },
      {
        key: "developer.webhook_failure",
        label: "Webhook failure",
        description: "When outbound webhook deliveries fail repeatedly against an endpoint.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["callback", "endpoint", "retry", "delivery"],
        short: "Webhook failures",
      },
      {
        key: "developer.integration_connected",
        label: "Integration connected",
        description: "When a third-party integration is linked to this workspace.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["oauth", "connected account", "linked"],
        short: "Integration changes",
      },
      {
        key: "developer.integration_disconnected",
        label: "Integration disconnected",
        description: "When an integration is unlinked or its authorisation expires.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["oauth", "revoked", "unlinked", "expired"],
        short: "Integration changes",
      },
    ],
  },

  {
    id: "support",
    label: "Support",
    description: "Correspondence with the people who maintain this CRM.",
    notifications: [
      {
        key: "support.ticket_created",
        label: "Support ticket created",
        description: "Confirmation that a support request was received, with its reference.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["helpdesk", "request", "raised"],
        short: "Support ticket receipts",
      },
      {
        key: "support.ticket_replied",
        label: "Support ticket replied",
        description: "When support answers one of your tickets.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["helpdesk", "response", "answer"],
        short: "Support replies",
      },
      {
        key: "support.ticket_closed",
        label: "Support ticket closed",
        description: "When a ticket is resolved and closed.",
        defaultEnabled: false,
        status: "planned",
        keywords: ["helpdesk", "resolved", "done"],
        short: "Ticket closures",
      },
    ],
  },

  {
    id: "system",
    label: "System",
    description: "Service health, product news, and periodic summaries.",
    notifications: [
      {
        key: "system.maintenance",
        label: "Scheduled maintenance",
        description: "Ahead of planned downtime, with the window and what is affected.",
        defaultEnabled: true,
        status: "live",
        keywords: ["downtime", "planned", "upgrade window"],
        short: "Maintenance notices",
      },
      {
        key: "system.outage",
        label: "Service outage",
        description: "When the CRM is unexpectedly unavailable, and when it is back.",
        defaultEnabled: true,
        status: "planned",
        keywords: ["downtime", "incident", "unavailable"],
        short: "Outage alerts",
      },
      {
        key: "system.feature_announcement",
        label: "New feature announcements",
        description: "When something new ships that you can start using.",
        defaultEnabled: false,
        status: "live",
        keywords: ["release", "whats new", "changelog"],
        short: "Feature announcements",
      },
      {
        key: "system.security_announcement",
        label: "Critical security announcement",
        description: "Urgent security notices affecting this CRM. Leave this one on.",
        defaultEnabled: true,
        status: "live",
        keywords: ["vulnerability", "patch", "urgent", "cve"],
        short: "Critical security notices",
      },
      {
        key: "system.product_updates",
        label: "Product updates",
        description: "Routine release notes and smaller improvements.",
        defaultEnabled: false,
        status: "live",
        keywords: ["release notes", "changelog", "newsletter"],
        short: "Product updates",
      },
      {
        key: "system.digest_daily",
        label: "Daily summary",
        description: "One email each morning summarising the previous day.",
        defaultEnabled: false,
        status: "planned",
        keywords: ["digest", "recap", "report"],
        short: "Daily summaries",
      },
      {
        key: "system.digest_weekly",
        label: "Weekly summary",
        description: "One email each week summarising the previous seven days.",
        defaultEnabled: false,
        status: "planned",
        keywords: ["digest", "recap", "report"],
        short: "Weekly summaries",
      },
      {
        key: "system.digest_monthly",
        label: "Monthly summary",
        description: "One email each month summarising the previous month.",
        defaultEnabled: false,
        status: "planned",
        keywords: ["digest", "recap", "report"],
        short: "Monthly summaries",
      },
    ],
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   Derived lookups
   ══════════════════════════════════════════════════════════════════════════ */

export const ALL_NOTIFICATIONS: NotificationDefinition[] = NOTIFICATION_GROUPS.flatMap(
  (group) => group.notifications
);

const BY_KEY = new Map(ALL_NOTIFICATIONS.map((n) => [n.key, n]));

export function getNotification(key: string): NotificationDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * True when the key is one this build knows about.
 *
 * Both the API and the service filter on this, so a row left behind by a
 * retired notification, or a key posted by a stale browser tab, is ignored
 * rather than stored and rendered as a mystery switch.
 */
export function isKnownNotificationKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** The catalogue defaults, as the flat map the service merges stored rows over. */
export function defaultPreferences(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const n of ALL_NOTIFICATIONS) defaults[n.key] = n.defaultEnabled;
  return defaults;
}

/* ══════════════════════════════════════════════════════════════════════════
   Scope guard
   ══════════════════════════════════════════════════════════════════════════ */

// The exclusions at the top of this file are a hard requirement, not a
// preference, and the natural way to violate them is for someone to add
// "lead.assigned" here six months from now because it seemed to fit. This runs
// at module load — on the server, at import time — so that mistake surfaces
// immediately rather than as a lead notification appearing in an admin's inbox.
const FORBIDDEN_PREFIXES = ["lead.", "leads.", "walkin.", "walk_in.", "followup.", "follow_up."];
const FORBIDDEN_WORDS = ["walk-in", "walk in", "lead ", "follow-up", "follow up"];

function assertScope(): void {
  for (const n of ALL_NOTIFICATIONS) {
    if (FORBIDDEN_PREFIXES.some((p) => n.key.startsWith(p))) {
      throw new Error(
        `[notificationCatalogue] "${n.key}" is a lead/walk-in notification. ` +
          `This catalogue is scoped to account, security, workspace, employee, ` +
          `subscription and system mail — see the header comment.`
      );
    }
    const haystack = `${n.label} ${n.description}`.toLowerCase();
    if (FORBIDDEN_WORDS.some((w) => haystack.includes(w))) {
      throw new Error(
        `[notificationCatalogue] "${n.key}" mentions leads, walk-ins or follow-ups. ` +
          `Those notifications are out of scope for this screen.`
      );
    }
  }

  // Duplicate keys would give a user two switches writing to the same row, one
  // of which would appear not to work.
  if (BY_KEY.size !== ALL_NOTIFICATIONS.length) {
    throw new Error("[notificationCatalogue] duplicate notification key.");
  }
}

assertScope();
