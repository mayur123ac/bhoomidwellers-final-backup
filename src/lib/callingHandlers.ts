// lib/callingHandlers.ts — client-side entry points for the two call buttons.
//
// Both deliberately send an id rather than a phone number whenever one is
// available. The server re-reads the number from the database, so a tampered
// client cannot dial an arbitrary number on the company's telephony account and
// file the record against someone else's lead. `phone` is only sent for contacts
// that are not leads at all — a booking or a channel partner.

import { isAndroidApp } from "@/lib/platform";
import { savePendingSession } from "@/lib/callSessionStore";

export interface CallTarget {
  leadId?: number | null;
  callerLeadId?: number | null;
  phone?: string | null;
  leadName?: string | null;
}

interface CallResult {
  message?: string;
}

export interface CallSessionResult {
  callSessionId: number;
  phoneNumber: string;
  callStartedAt: number;
}

/** Body shared by both routes: ids when we have them, a raw number otherwise. */
function targetBody(t: CallTarget): Record<string, unknown> {
  if (t.leadId != null) return { leadId: t.leadId };
  if (t.callerLeadId != null) return { callerLeadId: t.callerLeadId };
  return { to: t.phone };
}

async function postCall(url: string, body: Record<string, unknown>): Promise<CallResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => null);

  // Both routes answer with { success, message }. The server's message is
  // written for the person reading it — "insufficient balance", "add a phone
  // number in Settings → Profile" — so it is surfaced rather than replaced.
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || `The call could not be placed (${res.status}).`);
  }
  return json;
}

/**
 * Places a human-dialled call.
 *
 * In `provider` mode the server asks the telephony provider to ring the user's
 * own handset and bridge it to the contact. In `tel` mode there is no server
 * involved: the browser hands a `tel:` URL to the OS.
 *
 * On Android (tel mode), a call session is created server-side before the
 * dialer opens. The returned CallSessionResult lets the caller show the
 * post-call recording modal after the user returns from the phone app.
 *
 * Sessions are only created on Android because the recording/call-log workflow
 * requires native APIs. On desktop, `tel:` is a fire-and-forget hand-off.
 */
export async function placeManualCall(
  target: CallTarget & { mode: "provider" | "tel" }
): Promise<(CallResult & { callSession?: CallSessionResult }) | null> {
  if (target.mode === "provider") {
    return postCall("/api/calls/manual", targetBody(target));
  }

  const digits = String(target.phone ?? "").replace(/\D/g, "");
  if (!digits) {
    throw new Error("No phone number on record.");
  }

  // Only create a server-side call session on Android — that's the only
  // platform where we can read the call log and find recordings afterwards.
  // On desktop/web, opening `tel:` is a fire-and-forget hand-off with no
  // session to reconcile, so creating one would leave orphaned rows.
  let callSession: CallSessionResult | undefined;
  if (isAndroidApp() && (target.leadId || target.callerLeadId)) {
    try {
      const res = await fetch("/api/call-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: target.leadId || undefined,
          callerLeadId: target.callerLeadId || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        callSession = {
          callSessionId: json.callSessionId,
          phoneNumber: json.phoneNumber,
          callStartedAt: Date.now(),
        };
        // Persist to localStorage so the session survives app kill/restart.
        savePendingSession({
          ...callSession,
          leadId: target.leadId,
          callerLeadId: target.callerLeadId,
        });
      }
    } catch {
      // Non-fatal — the call can still proceed without session tracking
    }
  }

  // location.href rather than window.open: a `tel:` handed to open() leaves an
  // orphaned blank tab behind on desktop browsers that have no handler for the
  // scheme, and does nothing useful on those that do.
  window.location.href = `tel:${digits}`;
  return callSession ? { callSession } : null;
}

/**
 * Asks the Bolna agent to call the contact.
 *
 * Routed through the existing /api/bolna/call, which owns credential lookup,
 * E.164 normalisation and writing the bolna_calls record. This button is a
 * second entry point to that flow, not a second implementation of it.
 */
export async function placeAiCall(target: CallTarget): Promise<CallResult> {
  return postCall("/api/bolna/call", targetBody(target));
}
