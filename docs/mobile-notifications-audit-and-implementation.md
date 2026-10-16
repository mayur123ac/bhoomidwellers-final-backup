# Mobile Push Notifications — Audit & Implementation Report

**Date**: 2026-10-15
**Status**: Phase 1 Audit Complete

---

## 1. Existing Architecture

### 1A. In-App Notification Feed (No Database Table)

The CRM has **no `notifications` table**. All notifications are **derived at read time** from `walkin_enquiries` + `follow_ups` + `lead_reminders`.

| Component | Path | Role |
|-----------|------|------|
| Feed builder | `src/lib/notifications/feed.ts` | Server-side derivation of 5 notification kinds |
| Feed API | `src/app/api/notifications/feed/route.ts` | GET endpoint, tenant-scoped |
| Client hook | `src/lib/hooks/useNotificationFeed.ts` | Polls every 120s, plays sound, manages dismissals |
| Popover | `src/components/NotificationPopover.tsx` | 3-item preview with "See all" |
| Center | `src/components/NotificationCenterView.tsx` | Full notification list |
| Sales bell | `src/components/SalesSettingsBells.tsx` | Site visit bell (today/tomorrow) |
| Reminder popup | `src/components/ReminderDuePopup.tsx` | Modal for overdue reminders |

**Notification kinds**: `new_lead`, `site_visit`, `follow_up`, `reminder`, `revisit_lead`

**Tenant isolation**: Organization resolved from signed `crm_session` cookie via `getOrganizationId()`. Every query carries `organization_id = $1`. Client-side `assertSameOrganization()` logs mismatches as errors (does NOT filter — deliberate choice to surface server bugs).

**Dismissals**: Per-browser only (localStorage/ref), never persisted server-side.

### 1B. Supabase Realtime Broadcast

| Component | Path | Role |
|-----------|------|------|
| Server broadcast | `src/lib/supabase/broadcast.ts` | `broadcastToOrg()` + `broadcastToUser()` |
| Client listener | `src/lib/supabase/useRealtimeOrg.ts` | Private channel subscription |
| Token manager | `src/lib/supabase/realtimeTokenManager.ts` | Shared auth refresh |

**Channel naming**: `org:{organizationId}` (org-wide), `org:{organizationId}:user:{userId}` (private)

**Event producers**:
- `broadcastFollowUp()` — `src/lib/followUpEvents.ts`
- `broadcastReminderDue()` — `src/lib/reminderEvents.ts`
- `broadcastCallerLead()` — `src/lib/callerLeadEvents.ts`
- `broadcastLostLead()` — `src/lib/lostLeadEvents.ts`

Fire-and-forget with 5-second timeout. Failed broadcasts logged, never throw.

### 1C. Lead Reminders (Phase 1 Complete)

**Table**: `lead_reminders` (migration `2026-09-02_lead_reminders.sql`)

| Component | Path | Role |
|-----------|------|------|
| Service | `src/services/reminder.service.ts` | Cron-driven processing with `FOR UPDATE SKIP LOCKED` |
| Events | `src/lib/reminderEvents.ts` | SSE broadcast + external channel dispatch |
| Cron API | `src/app/api/reminders/process/route.ts` | Every 60s, auth via `x-reminder-token` |

**Critical extensibility hook**:
```typescript
// src/lib/reminderEvents.ts line 74
const dispatchHandlers: ReminderDispatchHandler[] = [];  // EMPTY — Phase 2 hook
export function registerReminderChannel(handler) { ... }
export async function dispatchToExternalChannels(...) { ... }
```
This is the designed insertion point for FCM/push delivery.

### 1D. Email Notification System

**Catalogue**: `src/lib/notificationCatalogue.ts` — 7 groups, 50+ notification types
**Preferences**: `notification_type_preferences` table (sparse — defaults from catalogue)
**Routing**: `src/lib/emailRouting.ts` — EmailType to notificationKey mapping
**Service**: `src/lib/email/EmailService.ts` — `sendDirect()` + `sendRouted()` with failsafe
**Status**: SMTP credentials pending in `.env.local`

### 1E. WhatsApp Notification Logs

**Table**: `notification_logs` (migration `2026-07-30`)
**Retry engine**: In-process timer (30s/2m/10m) + cron sweep every 5 min
**Cron API**: `src/app/api/notifications/retry-sweep/route.ts`

### 1F. Login & Security Notifications

`src/lib/loginNotification.ts` — login success, failed login, new device, burst alert. Fire-and-forget, audit-logged.

### 1G. Notification Sound

`/public/assets/notification1.mp3` — played via `useNotificationFeed` when `browser=true && sound=true && !DND`.

### 1H. Settings UI

- `/dashboard/settings/notifications` — catalogue toggles + in-app prefs (browser/sound/DND)
- `NotificationCenter.tsx` — 40+ switches
- `NotificationRecipients.tsx` — email delivery addresses

---

## 2. Capacitor & Android Configuration

### Installed Versions (package.json)

| Package | Version |
|---------|---------|
| `@capacitor/core` | `^8.5.2` |
| `@capacitor/cli` | `^8.5.2` |
| `@capacitor/android` | `^8.5.2` |
| `@capacitor/ios` | `^8.5.2` |
| `@capacitor/app` | `^8.1.1` |
| `@capacitor/geolocation` | `^8.2.2` |

**NOT installed**: `@capacitor/push-notifications`, `@capacitor/local-notifications`, `firebase`

### capacitor.config.ts

- `appId`: `com.bhoomidwellers.crm`
- `webDir`: `dist-capacitor`
- `server.url`: `https://www.bhoomidwellers.com` (remote WebView)
- `androidScheme`: `https`

### Android Build

- `android/build.gradle`: `com.google.gms:google-services:4.4.4` classpath — **already present**
- `android/app/build.gradle`:
  - `applicationId`: `com.bhoomidwellers.crm`
  - `versionCode`: 2, `versionName`: 2.0
  - Lines 63-70: Conditional `apply plugin: 'com.google.gms.google-services'` — **checks for google-services.json**
  - Signing via `keystore.properties`
- `AndroidManifest.xml`: **Missing** `POST_NOTIFICATIONS` permission (required Android 13+), no Firebase messaging service

### Firebase

- **No `google-services.json`** in `android/app/`
- No Firebase project configuration found
- No FCM server key or service account in the codebase

### iOS

- `ios/` directory exists but status is unclear (no APNs configuration found)

### Native Bridge Code

| File | Purpose |
|------|---------|
| `src/lib/platform.ts` | `isAndroidApp()` — Capacitor platform detection |
| `src/components/CapacitorBackButton.tsx` | Hardware back button handling |
| `src/components/CallingButtons.tsx` | Phone/call workflows |
| `src/plugins/CallRecordingPlugin.ts` | Custom native plugin |

---

## 3. Authentication & Session

- **Cookie-based**: `crm_session` signed cookie, verified server-side via `requireSession()`
- **Middleware**: `middleware.ts` protects routes, resolves user + org
- **Tenant scope**: `getOrganizationId()` from session, enforced in every API query
- **Mobile WebView**: Shares the same cookie with the production web app (same-origin `https://www.bhoomidwellers.com`)

---

## 4. Notification Event Matrix

| Event / Action | Producer | Intended Recipient(s) | Current Persistence | Current Delivery Channel | Mobile Behavior | Gap |
|---|---|---|---|---|---|---|
| New lead created | Walk-in form / import | All users in org (role-filtered by feed query) | Derived from `walkin_enquiries.created_at` | In-app feed (2-min poll) + sound | Works if app open (WebView poll) | No push when app closed/background |
| Site visit scheduled | Follow-up form | Assigned user + admin | Derived from `follow_ups.site_visit_date` | In-app feed (2-min poll) + sound | Works if app open | No push when app closed/background |
| Follow-up overdue (2+ days) | Derived by feed query | Assigned user + admin | Derived from `follow_ups` gap | In-app feed (2-min poll) | Works if app open | No push when app closed/background |
| Reminder due | Cron processor (60s) | `lead_reminders.assigned_user_id` | `lead_reminders` table | SSE broadcast + `dispatchToExternalChannels()` (empty) | Realtime via Supabase if app open | **No push** — dispatchHandlers is empty |
| Revisit lead detected | Derived by feed query | Assigned user | Derived from `walkin_enquiries` matching | In-app feed (2-min poll) | Works if app open | No push when app closed/background |
| Login success | Login API | The user who logged in | `audit_logs` | Email (if SMTP configured) | N/A | Email pending SMTP creds |
| Failed login burst | Login API | The user whose account was targeted | `audit_logs` | Email (if SMTP configured) | N/A | Email pending SMTP creds |
| New device login | Login API | The user | `audit_logs` | Email (if SMTP configured) | N/A | Email pending SMTP creds |
| Password changed | Password API | The user | `audit_logs` | Email (if SMTP configured) | N/A | Email pending SMTP creds |
| CP registration | WhatsApp service | CP phone number | `notification_logs` | WhatsApp (pending Meta approval) | N/A | External blocker |
| CP lead assigned | WhatsApp service | CP phone number | `notification_logs` | WhatsApp (pending Meta approval) | N/A | External blocker |
| Follow-up created | Follow-up form | Org channel subscribers | None (fire-and-forget broadcast) | Supabase Realtime | Real-time if app open | No push when app closed |
| Lead marked lost | Lost lead API | Org channel subscribers | None (fire-and-forget broadcast) | Supabase Realtime | Real-time if app open | No push when app closed |

---

## 5. Root Causes — Why Notifications Don't Reach Mobile

1. **No push notification plugin installed**: `@capacitor/push-notifications` is not in `package.json`
2. **No Firebase project**: `google-services.json` does not exist in `android/app/`
3. **No device token table**: No `device_tokens` or `fcm_tokens` table in the database
4. **No device token registration API**: No endpoint to accept and store FCM tokens
5. **No FCM send logic**: No server-side code to call Firebase Cloud Messaging API
6. **Empty dispatch handlers**: `reminderEvents.ts` has the extensibility hook but `dispatchHandlers` array is empty
7. **Poll-only in-app feed**: 2-minute polling works when WebView is active but stops when app is backgrounded/terminated
8. **No Android notification permission**: `POST_NOTIFICATIONS` not declared in `AndroidManifest.xml`
9. **Sound only works in foreground**: `useNotificationFeed` plays audio via the WebView, which is suspended in background

---

## 6. Proposed Architecture

### Overview

```
[CRM Event] --> [Notification Feed / Supabase Broadcast] --> [In-app UI] (existing)
     |
     v
[FCM Send Service] --> [Firebase Cloud Messaging] --> [Android OS] --> [Native Push]
     ^                                                                      |
     |                                                                      v
[device_tokens table] <-- [Token Registration API] <-- [Capacitor Push Plugin]
```

### Components to Add

| Layer | What | Where |
|-------|------|-------|
| **Database** | `device_tokens` table | New migration |
| **API** | `POST/DELETE /api/device-tokens` | Token registration/removal |
| **Service** | `src/lib/fcm/sendPush.ts` | Server-side FCM HTTP v1 send |
| **Hook** | `src/lib/fcm/fcmDispatchHandler.ts` | Register into `dispatchHandlers` |
| **Integration** | Wire into feed poll response | Send push for new items not yet pushed |
| **Client** | `src/lib/pushNotifications.ts` | Capacitor push plugin init, token forwarding |
| **Native** | `AndroidManifest.xml` + `google-services.json` | Permissions + Firebase config |
| **Plugin** | `@capacitor/push-notifications` | npm install |

### Delivery Strategy

1. **Foreground**: Existing in-app UI continues. Capacitor push plugin receives foreground notifications and suppresses native display (avoids duplicates) but can trigger a feed refetch.
2. **Background/Terminated**: FCM data message → Android shows native notification. Tap opens app with deep-link data.
3. **Token lifecycle**: Register on permission grant, refresh on `registration` event, remove on logout, re-register on login. Multiple devices per user supported.
4. **Idempotency**: Each push carries a stable `notificationId` (derived from the feed item's `id`). Server tracks `last_pushed_at` per device to avoid re-sending.
5. **Tenant isolation**: Token registration validates session. FCM send selects tokens by `user_id` + `organization_id`.

---

## 7. Required External Setup (Before Code Works)

| Step | Owner | Notes |
|------|-------|-------|
| Create Firebase project | Admin | Console at console.firebase.google.com |
| Add Android app (`com.bhoomidwellers.crm`) | Admin | Downloads `google-services.json` |
| Download `google-services.json` | Admin | Place in `frontend/android/app/` |
| Generate Firebase Admin SDK service account key | Admin | For server-side FCM sends |
| Set `FCM_SERVICE_ACCOUNT_JSON` env var | Admin | Base64-encoded service account JSON in `.env.local` and Vercel |
| Rebuild Android APK | Dev | `npx cap sync android && cd android && ./gradlew assembleRelease` |

---

## 8. Implementation — Files Changed

### New Files

| File | Purpose |
|------|---------|
| `scripts/migrations/2026-10-15_device_tokens.sql` | `device_tokens` table — stores FCM tokens per user/org |
| `src/app/api/device-tokens/route.ts` | POST (register) + DELETE (logout) for FCM tokens |
| `src/lib/fcm/admin.ts` | Firebase Admin SDK singleton (lazy init from `FCM_SERVICE_ACCOUNT_JSON`) |
| `src/lib/fcm/sendPush.ts` | `sendPushToUser()`, `sendPushToUsers()`, `sendPushToOrg()` — FCM HTTP v1 |
| `src/lib/fcm/reminderPushHandler.ts` | Self-registering handler for `dispatchToExternalChannels()` |
| `src/lib/fcm/feedPushHandler.ts` | `pushNewLead()`, `pushSiteVisit()`, `pushFollowUp()` helpers |
| `src/lib/pushNotifications.ts` | Client-side Capacitor push plugin init, token lifecycle |
| `src/components/PushNotificationInit.tsx` | React component mounted in dashboards |

### Modified Files

| File | Change |
|------|--------|
| `capacitor.config.ts` | Added `plugins.PushNotifications` config |
| `android/app/src/main/AndroidManifest.xml` | Added `POST_NOTIFICATIONS` permission |
| `src/services/reminder.service.ts` | Import `@/lib/fcm/reminderPushHandler` (self-registers) |
| `src/app/api/walkin_enquiries/route.ts` | Call `pushNewLead()` after lead creation broadcast |
| `src/app/dashboard/page.tsx` | Added `PushNotificationInit` + `cleanupPushOnLogout` |
| `src/app/dashboard/sourcing/page.tsx` | Added `PushNotificationInit` |
| `src/app/dashboard/hr/page.tsx` | Added `PushNotificationInit` |
| `src/app/dashboard/caller/page.tsx` | Added `PushNotificationInit` |
| `src/app/dashboard/receptionist/page.tsx` | Added `PushNotificationInit` |
| `src/app/dashboard/sales/page.tsx` | Added `PushNotificationInit` |
| `src/app/dashboard/employees/page.tsx` | Added `PushNotificationInit` |
| `src/lib/hooks/useNotificationFeed.ts` | Listen for `crm:refetch-notifications` event (foreground push → immediate refetch) |

### npm Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| `@capacitor/push-notifications` | `^8.1.3` | Capacitor plugin for native push |
| `firebase-admin` | `^14.5.0` | Server-side FCM sends |

---

## 9. Delivery Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ Lead created / Reminder due / Follow-up saved                    │
│   ├── Supabase Realtime broadcast (existing)                     │
│   └── pushNewLead() / reminderPushHandler / pushFollowUp()       │
│         └── sendPushToUser() / sendPushToOrg()                   │
│               ├── query device_tokens (user_id + org_id)         │
│               └── FCM HTTP v1 send (data-only message)           │
│                     ├── Success → device shows notification       │
│                     └── InvalidToken → mark invalidated_at        │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Mobile App                                                        │
│   ├── initPushNotifications() on mount                            │
│   │     ├── checkPermissions() → requestPermissions()             │
│   │     ├── register() → FCM token                                │
│   │     └── POST /api/device-tokens { token, platform }           │
│   ├── Foreground: pushNotificationReceived                        │
│   │     └── dispatch crm:push-received → useNotificationFeed      │
│   │           refetches immediately                               │
│   ├── Background/Terminated: OS shows native notification         │
│   │     └── Tap → pushNotificationActionPerformed                 │
│   │           └── router.push(deepLink)                           │
│   └── Logout: cleanupPushOnLogout()                               │
│         └── DELETE /api/device-tokens                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 10. Environment Variables Required

| Variable | Format | Where | Notes |
|----------|--------|-------|-------|
| `FCM_SERVICE_ACCOUNT_JSON` | Base64-encoded JSON | `.env.local` + Vercel | Firebase Admin service account. Generate from Firebase Console → Project Settings → Service accounts → Generate new private key. Then `base64 -w0 service-account.json` |

**Placeholder** (do not use real values):
```
FCM_SERVICE_ACCOUNT_JSON=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwiLi4uIjoiLi4uIn0=
```

---

## 11. Android Build Commands

```bash
# From frontend/ directory
npm install                                    # installs @capacitor/push-notifications + firebase-admin
npx cap sync android                           # syncs plugin to native project
cd android && ./gradlew assembleRelease        # builds APK
# OR for debug:
cd android && ./gradlew assembleDebug
```

**Prerequisites**:
- `google-services.json` must be placed in `frontend/android/app/`
- Java 17+ and Android SDK installed

---

## 12. Remaining Manual Steps

| Step | Status | Notes |
|------|--------|-------|
| Create Firebase project + Android app | NOT DONE | Owner must do this in Firebase Console |
| Place `google-services.json` | NOT DONE | Required before Android build |
| Set `FCM_SERVICE_ACCOUNT_JSON` in Vercel | NOT DONE | Required for server-side sends |
| Apply `2026-10-15_device_tokens.sql` to Neon | NOT DONE | Migration ready, needs manual apply |
| Run `npx cap sync android` | NOT DONE | Required after plugin install |
| Build and test APK on real device | NOT DONE | Requires all above steps |
| Wire `pushSiteVisit()` into follow-up creation | PARTIAL | Only `pushNewLead` wired; site visit + follow-up push needs integration at their respective API routes |
| Add `cleanupPushOnLogout()` to other dashboards | PENDING | Agent task dispatched for hr/caller/receptionist/sales/employees |
| iOS APNs configuration | NOT STARTED | Requires Apple Developer account + APNs key |
| Test token refresh on reinstall | NOT TESTED | Requires device testing |
| Test multi-device per user | NOT TESTED | Requires device testing |
| Test cross-tenant isolation | NOT TESTED | Requires 2 orgs with registered devices |

---

## 13. Test Plan

### Automated (when environment is configured)

- [ ] POST /api/device-tokens with valid session registers token
- [ ] POST /api/device-tokens with invalid token (< 20 chars) returns 400
- [ ] POST /api/device-tokens without session returns 401
- [ ] DELETE /api/device-tokens removes user's tokens
- [ ] Upsert: re-registering same token updates user_id (account switch)
- [ ] `sendPushToUser()` with no tokens does nothing
- [ ] `sendPushToUser()` with invalid token marks `invalidated_at`
- [ ] Invalidated tokens are excluded from subsequent queries
- [ ] `pushNewLead()` sends to all org users with tokens

### Device Testing Required

- [ ] App foreground: push received → feed refetches immediately
- [ ] App background: native notification shown → tap opens lead
- [ ] App terminated: native notification shown → tap opens app + lead
- [ ] Permission denied: no crash, in-app feed continues working
- [ ] Token refresh: re-registration works
- [ ] Logout: token removed from server
- [ ] Login as different user: token reassigned
- [ ] Multiple devices: both receive push
- [ ] Cross-tenant: user in Org A does not receive Org B pushes
