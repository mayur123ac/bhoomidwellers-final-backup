import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const leadId = formData.get("leadId") as string;
    const documentType = formData.get("documentType") as string;
    const file = formData.get("file") as File;

    if (!leadId || !documentType || !file) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Ensure the directory exists
    // The path should be something like public/uploads/booking_documents/lead_{leadId}
    const uploadDir = path.join(process.cwd(), "public", "uploads", "booking_documents", `lead_${leadId}`);
    await fs.mkdir(uploadDir, { recursive: true });

    // Generate unique filename using original extension
    const extension = path.extname(file.name);
    // documentType will be like 'primary_aadhaar_front' or 'joint_0_pan'
    const fileName = `${documentType}_${Date.now()}${extension}`;
    const filePath = path.join(uploadDir, fileName);

    // Save to disk
    await fs.writeFile(filePath, buffer);

    // The public URL to access the file
    const url = `/uploads/booking_documents/lead_${leadId}/${fileName}`;

    return NextResponse.json({ success: true, url }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/upload]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
