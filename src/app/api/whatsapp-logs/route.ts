import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { lead_id, sender_name, sender_number, recipient_number, message_preview } = await req.json();

    await query(
      `INSERT INTO public.whatsapp_logs 
       (lead_id, sender_name, sender_number, recipient_number, message_preview, sent_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [lead_id, sender_name, sender_number, recipient_number, message_preview]
    );

    // Also log in follow_ups timeline
    await query(
      `INSERT INTO public.follow_ups (lead_id, message, created_by_name, site_visit_date)
       VALUES ($1, $2, $3, NULL)`,
      [
        lead_id,
        `📱 WhatsApp sent by ${sender_name}: "${message_preview}"`,
        sender_name
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
    const { searchParams } = new URL(req.url);
    const lead_id = searchParams.get("lead_id");

    const logs = await query(
      `SELECT * FROM public.whatsapp_logs 
       WHERE lead_id = $1 
       ORDER BY sent_at DESC`,
      [lead_id]
    );

    return NextResponse.json({ success: true, data: logs });

  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}