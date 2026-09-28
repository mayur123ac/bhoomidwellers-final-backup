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
//
// ── Theming (why this file changed) ────────────────────────────────────────
// Two earlier mismatches had one root cause: this page never actually knew the
// app's theme.
//   1. Tailwind's `dark:` variant follows the OS setting, not the app's toggle,
//      so a dark OS + light app produced dark cards on a light page.
//   2. Replacing `dark:` with an `isDark` prop fixed nothing while the parent
//      did not pass it: the prop was undefined, so the page stayed light even
//      after the app switched to dark.
//
// Now the page decides for itself, from what is actually painted behind it:
//   • If the parent passes `isDark`, that wins (explicit is best).
//   • Otherwise `useAppIsDark` walks up from this component to the first opaque
//     background, measures its luminance, and re-checks whenever a class /
//     style / data-theme attribute changes on any ancestor. So it follows the
//     app's toggle regardless of how the toggle is implemented (class on <html>,
//     data-theme, inline style, CSS variables).
// Every colour then comes from one token table, so the whole page flips
// together and can never be half light, half dark.

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  /** Kept for compatibility with existing callers; colours now come from the theme tokens. */
  theme?: NotificationCenterTheme;
  isLoading?: boolean;
  onOpenLead: (notification: CrmNotification) => void;
  onDismiss?: (notification: CrmNotification) => void;
  /** Preselects a tab when arriving from a specific popover's footer. */
  initialFilter?: NotificationKind | "all";
  /**
   * The app's current theme. Optional: when omitted, the page detects it from
   * the background it is rendered on. Pass it if you have it; it always wins.
   */
  isDark?: boolean;
}

// ─── Theme detection ─────────────────────────────────────────────────────────

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

let probeCanvas: HTMLCanvasElement | null = null;

/** Normalises any CSS colour (hex, rgb, oklch, …) to [r, g, b, a] via a 1px canvas. */
function toRGBA(css: string): [number, number, number, number] | null {
  if (typeof document === "undefined") return null;
  if (!probeCanvas) {
    probeCanvas = document.createElement("canvas");
    probeCanvas.width = 1;
    probeCanvas.height = 1;
  }
  const ctx = probeCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}

/** Is the page behind `el` dark? Measures the first opaque ancestor background. */
function detectDark(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent") {
      const c = toRGBA(bg);
      if (c && c[3] > 0.5) {
        const luminance = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
        return luminance < 0.5;
      }
    }
    node = node.parentElement;
  }

  // No opaque background found (e.g. an image/gradient page): fall back to the
  // usual explicit signals on <html> / <body>.
  for (const root of [document.documentElement, document.body]) {
    const attr = (root.dataset.theme || root.dataset.mode || "").toLowerCase();
    if (root.classList.contains("dark") || attr === "dark") return true;
    if (root.classList.contains("light") || attr === "light") return false;
  }
  return false;
}

/** Follows the app's real theme. `explicit` (the isDark prop) wins when given. */
function useAppIsDark(rootRef: React.RefObject<HTMLElement | null>, explicit?: boolean): boolean {
  const [detected, setDetected] = useState(false);

  useIsoLayoutEffect(() => {
    if (explicit !== undefined) return;
    const el = rootRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => setDetected(detectDark(el));
    // Check now, and again after the app's colour transition (~300ms) settles.
    const schedule = () => {
      run();
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 400);
    };

    schedule();

    const observer = new MutationObserver(schedule);
    for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
      observer.observe(n, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-mode"],
      });
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", schedule);
    window.addEventListener("storage", schedule);

    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
      media.removeEventListener("change", schedule);
      window.removeEventListener("storage", schedule);
    };
  }, [explicit, rootRef]);

  return explicit ?? detected;
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

const KIND_META: Record<
  NotificationKind,
  { label: string; icon: React.ReactNode; light: string; dark: string }
> = {
  new_lead: {
    label: "New Leads",
    icon: <FaBriefcase className="text-[14px]" />,
    light: "bg-[#EBF9EE] text-[#34C759]",
    dark: "bg-[rgba(50,215,75,0.15)] text-[#32D74B]",
  },
  site_visit: {
    label: "Site Visits",
    icon: <FaCalendarAlt className="text-[14px]" />,
    light: "bg-[#FFF4E5] text-[#FF9500]",
    dark: "bg-[rgba(255,159,10,0.15)] text-[#FF9F0A]",
  },
  follow_up: {
    label: "Follow-ups",
    icon: <FaBell className="text-[14px]" />,
    light: "bg-[#F7EBFC] text-[#AF52DE]",
    dark: "bg-[rgba(191,90,242,0.15)] text-[#BF5AF2]",
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

/** One place that decides every colour on the page. */
function tokens(isDark: boolean) {
  return isDark
    ? {
      text: "text-white",
      muted: "text-[#8E8E93]",
      card: "bg-[#1C1C1E] border-white/10",
      divider: "border-[#38383A]",
      rowHover: "hover:bg-white/[0.04]",
      dismissHover: "hover:bg-white/10",
      segTrack: "bg-[#2C2C2E]",
      segActive: "bg-[#3A3A3C] text-white",
      segIdle: "text-[#8E8E93] hover:text-white",
      check: "text-[#32D74B]",
      badgeRed: "bg-[rgba(255,69,58,0.15)] text-[#FF453A]",
      badgeOrange: "bg-[rgba(255,159,10,0.15)] text-[#FF9F0A]",
      badgeNeutral: "bg-[#2C2C2E] text-[#8E8E93]",
    }
    : {
      text: "text-black",
      muted: "text-[#8E8E93]",
      card: "bg-white border-black/5",
      divider: "border-[#E5E5EA]",
      rowHover: "hover:bg-black/[0.02]",
      dismissHover: "hover:bg-black/5",
      segTrack: "bg-[#E5E5EA]",
      segActive: "bg-white text-black",
      segIdle: "text-[#8E8E93] hover:text-black",
      check: "text-[#34C759]",
      badgeRed: "bg-[#FFECEB] text-[#FF3B30]",
      badgeOrange: "bg-[#FFF4E5] text-[#FF9500]",
      badgeNeutral: "bg-[#F2F2F7] text-[#8E8E93]",
    };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NotificationCenterView({
  newLeads,
  siteVisits,
  followUps,
  isLoading,
  onOpenLead,
  onDismiss,
  initialFilter = "all",
  isDark: isDarkProp,
}: NotificationCenterViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isDark = useAppIsDark(rootRef, isDarkProp);
  const t = tokens(isDark);

  const [filter, setFilter] = useState<NotificationKind | "all">(initialFilter);

  const groups = useMemo(
    () => ({
      new_lead: newLeads,
      site_visit: siteVisits,
      follow_up: followUps,
    }),
    [newLeads, siteVisits, followUps],
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
    // Root stays background-less on purpose: useAppIsDark measures the page
    // BEHIND this element, so it must not paint its own background.
    <div ref={rootRef} className="flex flex-col gap-6 font-sans antialiased max-w-[1200px] mx-auto">
      {/* Header & segmented control */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="flex flex-col gap-0.5">
          <h2 className={`text-xl sm:text-[22px] font-bold tracking-tight flex items-center gap-2 ${t.text}`}>
            Notification Center
          </h2>
          <p className={`text-[13px] font-medium tracking-tight ${t.muted}`}>
            The complete queue. Header popovers show the top three of each.
          </p>
        </div>

        <div className={`flex p-0.5 rounded-[10px] overflow-x-auto custom-scrollbar shrink-0 ${t.segTrack}`}>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              className={`flex-1 min-w-[80px] py-1.5 px-3 text-[12px] font-medium tracking-tight rounded-[8px] transition-all whitespace-nowrap ${filter === c.id
                ? `${t.segActive} shadow-[0_1px_2px_rgba(0,0,0,0.12)]`
                : `${t.segIdle} shadow-none`
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
          className={`rounded-[24px] py-24 flex flex-col items-center justify-center text-center shadow-[0_2px_12px_rgba(0,0,0,0.03)] border ${t.card}`}
        >
          <FaCheckCircle className={`text-[44px] mb-4 opacity-80 ${t.check}`} />
          <p className={`text-[15px] font-semibold tracking-tight ${t.text}`}>You&apos;re all caught up</p>
          <p className={`text-[13px] mt-1 ${t.muted}`}>
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
                className={`rounded-[24px] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border ${t.card}`}
              >
                {/* Section header */}
                <div className={`px-5 py-4 border-b flex items-center gap-3 ${t.divider}`}>
                  <div
                    className={`w-8 h-8 rounded-[8px] flex items-center justify-center ${isDark ? meta.dark : meta.light}`}
                  >
                    {meta.icon}
                  </div>
                  <h3 className={`text-[15px] font-semibold tracking-tight ${t.text}`}>{meta.label}</h3>
                  <span className={`text-[12px] font-semibold ml-auto ${t.muted}`}>{items.length}</span>
                </div>

                {/* List */}
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
                      className={`px-5 py-4 border-b last:border-b-0 cursor-pointer group relative transition-colors ${t.divider} ${t.rowHover}`}
                    >
                      {onDismiss && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismiss(n);
                          }}
                          aria-label="Dismiss notification"
                          className={`absolute top-1/2 -translate-y-1/2 right-4 p-2 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-all ${t.muted} ${t.dismissHover}`}
                        >
                          <FaTimes className="text-[12px]" />
                        </button>
                      )}

                      <div className="flex items-start justify-between gap-4 pr-8">
                        <div className="min-w-0">
                          <p className={`text-[14px] font-semibold tracking-tight truncate ${t.text}`}>{n.title}</p>
                          <p className={`text-[13px] mt-0.5 tracking-tight line-clamp-2 ${t.muted}`}>{n.subtitle}</p>
                        </div>

                        <div className="flex-shrink-0 text-right flex flex-col items-end gap-1">
                          {n.kind === "follow_up" && (
                            <div
                              className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-[6px] ${(n.daysSince ?? 0) >= 7
                                ? t.badgeRed
                                : (n.daysSince ?? 0) >= 4
                                  ? t.badgeOrange
                                  : t.badgeNeutral
                                }`}
                            >
                              {n.daysSince}d
                            </div>
                          )}
                          {n.kind === "site_visit" && (
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-[6px] ${n.visitDiff === 0
                                ? t.badgeRed
                                : (n.visitDiff ?? 0) < 0
                                  ? t.badgeNeutral
                                  : t.badgeOrange
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
                          <p className={`text-[11px] font-medium mt-1 ${t.muted}`}>{relative(n.at)}</p>
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