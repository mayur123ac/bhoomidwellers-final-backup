"use client";

import type React from "react";
import HeaderClock from "@/components/HeaderClock"; // Uncomment if used in your tree

/** 
 * Apple standard navigation bar heights.
 * Note: We do not hardcode the total height. We use the base height (44px/52px) 
 * PLUS the iOS safe-area-inset to natively push content below the Dynamic Island/Notch.
 */
export const APP_HEADER_HEIGHT = "min-h-[calc(45px+env(safe-area-inset-top))] sm:min-h-[calc(52px+env(safe-area-inset-top))]";
export const APP_HEADER_PADDING = "px-4 sm:px-6";

const appleFontStack = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/**
 * The brand mark.
 */
/**
 * The brand mark.
 */
export function AppLogo({
  src = "/assets/bhoomidwellers.png",
  style,
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
      className={`object-contain flex-shrink-0 transition-opacity duration-200 hover:opacity-80 ${className}`}
      style={{ width: "auto", height: "clamp(52px, 8vw, 70px)", maxWidth: "200px", ...style }}
    />
  );
}
/**
 * Circular icon buttons for Theme, Profile, Notifications.
 * HIG strictly dictates a 44x44pt minimum touch target. We achieve this by adding padding 
 * around the visual element, so it's easy to tap on an iPhone without making the icon massive.
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
  const visualSize = size === "sm" ? "h-7 w-7" : "h-8 w-8 sm:h-9 sm:w-9";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      // The button itself spans at least 44px for tapping, the inner div is the visual circle.
      className={`relative flex items-center justify-center p-1.5 min-w-[44px] min-h-[44px] group outline-none cursor-pointer flex-shrink-0 ${className}`}
      {...rest}
    >
      <div
        className={[
          visualSize,
          "rounded-full flex items-center justify-center transition-all duration-200",
          "group-active:scale-90", // Apple-style spring compression on tap
          isDark
            ? "text-[#EBEBF5] bg-white/5 group-hover:bg-white/15 group-active:bg-white/20"
            : "text-[#3C3C43] bg-black/[0.03] group-hover:bg-black/5 group-active:bg-black/10",
        ].join(" ")}
      >
        {children}
      </div>
    </button>
  );
}

/** Apple UI hairline divider */
function Divider({ isDark }: { isDark: boolean }) {
  return (
    <span
      aria-hidden
      className="hidden sm:block h-4 w-[1px] flex-shrink-0 rounded-full"
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
  logoSrc = "/assets/bhoomidwellers.png",
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

  // Apple iOS standard navigation bar surface (Chrome)
  const defaultGlassStyle: React.CSSProperties = {
    backgroundColor: isDark ? "#1C1C1E" : "rgba(255, 255, 255, 0.75)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    borderBottom: `0.5px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"}`,
  };

  return (
    <header
      className={`${APP_HEADER_HEIGHT} ${APP_HEADER_PADDING} pt-[env(safe-area-inset-top)] flex items-center justify-between gap-2 sm:gap-4 z-40 flex-shrink-0 sticky top-0 w-full transition-colors duration-300 ${surfaceClassName || ""}`}
      style={{
        fontFamily: appleFontStack,
        ...(hostOwnsSurface ? surfaceStyle : defaultGlassStyle),
      }}
    >
      {/* ── Left: brand → context → role ── */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        <AppLogo src={logoSrc} />

        {context && (
          <>
            <Divider isDark={isDark} />
            <h1
              className="font-semibold truncate hidden md:inline sm:inline"
              style={{
                // Apple standard: 17px for navigation titles, -0.41px tracking
                fontSize: "17px",
                letterSpacing: "-0.41px",
                lineHeight: "22px",
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
            className="hidden md:inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide capitalize whitespace-nowrap flex-shrink-0"
            style={{
              background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)",
              color: isDark ? "rgba(235, 235, 245, 0.8)" : "rgba(60, 60, 67, 0.8)",
            }}
          >
            {role}
          </span>
        )}
      </div>

      {/* ── Right: controls ── */}
      <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
        {leading}
        {children}
      </div>
    </header>
  );
}