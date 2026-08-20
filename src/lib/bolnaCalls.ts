// lib/bolnaCalls.ts — the bolna_calls table.
//
// Split from bolnaSettings.ts because the two have opposite security postures:
// that module guards a secret and exposes almost nothing, this one is ordinary
// CRM data that the lead timeline renders freely.
//
// The interesting logic is applyExecutionUpdate(), which has to be correct
// against webhooks that arrive several times per call, out of order, and
// sometimes for calls the CRM never initiated.

import { query } from "@/lib/db";
import {
  FAILED_CALL_STATUSES,
  TERMINAL_CALL_STATUSES,
  type BolnaCallRecord,
  type BolnaExecution,
} from "@/types/bolna.types";
import { redactSecrets } from "@/config/bolna.config";
import { getOrganizationId } from "./tenantContext";

// ── row → API shape ──────────────────────────────────────────────────────────

function toRecord(r: any): BolnaCallRecord {
  return {
    id: r.id,
    executionId: r.execution_id ?? null,
    leadId: r.lead_id ?? null,
    callerLeadId: r.caller_lead_id ?? null,
    agentId: r.agent_id ?? null,
    channel: r.channel === "web" ? "web" : "phone",
    direction: r.direction ?? "outbound",
    status: r.status,
    fromNumber: r.from_number ?? null,
    toNumber: r.to_number ?? null,
    initiatedByName: r.initiated_by_name ?? null,
    durationSeconds: r.duration_seconds ?? null,
    // NUMERIC comes back from node-postgres as a string to avoid float loss.
    // The UI wants a number; the values here are call costs, well inside the
    // range where Number() is exact.
    totalCost: r.total_cost === null || r.total_cost === undefined ? null : Number(r.total_cost),
    recordingUrl: r.recording_url ?? null,
    transcript: r.transcript ?? null,
    summary: r.summary ?? null,
    extractedData: r.extracted_data ?? null,
    hangupReason: r.hangup_reason ?? null,
    errorMessage: r.error_message ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    completedAt:
      r.completed_at instanceof Date ? r.completed_at.toISOString() : r.completed_at ?? null,
  };
}

// ── creation ─────────────────────────────────────────────────────────────────

/** Records a call at the moment it is initiated, before any outcome is known. */
export async function createCallRecord(params: {
  orgId?: string;
  executionId: string | null;
  leadId?: number | null;
  callerLeadId?: number | null;
  agentId: string;
  channel: "phone" | "web";
  fromNumber?: string | null;
  toNumber?: string | null;
  initiatedBy?: number | null;
  initiatedByName?: string | null;
  status?: string;
  errorMessage?: string | null;
}): Promise<BolnaCallRecord> {
  const rows = await query(
    `INSERT INTO bolna_calls
       (organization_id, execution_id, lead_id, caller_lead_id, agent_id, channel,
        direction, status, from_number, to_number, initiated_by, initiated_by_name,
        error_message)
     VALUES ($1, $2, $3, $4, $5, $6, 'outbound', $7, $8, $9, $10, $11, $12)
     -- A retried mint can hand back an execution id we already hold. Updating
     -- rather than erroring keeps the lead linkage from the first attempt.
     ON CONFLICT (execution_id) DO UPDATE SET
       status     = EXCLUDED.status,
       lead_id    = COALESCE(bolna_calls.lead_id, EXCLUDED.lead_id),
       updated_at = NOW()
     RETURNING *`,
    [
      params.orgId ?? await getOrganizationId(),
      params.executionId,
      params.leadId ?? null,
      params.callerLeadId ?? null,
      params.agentId,
      params.channel,
      params.status ?? "queued",
      params.fromNumber ?? null,
      params.toNumber ?? null,
      params.initiatedBy ?? null,
      params.initiatedByName ?? null,
      params.errorMessage ? redactSecrets(params.errorMessage).slice(0, 1000) : null,
    ]
  );
  return toRecord(rows[0]);
}

// ── the webhook's write path ─────────────────────────────────────────────────

/**
 * Pulls the call summary out of Bolna's extraction block.
 *
 * The shape is defined per agent in the dashboard's Extractions tab, so there is
 * no schema to rely on — the documented example nests it as
 * `extracted_data.General["Call Summary"].subjective`, but an agent configured
 * with different extraction names produces something else entirely.
 *
 * So: try the documented path, then look for any key that reads like a summary,
 * then give up and return null. Returning null is correct and common; inventing
 * a summary by serializing the whole extraction block would put JSON in front of
 * a sales manager expecting a sentence.
 */
export function extractSummary(execution: BolnaExecution): string | null {
  const data = execution.extracted_data;
  if (!data || typeof data !== "object") return null;

  const fromNode = (node: any): string | null => {
    if (typeof node === "string") return node.trim() || null;
    if (node && typeof node === "object") {
      for (const key of ["subjective", "summary", "value", "text"]) {
        const v = node[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return null;
  };

  // The documented location first.
  const documented = (data as any)?.General?.["Call Summary"];
  const fromDocumented = fromNode(documented);
  if (fromDocumented) return fromDocumented;

  // Then any key whose name looks like a summary, at either nesting level.
  const looksLikeSummary = (k: string) => /summary|synopsis|overview|notes/i.test(k);

  for (const [key, value] of Object.entries(data)) {
    if (looksLikeSummary(key)) {
      const v = fromNode(value);
      if (v) return v;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (looksLikeSummary(innerKey)) {
          const v = fromNode(innerValue);
          if (v) return v;
        }
      }
    }
  }

  return null;
}

/**
 * Applies a Bolna execution payload — from a webhook or a reconciliation poll —
 * to the matching row.
 *
 * Three things make this harder than an UPDATE:
 *
 *  1. **Several webhooks arrive per call**, and only the terminal one carries
 *     the transcript, recording, cost and duration. Bolna's docs are explicit
 *     that `call-disconnected` fires "the instant the line drops" with those
 *     fields still null. Writing them unconditionally overwrites a good
 *     transcript with null on any late non-terminal event.
 *
 *  2. **They can arrive out of order.** HTTP delivery has no ordering guarantee,
 *     so a `completed` can land before an `in-progress` that was retried. Status
 *     is therefore only allowed to move forward: once terminal, a later
 *     non-terminal event updates nothing.
 *
 *  3. **The call may not be ours.** Inbound calls and calls placed from the
 *     Bolna dashboard hit the same webhook. Those get a row created so the data
 *     is not lost, with the lead resolved by phone number if possible.
 *
 * COALESCE on each outcome column implements (1) precisely: a null in the
 * payload leaves whatever is already stored, so a good value can never be
 * demoted to null by a subsequent event.
 */
export async function applyExecutionUpdate(
  execution: BolnaExecution,
  opts: { orgId?: string } = {}
): Promise<{ matched: boolean; created: boolean; callId: number | null; leadId: number | null }> {
  const executionId = String(execution.id ?? "").trim();
  if (!executionId) return { matched: false, created: false, callId: null, leadId: null };

  const status = String(execution.status ?? "").trim() || "queued";
  const isTerminal = TERMINAL_CALL_STATUSES.has(status);

  const telephony = execution.telephony_data ?? {};
  const duration =
    execution.conversation_duration ?? (telephony.duration as number | undefined) ?? null;

  // Outcome fields are only trusted on a terminal event, for reason (1) above.
  const transcript = isTerminal ? execution.transcript ?? null : null;
  const summary = isTerminal ? extractSummary(execution) : null;
  const recordingUrl = isTerminal ? telephony.recording_url ?? null : null;
  const totalCost = isTerminal ? execution.total_cost ?? null : null;
  const durationSeconds = isTerminal ? duration : null;
  const extractedData = isTerminal ? execution.extracted_data ?? null : null;

  const errorMessage = FAILED_CALL_STATUSES.has(status)
    ? redactSecrets(
        String(telephony.hangup_reason ?? "") || `Call ended with status "${status}".`
      ).slice(0, 1000)
    : null;

  // ── Tenancy on the webhook path (MT-05) ──────────────────────────────────
  //
  // This runs from Bolna's webhook, so there is no session and no org claim to
  // read; resolving one would mean guessing. The row itself is the trusted
  // source: execution_id is issued by the provider and carries a UNIQUE
  // constraint, so this SELECT identifies exactly one call and, with it, exactly
  // one organization. That organization is then carried into the UPDATE's WHERE
  // clause rather than left implicit, so the statement cannot be repointed at a
  // different tenant's row by a later edit.
  const existing = await query<{
    id: number;
    lead_id: number | null;
    status: string;
    organization_id: string | null;
  }>(
    `SELECT id, lead_id, status, organization_id FROM bolna_calls WHERE execution_id = $1`,
    [executionId]
  );

  if (existing.length > 0) {
    const current = existing[0];

    // Reason (2): never walk a terminal status backwards.
    if (TERMINAL_CALL_STATUSES.has(current.status) && !isTerminal) {
      return { matched: true, created: false, callId: current.id, leadId: current.lead_id };
    }

    const updated = await query<{ id: number; lead_id: number | null }>(
      `UPDATE bolna_calls SET
         status           = $2,
         transcript       = COALESCE($3, transcript),
         summary          = COALESCE($4, summary),
         recording_url    = COALESCE($5, recording_url),
         total_cost       = COALESCE($6, total_cost),
         duration_seconds = COALESCE($7, duration_seconds),
         extracted_data   = COALESCE($8, extracted_data),
         hangup_reason    = COALESCE($9, hangup_reason),
         error_message    = COALESCE($10, error_message),
         to_number        = COALESCE(to_number, $11),
         from_number      = COALESCE(from_number, $12),
         last_payload     = $13,
         completed_at     = CASE WHEN $14 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
         updated_at       = NOW()
       WHERE id = $1 AND organization_id IS NOT DISTINCT FROM $15
       RETURNING id, lead_id`,
      [
        current.id,
        status,
        transcript,
        summary,
        recordingUrl,
        totalCost,
        durationSeconds,
        extractedData ? JSON.stringify(extractedData) : null,
        telephony.hangup_reason ?? null,
        errorMessage,
        execution.user_number ?? null,
        execution.agent_number ?? null,
        JSON.stringify(execution),
        isTerminal,
        current.organization_id,
      ]
    );

    return {
      matched: true,
      created: false,
      callId: updated[0]?.id ?? current.id,
      leadId: updated[0]?.lead_id ?? current.lead_id,
    };
  }

  // Reason (3): a call we did not initiate. Record it anyway.
  const leadId = await findLeadByPhone(execution.user_number ?? null);

  const inserted = await query<{ id: number; lead_id: number | null }>(
    `INSERT INTO bolna_calls
       (organization_id, execution_id, lead_id, agent_id, channel, direction, status,
        from_number, to_number, transcript, summary, recording_url, total_cost,
        duration_seconds, extracted_data, hangup_reason, error_message, last_payload,
        completed_at)
     VALUES ($1, $2, $3, $4, 'phone', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             CASE WHEN $18 THEN NOW() ELSE NULL END)
     ON CONFLICT (execution_id) DO NOTHING
     RETURNING id, lead_id`,
    [
      opts.orgId ?? await getOrganizationId(),
      executionId,
      leadId,
      execution.agent_id ?? null,
      telephony.call_type === "inbound" ? "inbound" : "outbound",
      status,
      execution.agent_number ?? null,
      execution.user_number ?? null,
      transcript,
      summary,
      recordingUrl,
      totalCost,
      durationSeconds,
      extractedData ? JSON.stringify(extractedData) : null,
      telephony.hangup_reason ?? null,
      errorMessage,
      JSON.stringify(execution),
      isTerminal,
    ]
  );

  return {
    matched: false,
    created: inserted.length > 0,
    callId: inserted[0]?.id ?? null,
    leadId: inserted[0]?.lead_id ?? leadId,
  };
}

/**
 * Resolves a lead from the number Bolna spoke to.
 *
 * Compares on the last 10 digits. walkin_enquiries.phone is free text written by
 * several different forms over the CRM's life and holds "+91 98765 43210",
 * "09876543210" and "9876543210" alike, while Bolna always sends strict E.164.
 * Matching the trailing 10 digits is what makes those agree — a fuller
 * normalization would have to happen on 100k rows at query time.
 *
 * A number matching more than one lead returns none. Attaching a transcript to
 * an arbitrary one of two leads that share a phone number is worse than
 * attaching it to neither and leaving it visible on the calls list.
 */
export async function findLeadByPhone(phone: string | null): Promise<number | null> {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);

  const rows = await query<{ id: number }>(
    // The phone/alt_phone match is PARENTHESISED before the tenant filter.
    // Written flat, SQL binds A OR B AND org as A OR (B AND org), so the phone
    // branch would resolve a lead belonging to another organization.
    `SELECT id FROM walkin_enquiries
      WHERE (RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1
             OR RIGHT(regexp_replace(COALESCE(alt_phone, ''), '\\D', '', 'g'), 10) = $1)
        AND organization_id = $2
      LIMIT 2`,
    [last10, await getOrganizationId()]
  );

  return rows.length === 1 ? rows[0].id : null;
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function getCallsForLead(leadId: number, limit = 50): Promise<BolnaCallRecord[]> {
  // Reached from a signed-in request (the call-history widget), so the session's
  // organization is available and the leadId — which arrives as a query parameter —
  // is never the only predicate. The filter precedes the LIMIT.
  const rows = await query(
    `SELECT * FROM bolna_calls
      WHERE lead_id = $1 AND organization_id = $3
      ORDER BY created_at DESC
      LIMIT $2`,
    [leadId, limit, await getOrganizationId()]
  );
  return rows.map(toRecord);
}

export async function getCallByExecutionId(executionId: string): Promise<BolnaCallRecord | null> {
  // Request-path read, so it is scoped to the caller's organization. The webhook
  // does NOT go through here — it uses applyExecutionUpdate above, which resolves
  // tenancy from the row because no session exists there.
  const rows = await query(
    `SELECT * FROM bolna_calls WHERE execution_id = $1 AND organization_id = $2`,
    [executionId, await getOrganizationId()]
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Marks a call that never reached Bolna, so the failure is visible on the lead. */
export async function recordCallFailure(params: {
  orgId?: string;
  leadId?: number | null;
  agentId: string;
  channel: "phone" | "web";
  toNumber?: string | null;
  fromNumber?: string | null;
  initiatedBy?: number | null;
  initiatedByName?: string | null;
  message: string;
}): Promise<void> {
  await query(
    `INSERT INTO bolna_calls
       (organization_id, lead_id, agent_id, channel, direction, status,
        from_number, to_number, initiated_by, initiated_by_name, error_message)
     VALUES ($1, $2, $3, $4, 'outbound', $5, $6, $7, $8, $9, $10)`,
    [
      params.orgId ?? await getOrganizationId(),
      params.leadId ?? null,
      params.agentId,
      params.channel,
      params.channel === "web" ? "mint-failed" : "dial-failed",
      params.fromNumber ?? null,
      params.toNumber ?? null,
      params.initiatedBy ?? null,
      params.initiatedByName ?? null,
      redactSecrets(params.message).slice(0, 1000),
    ]
  );
}
