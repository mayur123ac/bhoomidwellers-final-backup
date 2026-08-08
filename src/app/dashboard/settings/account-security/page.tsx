"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearCrmSession } from "@/lib/authSession";
import {
  Button,
  Card,
  Field,
  InfoBanner,
  Modal,
  PageHeader,
  PasswordStrengthIndicator,
  Skeleton,
  StatusBadge,
  T,
  TextInput,
  api,
  checkRules,
  useToast,
} from "@/components/Settings/ui";
import NotificationRecipients from "@/components/Settings/NotificationRecipients";

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Password change ────────────────────────────────────────────────────────*/

function PasswordChangeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
    }
  }, [open]);

  const rulesMet = Object.values(checkRules(next)).every(Boolean);
  const matches = next.length > 0 && next === confirm;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings/password", {
        method: "POST",
        json: { currentPassword: current, newPassword: next, confirmPassword: confirm },
      });

      toast("success", "Password updated. Re-login required.");
      // The server already cleared the cookie. Clear the client cache too and
      // send them to the login screen, rather than leaving a signed-out browser
      // sitting on a page whose next request will 401.
      clearCrmSession();
      setTimeout(() => router.replace("/"), 1200);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      description="You'll be signed out and asked to sign in again with the new password."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!current || !rulesMet || !matches}>
            Update Password
          </Button>
        </>
      }
    >
      <Field label="Current Password" htmlFor="current-password" required error={error}>
        <TextInput
          id="current-password"
          type="password"
          value={current}
          hasError={Boolean(error)}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </Field>

      <Field label="New Password" htmlFor="new-password" required>
        <TextInput
          id="new-password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordStrengthIndicator password={next} />
      </Field>

      <Field
        label="Confirm Password"
        htmlFor="confirm-password"
        required
        error={confirm && !matches ? "Passwords do not match." : null}
      >
        <TextInput
          id="confirm-password"
          type="password"
          value={confirm}
          hasError={Boolean(confirm) && !matches}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
    </Modal>
  );
}

/* ── Deactivate ─────────────────────────────────────────────────────────────*/

function DeactivateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings/deactivate", { method: "POST", json: { password } });
      toast("success", "Your account has been deactivated.");
      clearCrmSession();
      setTimeout(() => router.replace("/"), 1200);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deactivate account"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!password}>
            Deactivate my account
          </Button>
        </>
      }
    >
      <InfoBanner tone="warning">
        This action cannot be undone by you. Your data will be archived, not deleted — leads,
        bookings and history stay intact — and only an admin can reactivate the account.
      </InfoBanner>

      <Field label="Confirm your password" htmlFor="deactivate-password" required error={error}>
        <TextInput
          id="deactivate-password"
          type="password"
          value={password}
          hasError={Boolean(error)}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
    </Modal>
  );
}

/* ── Sessions ───────────────────────────────────────────────────────────────*/

function SessionManager() {
  const toast = useToast();
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ sessions: any[] }>("/api/settings/sessions")
      .then((r) => setSessions(r.sessions))
      .catch((err) => toast("error", err.message));
  }, [toast]);

  useEffect(load, [load]);

  const signOut = async (sessionId: number | null) => {
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/api/settings/sessions", {
        method: "DELETE",
        json: sessionId ? { sessionId } : {},
      });
      toast("success", result.message);
      load();
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!sessions) return <Skeleton rows={3} />;

  const active = sessions.filter((s) => s.isActive);

  return (
    <>
      <InfoBanner tone="warning">
        Signing out a session ends its tracked activity and attendance timer. Because sign-in uses a
        stateless signed cookie with no revocation list, a browser that is already signed in keeps
        working until its 7-day session expires. Change your password if you need to be certain.
      </InfoBanner>

      <div className="-mx-6 overflow-x-auto px-6">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left" style={{ color: T.muted }}>
              <th className="border-b py-2.5 pr-4 font-medium" style={{ borderColor: T.border }}>
                Device
              </th>
              <th className="border-b py-2.5 pr-4 font-medium" style={{ borderColor: T.border }}>
                IP address
              </th>
              <th className="border-b py-2.5 pr-4 font-medium" style={{ borderColor: T.border }}>
                Started
              </th>
              <th className="border-b py-2.5 pr-4 font-medium" style={{ borderColor: T.border }}>
                Status
              </th>
              <th className="border-b py-2.5 font-medium" style={{ borderColor: T.border }} />
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="border-b py-3 pr-4" style={{ borderColor: T.border, color: T.text }}>
                  {session.device ?? "Unknown device"}
                  {session.isCurrent && (
                    <span className="ml-2 text-xs font-semibold" style={{ color: T.teal }}>
                      This device
                    </span>
                  )}
                </td>
                <td className="border-b py-3 pr-4" style={{ borderColor: T.border, color: T.muted }}>
                  {session.ipAddress ?? "—"}
                </td>
                <td className="border-b py-3 pr-4" style={{ borderColor: T.border, color: T.muted }}>
                  {formatWhen(session.startedAt)}
                </td>
                <td className="border-b py-3 pr-4" style={{ borderColor: T.border }}>
                  <StatusBadge status={session.isActive ? "active" : "inactive"}>
                    {session.isActive ? "Active" : "Ended"}
                  </StatusBadge>
                </td>
                <td className="border-b py-3 text-right" style={{ borderColor: T.border }}>
                  {session.isActive && (
                    <Button variant="ghost" onClick={() => signOut(session.id)} disabled={busy}>
                      Sign out
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active.length > 1 && (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => signOut(null)} disabled={busy}>
            Sign out all sessions
          </Button>
        </div>
      )}
    </>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────────*/

export default function AccountSecurityPage() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [passwordModal, setPasswordModal] = useState(false);
  const [deactivateModal, setDeactivateModal] = useState(false);
  const load = useCallback(() => {
    api<any>("/api/settings/account")
      .then(setData)
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  if (loading) {
    return (
      <>
        <PageHeader title="Account & Security" />
        <Card>
          <Skeleton rows={4} />
        </Card>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Account & Security" />
        <Card>
          <p className="text-sm" style={{ color: T.danger }}>
            Could not load your account. Try reloading the page.
          </p>
        </Card>
      </>
    );
  }

  const { user, account } = data;

  return (
    <>
      <PageHeader
        title="Account & Security"
        subtitle="Sign-in credentials, notification routing and active sessions."
      />

      <Card title="Login Credentials">
        <Field label="Current Email" hint="Change it from the Profile section, which verifies it by OTP.">
          <TextInput value={user.email ?? "Not set"} readOnly disabled />
        </Field>

        <Field label="Password">
          <div className="flex flex-wrap items-center gap-3">
            <TextInput value="••••••••" readOnly disabled className="flex-1 min-w-[200px]" />
            <Button variant="secondary" onClick={() => setPasswordModal(true)}>
              Change password
            </Button>
          </div>
        </Field>

        {/* Told plainly rather than hidden. Passwords in this CRM predate any
            hashing; the first change moves the account onto a scrypt hash, and
            until then the stored value is readable to anyone with database
            access. Saying so is what makes the "Change password" button above
            worth pressing. */}
        {!account.passwordHashed && (
          <InfoBanner tone="warning">
            Your password is still stored in the CRM&apos;s original plaintext format. Changing it
            here will store it as a salted scrypt hash instead. Until then, anyone with database
            access can read it.
          </InfoBanner>
        )}
      </Card>

      {/* Replaces the former three-way radio group. That control could express
          "current", "alternative" or "none" but never "both", because a radio
          group permits exactly one answer by construction. The component owns
          its own load/save cycle against /api/settings/notification-recipients
          rather than sharing this page's `data`, so the preview it renders is
          always the routing engine's own answer. */}
      <NotificationRecipients />

      <Card title="Account Status">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs" style={{ color: T.muted }}>
              Account created
            </dt>
            <dd className="mt-0.5 text-sm" style={{ color: T.text }}>
              {formatWhen(account.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: T.muted }}>
              Last login
            </dt>
            <dd className="mt-0.5 text-sm" style={{ color: T.text }}>
              {formatWhen(account.lastLoginAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: T.muted }}>
              Account status
            </dt>
            <dd className="mt-1">
              <StatusBadge status={account.status === "active" ? "active" : "danger"}>
                {account.status === "active" ? "Active" : "Suspended"}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="text-xs" style={{ color: T.muted }}>
              Password last changed
            </dt>
            <dd className="mt-0.5 text-sm" style={{ color: T.text }}>
              {account.passwordChangedAt ? formatWhen(account.passwordChangedAt) : "Never"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title={`Active sessions (${account.activeSessions})`}>
        <SessionManager />
      </Card>

      <Card
        title="Danger Zone"
        description="Deactivating archives your access. Your records stay in the CRM."
        tone="danger"
      >
        <Button variant="danger" onClick={() => setDeactivateModal(true)}>
          Deactivate Account
        </Button>
      </Card>

      <PasswordChangeModal open={passwordModal} onClose={() => setPasswordModal(false)} />
      <DeactivateModal open={deactivateModal} onClose={() => setDeactivateModal(false)} />
    </>
  );
}
