"use client";

// NotificationPopover — the header bell's dropdown, under the Rule of Three.
//
// A popover shows at most three items and never scrolls. Beyond three it hands
// the rest to the Notification Center. The server sorts follow-ups by the most
// neglected first and site visits by the soonest first, so the three you see
// are the three that matter. The footer says how many there are in total.
//
// ── Theming ────────────────────────────────────────────────────────────────
// Neutral colours (text, borders, hover, footer) come from the `theme` prop, so
// the popover always matches the APP's light/dark toggle. Tailwind's `dark:`
// variant is deliberately NOT used: by default it follows the OS setting
// (prefers-color-scheme), not the app's toggle. With a dark OS and a light app,
// `dark:text-white` painted white titles on a white card, visible only on hover
// when the group-hover accent colour kicked in.
//
// Accent colours are single mid-tones that read on both light and dark cards,
// and the badge tint uses an alpha of the accent, so no dark variant is needed.

import React from "react";
import { FaBell, FaCalendarAlt, FaBriefcase, FaTimes, FaCheckCircle } from "react-icons/fa";
import type { CrmNotification } from "@/lib/hooks/useNotificationFeed";
import { NOTIFICATION_POPOVER_LIMIT } from "@/lib/hooks/useNotificationFeed";

export interface NotificationPopoverTheme {
  /** Primary text colour class, e.g. "text-gray-900" / "text-white". */
  text: string;
  /** Secondary text colour class. */
  textMuted: string;
  textFaint: string;
  /** Border colour class, e.g. "border-black/5". */
  border: string;
  /** Row hover background class, e.g. "hover:bg-black/[0.03]". */
  itemHover: string;
  /** Full-width footer button (colour + hover classes). */
  footer: string;
}

export interface NotificationPopoverProps {
  title: string;
  caption?: string;
  items: CrmNotification[];
  /** Total before the cap — what the footer counts. Defaults to items.length. */
  total?: number;
  /** Footer wording: "See all 12 pending follow-ups". */
  footerNoun: string;
  theme: NotificationPopoverTheme;
  accent: "purple" | "orange" | "green";
  /** Opens the Lead Detail panel for this notification's lead. */
  onOpenLead: (notification: CrmNotification) => void;
  /** Per-browser dismissal. Omit to hide the × entirely. */
  onDismiss?: (notification: CrmNotification) => void;
  /** Footer click: closes the popover and switches to the Notification Center. */
  onSeeAll: () => void;
  /** Extra line under the title, decorated from the caller's own lead list. */
  renderDetail?: (notification: CrmNotification) => React.ReactNode;
  /** Right-hand metric, e.g. the "7d" badge or the TODAY pill. */
  renderMetric?: (notification: CrmNotification) => React.ReactNode;
}

type Accent = NotificationPopoverProps["accent"];

// Icon tile background (solid accent).
const ACCENT_BG: Record<Accent, string> = {
  purple: "bg-[#AF52DE]",
  orange: "bg-[#FF9500]",
  green: "bg-[#34C759]",
};

// Count badge: accent text on a 15% tint of the same accent. Works on any card.
const ACCENT_BADGE: Record<Accent, string> = {
  purple: "bg-[#AF52DE]/15 text-[#AF52DE]",
  orange: "bg-[#FF9500]/15 text-[#FF9500]",
  green: "bg-[#34C759]/15 text-[#34C759]",
};

// Title colour on row hover.
const ACCENT_HOVER_TEXT: Record<Accent, string> = {
  purple: "group-hover:text-[#AF52DE]",
  orange: "group-hover:text-[#FF9500]",
  green: "group-hover:text-[#34C759]",
};

function iconFor(kind: CrmNotification["kind"]) {
  if (kind === "site_visit") return <FaCalendarAlt className="text-[14px]" />;
  if (kind === "follow_up") return <FaBell className="text-[14px]" />;
  return <FaBriefcase className="text-[14px]" />;
}

/**
 * The zero state. A blank popover reads as broken; saying so answers the
 * question the click was asking.
 */
export function AllCaughtUp({ theme }: { theme: NotificationPopoverTheme }) {
  return (
    <div className="px-6 py-10 flex flex-col items-center justify-center text-center">
      <FaCheckCircle className="text-[42px] mb-3 text-[#34C759] opacity-80" />
      <p className={`text-[14px] font-semibold tracking-tight ${theme.text}`}>
        You&apos;re all caught up
      </p>
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
  // The cap. `overflow-hidden` rather than `overflow-y-auto`: with at most three
  // rows there is nothing to scroll, and a scroll container would let a fourth
  // row hide behind a scrollbar if this ever regressed.
  const shown = items.slice(0, NOTIFICATION_POPOVER_LIMIT);
  const hasMore = count > NOTIFICATION_POPOVER_LIMIT;

  return (
    <>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 ${theme.border}`}>
        <div className="min-w-0 flex flex-col gap-0.5">
          <h3 className={`font-semibold text-[14px] tracking-tight truncate ${theme.text}`}>
            {title}
          </h3>
          {caption && (
            <p className={`text-[11px] tracking-tight truncate ${theme.textMuted}`}>{caption}</p>
          )}
        </div>
        {count > 0 && (
          <span
            className={`text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full flex-shrink-0 ${ACCENT_BADGE[accent]}`}
          >
            {count}
          </span>
        )}
      </div>

      <div className="overflow-hidden">
        {shown.length === 0 ? (
          <AllCaughtUp theme={theme} />
        ) : (
          shown.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenLead(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenLead(n);
                }
              }}
              className={`px-4 py-3.5 border-b last:border-b-0 transition-colors cursor-pointer group relative ${theme.border} ${theme.itemHover}`}
            >
              {onDismiss && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(n);
                  }}
                  aria-label="Dismiss notification"
                  className={`absolute top-1/2 -translate-y-1/2 right-3 p-2 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-all ${theme.textMuted} hover:bg-black/5`}
                >
                  <FaTimes className="text-[12px]" />
                </button>
              )}
              <div className="flex items-start gap-3.5 pr-8">
                <div
                  className={`w-[36px] h-[36px] rounded-[8px] flex items-center justify-center flex-shrink-0 text-white shadow-sm ${ACCENT_BG[accent]}`}
                >
                  {iconFor(n.kind)}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p
                    className={`text-[14px] font-semibold tracking-tight truncate transition-colors ${theme.text} ${ACCENT_HOVER_TEXT[accent]}`}
                  >
                    {n.title}
                  </p>
                  <p className={`text-[12px] mt-0.5 tracking-tight truncate ${theme.textMuted}`}>
                    {n.subtitle}
                  </p>
                  {renderDetail?.(n)}
                </div>
                {renderMetric && (
                  <div className="flex-shrink-0 text-right pt-0.5">{renderMetric(n)}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {hasMore && (
        <button
          type="button"
          onClick={onSeeAll}
          className={`w-full px-4 py-3.5 text-[13px] font-medium tracking-tight border-t cursor-pointer transition-colors ${theme.border} ${theme.footer}`}
        >
          See all {count} {footerNoun}
        </button>
      )}
    </>
  );
}