// api/bolna/session/route.ts — mints a browser web-call session.
//
// This is the route the Web Call SDK is pointed at via `sessionUrl`. It is a
// thin proxy in the shape Bolna's docs prescribe: call the mint endpoint with
// the API key server-side, return the JSON unchanged.
//
// ── Two things this route must get right ─────────────────────────────────────
//
// 1. **Auth in front of it.** Bolna's own example says "put YOUR auth in front
//    of this route" and then omits it. Unauthenticated, this endpoint is a free
//    voice-agent proxy: anyone who finds the path can mint sessions and place
//    calls billed to the account, without ever seeing the API key. requireSession
//    is not optional decoration here — it is the only thing standing between the
//    public internet and the Bolna balance.
//
// 2. **The body is returned verbatim.** The SDK consumes the mint response
//    exactly as Bolna shapes it — SIP credentials, TURN servers, a run id.
//    Reshaping or re-serializing it risks dropping a field the SDK needs, so the
//    only thing added is nothing.
//
// The response is a live credential for ~120 seconds. It is never logged; see
// the sip_password rule in config/bolna.config.ts's redactSecrets.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getBolnaCredentials } from "@/lib/bolnaSettings";
import { mintWebCallSession, toBolnaError } from "@/lib/bolna-client";
import { createCallRecord, recordCallFailure } from "@/lib/bolnaCalls";
import { readBolnaConfig, redactSecrets } from "@/config/bolna.config";
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

  if (!cfg.webCallEnabled) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Browser calling is switched off. Bolna's Web Call SDK is in beta and enabled per " +
          "account — once Bolna has enabled it, set BOLNA_WEB_CALL_ENABLED=true.",
        code: "WEB_CALL_DISABLED",
      },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // The SDK POSTs `{ user_data }` automatically when `userData` is set on the
  // instance. Bolna's docs warn twice that a proxy which drops this field makes
  // the agent's prompt variables silently empty — no error, just an agent that
  // never says the customer's name. So it is forwarded explicitly.
  const userData =
    body && typeof body.user_data === "object" && body.user_data !== null
      ? (body.user_data as Record<string, unknown>)
      : {};

  // CRM linkage. Sent by the call widget, outside user_data so it cannot collide
  // with an agent's prompt variables. leadId is ours; Bolna never sees it.
  const leadId = Number.isFinite(Number(body.leadId)) ? Number(body.leadId) : null;
  const toNumber = typeof body.toNumber === "string" ? body.toNumber : null;

  let creds;
  try {
    creds = await getBolnaCredentials();
  } catch (err: unknown) {
    // A decryption fault — worth surfacing precisely rather than as "not configured".
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, code: "DECRYPT_FAILED", message: redactSecrets(detail) },
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

  try {
    const session = await mintWebCallSession(creds.apiKey, { agentId: creds.agentId, userData });

    // Recorded before the response goes out, so a call that connects always has
    // a row. run_id is the same id the webhook will arrive with, which is what
    // lets the transcript find its way back to this lead.
    if (session?.run_id) {
      await createCallRecord({
        executionId: session.run_id,
        leadId,
        agentId: creds.agentId,
        channel: "web",
        toNumber,
        fromNumber: creds.phoneNumber || null,
        initiatedBy: gate.userId,
        initiatedByName: gate.session.name,
        status: "queued",
      }).catch((e) => {
        // A failed insert must not sink a call the user is waiting on. The
        // webhook creates the row later if this fails — see applyExecutionUpdate's
        // "call we did not initiate" branch.
        console.error("[bolna/session] could not record call:", redactSecrets(String(e?.message ?? e)));
      });
    }

    // Verbatim, per the note at the top.
    return NextResponse.json(session, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const be = toBolnaError(err);
    console.error("[bolna/session]", be.code, be.message);

    await recordCallFailure({
      leadId,
      agentId: creds.agentId,
      channel: "web",
      toNumber,
      fromNumber: creds.phoneNumber || null,
      initiatedBy: gate.userId,
      initiatedByName: gate.session.name,
      message: `${be.code}: ${be.message}`,
    }).catch(() => {});

    // The body, not the status, is what the widget shows. Our own status is
    // flattened to 400/502 and cannot express the difference between "Bolna
    // rejected the key" and "that endpoint does not exist on this account", so
    // `code` carries the diagnosis and `upstreamStatus` carries Bolna's real
    // status for the client to fall back on.
    //
    // `upstreamStatus` is safe to expose: it is an HTTP status code from a
    // request the browser could not make itself and reveals nothing about the
    // credentials. `describeBolnaError` has already been through redactSecrets
    // upstream in bolna-client.ts.
    return NextResponse.json(
      {
        success: false,
        code: be.code,
        message: describeBolnaError(be),
        upstreamStatus: be.httpStatus,
      },
      { status: be.httpStatus && be.httpStatus < 500 ? 400 : 502 }
    );
  }
}
