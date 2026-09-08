import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/settings/whatsapp-integration — WhatsApp configuration status
export async function GET() {
  const gate = await requireRoles(["admin", "super_admin"]);
  if (!gate.ok) return gate.response;

  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
    const appSecret = process.env.WHATSAPP_APP_SECRET || "";

    const configured = Boolean(phoneNumberId && accessToken);

    const problems: { variable: string; message: string; severity: "error" | "warning" }[] = [];
    if (!phoneNumberId) problems.push({ variable: "WHATSAPP_PHONE_NUMBER_ID", message: "No phone number ID.", severity: "error" });
    if (!accessToken) problems.push({ variable: "WHATSAPP_ACCESS_TOKEN", message: "No access token.", severity: "error" });
    if (!businessAccountId) problems.push({ variable: "WHATSAPP_BUSINESS_ACCOUNT_ID", message: "No business account ID.", severity: "warning" });
    if (!webhookVerifyToken) problems.push({ variable: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", message: "No webhook verify token.", severity: "warning" });
    if (!appSecret) problems.push({ variable: "WHATSAPP_APP_SECRET", message: "No app secret for signature verification.", severity: "warning" });

    return NextResponse.json({
      success: true,
      configured,
      phoneNumberId: phoneNumberId ? `...${phoneNumberId.slice(-4)}` : null,
      businessAccountId: businessAccountId ? `...${businessAccountId.slice(-4)}` : null,
      hasAccessToken: Boolean(accessToken),
      hasWebhookToken: Boolean(webhookVerifyToken),
      hasAppSecret: Boolean(appSecret),
      problems,
    });
  } catch (err: any) {
    console.error("[GET /api/settings/whatsapp-integration]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
