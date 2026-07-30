// api/whatsapp/route.ts — ad-hoc, human-initiated WhatsApp send.
//
// Rewritten to delegate to the notification module. It previously held its own
// copy of the Meta call, pinned to v18.0, reading META_WA_TOKEN / META_PHONE_ID
// (neither of which was ever set, so it always 500'd), with NO authentication of
// any kind — an open relay that would have burned Meta quota for anyone who
// found the URL the moment credentials landed.
//
// ── The 24-hour window ───────────────────────────────────────────────────────
// A free-form { phone, message } send only delivers to someone who messaged your
// business number within the last 24 hours. Meta returns error 131047 otherwise,
// every time, and a Sourcing Manager who has never written to the business
// number is ALWAYS outside that window.
//
// So this endpoint is for replying to inbound conversations. It also accepts
// { phone, template, params } for an approved template, which is the only form
// that reaches a cold recipient — build features on that path, not the text one.
//
// Automatic notifications do not come through here at all; they go through
// @/services/whatsapp.service, which queues, retries and logs.

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/serverAuth";
import { sendAdHocMessage } from "@/services/whatsapp.service";
import { configSummary, isConfigured, readConfig } from "@/config/whatsapp.config";
import { WhatsAppError } from "@/types/whatsapp.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roles with a genuine ad-hoc outreach workflow. */
const SEND_ROLES = ["admin", "sales manager"];

export async function POST(req: Request) {
  const auth = await requireRole(SEND_ROLES);
  if (!auth.isAuthorized) {
    return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
  }

  if (!isConfigured()) {
    const { missing } = readConfig();
    // 503 with the list of what to fill in, rather than the old opaque 500.
    return NextResponse.json(
      {
        success: false,
        code: "CONFIG_MISSING",
        message:
          missing.length > 0
            ? `WhatsApp is not configured. Missing: ${missing.join(", ")}`
            : "WhatsApp sending is disabled (WHATSAPP_ENABLED=false).",
        missing,
      },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { phone, message, template, params } = body ?? {};

  if (!phone) {
    return NextResponse.json(
      { success: false, message: "A phone number is required." },
      { status: 400 }
    );
  }
  if (!template && (typeof message !== "string" || !message.trim())) {
    // The old handler let an undefined message through and sent `body: undefined`
    // to Meta, which fails opaquely at the far end.
    return NextResponse.json(
      { success: false, message: "Either a message or a template name is required." },
      { status: 400 }
    );
  }

  try {
    const result = await sendAdHocMessage({
      phoneRaw: String(phone),
      message: typeof message === "string" ? message : undefined,
      template: template
        ? { name: String(template), params: Array.isArray(params) ? params.map(String) : [] }
        : undefined,
      actor: auth.session?.name || "system",
    });

    return NextResponse.json(
      { success: true, messageId: result.messageId, logId: result.logId },
      { status: 200 }
    );
  } catch (err) {
    const wa = WhatsAppError.from(err);
    console.error("[POST /api/whatsapp]", wa.toLogString());

    // Meta's raw error body is deliberately NOT echoed back. The previous
    // handler returned `details: data` verbatim, which can carry fbtrace ids and
    // request echoes to whoever called the endpoint.
    return NextResponse.json(
      { success: false, code: wa.code, message: wa.message },
      { status: wa.code === "AUTH_FAILED" || wa.code === "META_API_ERROR" ? 502 : 400 }
    );
  }
}

/** One-URL "are we live?" check. Same gate — the summary names no secrets. */
export async function GET() {
  const auth = await requireRole(SEND_ROLES);
  if (!auth.isAuthorized) {
    return NextResponse.json({ success: false, message: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ success: true, configuration: configSummary() }, { status: 200 });
}
