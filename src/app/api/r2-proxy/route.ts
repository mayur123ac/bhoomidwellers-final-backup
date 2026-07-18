import { NextRequest, NextResponse } from "next/server";
import { generatePresignedUrl } from "@/lib/r2";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  try {
    const signedUrl = await generatePresignedUrl(key);
    // Redirect to the presigned URL
    return NextResponse.redirect(signedUrl);
  } catch (err: any) {
    console.error("[R2 Proxy Error]", err);
    return NextResponse.json({ error: "Failed to generate presigned URL" }, { status: 500 });
  }
}
