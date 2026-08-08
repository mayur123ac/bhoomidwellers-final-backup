"use client";

// components/AppHeader.tsx — the CRM's global header bar.
//
// ── Why this is a new file ──────────────────────────────────────────────────
// There was no shared header to edit. Every surface carried its own copy of the
// same bar, and they had drifted: Settings ran at h-16 with a blurred white
// background, the Sales dashboard at `h-14 sm:h-18` with a themed one, and both
// rendered a 5rem-tall logo inside a 3.5–4rem-tall bar — which is why the
// branding looked oversized and the bar looked crowded. Polishing one copy
// would have widened that gap rather than closing it.
//
// So the bar itself lives here once, and each host passes what differs: the
// page context, and the controls on the right.
//
// ── What it does NOT own ────────────────────────────────────────────────────
// Nothing below the header. No sidebar, no page content, no routing, no data.
// The right-hand controls stay owned by their hosts — their popups, state and
// click handlers are untouched and are passed in as children. This component
// contributes the frame, the spacing scale and the control chrome, and that is
// deliberately all it contributes.

import type React from "react";

/** Single source for the bar's height. Hosts do not restate it. */
export const APP_HEADER_HEIGHT = "h-16";

/**
 * A 36px square control — theme toggle, notification bell, profile avatar.
 *
 * These used to be three different sizes with three different borders (and the
 * bell had no chrome at all, sitting as a bare glyph between two bordered
 * buttons). One size and one border is the whole of the "consistent controls"
 * requirement; the interesting part of each control is still whatever the host
 * puts inside it.
 */
export function HeaderControl({
  isDark,
  onClick,
  label,
  className = "",
  children,
  ...rest
}: {
  isDark: boolean;
  onClick?: () => void;
  label: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        "h-9 w-9 flex-shrink-0 rounded-lg border flex items-center justify-center",
        // No scale transforms and no drop shadows: a control that jumps under
        // the cursor reads as a toy, and this bar has four of them side by side.
        "transition-colors duration-150 cursor-pointer",
        isDark
          ? "border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white"
          : "border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-[#F9FAFB] hover:text-[#111827]",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Hairline separator between the logo and the page context. */
function Divider({ isDark }: { isDark: boolean }) {
  return (
    <span
      aria-hidden
      className="hidden sm:block h-5 w-px flex-shrink-0"
      style={{ background: isDark ? "rgba(255,255,255,0.12)" : "rgba(17,24,39,0.10)" }}
    />
  );
}

export default function AppHeader({
  isDark,
  context,
  role,
  leading,
  children,
  logoSrc = "/assets/bhoomidwellersLogo_trans.png",
}: {
  isDark: boolean;
  /** Where the user is, e.g. "Inventory" or "Settings · Notifications". */
  context?: string;
  /** Shown as the badge beside the context. */
  role?: string | null;
  /** Host-specific control placed before the right cluster (e.g. a drawer button). */
  leading?: React.ReactNode;
  /** The right-hand controls, in order: attendance, theme, notifications, profile. */
  children: React.ReactNode;
  logoSrc?: string;
}) {
  return (
    <header
      className={`${APP_HEADER_HEIGHT} flex items-center justify-between gap-3 px-4 sm:px-6 z-30 flex-shrink-0`}
      style={{
        background: isDark ? "#0d0d14" : "#FFFFFF",
        // A flat hairline instead of the previous blur-and-translucency. The
        // page scrolls under this bar, and a semi-transparent header over a
        // gradient page was the reason the text contrast moved as you scrolled.
        borderBottom: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid #ECEDF1",
      }}
    >
      {/* ── Left: brand → context → role ── */}
      <div className="flex items-center gap-3 min-w-0">
        <img
          src={logoSrc}
          alt="Bhoomi Dwellers"
          // Constrained to the bar. The old rule was `h-20 md:h-18` inside an
          // h-16 header, so the logo overflowed its own container and forced
          // the title text off-centre.
          className="h-8 w-auto max-w-[132px] object-contain flex-shrink-0"
        />

        {context && (
          <>
            <Divider isDark={isDark} />
            <h1
              className="text-[13px] sm:text-sm font-semibold tracking-tight truncate"
              style={{ color: isDark ? "#F3F4F6" : "#111827" }}
            >
              {context}
            </h1>
          </>
        )}

        {role && (
          <span
            className="hidden md:inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize whitespace-nowrap flex-shrink-0"
            style={{
              // Tinted rather than outlined, so the badge sits behind the page
              // title in the hierarchy instead of competing with it.
              background: isDark ? "rgba(217,70,168,0.14)" : "rgba(158,33,123,0.08)",
              color: isDark ? "#e879c4" : "#9E217B",
            }}
          >
            {role}
          </span>
        )}
      </div>

      {/* ── Right: controls ──
          gap-2 throughout, so the four controls read as one cluster rather than
          as four things that happen to be near each other. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {leading}
        {children}
      </div>
    </header>
  );
}
