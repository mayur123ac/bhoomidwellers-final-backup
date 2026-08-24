// api/whatsapp/conversations/_access.ts — shared gate for the per-conversation routes.
//
// Four routes (read, send, mark-read, associate) all need the same three steps:
// authenticate, resolve the viewer, and load the conversation ONLY if this viewer
// may see it. Writing that out four times is how one of them ends up missing the
// third step.
//
// The underscore prefix keeps it out of Next's route table — App Router only
// treats route.ts/page.tsx as endpoints, but the prefix makes the intent obvious
// to a reader.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { conversationScope, type Viewer } from "@/lib/whatsappAccess";

export interface ConversationContext {
  viewer: Viewer;
  conversation: {
    id: number;
    lead_id: number | null;
    customer_phone: string;
    customer_profile_name: string | null;
    phone_number_id: string;
    match_state: string;
    candidate_lead_ids: number[];
    unread_count: number;
    last_inbound_at: Date | null;
    lead_name: string | null;
    lead_phone: string | null;
    assigned_to: string | null;
  };
}

export type ConversationGate =
  | ({ ok: true } & ConversationContext)
  | { ok: false; response: NextResponse };

/**
 * Loads one conversation, or refuses.
 *
 * The visibility predicate is part of the WHERE clause rather than a check on the
 * returned row. That ordering matters: a row fetched first and rejected second
 * has already been read, and every later edit to this file is one `return` away
 * from leaking it.
 *
 * A conversation the viewer may not see returns 404, not 403 — a 403 would
 * confirm that a conversation with that id exists.
 */
export async function requireConversation(idRaw: string): Promise<ConversationGate> {
  const gate = await requireSession();
  if (!gate.ok) return { ok: false, response: gate.response };

  const viewer: Viewer = {
    userId: gate.userId,
    name: gate.session.name || gate.session.email || "",
    role: gate.session.role,
    organizationId: await getOrganizationId(),
  };

  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Invalid conversation id." },
        { status: 400 }
      ),
    };
  }

  const params: unknown[] = [viewer.organizationId, id];
  const scope = conversationScope(viewer, params.length + 1, "c", "l");
  params.push(...scope.params);

  const rows = await query<any>(
    `SELECT c.id, c.lead_id, c.customer_phone, c.customer_profile_name,
            c.phone_number_id, c.match_state, c.candidate_lead_ids,
            c.unread_count, c.last_inbound_at,
            l.name  AS lead_name,
            l.phone AS lead_phone,
            l.assigned_to
       FROM public.whatsapp_conversations c
       LEFT JOIN public.walkin_enquiries l ON l.id = c.lead_id
      WHERE c.organization_id = $1 AND c.id = $2 AND ${scope.sql}`,
    params
  );

  if (rows.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Conversation not found." },
        { status: 404 }
      ),
    };
  }

  return { ok: true, viewer, conversation: rows[0] };
}
