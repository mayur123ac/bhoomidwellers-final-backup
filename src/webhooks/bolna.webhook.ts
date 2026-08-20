// webhooks/bolna.webhook.ts — Bolna's callback logic.
//
// Imports nothing from next/*, so it can be tested without booting the
// framework. The route handler at api/webhooks/bolna/route.ts is a thin adapter.
//
// ── Authenticating a webhook that is not signed ──────────────────────────────
//
// Meta signs its webhooks; whatsapp.webhook.ts verifies an HMAC over the raw
// bytes and that is the end of the question. Bolna does not sign anything. Its
// entire documented guidance is "Webhooks are sent from the following IP
// address. Whitelist this IP on your server" — advice for an nginx config, not
// something a route handler can rely on, because behind Vercel, Cloudflare or
// any other proxy the socket address is the proxy's and X-Forwarded-For is
// attacker-controlled unless the proxy is known to overwrite it.
//
// So the real authentication is a shared secret in the URL:
//
//     https://crm.example.com/api/webhooks/bolna?token=<BOLNA_WEBHOOK_TOKEN>
//
// pasted into the agent's Extractions tab. It is compared in constant time. The
// IP allowlist is offered as an optional second factor for deployments where the
// proxy chain is known, and is off by default rather than defaulting to Bolna's
// documented IP — a single hard-coded IP that Bolna changes one day would drop
// every transcript silently.
//
// Without a token configured the endpoint refuses everything. An open webhook
// that writes transcripts and summaries onto customer records is a content
// injection endpoint, and defaulting to open so that setup is easier would be
// choosing the wrong side of that.

import crypto from "node:crypto";
import { applyExecutionUpdate } from "@/lib/bolnaCalls";
import { readBolnaConfig, redactSecrets } from "@/config/bolna.config";
import { TERMINAL_CALL_STATUSES, type BolnaExecution } from "@/types/bolna.types";
import { query } from "@/lib/db";

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Constant-time string comparison that tolerates length differences. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, and returning early on length
  // would leak it. Hashing first makes both sides 32 bytes unconditionally.
  const ah = crypto.createHash("sha256").update(ab).digest();
  const bh = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export interface AuthInput {
  token: string | null;
  /** Already reduced to a single address by the caller. */
  ip: string | null;
}

export type AuthResult = { ok: true } | { ok: false; status: number; reason: string };

export function authenticateWebhook(input: AuthInput): AuthResult {
  const cfg = readBolnaConfig();

  if (!cfg.webhookToken) {
    return {
      ok: false,
      status: 503,
      reason:
        "BOLNA_WEBHOOK_TOKEN is not set on this server, so webhook calls cannot be authenticated and are refused.",
    };
  }

  if (!input.token || !safeEqual(input.token, cfg.webhookToken)) {
    return { ok: false, status: 401, reason: "Invalid or missing webhook token." };
  }

  if (cfg.webhookAllowedIps.length > 0) {
    if (!input.ip || !cfg.webhookAllowedIps.includes(input.ip)) {
      return { ok: false, status: 403, reason: `Source address ${input.ip ?? "unknown"} is not allowed.` };
    }
  }

  return { ok: true };
}

/**
 * Handles one webhook delivery.
 *
 * Bolna posts the execution payload — the same shape as GET /executions/{id} —
 * once per status transition, so this runs several times per call. All the
 * ordering and partial-data handling lives in applyExecutionUpdate; see the
 * comment block there.
 *
 * Always answers 200 once the payload is understood, including when the call
 * matches no lead. A non-2xx tells Bolna to retry, and retrying will not conjure
 * a lead that does not exist — it just replays the same delivery until it gives
 * up. Genuine faults (a database that is down) do return 5xx, because those a
 * retry can actually fix.
 */
export async function handleWebhookPost(rawBody: string): Promise<WebhookResponse> {
  let payload: BolnaExecution;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { success: false, message: "Body is not valid JSON." } };
  }

  if (!payload || typeof payload !== "object" || !payload.id) {
    // Bolna reuses this endpoint for pre-call webhooks fired by custom function
    // tools, which carry the tool's own fields. Those have nothing to apply, and
    // answering 200 stops them being retried forever.
    return { status: 200, body: { success: true, ignored: "no execution id in payload" } };
  }

  const status = String(payload.status ?? "");

  try {
    const result = await applyExecutionUpdate(payload);

    // The lead timeline entry is written once, on the terminal event. Writing it
    // per webhook would put five near-identical rows on the lead for one call.
    if (result.leadId && TERMINAL_CALL_STATUSES.has(status)) {
      await writeLeadTimelineEntry(result.leadId, payload);
    }

    return {
      status: 200,
      body: {
        success: true,
        execution_id: payload.id,
        status,
        matched: result.matched,
        created: result.created,
        lead_id: result.leadId,
      },
    };
  } catch (err: any) {
    const message = redactSecrets(String(err?.message ?? err));
    console.error("[bolna webhook]", payload.id, status, message);
    // 5xx so Bolna retries — this branch is a database fault, which is transient.
    return { status: 500, body: { success: false, message: "Could not record the call." } };
  }
}

/**
 * Puts the call on the lead's activity timeline.
 *
 * Two tables, because the CRM has two notions of "what happened on this lead"
 * and staff read both:
 *
 *   employee_activity_logs — the audit feed, every action, admin-facing.
 *   follow_ups             — the conversation thread on the lead detail page,
 *                            which is where a sales manager actually looks.
 *
 * The follow_ups entry carries the summary rather than the transcript. A
 * transcript can be thousands of words and follow_ups renders inline; the full
 * text stays on bolna_calls where the call widget shows it on demand.
 */
async function writeLeadTimelineEntry(leadId: number, payload: BolnaExecution): Promise<void> {
  const { extractSummary } = await import("@/lib/bolnaCalls");

  const status = String(payload.status ?? "");
  const duration =
    payload.conversation_duration ?? payload.telephony_data?.duration ?? null;
  const summary = extractSummary(payload);

  const durationText =
    typeof duration === "number" && duration > 0
      ? `${Math.floor(duration / 60)}m ${duration % 60}s`
      : null;

  const headline =
    status === "completed"
      ? `AI voice call completed${durationText ? ` (${durationText})` : ""}`
      : `AI voice call ended: ${status}`;

  const message = summary ? `${headline}\n\n${summary}` : headline;

  // ── MT-05 tenant resolution for an unauthenticated caller ────────────────
  // This runs from a provider callback, so there is no session and
  // getOrganizationId() would fall back to "the only organization" — which is a
  // guess, and stops being correct the moment a second tenant exists.
  //
  // It does not need to guess. `leadId` was read out of the bolna_calls row
  // matched on execution_id, so it is server-side data, not anything the caller
  // sent. The lead therefore IS the tenant source, and both writes derive the
  // organization from it in SQL.
  //
  // INSERT ... SELECT rather than VALUES, deliberately: if the lead has since
  // been deleted the SELECT yields no row and nothing is written, instead of
  // writing a row with a NULL organization. No orphan, no NULL, no fallback.
  await query(
    `INSERT INTO employee_activity_logs
       (user_id, action_type, module, lead_id, lead_name, description, event_severity, organization_id)
     -- lead_id is varchar on employee_activity_logs, so it is taken from the
     -- joined row (w.id::text) rather than casting the parameter. Casting $1
     -- would make Postgres infer it as text and break the join predicate.
     SELECT NULL, 'voice_call_completed', 'bolna', w.id::text, NULL, $2, $3, w.organization_id
       FROM walkin_enquiries w WHERE w.id = $1`,
    [leadId, message, status === "completed" ? "info" : "warning"]
  ).catch((e) => console.error("[bolna webhook] activity log failed:", e?.message));

  await query(
    `INSERT INTO follow_ups (lead_id, message, created_by_name, follow_up_type, created_by_role, organization_id)
     SELECT $1, $2, 'Bolna AI Agent', 'voice_call', 'system', w.organization_id
       FROM walkin_enquiries w WHERE w.id = $1`,
    [leadId, message]
  ).catch((e) => console.error("[bolna webhook] follow-up failed:", e?.message));
}
