"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/**
 * Handles the Android hardware back button inside the Capacitor WebView.
 *
 * Behaviour:
 *  1. If an overlay is open (modal, drawer, dialog, lightbox, full-screen
 *     image viewer), close it by pressing Escape — no route change.
 *  2. If the WebView has navigation history AND the previous entry is not the
 *     login page → go back (preserves Next.js client-side routing).
 *  3. If we are already on the root dashboard route or there is no meaningful
 *     history left → minimise the app so the session survives.
 *
 * On web (non-Capacitor) this component renders nothing and registers no
 * listeners.
 */
export default function CapacitorBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handler = App.addListener("backButton", ({ canGoBack }) => {
      // ── 1. Close any open overlay first ──────────────────────────────
      // Modals, drawers, dialogs, and image viewers that use Radix,
      // Headless UI, or manual portals conventionally render into a
      // [role="dialog"] or [data-state="open"] container. Dispatching
      // Escape mirrors the user pressing the keyboard dismiss key.
      const overlay =
        document.querySelector("[role='dialog']") ||
        document.querySelector("[data-state='open'][data-radix-portal]") ||
        document.querySelector(".fixed.inset-0, .fixed.z-50");

      if (overlay) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        return; // overlay consumed this press — don't navigate
      }

      // ── 2. Guard: never navigate back to the login page ("/") ───────
      // The login page now uses router.replace so it shouldn't be in the
      // stack, but this is a safety net for edge cases (deep-link, manual
      // URL entry, stale history from before the fix).
      const path = window.location.pathname;
      const isRootDashboard =
        path === "/dashboard" ||
        path === "/dashboard/" ||
        path === "/dashboard/sales" ||
        path === "/dashboard/receptionist" ||
        path === "/dashboard/sourcing" ||
        path === "/dashboard/caller" ||
        path === "/super-admin";

      if (!canGoBack || isRootDashboard) {
        App.minimizeApp();
        return;
      }

      // ── 3. Normal back navigation via browser history ───────────────
      window.history.back();
    });

    return () => {
      handler.then((h) => h.remove());
    };
  }, []);

  return null;
}
