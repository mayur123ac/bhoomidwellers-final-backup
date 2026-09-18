"use client";

// NotificationPopover — the header bell's dropdown, under the Rule of Three.
//
// ── The Rule of Three ───────────────────────────────────────────────────────
// A popover shows at most three items and never scrolls. Beyond three it stops
// being a glance and becomes a list you have to work through, standing in a
// floating box that closes if you click the wrong pixel. Three fits, tells you
// the shape of the problem, and hands the rest to the Notification Center, which
// is a real page with room for it.
//
// The three are not an arbitrary slice: the server sorts follow-ups by the most
// neglected first and site visits by the soonest first, so the three you see are
// the three that matter. The footer says how many there are in total, so the cap
// never hides the scale of the queue.

import React from "react";
import { FaBell, FaCalendarAlt, FaBriefcase, FaTimes, FaCheckCircle } from "react-icons/fa";
import type { CrmNotification } from "@/lib/hooks/useNotificationFeed";
import { NOTIFICATION_POPOVER_LIMIT } from "@/lib/hooks/useNotificationFeed";

export interface NotificationPopoverTheme {
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  itemHover: string;
  /** Full-width footer button. */
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
  theme: NotificationPopoverTheme; // Kept for compatibility, but Apple UI classes are applied directly
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

// Apple UI/UX Color Mapping
const ACCENT_BG: Record<NotificationPopoverProps["accent"], string> = {
  purple: "bg-[#AF52DE] dark:bg-[#BF5AF2]",
  orange: "bg-[#FF9500] dark:bg-[#FF9F0A]",
  green: "bg-[#34C759] dark:bg-[#32D74B]",
};

const ACCENT_BADGE: Record<NotificationPopoverProps["accent"], string> = {
  purple: "bg-[#F7EBFC] dark:bg-[rgba(191,90,242,0.15)] text-[#AF52DE] dark:text-[#BF5AF2]",
  orange: "bg-[#FFF4E5] dark:bg-[rgba(255,159,10,0.15)] text-[#FF9500] dark:text-[#FF9F0A]",
  green: "bg-[#EBF9EE] dark:bg-[rgba(50,215,75,0.15)] text-[#34C759] dark:text-[#32D74B]",
};

const ACCENT_TEXT: Record<NotificationPopoverProps["accent"], string> = {
  purple: "group-hover:text-[#AF52DE] dark:group-hover:text-[#BF5AF2]",
  orange: "group-hover:text-[#FF9500] dark:group-hover:text-[#FF9F0A]",
  green: "group-hover:text-[#34C759] dark:group-hover:text-[#32D74B]",
};

function iconFor(kind: CrmNotification["kind"]) {
  if (kind === "site_visit") return <FaCalendarAlt className="text-[14px]" />;
  if (kind === "follow_up") return <FaBell className="text-[14px]" />;
  return <FaBriefcase className="text-[14px]" />;
}

/**
 * The zero state. An empty popover that is simply blank reads as broken — you
 * cannot tell "nothing to show" from "failed to load". Saying so, centred, in
 * the same compact box, answers the question the click was asking.
 */
export function AllCaughtUp({ theme }: { theme: NotificationPopoverTheme }) {
  return (
    <div className="px-6 py-10 flex flex-col items-center justify-center text-center">
      <FaCheckCircle className={`text-[42px] mb-3 text-[#34C759] dark:text-[#32D74B] opacity-80`} />
      <p className={`text-[14px] font-semibold tracking-tight text-black dark:text-white`}>You're all caught up</p>
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
  // rows there is nothing to scroll, and leaving the scroll container in place
  // would let a fourth row appear behind a scrollbar if this ever regressed.
  const shown = items.slice(0, NOTIFICATION_POPOVER_LIMIT);
  const hasMore = count > NOTIFICATION_POPOVER_LIMIT;

  return (
    <>
      {/* iOS-Style Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 border-black/5 dark:border-white/10`}>
        <div className="min-w-0 flex flex-col gap-0.5">
          <h3 className={`font-semibold text-[14px] tracking-tight truncate text-black dark:text-white`}>{title}</h3>
          {caption && <p className={`text-[11px] tracking-tight truncate text-[#8E8E93] dark:text-[#8E8E93]`}>{caption}</p>}
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
              className={`px-4 py-3.5 border-b border-black/5 dark:border-white/10 last:border-b-0 transition-colors cursor-pointer group relative hover:bg-black/[0.02] dark:hover:bg-white/[0.03]`}
            >
              {onDismiss && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(n);
                  }}
                  aria-label="Dismiss notification"
                  className={`absolute top-1/2 -translate-y-1/2 right-3 p-2 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-all text-[#8E8E93] hover:bg-black/5 dark:hover:bg-white/10`}
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
                  <p className={`text-[14px] font-semibold tracking-tight truncate text-black dark:text-white transition-colors ${ACCENT_TEXT[accent]}`}>
                    {n.title}
                  </p>
                  <p className={`text-[12px] mt-0.5 tracking-tight truncate text-[#8E8E93] dark:text-[#8E8E93]`}>{n.subtitle}</p>
                  {renderDetail?.(n)}
                </div>
                {renderMetric && <div className="flex-shrink-0 text-right pt-0.5">{renderMetric(n)}</div>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* iOS-Style Footer Button */}
      {hasMore && (
        <button
          type="button"
          onClick={onSeeAll}
          className={`w-full px-4 py-3.5 text-[13px] font-medium tracking-tight border-t cursor-pointer transition-colors border-black/5 dark:border-white/10 text-[#007AFF] dark:text-[#0A84FF] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]`}
        >
          See all {count} {footerNoun}
        </button>
      )}
    </>
  );
}