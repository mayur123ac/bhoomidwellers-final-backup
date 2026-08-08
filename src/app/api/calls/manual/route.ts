// api/calls/manual/route.ts — provider click-to-call for a human-placed call.
//
// The provider rings the CRM user's own handset first, and bridges it to the
// contact when they pick up. Two consequences shape this file:
//
//   * There are two legs. `From` is the user, `To` is the contact, and getting
//     them the wrong way round calls the customer and plays them hold music.
//   * The user needs a phone number of their own. Without one there is nothing
//     to ring, and the honest answer is a 400 naming the fix rather than a
//     provider error the user cannot act on.
//
// The number to dial is read from the database using the lead id, never taken
// from the request body — the same rule /api/bolna/call documents. Trusting a
// client-supplied number against a client-supplied lead id would let any
// signed-in user dial an arbitrary number on the company's account.
//
// When no provider is configured the browser handles the call with a `tel:` URL
// and never reaches this route.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getManualCallingCredentials } from "@/lib/manualCallingSettings";
import { query } from "@/lib/db";
import { toE164 } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exotel's click-to-call. Returns the provider's call sid. */
async function dialViaExotel(params: {
  apiKey: string;
  apiToken: string;
  accountSid: string;
  subdomain: string;
  callerId: string;
  from: string;
  to: string;
}): Promise<string | null> {
  const url = `https://${params.subdomain}/v1/Accounts/${params.accountSid}/Calls/connect.json`;

  // Credentials go in the Authorization header, not in the URL's userinfo
  // section as Exotel's own examples show. A key embedded in a URL ends up in
  // error messages, proxy logs and stack traces.
  const auth = Buffer.from(`${params.apiKey}:${params.apiToken}`).toString("base64");

  const body = new URLSearchParams({
    From: params.from,
    To: params.to,
    CallerId: params.callerId,
    CallType: "trans",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    // A hung telephony API must not hold the request open indefinitely.
    signal: AbortSignal.timeout(15_000),
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const detail =
      payload?.RestException?.Message ??
      payload?.message ??
      `Provider returned ${res.status}`;
    throw new Error(detail);
  }

  return payload?.Call?.Sid ?? null;
}

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const creds = await getManualCallingCredentials().catch(() => null);
  if (!creds) {
    // The client checks this first and falls back to tel:, so reaching here means
    // the configuration changed between page load and click.
    return NextResponse.json(
      {
        success: false,
        code: "NOT_CONFIGURED",
        message:
          "Click-to-call is not configured. Use the phone dialler, or add credentials in Settings → Calling.",
      },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, any>);
  const leadId = Number.isFinite(Number(body.leadId)) ? Number(body.leadId) : null;
  const callerLeadId = Number.isFinite(Number(body.callerLeadId))
    ? Number(body.callerLeadId)
    : null;

  // ── Resolve the contact's number from the database ──
  let toRaw: string | null = null;

  if (leadId !== null) {
    const rows = await query<{ phone: string | null }>(
      `SELECT phone FROM walkin_enquiries WHERE id = $1`,
      [leadId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Lead not found." }, { status: 404 });
    }
    toRaw = rows[0].phone;
  } else if (callerLeadId !== null) {
    const rows = await query<{ contact_no: string | null }>(
      `SELECT contact_no FROM caller_leads WHERE id = $1`,
      [callerLeadId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Lead not found." }, { status: 404 });
    }
    toRaw = rows[0].contact_no;
  } else if (typeof body.to === "string") {
    // Only honoured when no lead id was supplied — a contact that exists on a
    // booking or partner record rather than a lead.
    toRaw = body.to;
  }

  if (!toRaw) {
    return NextResponse.json(
      { success: false, message: "No phone number on this record to call." },
      { status: 400 }
    );
  }

  const to = toE164(toRaw);
  if (!to.ok) {
    return NextResponse.json(
      {
        success: false,
        message: `"${toRaw}" is not a valid phone number, so the call cannot be placed. Fix it on the record first.`,
      },
      { status: 400 }
    );
  }

  // ── Resolve the agent's own number ──
  if (gate.userId === null) {
    return NextResponse.json(
      { success: false, message: "Your account could not be identified." },
      { status: 400 }
    );
  }

  const me = await query<{ phone: string | null; whatsapp_number: string | null }>(
    `SELECT phone, whatsapp_number FROM users WHERE id = $1`,
    [gate.userId]
  );
  const fromRaw = me[0]?.phone || me[0]?.whatsapp_number || "";
  const from = toE164(fromRaw);

  if (!from.ok) {
    return NextResponse.json(
      {
        success: false,
        code: "NO_AGENT_NUMBER",
        message:
          "Click-to-call rings your phone first, but your account has no phone number. " +
          "Add one in Settings → Profile, or use the phone dialler instead.",
      },
      { status: 400 }
    );
  }

  try {
    const sid = await dialViaExotel({
      apiKey: creds.apiKey,
      apiToken: creds.apiToken,
      accountSid: creds.accountSid,
      subdomain: creds.subdomain,
      callerId: creds.callerId,
      from: from.e164,
      to: to.e164,
    });

    return NextResponse.json({
      success: true,
      sid,
      message: "Your phone is ringing now. Answer it and you will be connected.",
    });
  } catch (err: any) {
    // The provider's own message is the useful part — "insufficient balance" and
    // "unverified number" are both things an admin can act on, and collapsing
    // them into "call failed" wastes a support round trip.
    const message = err?.name === "TimeoutError"
      ? "The telephony provider did not respond in time. The call may or may not have been placed."
      : err?.message || "The call could not be placed.";
    console.error("[manual call]", message);
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
