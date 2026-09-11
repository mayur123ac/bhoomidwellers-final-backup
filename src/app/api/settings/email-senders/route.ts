import { NextRequest, NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/email-senders — email configuration status
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const host = process.env.SMTP_HOST || "";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER || "";
    const from = process.env.SMTP_FROM || process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER || "";
    const fromName = process.env.MAIL_FROM_NAME || process.env.SMTP_FROM_NAME || "CRM";
    const replyTo = process.env.MAIL_REPLY_TO || "";
    const supportEmail = process.env.SUPPORT_EMAIL || "";
    const companyName = process.env.COMPANY_NAME || "";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
    const configured = Boolean(host && user);
    const secure = port === 465;

    const provider = host.includes("resend") ? "Resend" : host ? "SMTP" : "None";

    const problems: { variable: string; message: string; severity: "error" | "warning" }[] = [];
    if (!host) problems.push({ variable: "SMTP_HOST", message: "No SMTP host configured.", severity: "error" });
    if (!user) problems.push({ variable: "SMTP_USER", message: "No SMTP user configured.", severity: "error" });
    if (!process.env.SMTP_PASS && !process.env.SMTP_PASSWORD) problems.push({ variable: "SMTP_PASS", message: "No SMTP password configured.", severity: "error" });
    if (!from) problems.push({ variable: "MAIL_FROM_EMAIL", message: "No sender address configured.", severity: "warning" });

    // Stats
    let stats = { total: 0, delivered: 0, failed: 0 };
    try {
      const rows = await query<any>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE success = true)::int AS delivered,
           COUNT(*) FILTER (WHERE success = false)::int AS failed
         FROM email_send_log
         WHERE created_at >= NOW() - INTERVAL '30 days'`
      );
      if (rows[0]) {
        stats = { total: rows[0].total, delivered: rows[0].delivered, failed: rows[0].failed };
      }
    } catch {
      // email_send_log may not exist
    }

    // Recent failures
    let recentFailures: any[] = [];
    try {
      recentFailures = await query<any>(
        `SELECT created_at, email_type, recipient, destination, transport, error
         FROM email_send_log
         WHERE success = false
         ORDER BY created_at DESC
         LIMIT 10`
      );
    } catch {
      // email_send_log may not exist
    }

    return NextResponse.json({
      success: true,
      provider,
      configured,
      sender: {
        fromName,
        fromEmail: from,
        replyTo,
        supportEmail,
        companyName,
        appUrl,
      },
      smtp: configured ? { host, port, secure, user } : null,
      problems,
      stats,
      recentFailures,
    });
  } catch (err: any) {
    console.error("[GET /api/settings/email-senders]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/settings/email-senders — verify connection or send test email
export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const action = body.action;

    const host = process.env.SMTP_HOST || "";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER || "";
    const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "";

    if (!host || !user || !pass) {
      return NextResponse.json({
        success: false,
        message: "SMTP credentials are not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env.local.",
      }, { status: 400 });
    }

    if (action === "verify") {
      try {
        const nodemailer = await import("nodemailer");
        const transport = nodemailer.default.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });
        await transport.verify();
        return NextResponse.json({ success: true, message: "SMTP connection verified successfully." });
      } catch (err: any) {
        return NextResponse.json({ success: false, message: `Connection failed: ${err.message}` });
      }
    }

    if (action === "test") {
      const to = body.to?.trim();
      if (!to) {
        return NextResponse.json({ success: false, message: "Recipient email is required." }, { status: 400 });
      }

      try {
        const nodemailer = await import("nodemailer");
        const from = process.env.SMTP_FROM || process.env.MAIL_FROM_EMAIL || user;
        const transport = nodemailer.default.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });
        await transport.sendMail({
          from,
          to,
          subject: "CRM Test Email",
          text: "This is a test email from your CRM. If you received this, your email configuration is working.",
          html: "<p>This is a test email from your CRM.</p><p>If you received this, your email configuration is working.</p>",
        });
        return NextResponse.json({ success: true, message: `Test email sent to ${to}.` });
      } catch (err: any) {
        return NextResponse.json({ success: false, message: `Send failed: ${err.message}` });
      }
    }

    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  } catch (err: any) {
    console.error("[POST /api/settings/email-senders]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
