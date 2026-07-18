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

export async function POST(req: NextRequest, context: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await context.params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const documentType = formData.get("document_type") as string;
    const uploadedBy = formData.get("uploaded_by") as string;
    
    if (!file || !documentType) {
      return NextResponse.json({ success: false, message: "File and document_type are required" }, { status: 400 });
    }
    
    // get booking number and lead id
    const bookingRes = await query(`SELECT booking_number, lead_id FROM booking_applications WHERE id = $1`, [bookingId]);
    if (bookingRes.length === 0) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }
    const { booking_number, lead_id } = bookingRes[0];

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let ext = ".bin";
    if (file.name.lastIndexOf(".") !== -1) {
      ext = file.name.substring(file.name.lastIndexOf("."));
    } else if (file.type === "application/pdf") ext = ".pdf";

    const key = `bookings/${booking_number}/documents/${documentType}_${Date.now()}${ext}`;
    
    const { uploadBufferToR2 } = await import("@/lib/r2");
    await uploadBufferToR2(key, fileBuffer, file.type);
    
    const insertRes = await query(`
      INSERT INTO booking_documents (booking_id, lead_id, booking_number, document_type, applicant_type, file_name, object_key, mime_type, file_size, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [bookingId, lead_id, booking_number, documentType, 'GENERAL', file.name, key, file.type, file.size, uploadedBy || 'System']);

    const newDoc = insertRes[0];
    const url = await generatePresignedUrl(newDoc.object_key);

    return NextResponse.json({ success: true, data: { ...newDoc, url } }, { status: 201 });
  } catch (error: any) {
    console.error("Failed to upload document", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
