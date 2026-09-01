"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/**
 * Handles the Android hardware back button inside the Capacitor WebView.
 *
 * Behaviour:
 *  1. If the WebView has navigation history → go back (preserves Next.js
 *     client-side routing).
 *  2. Otherwise → minimise the app (move to background) rather than killing
 *     it, so the session and WebView state survive.
 *
 * On web (non-Capacitor) this component renders nothing and registers no
 * listeners.
 */
export default function CapacitorBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handler = App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.minimizeApp();
      }
    });

    return () => {
      handler.then((h) => h.remove());
    };
  }, []);

  return null;
}
