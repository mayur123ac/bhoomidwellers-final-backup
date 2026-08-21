"use client";

import type React from "react";
import HeaderClock from "@/components/HeaderClock";

/** 
 * Apple standard navigation bar heights: 
 * Mobile is traditionally 44px, Desktop/iPad is slightly taller. 
 */
export const APP_HEADER_HEIGHT = "h-[44px] sm:h-[52px]";

/** Single source for the bar's horizontal inset. */
export const APP_HEADER_PADDING = "px-4 sm:px-6";

/** Apple system font stack ensures SF Pro renders on Apple devices */
const appleFontStack = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/**
 * The brand mark.
 */
export function AppLogo({
  src = "/assets/bhoomidwellersLogo_trans.png",
  style = { width: "20px" },
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
      className={` object-contain flex-shrink-0 transition-opacity duration-200 hover:opacity-80 ${className}`}
      style={{ width: "150px" }}
    />
  );
}

/**
 * Circular icon buttons for Theme, Profile, Notifications.
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
        size === "sm" ? "h-7 w-7" : "h-8 w-8 sm:h-9 sm:w-9",
        "flex-shrink-0 rounded-full flex items-center justify-center outline-none",
        "transition-all duration-200 cursor-pointer active:scale-95", // Apple-style click scale
        isDark
          ? "text-[#EBEBF5] hover:bg-white/15 active:bg-white/20"
          : "text-[#3C3C43] hover:bg-black/5 active:bg-black/10",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Apple UI hairline divider */
function Divider({ isDark }: { isDark: boolean }) {
  return (
    <span
      aria-hidden
      className="hidden sm:block h-5 w-px flex-shrink-0"
      style={{ background: isDark ? "rgba(84, 84, 88, 0.65)" : "rgba(60, 60, 67, 0.29)" }}
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
      className={`${APP_HEADER_HEIGHT} ${APP_HEADER_PADDING} flex items-center justify-between gap-2 sm:gap-4 z-30 flex-shrink-0 transition-colors duration-300 ${surfaceClassName ? ` ${surfaceClassName}` : ""
        }`}
      style={{
        fontFamily: appleFontStack,
        ...(hostOwnsSurface
          ? surfaceStyle
          : {
            // Apple System Colors for surfaces
            background: isDark ? "#1C1C1E" : "#FFFFFF",
            // Apple standard hairline borders
            borderBottom: isDark
              ? "0.5px solid rgba(84, 84, 88, 0.65)"
              : "0.5px solid rgba(60, 60, 67, 0.29)",
          }),
      }}
    >
      {/* ── Left: brand → context → role ── */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <AppLogo src={logoSrc} />

        {context && (
          <>
            <Divider isDark={isDark} />
            <h1
              className="font-semibold truncate"
              style={{
                // Apple standard: 17px for mobile inline titles, tight tracking
                fontSize: "clamp(12px, 2vw, 16px)",
                letterSpacing: "-0.41px",
                color: isDark ? "#FFFFFF" : "#000000"
              }}
            >
              {context}
            </h1>
          </>
        )}

        {role && (
          <span
            // Apple standard: fully rounded capsule for tags, small semibold text
            className="hidden md:inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] sm:text-[12px] font-medium tracking-wide capitalize whitespace-nowrap flex-shrink-0"
            style={{
              background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)",
              color: isDark ? "rgba(235, 235, 245, 0.6)" : "rgba(60, 60, 67, 0.6)",
            }}
          >
            {role}
          </span>
        )}
      </div>

      {/* ── Right: controls ── */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {leading}
        {children}
      </div>
    </header>
  );
}