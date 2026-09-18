"use client";

// NotificationCenterView — the full notification queue, as a page.
//
// The popovers are capped at three (see NotificationPopover). This is where the
// rest lives, and it is the destination of every "See all N …" footer. It holds
// the COMPLETE queue — every New Lead, Site Visit and Follow-up the server
// returned for this session's organization — grouped, filterable and scrollable,
// because a page is allowed to scroll and a floating popover is not.
//
// It renders the same CrmNotification objects the popovers do, from the same
// tenant-scoped endpoint. There is no second query and no client-side
// organization filter: if it is in this list, the server already decided it
// belongs to this organization.

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaBell,
  FaBriefcase,
  FaCalendarAlt,
  FaCheckCircle,
  FaTimes,
} from "react-icons/fa";
import type { CrmNotification, NotificationKind } from "@/lib/hooks/useNotificationFeed";

export interface NotificationCenterTheme {
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  card: string;
  cardGlass?: React.CSSProperties;
  itemHover: string;
  chipActive: string;
  chipIdle: string;
}

export interface NotificationCenterViewProps {
  newLeads: CrmNotification[];
  siteVisits: CrmNotification[];
  followUps: CrmNotification[];
  theme: NotificationCenterTheme;
  isLoading?: boolean;
  onOpenLead: (notification: CrmNotification) => void;
  onDismiss?: (notification: CrmNotification) => void;
  /** Preselects a tab when arriving from a specific popover's footer. */
  initialFilter?: NotificationKind | "all";
  isDark?: boolean; // Added for Apple UI color matching if available
}

// Apple UI/UX Theme Constants
const KIND_META: Record<
  NotificationKind,
  { label: string; icon: React.ReactNode; bgLight: string; bgDark: string; textLight: string; textDark: string }
> = {
  new_lead: {
    label: "New Leads",
    icon: <FaBriefcase className="text-[14px]" />,
    bgLight: "bg-[#EBF9EE]", bgDark: "bg-[rgba(50,215,75,0.15)]",
    textLight: "text-[#34C759]", textDark: "text-[#32D74B]"
  },
  site_visit: {
    label: "Site Visits",
    icon: <FaCalendarAlt className="text-[14px]" />,
    bgLight: "bg-[#FFF4E5]", bgDark: "bg-[rgba(255,159,10,0.15)]",
    textLight: "text-[#FF9500]", textDark: "text-[#FF9F0A]"
  },
  follow_up: {
    label: "Follow-ups",
    icon: <FaBell className="text-[14px]" />,
    bgLight: "bg-[#F7EBFC]", bgDark: "bg-[rgba(191,90,242,0.15)]",
    textLight: "text-[#AF52DE]", textDark: "text-[#BF5AF2]"
  },
};

function relative(at: string | null): string {
  if (!at) return "";
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (mins > 0 && mins < 60) return `${mins}m ago`;
  if (mins >= 60 && mins < 1440) return `${Math.round(mins / 60)}h ago`;
  if (mins >= 1440) return `${Math.round(mins / 1440)}d ago`;
  const ahead = Math.abs(mins);
  if (ahead < 1440) return `in ${Math.round(ahead / 60)}h`;
  return `in ${Math.round(ahead / 1440)}d`;
}

export default function NotificationCenterView({
  newLeads,
  siteVisits,
  followUps,
  theme,
  isLoading,
  onOpenLead,
  onDismiss,
  initialFilter = "all",
  isDark = false, // Defaults to false if parent doesn't pass it, relies on tailwind dark: modifiers
}: NotificationCenterViewProps) {
  const [filter, setFilter] = useState<NotificationKind | "all">(initialFilter);

  const groups = useMemo(
    () => ({
      new_lead: newLeads,
      site_visit: siteVisits,
      follow_up: followUps,
    }),
    [newLeads, siteVisits, followUps]
  );

  const total = newLeads.length + siteVisits.length + followUps.length;

  const visibleKinds: NotificationKind[] =
    filter === "all" ? ["follow_up", "site_visit", "new_lead"] : [filter];

  const chips: { id: NotificationKind | "all"; label: string; count: number }[] = [
    { id: "all", label: "All", count: total },
    { id: "follow_up", label: "Follow-ups", count: followUps.length },
    { id: "site_visit", label: "Site Visits", count: siteVisits.length },
    { id: "new_lead", label: "New Leads", count: newLeads.length },
  ];

  return (
    <div className="flex flex-col gap-6 font-sans antialiased max-w-[1200px] mx-auto">

      {/* ── Apple-Style Compact Header & Segmented Control ── */}
      <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2`}>
        <div className="flex flex-col gap-0.5">
          <h2 className={`text-xl sm:text-[22px] font-bold tracking-tight flex items-center gap-2 dark:text-white text-black`}>
            Notification Center
          </h2>
          <p className={`text-[13px] font-medium tracking-tight dark:text-[#8E8E93] text-[#8E8E93]`}>
            The complete queue. Header popovers show the top three of each.
          </p>
        </div>

        {/* iOS-Style Segmented Control */}
        <div className="flex p-0.5 rounded-[10px] dark:bg-[#2C2C2E] bg-[#E5E5EA] overflow-x-auto custom-scrollbar shrink-0">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              className={`flex-1 min-w-[80px] py-1.5 px-3 text-[12px] font-medium tracking-tight rounded-[8px] transition-all whitespace-nowrap ${filter === c.id
                ? "bg-white text-black dark:bg-[#3A3A3C] dark:text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                : "text-[#8E8E93] shadow-none hover:text-black dark:hover:text-white"
                }`}
            >
              {c.label} <span className="opacity-60 ml-1">({c.count})</span>
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-[24px] py-24 flex flex-col items-center justify-center text-center shadow-[0_2px_12px_rgba(0,0,0,0.03)] border dark:border-white/5 border-black/5 dark:bg-[#1C1C1E] bg-white`}
        >
          <FaCheckCircle className={`text-[44px] mb-4 dark:text-[#32D74B] text-[#34C759] opacity-80`} />
          <p className={`text-[15px] font-semibold tracking-tight dark:text-white text-black`}>You&apos;re all caught up</p>
          <p className={`text-[13px] mt-1 dark:text-[#8E8E93] text-[#8E8E93]`}>
            {isLoading ? "Checking for new notifications…" : "No pending notifications right now."}
          </p>
        </motion.div>
      ) : (
        <AnimatePresence mode="popLayout">
          {visibleKinds.map((kind) => {
            const items = groups[kind];
            if (items.length === 0) return null;
            const meta = KIND_META[kind];

            return (
              <motion.div
                key={kind}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                className={`rounded-[24px] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border dark:border-white/5 border-black/5 dark:bg-[#1C1C1E] bg-white`}
              >
                {/* Section Header */}
                <div className={`px-5 py-4 border-b dark:border-[#38383A] border-[#E5E5EA] flex items-center gap-3`}>
                  <div className={`w-8 h-8 rounded-[8px] flex items-center justify-center ${isDark ? meta.bgDark : meta.bgLight} ${isDark ? meta.textDark : meta.textLight}`}>
                    {meta.icon}
                  </div>
                  <h3 className={`text-[15px] font-semibold tracking-tight dark:text-white text-black`}>{meta.label}</h3>
                  <span className={`text-[12px] font-semibold ml-auto dark:text-[#8E8E93] text-[#8E8E93]`}>{items.length}</span>
                </div>

                {/* List Items */}
                <div className="max-h-[52vh] overflow-y-auto custom-scrollbar">
                  {items.map((n) => (
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
                      className={`px-5 py-4 border-b dark:border-[#38383A] border-[#E5E5EA] last:border-b-0 cursor-pointer group relative transition-colors dark:hover:bg-white/[0.03] hover:bg-black/[0.02]`}
                    >
                      {onDismiss && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismiss(n);
                          }}
                          aria-label="Dismiss notification"
                          className={`absolute top-1/2 -translate-y-1/2 right-4 p-2 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-all dark:text-[#8E8E93] text-[#8E8E93] dark:hover:bg-white/10 hover:bg-black/5`}
                        >
                          <FaTimes className="text-[12px]" />
                        </button>
                      )}

                      <div className="flex items-start justify-between gap-4 pr-8">
                        <div className="min-w-0">
                          <p className={`text-[14px] font-semibold tracking-tight truncate dark:text-white text-black`}>{n.title}</p>
                          <p className={`text-[13px] mt-0.5 tracking-tight line-clamp-2 dark:text-[#8E8E93] text-[#8E8E93]`}>{n.subtitle}</p>
                        </div>

                        <div className="flex-shrink-0 text-right flex flex-col items-end gap-1">
                          {n.kind === "follow_up" && (
                            <div
                              className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-[6px] ${(n.daysSince ?? 0) >= 7
                                ? "dark:bg-[rgba(255,69,58,0.15)] bg-[#FFECEB] dark:text-[#FF453A] text-[#FF3B30]"
                                : (n.daysSince ?? 0) >= 4
                                  ? "dark:bg-[rgba(255,159,10,0.15)] bg-[#FFF4E5] dark:text-[#FF9F0A] text-[#FF9500]"
                                  : "dark:bg-[#2C2C2E] bg-[#F2F2F7] dark:text-[#8E8E93] text-[#8E8E93]"
                                }`}
                            >
                              {n.daysSince}d
                            </div>
                          )}
                          {n.kind === "site_visit" && (
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-[6px] ${n.visitDiff === 0
                                ? "dark:bg-[rgba(255,69,58,0.15)] bg-[#FFECEB] dark:text-[#FF453A] text-[#FF3B30]"
                                : (n.visitDiff ?? 0) < 0
                                  ? "dark:bg-[#2C2C2E] bg-[#F2F2F7] dark:text-[#8E8E93] text-[#8E8E93]"
                                  : "dark:bg-[rgba(255,159,10,0.15)] bg-[#FFF4E5] dark:text-[#FF9F0A] text-[#FF9500]"
                                }`}
                            >
                              {n.visitDiff === 0
                                ? "TODAY"
                                : n.visitDiff === 1
                                  ? "TOMORROW"
                                  : (n.visitDiff ?? 0) < 0
                                    ? "PAST"
                                    : `IN ${n.visitDiff}D`}
                            </span>
                          )}
                          <p className={`text-[11px] font-medium mt-1 dark:text-[#8E8E93] text-[#8E8E93]`}>{relative(n.at)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}