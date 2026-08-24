// webhooks/whatsappInbound.ts — turning Meta's inbound envelope into CRM messages.
//
// Split from whatsapp.webhook.ts, which was written when the module only handled
// delivery receipts: its countInbound() counted customer messages and threw them
// away. This is the half that keeps them.
//
// Framework-free, like its sibling — no next/* import — so the whole inbound path
// can be driven from a node script with synthetic payloads. That is not a
// convenience: the webhook cannot otherwise be tested at all without a public URL
// and a real customer sending real messages.
//
// ── Defensive parsing ───────────────────────────────────────────────────────
// Every level is optional-chained and Array.isArray-guarded, for the same reason
// the status parser is: Meta ships new `field` values and new nesting without
// notice, and a webhook that throws on an unrecognised shape earns enough non-2xx
// responses to have its subscription disabled.

import { redactDeep } from "@/config/whatsapp.config";
import { toE164 } from "@/lib/phone";
import {
  ensureConversation,
  loadVisibility,
  logWebhookFailure,
  organizationForPhoneNumberId,
  recordInbound,
} from "@/lib/whatsappConversations";
import { broadcastWhatsAppEvent } from "@/lib/whatsappEvents";
import { query } from "@/lib/db";

/** One customer message, flattened out of the envelope. */
export interface ParsedInboundMessage {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  from: string;
  waId: string | null;
  profileName: string | null;
  messageId: string;
  timestampUnix: number;
  type: string;
  text: string | null;
  media: Record<string, unknown> | null;
}

/**
 * Extracts the human-readable content of a message.
 *
 * Only `text` and the two caption-bearing types produce body text. Everything
 * else keeps its payload in `media` and renders as a type chip in the UI — the
 * schema has a media column and the composer has no attachment button, which is
 * the honest state of things: spec §12 asks for the architecture to be ready for
 * images and documents, not for them to be half-implemented.
 *
 * `button` and `interactive` are unwrapped because they ARE text from the
 * customer's point of view — tapping a quick-reply button on a template is how
 * many customers answer, and showing "[button]" instead of "Yes, tomorrow works"
 * would make the conversation unreadable.
 */
function extractContent(m: any): { text: string | null; media: Record<string, unknown> | null } {
  const type = String(m?.type ?? "");

  switch (type) {
    case "text":
      return { text: typeof m?.text?.body === "string" ? m.text.body : null, media: null };

    case "button":
      return { text: typeof m?.button?.text === "string" ? m.button.text : null, media: null };

    case "interactive": {
      const i = m?.interactive ?? {};
      const title = i?.button_reply?.title ?? i?.list_reply?.title;
      return { text: typeof title === "string" ? title : null, media: null };
    }

    case "image":
    case "video":
    case "document":
    case "audio":
    case "sticker": {
      const payload = m?.[type] ?? {};
      const caption = typeof payload?.caption === "string" ? payload.caption : null;
      return {
        text: caption,
        media: {
          id: payload?.id ?? null,
          mime_type: payload?.mime_type ?? null,
          sha256: payload?.sha256 ?? null,
          filename: payload?.filename ?? null,
        },
      };
    }

    case "location":
      return {
        text: typeof m?.location?.name === "string" ? m.location.name : null,
        media: {
          latitude: m?.location?.latitude ?? null,
          longitude: m?.location?.longitude ?? null,
          address: m?.location?.address ?? null,
        },
      };

    case "reaction":
      return {
        text: typeof m?.reaction?.emoji === "string" ? m.reaction.emoji : null,
        media: { reacted_to: m?.reaction?.message_id ?? null },
      };

    default:
      return { text: null, media: null };
  }
}

/** Pulls every inbound message out of a webhook payload. */
export function parseInbound(payload: unknown): ParsedInboundMessage[] {
  const out: ParsedInboundMessage[] = [];
  const root = payload as any;
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      if (messages.length === 0) continue;

      const phoneNumberId = value?.metadata?.phone_number_id;
      if (typeof phoneNumberId !== "string" || !phoneNumberId) continue;

      // contacts[] carries the WhatsApp profile name. It is keyed by wa_id, but
      // in practice one change carries one contact; the lookup falls back to the
      // first entry so a mismatch does not lose the name.
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

      for (const m of messages) {
        const id = typeof m?.id === "string" ? m.id : null;
        const from = typeof m?.from === "string" ? m.from : null;
        if (!id || !from) continue;

        const contact =
          contacts.find((c: any) => c?.wa_id === from) ?? contacts[0] ?? null;

        const { text, media } = extractContent(m);

        out.push({
          phoneNumberId,
          displayPhoneNumber:
            typeof value?.metadata?.display_phone_number === "string"
              ? value.metadata.display_phone_number
              : null,
          from,
          waId: typeof contact?.wa_id === "string" ? contact.wa_id : from,
          profileName:
            typeof contact?.profile?.name === "string" ? contact.profile.name : null,
          messageId: id,
          // Meta sends unix SECONDS as a string.
          timestampUnix: Number.isFinite(Number(m?.timestamp))
            ? Number(m.timestamp)
            : Math.floor(Date.now() / 1000),
          type: String(m?.type ?? "unknown"),
          text,
          media,
        });
      }
    }
  }

  return out;
}

export interface InboundOutcome {
  stored: number;
  duplicates: number;
  unroutable: number;
  failed: number;
}

/**
 * Persists a batch of inbound messages and pushes them to connected dashboards.
 *
 * Each message is processed independently and its failure is contained: one
 * unparseable number in a batch of five must not cost the other four, because
 * Meta will not resend the ones that worked.
 */
export async function processInbound(
  messages: ParsedInboundMessage[],
  rawPayload?: unknown
): Promise<InboundOutcome> {
  const outcome: InboundOutcome = { stored: 0, duplicates: 0, unroutable: 0, failed: 0 };

  for (const m of messages) {
    try {
      // ── Tenant ───────────────────────────────────────────────────────────
      const organizationId = await organizationForPhoneNumberId(m.phoneNumberId);
      if (!organizationId) {
        outcome.unroutable += 1;
        await logWebhookFailure({
          phoneNumberId: m.phoneNumberId,
          reason: "unmapped_number",
          detail:
            `No organization is mapped to phone_number_id ${m.phoneNumberId}. ` +
            `Run: node scripts/seed_whatsapp_number.cjs <organization-slug>`,
          payload: redactDeep(rawPayload ?? m),
        });
        continue;
      }

      // ── Normalize the customer's number ──────────────────────────────────
      const norm = toE164(m.from);
      if (!norm.ok) {
        outcome.failed += 1;
        await logWebhookFailure({
          phoneNumberId: m.phoneNumberId,
          organizationId,
          reason: "bad_phone",
          detail: `Could not normalize inbound number: ${norm.reason}`,
          payload: redactDeep(m),
        });
        continue;
      }

      // ── Thread + matching ────────────────────────────────────────────────
      const { conversation } = await ensureConversation({
        organizationId,
        phoneNumberId: m.phoneNumberId,
        phoneRaw: norm.e164,
        profileName: m.profileName,
        waId: m.waId,
      });

      // ── Store, exactly once ──────────────────────────────────────────────
      const { message, duplicate } = await recordInbound({
        organizationId,
        conversationId: conversation.id,
        leadId: conversation.lead_id,
        whatsappMessageId: m.messageId,
        messageType: m.type,
        text: m.text,
        media: m.media,
        timestampUnix: m.timestampUnix,
      });

      if (duplicate || !message) {
        outcome.duplicates += 1;
        continue;
      }
      outcome.stored += 1;

      // ── Push (spec §4, §7) ───────────────────────────────────────────────
      const fresh = await query<{
        unread_count: number;
        last_message_preview: string | null;
        last_message_at: Date | null;
        match_state: string;
      }>(
        `SELECT unread_count, last_message_preview, last_message_at, match_state
           FROM public.whatsapp_conversations WHERE id = $1`,
        [conversation.id]
      );
      const unread = fresh[0]?.unread_count ?? 0;

      const visibility = await loadVisibility(organizationId, conversation.id);

      broadcastWhatsAppEvent(
        organizationId,
        {
          type: "message_created",
          conversationId: conversation.id,
          leadId: visibility.leadId,
          message,
          unreadCount: unread,
          ts: Date.now(),
        },
        visibility
      );

      // A second event for the follow-ups list, which re-sorts and re-badges on
      // conversation state rather than on message contents.
      broadcastWhatsAppEvent(
        organizationId,
        {
          type: "conversation_updated",
          conversationId: conversation.id,
          leadId: visibility.leadId,
          unreadCount: unread,
          lastMessagePreview: fresh[0]?.last_message_preview ?? null,
          lastMessageAt: fresh[0]?.last_message_at
            ? new Date(fresh[0].last_message_at).toISOString()
            : null,
          lastMessageDirection: "inbound",
          matchState: fresh[0]?.match_state ?? visibility.matchState,
          ts: Date.now(),
        },
        visibility
      );
    } catch (err) {
      outcome.failed += 1;
      await logWebhookFailure({
        phoneNumberId: m.phoneNumberId,
        reason: "processing_error",
        detail: (err as Error)?.message ?? String(err),
        payload: redactDeep(m),
      });
    }
  }

  return outcome;
}
