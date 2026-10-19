import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { TRIGGER_MAP } from "@/lib/email/triggerDefaults";

export const dynamic = "force-dynamic";

// POST /api/admin/email-config/generate — generate alternative wording
// Uses curated alternatives per trigger. No external AI dependency.
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const { trigger_key, field } = await req.json();

    if (!trigger_key || !TRIGGER_MAP.has(trigger_key)) {
      return NextResponse.json(
        { success: false, message: "Unknown trigger_key." },
        { status: 400 }
      );
    }

    if (field !== "subject" && field !== "body") {
      return NextResponse.json(
        { success: false, message: 'field must be "subject" or "body".' },
        { status: 400 }
      );
    }

    const alternatives = getAlternatives(trigger_key, field);
    // Pick a random alternative
    const suggestion = alternatives[Math.floor(Math.random() * alternatives.length)];

    return NextResponse.json({ success: true, suggestion });
  } catch (err: any) {
    console.error("[POST /api/admin/email-config/generate]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

function getAlternatives(key: string, field: "subject" | "body"): string[] {
  const subjectAlts: Record<string, string[]> = {
    otp_verification: [
      "Your verification code - Bhoomi Dwellers CRM",
      "Verify your identity - Bhoomi CRM",
      "Security code for your Bhoomi CRM account",
      "Your one-time code is ready - Bhoomi CRM",
    ],
    password_reset: [
      "Reset your CRM password — verification code",
      "Password reset request - Bhoomi CRM",
      "Reset your password - verification code inside",
      "Your password reset code - Bhoomi Dwellers",
    ],
    login_alert: [
      "New login detected - Bhoomi CRM",
      "Login activity on your Bhoomi CRM account",
      "Security notice: login detected on your account",
      "Account login notification - Bhoomi CRM",
    ],
    admin_login_notification: [
      "Team login notification - Bhoomi CRM",
      "Employee login detected - Admin alert",
      "Team member sign-in activity",
      "Login activity report - Bhoomi CRM",
    ],
    failed_login_burst: [
      "Suspicious activity: 5 failed logins",
      "Security alert: Multiple failed login attempts",
      "Urgent: Repeated login failures on your account",
      "Account security warning - Bhoomi CRM",
    ],
    password_changed: [
      "Your password was changed",
      "Password updated successfully - Bhoomi CRM",
      "Security notice: Password changed",
      "Your Bhoomi CRM password has been updated",
    ],
    employee_invitation: [
      "You're invited to join Bhoomi Dwellers CRM",
      "Welcome to Bhoomi Dwellers CRM",
      "Your Bhoomi CRM account is ready",
      "Join the team on Bhoomi Dwellers CRM",
    ],
    enquiry_confirmation: [
      "Thank you for your enquiry - Bhoomi CRM",
      "We received your enquiry - Bhoomi Dwellers",
      "Your visit has been registered - Thank you",
      "Enquiry confirmation - Bhoomi Dwellers",
    ],
    support_reply: [
      "Reply to your support request",
      "Update on your support ticket - Bhoomi CRM",
      "We've responded to your request",
      "Support update - Bhoomi Dwellers CRM",
    ],
    subscription_email: [
      "Billing notification - Bhoomi CRM",
      "Subscription update - Bhoomi Dwellers",
      "Your billing summary - Bhoomi CRM",
      "Account billing notification",
    ],
    system_notification: [
      "System announcement - Bhoomi CRM",
      "Important update from Bhoomi Dwellers CRM",
      "System notice - Action may be required",
      "Bhoomi CRM system notification",
    ],
    test_email: [
      "Test email from Bhoomi Dwellers CRM",
      "Email delivery test - Bhoomi CRM",
      "Configuration test - Email working",
      "Bhoomi CRM email test successful",
    ],
  };

  const bodyAlts: Record<string, string[]> = {
    otp_verification: [
      "Hi {{name}},\n\nHere is your verification code to {{purpose}}.\n\nCode: {{code}}\n\nThis code is valid for {{expiry_minutes}} minutes. Do not share this code with anyone.\n\nIf you didn't request this, please ignore this email.",
      "Hello {{name}},\n\nYour one-time verification code is below.\n\nCode: {{code}}\n\nPurpose: {{purpose}}\nExpires in: {{expiry_minutes}} minutes\n\nThis code can only be used once. If you did not initiate this request, no action is needed.",
    ],
    password_reset: [
      "Hi {{name}},\n\nWe received a request to reset your password.\n\nYour verification code: {{code}}\n\nThis code expires in {{expiry_minutes}} minutes.\n\nIf you didn't request this, your account is safe — just ignore this email.",
      "Hello {{name}},\n\nUse the code below to reset your Bhoomi CRM password.\n\nCode: {{code}}\n\nValid for {{expiry_minutes}} minutes. If you didn't make this request, no changes have been made to your account.",
    ],
    login_alert: [
      "Hi {{name}},\n\nWe noticed a sign-in to your Bhoomi CRM account.\n\nWhen: {{date}} at {{time}}\nDevice: {{device}} ({{browser}})\nFrom: {{ip_address}} — {{location}}\n\nIf this wasn't you, please secure your account immediately by changing your password.",
      "Hello {{name}},\n\nA login to your account was recorded.\n\nDate & Time: {{date}}, {{time}}\nDevice: {{device}}\nBrowser: {{browser}}\nIP Address: {{ip_address}}\nLocation: {{location}}\n\nIf you don't recognise this activity, change your password right away.",
    ],
    admin_login_notification: [
      "Team login detected:\n\nEmployee: {{employee_name}} ({{role}})\nDate: {{date}} at {{time}}\nDevice: {{device}}\nIP: {{ip_address}}\nLocation: {{location}}",
    ],
    failed_login_burst: [
      "Hi {{name}},\n\nOur security system detected multiple failed login attempts on your Bhoomi CRM account.\n\n5 failed attempts were recorded in the last 15 minutes.\n\nPlease change your password immediately if you suspect unauthorized access.",
    ],
    password_changed: [
      "Hi {{name}},\n\nThis is to confirm that your Bhoomi CRM password was changed on {{date}} at {{time}}.\n\nIf you made this change, no further action is needed.\n\nIf you did not change your password, please contact your administrator immediately.",
    ],
    employee_invitation: [
      "Hi {{name}},\n\nYou've been added to {{organization}} as a {{role}}.\n\nPlease click the link below to activate your account and set your password.\n\nWelcome aboard!",
      "Hello {{name}},\n\nWelcome to the {{organization}} team! Your Bhoomi CRM account has been created.\n\nRole: {{role}}\n\nGet started by clicking the activation link below.",
    ],
    enquiry_confirmation: [
      "Dear {{customer_name}},\n\nThank you for your interest in {{organization}}. We have registered your enquiry and our representative {{assigned_to}} will be in touch shortly.\n\nWe look forward to assisting you.\n\nWarm regards,\n{{organization}}",
      "Dear {{customer_name}},\n\nWe appreciate your visit to {{organization}}.\n\nYour enquiry has been noted and {{assigned_to}} has been assigned to help you.\n\nExpect to hear from us soon.\n\nBest,\n{{organization}}",
    ],
    support_reply: [
      "Hi {{name}},\n\nGood news — we've responded to your support request.\n\nPlease visit the Support Requests section in your settings to view the full reply.\n\nThank you for your patience.",
    ],
    subscription_email: [
      "Hi {{name}},\n\nThis is a billing notification for your Bhoomi Dwellers CRM account.\n\nPlease log in and check your billing dashboard for details.",
    ],
    system_notification: [
      "Hi {{name}},\n\nThis is an important notification from Bhoomi Dwellers CRM.\n\nPlease review the information below carefully.",
    ],
    test_email: [
      "This is a test email sent from your Bhoomi Dwellers CRM.\n\nEmail provider: {{provider}}\n\nIf you're reading this, your email configuration is working correctly.",
    ],
  };

  const pool = field === "subject" ? subjectAlts : bodyAlts;
  const defaults = TRIGGER_MAP.get(key)!;
  const fallback = field === "subject" ? defaults.default_subject : defaults.default_body;
  return pool[key] ?? [fallback];
}
