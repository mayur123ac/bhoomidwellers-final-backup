import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { name, whatsapp_number } = await req.json();

    if (!name || !whatsapp_number) {
      return NextResponse.json(
        { success: false, message: "Name and number required" },
        { status: 400 }
      );
    }

    await query(
      `UPDATE public.users 
       SET whatsapp_number = $1 
       WHERE name = $2`,
      [whatsapp_number, name]
    );

    return NextResponse.json({ success: true, message: "WhatsApp number saved!" });

  } catch (error) {
    console.error("Update WhatsApp error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save number" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { success: false, message: "Name required" },
        { status: 400 }
      );
    }

    const rows = await query(
      `SELECT whatsapp_number FROM public.users WHERE name = $1`,
      [name]
    );

    return NextResponse.json({
      success: true,
      whatsapp_number: rows[0]?.whatsapp_number || ""
    });

  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Failed to fetch number" },
      { status: 500 }
    );
  }
}