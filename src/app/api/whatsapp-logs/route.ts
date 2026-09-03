import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { requireSession, requireRoles } from "@/lib/serverAuth";

export async function POST(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    // MT-05: from the authenticated session, never from the request body.
    const orgId = await getOrganizationId();

    const { lead_id, sender_name, sender_number, recipient_number, message_preview } = await req.json();

    await query(
      `INSERT INTO public.whatsapp_logs 
       (lead_id, sender_name, sender_number, recipient_number, message_preview, sent_at, organization_id)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [lead_id, sender_name, sender_number, recipient_number, message_preview, orgId]
    );

    // Also log in follow_ups timeline
    await query(
      `INSERT INTO public.follow_ups (lead_id, message, created_by_name, created_by_id, site_visit_date, organization_id)
       VALUES ($1, $2, $3, $5, NULL, $4)`,
      [
        lead_id,
        `📱 WhatsApp sent by ${sender_name}: "${message_preview}"`,
        sender_name,
        orgId,
        gate.userId
      ]
    );

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("WhatsApp log error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to log" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const lead_id = searchParams.get("lead_id");

    // lead_id is a query parameter. whatsapp_logs carries its own organization_id,
    // so the filter is on the row itself rather than derived through the lead —
    // a guessed lead id from another tenant returns nothing.
    const logs = await query(
      `SELECT * FROM public.whatsapp_logs 
       WHERE lead_id = $1 AND organization_id = $2
       ORDER BY sent_at DESC`,
      [lead_id, await getOrganizationId()]
    );

    return NextResponse.json({ success: true, data: logs });

  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}