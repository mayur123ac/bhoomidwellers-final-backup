"use client";

// Settings → Notifications.
//
// ── What changed ────────────────────────────────────────────────────────────
// The Email tab used to be seven checkboxes over a JSONB blob plus a frequency
// radio group, and nothing consulted either before sending. It is now the
// notification centre: every system email has its own switch, the switches are
// stored per key in notification_type_preferences, and sendToUser() refuses to
// send anything whose switch is off.
//
// The lead, booking and commission categories that used to live here are gone
// from this screen deliberately. This is the account/security/workspace/employee/
// subscription/system notice board; CRM work notifications are a different
// problem with different routing (per role, per assignee) and putting them on one
// admin's preference page was the reason none of them were ever honoured. Their
// stored values are untouched in users.notification_prefs.
//
// The old Frequency card went with them: Daily, Weekly and Monthly summaries are
// now three switches in the System group, which is the same choice expressed
// where the user is already making every other one.
//
// ── Delivery sits above the switches ────────────────────────────────────────
// NotificationRecipients is the existing, complete recipient/verification widget
// (also mounted on Account & Security, where it originally shipped). It appears
// first because "where does this go" is the question that makes "which of these
// do I want" answerable — a page of switches above an empty recipient list is a
// page of switches that send nothing.
//
// ── In-App and SMS ──────────────────────────────────────────────────────────
// Unchanged. In-App still reads and writes the users.notification_prefs blob,
// which still holds browser/sound/do-not-disturb; SMS still states that no
// gateway exists rather than storing preferences nothing can act on.

import { useCallback, useEffect, useState } from "react";
import NotificationCenter from "@/components/Settings/NotificationCenter";
import NotificationRecipients from "@/components/Settings/NotificationRecipients";
import {
  Button,
  Card,
  Field,
  PageHeader,
  Skeleton,
  T,
  TextInput,
  ToggleRow,
  api,
  useToast,
} from "@/components/Settings/ui";

type Tab = "email" | "inapp" | "sms";

const TABS: { id: Tab; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "inapp", label: "In-App" },
  { id: "sms", label: "SMS" },
];

export default function NotificationsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("email");
  const [deliveryVersion, setDeliveryVersion] = useState(0);

  // Stable identity: NotificationRecipients lists this in a useCallback's
  // dependencies, and a fresh closure on every render would rebuild its save
  // handler each time for no reason.
  const bumpDelivery = useCallback(() => setDeliveryVersion((n) => n + 1), []);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Which system emails you receive, and where they are delivered."
      />

      <div className="mb-5 flex gap-1 border-b" style={{ borderColor: T.border }} role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`notif-tab-${entry.id}`}
            id={`notif-tabbtn-${entry.id}`}
            onClick={() => setTab(entry.id)}
            className="min-h-[44px] px-4 text-sm font-medium transition-colors"
            style={{
              color: tab === entry.id ? T.teal : T.muted,
              borderBottom: `2px solid ${tab === entry.id ? T.teal : "transparent"}`,
              marginBottom: "-1px",
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Each panel is mounted only while selected. The Email panel holds a
          draft of unsaved toggles; keeping the other tabs mounted alongside it
          would mean three components each polling their own endpoint for a
          screen showing one of them. */}
      {tab === "email" && (
        <div role="tabpanel" id="notif-tab-email" aria-labelledby="notif-tabbtn-email">
          {/* Changing the recipients above changes the "delivered to" half of
              the preview below, so the two are joined by a counter rather than
              left to disagree until the next page load. */}
          <NotificationRecipients onRecipientsChanged={bumpDelivery} />
          <NotificationCenter deliveryVersion={deliveryVersion} />
        </div>
      )}

      {tab === "inapp" && (
        <div role="tabpanel" id="notif-tab-inapp" aria-labelledby="notif-tabbtn-inapp">
          <InAppTab onError={(message) => toast("error", message)} />
        </div>
      )}

      {tab === "sms" && (
        <div role="tabpanel" id="notif-tab-sms" aria-labelledby="notif-tabbtn-sms">
          <Card title="SMS notifications">
            {/* The spec marks SMS as future. There is no SMS gateway configured, so
                this tab states that rather than rendering toggles that store a
                preference nothing will ever read. */}
            <p className="text-sm" style={{ color: T.muted }}>
              SMS notifications are not available. No SMS gateway is connected to this CRM — the
              WhatsApp and voice integrations do not carry transactional SMS. This tab will gain
              controls when a provider is configured.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}

/* ── In-App ───────────────────────────────────────────────────────────────── */

/**
 * The browser/sound/do-not-disturb half of users.notification_prefs.
 *
 * Split into its own component so the Email tab does not load the blob it no
 * longer uses. It PATCHes only the `inApp` object — the endpoint merges over the
 * stored value rather than the defaults, so the email keys and frequency it no
 * longer sends are left exactly as they are.
 */
interface InAppPrefs {
  browser: boolean;
  sound: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

/** The endpoint returns the whole blob; only `inApp` is read here. */
interface NotificationPrefsResponse {
  prefs: { inApp: InAppPrefs };
  message: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function InAppTab({ onError }: { onError: (message: string) => void }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<InAppPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<NotificationPrefsResponse>("/api/settings/notifications")
      .then((response) => setPrefs(response.prefs.inApp))
      .catch((err: unknown) => onError(messageOf(err)))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(load, [load]);

  const set = <K extends keyof InAppPrefs>(key: K, value: InAppPrefs[K]) =>
    setPrefs((current) => (current ? { ...current, [key]: value } : current));

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const result = await api<NotificationPrefsResponse>("/api/settings/notifications", {
        method: "PATCH",
        json: { inApp: prefs },
      });
      setPrefs(result.prefs.inApp);
      toast("success", result.message);
    } catch (err: unknown) {
      toast("error", messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <Skeleton rows={4} />
      </Card>
    );
  }

  if (!prefs) {
    return (
      <Card>
        <p className="text-sm" style={{ color: T.danger }}>
          Could not load in-app preferences.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="In-app notifications"
      footer={
        <Button onClick={save} loading={saving}>
          Save preferences
        </Button>
      }
    >
      <ToggleRow
        label="Browser notifications"
        description="Show desktop notifications when the CRM is open."
        checked={Boolean(prefs.browser)}
        onChange={(value) => set("browser", value)}
      />
      <ToggleRow
        label="Sound"
        description="Play a sound for new notifications."
        checked={Boolean(prefs.sound)}
        onChange={(value) => set("sound", value)}
      />
      <ToggleRow
        label="Do not disturb"
        description="Mute notifications during a set time range."
        checked={Boolean(prefs.dndEnabled)}
        onChange={(value) => set("dndEnabled", value)}
      />

      {prefs.dndEnabled && (
        <div className="mt-4 grid gap-x-5 sm:grid-cols-2">
          <Field label="From" htmlFor="dnd-start">
            <TextInput
              id="dnd-start"
              type="time"
              value={prefs.dndStart}
              onChange={(event) => set("dndStart", event.target.value)}
            />
          </Field>
          <Field label="Until" htmlFor="dnd-end">
            <TextInput
              id="dnd-end"
              type="time"
              value={prefs.dndEnd}
              onChange={(event) => set("dndEnd", event.target.value)}
            />
          </Field>
        </div>
      )}
    </Card>
  );
}
