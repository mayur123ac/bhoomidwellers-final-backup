import { NextResponse } from "next/server";
import { readSmtpConfig, isMailConfigured, activeProvider } from "@/lib/email/config";

export async function GET() {
  const config = readSmtpConfig();
  const configured = isMailConfigured();
  const provider = activeProvider();
  
  return NextResponse.json({
    config,
    configured,
    provider,
  });
}
