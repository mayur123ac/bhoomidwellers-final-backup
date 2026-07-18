//call/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return NextResponse.json({ error: "Missing Twilio env vars" }, { status: 500 });
    }

    const { to } = await req.json();

    if (!to) {
      return NextResponse.json({ error: "Missing to number" }, { status: 400 });
    }

    const twilio = (await import("twilio")).default;
    const client = twilio(accountSid, authToken);

    const call = await client.calls.create({
      to,
      from: fromNumber,
      twiml: "<Response><Say>Connecting your call.</Say></Response>",
    });

    return NextResponse.json({ success: true, callSid: call.sid });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}