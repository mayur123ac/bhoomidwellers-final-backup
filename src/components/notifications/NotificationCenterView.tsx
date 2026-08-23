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
}

const KIND_META: Record<
  NotificationKind,
  { label: string; icon: React.ReactNode; dot: string }
> = {
  new_lead: { label: "New Leads", icon: <FaBriefcase className="text-[12px]" />, dot: "bg-[#25D366]" },
  site_visit: { label: "Site Visits", icon: <FaCalendarAlt className="text-[12px]" />, dot: "bg-orange-500" },
  follow_up: { label: "Follow-ups", icon: <FaBell className="text-[12px]" />, dot: "bg-[#9E217B]" },
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
    <div className="flex flex-col gap-3">
      <div className={`rounded-xl border p-4 ${theme.card}`} style={theme.cardGlass}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className={`text-base font-bold flex items-center gap-2 ${theme.text}`}>
              <FaBell className="text-[#9E217B]" /> Notification Center
            </h2>
            <p className={`text-[11px] mt-0.5 ${theme.textFaint}`}>
              The complete queue. Header popovers show the top three of each.
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilter(c.id)}
                className={`text-[11px] font-bold px-3 py-1.5 rounded-full border cursor-pointer transition-colors ${
                  filter === c.id ? theme.chipActive : theme.chipIdle
                }`}
              >
                {c.label} · {c.count}
              </button>
            ))}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div
          className={`rounded-xl border py-16 flex flex-col items-center justify-center text-center ${theme.card}`}
          style={theme.cardGlass}
        >
          <FaCheckCircle className={`text-3xl mb-3 opacity-30 ${theme.textFaint}`} />
          <p className={`text-sm font-semibold ${theme.text}`}>You&apos;re all caught up</p>
          <p className={`text-[11px] mt-1 ${theme.textFaint}`}>
            {isLoading ? "Checking for new notifications…" : "No pending notifications right now."}
          </p>
        </div>
      ) : (
        visibleKinds.map((kind) => {
          const items = groups[kind];
          if (items.length === 0) return null;
          const meta = KIND_META[kind];
          return (
            <div key={kind} className={`rounded-xl border overflow-hidden ${theme.card}`} style={theme.cardGlass}>
              <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${theme.border}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${meta.dot}`}>
                  {meta.icon}
                </span>
                <h3 className={`text-xs font-bold uppercase tracking-wide ${theme.text}`}>{meta.label}</h3>
                <span className={`text-[10px] ${theme.textFaint}`}>{items.length}</span>
              </div>
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
                    className={`px-4 py-3 border-b last:border-b-0 cursor-pointer group relative transition-colors ${theme.border} ${theme.itemHover}`}
                  >
                    {onDismiss && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDismiss(n);
                        }}
                        aria-label="Dismiss notification"
                        className={`absolute top-3 right-3 p-1 rounded-md cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity ${theme.textFaint} hover:text-red-500`}
                      >
                        <FaTimes className="text-[10px]" />
                      </button>
                    )}
                    <div className="flex items-start justify-between gap-3 pr-6">
                      <div className="min-w-0">
                        <p className={`text-xs font-bold truncate ${theme.text}`}>{n.title}</p>
                        <p className={`text-[10px] mt-0.5 truncate ${theme.textMuted}`}>{n.subtitle}</p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {n.kind === "follow_up" && (
                          <div
                            className={`text-xs font-black ${
                              (n.daysSince ?? 0) >= 7
                                ? "text-red-400"
                                : (n.daysSince ?? 0) >= 4
                                ? "text-orange-400"
                                : "text-yellow-400"
                            }`}
                          >
                            {n.daysSince}d
                          </div>
                        )}
                        {n.kind === "site_visit" && (
                          <span
                            className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                              n.visitDiff === 0
                                ? "text-red-400 bg-red-500/10 border-red-500/30"
                                : (n.visitDiff ?? 0) < 0
                                ? "text-gray-400 bg-gray-500/10 border-gray-500/30"
                                : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
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
                        <p className={`text-[9px] mt-1 ${theme.textFaint}`}>{relative(n.at)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
