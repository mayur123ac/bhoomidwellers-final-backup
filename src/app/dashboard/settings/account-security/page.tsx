"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearCrmSession } from "@/lib/authSession";
import {
  Button,
  Card,
  Field,
  InfoBanner,
  Modal,
  OTPInput,
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

/* ── Password change (multi-step: Case A + Case B) ─────────────────────────*/

type PwStep = "current" | "otp" | "newPassword" | "done";
type PwMode = "change" | "recover";

function PasswordChangeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<PwMode>("change");
  const [step, setStep] = useState<PwStep>("current");

  // Step 1 — current password (Case A only)
  const [current, setCurrent] = useState("");
  // Step 2 — OTP
  const [otp, setOtp] = useState("");
  // Step 3 — new password
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  // Shared
  const [authToken, setAuthToken] = useState("");
  const [authExpiry, setAuthExpiry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  // Timer for auth token expiry
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setMode("change");
      setStep("current");
      setCurrent("");
      setOtp("");
      setNext("");
      setConfirm("");
      setAuthToken("");
      setAuthExpiry(0);
      setError(null);
      setInfo(null);
      setAttemptsRemaining(null);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    }
    return () => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [open]);

  const purpose = mode === "recover" ? "self_password_recovery" : "self_password_change";

  const rulesMet = Object.values(checkRules(next)).every(Boolean);
  const matches = next.length > 0 && next === confirm;

  // ── Case A Step 1: verify current password, server sends OTP ────────────
  const submitCurrentPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>("/api/settings/password/verify-current", {
        method: "POST",
        json: { currentPassword: current },
      });
      setInfo(res.message);
      setStep("otp");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Case B Step 1: request recovery OTP ─────────────────────────────────
  const requestRecoveryOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>("/api/settings/password/recover", {
        method: "POST",
        json: {},
      });
      setInfo(res.message);
      setMode("recover");
      setStep("otp");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Step 2: verify OTP → get authToken ──────────────────────────────────
  const submitOtp = async (code?: string) => {
    const otpValue = code ?? otp;
    if (!/^\d{6}$/.test(otpValue)) return;
    setBusy(true);
    setError(null);
    setAttemptsRemaining(null);
    try {
      const res = await api<{
        message: string;
        authToken: string;
        authExpiresInMinutes: number;
        restart?: boolean;
      }>("/api/settings/password/verify-otp", {
        method: "POST",
        json: { otp: otpValue, purpose },
      });
      setAuthToken(res.authToken);
      setAuthExpiry(res.authExpiresInMinutes);
      setInfo(`Code verified. You have ${res.authExpiresInMinutes} minutes to set a new password.`);
      setStep("newPassword");

      // Start expiry timer
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(() => {
        setError("Authorization expired. Please start over.");
        setStep("current");
        setAuthToken("");
        setOtp("");
        setNext("");
        setConfirm("");
        setInfo(null);
      }, res.authExpiresInMinutes * 60 * 1000);
    } catch (err: any) {
      const body = err;
      setError(err.message);
      if (body.attemptsRemaining != null) setAttemptsRemaining(body.attemptsRemaining);
      if (body.restart) {
        // OTP is locked/expired — must restart
        setOtp("");
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Step 3: change password ─────────────────────────────────────────────
  const submitNewPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>("/api/settings/password/change", {
        method: "POST",
        json: { authToken, newPassword: next, confirmPassword: confirm, purpose },
      });
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      setStep("done");
      toast("success", res.message);
      clearCrmSession();
      setTimeout(() => router.replace("/"), 2000);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  // ── "Forgot current password?" handler ──────────────────────────────────
  const handleForgot = () => {
    setError(null);
    setInfo(null);
    setCurrent("");
    requestRecoveryOtp();
  };

  // ── Render helpers ──────────────────────────────────────────────────────
  const stepTitle: Record<PwStep, string> = {
    current: "Change password",
    otp: "Enter verification code",
    newPassword: "Set new password",
    done: "Password changed",
  };

  const stepDescription: Record<PwStep, string> = {
    current: "Verify your identity before changing your password.",
    otp: mode === "recover"
      ? "A recovery code has been sent to your registered email."
      : "A verification code has been sent to your registered email.",
    newPassword: `You have ${authExpiry} minutes to set a new password. You'll be signed out afterwards.`,
    done: "You will be redirected to the login page.",
  };

  const canClose = step !== "done" && !busy;

  return (
    <Modal
      open={open}
      onClose={canClose ? onClose : () => {}}
      title={stepTitle[step]}
      description={stepDescription[step]}
      footer={
        step === "done" ? null : (
          <>
            {canClose && (
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            )}

            {step === "current" && (
              <Button
                onClick={submitCurrentPassword}
                loading={busy}
                disabled={!current}
              >
                Verify &amp; Send Code
              </Button>
            )}

            {step === "otp" && (
              <Button
                onClick={() => submitOtp()}
                loading={busy}
                disabled={!/^\d{6}$/.test(otp)}
              >
                Verify Code
              </Button>
            )}

            {step === "newPassword" && (
              <Button
                onClick={submitNewPassword}
                loading={busy}
                disabled={!rulesMet || !matches}
              >
                Update Password
              </Button>
            )}
          </>
        )
      }
    >
      {error && (
        <InfoBanner tone="warning">{error}</InfoBanner>
      )}

      {info && !error && step !== "done" && (
        <InfoBanner tone="info">{info}</InfoBanner>
      )}

      {/* ── Step 1: Current password (Case A) ─────────────────────────────── */}
      {step === "current" && (
        <>
          <Field label="Current Password" htmlFor="current-password" required>
            <TextInput
              id="current-password"
              type="password"
              value={current}
              hasError={Boolean(error)}
              onChange={(e) => { setCurrent(e.target.value); setError(null); }}
              autoComplete="current-password"
            />
          </Field>

          <button
            type="button"
            onClick={handleForgot}
            disabled={busy}
            className="mt-1 crm-body font-medium hover:underline"
            style={{ color: T.teal, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Forgot your current password?
          </button>
        </>
      )}

      {/* ── Step 2: OTP ───────────────────────────────────────────────────── */}
      {step === "otp" && (
        <>
          <Field label="6-digit code" htmlFor="pw-otp" required>
            <OTPInput
              value={otp}
              onChange={(v) => { setOtp(v); setError(null); }}
              disabled={busy}
              error={Boolean(error)}
              onComplete={(code) => submitOtp(code)}
            />
          </Field>

          {attemptsRemaining != null && attemptsRemaining > 0 && (
            <p className="mt-1 crm-caption" style={{ color: T.warning, fontWeight: 400 }}>
              {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} remaining.
            </p>
          )}
        </>
      )}

      {/* ── Step 3: New password ──────────────────────────────────────────── */}
      {step === "newPassword" && (
        <>
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
        </>
      )}

      {/* ── Step 4: Done ──────────────────────────────────────────────────── */}
      {step === "done" && (
        <InfoBanner tone="info">
          Your password has been changed and all sessions have been revoked.
          Redirecting to login...
        </InfoBanner>
      )}
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
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr className="text-left">
              <th className="border-b py-2.5 pr-4 crm-caption" style={{ borderColor: T.border, color: T.muted, fontWeight: 600 }}>
                Device
              </th>
              <th className="border-b py-2.5 pr-4 crm-caption" style={{ borderColor: T.border, color: T.muted, fontWeight: 600 }}>
                IP address
              </th>
              <th className="border-b py-2.5 pr-4 crm-caption" style={{ borderColor: T.border, color: T.muted, fontWeight: 600 }}>
                Started
              </th>
              <th className="border-b py-2.5 pr-4 crm-caption" style={{ borderColor: T.border, color: T.muted, fontWeight: 600 }}>
                Status
              </th>
              <th className="border-b py-2.5 crm-caption" style={{ borderColor: T.border, color: T.muted, fontWeight: 600 }} />
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="border-b py-3.5 pr-4 st-hover-surface transition-colors" style={{ borderColor: T.border, color: T.text }}>
                  <span className="crm-body font-medium">{session.device ?? "Unknown device"}</span>
                  {session.isCurrent && (
                    <span className="ml-2 crm-caption font-semibold" style={{ color: T.teal }}>
                      This device
                    </span>
                  )}
                </td>
                <td className="border-b py-3.5 pr-4" style={{ borderColor: T.border, color: T.muted }}>
                  <span className="crm-secondary">{session.ipAddress ?? "—"}</span>
                </td>
                <td className="border-b py-3.5 pr-4" style={{ borderColor: T.border, color: T.muted }}>
                  <span className="crm-secondary">{formatWhen(session.startedAt)}</span>
                </td>
                <td className="border-b py-3.5 pr-4" style={{ borderColor: T.border }}>
                  <StatusBadge status={session.isActive ? "active" : "inactive"}>
                    {session.isActive ? "Active" : "Ended"}
                  </StatusBadge>
                </td>
                <td className="border-b py-3.5 text-right" style={{ borderColor: T.border }}>
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
          <p className="crm-body" style={{ color: T.danger }}>
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
            For your account security, please update your password to the latest secure format.
            This will help protect your account and improve credential security.
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
          {[
            { label: "Account created", value: formatWhen(account.createdAt) },
            { label: "Last login", value: formatWhen(account.lastLoginAt) },
            { label: "Account status", badge: true },
            { label: "Password last changed", value: account.passwordChangedAt ? formatWhen(account.passwordChangedAt) : "Never" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-[14px] border px-4 py-3.5"
              style={{ borderColor: T.border, background: T.surfaceAlt }}
            >
              <dt className="crm-caption" style={{ color: T.muted, fontWeight: 500 }}>
                {item.label}
              </dt>
              {item.badge ? (
                <dd className="mt-1.5">
                  <StatusBadge status={account.status === "active" ? "active" : "danger"}>
                    {account.status === "active" ? "Active" : "Suspended"}
                  </StatusBadge>
                </dd>
              ) : (
                <dd className="mt-1 crm-body font-medium" style={{ color: T.text }}>
                  {item.value}
                </dd>
              )}
            </div>
          ))}
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
