// lib/fcm/feedPushHandler.ts — Push notifications for CRM events.
//
// Hooks into the existing Supabase broadcast events to also send FCM
// push notifications. Each broadcast event is already fired after a
// successful mutation, so we piggyback on the same trigger points.
//
// Events handled:
//   - follow_up.created → push to assigned user (site visit / follow-up)
//   - caller.lead_assigned → push to caller
//   - lead.lost → push to previous owner
//
// New lead notifications are different: they are derived from timestamps
// in the feed query, not from an explicit event. For those, we use the
// /api/notifications/push endpoint which is called by the client when
// it detects new items in its poll.

import { sendPushToUser, sendPushToOrg } from "./sendPush";

/**
 * Send push for a new lead arriving in the organization.
 * Called by the walk-in / enquiry creation API after successful insert.
 */
export async function pushNewLead(
  organizationId: string,
  lead: { id: number; name: string; srNo?: number | null },
): Promise<void> {
  await sendPushToOrg(organizationId, {
    notificationId: `new_lead:${lead.id}`,
    title: "New Lead",
    body: lead.srNo
      ? `${lead.srNo} - ${lead.name}`
      : lead.name,
    deepLink: `/dashboard?leadId=${lead.id}`,
    data: {
      kind: "new_lead",
      leadId: String(lead.id),
    },
  });
}

/**
 * Send push for a site visit scheduled.
 */
export async function pushSiteVisit(
  organizationId: string,
  userId: number | string,
  lead: { id: number; name: string },
  visitDate: string,
): Promise<void> {
  await sendPushToUser(userId, organizationId, {
    notificationId: `site_visit:${lead.id}:${visitDate}`,
    title: "Site Visit Scheduled",
    body: `${lead.name} — ${new Date(visitDate).toLocaleDateString()}`,
    deepLink: `/dashboard?leadId=${lead.id}`,
    data: {
      kind: "site_visit",
      leadId: String(lead.id),
    },
  });
}

/**
 * Send push for a follow-up logged on a lead.
 */
export async function pushFollowUp(
  organizationId: string,
  userId: number | string,
  lead: { id: number; name: string },
  note?: string,
): Promise<void> {
  await sendPushToUser(userId, organizationId, {
    notificationId: `follow_up:${lead.id}:${Date.now()}`,
    title: "Follow-up Added",
    body: note
      ? `${lead.name} — ${note.slice(0, 80)}`
      : lead.name,
    deepLink: `/dashboard?leadId=${lead.id}`,
    data: {
      kind: "follow_up",
      leadId: String(lead.id),
    },
  });
}
