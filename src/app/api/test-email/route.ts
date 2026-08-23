import { NextResponse } from "next/server";
import { EmailService } from "@/lib/email/EmailService";

export async function GET() {
  const result = await EmailService.sendOTP("test@example.com", {
    name: "Test User",
    code: "123456",
    expiryMinutes: 10,
    purpose: "test sending",
    requestedFromIp: "127.0.0.1",
    requestedFromDevice: "Test Device",
  });
  
  return NextResponse.json({
    result
  });
}
