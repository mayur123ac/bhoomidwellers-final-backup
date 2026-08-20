"use client";

import type React from "react";
import HeaderClock from "@/components/HeaderClock";

/** Single source for the bar's height. Hosts do not restate it. */
export const APP_HEADER_HEIGHT = "h-16";

/** Single source for the bar's horizontal inset. */
export const APP_HEADER_PADDING = "px-4 sm:px-6";

/**
 * The brand mark, at the one size every bar uses.
 */
export function AppLogo({
  src = "/assets/bhoomidwellersLogo_trans.png",
  className = "",
}: {
  src?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={src}
      alt="Bhoomi Dwellers"
      className={`h-12 w-auto max-w-[190px] object-contain flex-shrink-0 transition-opacity duration-200 hover:opacity-80 ${className}`}
    />
  );
}

/**
 * A seamless 36px/32px square control — theme toggle, notification bell, profile avatar.
 * Redesigned to HIG standards: borderless by default, perfectly rounded, with a subtle 
 * background fill on hover/active states.
 */
export function HeaderControl({
  isDark,
  onClick,
  label,
  size = "md",
  className = "",
  children,
  ...rest
}: {
  isDark: boolean;
  onClick?: () => void;
  label: string;
  size?: "sm" | "md";
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
        size === "sm" ? "h-8 w-8" : "h-9 w-9",
        "flex-shrink-0 rounded-full flex items-center justify-center outline-none",
        "transition-all duration-200 cursor-pointer",
        isDark
          ? "text-[#98989D] hover:bg-white/10 hover:text-white active:bg-white/20"
          : "text-[#86868B] hover:bg-black/5 hover:text-[#1D1D1F] active:bg-black/10",
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
      className="hidden sm:block h-4 w-px flex-shrink-0 rounded-full"
      style={{ background: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }}
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
  surfaceClassName,
  surfaceStyle,
}: {
  isDark: boolean;
  context?: string;
  role?: string | null;
  leading?: React.ReactNode;
  children: React.ReactNode;
  logoSrc?: string;
  surfaceClassName?: string;
  surfaceStyle?: React.CSSProperties;
}) {
  const hostOwnsSurface = surfaceClassName !== undefined || surfaceStyle !== undefined;

  return (
    <header
      className={`${APP_HEADER_HEIGHT} ${APP_HEADER_PADDING} flex items-center justify-between gap-3 z-30 flex-shrink-0 transition-colors duration-300 ${surfaceClassName ? ` ${surfaceClassName}` : ""
        }`}
      style={
        hostOwnsSurface
          ? surfaceStyle
          : {
            // Apple's translucent background materials with heavy blur
            background: isDark ? "rgba(28, 28, 30, 0.75)" : "rgba(250, 250, 252, 0.75)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderBottom: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.06)",
          }
      }
    >
      {/* ── Left: brand → context → role ── */}
      <div className="flex items-center gap-3 min-w-0">
        <AppLogo src={logoSrc} />

        {context && (
          <>
            <Divider isDark={isDark} />
            <h1
              className="text-[14px] sm:text-[15px] font-semibold tracking-tight truncate"
              style={{ color: isDark ? "#FFFFFF" : "#1D1D1F" }}
            >
              {context}
            </h1>
          </>
        )}

        {role && (
          <span
            className="hidden md:inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize whitespace-nowrap flex-shrink-0 tracking-wide"
            style={{
              // Neutral, subtle tinting typical of iOS/macOS labels
              background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
              color: isDark ? "#E5E5EA" : "#1D1D1F",
            }}
          >
            {role}
          </span>
        )}
      </div>

      {/* ── Right: controls ── */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
        {leading}
        {/* <HeaderClock isDark={isDark} /> */}
        {children}
      </div>
    </header>
  );
}