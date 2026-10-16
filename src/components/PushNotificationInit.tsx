"use client";

// PushNotificationInit — mounts once in the dashboard layout to initialize
// push notifications on native platforms. Also wires push-received events
// into the notification feed for immediate refresh.
//
// No-op on web. Only runs after authentication (user prop required).

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { initPushNotifications } from "@/lib/pushNotifications";

export default function PushNotificationInit({ user }: { user: any }) {
  const router = useRouter();
  const initRef = useRef(false);

  useEffect(() => {
    if (!user || initRef.current) return;
    initRef.current = true;

    initPushNotifications((deepLink) => {
      // Navigate to the deep-link path when a notification is tapped
      router.push(deepLink);
    });

    // Listen for foreground push events and trigger feed refetch
    const handler = () => {
      // Dispatch a custom event that useNotificationFeed can listen to
      window.dispatchEvent(new Event("crm:refetch-notifications"));
    };
    window.addEventListener("crm:push-received", handler);

    return () => {
      window.removeEventListener("crm:push-received", handler);
    };
  }, [user, router]);

  return null; // Render nothing
}
