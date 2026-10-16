// lib/fcm/admin.ts — Firebase Admin singleton for FCM sends.
//
// The service account JSON is stored base64-encoded in the
// FCM_SERVICE_ACCOUNT_JSON environment variable. This avoids
// checking credentials into the repository or needing a file path.
//
// If the env var is missing, getFirebaseMessaging() returns null and all
// push sends are silently skipped (the app works without push).

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

let _app: App | null = null;
let _initAttempted = false;

function initFirebase(): App | null {
  if (_initAttempted) return _app;
  _initAttempted = true;

  const b64 = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!b64) {
    console.warn(
      "[fcm] FCM_SERVICE_ACCOUNT_JSON not set — push notifications disabled.",
    );
    return null;
  }

  try {
    // Reuse existing app if already initialized (hot reload)
    const existing = getApps();
    if (existing.length > 0) {
      _app = existing[0];
      return _app;
    }

    const json = Buffer.from(b64, "base64").toString("utf-8");
    const credential = JSON.parse(json);

    _app = initializeApp({
      credential: cert(credential),
    });
    return _app;
  } catch (err) {
    console.error("[fcm] Failed to initialize Firebase Admin:", err);
    return null;
  }
}

export function getFirebaseMessaging(): Messaging | null {
  const app = initFirebase();
  if (!app) return null;
  return getMessaging(app);
}
