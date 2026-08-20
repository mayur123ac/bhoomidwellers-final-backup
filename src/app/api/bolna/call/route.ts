// api/bolna/call/route.ts — places an outbound PHONE call through Bolna.
//
// The telephony counterpart to /api/bolna/session. Bolna dials the contact's
// number from the configured agent and phone number; nobody's browser is
// involved and the CRM user is not on the call.
//
// This is the path that actually uses the configured phone number. A browser
// web call has no PSTN leg at all — the browser IS the far end — so
// `from_phone_number` has nothing to mean there. Both exist because they answer
// different questions: "have the agent ring this customer" (here) versus "let me
// talk to the agent from my desk" (session route).
//
// GET returns the call history for a lead, so the widget can render past calls
// with their transcripts without a second endpoint.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getBolnaCredentials } from "@/lib/bolnaSettings";
import { makeCall, toBolnaError } from "@/lib/bolna-client";
import { createCallRecord, getCallsForLead, recordCallFailure } from "@/lib/bolnaCalls";
import { readBolnaConfig, redactSecrets } from "@/config/bolna.config";
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { toE164 } from "@/lib/phone";
import { describeBolnaError } from "@/types/bolna.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const cfg = readBolnaConfig();
  if (!cfg.enabled) {
    return NextResponse.json(
      { success: false, message: "Calling is disabled (BOLNA_ENABLED=false)." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({} as Record<string, any>));

  const leadId = Number.isFinite(Number(body.leadId)) ? Number(body.leadId) : null;
  const callerLeadId = Number.isFinite(Number(body.callerLeadId))
    ? Number(body.callerLeadId)
    : null;

  // ── Resolve the number to dial ──
  //
  // Taken from the lead record when a leadId is given, and only from the request
  // body otherwise. This matters: trusting a client-supplied number against a
  // client-supplied lead id would let any signed-in user dial an arbitrary
  // number and file the record against someone else's lead. The database is the
  // authority on what a lead's phone number is.
  let toRaw: string | null = null;
  let leadName: string | null = null;

  if (leadId !== null) {
    const rows = await query<{ phone: string | null; name: string | null }>(
      `SELECT phone, name FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
      [leadId, await getOrganizationId()]
    );
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Lead not found." }, { status: 404 });
    }
    toRaw = rows[0].phone;
    leadName = rows[0].name;
  } else if (callerLeadId !== null) {
    const rows = await query<{ contact_no: string | null; name: string | null }>(
      `SELECT contact_no, name FROM caller_leads WHERE id = $1 AND organization_id = $2`,
      [callerLeadId, await getOrganizationId()]
    );
    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Lead not found." }, { status: 404 });
    }
    toRaw = rows[0].contact_no;
    leadName = rows[0].name;
  } else if (typeof body.to === "string") {
    toRaw = body.to;
  }

  if (!toRaw) {
    return NextResponse.json(
      { success: false, message: "No phone number on this record to call." },
      { status: 400 }
    );
  }

  const e164 = toE164(toRaw);
  if (!e164.ok) {
    return NextResponse.json(
      {
        success: false,
        message: `"${toRaw}" is not a valid phone number, so the call cannot be placed. Fix it on the lead first.`,
      },
      { status: 400 }
    );
  }

  let creds;
  try {
    creds = await getBolnaCredentials();
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: redactSecrets(String(err?.message ?? err)) },
      { status: 500 }
    );
  }

  if (!creds) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Bolna is not configured. Ask an admin to add the credentials in Settings → Calling Integration.",
        code: "NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  // Prompt variables. Bolna substitutes `{name}` etc. in the agent's prompt and
  // welcome message. Only non-sensitive fields: Bolna's docs note user_data is
  // stored on the call record and shown in call history.
  const userData: Record<string, unknown> = {
    ...(body.userData && typeof body.userData === "object" ? body.userData : {}),
  };
  if (leadName && !userData.name) userData.name = leadName;

  try {
    const res = await makeCall(creds.apiKey, {
      agentId: creds.agentId,
      recipientPhoneNumber: e164.e164,
      fromPhoneNumber: creds.phoneNumber || null,
      userData,
    });

    const record = await createCallRecord({
      executionId: res.execution_id ?? null,
      leadId,
      callerLeadId,
      agentId: creds.agentId,
      channel: "phone",
      fromNumber: creds.phoneNumber || null,
      toNumber: e164.e164,
      initiatedBy: gate.userId,
      initiatedByName: gate.session.name,
      status: res.status || "queued",
    });

    // The lead timeline is where sales staff actually look; a call that only
    // exists in bolna_calls is a call nobody sees. Best-effort — a failed log
    // entry should not report the placed call as failed.
    if (leadId !== null) {
      await query(
        `INSERT INTO employee_activity_logs
           (user_id, action_type, module, lead_id, lead_name, description, event_severity, organization_id)
         VALUES ($1, 'voice_call', 'bolna', $2, $3, $4, 'info', $5)`,
        [
          gate.userId,
          String(leadId),
          leadName,
          `AI voice call placed to ${e164.e164} via Bolna agent`,
          await getOrganizationId(),
        ]
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: `Calling ${e164.e164}…`,
      call: record,
      executionId: res.execution_id,
    });
  } catch (err) {
    const be = toBolnaError(err);
    console.error("[bolna/call]", be.code, be.message);

    await recordCallFailure({
      leadId,
      agentId: creds.agentId,
      channel: "phone",
      toNumber: e164.e164,
      fromNumber: creds.phoneNumber || null,
      initiatedBy: gate.userId,
      initiatedByName: gate.session.name,
      message: `${be.code}: ${be.message}`,
    }).catch(() => {});

    return NextResponse.json(
      { success: false, code: be.code, message: describeBolnaError(be) },
      { status: be.httpStatus && be.httpStatus < 500 ? 400 : 502 }
    );
  }
}

/** GET /api/bolna/call?leadId=123 — call history for the widget's list. */
export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const leadId = Number(req.nextUrl.searchParams.get("leadId"));
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ success: false, message: "leadId is required." }, { status: 400 });
  }

  try {
    const calls = await getCallsForLead(leadId);
    return NextResponse.json({ success: true, calls });
  } catch (err: any) {
    console.error("[GET /api/bolna/call]", redactSecrets(String(err?.message ?? err)));
    return NextResponse.json(
      { success: false, message: "Could not load call history." },
      { status: 500 }
    );
  }
}
