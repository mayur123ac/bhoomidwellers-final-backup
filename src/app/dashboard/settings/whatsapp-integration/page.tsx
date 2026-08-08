"use client";

// Settings → WhatsApp Integration.
//
// One screen, two states, and which one you are in is not your choice:
//
//   API not connected  → your personal number IS the channel. Set it, and
//                        "Send WhatsApp" on a lead opens wa.me from your phone.
//   API connected      → the company Business number takes over. The manual
//                        path is switched off and shown as such, rather than
//                        being removed — a control that silently disappears
//                        reads as a bug, one that explains why it is off does
//                        not.
//
// The number field stays editable in both states because it is also where the
// CRM's own WhatsApp alerts are delivered. See the header comment on
// api/settings/whatsapp-integration/route.ts.

import { useCallback, useEffect, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import {
  Button,
  Card,
  Field,
  InfoBanner,
  PageHeader,
  Skeleton,
  StatusBadge,
  T,
  TextInput,
  api,
  useToast,
} from "@/components/Settings/ui";

interface Status {
  mode: "api" | "manual" | "none";
  api: {
    configured: boolean;
    enabled: boolean;
    active: boolean;
    businessNumberHint: string;
    missing: string[];
  };
  manual: { number: string; active: boolean; configured: boolean };
  viewer: { name: string | null; isAdmin: boolean };
}

/** Digits only — the column stores "919876543210", never "+91 98765 43210". */
const digitsOnly = (value: string) => value.replace(/\D/g, "");

export default function WhatsAppIntegrationPage() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(() => {
    api<Status>("/api/settings/whatsapp-integration")
      .then((r) => {
        setStatus(r);
        setNumber(r.manual.number ?? "");
      })
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async () => {
    const cleaned = digitsOnly(number);
    // Checked here as well as on the server so the common mistake — typing a
    // 10-digit mobile without the country code — is caught before a round trip.
    if (cleaned.length < 10 || cleaned.length > 15) {
      setError("Enter the full number including the country code, e.g. 919876543210.");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const result = await api<{ whatsapp_number: string; message: string }>(
        "/api/users/update-whatsapp",
        { method: "POST", json: { whatsapp_number: cleaned } }
      );
      setNumber(result.whatsapp_number);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              mode: prev.api.active ? "api" : "manual",
              manual: {
                number: result.whatsapp_number,
                configured: true,
                active: !prev.api.active,
              },
            }
          : prev
      );

      // The sales, receptionist and sourcing dashboards read whatsapp_number off
      // the cached user, not off the API — without this the number stays stale
      // there until the next sign-in, and "Send WhatsApp" keeps complaining that
      // no number is set.
      try {
        const cached = JSON.parse(localStorage.getItem("crm_user") ?? "{}");
        localStorage.setItem(
          "crm_user",
          JSON.stringify({ ...cached, whatsapp_number: result.whatsapp_number })
        );
      } catch {
        /* cache refresh is best-effort */
      }

      toast("success", result.message);
    } catch (err: any) {
      setError(err.message);
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="WhatsApp Integration" />
        <Card>
          <Skeleton rows={4} />
        </Card>
      </>
    );
  }

  if (!status) {
    return (
      <>
        <PageHeader title="WhatsApp Integration" />
        <Card>
          <p className="text-sm" style={{ color: T.danger }}>
            Could not load your WhatsApp settings.
          </p>
        </Card>
      </>
    );
  }

  const apiActive = status.api.active;
  const cleaned = digitsOnly(number);
  const unchanged = cleaned === (status.manual.number ?? "");

  return (
    <>
      <PageHeader
        title="WhatsApp Integration"
        subtitle="How messages reach your leads on WhatsApp."
        action={
          apiActive ? (
            <StatusBadge status="active">Business API</StatusBadge>
          ) : status.manual.configured ? (
            <StatusBadge status="success">Personal number</StatusBadge>
          ) : (
            <StatusBadge status="pending">Not set up</StatusBadge>
          )
        }
      />

      {/* ── Which channel is live ──────────────────────────────────────────── */}
      <Card
        title="Active channel"
        description="Only one channel sends at a time. The Business API always takes priority."
      >
        <div className="space-y-3">
          <ChannelRow
            title="WhatsApp Business API"
            live={apiActive}
            detail={
              apiActive
                ? `Messages are sent from the company Business number${
                    status.api.businessNumberHint ? ` (id ${status.api.businessNumberHint})` : ""
                  }, logged automatically against the lead.`
                : status.api.configured && !status.api.enabled
                  ? "Credentials are in place but sending is paused (WHATSAPP_ENABLED is off)."
                  : "Not connected yet, so the personal-number route below is in use."
            }
          />
          <ChannelRow
            title="My personal WhatsApp"
            live={!apiActive && status.manual.configured}
            detail={
              apiActive
                ? "Switched off. The Business API is connected, so leads are messaged from the company number instead of your phone."
                : status.manual.configured
                  ? "In use. “Send WhatsApp” on a lead opens WhatsApp on your device with the message ready to send."
                  : "Add your number below to start messaging leads from your own WhatsApp."
            }
          />
        </div>

        {apiActive && (
          <div className="mt-5">
            <InfoBanner>
              Manual sending is off while the Business API is connected. Your number below is still
              used to <strong>receive</strong> CRM alerts, and stays on your lead records — it just
              no longer sends.
            </InfoBanner>
          </div>
        )}

        {!apiActive && status.api.missing.length > 0 && (
          <div className="mt-5">
            {/* Admins get the actual to-do list; nobody else can act on it, so
                the API does not send it to them. */}
            <InfoBanner tone="warning">
              The Business API is missing {status.api.missing.join(", ")}. Until those are set in
              the environment, every user sends from their own number.
            </InfoBanner>
          </div>
        )}
      </Card>

      {/* ── The number ─────────────────────────────────────────────────────── */}
      <Card
        title="My WhatsApp number"
        description={
          apiActive
            ? "Where the CRM delivers your WhatsApp alerts."
            : "The number your leads will see when you message them."
        }
        footer={
          <Button onClick={save} loading={saving} disabled={unchanged && !error}>
            {status.manual.configured ? "Update number" : "Save number"}
          </Button>
        }
      >
        <Field
          label="WhatsApp number"
          htmlFor="wa-number"
          hint="Include the country code, digits only — for example 919876543210."
          error={error}
        >
          <TextInput
            id="wa-number"
            type="tel"
            inputMode="numeric"
            maxLength={15}
            value={number}
            onChange={(e) => setNumber(digitsOnly(e.target.value))}
            placeholder="919876543210"
            hasError={Boolean(error)}
            aria-invalid={Boolean(error)}
          />
        </Field>

        {/* Shown only where it means something: this is the link the button on a
            lead will actually open, and seeing it is how you catch a typo. */}
        {!apiActive && cleaned.length >= 10 && (
          <div
            className="mt-4 rounded-lg border px-4 py-3 text-xs"
            style={{ borderColor: T.border, background: T.sidebar, color: T.muted }}
          >
            <p className="mb-1 font-semibold" style={{ color: T.text }}>
              <FaWhatsapp className="mr-1.5 inline" aria-hidden />
              Leads will be messaged from
            </p>
            <p className="font-mono break-all">+{cleaned}</p>
          </div>
        )}
      </Card>

      <Card title="How this works">
        <ul className="space-y-2.5 text-sm" style={{ color: T.muted }}>
          <li>
            <strong style={{ color: T.text }}>Without the Business API</strong> — clicking “Send
            WhatsApp” on a lead opens WhatsApp Web or the app on your device. The message is sent by
            you, from your number, and the CRM records that it was sent and what it said.
          </li>
          <li>
            <strong style={{ color: T.text }}>With the Business API</strong> — the CRM sends
            directly from the company number, using approved templates, and can reach leads who have
            never messaged you first. Your personal number stops being the sender automatically;
            there is nothing to switch off by hand.
          </li>
          <li>
            Your number is private to your account. Only an admin can change someone else’s.
          </li>
        </ul>
      </Card>
    </>
  );
}

/** One channel, with a live/off marker — used twice, so it is worth a name. */
function ChannelRow({
  title,
  live,
  detail,
}: {
  title: string;
  live: boolean;
  detail: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3.5"
      style={{
        borderColor: live ? T.success : T.border,
        background: live ? T.successSoft : T.sidebar,
      }}
    >
      <div className="flex-1">
        <p className="text-sm font-semibold" style={{ color: T.text }}>
          {title}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: T.muted }}>
          {detail}
        </p>
      </div>
      <StatusBadge status={live ? "active" : "inactive"}>{live ? "Live" : "Off"}</StatusBadge>
    </div>
  );
}
