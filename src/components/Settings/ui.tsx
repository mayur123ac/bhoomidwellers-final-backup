"use client";

// components/Settings/ui.tsx — the Settings design system.
//
// Settings is a panel *inside* the Admin Panel, so it wears the Admin Panel's
// skin: magenta accent (#9E217B light / #d946a8 dark) and the same light/dark
// surfaces, driven by the shared `crm_theme` preference.
//
// Every token below resolves to a CSS custom property rather than a literal.
// The tokens are consumed almost entirely through inline `style` objects across
// ~17 section pages, so routing them through variables lets SettingsShell flip
// the whole panel between light and dark by toggling one attribute — no page
// needs to know a theme exists. The variables themselves are declared in
// SETTINGS_THEME_CSS at the bottom of this file.
//
// Key names are historical (`teal`, `sidebar`) and kept so the section pages did
// not all have to change; `teal` is the accent, whatever colour that is today.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* ── Palette ────────────────────────────────────────────────────────────────*/

export const T = {
  /** Brand accent. Named `teal` for history; it is Bhoomi magenta. */
  teal: "var(--st-accent)",
  tealDark: "var(--st-accent-strong)",
  navy: "var(--st-accent-strong)",
  /** Recessed background — page behind the cards, card footers. */
  sidebar: "var(--st-surface-alt)",
  border: "var(--st-border)",
  text: "var(--st-text)",
  muted: "var(--st-muted)",
  success: "var(--st-success)",
  danger: "var(--st-danger)",
  warning: "var(--st-warning)",

  /* Raised surfaces — what used to be a literal `bg-white`. */
  surface: "var(--st-surface)",
  surfaceAlt: "var(--st-surface-alt)",
  surfaceHover: "var(--st-surface-hover)",

  /* Pre-mixed tints. Callers used to append an alpha suffix to a hex
     (`${T.teal}0d`); that cannot work on a var(), so the mixes are tokens. */
  accentSoft: "var(--st-accent-soft)",
  accentTint: "var(--st-accent-tint)",
  accentRing: "var(--st-accent-ring)",
  dangerSoft: "var(--st-danger-soft)",
  dangerRing: "var(--st-danger-ring)",
  dangerText: "var(--st-danger-text)",
  successSoft: "var(--st-success-soft)",
  successText: "var(--st-success-text)",
  warningSoft: "var(--st-warning-soft)",
  warningText: "var(--st-warning-text)",
  neutralSoft: "var(--st-neutral-soft)",
  neutralText: "var(--st-neutral-text)",
  /** Unfilled track: toggle off-state, progress bars, skeletons. */
  track: "var(--st-track)",
} as const;

/* ── Theme variables ────────────────────────────────────────────────────────
   Injected once by SettingsShell and scoped to `[data-st-theme]`, so nothing
   here leaks onto the dashboard screens that share the page.

   The values mirror the Admin/Employee pages: light mode sits on the pink-tinted
   gradient with white cards, dark mode on #0a0a0a with #111 panels. The accent
   lightens to #d946a8 on dark for the same reason the Admin rail does — #9E217B
   does not carry enough contrast against a near-black surface. */

export const SETTINGS_THEME_CSS = `
[data-st-theme="light"]{
  --st-accent:#9E217B;
  --st-accent-strong:#7d1a61;
  --st-accent-soft:rgba(158,33,123,0.06);
  --st-accent-tint:rgba(158,33,123,0.12);
  --st-accent-ring:rgba(158,33,123,0.30);
  --st-surface:#ffffff;
  --st-surface-alt:#F8FAFC;
  --st-surface-hover:rgba(158,33,123,0.05);
  --st-border:#E4E7EE;
  --st-text:#1A1A1A;
  --st-muted:#6B7280;
  --st-track:#E2E8F0;
  --st-neutral-soft:#EEF1F6;
  --st-neutral-text:#475569;
  --st-success:#10b981; --st-success-soft:rgba(16,185,129,0.12); --st-success-text:#047857;
  --st-danger:#ef4444;  --st-danger-soft:rgba(239,68,68,0.10);   --st-danger-text:#b91c1c;
  --st-danger-ring:rgba(239,68,68,0.35);
  --st-warning:#f59e0b; --st-warning-soft:rgba(245,158,11,0.12); --st-warning-text:#b45309;
}
[data-st-theme="dark"]{
  --st-accent:#d946a8;
  --st-accent-strong:#9E217B;
  --st-accent-soft:rgba(217,70,168,0.10);
  --st-accent-tint:rgba(217,70,168,0.18);
  --st-accent-ring:rgba(217,70,168,0.40);
  --st-surface:#1C1C1E;
  --st-surface-alt:#141414;
  --st-surface-hover:rgba(255,255,255,0.05);
  --st-border:rgba(255,255,255,0.08);
  --st-text:#EBEBF5;
  --st-muted:#8E8E93;
  --st-track:#2C2C2E;
  --st-neutral-soft:rgba(255,255,255,0.06);
  --st-neutral-text:#8E8E93;
  --st-success:#34d399; --st-success-soft:rgba(52,211,153,0.12); --st-success-text:#6ee7b7;
  --st-danger:#f87171;  --st-danger-soft:rgba(248,113,113,0.12); --st-danger-text:#fca5a5;
  --st-danger-ring:rgba(248,113,113,0.40);
  --st-warning:#fbbf24; --st-warning-soft:rgba(251,191,36,0.12); --st-warning-text:#fcd34d;
}
/* Hover wash for rows and icon buttons. A class rather than an inline style
   because :hover cannot be expressed in a React style object. */
[data-st-theme] .st-hover-surface:hover{background:var(--st-surface-hover)}
/* Native widgets (date pickers, scrollbars, select popups) render from the UA
   stylesheet, which has no idea about the tokens above. */
[data-st-theme="dark"]{ color-scheme: dark; }
[data-st-theme="light"]{ color-scheme: light; }
/* Apple-style focus ring for Settings inputs */
[data-st-theme] .st-input:focus{
  outline:none;
  box-shadow:0 0 0 3px var(--st-accent-ring);
  border-color:var(--st-accent);
}
/* Card hover lift */
[data-st-theme="light"] .st-card-hover:hover{box-shadow:0 4px 24px rgba(0,0,0,0.06)}
[data-st-theme="dark"] .st-card-hover:hover{box-shadow:0 4px 24px rgba(0,0,0,0.3)}
/* Smooth transitions for interactive elements */
[data-st-theme] .st-transition{transition:all 0.2s cubic-bezier(0.25,0.1,0.25,1)}
`;

/* ── Toasts ─────────────────────────────────────────────────────────────────*/

type ToastKind = "success" | "error" | "info" | "warning";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  push: (kind: ToastKind, message: string) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    const ttl = kind === "error" ? 8000 : 4000;
    setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), ttl);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  const kindIcon: Record<ToastKind, string> = {
    success: "\u2713",
    error: "\u2715",
    warning: "!",
    info: "i",
  };

  const kindBorder: Record<ToastKind, string> = {
    success: T.success,
    error: T.danger,
    warning: T.warning,
    info: T.teal,
  };

  const kindBg: Record<ToastKind, string> = {
    success: T.successSoft,
    error: T.dangerSoft,
    warning: T.warningSoft,
    info: T.accentSoft,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-[14px] border px-4 py-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] animate-fadeIn backdrop-blur-xl"
            style={{
              background: T.surface,
              borderColor: kindBorder[t.kind],
            }}
          >
            <span
              aria-hidden
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: kindBorder[t.kind] }}
            >
              {kindIcon[t.kind]}
            </span>
            <span className="crm-body" style={{ color: T.text }}>
              {t.message}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.push;
}

/* ── Layout blocks ──────────────────────────────────────────────────────────*/

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="crm-title-lg" style={{ color: T.text }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 crm-secondary" style={{ color: T.muted }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Card({
  title,
  description,
  children,
  footer,
  tone = "default",
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section
      className="mb-6 overflow-hidden rounded-[18px] border st-transition"
      style={{
        background: T.surface,
        borderColor: tone === "danger" ? T.danger : T.border,
        boxShadow: tone === "danger"
          ? undefined
          : "var(--st-card-shadow, 0 2px 12px rgba(0,0,0,0.03))",
      }}
    >
      {(title || description) && (
        <header className="border-b px-6 py-5" style={{ borderColor: T.border }}>
          {title && (
            <h2
              className="crm-section"
              style={{ color: tone === "danger" ? T.danger : T.text }}
            >
              {title}
            </h2>
          )}
          {description && (
            <p className="mt-1 crm-secondary" style={{ color: T.muted }}>
              {description}
            </p>
          )}
        </header>
      )}
      <div className="px-6 py-5">{children}</div>
      {footer && (
        <footer
          className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4"
          style={{ borderColor: T.border, background: T.surfaceAlt }}
        >
          {footer}
        </footer>
      )}
    </section>
  );
}

export function InfoBanner({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warning";
}) {
  const accent = tone === "warning" ? T.warning : T.teal;
  const wash = tone === "warning" ? T.warningSoft : T.accentSoft;
  const iconBg = tone === "warning" ? T.warningSoft : T.accentSoft;
  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-[14px] border px-4 py-3.5 crm-body"
      style={{ borderColor: accent, background: wash, color: T.text }}
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: iconBg, color: accent }}
      >
        {tone === "warning" ? "!" : "i"}
      </span>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/* ── Form controls ──────────────────────────────────────────────────────────*/

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label
        htmlFor={htmlFor}
        className="mb-2 block crm-label"
        style={{ color: T.text }}
      >
        {label}
        {required && (
          <span aria-hidden style={{ color: T.danger }}>
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1.5 crm-caption" style={{ color: T.danger }}>
          <span aria-hidden className="text-[10px]">\u2715</span>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 crm-caption" style={{ color: T.muted, fontWeight: 400 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-[10px] border px-3.5 py-2.5 text-[14px] leading-5 tracking-tight outline-none st-input st-transition disabled:cursor-not-allowed disabled:opacity-60";

export function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    borderColor: hasError ? T.danger : T.border,
    color: T.text,
    background: T.surface,
    ["--tw-ring-color" as any]: hasError ? T.dangerRing : T.accentRing,
  };
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }
) {
  const { hasError, style, className, ...rest } = props;
  return (
    <input
      {...rest}
      className={`${inputClass} ${className ?? ""}`}
      style={{ ...inputStyle(hasError), ...style }}
    />
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & { hasError?: boolean }
) {
  const { hasError, style, className, children, ...rest } = props;
  return (
    <select
      {...rest}
      className={`${inputClass} ${className ?? ""}`}
      style={{ ...inputStyle(hasError), ...style }}
    >
      {children}
    </select>
  );
}

export function Button({
  variant = "primary",
  loading,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
}) {
  const base =
    "inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-[10px] border px-5 text-[13px] font-semibold tracking-tight st-transition disabled:cursor-not-allowed disabled:opacity-50";

  const palette: Record<string, React.CSSProperties> = {
    primary: { background: T.teal, color: "#fff", borderColor: T.teal },
    secondary: { background: T.surface, color: T.text, borderColor: T.border },
    danger: { background: T.dangerSoft, color: T.dangerText, borderColor: "transparent" },
    ghost: { background: "transparent", color: T.teal, borderColor: "transparent" },
  };

  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`${base} hover:opacity-90`}
      style={palette[variant]}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: checked ? T.teal : T.track,
        ["--tw-ring-color" as any]: T.accentRing,
      }}
    >
      <span
        className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out"
        style={{ transform: checked ? "translateX(14px)" : "translateX(0)" }}
      />
    </button>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 border-b py-4 last:border-b-0"
      style={{ borderColor: T.border }}
    >
      <div className="flex-1">
        <p className="crm-body font-medium" style={{ color: T.text }}>
          {label}
        </p>
        {description && (
          <p className="mt-0.5 crm-secondary" style={{ color: T.muted }}>
            {description}
          </p>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

export function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  description,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: string;
  description?: string;
}) {
  const id = `${name}-${value}`;
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-[12px] border p-4 st-transition"
      style={{
        borderColor: checked ? T.teal : T.border,
        background: checked ? T.accentSoft : T.surface,
      }}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-0.5 h-4 w-4"
        style={{ accentColor: T.teal }}
      />
      <span>
        <span className="block crm-body font-medium" style={{ color: T.text }}>
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block crm-secondary" style={{ color: T.muted }}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  id,
  disabled,
  disabledReason,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-2.5 py-1.5 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          }`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded disabled:cursor-not-allowed"
          style={{ accentColor: T.teal }}
          aria-describedby={disabled && disabledReason ? `${id}-reason` : undefined}
        />
        <span className="crm-body" style={{ color: T.text }}>
          {label}
        </span>
      </label>
      {disabled && disabledReason && (
        <p id={`${id}-reason`} className="ml-7 crm-caption" style={{ color: T.muted, fontWeight: 400 }}>
          {disabledReason}
        </p>
      )}
    </div>
  );
}

export function StatusBadge({
  status,
  children,
}: {
  status: "active" | "pending" | "inactive" | "success" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  const map: Record<string, { bg: string; fg: string; icon: string }> = {
    active: { bg: T.successSoft, fg: T.successText, icon: "\u25CF" },
    success: { bg: T.successSoft, fg: T.successText, icon: "\u2713" },
    pending: { bg: T.warningSoft, fg: T.warningText, icon: "\u25D0" },
    inactive: { bg: T.neutralSoft, fg: T.neutralText, icon: "\u25CB" },
    danger: { bg: T.dangerSoft, fg: T.dangerText, icon: "\u2715" },
    neutral: { bg: T.neutralSoft, fg: T.neutralText, icon: "\u2022" },
  };
  const s = map[status] ?? map.neutral;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      <span aria-hidden>{s.icon}</span>
      {children}
    </span>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────────*/

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        panel.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ??
        panel.querySelector<HTMLElement>(
          "input:not([disabled]), button:not([disabled]), select, textarea"
        );
      target?.focus();
    }, 30);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = bodyOverflow;
      clearTimeout(timer);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-t-[20px] shadow-[0_20px_50px_rgba(0,0,0,0.2)] sm:rounded-[20px]`}
        style={{ background: T.surface }}
      >
        <header className="border-b px-6 py-5" style={{ borderColor: T.border }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="crm-title" style={{ color: T.text }}>
                {title}
              </h2>
              {description && (
                <p className="mt-1 crm-secondary" style={{ color: T.muted }}>
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-2 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-base st-hover-surface st-transition"
              style={{ color: T.muted }}
            >
              \u2715
            </button>
          </div>
        </header>

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <footer
            className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4"
            style={{ borderColor: T.border, background: T.surfaceAlt }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ── OTP input ──────────────────────────────────────────────────────────────*/

export function OTPInput({
  value,
  onChange,
  disabled,
  autoFocus = true,
  error,
  onComplete,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean;
  onComplete?: (code: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const toSlots = (raw: string): string[] => {
    const clean = raw.replace(/\D/g, "").slice(0, 6);
    return Array.from({ length: 6 }, (_, i) => clean[i] ?? "");
  };

  const [slots, setSlots] = useState<string[]>(() => toSlots(value));

  const slotsRef = useRef<string[]>(slots);

  useEffect(() => {
    const incoming = value.replace(/\D/g, "").slice(0, 6);
    if (incoming !== slotsRef.current.join("")) {
      const adopted = toSlots(incoming);
      slotsRef.current = adopted;
      setSlots(adopted);
    }
  }, [value]);

  const firstEmpty = slots.findIndex((slot) => slot === "");
  const activeIndex = firstEmpty === -1 ? 5 : firstEmpty;

  const caretRef = useRef(0);

  const focusBox = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, 5));
    const input = refs.current[clamped];
    if (!input) return;
    input.focus();
    input.select();
    caretRef.current = Math.max(0, Math.min(index, 6));
  }, []);

  const commit = useCallback(
    (edit: (previous: string[]) => { next: string[]; focus: number }) => {
      const { next, focus } = edit(slotsRef.current);

      slotsRef.current = next;
      setSlots(next);

      const emitted = next.join("");
      onChange(emitted);
      focusBox(focus);

      if (emitted.length === 6) onComplete?.(emitted);
    },
    [onChange, onComplete, focusBox]
  );

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const timer = setTimeout(() => focusBox(activeIndex), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, on purpose
  }, []);

  const handleChange = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;

    if (caretRef.current >= 6 && typed.length === 1) {
      setSlots(slotsRef.current.slice());
      return;
    }

    commit((previous) => {
      if (typed.length > 1) {
        const next = previous.slice();
        for (let i = 0; i < typed.length && index + i < 6; i++) next[index + i] = typed[i];
        return { next, focus: index + typed.length };
      }

      const next = previous.slice();
      next[index] = typed.slice(-1);
      return { next, focus: index + 1 };
    });
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      commit((previous) => {
        const next = previous.slice();
        if (next[index]) {
          next[index] = "";
          return { next, focus: index };
        }
        if (index > 0) {
          next[index - 1] = "";
          return { next, focus: index - 1 };
        }
        return { next, focus: 0 };
      });
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      commit((previous) => {
        const next = previous.slice();
        next[index] = "";
        return { next, focus: index };
      });
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusBox(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusBox(5);
      return;
    }

    if (
      event.key.length === 1 &&
      !/[0-9]/.test(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
    }
  };

  const handlePaste = (index: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;

    commit((previous) => {
      const next = previous.slice();
      for (let i = 0; i < pasted.length && index + i < 6; i++) next[index + i] = pasted[i];
      return { next, focus: Math.min(index + pasted.length, 5) };
    });
  };

  return (
    <div className="flex gap-2.5" role="group" aria-label="6-digit verification code">
      {slots.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          data-autofocus={i === 0 ? "true" : undefined}
          data-testid={`otp-${i}`}
          aria-label={`Digit ${i + 1} of 6`}
          maxLength={1}
          onMouseDown={(event) => {
            if (disabled) return;
            if (i > activeIndex) {
              event.preventDefault();
              focusBox(activeIndex);
            }
          }}
          onFocus={(event) => {
            event.currentTarget.select();
            caretRef.current = i;
          }}
          onChange={(event) => handleChange(i, event.target.value)}
          onKeyDown={(event) => handleKeyDown(i, event)}
          onPaste={(event) => handlePaste(i, event)}
          className="h-14 w-12 rounded-[12px] border text-center text-xl font-semibold outline-none st-input st-transition disabled:cursor-not-allowed disabled:opacity-50"
          style={inputStyle(error)}
        />
      ))}
    </div>
  );
}

/* ── Password strength ──────────────────────────────────────────────────────*/

export interface PasswordRules {
  length: boolean;
  upper: boolean;
  lower: boolean;
  number: boolean;
  special: boolean;
}

export function checkRules(password: string): PasswordRules {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export function PasswordStrengthIndicator({ password }: { password: string }) {
  const rules = checkRules(password);
  const met = Object.values(rules).filter(Boolean).length;
  const ratio = met / 5;

  const colour = ratio === 1 ? T.success : ratio >= 0.6 ? T.warning : T.danger;
  const label = ratio === 1 ? "Strong" : ratio >= 0.6 ? "Fair" : "Weak";

  const items: [keyof PasswordRules, string][] = [
    ["length", "At least 8 characters"],
    ["upper", "Contains uppercase letter (A-Z)"],
    ["lower", "Contains lowercase letter (a-z)"],
    ["number", "Contains number (0-9)"],
    ["special", "Contains special character (!@#$%^&*)"],
  ];

  return (
    <div className="mt-3">
      <div className="mb-2.5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: T.track }}>
          <div
            className="h-full rounded-full st-transition"
            style={{ width: `${Math.max(ratio * 100, password ? 8 : 0)}%`, background: colour }}
          />
        </div>
        {password && (
          <span className="crm-caption" style={{ color: colour }}>
            {label}
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {items.map(([key, text]) => (
          <li key={key} className="flex items-center gap-2 crm-caption" style={{ color: rules[key] ? T.success : T.muted, fontWeight: 400 }}>
            <span aria-hidden>{rules[key] ? "\u2713" : "\u25CB"}</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Searchable dropdown (used by the timezone picker) ──────────────────────*/

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search\u2026",
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle))
      : options;
    return matches.slice(0, 60);
  }, [options, search]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setSearch("");
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${inputClass} flex items-center justify-between text-left`}
        style={inputStyle(false)}
      >
        <span className="truncate">{selected?.label ?? "Select\u2026"}</span>
        <span aria-hidden style={{ color: T.muted }}>
          \u25BE
        </span>
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1.5 w-full rounded-[16px] border shadow-[0_12px_40px_rgba(0,0,0,0.12)] overflow-hidden backdrop-blur-2xl"
          style={{ background: T.surface, borderColor: T.border }}
        >
          <div className="border-b p-2.5" style={{ borderColor: T.border }}>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="w-full rounded-[10px] border px-3 py-2 text-[13px] tracking-tight outline-none st-input"
              style={inputStyle(false)}
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto custom-scrollbar py-1">
            {filtered.length === 0 && (
              <li className="px-3.5 py-2.5 crm-secondary" style={{ color: T.muted }}>
                No matches
              </li>
            )}
            {filtered.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 text-left text-[13px] tracking-tight rounded-[10px] mx-0 st-hover-surface st-transition"
                  style={{
                    color: T.text,
                    background: option.value === value ? T.accentTint : undefined,
                    fontWeight: option.value === value ? 600 : 400,
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── Loading / empty states ─────────────────────────────────────────────────*/

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-[10px]"
          style={{
            background: T.track,
            height: i === 0 ? "20px" : "44px",
            width: i === 0 ? "40%" : "100%",
          }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="py-12 text-center">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: T.neutralSoft }}
      >
        <span className="text-lg" style={{ color: T.muted }}>\u2014</span>
      </div>
      <p className="crm-body font-medium" style={{ color: T.text }}>
        {title}
      </p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md crm-secondary" style={{ color: T.muted }}>
          {description}
        </p>
      )}
    </div>
  );
}

/* ── Error boundary ─────────────────────────────────────────────────────────
   Per spec: one section throwing must not take the whole Settings panel with
   it. Wraps each page's content in the layout. */

export class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[Settings] section crashed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="rounded-[18px] border p-10 text-center"
          style={{ background: T.surface, borderColor: T.danger }}
        >
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: T.dangerSoft }}
          >
            <span className="text-lg" style={{ color: T.danger }}>\u2715</span>
          </div>
          <p className="crm-section" style={{ color: T.danger }}>
            This section failed to load
          </p>
          <p className="mx-auto mt-2 max-w-md crm-secondary" style={{ color: T.muted }}>
            {this.state.error.message}
          </p>
          <div className="mt-6">
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Fetch helper ───────────────────────────────────────────────────────────*/

export async function api<T = any>(
  url: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    cache: "no-store",
    headers: json ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed (${response.status})`);
    (error as any).status = response.status;
    (error as any).payload = payload;
    throw error;
  }

  return payload as T;
}
