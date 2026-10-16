// lib/fcm/reminderPushHandler.ts — FCM dispatch handler for due reminders.
//
// Registers itself into the reminder dispatch system on first import.
// The reminder cron processor calls dispatchToExternalChannels() after
// marking a reminder as notified; this handler sends an FCM push to
// the assigned user's registered devices.

import {
  registerReminderChannel,
  type ReminderPayload,
} from "@/lib/reminderEvents";
import { sendPushToUser } from "./sendPush";

async function fcmReminderHandler(
  organizationId: string,
  reminder: ReminderPayload,
): Promise<void> {
  if (!reminder.assignedUserId) return;

  await sendPushToUser(reminder.assignedUserId, organizationId, {
    notificationId: `reminder:${reminder.id}`,
    title: `Reminder: ${reminder.reminderType ?? "Follow-up"}`,
    body: reminder.note
      ? `${reminder.leadName ?? "Lead"} — ${reminder.note}`
      : `${reminder.leadName ?? "Lead"} — reminder is due`,
    deepLink: `/dashboard?leadId=${reminder.leadId}`,
    data: {
      kind: "reminder",
      reminderId: String(reminder.id),
      leadId: String(reminder.leadId),
    },
  });
}

// Self-registering: importing this module is sufficient to wire it up.
registerReminderChannel(fcmReminderHandler);
