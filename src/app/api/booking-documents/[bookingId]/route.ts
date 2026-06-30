import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { generatePresignedUrl } from "@/lib/r2";

export async function GET(req: NextRequest, context: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await context.params;
    const res = await query(`SELECT * FROM booking_documents WHERE booking_id = $1`, [bookingId]);
    
    const documents = await Promise.all(res.map(async (doc: any) => {
      try {
        const url = await generatePresignedUrl(doc.object_key);
        return {
          ...doc,
          url
        };
      } catch (err) {
        return { ...doc, url: null };
      }
    }));
    
    return NextResponse.json({ success: true, data: documents });
  } catch (error: any) {
    console.error("Failed to fetch documents", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
