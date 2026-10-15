"use client";

// newSettingdesign.tsx — Full Settings UI for the Sourcing Manager panel.
//
// Matches the Apple-inspired design language of the Sourcing Manager dashboard
// (sourcing/page.tsx) while preserving every piece of functionality from the
// 6 settings sections accessible to that role:
//
//   1. Profile
//   2. Account & Security
//   3. Preferences
//   4. Notifications
//   5. Activity Logs
//   6. WhatsApp Integration
//
// "Additional Features" is deliberately excluded — it contains admin-level
// workflow toggles that a Sourcing Manager cannot act on.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IoPersonOutline,
  IoLockClosedOutline,
  IoColorPaletteOutline,
  IoNotificationsOutline,
  IoTimeOutline,
  IoLogoWhatsapp,
  IoChevronBack,
  IoChevronForward,
  IoCloudDownloadOutline,
} from "react-icons/io5";
import { FaWhatsapp } from "react-icons/fa";
import { adoptServerAvatar, setAvatarUrl } from "@/lib/userAvatar";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { adoptServerTheme } from "@/lib/theme";
import { clearCrmSession } from "@/lib/authSession";
import {
  APP_TIMEZONE,
  APP_TIMEZONE_LABEL,
  APP_TIMEZONE_OFFSET,
  DEFAULT_WEEK_START_DAY,
  TIMEZONE_LOCKED,
  WEEK_START_OPTIONS,
} from "@/lib/timePreferences";
import { setWeekStartDay } from "@/lib/hooks/useTimePreferences";
import { useRouter } from "next/navigation";

// Re-use heavy sub-components that own their own load/save cycles
import NotificationCenter from "@/components/Settings/NotificationCenter";
import NotificationRecipients from "@/components/Settings/NotificationRecipients";
// These components use the Settings ui.tsx ToastProvider internally
import {
  ToastProvider as SettingsToastProvider,
  SETTINGS_THEME_CSS,
} from "@/components/Settings/ui";

/* ═══════════════════════════════════════════════════════════════════════════
   API helper — same contract as Settings/ui.tsx api()
   ═══════════════════════════════════════════════════════════════════════════ */

async function api<T = any>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    cache: "no-store",
    headers: json
      ? { "Content-Type": "application/json", ...(rest.headers ?? {}) }
      : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!response.ok) {
    const error = new Error(
      payload?.message || `Request failed (${response.status})`,
    );
    (error as any).status = response.status;
    (error as any).payload = payload;
    throw error;
  }
  return payload as T;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Toast system (self-contained, scoped to this component tree)
   ═══════════════════════════════════════════════════════════════════════════ */

type ToastKind = "success" | "error" | "info" | "warning";
interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastCtx = createContext<
  ((kind: ToastKind, message: string) => void) | null
>(null);

function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast requires SourcingToastProvider");
  return ctx;
}

function SourcingToastProvider({
  isDark,
  children,
}: {
  isDark: boolean;
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((c) => [...c, { id, kind, message }]);
    setTimeout(
      () => setToasts((c) => c.filter((t) => t.id !== id)),
      kind === "error" ? 8000 : 4000,
    );
  }, []);

  const kindColors: Record<ToastKind, string> = {
    success: "#10b981",
    error: "#ef4444",
    warning: "#f59e0b",
    info: isDark ? "#FF3797" : "#9E217B",
  };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl border px-4 py-3.5 shadow-lg animate-fadeIn backdrop-blur-xl"
            style={{
              background: isDark ? "#1C1C1E" : "#fff",
              borderColor: kindColors[t.kind],
            }}
          >
            <span
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: kindColors[t.kind] }}
            >
              {t.kind === "success"
                ? "\u2713"
                : t.kind === "error"
                  ? "\u2715"
                  : t.kind === "warning"
                    ? "!"
                    : "i"}
            </span>
            <span
              className="text-[13px]"
              style={{ color: isDark ? "#fff" : "#1D1D1F" }}
            >
              {t.message}
            </span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Password strength
   ═══════════════════════════════════════════════════════════════════════════ */

function checkRules(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Design tokens — mirrors sourcing/page.tsx
   ═══════════════════════════════════════════════════════════════════════════ */

function useTokens(isDark: boolean) {
  return useMemo(
    () => ({
      bgApp: isDark ? "bg-[#000000]" : "bg-[#F5F5F7]",
      bgCard: isDark
        ? "bg-[#1C1C1E] border border-[#38383A]"
        : "bg-white border border-[#E5E5EA] shadow-sm",
      bgSubtle: isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]",
      textPrimary: isDark ? "text-white" : "text-[#1D1D1F]",
      textSecondary: isDark ? "text-[#98989D]" : "text-[#86868B]",
      textAccent: isDark ? "text-[#FF3797]" : "text-[#9E217B]",
      bgAccent: isDark ? "bg-[#FF3797]" : "bg-[#9E217B]",
      borderSubtle: isDark ? "border-[#38383A]" : "border-[#E5E5EA]",
      // Raw values for inline styles
      accent: isDark ? "#FF3797" : "#9E217B",
      surface: isDark ? "#1C1C1E" : "#ffffff",
      surfaceAlt: isDark ? "#2C2C2E" : "#F2F2F7",
      border: isDark ? "#38383A" : "#E5E5EA",
      text: isDark ? "#ffffff" : "#1D1D1F",
      muted: isDark ? "#98989D" : "#86868B",
      danger: "#ef4444",
      success: "#10b981",
      warning: "#f59e0b",
    }),
    [isDark],
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Shared UI primitives — Apple-style, sourcing design language
   ═══════════════════════════════════════════════════════════════════════════ */

function SCard({
  title,
  description,
  children,
  footer,
  isDark,
  danger,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  isDark: boolean;
  danger?: boolean;
}) {
  const tk = useTokens(isDark);
  return (
    <section
      className={`mb-4 rounded-2xl overflow-hidden ${tk.bgCard}`}
      style={danger ? { borderColor: tk.danger } : undefined}
    >
      {(title || description) && (
        <header
          className="border-b px-5 py-4"
          style={{ borderColor: tk.border }}
        >
          {title && (
            <h3
              className="text-[13px] font-semibold tracking-wide"
              style={{ color: danger ? tk.danger : tk.text }}
            >
              {title}
            </h3>
          )}
          {description && (
            <p className="text-[11px] mt-0.5" style={{ color: tk.muted }}>
              {description}
            </p>
          )}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <footer
          className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-3"
          style={{ borderColor: tk.border, background: tk.surfaceAlt }}
        >
          {footer}
        </footer>
      )}
    </section>
  );
}

function SButton({
  variant = "primary",
  loading,
  children,
  isDark,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  isDark: boolean;
}) {
  const tk = useTokens(isDark);
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: tk.accent,
      color: "#fff",
      borderColor: tk.accent,
    },
    secondary: {
      background: tk.surface,
      color: tk.text,
      borderColor: tk.border,
    },
    danger: {
      background: "rgba(239,68,68,0.1)",
      color: "#ef4444",
      borderColor: "transparent",
    },
    ghost: {
      background: "transparent",
      color: tk.accent,
      borderColor: "transparent",
    },
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className="inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 text-[13px] font-semibold tracking-tight transition-all duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={styles[variant]}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

function SInput({
  isDark,
  hasError,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  isDark: boolean;
  hasError?: boolean;
}) {
  const tk = useTokens(isDark);
  return (
    <input
      {...props}
      className={`w-full rounded-xl border px-3.5 py-2.5 text-[14px] leading-5 outline-none transition-all duration-200 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${props.className ?? ""}`}
      style={{
        borderColor: hasError ? tk.danger : tk.border,
        color: tk.text,
        background: tk.surface,
        ["--tw-ring-color" as any]: hasError
          ? "rgba(239,68,68,0.35)"
          : `${tk.accent}40`,
        ...props.style,
      }}
    />
  );
}

function SSelect({
  isDark,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { isDark: boolean }) {
  const tk = useTokens(isDark);
  return (
    <select
      {...props}
      className={`w-full rounded-xl border px-3.5 py-2.5 text-[14px] leading-5 outline-none transition-all duration-200 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${props.className ?? ""}`}
      style={{
        borderColor: tk.border,
        color: tk.text,
        background: tk.surface,
        ["--tw-ring-color" as any]: `${tk.accent}40`,
        ...props.style,
      }}
    >
      {children}
    </select>
  );
}

function SField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  isDark,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  isDark: boolean;
}) {
  const tk = useTokens(isDark);
  return (
    <div className="mb-4">
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider"
        style={{ color: tk.text }}
      >
        {label}
        {required && (
          <span style={{ color: tk.danger }}> *</span>
        )}
      </label>
      {children}
      {error ? (
        <p
          className="mt-1 text-[11px] flex items-center gap-1"
          style={{ color: tk.danger }}
        >
          <span className="text-[9px]">{"\u2715"}</span>
          {error}
        </p>
      ) : hint ? (
        <p
          className="mt-1 text-[11px]"
          style={{ color: tk.muted }}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SToggle({
  checked,
  onChange,
  label,
  isDark,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  isDark: boolean;
  disabled?: boolean;
}) {
  const tk = useTokens(isDark);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[36px] flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: checked ? tk.accent : isDark ? "#3A3A3C" : "#D1D1D6" }}
    >
      <span
        className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{ transform: checked ? "translateX(14px)" : "translateX(0)" }}
      />
    </button>
  );
}

function SToggleRow({
  label,
  description,
  checked,
  onChange,
  isDark,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  isDark: boolean;
  disabled?: boolean;
}) {
  const tk = useTokens(isDark);
  return (
    <div
      className="flex items-start justify-between gap-4 border-b py-3.5 last:border-b-0"
      style={{ borderColor: tk.border }}
    >
      <div className="flex-1">
        <p className="text-[14px] font-medium" style={{ color: tk.text }}>
          {label}
        </p>
        {description && (
          <p className="text-[12px] mt-0.5" style={{ color: tk.muted }}>
            {description}
          </p>
        )}
      </div>
      <SToggle
        checked={checked}
        onChange={onChange}
        label={label}
        isDark={isDark}
        disabled={disabled}
      />
    </div>
  );
}

function SModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  isDark,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  isDark: boolean;
}) {
  const tk = useTokens(isDark);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const bodyOv = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = bodyOv;
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl shadow-2xl sm:rounded-2xl"
        style={{ background: tk.surface }}
      >
        <header
          className="border-b px-5 py-4"
          style={{ borderColor: tk.border }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                className="text-[16px] font-semibold"
                style={{ color: tk.text }}
              >
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-[12px]" style={{ color: tk.muted }}>
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full text-sm transition-colors hover:opacity-70"
              style={{ color: tk.muted }}
            >
              {"\u2715"}
            </button>
          </div>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer
            className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-3"
            style={{ borderColor: tk.border, background: tk.surfaceAlt }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

function SOTPInput({
  value,
  onChange,
  disabled,
  isDark,
  error,
  onComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  isDark: boolean;
  error?: boolean;
  onComplete?: (code: string) => void;
}) {
  const tk = useTokens(isDark);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const toSlots = (raw: string) => {
    const clean = raw.replace(/\D/g, "").slice(0, 6);
    return Array.from({ length: 6 }, (_, i) => clean[i] ?? "");
  };

  const [slots, setSlots] = useState<string[]>(() => toSlots(value));
  const slotsRef = useRef(slots);

  useEffect(() => {
    const incoming = value.replace(/\D/g, "").slice(0, 6);
    if (incoming !== slotsRef.current.join("")) {
      const adopted = toSlots(incoming);
      slotsRef.current = adopted;
      setSlots(adopted);
    }
  }, [value]);

  const handleChange = (index: number, digit: string) => {
    if (!/^\d?$/.test(digit)) return;
    const next = [...slotsRef.current];
    next[index] = digit;
    slotsRef.current = next;
    setSlots(next);
    const emitted = next.join("");
    onChange(emitted);
    if (digit && index < 5) refs.current[index + 1]?.focus();
    if (emitted.length === 6) onComplete?.(emitted);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !slots[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="flex gap-2">
      {slots.map((s, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={s}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-10 h-12 text-center text-lg font-semibold rounded-xl border outline-none transition-all duration-200 focus:ring-2 disabled:opacity-50"
          style={{
            borderColor: error ? tk.danger : tk.border,
            color: tk.text,
            background: tk.surface,
            ["--tw-ring-color" as any]: `${tk.accent}40`,
          }}
        />
      ))}
    </div>
  );
}

function SSkeleton({ rows = 3, isDark }: { rows?: number; isDark: boolean }) {
  const tk = useTokens(isDark);
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div
            className="h-3 rounded"
            style={{
              background: tk.surfaceAlt,
              width: `${40 + ((i * 17) % 40)}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function SBanner({
  children,
  tone = "info",
  isDark,
}: {
  children: React.ReactNode;
  tone?: "info" | "warning";
  isDark: boolean;
}) {
  const tk = useTokens(isDark);
  const accent = tone === "warning" ? tk.warning : tk.accent;
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-[13px]"
      style={{
        borderColor: accent,
        background: `${accent}10`,
        color: tk.text,
      }}
    >
      <span
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{ background: `${accent}20`, color: accent }}
      >
        {tone === "warning" ? "!" : "i"}
      </span>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

function SStatusBadge({
  status,
  children,
  isDark,
}: {
  status: "active" | "inactive" | "danger" | "pending" | "success" | "neutral";
  children: React.ReactNode;
  isDark: boolean;
}) {
  const map: Record<string, { bg: string; fg: string; icon: string }> = {
    active: { bg: "rgba(16,185,129,0.12)", fg: "#10b981", icon: "\u25CF" },
    success: { bg: "rgba(16,185,129,0.12)", fg: "#10b981", icon: "\u2713" },
    pending: { bg: "rgba(245,158,11,0.12)", fg: "#f59e0b", icon: "\u25D0" },
    inactive: { bg: isDark ? "rgba(255,255,255,0.06)" : "#EEF1F6", fg: isDark ? "#8E8E93" : "#475569", icon: "\u25CB" },
    danger: { bg: "rgba(239,68,68,0.10)", fg: "#ef4444", icon: "\u2715" },
    neutral: { bg: isDark ? "rgba(255,255,255,0.06)" : "#EEF1F6", fg: isDark ? "#8E8E93" : "#475569", icon: "\u2022" },
  };
  const s = map[status] ?? map.neutral;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      <span aria-hidden>{s.icon}</span>
      {children}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Settings sub-component host — wraps NotificationCenter / NotificationRecipients
   which depend on the Settings ui.tsx ToastProvider and CSS custom properties.
   ═══════════════════════════════════════════════════════════════════════════ */

function SettingsSubComponentHost({
  isDark,
  children,
}: {
  isDark: boolean;
  children: React.ReactNode;
}) {
  return (
    <div data-st-theme={isDark ? "dark" : "light"}>
      <style dangerouslySetInnerHTML={{ __html: SETTINGS_THEME_CSS }} />
      <SettingsToastProvider>{children}</SettingsToastProvider>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAV
   ═══════════════════════════════════════════════════════════════════════════ */

type Section =
  | "profile"
  | "account-security"
  | "preferences"
  | "notifications"
  | "activity-logs"
  | "whatsapp";

const NAV: {
  id: Section;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { id: "profile", label: "Profile", icon: IoPersonOutline },
  { id: "account-security", label: "Account & Security", icon: IoLockClosedOutline },
  { id: "preferences", label: "Preferences", icon: IoColorPaletteOutline },
  { id: "notifications", label: "Notifications", icon: IoNotificationsOutline },
  { id: "activity-logs", label: "Activity Logs", icon: IoTimeOutline },
  { id: "whatsapp", label: "WhatsApp", icon: IoLogoWhatsapp },
];

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — Profile
   ═══════════════════════════════════════════════════════════════════════════ */

function ProfileSection({
  isDark,
  user: initialUser,
  setUser: setParentUser,
}: {
  isDark: boolean;
  user: any;
  setUser: (u: any) => void;
}) {
  const toast = useToast();
  const tk = useTokens(isDark);

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    whatsappNumber: "",
    timezone: APP_TIMEZONE,
    weekStartDay: DEFAULT_WEEK_START_DAY,
  });

  // Avatar
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const applyUser = useCallback(
    (next: any) => {
      setUser(next);
      setForm({
        firstName: next.firstName ?? "",
        lastName: next.lastName ?? "",
        phone: next.phone ?? "",
        whatsappNumber: next.whatsappNumber ?? "",
        timezone: TIMEZONE_LOCKED ? APP_TIMEZONE : next.timezone ?? APP_TIMEZONE,
        weekStartDay: next.weekStartDay ?? DEFAULT_WEEK_START_DAY,
      });
    },
    [],
  );

  useEffect(() => {
    api<{ user: any }>("/api/settings/profile")
      .then((r) => {
        applyUser(r.user);
        adoptServerAvatar(r.user.avatarUrl);
      })
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [applyUser, toast]);

  const dirty = useMemo(() => {
    if (!user) return false;
    return (
      form.firstName !== (user.firstName ?? "") ||
      form.lastName !== (user.lastName ?? "") ||
      form.phone !== (user.phone ?? "") ||
      form.whatsappNumber !== (user.whatsappNumber ?? "") ||
      form.timezone !== user.timezone ||
      form.weekStartDay !== user.weekStartDay
    );
  }, [form, user]);

  const save = async () => {
    const nextErrors: Record<string, string> = {};
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (form.firstName.length > 50)
      nextErrors.firstName = "Maximum 50 characters.";
    if (form.lastName.length > 50)
      nextErrors.lastName = "Maximum 50 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const result = await api<{ user: any; message: string }>(
        "/api/settings/profile",
        { method: "PATCH", json: form },
      );
      applyUser(result.user);
      setWeekStartDay(result.user.weekStartDay);
      try {
        const cached = JSON.parse(
          localStorage.getItem("crm_user") ?? "{}",
        );
        localStorage.setItem(
          "crm_user",
          JSON.stringify({
            ...cached,
            name: result.user.name,
            email: result.user.email,
          }),
        );
      } catch {}
      setParentUser((prev: any) => ({
        ...prev,
        name: result.user.name,
        email: result.user.email,
      }));
      toast("success", result.message);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  // Avatar handlers
  const pickFile = (file: File) => {
    if (
      !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
        file.type,
      )
    ) {
      toast("error", "Supports JPG, GIF, PNG or WebP only.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("error", "Image must be under 5MB.");
      return;
    }
    setSourceFile(file);
    setZoom(1);
    setPreview(URL.createObjectURL(file));
  };

  const uploadAvatar = async () => {
    if (!preview || !sourceFile) return;
    setAvatarBusy(true);
    try {
      const image = document.createElement("img");
      image.src = preview;
      await new Promise((res, rej) => {
        image.onload = res;
        image.onerror = () => rej(new Error("Could not read image."));
      });
      const SIZE = 512;
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d")!;
      const side = Math.min(image.width, image.height) / zoom;
      const sx = (image.width - side) / 2;
      const sy = (image.height - side) / 2;
      ctx.drawImage(image, sx, sy, side, side, 0, 0, SIZE, SIZE);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("Could not process image."))),
          "image/jpeg",
          0.9,
        ),
      );
      const fd = new FormData();
      fd.append(
        "file",
        new File([blob], "avatar.jpg", { type: "image/jpeg" }),
      );
      const result = await api<{ avatarUrl: string }>("/api/settings/avatar", {
        method: "POST",
        body: fd,
      });
      setUser((u: any) => ({ ...u, avatarUrl: result.avatarUrl }));
      setAvatarUrl(result.avatarUrl);
      toast("success", "Profile picture updated");
      setPreview(null);
      setSourceFile(null);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await api("/api/settings/avatar", { method: "DELETE" });
      setUser((u: any) => ({ ...u, avatarUrl: null }));
      setAvatarUrl(null);
      toast("success", "Profile picture removed");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setAvatarBusy(false);
    }
  };

  if (loading) {
    return (
      <SCard isDark={isDark}>
        <SSkeleton rows={5} isDark={isDark} />
      </SCard>
    );
  }

  if (!user) {
    return (
      <SCard isDark={isDark}>
        <p className="text-[14px]" style={{ color: tk.danger }}>
          Could not load your profile. Try reloading the page.
        </p>
      </SCard>
    );
  }

  const initials = (user.name || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <SBanner isDark={isDark}>
        Changes in this profile will apply to all of your workspaces.
      </SBanner>

      {/* Avatar */}
      <SCard title="Profile Picture" isDark={isDark}>
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div
            className="flex h-[100px] w-[100px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2"
            style={{
              borderColor: tk.border,
              background:
                preview || user.avatarUrl
                  ? tk.surface
                  : `linear-gradient(135deg,${tk.accent} 0%,#d946a8 100%)`,
            }}
          >
            {preview ? (
              <img
                src={preview}
                alt=""
                className="h-full w-full object-cover"
                style={{ transform: `scale(${zoom})` }}
              />
            ) : user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-2xl font-bold text-white">{initials}</span>
            )}
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-medium" style={{ color: tk.text }}>
              Profile Picture
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: tk.muted }}>
              Supports JPG, GIF, or PNG under 5MB
            </p>
            {preview ? (
              <div className="mt-3">
                <label className="block text-[11px] mb-1" style={{ color: tk.muted }}>
                  Scale
                </label>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full max-w-xs"
                  style={{ accentColor: tk.accent }}
                />
                <div className="mt-3 flex gap-2">
                  <SButton isDark={isDark} onClick={uploadAvatar} loading={avatarBusy}>
                    Save picture
                  </SButton>
                  <SButton
                    isDark={isDark}
                    variant="secondary"
                    onClick={() => {
                      setPreview(null);
                      setSourceFile(null);
                    }}
                    disabled={avatarBusy}
                  >
                    Cancel
                  </SButton>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickFile(f);
                    e.target.value = "";
                  }}
                />
                <SButton
                  isDark={isDark}
                  variant="secondary"
                  onClick={() => fileRef.current?.click()}
                  disabled={avatarBusy}
                >
                  Upload image
                </SButton>
                {user.avatarUrl && (
                  <SButton
                    isDark={isDark}
                    variant="ghost"
                    onClick={removeAvatar}
                    loading={avatarBusy}
                  >
                    Remove
                  </SButton>
                )}
              </div>
            )}
          </div>
        </div>
      </SCard>

      {/* Personal info */}
      <SCard
        title="Personal Information"
        isDark={isDark}
        footer={
          <>
            <SButton
              isDark={isDark}
              variant="secondary"
              onClick={() => applyUser(user)}
              disabled={!dirty || saving}
            >
              Discard
            </SButton>
            <SButton isDark={isDark} onClick={save} loading={saving} disabled={!dirty}>
              Save Changes
            </SButton>
          </>
        }
      >
        <div className="grid gap-x-4 sm:grid-cols-2">
          <SField
            label="First Name"
            htmlFor="s-firstName"
            required
            error={errors.firstName}
            isDark={isDark}
          >
            <SInput
              id="s-firstName"
              isDark={isDark}
              value={form.firstName}
              maxLength={50}
              hasError={Boolean(errors.firstName)}
              onChange={(e) =>
                setForm((f) => ({ ...f, firstName: e.target.value }))
              }
            />
          </SField>
          <SField
            label="Last Name"
            htmlFor="s-lastName"
            error={errors.lastName}
            isDark={isDark}
          >
            <SInput
              id="s-lastName"
              isDark={isDark}
              value={form.lastName}
              maxLength={50}
              hasError={Boolean(errors.lastName)}
              onChange={(e) =>
                setForm((f) => ({ ...f, lastName: e.target.value }))
              }
            />
          </SField>
        </div>

        <SField
          label="Primary Email"
          htmlFor="s-email"
          hint="Email changes go through a verification step."
          isDark={isDark}
        >
          <div className="flex flex-wrap items-center gap-3">
            <SInput
              id="s-email"
              isDark={isDark}
              value={user.email ?? "Not set"}
              readOnly
              disabled
              className="flex-1 min-w-[200px]"
            />
            <SButton
              isDark={isDark}
              variant="secondary"
              onClick={() => setEmailModal(true)}
            >
              Change email
            </SButton>
          </div>
        </SField>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <SField label="Phone" htmlFor="s-phone" isDark={isDark}>
            <SInput
              id="s-phone"
              isDark={isDark}
              type="tel"
              value={form.phone}
              onChange={(e) =>
                setForm((f) => ({ ...f, phone: e.target.value }))
              }
              placeholder="+91 98765 43210"
            />
          </SField>
          <SField
            label="WhatsApp Number"
            htmlFor="s-whatsapp"
            hint="Country code, no + sign."
            isDark={isDark}
          >
            <SInput
              id="s-whatsapp"
              isDark={isDark}
              type="tel"
              value={form.whatsappNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, whatsappNumber: e.target.value }))
              }
              placeholder="919876543210"
            />
          </SField>
        </div>
      </SCard>

      {/* Time preferences */}
      <SCard
        title="Time Preferences"
        description="Timestamps, calendars and reporting date ranges."
        isDark={isDark}
        footer={
          <>
            <SButton
              isDark={isDark}
              variant="secondary"
              onClick={() => applyUser(user)}
              disabled={!dirty || saving}
            >
              Discard
            </SButton>
            <SButton isDark={isDark} onClick={save} loading={saving} disabled={!dirty}>
              Save Changes
            </SButton>
          </>
        }
      >
        <SField
          label="Timezone"
          isDark={isDark}
          hint={
            TIMEZONE_LOCKED
              ? `Fixed to ${APP_TIMEZONE_LABEL} (${APP_TIMEZONE_OFFSET}).`
              : undefined
          }
        >
          <SSelect isDark={isDark} value={APP_TIMEZONE} disabled>
            <option value={APP_TIMEZONE}>
              {`${APP_TIMEZONE.replace(/_/g, " ")} — ${APP_TIMEZONE_LABEL} (${APP_TIMEZONE_OFFSET})`}
            </option>
          </SSelect>
        </SField>

        <SField label="Start week on" htmlFor="s-weekStart" isDark={isDark}>
          <SSelect
            id="s-weekStart"
            isDark={isDark}
            value={String(form.weekStartDay)}
            onChange={(e) =>
              setForm((f) => ({ ...f, weekStartDay: Number(e.target.value) }))
            }
          >
            {WEEK_START_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </SSelect>
        </SField>
      </SCard>

      {/* Email change modal */}
      <EmailChangeModal
        open={emailModal}
        currentEmail={user.email}
        onClose={() => setEmailModal(false)}
        onChanged={(next: any) => next && applyUser(next)}
        isDark={isDark}
      />
    </>
  );
}

/* ── Email change modal ─────────────────────────────────────────────────── */

function EmailChangeModal({
  open,
  currentEmail,
  onClose,
  onChanged,
  isDark,
}: {
  open: boolean;
  currentEmail: string | null;
  onClose: () => void;
  onChanged: (user: any) => void;
  isDark: boolean;
}) {
  const toast = useToast();
  const tk = useTokens(isDark);
  const [step, setStep] = useState<"email" | "otp">("email");
  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (open) {
      setStep("email");
      setNewEmail("");
      setOtp("");
      setError(null);
      setCooldown(0);
    }
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/api/settings/email-change", {
        method: "POST",
        json: { newEmail },
      });
      setStep("otp");
      setCooldown(result.resendAfterSeconds ?? 60);
      toast(result.mailDelivered ? "info" : "warning", result.message);
    } catch (err: any) {
      setError(err.message);
      if (err.payload?.retryAfter) setCooldown(err.payload.retryAfter);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<any>("/api/settings/email-verify", {
        method: "POST",
        json: { otp },
      });
      onChanged(result.user);
      toast("success", "Email address changed");
      onClose();
    } catch (err: any) {
      setError(err.message);
      setOtp("");
      if (err.payload?.restart) setStep("email");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SModal
      open={open}
      onClose={onClose}
      title="Change email address"
      description={
        step === "email"
          ? "We'll send a 6-digit code to confirm your identity."
          : `Enter the code sent to ${currentEmail}.`
      }
      isDark={isDark}
      footer={
        step === "email" ? (
          <>
            <SButton isDark={isDark} variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </SButton>
            <SButton
              isDark={isDark}
              onClick={sendOtp}
              loading={busy}
              disabled={!newEmail.trim()}
            >
              Send OTP
            </SButton>
          </>
        ) : (
          <>
            <SButton
              isDark={isDark}
              variant="secondary"
              onClick={sendOtp}
              disabled={busy || cooldown > 0}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </SButton>
            <SButton
              isDark={isDark}
              onClick={verify}
              loading={busy}
              disabled={otp.length !== 6}
            >
              Verify
            </SButton>
          </>
        )
      }
    >
      {error && (
        <SBanner isDark={isDark} tone="warning">
          {error}
        </SBanner>
      )}
      {step === "email" ? (
        <SField
          label="New email address"
          htmlFor="s-new-email"
          required
          hint={`Current: ${currentEmail ?? "not set"}`}
          isDark={isDark}
        >
          <SInput
            id="s-new-email"
            isDark={isDark}
            type="email"
            value={newEmail}
            hasError={Boolean(error)}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@gmail.com"
          />
        </SField>
      ) : (
        <SField label="6-digit code" isDark={isDark}>
          <SOTPInput
            value={otp}
            onChange={setOtp}
            disabled={busy}
            isDark={isDark}
            error={Boolean(error)}
          />
        </SField>
      )}
    </SModal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — Account & Security
   ═══════════════════════════════════════════════════════════════════════════ */

function formatWhen(value: string | null | undefined): string {
  if (!value) return "\u2014";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AccountSecuritySection({ isDark }: { isDark: boolean }) {
  const toast = useToast();
  const tk = useTokens(isDark);
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
      <SCard isDark={isDark}>
        <SSkeleton rows={4} isDark={isDark} />
      </SCard>
    );
  }
  if (!data) {
    return (
      <SCard isDark={isDark}>
        <p className="text-[14px]" style={{ color: tk.danger }}>
          Could not load account data.
        </p>
      </SCard>
    );
  }

  const { user, account } = data;

  return (
    <>
      {/* Login Credentials */}
      <SCard title="Login Credentials" isDark={isDark}>
        <SField
          label="Email"
          hint="Change from the Profile section."
          isDark={isDark}
        >
          <SInput isDark={isDark} value={user.email ?? "Not set"} readOnly disabled />
        </SField>
        <SField label="Password" isDark={isDark}>
          <div className="flex flex-wrap items-center gap-3">
            <SInput
              isDark={isDark}
              value="••••••••"
              readOnly
              disabled
              className="flex-1 min-w-[200px]"
            />
            <SButton
              isDark={isDark}
              variant="secondary"
              onClick={() => setPasswordModal(true)}
            >
              Change password
            </SButton>
          </div>
        </SField>
        {!account.passwordHashed && (
          <SBanner isDark={isDark} tone="warning">
            For your security, please update your password to the latest secure format.
          </SBanner>
        )}
      </SCard>

      {/* Notification Recipients */}
      <SettingsSubComponentHost isDark={isDark}>
        <NotificationRecipients />
      </SettingsSubComponentHost>

      {/* Account Status */}
      <SCard title="Account Status" isDark={isDark}>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Account created", value: formatWhen(account.createdAt) },
            { label: "Last login", value: formatWhen(account.lastLoginAt) },
            {
              label: "Account status",
              badge: (
                <SStatusBadge
                  isDark={isDark}
                  status={account.status === "active" ? "active" : "danger"}
                >
                  {account.status === "active" ? "Active" : "Suspended"}
                </SStatusBadge>
              ),
            },
            {
              label: "Password last changed",
              value: account.passwordChangedAt
                ? formatWhen(account.passwordChangedAt)
                : "Never",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border px-4 py-3"
              style={{ borderColor: tk.border, background: tk.surfaceAlt }}
            >
              <p className="text-[11px] font-medium" style={{ color: tk.muted }}>
                {item.label}
              </p>
              {"badge" in item && item.badge ? (
                <div className="mt-1">{item.badge}</div>
              ) : (
                <p
                  className="mt-1 text-[14px] font-medium"
                  style={{ color: tk.text }}
                >
                  {(item as any).value}
                </p>
              )}
            </div>
          ))}
        </div>
      </SCard>

      {/* Sessions */}
      <SessionManagerCard isDark={isDark} />

      {/* Danger Zone */}
      <SCard title="Danger Zone" isDark={isDark} danger>
        <p className="text-[12px] mb-3" style={{ color: tk.muted }}>
          Deactivating archives your access. Your records stay in the CRM.
        </p>
        <SButton
          isDark={isDark}
          variant="danger"
          onClick={() => setDeactivateModal(true)}
        >
          Deactivate Account
        </SButton>
      </SCard>

      <PasswordChangeModal
        open={passwordModal}
        onClose={() => setPasswordModal(false)}
        isDark={isDark}
      />
      <DeactivateModal
        open={deactivateModal}
        onClose={() => setDeactivateModal(false)}
        isDark={isDark}
      />
    </>
  );
}

/* ── Password Change Modal ──────────────────────────────────────────────── */

function PasswordChangeModal({
  open,
  onClose,
  isDark,
}: {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const tk = useTokens(isDark);

  type PwStep = "current" | "otp" | "newPassword" | "done";
  type PwMode = "change" | "recover";

  const [mode, setMode] = useState<PwMode>("change");
  const [step, setStep] = useState<PwStep>("current");
  const [current, setCurrent] = useState("");
  const [otp, setOtp] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authExpiry, setAuthExpiry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
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

  const purpose =
    mode === "recover" ? "self_password_recovery" : "self_password_change";
  const rules = checkRules(next);
  const rulesMet = Object.values(rules).every(Boolean);
  const matches = next.length > 0 && next === confirm;

  const submitCurrentPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>(
        "/api/settings/password/verify-current",
        { method: "POST", json: { currentPassword: current } },
      );
      setInfo(res.message);
      setStep("otp");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const requestRecoveryOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>(
        "/api/settings/password/recover",
        { method: "POST", json: {} },
      );
      setInfo(res.message);
      setMode("recover");
      setStep("otp");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

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
      }>("/api/settings/password/verify-otp", {
        method: "POST",
        json: { otp: otpValue, purpose },
      });
      setAuthToken(res.authToken);
      setAuthExpiry(res.authExpiresInMinutes);
      setInfo(
        `Code verified. You have ${res.authExpiresInMinutes} minutes to set a new password.`,
      );
      setStep("newPassword");
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
      setError(err.message);
      const body = err.payload ?? {};
      if (body.attemptsRemaining != null)
        setAttemptsRemaining(body.attemptsRemaining);
      if (body.restart) setOtp("");
    } finally {
      setBusy(false);
    }
  };

  const submitNewPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>(
        "/api/settings/password/change",
        {
          method: "POST",
          json: {
            authToken,
            newPassword: next,
            confirmPassword: confirm,
            purpose,
          },
        },
      );
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

  const stepTitle: Record<PwStep, string> = {
    current: "Change password",
    otp: "Enter verification code",
    newPassword: "Set new password",
    done: "Password changed",
  };

  const canClose = step !== "done" && !busy;

  return (
    <SModal
      open={open}
      onClose={canClose ? onClose : () => {}}
      title={stepTitle[step]}
      isDark={isDark}
      footer={
        step === "done" ? null : (
          <>
            {canClose && (
              <SButton isDark={isDark} variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </SButton>
            )}
            {step === "current" && (
              <SButton
                isDark={isDark}
                onClick={submitCurrentPassword}
                loading={busy}
                disabled={!current}
              >
                Verify &amp; Send Code
              </SButton>
            )}
            {step === "otp" && (
              <SButton
                isDark={isDark}
                onClick={() => submitOtp()}
                loading={busy}
                disabled={!/^\d{6}$/.test(otp)}
              >
                Verify Code
              </SButton>
            )}
            {step === "newPassword" && (
              <SButton
                isDark={isDark}
                onClick={submitNewPassword}
                loading={busy}
                disabled={!rulesMet || !matches}
              >
                Update Password
              </SButton>
            )}
          </>
        )
      }
    >
      {error && <SBanner isDark={isDark} tone="warning">{error}</SBanner>}
      {info && !error && step !== "done" && (
        <SBanner isDark={isDark}>{info}</SBanner>
      )}

      {step === "current" && (
        <>
          <SField label="Current Password" htmlFor="s-cur-pw" required isDark={isDark}>
            <SInput
              id="s-cur-pw"
              isDark={isDark}
              type="password"
              value={current}
              hasError={Boolean(error)}
              onChange={(e) => {
                setCurrent(e.target.value);
                setError(null);
              }}
              autoComplete="current-password"
            />
          </SField>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setInfo(null);
              setCurrent("");
              requestRecoveryOtp();
            }}
            disabled={busy}
            className="text-[13px] font-medium hover:underline"
            style={{ color: tk.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Forgot your current password?
          </button>
        </>
      )}

      {step === "otp" && (
        <>
          <SField label="6-digit code" required isDark={isDark}>
            <SOTPInput
              value={otp}
              onChange={(v) => {
                setOtp(v);
                setError(null);
              }}
              disabled={busy}
              isDark={isDark}
              error={Boolean(error)}
              onComplete={(code) => submitOtp(code)}
            />
          </SField>
          {attemptsRemaining != null && attemptsRemaining > 0 && (
            <p className="mt-1 text-[11px]" style={{ color: tk.warning }}>
              {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"}{" "}
              remaining.
            </p>
          )}
        </>
      )}

      {step === "newPassword" && (
        <>
          <SField label="New Password" htmlFor="s-new-pw" required isDark={isDark}>
            <SInput
              id="s-new-pw"
              isDark={isDark}
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
            {/* Strength indicator */}
            <div className="mt-2 space-y-1">
              {Object.entries(rules).map(([key, met]) => (
                <p
                  key={key}
                  className="text-[11px]"
                  style={{ color: met ? tk.success : tk.muted }}
                >
                  {met ? "\u2713" : "\u25CB"}{" "}
                  {key === "length"
                    ? "At least 8 characters"
                    : key === "upper"
                      ? "One uppercase letter"
                      : key === "lower"
                        ? "One lowercase letter"
                        : key === "digit"
                          ? "One digit"
                          : "One special character"}
                </p>
              ))}
            </div>
          </SField>
          <SField
            label="Confirm Password"
            htmlFor="s-confirm-pw"
            required
            error={confirm && !matches ? "Passwords do not match." : null}
            isDark={isDark}
          >
            <SInput
              id="s-confirm-pw"
              isDark={isDark}
              type="password"
              value={confirm}
              hasError={Boolean(confirm) && !matches}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </SField>
        </>
      )}

      {step === "done" && (
        <SBanner isDark={isDark}>
          Password changed. All sessions revoked. Redirecting to login...
        </SBanner>
      )}
    </SModal>
  );
}

/* ── Deactivate Modal ───────────────────────────────────────────────────── */

function DeactivateModal({
  open,
  onClose,
  isDark,
}: {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
}) {
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
      await api("/api/settings/deactivate", {
        method: "POST",
        json: { password },
      });
      toast("success", "Account deactivated.");
      clearCrmSession();
      setTimeout(() => router.replace("/"), 1200);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <SModal
      open={open}
      onClose={onClose}
      title="Deactivate account"
      isDark={isDark}
      footer={
        <>
          <SButton isDark={isDark} variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </SButton>
          <SButton
            isDark={isDark}
            variant="danger"
            onClick={submit}
            loading={busy}
            disabled={!password}
          >
            Deactivate my account
          </SButton>
        </>
      }
    >
      <SBanner isDark={isDark} tone="warning">
        This cannot be undone by you. Your data stays intact, but only an admin
        can reactivate the account.
      </SBanner>
      <SField
        label="Confirm your password"
        htmlFor="s-deact-pw"
        required
        error={error}
        isDark={isDark}
      >
        <SInput
          id="s-deact-pw"
          isDark={isDark}
          type="password"
          value={password}
          hasError={Boolean(error)}
          onChange={(e) => setPassword(e.target.value)}
        />
      </SField>
    </SModal>
  );
}

/* ── Session Manager ────────────────────────────────────────────────────── */

function SessionManagerCard({ isDark }: { isDark: boolean }) {
  const toast = useToast();
  const tk = useTokens(isDark);
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

  const active = sessions?.filter((s) => s.isActive) ?? [];

  return (
    <SCard
      title={`Active Sessions${sessions ? ` (${active.length})` : ""}`}
      isDark={isDark}
    >
      {!sessions ? (
        <SSkeleton rows={3} isDark={isDark} />
      ) : sessions.length === 0 ? (
        <p className="text-[13px]" style={{ color: tk.muted }}>
          No sessions found.
        </p>
      ) : (
        <>
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[500px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left">
                  {["Device", "IP", "Started", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="border-b py-2 pr-3 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ borderColor: tk.border, color: tk.muted }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td
                      className="border-b py-3 pr-3 font-medium"
                      style={{ borderColor: tk.border, color: tk.text }}
                    >
                      {s.device ?? "Unknown"}
                      {s.isCurrent && (
                        <span
                          className="ml-2 text-[11px] font-semibold"
                          style={{ color: tk.accent }}
                        >
                          This device
                        </span>
                      )}
                    </td>
                    <td
                      className="border-b py-3 pr-3"
                      style={{ borderColor: tk.border, color: tk.muted }}
                    >
                      {s.ipAddress ?? "\u2014"}
                    </td>
                    <td
                      className="border-b py-3 pr-3"
                      style={{ borderColor: tk.border, color: tk.muted }}
                    >
                      {formatWhen(s.startedAt)}
                    </td>
                    <td
                      className="border-b py-3 pr-3"
                      style={{ borderColor: tk.border }}
                    >
                      <SStatusBadge
                        isDark={isDark}
                        status={s.isActive ? "active" : "inactive"}
                      >
                        {s.isActive ? "Active" : "Ended"}
                      </SStatusBadge>
                    </td>
                    <td
                      className="border-b py-3 text-right"
                      style={{ borderColor: tk.border }}
                    >
                      {s.isActive && (
                        <SButton
                          isDark={isDark}
                          variant="ghost"
                          onClick={() => signOut(s.id)}
                          disabled={busy}
                        >
                          Sign out
                        </SButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {active.length > 1 && (
            <div className="mt-3">
              <SButton
                isDark={isDark}
                variant="secondary"
                onClick={() => signOut(null)}
                disabled={busy}
              >
                Sign out all sessions
              </SButton>
            </div>
          )}
        </>
      )}
    </SCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — Preferences
   ═══════════════════════════════════════════════════════════════════════════ */

const LANGUAGE_LABELS: Record<string, string> = {
  "en-US": "English (US)",
  "hi-IN": "\u0939\u093F\u0928\u094D\u0926\u0940 / Hindi",
  "mr-IN": "\u092E\u0930\u093E\u0920\u0940 / Marathi",
};

function PreferencesSection({ isDark }: { isDark: boolean }) {
  const toast = useToast();
  const tk = useTokens(isDark);
  const { theme, setTheme: applyTheme } = useCrmTheme();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [language, setLanguage] = useState("en-US");

  const load = useCallback(() => {
    api<any>("/api/settings/preferences")
      .then((r) => {
        setData(r);
        setLanguage(r.user.language);
        adoptServerTheme(r.user.theme);
      })
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const save = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const result = await api<any>("/api/settings/preferences", {
        method: "PATCH",
        json: payload,
      });
      setLanguage(result.user.language);
      toast("success", result.message);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadData = async () => {
    setExporting(true);
    try {
      const response = await fetch(
        "/api/settings/activity-logs?format=csv&from=1970-01-01",
      );
      if (!response.ok) throw new Error("Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "my-crm-data.csv";
      link.click();
      URL.revokeObjectURL(url);
      toast("success", "Export downloaded.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <SCard isDark={isDark}>
        <SSkeleton rows={4} isDark={isDark} />
      </SCard>
    );
  }

  if (!data) {
    return (
      <SCard isDark={isDark}>
        <p className="text-[14px]" style={{ color: tk.danger }}>
          Could not load preferences.
        </p>
      </SCard>
    );
  }

  return (
    <>
      <SCard
        title="UI Preferences"
        isDark={isDark}
        footer={
          <SButton isDark={isDark} onClick={() => save({ language })} loading={saving}>
            Save
          </SButton>
        }
      >
        <SBanner isDark={isDark} tone="warning">
          Language is stored but not applied — no translation catalogue exists yet.
        </SBanner>

        <SField label="Theme" isDark={isDark} hint="Applies immediately across the CRM.">
          <div className="grid gap-3 sm:grid-cols-2">
            {(["light", "dark"] as const).map((t) => (
              <label
                key={t}
                className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all duration-200"
                style={{
                  borderColor: theme === t ? tk.accent : tk.border,
                  background: theme === t ? `${tk.accent}10` : tk.surface,
                }}
              >
                <input
                  type="radio"
                  name="s-theme"
                  value={t}
                  checked={theme === t}
                  onChange={() => applyTheme(t)}
                  className="mt-0.5 h-4 w-4"
                  style={{ accentColor: tk.accent }}
                />
                <span>
                  <span
                    className="block text-[14px] font-medium"
                    style={{ color: tk.text }}
                  >
                    {t === "light" ? "Light mode" : "Dark mode"}
                  </span>
                  <span className="block text-[12px]" style={{ color: tk.muted }}>
                    {t === "light"
                      ? "Bright surfaces. Best in a well-lit room."
                      : "Dark surfaces. Easier on the eyes at night."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </SField>

        <SField label="Language" htmlFor="s-language" isDark={isDark}>
          <SSelect
            id="s-language"
            isDark={isDark}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {(data.catalogue?.languages ?? ["en-US"]).map((code: string) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code] ?? code}
              </option>
            ))}
          </SSelect>
        </SField>
      </SCard>

      <SCard
        title="Data & Privacy"
        description="Your activity record, exported as CSV."
        isDark={isDark}
      >
        <SButton
          isDark={isDark}
          variant="secondary"
          onClick={downloadData}
          loading={exporting}
        >
          <IoCloudDownloadOutline size={16} />
          Download my data
        </SButton>
      </SCard>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — Notifications
   ═══════════════════════════════════════════════════════════════════════════ */

function NotificationsSection({ isDark }: { isDark: boolean }) {
  const toast = useToast();
  const tk = useTokens(isDark);
  type Tab = "email" | "inapp" | "sms";
  const [tab, setTab] = useState<Tab>("email");
  const [deliveryVersion, setDeliveryVersion] = useState(0);
  const bumpDelivery = useCallback(
    () => setDeliveryVersion((n) => n + 1),
    [],
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: "email", label: "Email" },
    { id: "inapp", label: "In-App" },
    { id: "sms", label: "SMS" },
  ];

  return (
    <>
      {/* Tab bar */}
      <div
        className="mb-4 flex gap-1 rounded-2xl p-1"
        style={{ background: tk.surfaceAlt }}
        role="tablist"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className="min-h-[36px] flex-1 rounded-xl px-4 text-[13px] font-medium transition-all duration-200"
            style={{
              color: tab === entry.id ? tk.text : tk.muted,
              background: tab === entry.id ? tk.surface : "transparent",
              boxShadow:
                tab === entry.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "email" && (
        <SettingsSubComponentHost isDark={isDark}>
          <NotificationRecipients onRecipientsChanged={bumpDelivery} />
          <NotificationCenter deliveryVersion={deliveryVersion} />
        </SettingsSubComponentHost>
      )}

      {tab === "inapp" && <InAppNotifications isDark={isDark} />}

      {tab === "sms" && (
        <SCard title="SMS notifications" isDark={isDark}>
          <p className="text-[13px] leading-relaxed" style={{ color: tk.muted }}>
            SMS notifications are not available. No SMS gateway is connected.
          </p>
        </SCard>
      )}
    </>
  );
}

/* ── In-App Notifications ───────────────────────────────────────────────── */

interface InAppPrefs {
  browser: boolean;
  sound: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

function InAppNotifications({ isDark }: { isDark: boolean }) {
  const toast = useToast();
  const tk = useTokens(isDark);
  const [prefs, setPrefs] = useState<InAppPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<{ prefs: { inApp: InAppPrefs } }>("/api/settings/notifications")
      .then((r) => setPrefs(r.prefs.inApp))
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(load, [load]);

  const set = <K extends keyof InAppPrefs>(key: K, value: InAppPrefs[K]) =>
    setPrefs((c) => (c ? { ...c, [key]: value } : c));

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const result = await api<{ prefs: { inApp: InAppPrefs }; message: string }>(
        "/api/settings/notifications",
        { method: "PATCH", json: { inApp: prefs } },
      );
      setPrefs(result.prefs.inApp);
      toast("success", result.message);
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SCard isDark={isDark}>
        <SSkeleton rows={4} isDark={isDark} />
      </SCard>
    );
  }

  if (!prefs) {
    return (
      <SCard isDark={isDark}>
        <p className="text-[14px]" style={{ color: tk.danger }}>
          Could not load in-app preferences.
        </p>
      </SCard>
    );
  }

  return (
    <SCard
      title="In-app notifications"
      isDark={isDark}
      footer={
        <SButton isDark={isDark} onClick={save} loading={saving}>
          Save preferences
        </SButton>
      }
    >
      <SToggleRow
        label="Browser notifications"
        description="Show desktop notifications when the CRM is open."
        checked={Boolean(prefs.browser)}
        onChange={(v) => set("browser", v)}
        isDark={isDark}
      />
      <SToggleRow
        label="Sound"
        description="Play a sound for new notifications."
        checked={Boolean(prefs.sound)}
        onChange={(v) => set("sound", v)}
        isDark={isDark}
      />
      <SToggleRow
        label="Do not disturb"
        description="Mute notifications during a set time range."
        checked={Boolean(prefs.dndEnabled)}
        onChange={(v) => set("dndEnabled", v)}
        isDark={isDark}
      />
      {prefs.dndEnabled && (
        <div className="mt-3 grid gap-x-4 sm:grid-cols-2">
          <SField label="From" htmlFor="s-dnd-start" isDark={isDark}>
            <SInput
              id="s-dnd-start"
              isDark={isDark}
              type="time"
              value={prefs.dndStart}
              onChange={(e) => set("dndStart", e.target.value)}
            />
          </SField>
          <SField label="Until" htmlFor="s-dnd-end" isDark={isDark}>
            <SInput
              id="s-dnd-end"
              isDark={isDark}
              type="time"
              value={prefs.dndEnd}
              onChange={(e) => set("dndEnd", e.target.value)}
            />
          </SField>
        </div>
      )}
    </SCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — Activity Logs
   ═══════════════════════════════════════════════════════════════════════════ */

const ACTION_FILTERS: { label: string; value: string }[] = [
  { label: "All actions", value: "" },
  { label: "Login", value: "login" },
  { label: "Profile updates", value: "profile" },
  { label: "Password & security", value: "password" },
  { label: "Email changes", value: "email" },
  { label: "Preferences", value: "preferences" },
  { label: "Employee management", value: "employee" },
  { label: "Workspace changes", value: "workspace" },
  { label: "Sessions", value: "session" },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function ActivityLogsSection({ isDark }: { isDark: boolean }) {
  const toast = useToast();
  const tk = useTokens(isDark);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [filters, setFilters] = useState({
    from: isoDaysAgo(30),
    to: new Date().toISOString().slice(0, 10),
    action: "",
    page: 1,
  });

  const queryString = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        from: filters.from,
        to: `${filters.to}T23:59:59`,
        page: String(filters.page),
        ...extra,
      });
      if (filters.action) params.set("action", filters.action);
      return params.toString();
    },
    [filters],
  );

  const load = useCallback(() => {
    setLoading(true);
    api<any>(`/api/settings/activity-logs?${queryString()}`)
      .then(setData)
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [queryString, toast]);

  useEffect(load, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetch(
        `/api/settings/activity-logs?${queryString({ format: "csv" })}`,
      );
      if (!response.ok) throw new Error("Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `activity-logs-${filters.from}-to-${filters.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast("success", "Logs exported.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setExporting(false);
    }
  };

  const setFilter = (patch: Partial<typeof filters>) =>
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <>
      {/* Header with export */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2
            className="text-[16px] font-semibold"
            style={{ color: tk.text }}
          >
            Activity Logs
          </h2>
          <p className="text-[12px]" style={{ color: tk.muted }}>
            Sign-ins, settings changes and CRM activity.
          </p>
        </div>
        <SButton
          isDark={isDark}
          variant="secondary"
          onClick={exportCsv}
          loading={exporting}
        >
          Export CSV
        </SButton>
      </div>

      {/* Filters */}
      <SCard isDark={isDark}>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <SField label="From" htmlFor="s-log-from" isDark={isDark}>
            <SInput
              id="s-log-from"
              isDark={isDark}
              type="date"
              value={filters.from}
              onChange={(e) => setFilter({ from: e.target.value })}
            />
          </SField>
          <SField label="To" htmlFor="s-log-to" isDark={isDark}>
            <SInput
              id="s-log-to"
              isDark={isDark}
              type="date"
              value={filters.to}
              onChange={(e) => setFilter({ to: e.target.value })}
            />
          </SField>
          <SField label="Action type" htmlFor="s-log-action" isDark={isDark}>
            <SSelect
              id="s-log-action"
              isDark={isDark}
              value={filters.action}
              onChange={(e) => setFilter({ action: e.target.value })}
            >
              {ACTION_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </SSelect>
          </SField>
        </div>
      </SCard>

      {/* Results */}
      <SCard isDark={isDark}>
        {loading ? (
          <SSkeleton rows={6} isDark={isDark} />
        ) : !data || data.rows.length === 0 ? (
          <div className="text-center py-8">
            <IoTimeOutline
              size={32}
              className="mx-auto mb-2"
              style={{ color: tk.muted } as any}
            />
            <p
              className="text-[14px] font-medium"
              style={{ color: tk.text }}
            >
              No activity in this range
            </p>
            <p className="text-[12px] mt-1" style={{ color: tk.muted }}>
              Try widening the date range or clearing the action filter.
            </p>
          </div>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[600px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left">
                    {["Timestamp", "Action", "Details", "IP Address"].map(
                      (h) => (
                        <th
                          key={h}
                          className="border-b py-2 pr-3 text-[11px] font-semibold uppercase tracking-wider"
                          style={{ borderColor: tk.border, color: tk.muted }}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row: any) => (
                    <tr key={row.id}>
                      <td
                        className="border-b py-3 pr-3 whitespace-nowrap"
                        style={{ borderColor: tk.border, color: tk.muted }}
                      >
                        {new Date(row.timestamp).toLocaleString(undefined, {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td
                        className="border-b py-3 pr-3"
                        style={{ borderColor: tk.border }}
                      >
                        <SStatusBadge
                          isDark={isDark}
                          status={
                            row.action?.includes("failed")
                              ? "danger"
                              : row.source === "audit"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {row.action}
                        </SStatusBadge>
                      </td>
                      <td
                        className="border-b py-3 pr-3"
                        style={{ borderColor: tk.border, color: tk.text }}
                      >
                        <span className="line-clamp-2 block max-w-sm">
                          {row.details ?? "\u2014"}
                        </span>
                      </td>
                      <td
                        className="border-b py-3 pr-3"
                        style={{ borderColor: tk.border, color: tk.muted }}
                      >
                        {row.ipAddress ?? "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: tk.muted }}>
                Page {data.page} of {data.totalPages} {"\u00B7"} {data.total}{" "}
                entries
              </p>
              <div className="flex gap-2">
                <SButton
                  isDark={isDark}
                  variant="secondary"
                  onClick={() => setFilter({ page: filters.page - 1 })}
                  disabled={filters.page <= 1}
                >
                  Previous
                </SButton>
                <SButton
                  isDark={isDark}
                  variant="secondary"
                  onClick={() => setFilter({ page: filters.page + 1 })}
                  disabled={filters.page >= data.totalPages}
                >
                  Next
                </SButton>
              </div>
            </div>
          </>
        )}
      </SCard>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 — WhatsApp Integration
   ═══════════════════════════════════════════════════════════════════════════ */

interface WaStatus {
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

function WhatsAppSection({ isDark }: { isDark: boolean }) {
  const toast = useToast();
  const tk = useTokens(isDark);
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | undefined>();

  const digitsOnly = (v: string) => v.replace(/\D/g, "");

  const load = useCallback(() => {
    api<WaStatus>("/api/settings/whatsapp-integration")
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
    if (cleaned.length < 10 || cleaned.length > 15) {
      setError(
        "Enter the full number including country code, e.g. 919876543210.",
      );
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const result = await api<{
        whatsapp_number: string;
        message: string;
      }>("/api/users/update-whatsapp", {
        method: "POST",
        json: { whatsapp_number: cleaned },
      });
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
          : prev,
      );
      try {
        const cached = JSON.parse(
          localStorage.getItem("crm_user") ?? "{}",
        );
        localStorage.setItem(
          "crm_user",
          JSON.stringify({
            ...cached,
            whatsapp_number: result.whatsapp_number,
          }),
        );
      } catch {}
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
      <SCard isDark={isDark}>
        <SSkeleton rows={4} isDark={isDark} />
      </SCard>
    );
  }

  if (!status) {
    return (
      <SCard isDark={isDark}>
        <p className="text-[14px]" style={{ color: tk.danger }}>
          Could not load WhatsApp settings.
        </p>
      </SCard>
    );
  }

  const apiActive = status.api.active;
  const cleaned = digitsOnly(number);
  const unchanged = cleaned === (status.manual.number ?? "");

  return (
    <>
      {/* Header badge */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-semibold" style={{ color: tk.text }}>
          WhatsApp Integration
        </h2>
        {apiActive ? (
          <SStatusBadge isDark={isDark} status="active">
            Business API
          </SStatusBadge>
        ) : status.manual.configured ? (
          <SStatusBadge isDark={isDark} status="success">
            Personal number
          </SStatusBadge>
        ) : (
          <SStatusBadge isDark={isDark} status="pending">
            Not set up
          </SStatusBadge>
        )}
      </div>

      {/* Active channel */}
      <SCard title="Active channel" isDark={isDark}>
        <div className="space-y-3">
          <div
            className="flex items-start justify-between gap-4 rounded-2xl border px-4 py-4"
            style={{
              borderColor: apiActive ? tk.success : tk.border,
              background: apiActive ? `${tk.success}15` : tk.surfaceAlt,
            }}
          >
            <div className="flex-1">
              <p
                className="text-[14px] font-semibold"
                style={{ color: tk.text }}
              >
                WhatsApp Business API
              </p>
              <p
                className="mt-1 text-[12px] leading-relaxed"
                style={{ color: tk.muted }}
              >
                {apiActive
                  ? `Messages sent from company number${status.api.businessNumberHint ? ` (id ${status.api.businessNumberHint})` : ""}.`
                  : "Not connected. Personal number is in use."}
              </p>
            </div>
            <SStatusBadge isDark={isDark} status={apiActive ? "active" : "inactive"}>
              {apiActive ? "Live" : "Off"}
            </SStatusBadge>
          </div>

          <div
            className="flex items-start justify-between gap-4 rounded-2xl border px-4 py-4"
            style={{
              borderColor:
                !apiActive && status.manual.configured ? tk.success : tk.border,
              background:
                !apiActive && status.manual.configured
                  ? `${tk.success}15`
                  : tk.surfaceAlt,
            }}
          >
            <div className="flex-1">
              <p
                className="text-[14px] font-semibold"
                style={{ color: tk.text }}
              >
                My personal WhatsApp
              </p>
              <p
                className="mt-1 text-[12px] leading-relaxed"
                style={{ color: tk.muted }}
              >
                {apiActive
                  ? "Switched off. Business API is connected."
                  : status.manual.configured
                    ? '"Send WhatsApp" opens WhatsApp on your device.'
                    : "Add your number below to start messaging leads."}
              </p>
            </div>
            <SStatusBadge
              isDark={isDark}
              status={
                !apiActive && status.manual.configured ? "active" : "inactive"
              }
            >
              {!apiActive && status.manual.configured ? "Live" : "Off"}
            </SStatusBadge>
          </div>
        </div>

        {apiActive && (
          <SBanner isDark={isDark}>
            Manual sending is off while the Business API is connected. Your
            number is still used for CRM alerts.
          </SBanner>
        )}
      </SCard>

      {/* Number input */}
      <SCard
        title="My WhatsApp number"
        description={
          apiActive
            ? "Where the CRM delivers your WhatsApp alerts."
            : "The number your leads will see."
        }
        isDark={isDark}
        footer={
          <SButton
            isDark={isDark}
            onClick={save}
            loading={saving}
            disabled={unchanged && !error}
          >
            {status.manual.configured ? "Update number" : "Save number"}
          </SButton>
        }
      >
        <SField
          label="WhatsApp number"
          htmlFor="s-wa-number"
          hint="Include country code, digits only — e.g. 919876543210."
          error={error}
          isDark={isDark}
        >
          <SInput
            id="s-wa-number"
            isDark={isDark}
            type="tel"
            inputMode="numeric"
            maxLength={15}
            value={number}
            onChange={(e) => setNumber(digitsOnly(e.target.value))}
            placeholder="919876543210"
            hasError={Boolean(error)}
          />
        </SField>

        {!apiActive && cleaned.length >= 10 && (
          <div
            className="mt-3 rounded-2xl border px-4 py-3"
            style={{
              borderColor: tk.border,
              background: tk.surfaceAlt,
              color: tk.muted,
            }}
          >
            <p
              className="text-[13px] font-semibold"
              style={{ color: tk.text }}
            >
              <FaWhatsapp className="mr-1.5 inline" />
              Leads will be messaged from
            </p>
            <p className="text-[13px] font-mono mt-0.5">+{cleaned}</p>
          </div>
        )}
      </SCard>

      {/* How it works */}
      <SCard title="How this works" isDark={isDark}>
        <ul
          className="space-y-2 text-[13px] leading-relaxed"
          style={{ color: tk.muted }}
        >
          <li>
            <strong style={{ color: tk.text }}>Without the Business API</strong>{" "}
            — "Send WhatsApp" opens WhatsApp on your device.
          </li>
          <li>
            <strong style={{ color: tk.text }}>With the Business API</strong> —
            the CRM sends directly from the company number using approved
            templates.
          </li>
          <li>Your number is private to your account.</li>
        </ul>
      </SCard>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function NewSettingDesign({
  user,
  setUser,
  isDark,
}: {
  user: any;
  setUser: (fn: (prev: any) => any) => void;
  isDark: boolean;
}) {
  const tk = useTokens(isDark);
  const [section, setSection] = useState<Section>("profile");

  // Mobile: show nav or content
  const [mobileShowNav, setMobileShowNav] = useState(true);

  const selectSection = (id: Section) => {
    setSection(id);
    setMobileShowNav(false);
  };

  const renderSection = () => {
    switch (section) {
      case "profile":
        return (
          <ProfileSection isDark={isDark} user={user} setUser={setUser} />
        );
      case "account-security":
        return <AccountSecuritySection isDark={isDark} />;
      case "preferences":
        return <PreferencesSection isDark={isDark} />;
      case "notifications":
        return <NotificationsSection isDark={isDark} />;
      case "activity-logs":
        return <ActivityLogsSection isDark={isDark} />;
      case "whatsapp":
        return <WhatsAppSection isDark={isDark} />;
    }
  };

  return (
    <SourcingToastProvider isDark={isDark}>
      <div className="animate-fadeIn h-full flex flex-col md:flex-row gap-0 md:gap-6 max-w-5xl mx-auto px-4 md:px-6 w-full py-6">
        {/* ── Desktop sidebar nav ── */}
        <nav className="hidden md:block w-[220px] flex-shrink-0">
          <h1
            className="text-xl font-semibold tracking-tight mb-4"
            style={{ color: tk.text }}
          >
            Settings
          </h1>
          <div className="space-y-1">
            {NAV.map(({ id, label, icon: Icon }) => {
              const active = section === id;
              return (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 border border-transparent ${
                    active
                      ? isDark
                        ? "bg-[#2C2C2E] border-[#38383A]"
                        : "bg-white border-[#E5E5EA] shadow-sm"
                      : isDark
                        ? "hover:bg-[#2C2C2E]"
                        : "hover:bg-[#F2F2F7]"
                  }`}
                  style={{
                    color: active ? tk.text : tk.muted,
                  }}
                >
                  <Icon size={16} />
                  {label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ── Mobile nav / content toggle ── */}
        <div className="md:hidden">
          {mobileShowNav ? (
            <div>
              <h1
                className="text-xl font-semibold tracking-tight mb-4"
                style={{ color: tk.text }}
              >
                Settings
              </h1>
              <div className="space-y-1">
                {NAV.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => selectSection(id)}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl text-[14px] font-medium transition-all duration-200 ${tk.bgCard}`}
                    style={{ color: tk.text }}
                  >
                    <span className="flex items-center gap-3">
                      <span style={{ color: tk.accent }}><Icon size={18} /></span>
                      {label}
                    </span>
                    <IoChevronForward
                      size={14}
                      style={{ color: tk.muted }}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setMobileShowNav(true)}
                className="flex items-center gap-1.5 mb-4 text-[13px] font-medium"
                style={{ color: tk.accent }}
              >
                <IoChevronBack size={16} />
                Settings
              </button>
              {renderSection()}
            </div>
          )}
        </div>

        {/* ── Desktop content ── */}
        <div className="hidden md:block flex-1 min-w-0 overflow-y-auto max-h-[calc(100dvh-120px)] custom-scrollbar">
          {renderSection()}
        </div>
      </div>
    </SourcingToastProvider>
  );
}
