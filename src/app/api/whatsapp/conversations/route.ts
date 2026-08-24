// api/whatsapp/conversations/route.ts
//
// GET  — the conversation list behind the Follow-ups screen (spec §6).
// POST — open (or create) the thread for a lead, which is what the WhatsApp
//        button on a lead does.
//
// Both are permission-scoped through lib/whatsappAccess.ts. Neither accepts an
// organization or a role from the caller.

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import {
  conversationScope,
  leadScope,
  canAssociateConversations,
  type Viewer,
} from "@/lib/whatsappAccess";
import { ensureConversation, windowState } from "@/lib/whatsappConversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function viewerFrom(
  gate: Extract<Awaited<ReturnType<typeof requireSession>>, { ok: true }>
): Promise<Viewer> {
  return {
    userId: gate.userId,
    name: gate.session.name || gate.session.email || "",
    role: gate.session.role,
    organizationId: await getOrganizationId(),
  };
}

/**
 * The list.
 *
 * Everything the Follow-ups row needs (spec §6) comes from this one query:
 * last message, its timestamp, who sent it, unread count, conversation status,
 * follow-up date and assigned employee. The alternative — a conversation list
 * plus a per-row lookup for the lead's follow-up date — would be one round trip
 * per row at 82ms each.
 */
export async function GET(req: Request) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const viewer = await viewerFrom(gate);
  const url = new URL(req.url);

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 200);
  const filter = url.searchParams.get("filter"); // "unread" | "needs_review" | null
  const search = (url.searchParams.get("q") ?? "").trim();

  const params: unknown[] = [viewer.organizationId];
  const scope = conversationScope(viewer, params.length + 1, "c", "l");
  params.push(...scope.params);

  const where: string[] = [`c.organization_id = $1`, scope.sql];

  if (filter === "unread") where.push(`c.unread_count > 0`);
  if (filter === "needs_review") {
    if (!canAssociateConversations(viewer.role)) {
      return NextResponse.json({ success: true, data: [] });
    }
    where.push(`c.match_state <> 'matched'`);
  }

  if (search) {
    const p = params.length + 1;
    params.push(`%${search}%`);
    where.push(
      `(l.name ILIKE $${p} OR c.customer_phone ILIKE $${p} OR c.customer_profile_name ILIKE $${p})`
    );
  }

  const limitParam = params.length + 1;
  params.push(limit);

  const rows = await query<any>(
    `SELECT c.id,
            c.lead_id                                AS "leadId",
            c.customer_phone                         AS "customerPhone",
            c.customer_profile_name                  AS "customerProfileName",
            c.match_state                            AS "matchState",
            c.candidate_lead_ids                     AS "candidateLeadIds",
            c.status,
            c.unread_count                           AS "unreadCount",
            c.last_message_at                        AS "lastMessageAt",
            c.last_message_preview                   AS "lastMessagePreview",
            c.last_message_direction                 AS "lastMessageDirection",
            c.last_inbound_at                        AS "lastInboundAt",
            l.name                                   AS "leadName",
            l.phone                                  AS "leadPhone",
            l.assigned_to                            AS "assignedTo",
            l.status                                 AS "leadStatus",
            l.followup_date                          AS "followUpDate",
            COALESCE(l.is_lost_lead, false)          AS "leadIsLost",
            u.name                                   AS "assignedUserName"
       FROM public.whatsapp_conversations c
       LEFT JOIN public.walkin_enquiries l ON l.id = c.lead_id
       LEFT JOIN public.users u            ON u.id = c.assigned_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
      LIMIT $${limitParam}`,
    params
  );

  return NextResponse.json({
    success: true,
    data: rows.map((r) => ({ ...r, window: windowState(r.lastInboundAt) })),
  });
}

/**
 * Open the thread for a lead, creating it if the customer has never written.
 *
 * Creating on open is what lets an employee start a conversation from the CRM at
 * all — the alternative is a thread that only exists once the customer has
 * messaged first, which inverts the workflow this feature is for.
 *
 * The lead is re-read from the database under the caller's own visibility rules
 * rather than trusted from the request: `leadId` is client input, and without
 * this check any signed-in user could open a thread against any lead in the
 * tenant, including one they cannot see.
 */
export async function POST(req: Request) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  const viewer = await viewerFrom(gate);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const leadId = Number(body?.leadId);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return NextResponse.json({ success: false, message: "leadId is required." }, { status: 400 });
  }

  const params: unknown[] = [viewer.organizationId, leadId];
  const scope = leadScope(viewer, params.length + 1, "l");
  params.push(...scope.params);

  const leadRows = await query<any>(
    `SELECT l.id, l.name, l.phone, l.alt_phone, l.assigned_to
       FROM public.walkin_enquiries l
      WHERE l.organization_id = $1 AND l.id = $2 AND ${scope.sql}`,
    params
  );

  if (leadRows.length === 0) {
    // 404 rather than 403, deliberately: telling a caller that a lead exists but
    // is not theirs confirms the id, which is how a lead table gets enumerated.
    return NextResponse.json({ success: false, message: "Lead not found." }, { status: 404 });
  }

  const lead = leadRows[0];
  const phone = String(body?.phone ?? lead.phone ?? "").trim();
  if (!phone) {
    return NextResponse.json(
      { success: false, message: "This lead has no phone number." },
      { status: 400 }
    );
  }

  // Which business number the tenant sends from. One row per tenant today.
  const numbers = await query<{ phone_number_id: string }>(
    `SELECT phone_number_id FROM public.whatsapp_business_numbers
      WHERE organization_id = $1 AND is_active = true
      ORDER BY id LIMIT 1`,
    [viewer.organizationId]
  );
  if (numbers.length === 0) {
    return NextResponse.json(
      {
        success: false,
        code: "NO_BUSINESS_NUMBER",
        message:
          "No WhatsApp business number is mapped to this organization. " +
          "Run scripts/seed_whatsapp_number.cjs to map one.",
      },
      { status: 503 }
    );
  }

  try {
    const { conversation } = await ensureConversation({
      organizationId: viewer.organizationId,
      phoneNumberId: numbers[0].phone_number_id,
      phoneRaw: phone,
    });

    return NextResponse.json({
      success: true,
      data: { id: conversation.id, leadId: conversation.lead_id },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: (err as Error).message },
      { status: 400 }
    );
  }
}
