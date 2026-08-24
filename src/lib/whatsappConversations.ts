// lib/whatsappConversations.ts — conversation threads, lead matching, message
// persistence and status transitions.
//
// This module owns the database side of two-way WhatsApp. It does NOT talk to
// Meta: lib/whatsapp-client.ts is still the only module that holds the access
// token. The send route composes the two.
//
// It is also deliberately free of next/* imports, so the whole matching and
// status machinery can be exercised from a plain node script — which is the only
// way to test webhook behaviour without a public URL.
//
// ── Relationship to the existing WhatsApp module ────────────────────────────
// services/whatsapp.service.ts and notification_logs are a per-user retry QUEUE
// for automated alerts (CP registered, CP lead assigned). They are keyed to a
// users.id recipient and carry one payload per notification. A customer
// conversation is a different thing — a durable thread against a LEAD, with
// inbound traffic, unread counts and a 24-hour window — and modelling it as
// notification rows would mean reconstructing threads by grouping on a phone
// number at read time. The two coexist and share the transport layer.

import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { toE164 } from "./phone";

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

export type MatchState = "matched" | "unmatched" | "ambiguous";
export type Direction = "inbound" | "outbound";
export type MessageStatus =
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "received";

export interface ConversationRow {
  id: number;
  organization_id: string;
  lead_id: number | null;
  customer_phone: string;
  customer_wa_id: string | null;
  customer_profile_name: string | null;
  phone_number_id: string;
  assigned_user_id: number | null;
  match_state: MatchState;
  candidate_lead_ids: number[];
  status: "open" | "closed";
  last_message_at: Date | null;
  last_message_preview: string | null;
  last_message_direction: Direction | null;
  last_inbound_at: Date | null;
  unread_count: number;
}

export interface MessageRow {
  id: string;
  conversation_id: number;
  lead_id: number | null;
  direction: Direction;
  sender_user_id: number | null;
  sender_name: string | null;
  sender_role: string | null;
  message_type: string;
  message_text: string | null;
  template_name: string | null;
  whatsapp_message_id: string | null;
  client_token: string | null;
  status: MessageStatus;
  error_code: string | null;
  error_message: string | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// Tenant routing
// ════════════════════════════════════════════════════════════════════════════

/**
 * The organization that owns a WhatsApp business number.
 *
 * This is the webhook's ONLY tenant signal, and there is deliberately no
 * fallback. getOrganizationId()'s sole-organization fallback would be wrong
 * here: production has three organizations, so it throws, and on a single-org
 * database it would succeed for the wrong reason and hide the missing mapping
 * until a second tenant was onboarded. Returning null makes the gap explicit on
 * every database.
 */
export async function organizationForPhoneNumberId(
  phoneNumberId: string,
  client?: PoolClient
): Promise<string | null> {
  const sql = `SELECT organization_id FROM public.whatsapp_business_numbers
                WHERE phone_number_id = $1 AND is_active = true LIMIT 1`;
  const rows = client
    ? (await client.query(sql, [phoneNumberId])).rows
    : await query<{ organization_id: string }>(sql, [phoneNumberId]);
  return rows.length > 0 ? rows[0].organization_id : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Lead matching  (spec §5)
// ════════════════════════════════════════════════════════════════════════════

/**
 * The join key for matching a WhatsApp number against walkin_enquiries.phone.
 *
 * Last ten digits, matching the convention the rest of the CRM already uses for
 * phone identity (SQL_NORMALIZED_PHONE, normalizeCpPhone, the
 * idx_channel_partners_phone_norm expression index). WhatsApp gives us
 * '919930816041'; the lead table holds '9930816041', '+91 99308 16041' and
 * '09930816041' among others. Comparing the last ten digits collapses all of
 * them without needing the stored values cleaned up first.
 *
 * Country code is NOT part of the key. Within one Indian brokerage every lead is
 * +91, and demanding the country code match would fail every lead stored without
 * one — which is most of them.
 */
const LAST10 = `right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10)`;

export interface MatchResult {
  state: MatchState;
  leadId: number | null;
  candidates: number[];
}

/**
 * Finds the lead for an inbound number.
 *
 * Three outcomes, and the third is why this returns a shape rather than a lead
 * id. Four numbers in the test branch sit on three leads each, so "pick the most
 * recent" would misattribute real conversations on a regular basis — and the
 * person harmed is invisible, because the message simply lands on a colleague's
 * lead and the right salesperson never learns the customer replied.
 *
 * Lost leads are excluded from matching but still offered as candidates, so a
 * reply to a written-off lead surfaces for a human decision instead of silently
 * reopening it.
 */
export async function matchLeadByPhone(
  organizationId: string,
  e164: string,
  client?: PoolClient
): Promise<MatchResult> {
  const digits = e164.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length < 10) return { state: "unmatched", leadId: null, candidates: [] };

  const sql = `SELECT id, COALESCE(is_lost_lead, false) AS is_lost
                 FROM public.walkin_enquiries
                WHERE organization_id = $1 AND ${LAST10} = $2
                ORDER BY id`;
  const rows: Array<{ id: number; is_lost: boolean }> = client
    ? (await client.query(sql, [organizationId, last10])).rows
    : await query(sql, [organizationId, last10]);

  if (rows.length === 0) return { state: "unmatched", leadId: null, candidates: [] };

  const live = rows.filter((r) => !r.is_lost);

  // Exactly one live lead is the only unambiguous case. One live lead among
  // several lost ones still counts: the lost ones are not competing for the
  // conversation.
  if (live.length === 1) {
    return { state: "matched", leadId: live[0].id, candidates: rows.map((r) => r.id) };
  }

  // Zero live leads (all lost) or two or more live leads: a human decides.
  return { state: "ambiguous", leadId: null, candidates: rows.map((r) => r.id) };
}

// ════════════════════════════════════════════════════════════════════════════
// Conversation upsert
// ════════════════════════════════════════════════════════════════════════════

export interface EnsureConversationInput {
  organizationId: string;
  phoneNumberId: string;
  /** Any format; normalized here. */
  phoneRaw: string;
  profileName?: string | null;
  waId?: string | null;
}

export interface EnsureConversationResult {
  conversation: ConversationRow;
  created: boolean;
}

/**
 * Finds or creates the thread for a customer number.
 *
 * Matching runs on creation and on any later message that arrives while the
 * thread is still unmatched — so a conversation from an unknown number is
 * automatically adopted the moment someone creates the lead, with no
 * re-processing step. A thread that is already matched is left alone: once a
 * human has associated it, an automatic re-match must not silently move it.
 */
export async function ensureConversation(
  i: EnsureConversationInput,
  client?: PoolClient
): Promise<EnsureConversationResult> {
  const norm = toE164(i.phoneRaw);
  if (!norm.ok) {
    throw new Error(`Cannot normalize phone "${i.phoneRaw}": ${norm.reason}`);
  }
  const e164 = norm.e164;

  const run = async (c: PoolClient): Promise<EnsureConversationResult> => {
    const existing = await c.query<ConversationRow>(
      `SELECT * FROM public.whatsapp_conversations
        WHERE organization_id = $1 AND phone_number_id = $2 AND customer_phone = $3`,
      [i.organizationId, i.phoneNumberId, e164]
    );

    if (existing.rows.length > 0) {
      const conv = existing.rows[0];

      // Late adoption: the lead may have been created since the thread opened.
      if (conv.match_state !== "matched") {
        const m = await matchLeadByPhone(i.organizationId, e164, c);
        if (m.state === "matched") {
          const updated = await c.query<ConversationRow>(
            `UPDATE public.whatsapp_conversations
                SET lead_id = $2, match_state = 'matched', candidate_lead_ids = $3,
                    customer_profile_name = COALESCE($4, customer_profile_name),
                    updated_at = now()
              WHERE id = $1 RETURNING *`,
            [conv.id, m.leadId, m.candidates, i.profileName ?? null]
          );
          return { conversation: updated.rows[0], created: false };
        }
        // Still not matched, but the candidate set may have grown.
        if (m.candidates.length !== conv.candidate_lead_ids.length) {
          const updated = await c.query<ConversationRow>(
            `UPDATE public.whatsapp_conversations
                SET match_state = $2, candidate_lead_ids = $3, updated_at = now()
              WHERE id = $1 RETURNING *`,
            [conv.id, m.state, m.candidates]
          );
          return { conversation: updated.rows[0], created: false };
        }
      }

      // Keep the profile name fresh — it is all an unmatched thread has to show.
      if (i.profileName && i.profileName !== conv.customer_profile_name) {
        const updated = await c.query<ConversationRow>(
          `UPDATE public.whatsapp_conversations
              SET customer_profile_name = $2, updated_at = now()
            WHERE id = $1 RETURNING *`,
          [conv.id, i.profileName]
        );
        return { conversation: updated.rows[0], created: false };
      }

      return { conversation: conv, created: false };
    }

    // ── Create ──────────────────────────────────────────────────────────────
    const m = await matchLeadByPhone(i.organizationId, e164, c);

    // ON CONFLICT rather than a bare INSERT: two webhook deliveries for the same
    // new customer can race here, and the loser must find the winner's row
    // instead of failing the whole payload.
    const inserted = await c.query<ConversationRow>(
      `INSERT INTO public.whatsapp_conversations
         (organization_id, phone_number_id, customer_phone, customer_wa_id,
          customer_profile_name, lead_id, match_state, candidate_lead_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id, phone_number_id, customer_phone) DO UPDATE
         SET updated_at = now()
       RETURNING *`,
      [
        i.organizationId,
        i.phoneNumberId,
        e164,
        i.waId ?? null,
        i.profileName ?? null,
        m.leadId,
        m.state,
        m.candidates,
      ]
    );

    return { conversation: inserted.rows[0], created: true };
  };

  return client ? run(client) : transaction(run);
}

/** The thread for a lead, if one exists. Used when opening the panel from a lead. */
export async function conversationForLead(
  organizationId: string,
  leadId: number
): Promise<ConversationRow | null> {
  const rows = await query<ConversationRow>(
    `SELECT * FROM public.whatsapp_conversations
      WHERE organization_id = $1 AND lead_id = $2
      ORDER BY last_message_at DESC NULLS LAST, id DESC LIMIT 1`,
    [organizationId, leadId]
  );
  return rows[0] ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// The 24-hour customer service window  (spec §13)
// ════════════════════════════════════════════════════════════════════════════

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WindowState {
  open: boolean;
  expiresAt: string | null;
}

/**
 * Whether free-form text can currently be delivered on a thread.
 *
 * WhatsApp only permits free-form messages within 24 hours of the customer's
 * last inbound message. Outside that window Meta rejects with 131047 and only an
 * approved template is deliverable.
 *
 * This is computed and surfaced rather than worked around. The composer uses it
 * to switch to template mode BEFORE sending, so the employee is told why rather
 * than watching a message fail — but the check is advisory, not a gate: Meta is
 * the authority, and a message that fails 131047 is still recorded as failed
 * with that reason.
 */
export function windowState(lastInboundAt: Date | string | null): WindowState {
  if (!lastInboundAt) return { open: false, expiresAt: null };
  const last = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(last)) return { open: false, expiresAt: null };
  const expires = last + WINDOW_MS;
  return { open: Date.now() < expires, expiresAt: new Date(expires).toISOString() };
}

// ════════════════════════════════════════════════════════════════════════════
// Message persistence
// ════════════════════════════════════════════════════════════════════════════

export interface RecordInboundInput {
  organizationId: string;
  conversationId: number;
  leadId: number | null;
  whatsappMessageId: string;
  messageType: string;
  text: string | null;
  media?: unknown;
  /** Meta sends unix SECONDS. */
  timestampUnix: number;
}

export interface RecordInboundResult {
  message: MessageRow | null;
  duplicate: boolean;
}

/**
 * Stores an inbound message, exactly once.
 *
 * ── Idempotency (spec §10) ──────────────────────────────────────────────────
 * ON CONFLICT DO NOTHING against uq_whatsapp_messages_wamid, not a
 * SELECT-then-INSERT. Meta retries deliveries, and two retries can be in flight
 * simultaneously across instances; a check-then-write would let both pass the
 * check before either wrote. The unique index is the only thing that holds under
 * concurrency, and `duplicate: true` here means the index did its job.
 *
 * The conversation counters are updated in the SAME transaction and only when a
 * row was actually inserted — otherwise a retried webhook would increment the
 * unread count again for a message the employee has already read.
 */
export async function recordInbound(
  i: RecordInboundInput,
  client?: PoolClient
): Promise<RecordInboundResult> {
  const run = async (c: PoolClient): Promise<RecordInboundResult> => {
    const at = new Date(
      Number.isFinite(i.timestampUnix) && i.timestampUnix > 0
        ? i.timestampUnix * 1000
        : Date.now()
    );

    const ins = await c.query<MessageRow>(
      `INSERT INTO public.whatsapp_messages
         (organization_id, conversation_id, lead_id, direction, message_type,
          message_text, media, whatsapp_message_id, status, sent_at, created_at)
       VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7, 'received', $8, $8)
       ON CONFLICT (organization_id, whatsapp_message_id)
         WHERE whatsapp_message_id IS NOT NULL
         DO NOTHING
       RETURNING *`,
      [
        i.organizationId,
        i.conversationId,
        i.leadId,
        i.messageType,
        i.text,
        i.media ? JSON.stringify(i.media) : null,
        i.whatsappMessageId,
        at,
      ]
    );

    if (ins.rows.length === 0) return { message: null, duplicate: true };

    const preview = previewOf(i.text, i.messageType);

    // GREATEST guards against an out-of-order delivery moving last_message_at
    // backwards and reordering the follow-ups list.
    await c.query(
      `UPDATE public.whatsapp_conversations
          SET unread_count            = unread_count + 1,
              last_message_at         = GREATEST(COALESCE(last_message_at, $2), $2),
              last_inbound_at         = GREATEST(COALESCE(last_inbound_at, $2), $2),
              last_message_preview    = CASE WHEN $2 >= COALESCE(last_message_at, $2)
                                             THEN $3 ELSE last_message_preview END,
              last_message_direction  = CASE WHEN $2 >= COALESCE(last_message_at, $2)
                                             THEN 'inbound' ELSE last_message_direction END,
              status                  = 'open',
              updated_at              = now()
        WHERE id = $1`,
      [i.conversationId, at, preview]
    );

    return { message: ins.rows[0], duplicate: false };
  };

  return client ? run(client) : transaction(run);
}

/** First line of a message, trimmed for the follow-ups list. */
export function previewOf(text: string | null, messageType = "text"): string {
  if (messageType !== "text" && !text) {
    return `[${messageType}]`;
  }
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return `[${messageType}]`;
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}

export interface CreateOutboundInput {
  organizationId: string;
  conversationId: number;
  leadId: number | null;
  senderUserId: number | null;
  senderName: string;
  senderRole: string;
  text: string | null;
  messageType?: string;
  templateName?: string | null;
  clientToken?: string | null;
}

/**
 * Creates the outbound row in 'sending' BEFORE the Meta call.
 *
 * The order matters and is the point of spec §3: a message that exists only
 * after a successful API call is a message that vanishes when the process dies
 * mid-send, leaving the employee believing nothing was sent while Meta may well
 * have delivered it. Writing first means every attempt is accounted for, and a
 * row stuck in 'sending' is a visible, retryable state rather than silence.
 */
export async function createOutbound(
  i: CreateOutboundInput,
  client?: PoolClient
): Promise<{ message: MessageRow; duplicate: boolean }> {
  const run = async (c: PoolClient) => {
    if (i.clientToken) {
      const dup = await c.query<MessageRow>(
        `SELECT * FROM public.whatsapp_messages
          WHERE organization_id = $1 AND client_token = $2`,
        [i.organizationId, i.clientToken]
      );
      if (dup.rows.length > 0) return { message: dup.rows[0], duplicate: true };
    }

    const ins = await c.query<MessageRow>(
      `INSERT INTO public.whatsapp_messages
         (organization_id, conversation_id, lead_id, direction, sender_user_id,
          sender_name, sender_role, message_type, message_text, template_name,
          client_token, status)
       VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, $9, $10, 'sending')
       RETURNING *`,
      [
        i.organizationId,
        i.conversationId,
        i.leadId,
        i.senderUserId,
        i.senderName,
        i.senderRole,
        i.messageType ?? "text",
        i.text,
        i.templateName ?? null,
        i.clientToken ?? null,
      ]
    );

    const preview = previewOf(i.text, i.messageType ?? "text");
    await c.query(
      `UPDATE public.whatsapp_conversations
          SET last_message_at        = now(),
              last_message_preview   = $2,
              last_message_direction = 'outbound',
              updated_at             = now()
        WHERE id = $1`,
      [i.conversationId, preview]
    );

    return { message: ins.rows[0], duplicate: false };
  };

  return client ? run(client) : transaction(run);
}

/** Attaches Meta's wamid once the send succeeds. */
export async function markOutboundSent(
  messageId: string | number,
  whatsappMessageId: string
): Promise<MessageRow | null> {
  const rows = await query<MessageRow>(
    `UPDATE public.whatsapp_messages
        SET whatsapp_message_id = $2,
            status   = CASE WHEN status = 'sending' THEN 'sent' ELSE status END,
            sent_at  = COALESCE(sent_at, now()),
            error_code = NULL, error_message = NULL, failed_at = NULL
      WHERE id = $1
      RETURNING *`,
    [messageId, whatsappMessageId]
  );
  return rows[0] ?? null;
}

/** Records a send failure with a reason the UI can show verbatim. */
export async function markOutboundFailed(
  messageId: string | number,
  code: string,
  message: string
): Promise<MessageRow | null> {
  const rows = await query<MessageRow>(
    `UPDATE public.whatsapp_messages
        SET status = 'failed', failed_at = now(), error_code = $2, error_message = $3
      WHERE id = $1
      RETURNING *`,
    [messageId, code.slice(0, 40), message.slice(0, 2000)]
  );
  return rows[0] ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// Delivery status  (spec §3)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Status ranking, for monotonic transitions.
 *
 * Meta does not guarantee webhook ordering, and in practice `delivered` arriving
 * after `read` is common — the receipts are generated on the handset and
 * batched. Applying them blindly makes a message that the customer has read
 * flicker back to a single tick.
 *
 * 'failed' is ranked above the delivery ladder but is only reachable from
 * pre-delivery states (see applyDeliveryStatus): a message that genuinely
 * reached the handset cannot later become a failure.
 */
const STATUS_RANK: Record<MessageStatus, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  received: 5,
};

export function isForwardTransition(from: MessageStatus, to: MessageStatus): boolean {
  if (from === "received" || to === "received") return false;
  if (to === "failed") return STATUS_RANK[from] < STATUS_RANK.delivered;
  return STATUS_RANK[to] > STATUS_RANK[from];
}

export interface DeliveryUpdate {
  whatsappMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestampUnix: number;
  errorCode?: number | null;
  errorTitle?: string | null;
}

export interface DeliveryResult {
  applied: boolean;
  message: MessageRow | null;
  conversationId: number | null;
  leadId: number | null;
}

/**
 * Applies one delivery receipt to a conversation message.
 *
 * Returns applied:false for a wamid we do not own — which is not an error. The
 * same Meta number also carries the notification_logs traffic (CP alerts), and
 * those receipts are handled by services/whatsapp.service.ts applyStatusUpdate.
 * Each handler ignores the other's ids.
 */
export async function applyDeliveryStatus(u: DeliveryUpdate): Promise<DeliveryResult> {
  return transaction(async (c) => {
    const found = await c.query<MessageRow>(
      `SELECT * FROM public.whatsapp_messages
        WHERE whatsapp_message_id = $1 AND direction = 'outbound'
        LIMIT 1`,
      [u.whatsappMessageId]
    );
    if (found.rows.length === 0) {
      return { applied: false, message: null, conversationId: null, leadId: null };
    }

    const row = found.rows[0];
    if (!isForwardTransition(row.status, u.status)) {
      return {
        applied: false,
        message: row,
        conversationId: row.conversation_id,
        leadId: row.lead_id,
      };
    }

    const at = new Date(
      Number.isFinite(u.timestampUnix) && u.timestampUnix > 0
        ? u.timestampUnix * 1000
        : Date.now()
    );

    const col =
      u.status === "sent" ? "sent_at"
      : u.status === "delivered" ? "delivered_at"
      : u.status === "read" ? "read_at"
      : "failed_at";

    const updated = await c.query<MessageRow>(
      `UPDATE public.whatsapp_messages
          SET status = $2,
              ${col} = COALESCE(${col}, $3),
              error_code    = COALESCE($4, error_code),
              error_message = COALESCE($5, error_message)
        WHERE id = $1
        RETURNING *`,
      [
        row.id,
        u.status,
        at,
        u.errorCode != null ? String(u.errorCode) : null,
        u.errorTitle ?? null,
      ]
    );

    return {
      applied: true,
      message: updated.rows[0],
      conversationId: row.conversation_id,
      leadId: row.lead_id,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Unread
// ════════════════════════════════════════════════════════════════════════════

/**
 * Clears a thread's unread count.
 *
 * Deliberately a whole-thread reset rather than per-message read receipts.
 * Per-user read state would need its own table and would answer a question
 * nobody in this CRM asks — the follow-ups list shows one badge per
 * conversation, and a thread one colleague has read is read.
 *
 * Returns the new count so the caller can broadcast it without a second query.
 */
export async function markConversationRead(
  organizationId: string,
  conversationId: number
): Promise<number | null> {
  const rows = await query<{ unread_count: number }>(
    `UPDATE public.whatsapp_conversations
        SET unread_count = 0, updated_at = now()
      WHERE id = $1 AND organization_id = $2
      RETURNING unread_count`,
    [conversationId, organizationId]
  );
  return rows.length > 0 ? rows[0].unread_count : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Association  (spec §5)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Attaches an unmatched or ambiguous thread to a lead.
 *
 * Backfills lead_id onto the thread's existing messages so the lead's audit
 * trail is complete from the customer's first word, not from the moment an admin
 * happened to notice.
 *
 * Refuses to re-point an already-matched thread. Moving a live conversation
 * between leads would rewrite history that a dispute may later turn on; a
 * mis-association has to be corrected deliberately, by unmatching first.
 */
export async function associateConversation(args: {
  organizationId: string;
  conversationId: number;
  leadId: number;
}): Promise<{ ok: true; conversation: ConversationRow } | { ok: false; reason: string }> {
  return transaction(async (c) => {
    const conv = await c.query<ConversationRow>(
      `SELECT * FROM public.whatsapp_conversations
        WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [args.conversationId, args.organizationId]
    );
    if (conv.rows.length === 0) return { ok: false as const, reason: "not_found" };
    if (conv.rows[0].match_state === "matched") {
      return { ok: false as const, reason: "already_matched" };
    }

    // The lead must belong to the same tenant. Without this check an admin could
    // pass any lead id and attach a conversation across organizations.
    const lead = await c.query<{ id: number }>(
      `SELECT id FROM public.walkin_enquiries WHERE id = $1 AND organization_id = $2`,
      [args.leadId, args.organizationId]
    );
    if (lead.rows.length === 0) return { ok: false as const, reason: "lead_not_found" };

    const updated = await c.query<ConversationRow>(
      `UPDATE public.whatsapp_conversations
          SET lead_id = $2, match_state = 'matched', updated_at = now()
        WHERE id = $1 RETURNING *`,
      [args.conversationId, args.leadId]
    );

    await c.query(
      `UPDATE public.whatsapp_messages SET lead_id = $2 WHERE conversation_id = $1`,
      [args.conversationId, args.leadId]
    );

    return { ok: true as const, conversation: updated.rows[0] };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Broadcast visibility
// ════════════════════════════════════════════════════════════════════════════

/**
 * The ownership facts an SSE broadcast needs, in one round trip.
 *
 * Fetched once per broadcast rather than once per open stream: a tenant may have
 * twenty dashboards connected, and asking the database who owns the lead twenty
 * times to answer the same question would make every inbound message twenty
 * round trips at 82ms each.
 */
export async function loadVisibility(
  organizationId: string,
  conversationId: number,
  client?: PoolClient
): Promise<{
  leadId: number | null;
  matchState: string;
  assignedTo: string | null;
  assignedReceptionist: string | null;
  overseeingSiteHead: string | null;
}> {
  const sql = `SELECT c.lead_id, c.match_state,
                      l.assigned_to, l.assigned_receptionist, l.overseeing_site_head
                 FROM public.whatsapp_conversations c
                 LEFT JOIN public.walkin_enquiries l ON l.id = c.lead_id
                WHERE c.id = $1 AND c.organization_id = $2`;
  const rows = client
    ? (await client.query(sql, [conversationId, organizationId])).rows
    : await query<any>(sql, [conversationId, organizationId]);

  if (rows.length === 0) {
    // Fail closed: a conversation we cannot resolve is shown to nobody but the
    // roles that can see unmatched threads.
    return {
      leadId: null,
      matchState: "unmatched",
      assignedTo: null,
      assignedReceptionist: null,
      overseeingSiteHead: null,
    };
  }
  const r = rows[0];
  return {
    leadId: r.lead_id,
    matchState: r.match_state,
    assignedTo: r.assigned_to,
    assignedReceptionist: r.assigned_receptionist,
    overseeingSiteHead: r.overseeing_site_head,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Webhook failure log  (spec §10)
// ════════════════════════════════════════════════════════════════════════════

export async function logWebhookFailure(i: {
  phoneNumberId?: string | null;
  organizationId?: string | null;
  reason: string;
  detail?: string | null;
  payload?: unknown;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO public.whatsapp_webhook_failures
         (phone_number_id, organization_id, reason, detail, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        i.phoneNumberId ?? null,
        i.organizationId ?? null,
        i.reason.slice(0, 64),
        i.detail ? i.detail.slice(0, 4000) : null,
        i.payload ? JSON.stringify(i.payload) : null,
      ]
    );
  } catch (err) {
    // The failure log must never be the reason a webhook fails. If it cannot be
    // written, the console is the last resort.
    console.error("[whatsapp] could not write webhook failure log:", (err as Error).message);
  }
}
