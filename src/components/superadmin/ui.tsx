"use client";

// components/superadmin/ui.tsx — the small set of primitives every Super Admin
// view is built from.
//
// They exist so the panel has one answer to "what does a section heading look
// like", rather than six. The brief asks for no unnecessary cards everywhere, so
// the default container here is a plain bordered surface, not a shadowed card:
// StatTile and Panel are the only things that ever sit above the page plane, and
// their shadow is a hairline.

import type React from "react";
import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";

/** Section heading with an optional trailing control. */
export function SectionHead({
  title, sub, right, t,
}: { title: string; sub?: string; right?: React.ReactNode; t: SuperAdminTheme }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: t.text }}>{title}</h2>
        {sub && <p className="text-[12px] mt-0.5" style={{ color: t.textMuted }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** A plain bordered surface. The default container. */
export function Panel({
  t, className = "", children, style,
}: { t: SuperAdminTheme; className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl overflow-hidden ${className}`}
      style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow, ...style }}
    >
      {children}
    </div>
  );
}

/**
 * A single platform metric.
 *
 * The number carries the weight; the label is small and quiet above it. No icon,
 * no sparkline, no percentage-change chip — none of those are knowable in Phase
 * 1, and inventing them would be inventing data.
 */
export function StatTile({
  label, value, hint, t,
}: { label: string; value: string | number; hint?: string; t: SuperAdminTheme }) {
  return (
    <div
      className="rounded-2xl px-4 py-4 sm:px-5 sm:py-5"
      style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow }}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: t.textMuted }}>
        {label}
      </p>
      <p className="text-[26px] sm:text-[30px] font-semibold tracking-tight mt-1.5 tabular-nums" style={{ color: t.text }}>
        {value}
      </p>
      {hint && <p className="text-[11px] mt-1" style={{ color: t.textMuted }}>{hint}</p>}
    </div>
  );
}

const STATUS_TONE = {
  active: "positive", inactive: "textMuted", suspended: "danger", notice: "info", warning: "warning", info: "info",
  // Added with the Super Admin master controls. `online`/`offline` are login
  // state; `published`/`draft` are an announcement's publication state. Both
  // ride the same pill so the panel has one way of showing a state, and both
  // resolve through the theme rather than a literal colour so they read on the
  // navy ramp and the white one alike.
  online: "positive", offline: "textMuted",
  published: "positive", draft: "warning",
} as const;

/** Status pill. Colour comes from the theme so it reads on both ramps. */
export function StatusPill({ status, t }: { status: string; t: SuperAdminTheme }) {
  const key = (STATUS_TONE as Record<string, keyof SuperAdminTheme>)[status] ?? "textMuted";
  const colour = t[key] as string;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium capitalize whitespace-nowrap"
      style={{ color: colour, background: tint(colour, 0.12) }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: colour }} />
      {status}
    </span>
  );
}

/** Monospace id with a copy affordance — org ids are UUIDs and get read aloud. */
export function MonoId({ value, t, short = true }: { value: string; t: SuperAdminTheme; short?: boolean }) {
  return (
    <span
      className="font-mono text-[11px] px-1.5 py-0.5 rounded-md whitespace-nowrap"
      style={{ color: t.textMuted, background: t.raised }}
      title={value}
    >
      {short ? value.slice(0, 8) : value}
    </span>
  );
}

/** Search field. One shape, used by Organizations and Users. */
export function SearchField({
  value, onChange, placeholder, t,
}: { value: string; onChange: (v: string) => void; placeholder: string; t: SuperAdminTheme }) {
  return (
    <div className="relative w-full sm:w-72">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="14" height="14"
        viewBox="0 0 24 24" fill="none" stroke={t.textMuted} strokeWidth="2.2" strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-2 rounded-xl text-[13px] outline-none transition-colors"
        style={{ background: t.raised, color: t.text, border: `1px solid transparent` }}
        onFocus={e => { e.currentTarget.style.borderColor = t.borderStrong; }}
        onBlur={e => { e.currentTarget.style.borderColor = "transparent"; }}
      />
    </div>
  );
}

/** Segmented filter. Used for status filters on the list views. */
export function Segmented({
  options, value, onChange, t,
}: { options: string[]; value: string; onChange: (v: string) => void; t: SuperAdminTheme }) {
  return (
    <div className="flex p-0.5 rounded-xl overflow-x-auto no-scrollbar" style={{ background: t.raised }}>
      {options.map(o => {
        const on = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            className="px-3 py-1.5 rounded-[10px] text-[12px] font-medium capitalize whitespace-nowrap transition-colors"
            style={on
              ? { background: t.surface, color: t.text, boxShadow: t.shadow }
              : { color: t.textMuted, background: "transparent" }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A button whose action does not exist yet.
 *
 * Phase 1 forbids API routes, so every row action is a placeholder. Rather than
 * render a live-looking button that silently does nothing, these are visibly
 * disabled and say why on hover — the reviewer can tell built from not-built at
 * a glance, which is the point of shipping a UI phase first.
 */
export function PlaceholderAction({
  label, t, title = "Available once platform APIs are wired (Phase 2)",
}: { label: string; t: SuperAdminTheme; title?: string }) {
  return (
    <button
      type="button"
      disabled
      title={title}
      className="px-2.5 py-1 rounded-lg text-[12px] font-medium cursor-not-allowed whitespace-nowrap"
      style={{ color: t.textMuted, background: t.raised, opacity: 0.75 }}
    >
      {label}
    </button>
  );
}

/** Empty state. Quiet, centred, no illustration. */
export function EmptyState({ title, sub, t }: { title: string; sub?: string; t: SuperAdminTheme }) {
  return (
    <div className="py-16 text-center">
      <p className="text-[13px] font-medium" style={{ color: t.text }}>{title}</p>
      {sub && <p className="text-[12px] mt-1" style={{ color: t.textMuted }}>{sub}</p>}
    </div>
  );
}

/** Label/value row used by the organization detail sheet. */
export function DetailRow({
  label, value, t, mono = false,
}: { label: string; value: React.ReactNode; t: SuperAdminTheme; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-[12px] flex-shrink-0" style={{ color: t.textMuted }}>{label}</span>
      <span
        className={`text-[13px] font-medium text-right break-words ${mono ? "font-mono text-[11px]" : ""}`}
        style={{ color: t.text }}
      >
        {value}
      </span>
    </div>
  );
}

/** Dates are shown the same way everywhere: "18 Jun 2026". */
export const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Relative time for "last activity", which is scanned rather than read. */
export function fmtRelative(v: string | null): string {
  if (!v) return "No activity";
  const diff = Date.now() - new Date(v).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(v);
}
