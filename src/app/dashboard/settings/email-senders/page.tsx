"use client";

// Settings → Email Senders.
//
// This was a PlannedSection whose stated blocker was "the CRM cannot send email
// at all". That is no longer true: lib/email/ sends through Nodemailer over SMTP,
// with Resend available behind the same provider interface.
//
// What the page does now is the thing that was actually hard about email —
// telling you why it is not arriving. Configuration, a live credential check, a
// real test send, and the last ten failures with their classified cause, on one
// screen. Every one of those was previously a question you answered by reading
// server logs.
//
// Secrets are never fetched. The API returns the host, port and username; the
// password is not in the response at all, not even masked.

import { useCallback, useEffect, useState } from "react";
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

interface Problem {
  variable: string;
  message: string;
  severity: "error" | "warning";
}

interface Failure {
  created_at: string;
  email_type: string;
  recipient: string;
  destination: string;
  transport: string;
  error: string | null;
}

interface Status {
  provider: string;
  configured: boolean;
  sender: {
    fromName: string;
    fromEmail: string;
    replyTo: string;
    supportEmail: string;
    companyName: string;
    appUrl: string;
  };
  smtp: { host: string; port: number; secure: boolean; user: string } | null;
  problems: Problem[];
  stats: { total: number; delivered: number; failed: number };
  recentFailures: Failure[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 border-b py-2.5 last:border-b-0"
      style={{ borderColor: T.border }}
    >
      <span className="text-sm" style={{ color: T.muted }}>
        {label}
      </span>
      <span className="text-sm font-medium break-all" style={{ color: T.text }}>
        {value}
      </span>
    </div>
  );
}

export default function EmailSendersPage() {
  const toast = useToast();

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [testTo, setTestTo] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api<Status>("/api/settings/email-senders")
      .then(setStatus)
      .catch((err: unknown) => toast("error", messageOf(err)))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const verify = async () => {
    setVerifying(true);
    try {
      const result = await api<{ success: boolean; message: string }>(
        "/api/settings/email-senders",
        { method: "POST", json: { action: "verify" } }
      );
      toast(result.success ? "success" : "error", result.message);
    } catch (err: unknown) {
      toast("error", messageOf(err));
    } finally {
      setVerifying(false);
    }
  };

  const sendTest = async () => {
    setSending(true);
    try {
      const result = await api<{ success: boolean; message: string }>(
        "/api/settings/email-senders",
        { method: "POST", json: { action: "test", to: testTo.trim() } }
      );
      toast(result.success ? "success" : "error", result.message);
      // Reload either way: a test send adds a row to the delivery history, and
      // a failed one is exactly what the failures list below should now show.
      load();
    } catch (err: unknown) {
      toast("error", messageOf(err));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Email Senders" />
        <Card>
          <Skeleton rows={5} />
        </Card>
        <Card>
          <Skeleton rows={4} />
        </Card>
      </>
    );
  }

  if (!status) {
    return (
      <>
        <PageHeader title="Email Senders" />
        <Card>
          <p className="text-sm" style={{ color: T.danger }}>
            Could not load the mail configuration.
          </p>
          <div className="mt-4">
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          </div>
        </Card>
      </>
    );
  }

  const errors = status.problems.filter((p) => p.severity === "error");
  const warnings = status.problems.filter((p) => p.severity === "warning");

  return (
    <>
      <PageHeader
        title="Email Senders"
        subtitle="The transport every CRM email is sent through, and whether it is working."
      />

      {!status.configured && (
        <InfoBanner tone="warning">
          No mail transport is configured, so nothing is being sent — messages are written to the
          server console instead. Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>,{" "}
          <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> and <code>MAIL_FROM_EMAIL</code> in{" "}
          <code>.env.local</code>, then restart the server.
        </InfoBanner>
      )}

      <Card
        title="Transport"
        description="Read from the environment. Credentials are never sent to this page."
        footer={
          <Button variant="secondary" onClick={verify} loading={verifying}>
            Test connection
          </Button>
        }
      >
        <Row
          label="Provider"
          value={
            <StatusBadge status={status.configured ? "active" : "inactive"}>
              {status.provider}
            </StatusBadge>
          }
        />
        {status.smtp && (
          <>
            <Row label="SMTP host" value={status.smtp.host} />
            <Row
              label="Port"
              value={`${status.smtp.port} (${status.smtp.secure ? "implicit TLS" : "STARTTLS"})`}
            />
            <Row label="Username" value={status.smtp.user} />
          </>
        )}
        <Row label="From" value={`${status.sender.fromName} <${status.sender.fromEmail || "—"}>`} />
        <Row label="Reply-to" value={status.sender.replyTo || "—"} />
        <Row label="Support address" value={status.sender.supportEmail || "—"} />
        <Row label="Application URL" value={status.sender.appUrl || "Not set"} />
      </Card>

      {(errors.length > 0 || warnings.length > 0) && (
        <Card title="Configuration problems">
          <ul className="space-y-3">
            {[...errors, ...warnings].map((problem) => (
              <li key={`${problem.severity}-${problem.variable}-${problem.message}`} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-0.5 text-sm font-bold"
                  style={{ color: problem.severity === "error" ? T.danger : T.warning }}
                >
                  {problem.severity === "error" ? "✗" : "!"}
                </span>
                <div>
                  <code className="text-xs font-semibold" style={{ color: T.text }}>
                    {problem.variable}
                  </code>
                  <p className="mt-0.5 text-sm leading-relaxed" style={{ color: T.muted }}>
                    {problem.message}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Send a test email"
        description="Delivers a real message through the configured transport."
        footer={
          <Button onClick={sendTest} loading={sending} disabled={!testTo.trim()}>
            Send test email
          </Button>
        }
      >
        <Field label="Send to" htmlFor="test-to">
          <TextInput
            id="test-to"
            type="email"
            value={testTo}
            onChange={(event) => setTestTo(event.target.value)}
            placeholder="you@example.com"
          />
        </Field>
      </Card>

      <Card
        title="Delivery in the last 30 days"
        description="Every attempt the CRM has made, from email_delivery_attempts."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Attempted", value: status.stats.total, colour: T.text },
            { label: "Delivered", value: status.stats.delivered, colour: T.success },
            { label: "Failed", value: status.stats.failed, colour: T.danger },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border px-4 py-3"
              style={{ borderColor: T.border, background: T.sidebar }}
            >
              <div className="text-2xl font-semibold tabular-nums" style={{ color: stat.colour }}>
                {stat.value}
              </div>
              <div className="text-xs" style={{ color: T.muted }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {status.recentFailures.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold" style={{ color: T.text }}>
              Most recent failures
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr style={{ color: T.muted }}>
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Recipient</th>
                    <th className="py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {status.recentFailures.map((failure, index) => (
                    <tr
                      key={`${failure.created_at}-${index}`}
                      className="border-t align-top"
                      style={{ borderColor: T.border }}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: T.muted }}>
                        {new Date(failure.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: T.text }}>
                        {failure.email_type}
                      </td>
                      <td className="py-2 pr-3 break-all" style={{ color: T.text }}>
                        {failure.recipient}
                      </td>
                      <td className="py-2" style={{ color: T.muted }}>
                        {failure.error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
