// api/notifications/feed/route.ts — THE notification queue for the header bells
// and the Notification Center.
//
// Not to be confused with /api/notifications, which is the Admin-only WhatsApp
// delivery log (notification_logs). This one is the in-app queue every signed-in
// role sees: New Lead, Site Visit, Follow-up.
//
// ── The tenant boundary ─────────────────────────────────────────────────────
// The organization is resolved HERE, from the signed session, via
// getOrganizationId(). It is not read from the body, the query string, a header
// or anything else the caller controls — there is no parameter for it, so a
// caller cannot supply one. buildNotificationFeed() then puts it directly into
// the SQL WHERE clause, so the rows never leave the database in the first place.
// Nothing downstream filters by organization, because nothing downstream ever
// receives another organization's rows.
//
// The viewer's NAME and ROLE come from the session too, for the same reason: a
// Sales Manager's queue is "leads assigned to me", and taking the name from the
// request would let anyone read anyone else's queue.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { buildNotificationFeed, resolveNotificationLead } from "@/lib/notifications/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const organizationId = await getOrganizationId();
    const sp = req.nextUrl.searchParams;

    const feed = await buildNotificationFeed({
      organizationId,
      viewerName: gate.session.name ?? "",
      viewerRole: gate.session.role ?? "",
      // Settings → Additional Features. Passed through so a disabled reminder
      // empties the queue server-side rather than being hidden in the browser.
      followUpRemindersEnabled: sp.get("followUpReminders") !== "off",
      siteVisitAlertsEnabled: sp.get("siteVisitAlerts") !== "off",
    });

    return NextResponse.json(
      {
        success: true,
        organizationId: feed.organizationId,
        data: {
          newLeads: feed.newLeads,
          siteVisits: feed.siteVisits,
          followUps: feed.followUps,
          all: feed.all,
        },
        counts: feed.counts,
      },
      {
        status: 200,
        // Per-user, per-tenant data. Without this a shared browser or an
        // intermediary could serve one tenant's queue to the next request.
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
  } catch (err: any) {
    console.error("[GET /api/notifications/feed]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

/**
 * Resolve a notification to its lead, for THIS organization.
 *
 * Clicking a notification opens a Lead Detail panel. The dashboards already hold
 * an organization-scoped copy of their own leads and open the panel from that,
 * so this endpoint is the authorization check rather than the data source: it
 * answers "may this session open lead N?" and returns 404 when the answer is no.
 *
 * 404 rather than 403 on a foreign lead is deliberate. A 403 would confirm the
 * lead exists in some other tenant, which turns this into an enumeration oracle:
 * walk the ids, and the response code maps out the platform's whole lead table.
 */
export async function POST(req: NextRequest) {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json().catch(() => ({}));
    const leadId = body?.leadId ?? body?.lead_id;

    if (leadId === undefined || leadId === null || leadId === "") {
      return NextResponse.json(
        { success: false, message: "leadId is required." },
        { status: 400 }
      );
    }

    // Note what is NOT read from the body: any organization id. The claim the
    // notification carried is irrelevant here — the session's organization is
    // re-resolved and re-applied, so a hand-made request quoting another
    // tenant's organization_id gets that tenant's lead exactly never.
    const organizationId = await getOrganizationId();
    const lead = await resolveNotificationLead(organizationId, leadId);

    if (!lead) {
      return NextResponse.json(
        { success: false, message: "Lead not found.", code: "LEAD_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: { id: lead.id, name: lead.name, srNo: lead.sr_no, organizationId: lead.organization_id },
      },
      { status: 200, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (err: any) {
    console.error("[POST /api/notifications/feed]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
