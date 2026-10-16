// lib/fcm/sendPush.ts — Send push notifications via Firebase Cloud Messaging.
//
// This module is the single entry point for all FCM sends. It handles:
//   - Looking up valid device tokens for target user(s) + organization
//   - Sending via FCM HTTP v1 API (through firebase-admin)
//   - Handling invalid/expired tokens (marks them invalidated_at)
//   - Logging errors without throwing to callers (fire-and-forget pattern)
//
// All sends use DATA-ONLY messages so the client controls presentation.
// This ensures foreground handling works correctly (Capacitor plugin
// receives the data, and the app decides whether to show a native
// notification or just refresh the feed).

import { query } from "@/lib/db";
import { getFirebaseMessaging } from "./admin";

export interface PushPayload {
  /** Stable ID for deduplication on the client. */
  notificationId: string;
  /** Title shown in the notification shade. */
  title: string;
  /** Body text. */
  body: string;
  /** Deep-link path, e.g. "/dashboard?leadId=123" */
  deepLink?: string;
  /** Additional data for the client. */
  data?: Record<string, string>;
}

/**
 * Send a push notification to a specific user in a specific organization.
 *
 * Looks up all valid device tokens for the user and sends to each one.
 * Invalid tokens are marked and won't be used again.
 *
 * Fire-and-forget — never throws. Errors are logged.
 */
export async function sendPushToUser(
  userId: number | string,
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const messaging = getFirebaseMessaging();
    if (!messaging) return; // FCM not configured

    const tokens = await query<{ id: number; token: string; platform: string }>(
      `SELECT id, token, platform
       FROM device_tokens
       WHERE user_id = $1
         AND organization_id = $2
         AND invalidated_at IS NULL`,
      [userId, organizationId],
    );
    if (tokens.length === 0) return;

    const dataPayload: Record<string, string> = {
      notificationId: payload.notificationId,
      title: payload.title,
      body: payload.body,
      ...(payload.deepLink ? { deepLink: payload.deepLink } : {}),
      ...(payload.data ?? {}),
    };

    // Send to each token individually so we can handle per-token errors
    const sendPromises = tokens.map(async ({ id, token, platform }) => {
      try {
        await messaging.send({
          token,
          // Data-only message: the client handles display
          data: dataPayload,
          // Android-specific: high priority for timely delivery
          android: {
            priority: "high",
            // TTL: 1 hour — stale notifications aren't useful
            ttl: 3600 * 1000,
          },
          // If iOS is ever used:
          apns: {
            headers: {
              "apns-priority": "10",
            },
            payload: {
              aps: {
                "content-available": 1,
                alert: {
                  title: payload.title,
                  body: payload.body,
                },
                sound: "default",
              },
            },
          },
        });
      } catch (err: any) {
        const code = err?.code ?? err?.errorInfo?.code ?? "";
        // These codes mean the token is permanently invalid
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument"
        ) {
          console.warn(
            `[fcm] Token ${id} invalidated (${code}). Marking.`,
          );
          await markTokenInvalid(id);
        } else {
          // Transient error — log but don't invalidate
          console.error(`[fcm] Send failed for token ${id}:`, code, err.message);
        }
      }
    });

    await Promise.allSettled(sendPromises);
  } catch (err) {
    console.error("[fcm] sendPushToUser error:", err);
  }
}

/**
 * Send a push notification to multiple users in an organization.
 *
 * Used for org-wide events like new_lead.
 */
export async function sendPushToUsers(
  userIds: (number | string)[],
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  // Send in parallel — each user's send is independent
  await Promise.allSettled(
    userIds.map((uid) => sendPushToUser(uid, organizationId, payload)),
  );
}

/**
 * Send a push to ALL users with registered tokens in an organization.
 */
export async function sendPushToOrg(
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const messaging = getFirebaseMessaging();
    if (!messaging) return;

    const rows = await query<{ user_id: number }>(
      `SELECT DISTINCT user_id
       FROM device_tokens
       WHERE organization_id = $1
         AND invalidated_at IS NULL`,
      [organizationId],
    );

    const userIds = rows.map((r) => r.user_id);
    if (userIds.length === 0) return;

    await sendPushToUsers(userIds, organizationId, payload);
  } catch (err) {
    console.error("[fcm] sendPushToOrg error:", err);
  }
}

async function markTokenInvalid(tokenId: number): Promise<void> {
  try {
    await query(
      `UPDATE device_tokens SET invalidated_at = NOW() WHERE id = $1`,
      [tokenId],
    );
  } catch (err) {
    console.error("[fcm] Failed to mark token invalid:", err);
  }
}
