"use client";

// components/superadmin/dialogs.tsx — the modal shell, form field and
// confirmation dialog the Super Admin write actions share.
//
// AddOrganizationModal shipped first and grew its own copies of the sheet
// geometry and the input styling. Rather than reach into that file and change a
// screen that already works, the shapes it established are extracted here and
// every NEW dialog uses them — so the panel gains four dialogs without gaining
// four opinions about what a modal looks like.
//
// The geometry is the one the panel already uses everywhere: a bottom sheet on
// phones, a centred dialog from `sm` up. Escape closes, the backdrop closes, and
// neither does while a submit is in flight — a dialog that vanishes mid-write
// leaves the operator unsure whether the write happened.

import { useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";

/* ── Modal ──────────────────────────────────────────────────────────────────*/

export function Modal({
  open, t, title, subtitle, onClose, busy = false, footer, children, wide = false,
}: {
  open: boolean;
  t: SuperAdminTheme;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Blocks Escape and backdrop dismissal while a request is in flight. */
  busy?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => !busy && onClose()}
            className="fixed inset-0 z-[140]"
            style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.985 }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className={[
              "fixed z-[150] flex flex-col overflow-hidden",
              "inset-x-0 bottom-0 max-h-[92vh] rounded-t-[26px]",
              wide
                ? "sm:inset-0 sm:m-auto sm:h-fit sm:w-[min(680px,calc(100vw-2rem))] sm:max-h-[88vh] sm:rounded-[26px]"
                : "sm:inset-0 sm:m-auto sm:h-fit sm:w-[min(480px,calc(100vw-2rem))] sm:max-h-[88vh] sm:rounded-[26px]",
            ].join(" ")}
            style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.28)" }}
          >
            <div className="flex-shrink-0 px-5 pt-3 pb-4" style={{ borderBottom: `1px solid ${t.border}` }}>
              {/* The grab handle only exists on the sheet form. */}
              <div className="sm:hidden flex justify-center pb-3">
                <span className="w-10 h-1 rounded-full" style={{ background: t.borderStrong }} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: t.text }}>{title}</h2>
                  {subtitle && (
                    <p className="text-[12px] mt-0.5" style={{ color: t.textMuted }}>{subtitle}</p>
                  )}
                </div>
                <button
                  onClick={() => !busy && onClose()}
                  aria-label="Close"
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: t.raised, color: t.textMuted }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

            {footer && (
              <div
                className="flex-shrink-0 flex flex-wrap items-center justify-end gap-2 px-5 py-4"
                style={{ borderTop: `1px solid ${t.border}` }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Buttons ────────────────────────────────────────────────────────────────*/

export function Btn({
  t, children, onClick, tone = "quiet", disabled, type = "button", title,
}: {
  t: SuperAdminTheme;
  children: ReactNode;
  onClick?: () => void;
  /** `quiet` for Cancel, `primary` for the one action, `danger` for destructive. */
  tone?: "quiet" | "primary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    quiet: { color: t.text, background: t.raised },
    primary: { color: "#fff", background: t.accent },
    danger: { color: "#fff", background: t.danger },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-4 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap transition-opacity"
      style={{
        ...styles[tone],
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────────*/

export function Field({
  label, value, onChange, t, type = "text", placeholder, autoComplete, error, hint, maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  t: SuperAdminTheme;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium mb-1.5" style={{ color: t.textMuted }}>{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-colors"
        style={{ background: t.raised, color: t.text, border: `1px solid ${error ? t.danger : "transparent"}` }}
        onFocus={e => { if (!error) e.currentTarget.style.borderColor = t.borderStrong; }}
        onBlur={e => { if (!error) e.currentTarget.style.borderColor = "transparent"; }}
      />
      {error
        ? <span className="block text-[11px] mt-1" style={{ color: t.danger }}>{error}</span>
        : hint ? <span className="block text-[11px] mt-1" style={{ color: t.textMuted }}>{hint}</span> : null}
    </label>
  );
}

export function TextArea({
  label, value, onChange, t, rows = 8, placeholder, hint, maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  t: SuperAdminTheme;
  rows?: number;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium mb-1.5" style={{ color: t.textMuted }}>{label}</span>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-colors resize-y leading-relaxed"
        style={{ background: t.raised, color: t.text, border: `1px solid transparent` }}
        onFocus={e => { e.currentTarget.style.borderColor = t.borderStrong; }}
        onBlur={e => { e.currentTarget.style.borderColor = "transparent"; }}
      />
      {hint && <span className="block text-[11px] mt-1" style={{ color: t.textMuted }}>{hint}</span>}
    </label>
  );
}

export function SelectField({
  label, value, onChange, options, t, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  t: SuperAdminTheme;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium mb-1.5" style={{ color: t.textMuted }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none appearance-none"
        style={{ background: t.raised, color: t.text, border: `1px solid transparent` }}
      >
        {options.map(o => (
          <option key={o} value={o} style={{ background: t.surface, color: t.text }}>{o}</option>
        ))}
      </select>
      {hint && <span className="block text-[11px] mt-1" style={{ color: t.textMuted }}>{hint}</span>}
    </label>
  );
}

export function Toggle({
  label, checked, onChange, t, hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  t: SuperAdminTheme;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 text-left"
      aria-pressed={checked}
    >
      <span
        className="mt-0.5 flex-shrink-0 w-9 h-5 rounded-full p-0.5 transition-colors"
        style={{ background: checked ? t.accent : t.raised, border: `1px solid ${checked ? t.accent : t.border}` }}
      >
        <span
          className="block w-4 h-4 rounded-full transition-transform"
          style={{ background: "#fff", transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium" style={{ color: t.text }}>{label}</span>
        {hint && <span className="block text-[11px] mt-0.5" style={{ color: t.textMuted }}>{hint}</span>}
      </span>
    </button>
  );
}

/* ── Feedback ───────────────────────────────────────────────────────────────*/

export function ErrorNote({ t, children }: { t: SuperAdminTheme; children: ReactNode }) {
  return (
    <div
      className="rounded-xl px-3.5 py-3 text-[12px] leading-relaxed"
      style={{ color: t.danger, background: tint(t.danger, 0.1), border: `1px solid ${tint(t.danger, 0.3)}` }}
    >
      {children}
    </div>
  );
}

/**
 * A confirmation for an action that cannot be undone by clicking again.
 *
 * Used for force logout, deactivation and organization suspension. The body says
 * what will happen in the real world ("this will terminate their active
 * session"), not what the code will do — the operator is deciding about a
 * person, not about a row.
 */
export function ConfirmDialog({
  open, t, title, body, confirmLabel, onConfirm, onCancel, busy = false, tone = "danger", error,
}: {
  open: boolean;
  t: SuperAdminTheme;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: "danger" | "primary";
  error?: string;
}) {
  return (
    <Modal
      open={open}
      t={t}
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <Btn t={t} tone="quiet" onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn t={t} tone={tone} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-[13px] leading-relaxed" style={{ color: t.textMuted }}>{body}</div>
        {error && <ErrorNote t={t}>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
