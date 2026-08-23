"use client";

// NotificationRecipients — where this user's CRM email is delivered.
//
// Two independent checkboxes rather than a three-way radio group, so "both" is
// expressible. A radio group permits exactly one answer by construction.
//
// ── The alternative-email workflow ──────────────────────────────────────────
// The email field behaves like every other editable settings field. There is no
// "Send OTP" button beside it and typing in it calls no API. Verification is a
// consequence of saving, not a precondition of it:
//
//   type an address        → the field is dirty, nothing else happens
//   Save Changes           → server validates and STAGES it, answers
//                            verificationRequired
//   modal step 1           → shows the address, asks permission to send
//   Send Verification Code → the only action that sends mail
//   modal step 2           → OTP entry, countdown, resend, change email
//   Verify & Save          → the address goes live, notifications switch on
//
// Closing the modal at any point saves nothing and leaves the typed address in
// the field as an unsaved change, so no work is lost.
//
// ── Why the preview is computed twice ───────────────────────────────────────
// Once here for instant feedback as boxes are ticked, and once on the server,
// which is authoritative and replaces the local answer after every save. If the
// two ever disagreed, the server's answer is what stays on screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Field,
  InfoBanner,
  Modal,
  OTPInput,
  StatusBadge,
  T,
  TextInput,
  Toggle,
  api,
  useToast,
} from "@/components/Settings/ui";

/* ── Server shapes ────────────────────────────────────────────────────────── */

export type VerificationStatus =
  | "not_added"
  | "pending_changes"
  | "awaiting_code"
  | "verified"
  | "failed";

interface VerificationState {
  status: VerificationStatus;
  alternativeEmail: string | null;
  pendingEmail: string | null;
  verifiedAt: string | null;
  sessionId: string | null;
  resendAvailableIn: number;
  otpExpiresIn: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  otpsSentThisHour: number;
  otpsRemainingThisHour: number;
  failureReason: string | null;
}

interface RecipientState {
  sendCurrentEmail: boolean;
  sendAlternativeEmail: boolean;
  currentEmail: string | null;
  alternativeEmail: string | null;
  alternativeEmailVerified: boolean;
  fallbackEnabled: boolean;
  verification: VerificationState;
  preview: { addresses: string[]; notes: string[]; disabled: boolean };
  deliveryConfigured: boolean;
}

interface SaveResponse {
  success: boolean;
  data: RecipientState;
  message?: string;
  verificationRequired?: boolean;
  pendingAddress?: string | null;
}

interface SendCodeResponse {
  success: boolean;
  message: string;
  address: string;
  sessionId: string;
  delivered: boolean;
  state: VerificationState;
}

interface VerifyResponse {
  success: boolean;
  message: string;
  address: string;
  state: VerificationState;
}

/** Error bodies carry a code and the refreshed state. */
type ApiErrorPayload = { code?: string; message?: string; state?: VerificationState };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function payloadOf(err: unknown): ApiErrorPayload | undefined {
  return (err as { payload?: ApiErrorPayload }).payload;
}

/** Same rule as lib/emailRouting.ts's isValidEmail — kept in step deliberately. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FAILURE_TEXT: Record<string, string> = {
  expired: "The last code expired before it was used.",
  too_many_attempts: "Too many incorrect attempts on the last code.",
};

/* ── Draft state, separate from what the server last confirmed ─────────────── */

interface Draft {
  sendCurrentEmail: boolean;
  sendAlternativeEmail: boolean;
  alternativeEmail: string;
  fallbackEnabled: boolean;
}

/**
 * The field shows the live address, or the staged candidate when one exists.
 *
 * A staged candidate takes precedence because it is the user's most recent
 * intent — coming back to a half-finished verification should show what you
 * typed, not what it is replacing.
 */
function draftFrom(state: RecipientState): Draft {
  return {
    sendCurrentEmail: state.sendCurrentEmail,
    sendAlternativeEmail: state.sendAlternativeEmail,
    alternativeEmail: state.verification.pendingEmail ?? state.alternativeEmail ?? "",
    fallbackEnabled: state.fallbackEnabled,
  };
}

export default function NotificationRecipients({
  onRecipientsChanged,
}: {
  /**
   * Fired after the server confirms a change to the delivery configuration.
   *
   * NotificationCenter renders directly below this on the Notifications screen
   * and previews the resolved delivery addresses. Without this the preview
   * would keep showing the addresses that were live when the page loaded, so
   * ticking "Verified alternative email" here would leave the summary six
   * inches lower confidently listing one address. It fires on the server's
   * response rather than on the click, so it never announces a change that did
   * not take.
   */
  onRecipientsChanged?: () => void;
} = {}) {
  const toast = useToast();

  const [state, setState] = useState<RecipientState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: RecipientState }>("/api/settings/notification-recipients");
      setState(res.data);
      setDraft(draftFrom(res.data));
    } catch (err) {
      toast("error", errorText(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  /* ── Dirty detection ──
     Compared field by field against what the server last confirmed, rather than
     tracked with a flag. A flag drifts the first time someone toggles a box and
     toggles it straight back — the flag stays true and Save stays lit over an
     identical payload. */
  const dirty = useMemo(() => {
    if (!state || !draft) return false;
    const base = draftFrom(state);
    return (
      base.sendCurrentEmail !== draft.sendCurrentEmail ||
      base.sendAlternativeEmail !== draft.sendAlternativeEmail ||
      base.fallbackEnabled !== draft.fallbackEnabled ||
      base.alternativeEmail.trim().toLowerCase() !== draft.alternativeEmail.trim().toLowerCase()
    );
  }, [state, draft]);

  /** True when the typed address differs from the LIVE one and so needs proving. */
  const addressNeedsVerification = useMemo(() => {
    if (!state || !draft) return false;
    const typed = draft.alternativeEmail.trim().toLowerCase();
    if (!typed) return false;
    return typed !== (state.alternativeEmail ?? "").trim().toLowerCase();
  }, [state, draft]);

  /* ── Live preview — mirrors resolveRecipients() on the server ─────────── */
  const preview = useMemo(() => {
    if (!state || !draft) return { addresses: [] as string[], notes: [] as string[] };

    const addresses: string[] = [];
    const notes: string[] = [];
    const seen = new Set<string>();

    const push = (value: string) => {
      const key = value.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      addresses.push(value.trim());
    };

    if (draft.sendCurrentEmail) {
      if (state.currentEmail && EMAIL_RE.test(state.currentEmail)) push(state.currentEmail);
      else notes.push("Your account email is missing or invalid, so it will be skipped.");
    }

    if (draft.sendAlternativeEmail) {
      // Only the LIVE address can ever be delivered to. A staged candidate is
      // shown in the field but must not appear here, or the preview would
      // promise delivery to an address that has not been proven.
      if (state.alternativeEmail) push(state.alternativeEmail);
      else notes.push("The alternative email is not verified yet, so it will be skipped.");
    }

    return { addresses, notes };
  }, [state, draft]);

  /* ── Save ─────────────────────────────────────────────────────────────── */

  const persist = useCallback(
    async (confirmDisableAll: boolean) => {
      if (!draft) return;
      setSaving(true);
      setFieldError(null);
      try {
        const res = await api<SaveResponse>("/api/settings/notification-recipients", {
          method: "PATCH",
          json: {
            sendCurrentEmail: draft.sendCurrentEmail,
            sendAlternativeEmail: draft.sendAlternativeEmail,
            alternativeEmail: draft.alternativeEmail.trim(),
            fallbackEnabled: draft.fallbackEnabled,
            confirmDisableAll,
          },
        });

        setState(res.data);
        setConfirmDisableOpen(false);

        if (res.verificationRequired && res.pendingAddress) {
          // The draft is deliberately NOT reset from the server here. The typed
          // address is still unsaved in the sense that matters, and resetting
          // would make the field flicker to the old value behind the modal.
          setVerifyFor(res.pendingAddress);
        } else {
          setDraft(draftFrom(res.data));
          toast(res.data.preview.disabled ? "info" : "success", res.message ?? "Saved.");
          onRecipientsChanged?.();
        }
      } catch (err) {
        const payload = payloadOf(err);

        if (payload?.code === "CONFIRM_DISABLE_ALL") {
          setConfirmDisableOpen(true);
          return;
        }
        // Address problems belong beside the field, not in a toast that vanishes
        // before the user has looked back at what they typed.
        if (payload?.code === "INVALID" || payload?.code === "SAME_AS_PRIMARY" ||
          payload?.code === "IN_USE" || payload?.code === "ALREADY_VERIFIED") {
          setFieldError(payload.message ?? "That address cannot be used.");
          return;
        }
        toast("error", errorText(err));
      } finally {
        setSaving(false);
      }
    },
    [draft, toast, onRecipientsChanged]
  );

  const onSave = () => {
    if (!draft) return;

    const typed = draft.alternativeEmail.trim();
    if (typed && !EMAIL_RE.test(typed)) {
      setFieldError("Enter a valid email address.");
      return;
    }

    // Only prompt about disabling everything when no verification is about to
    // start — otherwise the transient "nothing enabled yet" state during a
    // verification would trigger a warning about a decision nobody made.
    if (!draft.sendCurrentEmail && !draft.sendAlternativeEmail && !addressNeedsVerification) {
      setConfirmDisableOpen(true);
      return;
    }
    persist(false);
  };

  const discardChanges = () => {
    if (!state) return;
    setDraft(draftFrom(state));
    setFieldError(null);
  };

  /* ── Render ───────────────────────────────────────────────────────────── */

  if (loading || !state || !draft) {
    return (
      <Card title="Notification Recipients">
        <div className="space-y-3" aria-busy="true">
          <div className="h-4 w-2/3 animate-pulse rounded" style={{ background: T.track }} />
          <div className="h-4 w-1/2 animate-pulse rounded" style={{ background: T.track }} />
          <div className="h-4 w-3/5 animate-pulse rounded" style={{ background: T.track }} />
        </div>
      </Card>
    );
  }

  const v = state.verification;
  const typed = draft.alternativeEmail.trim();

  // The badge describes the TYPED value, which is what the user is looking at.
  const badge = (() => {
    if (!typed) return null;
    if (dirty && addressNeedsVerification) {
      return { tone: "pending" as const, label: "Changes not saved" };
    }
    if (typed.toLowerCase() === (state.alternativeEmail ?? "").toLowerCase()) {
      return { tone: "success" as const, label: "Verified" };
    }
    if (v.status === "failed") return { tone: "danger" as const, label: "Verification required" };
    if (v.status === "awaiting_code") return { tone: "pending" as const, label: "Awaiting code" };
    return { tone: "danger" as const, label: "Verification required" };
  })();

  return (
    <>
      <Card
        title="Notification Recipients"
        description="Choose every address that should receive CRM email. Both can be on at once."
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs" style={{ color: T.muted }} aria-live="polite">
              {dirty ? "You have unsaved changes." : "All changes saved."}
            </span>
            <div className="flex gap-2">
              {dirty && (
                <Button variant="secondary" onClick={discardChanges} disabled={saving}>
                  Discard
                </Button>
              )}
              <Button
                onClick={onSave}
                loading={saving}
                disabled={!dirty}
                // motion-safe so the pulse disappears for anyone who has asked
                // their OS for reduced motion.
                className={dirty ? "motion-safe:animate-pulse" : undefined}
              >
                Save Changes
              </Button>
            </div>
          </div>
        }
      >
        {!state.deliveryConfigured && (
          <InfoBanner tone="warning">
            No mail transport is configured, so nothing is being delivered yet. These preferences are
            saved and will take effect as soon as <code>SMTP_HOST</code>, <code>SMTP_USER</code>,{" "}
            <code>SMTP_PASSWORD</code> and <code>MAIL_FROM</code> are set.
          </InfoBanner>
        )}

        <p className="mb-4 text-sm" style={{ color: T.muted }}>
          Receive CRM notifications on:
        </p>

        {/* ── Current account email ── */}
        <div
          className="mb-3 rounded-lg border p-4"
          style={{
            borderColor: draft.sendCurrentEmail ? T.teal : T.border,
            background: draft.sendCurrentEmail ? T.accentSoft : "transparent",
          }}
        >
          <Checkbox
            id="recipient-current"
            checked={draft.sendCurrentEmail}
            onChange={(next) => setDraft({ ...draft, sendCurrentEmail: next })}
            label="Current account email"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 pl-7">
            <span className="text-sm font-medium break-all" style={{ color: T.text }}>
              {state.currentEmail ?? "Not set"}
            </span>
            <StatusBadge status="success">Verified</StatusBadge>
          </div>
          <p className="mt-1 pl-7 text-xs" style={{ color: T.muted }}>
            The address you sign in with. Change it from the Profile section.
          </p>
        </div>

        {/* ── Alternative email — an ordinary editable field ── */}
        <div
          className="mb-4 rounded-lg border p-4"
          style={{
            borderColor: draft.sendAlternativeEmail ? T.teal : T.border,
            background: draft.sendAlternativeEmail ? T.accentSoft : "transparent",
          }}
        >
          <Checkbox
            id="recipient-alternative"
            checked={draft.sendAlternativeEmail}
            onChange={(next) => setDraft({ ...draft, sendAlternativeEmail: next })}
            label="Alternative email"
            // Cannot be switched on without a live, verified address behind it.
            // Disabled with a stated reason rather than silently ignored, so the
            // box does not appear to do nothing when clicked.
            disabled={!state.alternativeEmail}
            disabledReason={
              state.alternativeEmail
                ? undefined
                : "Add and verify an alternative address to enable this."
            }
          />

          <div className="pl-7">
            <div className="mt-2">
              <Field
                label="Alternative address"
                htmlFor="alternative-email"
                hint="Saving a new address here asks you to verify it before it becomes active."
                error={fieldError}
              >
                <TextInput
                  id="alternative-email"
                  type="email"
                  value={draft.alternativeEmail}
                  hasError={Boolean(fieldError)}
                  onChange={(e) => {
                    // Typing calls no API and opens nothing. It marks the field
                    // dirty, exactly like every other settings input.
                    setDraft({ ...draft, alternativeEmail: e.target.value });
                    setFieldError(null);
                  }}
                  placeholder="name@gmail.com"
                  autoComplete="email"
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {badge && <StatusBadge status={badge.tone}>{badge.label}</StatusBadge>}

              {typed &&
                !dirty &&
                typed.toLowerCase() === (state.alternativeEmail ?? "").toLowerCase() &&
                v.verifiedAt && (
                  <span className="text-xs" style={{ color: T.muted }}>
                    Last verified on{" "}
                    {new Date(v.verifiedAt).toLocaleDateString(undefined, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
            </div>

            {!dirty && v.status === "failed" && v.failureReason && (
              <p className="mt-2 text-xs" style={{ color: T.dangerText }}>
                {FAILURE_TEXT[v.failureReason] ?? "The last verification attempt did not succeed."}{" "}
                Save again to start a new verification.
              </p>
            )}

            {!dirty && v.pendingEmail && v.status !== "failed" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs" style={{ color: T.warningText }}>
                  {v.pendingEmail} is waiting to be verified.
                </span>
                <Button variant="ghost" onClick={() => setVerifyFor(v.pendingEmail as string)}>
                  Continue verification
                </Button>
              </div>
            )}

            <p className="mt-2 text-xs" style={{ color: T.muted }}>
              Only verified alternative email addresses can receive CRM notifications.
            </p>
          </div>
        </div>

        {/* ── Delivery preview ── */}
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: preview.addresses.length === 0 ? T.warning : T.border,
            background: preview.addresses.length === 0 ? T.warningSoft : T.sidebar,
          }}
        >
          <h3 className="mb-2 text-sm font-semibold" style={{ color: T.text }}>
            Delivery preview
          </h3>

          {preview.addresses.length === 0 ? (
            <p className="text-sm font-medium" style={{ color: T.warningText }}>
              ⚠ Email notifications are disabled. Nothing will be sent to you — including security
              alerts such as password changes and new-device sign-ins.
            </p>
          ) : (
            <>
              <p className="text-sm" style={{ color: T.text }}>
                ✓{" "}
                {preview.addresses.length === 1
                  ? "Notifications will only be sent to:"
                  : "Notifications will be sent to:"}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {preview.addresses.map((address) => (
                  <li
                    key={address}
                    className="rounded-full px-3 py-1 text-xs font-medium break-all"
                    style={{ background: T.accentSoft, color: T.text }}
                  >
                    {address}
                  </li>
                ))}
              </ul>
            </>
          )}

          {preview.notes.length > 0 && (
            <ul className="mt-3 space-y-1">
              {preview.notes.map((note) => (
                <li key={note} className="text-xs" style={{ color: T.warningText }}>
                  • {note}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Fallback ── */}
        <div
          className="mt-4 flex items-start justify-between gap-4 rounded-lg border p-4"
          style={{ borderColor: T.border }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: T.text }}>
              Automatic fallback
            </p>
            <p className="mt-1 text-xs" style={{ color: T.muted }}>
              If delivery to the account email fails, notifications are sent automatically to the
              verified alternative address — even when the alternative is switched off above. This
              needs a verified alternative address to do anything.
            </p>
          </div>
          <Toggle
            checked={draft.fallbackEnabled}
            onChange={(next) => setDraft({ ...draft, fallbackEnabled: next })}
            label="Automatic fallback to the alternative address"
          />
        </div>
      </Card>

      {/* ── Disable-all confirmation ── */}
      <Modal
        open={confirmDisableOpen}
        onClose={() => setConfirmDisableOpen(false)}
        title="Disable all email notifications?"
        description="You are about to turn off every email destination."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDisableOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => persist(true)} loading={saving}>
              Disable all email
            </Button>
          </>
        }
      >
        <InfoBanner tone="warning">
          This includes security alerts. You will not be told about password changes, sign-ins from
          new devices, or failed login attempts on your account.
        </InfoBanner>
        <p className="text-sm" style={{ color: T.muted }}>
          In-app notifications are unaffected — this only turns off email.
        </p>
      </Modal>

      {/* ── Verification ── */}
      {verifyFor && (
        <VerificationModal
          address={verifyFor}
          initialState={state.verification}
          onClose={async () => {
            // Nothing is saved. The typed address stays in the field as an
            // unsaved change, and Save stays enabled, so the user can resume.
            setVerifyFor(null);
            await load();
            setDraft((d) => (d ? { ...d, alternativeEmail: verifyFor } : d));
          }}
          onChangeEmail={() => {
            setVerifyFor(null);
            // Returns focus to the field so "Change Email" lands where expected.
            requestAnimationFrame(() => {
              document.getElementById("alternative-email")?.focus();
            });
          }}
          onVerified={async (message) => {
            setVerifyFor(null);
            await load();
            toast("success", message);
            // Verification is the other way the delivery list changes: the
            // address goes live and becomes a recipient.
            onRecipientsChanged?.();
          }}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Verification modal — two steps, one dialog
   ══════════════════════════════════════════════════════════════════════════ */

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/**
 * A single ticking clock for the modal.
 *
 * Remaining seconds are DERIVED from absolute deadlines rather than held in
 * state and decremented. Deadlines are self-correcting: a tab asleep for two
 * minutes wakes showing the right number, because the value comes from the clock
 * rather than from how many ticks were missed. The clock is only read inside
 * effects, never during render.
 */
function useCountdowns(state: VerificationState) {
  const [remaining, setRemaining] = useState({
    resend: state.resendAvailableIn,
    expiry: state.otpExpiresIn,
  });

  const deadlines = useRef<{ resendAt: number; expiresAt: number } | null>(null);

  useEffect(() => {
    const base = Date.now();
    deadlines.current = {
      resendAt: base + state.resendAvailableIn * 1000,
      expiresAt: base + state.otpExpiresIn * 1000,
    };
  }, [state]);

  useEffect(() => {
    // 250ms rather than 1s: the displayed value still changes once a second, but
    // a fresh deadline after a resend appears almost immediately instead of
    // after up to a full second of a stale number.
    const id = setInterval(() => {
      const d = deadlines.current;
      if (!d) return;
      const now = Date.now();
      setRemaining({
        resend: Math.max(0, Math.ceil((d.resendAt - now) / 1000)),
        expiry: Math.max(0, Math.ceil((d.expiresAt - now) / 1000)),
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  return remaining;
}

function VerificationModal({
  address,
  initialState,
  onClose,
  onChangeEmail,
  onVerified,
}: {
  address: string;
  initialState: VerificationState;
  onClose: () => void | Promise<void>;
  onChangeEmail: () => void;
  onVerified: (message: string) => void | Promise<void>;
}) {
  const toast = useToast();
  const [state, setState] = useState<VerificationState>(initialState);
  // A code may already be outstanding — the user closed the modal and came back.
  // Opening straight on the OTP step avoids forcing a resend the cooldown would
  // refuse anyway.
  const [step, setStep] = useState<"confirm" | "code">(
    initialState.otpExpiresIn > 0 ? "code" : "confirm"
  );
  const [sessionId, setSessionId] = useState<string | null>(initialState.sessionId);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const { resend, expiry } = useCountdowns(state);
  const outOfCodes = state.otpsRemainingThisHour <= 0;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<SendCodeResponse>("/api/settings/notification-recipients/verify", {
        method: "POST",
      });
      setState(res.state);
      setSessionId(res.sessionId);
      setOtp("");
      setStep("code");
      toast(res.delivered ? "success" : "info", res.message);
    } catch (err) {
      const payload = payloadOf(err);
      if (payload?.state) setState(payload.state);
      setError(payload?.message ?? errorText(err));
      // A cooldown or hourly-limit refusal still belongs on the OTP step — a
      // code is outstanding, and the user should be entering it.
      if (payload?.code === "COOLDOWN") setStep("code");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<VerifyResponse>("/api/settings/notification-recipients/verify", {
        method: "PUT",
        json: { otp, sessionId },
      });
      setState(res.state);
      // Shown for a beat before closing. Closing instantly on a toast makes it
      // ambiguous whether the code was accepted or the dialog was dismissed.
      setSucceeded(true);
      setTimeout(() => void onVerified(res.message), 1200);
    } catch (err) {
      const payload = payloadOf(err);
      if (payload?.state) setState(payload.state);
      // The typed address is NOT discarded and the modal stays open.
      setError(payload?.message ?? errorText(err));
      setOtp("");
    } finally {
      setBusy(false);
    }
  };

  if (succeeded) {
    return (
      <Modal
        open
        onClose={() => void onVerified("Alternative email verified and saved successfully.")}
        title="Verified"
        description=""
        footer={
          <Button onClick={() => void onVerified("Alternative email verified and saved successfully.")}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-3xl motion-safe:animate-[ping_0.7s_ease-out_1]"
            style={{ background: T.successSoft, color: T.successText }}
            aria-hidden
          >
            ✓
          </div>
          <p className="text-base font-semibold" style={{ color: T.successText }} role="status">
            Alternative email verified and saved successfully.
          </p>
          <p className="text-sm break-all" style={{ color: T.muted }}>
            {address} is now active and will receive CRM notifications.
          </p>
        </div>
      </Modal>
    );
  }

  /* ── Step 1: permission to send ── */
  if (step === "confirm") {
    return (
      <Modal
        open
        onClose={() => void onClose()}
        title="Verify Alternative Email"
        description=""
        footer={
          <>
            <Button variant="secondary" onClick={() => void onClose()} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={sendCode} loading={busy} disabled={outOfCodes}>
              Send Verification Code
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm" style={{ color: T.text }}>
          To protect your account, we&apos;ll send a 6-digit verification code to:
        </p>
        <p
          className="mb-4 rounded-lg border px-3 py-2 text-sm font-semibold break-all"
          style={{ borderColor: T.border, background: T.neutralSoft, color: T.text }}
        >
          {address}
        </p>
        <p className="mb-3 text-sm" style={{ color: T.muted }}>
          This email will not become active until the code is verified.
        </p>

        {error && (
          <p className="mb-3 text-sm" style={{ color: T.dangerText }} role="alert">
            {error}
          </p>
        )}
        {outOfCodes && (
          <InfoBanner tone="warning">
            You have requested 5 codes in the last hour, which is the limit. Try again later.
          </InfoBanner>
        )}
      </Modal>
    );
  }

  /* ── Step 2: the code ── */
  return (
    <Modal
      open
      onClose={() => void onClose()}
      title="Enter Verification Code"
      description=""
      footer={
        <>
          <Button variant="secondary" onClick={() => setStep("confirm")} disabled={busy}>
            Back
          </Button>
          <Button onClick={verify} loading={busy} disabled={otp.length !== 6 || expiry <= 0}>
            Verify &amp; Save
          </Button>
        </>
      }
    >
      <p className="mb-1 text-sm" style={{ color: T.text }}>
        We&apos;ve sent a 6-digit verification code to
      </p>
      <p className="mb-4 text-sm font-semibold break-all" style={{ color: T.text }}>
        {address}
      </p>

      <Field
        label="Verification code"
        hint={
          expiry > 0
            ? `Expires in ${formatDuration(expiry)}.`
            : "This code has expired. Request a new one."
        }
        error={error}
      >
        <OTPInput value={otp} onChange={setOtp} disabled={busy || expiry <= 0} />
      </Field>

      {state.attemptsUsed > 0 && state.attemptsRemaining > 0 && (
        <p className="mb-3 text-xs" style={{ color: T.warningText }}>
          {state.attemptsRemaining} attempt{state.attemptsRemaining === 1 ? "" : "s"} remaining on
          this code.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={sendCode} disabled={busy || resend > 0 || outOfCodes}>
          {resend > 0 ? `Resend Code in ${resend}s` : "Resend Code"}
        </Button>
        <Button variant="ghost" onClick={onChangeEmail} disabled={busy}>
          Change Email
        </Button>
        <span className="text-xs" style={{ color: T.muted }}>
          {state.otpsRemainingThisHour} of 5 codes left this hour
        </span>
      </div>
    </Modal>
  );
}
