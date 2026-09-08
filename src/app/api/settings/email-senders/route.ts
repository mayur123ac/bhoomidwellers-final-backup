import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/email-senders — email configuration status
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const host = process.env.SMTP_HOST || "";
    const port = process.env.SMTP_PORT || "587";
    const user = process.env.SMTP_USER || "";
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";
    const configured = Boolean(host && user);

    const provider = host.includes("resend") ? "Resend" : host ? "SMTP" : "None";

    const problems: { variable: string; message: string; severity: "error" | "warning" }[] = [];
    if (!host) problems.push({ variable: "SMTP_HOST", message: "No SMTP host configured.", severity: "error" });
    if (!user) problems.push({ variable: "SMTP_USER", message: "No SMTP user configured.", severity: "error" });
    if (!process.env.SMTP_PASS) problems.push({ variable: "SMTP_PASS", message: "No SMTP password configured.", severity: "error" });
    if (!from) problems.push({ variable: "SMTP_FROM", message: "No sender address configured.", severity: "warning" });

    // Recent failures
    let failures: any[] = [];
    try {
      failures = await query<any>(
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
      host: host || null,
      port: port || null,
      user: user || null,
      from: from || null,
      problems,
      failures,
    });
  } catch (err: any) {
    console.error("[GET /api/settings/email-senders]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
