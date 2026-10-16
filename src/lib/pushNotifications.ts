"use client";

// lib/pushNotifications.ts — Capacitor Push Notifications client integration.
//
// This module handles:
//   1. Requesting notification permission (Android 13+)
//   2. Registering the FCM token with the server
//   3. Handling token refresh
//   4. Foreground notification presentation
//   5. Notification tap → deep-link navigation
//   6. Token cleanup on logout
//
// Designed to be called once on app startup from the root layout or
// dashboard, after the user is authenticated.

import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
  type ActionPerformed,
} from "@capacitor/push-notifications";

let _initialized = false;
let _currentToken: string | null = null;

/**
 * Initialize push notifications on a native platform.
 *
 * No-op on web. Safe to call multiple times (idempotent).
 *
 * @param onNavigate - callback when user taps a notification.
 *   Receives the deep-link path (e.g. "/dashboard?leadId=123").
 */
export async function initPushNotifications(
  onNavigate?: (path: string) => void,
): Promise<void> {
  // Only run on native platforms (Capacitor Android/iOS)
  if (!Capacitor.isNativePlatform()) return;
  if (_initialized) return;
  _initialized = true;

  try {
    // Check current permission status
    let permStatus = await PushNotifications.checkPermissions();

    if (permStatus.receive === "prompt") {
      // Request permission (shows the Android 13+ runtime dialog)
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== "granted") {
      console.log("[push] Permission not granted:", permStatus.receive);
      return;
    }

    // Listen for registration success
    PushNotifications.addListener("registration", async (token: Token) => {
      console.log("[push] Registered with token:", token.value.slice(0, 20) + "...");
      _currentToken = token.value;
      await registerTokenWithServer(token.value);
    });

    // Listen for registration errors
    PushNotifications.addListener("registrationError", (error) => {
      console.error("[push] Registration error:", error);
    });

    // Foreground: notification received while app is open
    PushNotifications.addListener(
      "pushNotificationReceived",
      (notification: PushNotificationSchema) => {
        console.log("[push] Foreground notification:", notification.data);
        // Do NOT show a native notification — the in-app feed handles it.
        // The feed hook's poll will pick it up, or we can trigger an
        // immediate refetch via a custom event.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("crm:push-received", {
              detail: notification.data,
            }),
          );
        }
      },
    );

    // Tap: user tapped a notification (from background/terminated)
    PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (action: ActionPerformed) => {
        console.log("[push] Notification tapped:", action.notification.data);
        const data = action.notification.data;
        const deepLink = data?.deepLink;
        if (deepLink && onNavigate) {
          onNavigate(deepLink);
        }
      },
    );

    // Register with FCM (triggers the "registration" listener above)
    await PushNotifications.register();
  } catch (err) {
    console.error("[push] Init error:", err);
  }
}

/**
 * Send the FCM token to our server for storage.
 */
async function registerTokenWithServer(token: string): Promise<void> {
  try {
    const platform = Capacitor.getPlatform();
    // Build a device info string
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const deviceInfo = `${platform} / ${userAgent.slice(0, 100)}`;

    const res = await fetch("/api/device-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform, deviceInfo }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("[push] Token registration failed:", body);
    }
  } catch (err) {
    console.error("[push] Token registration error:", err);
  }
}

/**
 * Remove the device token on logout.
 *
 * Removes the specific token from the server and unregisters from FCM.
 */
export async function cleanupPushOnLogout(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // Remove token from server
    if (_currentToken) {
      await fetch("/api/device-tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: _currentToken }),
      }).catch(() => {});
    } else {
      // No specific token — remove all for this user
      await fetch("/api/device-tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    }

    // Remove all listeners and unregister
    await PushNotifications.removeAllListeners();
    _currentToken = null;
    _initialized = false;
  } catch (err) {
    console.error("[push] Logout cleanup error:", err);
  }
}

/**
 * Get the current token (for debugging/diagnostics).
 */
export function getCurrentPushToken(): string | null {
  return _currentToken;
}
