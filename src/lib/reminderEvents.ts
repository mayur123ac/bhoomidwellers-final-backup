// reminderEvents.ts — SSE event types and broadcast for lead reminders.
//
// Reuses the existing followUpEvents infrastructure for delivery (same SSE
// stream, same subscriber registry). Reminder events are broadcast through
// broadcastFollowUp() so that connected clients receive them without needing
// a second EventSource connection.
//
// This module defines the event shapes and provides typed broadcast helpers.
// The actual subscriber registry lives in followUpEvents.ts.

import { broadcastFollowUp } from "./followUpEvents";

// ── Event payloads ──────────────────────────────────────────────────────────

export interface ReminderPayload {
  id: number;
  leadId: number;
  leadName?: string;
  leadPhone?: string;
  assignedUserId: number;
  assignedUserName?: string;
  createdByName: string;
  reminderType: string;
  note: string | null;
  remindAt: string;
  status: string;
  notifiedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

// ── Typed broadcast helpers ─────────────────────────────────────────────────

export function broadcastReminderCreated(organizationId: string, reminder: ReminderPayload) {
  broadcastFollowUp(organizationId, {
    type: "reminder:created",
    reminder,
  } as any);
}

export function broadcastReminderDue(organizationId: string, reminder: ReminderPayload) {
  broadcastFollowUp(organizationId, {
    type: "reminder:due",
    reminder,
  } as any);
}

export function broadcastReminderUpdated(organizationId: string, reminder: ReminderPayload) {
  broadcastFollowUp(organizationId, {
    type: "reminder:updated",
    reminder,
  } as any);
}

// ── Notification dispatch interface ─────────────────────────────────────────
//
// Clean hook point for Phase 2 (Web Push) and Phase 2B (FCM). Each channel
// registers a handler here. The reminder processor calls dispatchReminder()
// once per due reminder; every registered channel receives it.
//
// Phase 1: only SSE (broadcastReminderDue) is registered.
// Phase 2: add webPushHandler, fcmHandler, etc.

export type ReminderDispatchHandler = (
  organizationId: string,
  reminder: ReminderPayload,
) => Promise<void>;

const dispatchHandlers: ReminderDispatchHandler[] = [];

/**
 * Register a notification channel for reminder delivery.
 * Called at module init by each channel (Web Push, FCM, etc.).
 */
export function registerReminderChannel(handler: ReminderDispatchHandler) {
  dispatchHandlers.push(handler);
}

/**
 * Dispatch a due reminder to all registered notification channels.
 * Called by the cron processor after marking a reminder as notified.
 *
 * SSE is always dispatched directly (not through this interface) because
 * it is synchronous and in-process. This interface is for async external
 * channels that may fail independently.
 */
export async function dispatchToExternalChannels(
  organizationId: string,
  reminder: ReminderPayload,
): Promise<{ channel: string; error: string }[]> {
  const errors: { channel: string; error: string }[] = [];
  for (const handler of dispatchHandlers) {
    try {
      await handler(organizationId, reminder);
    } catch (err: any) {
      errors.push({ channel: handler.name || "unknown", error: err.message });
    }
  }
  return errors;
}
