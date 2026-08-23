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
//
// Theming is passed in rather than imported. /dashboard and /dashboard/sales each
// build their own theme object with the same shape of Tailwind class strings, and
// this component is used by both.

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

const ACCENT_BG: Record<NotificationPopoverProps["accent"], string> = {
  purple: "bg-[#9E217B]",
  orange: "bg-orange-500",
  green: "bg-[#25D366]",
};

const ACCENT_TEXT: Record<NotificationPopoverProps["accent"], string> = {
  purple: "group-hover:text-purple-400",
  orange: "group-hover:text-orange-400",
  green: "group-hover:text-green-400",
};

function iconFor(kind: CrmNotification["kind"]) {
  if (kind === "site_visit") return <FaCalendarAlt className="text-[12px]" />;
  if (kind === "follow_up") return <FaBell className="text-[12px]" />;
  return <FaBriefcase className="text-[12px]" />;
}

/**
 * The zero state. An empty popover that is simply blank reads as broken — you
 * cannot tell "nothing to show" from "failed to load". Saying so, centred, in
 * the same compact box, answers the question the click was asking.
 */
export function AllCaughtUp({ theme }: { theme: NotificationPopoverTheme }) {
  return (
    <div className="px-6 py-8 flex flex-col items-center justify-center text-center">
      <FaCheckCircle className={`text-2xl mb-2 opacity-30 ${theme.textFaint}`} />
      <p className={`text-sm font-semibold ${theme.text}`}>You&apos;re all caught up</p>
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
      <div className={`p-3 border-b flex items-center justify-between gap-2 ${theme.border}`}>
        <div className="min-w-0">
          <h3 className={`font-bold text-sm truncate ${theme.text}`}>{title}</h3>
          {caption && <p className={`text-[10px] mt-0.5 truncate ${theme.textFaint}`}>{caption}</p>}
        </div>
        {count > 0 && (
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${
              accent === "orange"
                ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
                : accent === "green"
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}
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
              className={`p-3 border-b last:border-b-0 transition-colors cursor-pointer group relative ${theme.border} ${theme.itemHover}`}
            >
              {onDismiss && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(n);
                  }}
                  aria-label="Dismiss notification"
                  className={`absolute top-2.5 right-2.5 p-1 rounded-md cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity ${theme.textFaint} hover:text-red-500`}
                >
                  <FaTimes className="text-[10px]" />
                </button>
              )}
              <div className="flex items-start gap-3 pr-5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white ${ACCENT_BG[accent]}`}
                >
                  {iconFor(n.kind)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-bold truncate ${theme.text} ${ACCENT_TEXT[accent]}`}>
                    {n.title}
                  </p>
                  <p className={`text-[10px] mt-0.5 truncate ${theme.textMuted}`}>{n.subtitle}</p>
                  {renderDetail?.(n)}
                </div>
                {renderMetric && <div className="flex-shrink-0 text-right">{renderMetric(n)}</div>}
              </div>
            </div>
          ))
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={onSeeAll}
          className={`w-full px-3 py-2.5 text-[11px] font-bold border-t cursor-pointer transition-colors ${theme.border} ${theme.footer}`}
        >
          See all {count} {footerNoun}
        </button>
      )}
    </>
  );
}
