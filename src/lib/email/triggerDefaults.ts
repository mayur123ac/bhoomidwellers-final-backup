// lib/email/triggerDefaults.ts — canonical list of email triggers with defaults.
//
// Each entry corresponds to one EmailService method or a distinguishable
// sub-case (e.g. OTP for password reset vs OTP for email change). The
// trigger_key is the stable identifier stored in email_trigger_config.

export interface TriggerDefault {
  trigger_key: string;
  display_name: string;
  category: string;
  description: string;
  recipient_desc: string;
  default_subject: string;
  default_body: string;
  variables: string[];
}

export const TRIGGER_DEFAULTS: TriggerDefault[] = [
  {
    trigger_key: "otp_verification",
    display_name: "OTP Verification Code",
    category: "Security",
    description: "One-time verification code sent for email verification, password change, or email change requests.",
    recipient_desc: "The email address being verified",
    default_subject: "Your verification code - Bhoomi Dwellers CRM",
    default_body: "Hi {{name}},\n\nUse this code to {{purpose}}.\n\nCode: {{code}}\n\nThe code expires in {{expiry_minutes}} minutes and can be used once.\n\nNobody from Bhoomi Dwellers will ever ask you for this code. If you did not request it, you can ignore this email.",
    variables: ["name", "code", "purpose", "expiry_minutes"],
  },
  {
    trigger_key: "password_reset",
    display_name: "Password Reset",
    category: "Security",
    description: "Verification code sent when a user requests to reset their forgotten password.",
    recipient_desc: "The user requesting the reset",
    default_subject: "Reset your CRM password — verification code",
    default_body: "Hi {{name}},\n\nUse this code to reset your CRM password.\n\nCode: {{code}}\n\nThe code expires in {{expiry_minutes}} minutes and can be used once.\n\nIf you did not request a password reset, you can ignore this email — your account has not been changed.",
    variables: ["name", "code", "expiry_minutes"],
  },
  {
    trigger_key: "login_alert",
    display_name: "Login Alert",
    category: "Security",
    description: "Notification sent to a user when a login is detected on their account (success, failure, or new device).",
    recipient_desc: "The account holder (routed through notification preferences)",
    default_subject: "New login detected - Bhoomi CRM",
    default_body: "Hi {{name}},\n\nA login was detected on your Bhoomi Dwellers CRM account.\n\nDate: {{date}} at {{time}}\nDevice: {{device}}\nBrowser: {{browser}}\nIP Address: {{ip_address}}\nLocation: {{location}}\n\nIf this was not you, change your password immediately.",
    variables: ["name", "date", "time", "device", "browser", "ip_address", "location"],
  },
  {
    trigger_key: "admin_login_notification",
    display_name: "Admin Login Notification",
    category: "Security",
    description: "Notification sent to administrators about team member login activity.",
    recipient_desc: "Admin email addresses",
    default_subject: "Team login notification - Bhoomi CRM",
    default_body: "A login was detected for {{employee_name}} ({{role}}).\n\nDate: {{date}} at {{time}}\nDevice: {{device}}\nIP: {{ip_address}}\nLocation: {{location}}",
    variables: ["employee_name", "role", "date", "time", "device", "ip_address", "location"],
  },
  {
    trigger_key: "failed_login_burst",
    display_name: "Failed Login Burst Alert",
    category: "Security",
    description: "Security alert sent when 5 or more failed login attempts are detected within 15 minutes.",
    recipient_desc: "The targeted account holder",
    default_subject: "Suspicious activity: 5 failed logins",
    default_body: "Hi {{name}},\n\nWe detected 5 failed login attempts on your Bhoomi Dwellers CRM account in the last 15 minutes.\n\nIf this was not you, please change your password immediately and review your account security settings.",
    variables: ["name"],
  },
  {
    trigger_key: "password_changed",
    display_name: "Password Changed Notification",
    category: "Security",
    description: "Confirmation sent when a user successfully changes their password.",
    recipient_desc: "The user whose password was changed",
    default_subject: "Your password was changed",
    default_body: "Hi {{name}},\n\nYour Bhoomi Dwellers CRM password was changed successfully.\n\nDate: {{date}} at {{time}}\n\nIf you did not make this change, contact your administrator immediately.",
    variables: ["name", "date", "time"],
  },
  {
    trigger_key: "employee_invitation",
    display_name: "Employee Invitation",
    category: "Team",
    description: "Invitation email sent to new employees being added to the CRM.",
    recipient_desc: "The new employee's email address",
    default_subject: "You're invited to join Bhoomi Dwellers CRM",
    default_body: "Hi {{name}},\n\nYou've been invited to join {{organization}} on Bhoomi Dwellers CRM as a {{role}}.\n\nClick the link below to set up your account and get started.\n\nWe look forward to working with you!",
    variables: ["name", "organization", "role"],
  },
  {
    trigger_key: "enquiry_confirmation",
    display_name: "Walk-in Enquiry Confirmation",
    category: "Customer",
    description: "Acknowledgement email sent to customers after their walk-in enquiry is registered.",
    recipient_desc: "The customer's email address",
    default_subject: "Thank you for your enquiry - Bhoomi CRM",
    default_body: "Dear {{customer_name}},\n\nThank you for visiting {{organization}}. Your enquiry has been registered and assigned to {{assigned_to}}.\n\nWe will be in touch with you shortly.\n\nBest regards,\n{{organization}}",
    variables: ["customer_name", "organization", "assigned_to"],
  },
  {
    trigger_key: "support_reply",
    display_name: "Support Ticket Reply",
    category: "Support",
    description: "Reply notification sent when support responds to a user's request.",
    recipient_desc: "The user who submitted the support request",
    default_subject: "Reply to your support request",
    default_body: "Hi {{name}},\n\nWe've responded to your support request.\n\nPlease check your support requests page for the full reply.",
    variables: ["name"],
  },
  {
    trigger_key: "subscription_email",
    display_name: "Billing & Subscription",
    category: "Billing",
    description: "Billing-related emails including invoices, payment confirmations, and plan change notifications.",
    recipient_desc: "The account holder",
    default_subject: "Billing notification - Bhoomi CRM",
    default_body: "Hi {{name}},\n\nThis is a notification regarding your Bhoomi Dwellers CRM subscription.\n\nPlease review the details in your billing dashboard.",
    variables: ["name"],
  },
  {
    trigger_key: "system_notification",
    display_name: "System Notification",
    category: "System",
    description: "System-wide announcements, maintenance notices, and critical security advisories.",
    recipient_desc: "All affected users",
    default_subject: "System announcement - Bhoomi CRM",
    default_body: "Hi {{name}},\n\nThis is an important system notification from Bhoomi Dwellers CRM.\n\nPlease review the details below.",
    variables: ["name"],
  },
  {
    trigger_key: "test_email",
    display_name: "Test Email",
    category: "System",
    description: "Diagnostic test email sent by administrators to verify the email delivery pipeline.",
    recipient_desc: "Admin-specified test address",
    default_subject: "Test email from Bhoomi Dwellers CRM",
    default_body: "This is a test email from Bhoomi Dwellers CRM.\n\nIf you received this, your email configuration is working correctly.\n\nProvider: {{provider}}",
    variables: ["provider"],
  },
];

/** Map trigger_key → TriggerDefault for O(1) lookups. */
export const TRIGGER_MAP = new Map(TRIGGER_DEFAULTS.map((t) => [t.trigger_key, t]));
