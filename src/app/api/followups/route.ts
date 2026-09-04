// app/api/followups/route.ts
import { NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import { jsonCompressed } from "@/lib/apiResponse";
import { requireSession, requireRoles } from "@/lib/serverAuth";
import { broadcastFollowUp, type FollowUpPayload } from "@/lib/followUpEvents";
import { broadcastToOrg } from "@/lib/supabase/broadcast";

/**
 * GET follow-ups.
 *
 * ── Two changes for scale, neither of which alters the response shape ────────
 *
 * 1. The camelCase renaming is done in SQL rather than by a JS .map() over the
 *    result set. The old code allocated one fresh object per row: at 400,000
 *    follow-ups that is 400,000 allocations and a second full pass over the data
 *    on every single request, purely to rename five keys. `pg` builds the row
 *    objects once; aliasing lets us keep them.
 *
 * 2. `?lead_id=` returns one lead's follow-ups instead of the whole table.
 *    Backed by idx_follow_ups_lead_id_created_at, that is an index scan touching
 *    7 pages instead of a 400,000-row sequential read — measured at 0.03 ms vs
 *    1,579 ms. Callers that need a single lead's timeline should use it.
 *
 * The unfiltered form is retained because the admin dashboard genuinely needs
 * every follow-up: it derives per-lead fields for the whole table client-side and
 * renders timelines from the same array. Narrowing it would change what those
 * views can show, which is a behavioural change, not an optimisation. It IS
 * gzip-compressed (see next.config.ts) — the messages are highly repetitive, so
 * the wire cost is a fraction of the raw size.
 */
const SELECT_COLUMNS = `
  SELECT id::text                            AS "_id",
         lead_id::text                       AS "leadId",
         COALESCE(created_by_name, '')        AS "salesManagerName",
         -- NULLIF before COALESCE, deliberately: the JS this replaced used
         -- created_by_name || "sales", and || treats an empty string as absent.
         -- A bare COALESCE would keep '' and change the value the UI displays.
         COALESCE(NULLIF(created_by_name, ''), 'sales') AS "createdBy",
         message,
         NULLIF(site_visit_date, '')          AS "siteVisitDate",
         created_at                           AS "createdAt",
         -- Internal messaging (receptionist → sales manager). 'note' is every
         -- pre-existing row and renders exactly as before; the timeline only
         -- treats a row differently when this says so.
         COALESCE(follow_up_type, 'note')     AS "followUpType",
         created_by_role                      AS "createdByRole",
         sent_to_role                         AS "sentToRole",
         sent_to_user_id                      AS "sentToUserId",
         parent_follow_up_id                  AS "parentFollowUpId",
         read_at                              AS "readAt"
    FROM follow_ups`;

/* ── Internal messaging (receptionist ⇄ assigned sales manager) ──────────────
   Scoped to ONE lead, always. There is no inbox and no global thread: a message
   is a follow-up row on the lead it is about, visible to everyone who can see
   that lead, and permanent.

   Identity note: walkin_enquiries stores assignments as NAMES
   (assigned_to = the sales manager's name, assigned_receptionist = the
   receptionist's name), not ids. Ownership is therefore compared on name, and
   the recipient's users.id is resolved once at send time and frozen into
   sent_to_user_id — so renaming a user later cannot silently re-address history.
   ──────────────────────────────────────────────────────────────────────────── */

const normalizeRoleName = (r: unknown) =>
  String(r ?? "").trim().toLowerCase().replace(/_/g, " ");

const MAX_MESSAGE_LENGTH = 500;

async function handleInternalMessage(
  type: "internal_message" | "sm_reply",
  body: any,
  gate: Extract<Awaited<ReturnType<typeof requireSession>>, { ok: true }>
) {
  const leadId = Number(body.leadId);
  const text = String(body.message ?? "").trim();
  const role = normalizeRoleName(gate.session.role);
  const actorName = gate.session.name || gate.session.email || "unknown";

  if (!leadId || !text) {
    return NextResponse.json(
      { success: false, message: "leadId and message are required" },
      { status: 400 }
    );
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { success: false, message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  const leadRows = await query<any>(
    `SELECT id, name, assigned_to, assigned_receptionist FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
    [leadId, await getOrganizationId()]
  );
  if (leadRows.length === 0) {
    return NextResponse.json({ success: false, message: "Lead not found" }, { status: 404 });
  }
  const lead = leadRows[0];

  // ── Receptionist → Sales Manager ──
  if (type === "internal_message") {
    if (role !== "receptionist") {
      return NextResponse.json(
        { success: false, error: "FORBIDDEN", message: "Only receptionists can send internal messages." },
        { status: 403 }
      );
    }
    // No per-lead receptionist ownership check, deliberately.
    //
    // walkin_enquiries.assigned_receptionist is only written when a receptionist
    // SELF-ASSIGNS an enquiry — and in that case they are also assigned_to, so
    // there is no separate sales manager to message. It is NULL on all 144
    // existing leads, every one of which has a sales manager. Gating on it would
    // 403 every send the feature exists for.
    //
    // The rule is therefore "a receptionist, on a lead that has a sales
    // manager". That matches the desk: whoever is on duty when the customer
    // walks in is the person who needs to pass the message on. Accountability is
    // not lost — created_by_name records exactly who sent it, permanently.
    if (!String(lead.assigned_to || "").trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "NO_SALES_MANAGER",
          message: "This lead has no assigned sales manager to message. Contact admin to assign one.",
        },
        { status: 400 }
      );
    }

    const smRows = await query<{ id: number; name: string }>(
      // Resolving a person by NAME, which is not unique — and across tenants it is
      // very much not unique. The organization predicate is inside the WHERE, ahead
      // of ORDER BY/LIMIT 1, so a same-named manager in another tenant cannot win
      // the pick and receive this lead's internal message.
      `SELECT id, name FROM users
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
          AND organization_id = $2
          AND is_active = true
        ORDER BY id LIMIT 1`,
      [lead.assigned_to, await getOrganizationId()]
    );
    // No usable recipient means no one would ever be notified — better to refuse
    // than to write a message addressed to nobody.
    if (smRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "SALES_MANAGER_NOT_FOUND",
          message: `Could not resolve an active user account for sales manager "${lead.assigned_to}". Contact admin.`,
        },
        { status: 400 }
      );
    }
    const sm = smRows[0];

    const imOrgId = await getOrganizationId();
    const rows = await query<any>(
      `INSERT INTO follow_ups
         (lead_id, message, created_by_name, created_by_id, created_by_role,
          follow_up_type, sent_to_role, sent_to_user_id, read_at,
          organization_id)
       VALUES ($1, $2, $3, $6, 'receptionist', 'internal_message', 'sales_manager', $4, NULL, $5)
       RETURNING id, created_at`,
      [leadId, text, actorName, sm.id, imOrgId, gate.userId]
    );

    const imFollowUp = {
        _id: String(rows[0].id),
        leadId: String(leadId),
        salesManagerName: actorName,
        createdBy: actorName,
        message: text,
        siteVisitDate: null,
        createdAt: rows[0].created_at,
        followUpType: "internal_message",
        createdByRole: "receptionist",
        sentToRole: "sales_manager",
        sentToUserId: sm.id,
        parentFollowUpId: null,
        readAt: null,
    };
    broadcastFollowUp(imOrgId, { type: "followup:created", followUp: imFollowUp });
    broadcastToOrg(imOrgId, "followup.created", { followUp: imFollowUp });

    return NextResponse.json(
      {
        success: true,
        follow_up_id: rows[0].id,
        sent_to: sm.name,
        createdAt: rows[0].created_at,
        message: `Message sent to ${sm.name}`,
      },
      { status: 201 }
    );
  }

  // ── Sales Manager reply ──
  if (role !== "sales manager" && role !== "admin") {
    return NextResponse.json(
      { success: false, error: "FORBIDDEN", message: "Only the addressed sales manager can reply." },
      { status: 403 }
    );
  }

  const parentId = Number(body.parent_follow_up_id);
  if (!parentId) {
    return NextResponse.json(
      { success: false, message: "parent_follow_up_id is required for a reply" },
      { status: 400 }
    );
  }

  const parentRows = await query<any>(
    `SELECT id, sent_to_user_id, created_by_name
       FROM follow_ups
      WHERE id = $1 AND lead_id = $2 AND follow_up_type = 'internal_message'
        AND organization_id = $3`,
    [parentId, leadId, await getOrganizationId()]
  );
  if (parentRows.length === 0) {
    return NextResponse.json(
      { success: false, message: "Original message not found on this lead" },
      { status: 404 }
    );
  }
  const parent = parentRows[0];

  // Only the addressed manager may reply — another sales manager viewing the
  // same lead can read the thread but is not part of it. Admin is excluded here
  // too: admins read everything and add their own notes instead (see the UI,
  // which never renders Reply for them).
  if (Number(parent.sent_to_user_id) !== Number(gate.userId)) {
    return NextResponse.json(
      { success: false, error: "NOT_ADDRESSED_TO_YOU", message: "This message was not addressed to you" },
      { status: 403 }
    );
  }

  const smReplyOrgId = await getOrganizationId();
  const inserted = await transaction(async (client) => {
    const r = await client.query(
      `INSERT INTO follow_ups
         (lead_id, message, created_by_name, created_by_id, created_by_role,
          follow_up_type, parent_follow_up_id,
          organization_id)
       VALUES ($1, $2, $3, $6, 'sales_manager', 'sm_reply', $4, $5)
       RETURNING id, created_at`,
      [leadId, text, actorName, parentId, smReplyOrgId, gate.userId]
    );
    // Replying is reading — the badge must not keep claiming it is unread.
    await client.query(
      `UPDATE follow_ups SET read_at = NOW() WHERE id = $1 AND read_at IS NULL AND organization_id = $2`,
      [parentId, smReplyOrgId]
    );
    return r.rows[0];
  });

  const smReplyFollowUp = {
      _id: String(inserted.id),
      leadId: String(leadId),
      salesManagerName: actorName,
      createdBy: actorName,
      message: text,
      siteVisitDate: null,
      createdAt: inserted.created_at,
      followUpType: "sm_reply",
      createdByRole: "sales_manager",
      sentToRole: null,
      sentToUserId: null,
      parentFollowUpId: parentId,
      readAt: null,
  };
  broadcastFollowUp(smReplyOrgId, { type: "followup:created", followUp: smReplyFollowUp });
  broadcastToOrg(smReplyOrgId, "followup.created", { followUp: smReplyFollowUp });

  return NextResponse.json(
    {
      success: true,
      follow_up_id: inserted.id,
      parent_follow_up_id: parentId,
      sent_to: parent.created_by_name,
      createdAt: inserted.created_at,
      message: `Reply sent to ${parent.created_by_name}`,
    },
    { status: 201 }
  );
}

export async function GET(req: Request) {
  try {
    // Every follow-up note for every lead.
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const leadId = new URL(req.url).searchParams.get("lead_id");

    // Both branches are organization-scoped. The second branch is "every
    // follow-up note for every lead" — unscoped it returns the entire table
    // across every organization, which is the single largest leak in this route.
    const orgId = await getOrganizationId();
    const data = leadId
      ? await query(
          `${SELECT_COLUMNS} WHERE lead_id = $1 AND organization_id = $2 ORDER BY created_at ASC`,
          [leadId, orgId]
        )
      : await query(`${SELECT_COLUMNS} WHERE organization_id = $1 ORDER BY created_at ASC`, [orgId]);

    // Compressed: this is the single largest response the app produces.
    return jsonCompressed(req, { success: true, data }, { status: 200 });
  } catch (error) {
    console.error("GET followups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

// POST: Save a new follow-up message
export async function POST(req: Request) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const { leadId, salesManagerName, createdBy, message, siteVisitDate } = body;

    // ── Internal messaging branch ────────────────────────────────────────────
    // Two new follow-up kinds share this route because they ARE follow-ups: the
    // whole point is one permanent record per lead, not a second message store.
    // Anything without follow_up_type falls through to the original behaviour
    // untouched, so every existing caller is unaffected.
    const requestedType = String(body.follow_up_type || "").trim();
    if (requestedType === "internal_message" || requestedType === "sm_reply") {
      return await handleInternalMessage(requestedType, body, gate);
    }

    if (!leadId || !message) {
      return NextResponse.json(
        { success: false, message: "Missing fields: leadId and message are required" },
        { status: 400 }
      );
    }

    // The lead must exist — a follow-up against a missing id is orphaned data.
    //
    // Deliberately NOT gated on Closing/Lost. A closed or lost lead still has a
    // life: payments land, banks call back, a lost lead resurfaces. Notes are a
    // record of what happened, not an edit to the deal, so blocking them lost
    // information without protecting anything. The final-state lock stays where
    // it changes the deal itself — /api/loan, /api/sales-form-submit and
    // /api/site-visits all still refuse, and the Salesform/Loan buttons stay
    // hidden behind isLeadLocked in the UI.
    const leadRows = await query(
      `SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
      [leadId, await getOrganizationId()]
    );
    if (leadRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lead not found" },
        { status: 404 }
      );
    }

    const orgId = await getOrganizationId();
    const clientMsgId = body.clientMessageId ? String(body.clientMessageId) : null;

    // ON CONFLICT on the partial unique index (organization_id, client_message_id)
    // WHERE client_message_id IS NOT NULL. A retry with the same clientMessageId
    // returns the existing row instead of creating a duplicate.
    const rows = await query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, created_by_id, site_visit_date, organization_id, client_message_id)
       VALUES ($1, $2, $3, $7, $4, $5, $6)
       ON CONFLICT (organization_id, client_message_id) WHERE client_message_id IS NOT NULL
       DO UPDATE SET lead_id = follow_ups.lead_id  -- no-op, returns the existing row
       RETURNING *`,
      [
        String(leadId),
        message,
        salesManagerName || createdBy || "sales",
        siteVisitDate || null,
        orgId,
        clientMsgId,
        gate.userId,
      ]
    );

    const m = rows[0];

    const followUpData: FollowUpPayload = {
      _id: String(m.id),
      leadId: String(m.lead_id),
      salesManagerName: m.created_by_name || "",
      createdBy: m.created_by_name || "sales",
      message: m.message,
      siteVisitDate: m.site_visit_date || null,
      createdAt: m.created_at,
      followUpType: m.follow_up_type || "note",
      createdByRole: m.created_by_role || null,
      sentToRole: m.sent_to_role || null,
      sentToUserId: m.sent_to_user_id || null,
      parentFollowUpId: m.parent_follow_up_id || null,
      readAt: m.read_at || null,
      clientMessageId: body.clientMessageId || undefined,
    };

    // Broadcast to all connected clients in this organization.
    // Fire-and-forget — never delays the HTTP response.
    broadcastFollowUp(orgId, { type: "followup:created", followUp: followUpData });
    broadcastToOrg(orgId, "followup.created", { followUp: followUpData });

    // Return same shape as old MongoDB response
    return NextResponse.json({
      success: true,
      data: followUpData,
    }, { status: 201 });

  } catch (error) {
    console.error("POST followups error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save message" },
      { status: 500 }
    );
  }
}
