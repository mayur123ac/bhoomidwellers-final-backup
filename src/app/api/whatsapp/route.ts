import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { phone, message } = await req.json();

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    // 1. Clean the phone number (Meta requires country code without '+' or '0')
    let cleanPhone = String(phone).replace(/\D/g, '');
    
    // Assuming Indian numbers (10 digits). If it's 10 digits, add '91'.
    if (cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    }

    // 2. Your Meta API Credentials (we will put these in your .env file later)
    const META_TOKEN = process.env.META_WA_TOKEN; 
    const PHONE_ID = process.env.META_PHONE_ID;

    if (!META_TOKEN || !PHONE_ID) {
      return NextResponse.json({ error: "WhatsApp API credentials missing" }, { status: 500 });
    }

    // 3. Send the request to Meta
    const response = await fetch(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "text",
        text: { 
          preview_url: false,
          body: message 
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Meta API Error:", data);
      return NextResponse.json({ error: "Failed to send message via Meta", details: data }, { status: response.status });
    }

    return NextResponse.json({ success: true, messageId: data.messages?.[0]?.id });

  } catch (error: any) {
    console.error("WhatsApp API crash:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}