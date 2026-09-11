import { NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/settings/whatsapp-integration — WhatsApp configuration status
export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const userId = gate.userId;
  const session = gate.session;

  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const enabled = process.env.WHATSAPP_ENABLED !== "false";

    const apiConfigured = Boolean(phoneNumberId && accessToken);
    const apiActive = apiConfigured && enabled;

    // Missing env vars (shown to admins only)
    const missing: string[] = [];
    const isAdmin = session.role === "admin" || session.role === "super_admin";
    if (isAdmin) {
      if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
      if (!accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
      if (!businessAccountId) missing.push("WHATSAPP_BUSINESS_ACCOUNT_ID");
    }

    // User's personal WhatsApp number
    let manualNumber = "";
    let viewerName: string | null = null;
    try {
      const rows = await query<any>(
        `SELECT whatsapp_number, name FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      if (rows[0]) {
        manualNumber = rows[0].whatsapp_number || "";
        viewerName = rows[0].name;
      }
    } catch {
      // Column may not exist
    }

    const manualConfigured = Boolean(manualNumber);

    const mode: "api" | "manual" | "none" = apiActive
      ? "api"
      : manualConfigured
        ? "manual"
        : "none";

    return NextResponse.json({
      success: true,
      mode,
      api: {
        configured: apiConfigured,
        enabled,
        active: apiActive,
        businessNumberHint: phoneNumberId ? phoneNumberId.slice(-4) : "",
        missing,
      },
      manual: {
        number: manualNumber,
        active: !apiActive && manualConfigured,
        configured: manualConfigured,
      },
      viewer: {
        name: viewerName,
        isAdmin,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/settings/whatsapp-integration]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
