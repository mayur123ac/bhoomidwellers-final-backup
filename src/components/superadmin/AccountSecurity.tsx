"use client";

// components/superadmin/AccountSecurity.tsx — the platform account's own
// credentials, inside Super Admin → Settings.
//
// Two independent forms rather than one. They have different consequences —
// changing the email leaves you signed in, changing the password signs everyone
// out — and a single Save button would hide that difference behind one click.
//
// Nothing here ever holds a password beyond the request that uses it: the fields
// are cleared on success and on failure, and no value is written to
// localStorage, a query string, or a log.

import { useEffect, useState } from "react";
import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";
import { Panel, SectionHead } from "./ui";

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "8+ characters", test: p => p.length >= 8 },
  { label: "uppercase", test: p => /[A-Z]/.test(p) },
  { label: "lowercase", test: p => /[a-z]/.test(p) },
  { label: "number", test: p => /[0-9]/.test(p) },
  { label: "symbol", test: p => /[^A-Za-z0-9]/.test(p) },
];

function Field({
  label, value, onChange, t, type = "text", placeholder, autoComplete, error, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void; t: SuperAdminTheme;
  type?: string; placeholder?: string; autoComplete?: string; error?: string; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium mb-1.5" style={{ color: t.textMuted }}>{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-colors disabled:opacity-60"
        style={{ background: t.raised, color: t.text, border: `1px solid ${error ? t.danger : "transparent"}` }}
        onFocus={e => { if (!error) e.currentTarget.style.borderColor = t.borderStrong; }}
        onBlur={e => { if (!error) e.currentTarget.style.borderColor = "transparent"; }}
      />
      {/* Validation errors sit directly under their own field. */}
      {error && <span className="block text-[11px] mt-1" style={{ color: t.danger }}>{error}</span>}
    </label>
  );
}

function Notice({ tone, text, t }: { tone: "ok" | "err"; text: string; t: SuperAdminTheme }) {
  const c = tone === "ok" ? t.positive : t.danger;
  return (
    <div
      className="rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed"
      style={{ color: c, background: tint(c, 0.1), border: `1px solid ${tint(c, 0.28)}` }}
    >
      {text}
    </div>
  );
}

export default function AccountSecurity({
  t, onSignedOut,
}: {
  t: SuperAdminTheme;
  /** Called after a password change, which revokes every session. */
  onSignedOut: () => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pwTouched, setPwTouched] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/platform/account");
        const json = await res.json();
        if (json.success) setEmail(json.data.email);
      } catch { /* the panel still works without it */ }
      finally { setLoading(false); }
    })();
  }, []);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim());
  const canSubmitEmail = emailValid && emailPassword.length > 0 && !emailBusy;

  const rulesOk = RULES.every(r => r.test(newPassword));
  const matchOk = confirmPassword.length > 0 && confirmPassword === newPassword;
  const canSubmitPw = currentPassword.length > 0 && rulesOk && matchOk && !pwBusy;

  async function submitEmail() {
    setEmailTouched(true);
    if (!canSubmitEmail) return;
    setEmailBusy(true); setEmailMsg(null);
    try {
      const res = await fetch("/api/platform/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: newEmail.trim(), currentPassword: emailPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not change the email address.");
      setEmail(json.data.email);
      setNewEmail("");
      setEmailTouched(false);
      setEmailMsg({ tone: "ok", text: `Email changed to ${json.data.email}. Sign in with it next time.` });
    } catch (e: any) {
      setEmailMsg({ tone: "err", text: e?.message || "Could not change the email address." });
    } finally {
      // Cleared whatever the outcome — a failed attempt should not leave the
      // password sitting in a form field.
      setEmailPassword("");
      setEmailBusy(false);
    }
  }

  async function submitPassword() {
    setPwTouched(true);
    if (!canSubmitPw) return;
    setPwBusy(true); setPwMsg(null);
    try {
      const res = await fetch("/api/platform/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not change the password.");
      setPwDone(true);
      setPwMsg({ tone: "ok", text: "Password changed. Every session has been signed out — signing you in again…" });
      // The server already cleared the cookie; give the confirmation a moment to
      // be read before leaving.
      setTimeout(onSignedOut, 2200);
    } catch (e: any) {
      setPwMsg({ tone: "err", text: e?.message || "Could not change the password." });
    } finally {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPwBusy(false);
    }
  }

  return (
    <section>
      <SectionHead t={t} title="Account Security" sub="Credentials for this platform account" />

      <Panel t={t}>
        {/* ── Current identity ── */}
        <div className="px-4 py-4" style={{ borderBottom: `1px solid ${t.border}` }}>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[12px]" style={{ color: t.textMuted }}>Email</span>
            <span className="text-[13px] font-medium text-right break-all" style={{ color: t.text }}>
              {loading ? "…" : email || "—"}
            </span>
          </div>
        </div>

        {/* ── Change email ── */}
        <div className="px-4 py-5 space-y-4" style={{ borderBottom: `1px solid ${t.border}` }}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: t.textMuted }}>
            Change Email
          </p>
          <Field
            t={t} label="New Email" value={newEmail} onChange={setNewEmail}
            type="email" placeholder="platform@example.com" autoComplete="off" disabled={emailBusy}
            error={emailTouched && !emailValid ? (newEmail.trim() ? "That is not a valid email address." : "A new email address is required.") : undefined}
          />
          <Field
            t={t} label="Current Password" value={emailPassword} onChange={setEmailPassword}
            type="password" autoComplete="current-password" disabled={emailBusy}
            error={emailTouched && emailPassword.length === 0 ? "Your current password is required." : undefined}
          />
          {emailMsg && <Notice tone={emailMsg.tone} text={emailMsg.text} t={t} />}
          <div className="flex justify-end">
            <button
              onClick={submitEmail}
              disabled={!canSubmitEmail}
              className="px-4 py-2 rounded-full text-[13px] font-semibold"
              style={{
                background: t.accent, color: "#fff",
                opacity: canSubmitEmail ? 1 : 0.45,
                cursor: canSubmitEmail ? "pointer" : "not-allowed",
              }}
            >
              {emailBusy ? "Changing…" : "Change Email"}
            </button>
          </div>
        </div>

        {/* ── Change password ──
            Visually distinct because it is the destructive one: it ends every
            session, including this one. */}
        <div className="px-4 py-5 space-y-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: t.textMuted }}>
              Change Password
            </p>
            <p className="text-[11px] mt-1" style={{ color: t.warning }}>
              Signs out every session, including this one. You will need to sign in again.
            </p>
          </div>

          <Field
            t={t} label="Current Password" value={currentPassword} onChange={setCurrentPassword}
            type="password" autoComplete="current-password" disabled={pwBusy || pwDone}
            error={pwTouched && currentPassword.length === 0 ? "Your current password is required." : undefined}
          />
          <div>
            <Field
              t={t} label="New Password" value={newPassword} onChange={setNewPassword}
              type="password" autoComplete="new-password" disabled={pwBusy || pwDone}
              error={pwTouched && !rulesOk ? "Password does not meet all requirements." : undefined}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {RULES.map(r => {
                const on = r.test(newPassword);
                return (
                  <span
                    key={r.label}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={on ? { color: t.positive, background: tint(t.positive, 0.12) } : { color: t.textMuted, background: t.raised }}
                  >
                    {r.label}
                  </span>
                );
              })}
            </div>
          </div>
          <Field
            t={t} label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword}
            type="password" autoComplete="new-password" disabled={pwBusy || pwDone}
            error={pwTouched && !matchOk ? (confirmPassword ? "Passwords do not match." : "Please confirm the new password.") : undefined}
          />
          {pwMsg && <Notice tone={pwMsg.tone} text={pwMsg.text} t={t} />}
          <div className="flex justify-end">
            <button
              onClick={submitPassword}
              disabled={!canSubmitPw || pwDone}
              className="px-4 py-2 rounded-full text-[13px] font-semibold"
              style={{
                background: tint(t.danger, 0.14),
                color: t.danger,
                border: `1px solid ${tint(t.danger, 0.35)}`,
                opacity: canSubmitPw && !pwDone ? 1 : 0.45,
                cursor: canSubmitPw && !pwDone ? "pointer" : "not-allowed",
              }}
            >
              {pwBusy ? "Changing…" : pwDone ? "Signed out" : "Change Password"}
            </button>
          </div>
        </div>
      </Panel>
    </section>
  );
}
