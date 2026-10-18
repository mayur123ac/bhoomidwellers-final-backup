"use client";

// NotificationPopover — header bell dropdown. Rule of Three: max 3 rows, no scroll.
// Neutral colours come from the `theme` prop (app toggle), never Tailwind `dark:`.

import React from "react";
import {
  FaBell,
  FaCalendarAlt,
  FaBriefcase,
  FaTimes,
  FaCheck,
  FaChevronRight,
} from "react-icons/fa";
import type { CrmNotification } from "@/lib/hooks/useNotificationFeed";
import { NOTIFICATION_POPOVER_LIMIT } from "@/lib/hooks/useNotificationFeed";

export interface NotificationPopoverTheme {
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  itemHover: string;
  footer: string;
}

export interface NotificationPopoverProps {
  title: string;
  caption?: string;
  items: CrmNotification[];
  total?: number;
  footerNoun: string;
  theme: NotificationPopoverTheme;
  accent: "purple" | "orange" | "green";
  onOpenLead: (notification: CrmNotification) => void;
  onDismiss?: (notification: CrmNotification) => void;
  onSeeAll: () => void;
  renderDetail?: (notification: CrmNotification) => React.ReactNode;
  renderMetric?: (notification: CrmNotification) => React.ReactNode;
}

type Accent = NotificationPopoverProps["accent"];

const ACCENT_TEXT: Record<Accent, string> = {
  purple: "text-[#AF52DE]",
  orange: "text-[#FF9500]",
  green: "text-[#34C759]",
};

const ACCENT_RING: Record<Accent, string> = {
  purple: "focus-visible:ring-[#AF52DE]/50",
  orange: "focus-visible:ring-[#FF9500]/50",
  green: "focus-visible:ring-[#34C759]/50",
};

// Apple system colours, one per notification kind. Tile = 14% tint, glyph = solid.
const KIND: Record<string, { color: string; icon: React.ReactNode }> = {
  site_visit: { color: "#FF9500", icon: <FaCalendarAlt className="text-[13px]" /> },
  follow_up: { color: "#AF52DE", icon: <FaBell className="text-[13px]" /> },
  default: { color: "#34C759", icon: <FaBriefcase className="text-[13px]" /> },
};

function kindOf(kind: CrmNotification["kind"]) {
  return KIND[kind as string] ?? KIND.default;
}

/** Zero state — a blank popover reads as broken. */
export function AllCaughtUp({
  theme,
  noun,
}: {
  theme: NotificationPopoverTheme;
  noun?: string;
}) {
  return (
    <div className="px-6 py-10 flex flex-col items-center justify-center text-center">
      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-[#34C759]/15 text-[#34C759]">
        <FaCheck className="text-[18px]" />
      </div>
      <p className={`text-[15px] font-semibold tracking-[-0.01em] ${theme.text}`}>
        You&apos;re all caught up
      </p>
      {noun && (
        <p className={`text-[13px] mt-0.5 tracking-[-0.01em] ${theme.textMuted}`}>
          No {noun}
        </p>
      )}
    </div>
  );
}

export default function NotificationPopover({
  title,
  caption,
  items,
  total,
  footerNoun,
  theme,
  accent,
  onOpenLead,
  onDismiss,
  onSeeAll,
  renderDetail,
  renderMetric,
}: NotificationPopoverProps) {
  const count = total ?? items.length;
  // overflow-hidden, not auto: ≤3 rows means nothing should ever scroll.
  const shown = items.slice(0, NOTIFICATION_POPOVER_LIMIT);
  const hasMore = count > NOTIFICATION_POPOVER_LIMIT;
  const ring = ACCENT_RING[accent];

  return (
    <>
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`text-[17px] font-semibold tracking-[-0.022em] leading-tight truncate ${theme.text}`}>
            {title}
          </h3>
          {caption && (
            <p className={`text-[12px] mt-0.5 tracking-[-0.01em] truncate ${theme.textMuted}`}>
              {caption}
            </p>
          )}
        </div>
        {count > 0 && (
          <span
            aria-label={`${count} total`}
            className="mt-0.5 min-w-[22px] h-[22px] px-2 inline-flex items-center justify-center rounded-full text-[12px] font-semibold tabular-nums flex-shrink-0 bg-[#8E8E93]/15 text-[#8E8E93]"
          >
            {count}
          </span>
        )}
      </div>

      {/* Rows */}
      <div className="overflow-hidden px-2 pb-2">
        {shown.length === 0 ? (
          <AllCaughtUp theme={theme} noun={footerNoun} />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((n) => {
              const k = kindOf(n.kind);
              return (
                <li key={n.id} className="group relative">
                  {/* Main action */}
                  <button
                    type="button"
                    onClick={() => onOpenLead(n)}
                    className={`w-full text-left flex items-center gap-4 px-3 py-2.5 rounded-[12px] cursor-pointer transition-colors duration-150 outline-none focus-visible:ring-2 ${ring} ${theme.itemHover}`}
                  >
                    <span
                      className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${k.color}24`, color: k.color }}
                    >
                      {k.icon}
                    </span>

                    <span className="flex-1 min-w-0 block">
                      <span className={`block text-[14px] font-bold tracking-[-0.01em] leading-[1.25] truncate text-[#9E217B]`}>
                        {n.title}
                      </span>
                      <span className={`block text-[13px] mt-px tracking-[-0.01em] leading-[1.3] truncate ${theme.textMuted}`}>
                        {n.subtitle}
                      </span>
                      {renderDetail?.(n)}
                    </span>

                    {renderMetric && (
                      <span
                        className={`flex-shrink-0 text-right transition-opacity duration-150 ${onDismiss ? "group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:group-hover:opacity-100" : ""
                          }`}
                      >
                        {renderMetric(n)}
                      </span>
                    )}
                  </button>

                  {/* Dismiss: replaces the metric on hover/focus; always visible on touch */}
                  {onDismiss && (
                    <button
                      type="button"
                      onClick={() => onDismiss(n)}
                      aria-label={`Dismiss ${n.title}`}
                      className={`absolute top-1/2 -translate-y-1/2 right-4 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer outline-none transition-all duration-150 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 focus-visible:opacity-100 focus-visible:scale-100 focus-visible:ring-2 [@media(hover:none)]:hidden bg-[#8E8E93]/20 hover:bg-[#8E8E93]/35 ${theme.textMuted} ${ring}`}
                    >
                      <FaTimes className="text-[10px]" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      {hasMore && (
        <button
          type="button"
          onClick={onSeeAll}
          className={`w-full px-5 py-3 text-[13px] font-medium tracking-[-0.01em] cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset ${ring} flex items-center justify-between ${theme.border} ${theme.itemHover} ${ACCENT_TEXT[accent]}`}
        >
          <span>
            See all {count} {footerNoun}
          </span>
          <FaChevronRight className="text-[10px] opacity-70" aria-hidden="true" />
        </button>
      )}
    </>
  );
}