"use client";

// components/CrmUpdatesNotification.tsx — the System Updates bell every CRM user
// sees in the header.
//
// ── What this is and is not ────────────────────────────────────────────────
// This is the EXISTING System Updates panel, not a new one. Its visual design is
// unchanged: same bullhorn glyph, same magenta unread badge, same dropdown card,
// same version pill, Important flag, unread dot and ticked highlight list. The
// brief asks that the existing design be preserved and that the panel become
// database-driven — it was already database-driven, so the work here was the
// rest of the sentence:
//
//   * the feed is now PUBLISHED-only. Drafts are filtered in SQL, so an
//     announcement Super Admin is still writing never reaches this component.
//   * announcements are dated by `published_at` rather than `created_at`, and
//     ordered newest-published-first.
//   * the update TYPE is shown, which the row has always carried in `category`
//     and this panel never rendered.
//   * "Mark all as read" exists, affecting only the signed-in user.
//   * the body renders through the project's safe formatted-text renderer, so
//     bold / italic / bullets / links work and raw HTML cannot.
//   * the list refreshes on a poll, so an announcement published while someone
//     is working appears without a reload.
//
// ── Read state ─────────────────────────────────────────────────────────────
// Per user, always. Marking read POSTs an action and the server takes the user
// id from the session — this component no longer sends one, because the id it
// had came from localStorage and was therefore a request parameter anyone could
// edit. One person reading an announcement does not mark it read for anybody
// else; that is a property of the schema (`crm_update_reads` is keyed by
// user_id), not of this file.

import { useCallback, useEffect, useState } from "react";
import { FaBullhorn, FaTimes, FaCheck, FaExclamationCircle } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";
import UpdateBody from "@/components/superadmin/UpdateBody";

interface CrmUpdate {
  id: number;
  version: string;
  title: string;
  description: string;
  category: string;
  features: string[];
  is_important: boolean;
  published_at: string;
  created_at: string;
  has_read: boolean;
}

/**
 * How often the feed is refetched.
 *
 * There is realtime infrastructure in this app (lib/eventBus.ts + the SSE
 * stream), but it is deliberately tenant-scoped with no cross-tenant broadcast
 * mode — its header says so explicitly, because a platform-wide announcement
 * should be an explicit separate mechanism rather than an omitted argument that
 * quietly crosses tenants. A System Update is exactly that platform-wide case.
 * So this uses the app's other established pattern instead: a poll, like
 * AttendanceView (30s) and the dashboard stats (30s). Two minutes is right for
 * something published a few times a month.
 */
const POLL_MS = 120_000;

export default function CrmUpdatesNotification({
  user, theme, isDark, isOpen, onToggle,
}: {
  user: any;
  theme: any;
  isDark: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
}) {
  const [updates, setUpdates] = useState<CrmUpdate[]>([]);
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  const isActuallyOpen = isOpen !== undefined ? isOpen : internalIsOpen;

  const handleToggle = () => {
    if (onToggle) onToggle();
    else setInternalIsOpen(!internalIsOpen);
  };

  const userId = user?.id || user?._id;

  const fetchUpdates = useCallback(async () => {
    try {
      // No ?userId= — the server reads the identity from the session cookie.
      // Passing one was how read status for any account used to be fetchable by
      // editing a query parameter.
      const res = await fetch("/api/updates");
      if (!res.ok) return;
      const json = await res.json();
      setUpdates(json.data || []);
    } catch {
      // A failed poll leaves the previous list on screen rather than blanking a
      // panel someone may be reading.
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetchUpdates();
    const id = window.setInterval(fetchUpdates, POLL_MS);
    return () => window.clearInterval(id);
  }, [userId, fetchUpdates]);

  // Opening the panel refetches, so the badge cannot be stale at the exact
  // moment someone acts on it.
  useEffect(() => {
    if (isActuallyOpen) fetchUpdates();
  }, [isActuallyOpen, fetchUpdates]);

  const markAsRead = async (updateId: number) => {
    // Optimistic: the badge should drop the instant it is clicked. A failure is
    // corrected by the next poll rather than by an alert.
    setUpdates(prev => prev.map(u => (u.id === updateId ? { ...u, has_read: true } : u)));
    try {
      await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read", updateId }),
      });
    } catch {
      fetchUpdates();
    }
  };

  const markAllAsRead = async () => {
    setMarking(true);
    setUpdates(prev => prev.map(u => ({ ...u, has_read: true })));
    try {
      await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
    } catch {
      fetchUpdates();
    } finally {
      setMarking(false);
    }
  };

  const unreadCount = updates.filter(u => !u.has_read).length;

  /**
   * The palette the formatted body renders against.
   *
   * `theme` here is the host dashboard's theme object, which is Tailwind CLASS
   * names, not colours — so the six colours the renderer needs are derived from
   * `isDark` instead. They match the CRM's own text/muted/accent values.
   */
  const bodyPalette = {
    text: isDark ? "#E5E7EB" : "#111827",
    textMuted: isDark ? "#9CA3AF" : "#6B7280",
    accent: "#9E217B",
    border: isDark ? "#333333" : "#E5E7EB",
    raised: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
    surface: isDark ? "#1C1C1E" : "#FFFFFF",
  };

  return (
    <div className="relative">
      <div className="relative cursor-pointer" onClick={handleToggle}>
        <FaBullhorn className={`${theme.textMuted} hover:text-[#9E217B] transition-colors w-5 h-5`} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#9E217B] rounded-full text-[9px] font-black text-white flex items-center justify-center shadow-md">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </div>

      <AnimatePresence>
        {isActuallyOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-12 right-0 w-[360px] max-w-[calc(100vw-2rem)] border rounded-xl shadow-2xl flex flex-col z-50 ${theme.dropdown}`}
            style={theme.dropdownGlass}
          >
            <div className={`p-4 border-b flex justify-between items-center ${theme.tableBorder}`}>
              <h3 className={`font-bold text-sm flex items-center gap-2 ${theme.text}`}>
                <FaBullhorn className="text-[#9E217B]" />
                System Updates
              </h3>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    disabled={marking}
                    className="text-[10px] font-bold text-[#9E217B] hover:text-[#d946a8] transition-colors disabled:opacity-50"
                  >
                    Mark all as read
                  </button>
                )}
                <button
                  onClick={() => (onToggle ? onToggle() : setInternalIsOpen(false))}
                  className={`${theme.textMuted} hover:text-red-500 transition-colors`}
                  aria-label="Close"
                >
                  <FaTimes className="text-xs" />
                </button>
              </div>
            </div>

            <div className={`max-h-[400px] overflow-y-auto ${theme.scroll}`}>
              {updates.length === 0 ? (
                <p className={`p-6 text-center text-xs ${theme.textMuted}`}>No new updates.</p>
              ) : (
                updates.map(update => (
                  <div
                    key={update.id}
                    className={`p-4 border-b last:border-b-0 transition-colors ${
                      !update.has_read
                        ? isDark
                          ? "bg-[#9E217B]/10 border-[#9E217B]/20"
                          : "bg-[#9E217B]/5 border-[#9E217B]/10"
                        : isDark
                        ? "hover:bg-white/5 border-[#333]"
                        : "hover:bg-black/5 border-[#E5E7EB]"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isDark ? "bg-indigo-900/40 text-indigo-300" : "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          v{String(update.version).replace(/^v/i, "")}
                        </span>
                        {/* The type. Carried in the row all along, shown now. */}
                        {update.category && (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              isDark ? "bg-white/10 text-gray-300" : "bg-black/5 text-gray-600"
                            }`}
                          >
                            {update.category}
                          </span>
                        )}
                        {update.is_important && (
                          <span
                            className={`flex items-center gap-1 text-[10px] font-bold ${
                              isDark ? "text-red-400" : "text-red-600"
                            }`}
                          >
                            <FaExclamationCircle /> Important
                          </span>
                        )}
                        {!update.has_read && <span className="w-2 h-2 bg-[#9E217B] rounded-full animate-pulse" />}
                      </div>
                      <span className={`text-[10px] whitespace-nowrap ${theme.textMuted}`}>
                        {new Date(update.published_at || update.created_at).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                    </div>

                    <h4 className={`text-sm font-bold ${theme.text}`}>{update.title}</h4>

                    {update.description && (
                      <div className="text-xs mt-1 leading-relaxed">
                        {/* Formatted, and structurally unable to inject HTML — see
                            components/superadmin/UpdateBody.tsx. */}
                        <UpdateBody t={bodyPalette} content={update.description} />
                      </div>
                    )}

                    {update.features?.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {update.features.map((feat, i) => (
                          <li key={i} className={`flex items-start gap-1.5 text-[11px] ${theme.textMuted}`}>
                            <FaCheck className="text-[#9E217B] mt-0.5 flex-shrink-0 text-[8px]" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {!update.has_read && (
                      <button
                        onClick={() => markAsRead(update.id)}
                        className="mt-3 text-[10px] font-bold text-[#9E217B] hover:text-[#d946a8] transition-colors"
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
