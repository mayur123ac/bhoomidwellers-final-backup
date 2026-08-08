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
  --st-surface:#111111;
  --st-surface-alt:#0f0f0f;
  --st-surface-hover:rgba(255,255,255,0.05);
  --st-border:#242424;
  --st-text:#ffffff;
  --st-muted:#9CA3AF;
  --st-track:#2a2a2a;
  --st-neutral-soft:#1e1e1e;
  --st-neutral-text:#9CA3AF;
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
    // Errors linger — they usually carry something the user has to read and act
    // on, and a validation message that vanishes in 3s has to be re-triggered
    // to be read.
    const ttl = kind === "error" ? 8000 : 4000;
    setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), ttl);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // pointer-events-none on the CONTAINER, restored on each toast below.
        // This layer sits at z-100, above the z-90 modal, so a visible toast
        // would otherwise swallow clicks aimed at whatever is underneath it —
        // on a short viewport that includes the OTP boxes in the centred
        // dialog. Toasts are purely informational and never need the clicks.
        className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg animate-fadeIn"
            style={{
              background: T.surface,
              borderColor:
                t.kind === "success"
                  ? T.success
                  : t.kind === "error"
                  ? T.danger
                  : t.kind === "warning"
                  ? T.warning
                  : T.teal,
            }}
          >
            <span aria-hidden className="text-base leading-none">
              {t.kind === "success" ? "✓" : t.kind === "error" ? "✕" : t.kind === "warning" ? "!" : "i"}
            </span>
            <span className="text-sm" style={{ color: T.text }}>
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
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: T.text }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: T.muted }}>
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
      className="mb-6 rounded-xl border"
      style={{ background: T.surface, borderColor: tone === "danger" ? T.danger : T.border }}
    >
      {(title || description) && (
        <header className="border-b px-6 py-4" style={{ borderColor: T.border }}>
          {title && (
            <h2
              className="text-base font-semibold"
              style={{ color: tone === "danger" ? T.danger : T.text }}
            >
              {title}
            </h2>
          )}
          {description && (
            <p className="mt-1 text-sm" style={{ color: T.muted }}>
              {description}
            </p>
          )}
        </header>
      )}
      <div className="px-6 py-5">{children}</div>
      {footer && (
        <footer
          className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4"
          style={{ borderColor: T.border, background: T.sidebar }}
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
  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
      style={{ borderColor: accent, background: wash, color: T.text }}
    >
      <span aria-hidden className="font-bold leading-5">
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
    <div className="mb-4">
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium"
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
      {/* Errors carry an icon as well as colour, so the state does not depend on
          being able to distinguish red from grey. */}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: T.danger }}>
          <span aria-hidden>✕</span>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs" style={{ color: T.muted }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60";

export function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    borderColor: hasError ? T.danger : T.border,
    color: T.text,
    background: T.surface,
    // Tailwind's ring colour utilities would need config; setting the custom
    // property directly keeps the focus ring on-accent without touching the
    // shared Tailwind theme that the dashboard screens also use.
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
  const palette: Record<string, React.CSSProperties> = {
    primary: { background: T.teal, color: "#fff", borderColor: T.teal },
    secondary: { background: T.surface, color: T.text, borderColor: T.border },
    danger: { background: T.danger, color: "#fff", borderColor: T.danger },
    ghost: { background: "transparent", color: T.teal, borderColor: "transparent" },
  };

  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      // 44px min height — the spec's touch-target floor, and it applies on
      // desktop too rather than only under a media query.
      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
      className="relative h-7 w-[52px] flex-shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: checked ? T.teal : T.track,
        ["--tw-ring-color" as any]: T.accentRing,
      }}
    >
      <span
        className="absolute top-0.5 left-0.5 h-6 w-6 rounded-full shadow transition-transform"
        style={{ background: "#fff", transform: checked ? "translateX(24px)" : "translateX(0)" }}
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
      className="flex items-start justify-between gap-4 border-b py-3.5 last:border-b-0"
      style={{ borderColor: T.border }}
    >
      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: T.text }}>
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-xs" style={{ color: T.muted }}>
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
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors"
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
        <span className="block text-sm font-medium" style={{ color: T.text }}>
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs" style={{ color: T.muted }}>
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
  /** Shown beneath the label when disabled, to say WHY it cannot be ticked. */
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
        className={`flex items-center gap-2.5 py-1.5 ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
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
          // Points at the explanation below rather than relying on the visual
          // dimming, which conveys nothing to a screen reader.
          aria-describedby={disabled && disabledReason ? `${id}-reason` : undefined}
        />
        <span className="text-sm" style={{ color: T.text }}>
          {label}
        </span>
      </label>
      {disabled && disabledReason && (
        <p id={`${id}-reason`} className="ml-7 text-xs" style={{ color: T.muted }}>
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
    active: { bg: T.successSoft, fg: T.successText, icon: "●" },
    success: { bg: T.successSoft, fg: T.successText, icon: "✓" },
    pending: { bg: T.warningSoft, fg: T.warningText, icon: "◐" },
    inactive: { bg: T.neutralSoft, fg: T.neutralText, icon: "○" },
    danger: { bg: T.dangerSoft, fg: T.dangerText, icon: "✕" },
    neutral: { bg: T.neutralSoft, fg: T.neutralText, icon: "•" },
  };
  const s = map[status] ?? map.neutral;

  return (
    // Icon plus text, never colour alone.
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
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

  // ── Why onClose lives in a ref ──────────────────────────────────────────
  // Every caller passes an inline arrow — `onClose={() => setModal(false)}` —
  // so `onClose` is a NEW function identity on every parent render. With it in
  // the dependency array below, the effect tore down and re-ran after every
  // keystroke, and its cleanup calls `previouslyFocused.focus()`.
  //
  // That stole focus out of whatever the user was typing into and threw it back
  // to the element that opened the dialog, ~30ms before the re-run dragged it
  // to the first input. In the OTP dialog it looked exactly like the boxes
  // could not accept keyboard input at all: a digit would land, focus would
  // jump away, and the next keystroke went nowhere.
  //
  // The ref keeps the handler current without making it a dependency, so the
  // effect now runs once per open/close — which is the only time any of the
  // things it does (trap focus, lock scroll, restore focus) should happen.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Escape to close, and a focus trap so tabbing cannot wander behind the
  // overlay onto controls the user cannot see.
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

    // Move focus into the dialog so a screen reader announces it and the first
    // Tab lands inside rather than on the page behind.
    //
    // `[data-autofocus]` wins when present. Without it the first focusable
    // element is whatever happens to sit highest in the DOM — in the OTP dialog
    // that is a "Change email" link, not the code boxes, so the caret landed
    // somewhere the user then had to click away from.
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
      // Only on genuine close/unmount now. Previously this also ran on every
      // re-render, which is what made typing impossible.
      previouslyFocused?.focus?.();
    };
    // `open` only. onClose is reached through onCloseRef, which the exhaustive
    // deps rule correctly does not require as a dependency — see the note above
    // for why it must not be one.
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-t-2xl shadow-2xl sm:rounded-2xl`}
        style={{ background: T.surface }}
      >
        <header className="border-b px-6 py-4" style={{ borderColor: T.border }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: T.text }}>
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-sm" style={{ color: T.muted }}>
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-lg text-xl st-hover-surface"
              style={{ color: T.muted }}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <footer
            className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4"
            style={{ borderColor: T.border, background: T.sidebar }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ── OTP input ──────────────────────────────────────────────────────────────*/

/**
 * Six-box one-time-code entry.
 *
 * ── Six slots internally, a digits-only string outwards ─────────────────────
 * The boxes are backed by a fixed six-element array held in this component, not
 * derived from the `value` prop. Two things forced that, and both were bugs
 * found by the tests rather than by reading the code:
 *
 * 1. Deriving each render from `value` loses fast keystrokes. Two keys pressed
 *    inside one React batch both read the same stale prop, so the second
 *    overwrites the first — typing "4281" quickly landed as "42".
 *
 * 2. A slot has to be able to be empty *in place*. Backspacing the middle of
 *    "428170" must leave box 3 blank, not slide "70" left by one. A plain
 *    string cannot express a hole without a placeholder, and the previous
 *    implementation used a literal space — which was then submitted to the
 *    server inside the code, and made `otp.length === 6` (how both callers
 *    enable their Verify button) true for values that were not six digits.
 *
 * Outwards, `onChange` emits the slots joined with holes dropped. So a complete
 * code is exactly six characters and an incomplete one is shorter, which is the
 * check the callers already make, and no space ever escapes.
 *
 * ── Focus ───────────────────────────────────────────────────────────────────
 * `key={i}` is stable over a fixed-length array, so React updates these inputs
 * in place and never remounts them; typing cannot lose focus here. The bug that
 * made this component feel dead was not in this file at all — it was Modal's
 * focus effect re-running on every render. See the note there.
 */
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
  /** Focus the first empty box on mount. On by default. */
  autoFocus?: boolean;
  error?: boolean;
  /** Fired once the sixth digit lands, for submit-on-complete. */
  onComplete?: (code: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const toSlots = (raw: string): string[] => {
    const clean = raw.replace(/\D/g, "").slice(0, 6);
    return Array.from({ length: 6 }, (_, i) => clean[i] ?? "");
  };

  const [slots, setSlots] = useState<string[]>(() => toSlots(value));

  // ── Why the slots are mirrored in a ref ─────────────────────────────────
  // React does not run a setState updater synchronously during the event
  // handler — it runs during the next render. So an edit cannot both read the
  // previous slots and emit the new string from inside the updater; the emitted
  // value would still be null when the handler finished.
  //
  // The ref is the synchronous copy. Each keystroke reads it, writes it, and
  // emits from it immediately, so two keys pressed inside one React batch chain
  // correctly instead of both reading the same stale array.
  const slotsRef = useRef<string[]>(slots);

  // Adopt the prop when it disagrees with what these boxes are showing — a
  // parent resetting to "" after a failed attempt, or seeding a code. Compared
  // against the dense join because that is exactly what this component last
  // emitted, so its own updates never round-trip back and clobber a hole.
  useEffect(() => {
    const incoming = value.replace(/\D/g, "").slice(0, 6);
    if (incoming !== slotsRef.current.join("")) {
      const adopted = toSlots(incoming);
      slotsRef.current = adopted;
      setSlots(adopted);
    }
    // Driven by the prop alone. slotsRef is a ref, so it is deliberately not a
    // dependency — reacting to this component's own edits would fight the user.
  }, [value]);

  /** The box a caret belongs in: the first empty one, or the last if full. */
  const firstEmpty = slots.findIndex((slot) => slot === "");
  const activeIndex = firstEmpty === -1 ? 5 : firstEmpty;

  // ── The caret can sit past the last box ─────────────────────────────────
  // A real text caret can be after the final character; six separate inputs
  // cannot express that, because focus has to be ON an element. So position 6
  // is tracked here while focus stays on box 5.
  //
  // Without it, filling all six boxes leaves the caret clamped to the last one
  // and every further keystroke silently overwrites the sixth digit — type
  // "1234567890" and you end up with "123450". Google and Stripe both ignore
  // input once the code is complete, which is what position 6 encodes.
  const caretRef = useRef(0);

  const focusBox = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, 5));
    const input = refs.current[clamped];
    if (!input) return;
    input.focus();
    // Selecting the existing digit means the next keystroke replaces it rather
    // than being swallowed by maxLength — otherwise typing over a filled box
    // silently does nothing.
    input.select();
    // After focus(), because the element's own onFocus fires synchronously
    // inside it and would otherwise overwrite this with the clamped value.
    caretRef.current = Math.max(0, Math.min(index, 6));
  }, []);

  /**
   * Apply an edit and move the caret.
   *
   * The updater form is what makes fast typing work: each keystroke transforms
   * whatever the previous one produced, rather than re-reading a `value` prop
   * that React has not re-rendered yet.
   *
   * Focus moves synchronously. These inputs are never remounted, so the element
   * exists throughout — deferring to requestAnimationFrame only opened a window
   * where the next keypress landed in the box the caret had not left yet.
   */
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

  // Autofocus on mount only. Not tied to `value`, or every keystroke would drag
  // the caret back to the first empty box.
  useEffect(() => {
    if (!autoFocus || disabled) return;
    const timer = setTimeout(() => focusBox(activeIndex), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, on purpose
  }, []);

  const handleChange = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;

    // The code is complete and the caret is past the end. Further digits are
    // ignored rather than overwriting the sixth. Backspace, an arrow key or a
    // click all move the caret back and make editing possible again.
    if (caretRef.current >= 6 && typed.length === 1) {
      // Re-render so the box discards whatever the DOM briefly showed.
      setSlots(slotsRef.current.slice());
      return;
    }

    commit((previous) => {
      // A phone keyboard or password manager can drop the whole code into one
      // box without firing a paste event, so multi-character input is spread
      // rather than truncated.
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
      // Handled here rather than letting the input clear itself, so "delete the
      // digit" and "step back" are one predictable rule instead of depending on
      // whether the caret happened to sit before or after the character.
      event.preventDefault();
      commit((previous) => {
        const next = previous.slice();
        // A digit under the caret is cleared IN PLACE — the box goes blank and
        // the ones after it do not slide left.
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

    // preventDefault so the caret does not also move inside the box, which
    // would take two presses to leave it.
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

    // Everything non-numeric is rejected at the keystroke, so a stray letter
    // never momentarily appears and then vanishes. Control combinations
    // (Ctrl+V, Cmd+A, Tab, Enter) must still get through.
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
      // Pasting into a box fills from THAT box onward, so a full code pasted
      // into the first one replaces everything, while two digits pasted into
      // box four correct just the tail.
      const next = previous.slice();
      for (let i = 0; i < pasted.length && index + i < 6; i++) next[index + i] = pasted[i];
      return { next, focus: Math.min(index + pasted.length, 5) };
    });
  };

  return (
    <div className="flex gap-2" role="group" aria-label="6-digit verification code">
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
          // Only the first box advertises one-time-code. On all six, iOS offers
          // to autofill each box with the whole code.
          autoComplete={i === 0 ? "one-time-code" : "off"}
          data-autofocus={i === 0 ? "true" : undefined}
          data-testid={`otp-${i}`}
          aria-label={`Digit ${i + 1} of 6`}
          maxLength={1}
          // Boxes ahead of the caret stay reachable by click but send the caret
          // to the first empty one, which is what makes gaps unrepresentable.
          // Clicking a box beyond the first empty one sends the caret to the
          // first empty one instead, so a code cannot be started in the middle.
          // Boxes at or before it are clicked normally.
          onMouseDown={(event) => {
            if (disabled) return;
            if (i > activeIndex) {
              event.preventDefault();
              focusBox(activeIndex);
            }
          }}
          onFocus={(event) => {
            event.currentTarget.select();
            // A click or a Tab lands here without going through focusBox, so the
            // caret has to be recorded — otherwise it would still read 6 from a
            // completed code and the box would refuse to accept a replacement.
            caretRef.current = i;
          }}
          onChange={(event) => handleChange(i, event.target.value)}
          onKeyDown={(event) => handleKeyDown(i, event)}
          onPaste={(event) => handlePaste(i, event)}
          className="h-14 w-12 rounded-lg border text-center text-xl font-semibold outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
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

/** Mirrors checkPasswordRules() in lib/passwords.ts — the server is the authority. */
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
    <div className="mt-2">
      <div className="mb-2 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: T.track }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(ratio * 100, password ? 8 : 0)}%`, background: colour }}
          />
        </div>
        {password && (
          <span className="text-xs font-semibold" style={{ color: colour }}>
            {label}
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {items.map(([key, text]) => (
          <li key={key} className="flex items-center gap-2 text-xs" style={{ color: rules[key] ? T.success : T.muted }}>
            <span aria-hidden>{rules[key] ? "✓" : "○"}</span>
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
  placeholder = "Search…",
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

  // There are ~400 IANA zones; the list is capped so the dropdown does not
  // render hundreds of DOM nodes on every keystroke.
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
        <span className="truncate">{selected?.label ?? "Select…"}</span>
        <span aria-hidden style={{ color: T.muted }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 w-full rounded-lg border shadow-lg"
          style={{ background: T.surface, borderColor: T.border }}
        >
          <div className="border-b p-2" style={{ borderColor: T.border }}>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="w-full rounded-md border px-2.5 py-2 text-sm outline-none focus:ring-2"
              style={inputStyle(false)}
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto custom-scrollbar py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2.5 text-sm" style={{ color: T.muted }}>
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
                  className="w-full px-3 py-2.5 text-left text-sm st-hover-surface"
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
        <div key={i} className="h-10 rounded-lg" style={{ background: T.track }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium" style={{ color: T.text }}>
        {title}
      </p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: T.muted }}>
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
          className="rounded-xl border p-8 text-center"
          style={{ background: T.surface, borderColor: T.danger }}
        >
          <p className="text-base font-semibold" style={{ color: T.danger }}>
            This section failed to load
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: T.muted }}>
            {this.state.error.message}
          </p>
          <div className="mt-5">
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

/**
 * JSON fetch that turns a non-2xx into a thrown Error carrying the server's own
 * message. Without this every caller writes the same six lines and half of them
 * end up showing "[object Object]" on failure.
 */
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
