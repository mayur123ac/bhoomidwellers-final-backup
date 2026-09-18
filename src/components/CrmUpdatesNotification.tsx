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
import { FaBullhorn, FaTimes, FaCheck, FaExclamationCircle, FaCircle } from "react-icons/fa";
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

  useEffect(() => {
    if (isActuallyOpen) fetchUpdates();
  }, [isActuallyOpen, fetchUpdates]);

  const markAsRead = async (updateId: number) => {
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
   * Apple UI colors adopted for rendering the inner safe-HTML.
   */
  const bodyPalette = {
    text: isDark ? "#FFFFFF" : "#000000",
    textMuted: isDark ? "#8E8E93" : "#8E8E93",
    accent: isDark ? "#0A84FF" : "#007AFF",
    border: isDark ? "#38383A" : "#E5E5EA",
    raised: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
    surface: isDark ? "#1C1C1E" : "#FFFFFF",
  };

  return (
    <div className="relative font-sans antialiased">
      {/* ── Apple-Style Notification Bell ── */}
      <button
        className="relative cursor-pointer flex items-center justify-center w-9 h-9 rounded-full transition-colors cursor-pointer outline-none hover:bg-black/5 dark:hover:bg-white/10"
        onClick={handleToggle}
        aria-label="System Updates"
      >
        <FaBullhorn className={`w-[18px] h-[18px] transition-colors ${isDark ? "text-[#EBEBF5]" : "text-[#333333]"}`} />

        {/* Apple Red Notification Badge */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className={`absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center shadow-[0_2px_4px_rgba(255,59,48,0.3)] ${isDark ? "bg-[#FF453A]" : "bg-[#FF3B30]"}`}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* ── Apple-Style Popover ── */}
      <AnimatePresence>
        {isActuallyOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className={`fixed right-4 top-14 md:absolute md:top-[calc(100%+8px)] md:right-0 w-[380px] max-w-[calc(100vw-2rem)] rounded-[20px] shadow-[0_12px_40px_rgba(0,0,0,0.12)] flex flex-col z-50 overflow-hidden backdrop-blur-2xl ${isDark ? "bg-[#1C1C1E]/85 border border-white/10" : "bg-white/90 border border-black/5"
              }`}
          >
            {/* Header */}
            <div className={`px-5 py-3.5 border-b flex justify-between items-center ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-white/40"}`}>
              <h3 className={`font-semibold text-[15px] tracking-tight flex items-center gap-2 ${isDark ? "text-white" : "text-black"}`}>
                System Updates
              </h3>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    disabled={marking}
                    className={`text-[12px] cursor-pointer font-medium tracking-tight transition-colors disabled:opacity-50 ${isDark ? "text-[#0A84FF] hover:text-[#5E5CE6]" : "text-[#007AFF] hover:text-[#005bb5]"}`}
                  >
                    Mark all as read
                  </button>
                )}
                <button
                  onClick={() => (onToggle ? onToggle() : setInternalIsOpen(false))}
                  className={`p-1.5 rounded-full cursor-pointer transition-colors ${isDark ? "text-[#8E8E93] hover:bg-white/10 hover:text-white" : "text-[#8E8E93] hover:bg-black/5 hover:text-black"}`}
                  aria-label="Close"
                >
                  <FaTimes className="text-[12px]" />
                </button>
              </div>
            </div>

            {/* Content List */}
            <div className={`max-h-[420px] overflow-y-auto custom-scrollbar`}>
              {updates.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <FaCheck className={`text-3xl mb-3 ${isDark ? "text-[#32D74B]" : "text-[#34C759]"} opacity-80`} />
                  <p className={`text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>You're all caught up</p>
                  <p className={`text-[12px] mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>No new system updates.</p>
                </div>
              ) : (
                updates.map((update, idx) => (
                  <div key={update.id}>
                    <div
                      className={`px-5 py-4 transition-colors relative ${!update.has_read
                        ? isDark
                          ? "bg-[#0A84FF]/5"
                          : "bg-[#007AFF]/5"
                        : isDark
                          ? "hover:bg-white/5"
                          : "hover:bg-black/[0.02]"
                        }`}
                    >
                      {/* Unread Dot Indicator */}
                      {!update.has_read && (
                        <FaCircle className={`absolute left-2.5 top-[22px] text-[8px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />
                      )}

                      <div className="flex justify-between items-start mb-2.5 gap-3 pl-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Version Pill */}
                          <span
                            className={`px-2 py-0.5 rounded-[6px] text-[10px] font-bold tracking-wide uppercase ${isDark ? "bg-[#32D74B]/15 text-[#32D74B]" : "bg-[#EBF9EE] text-[#34C759]"
                              }`}
                          >
                            v{String(update.version).replace(/^v/i, "")}
                          </span>

                          {/* Category Pill */}
                          {update.category && (
                            <span
                              className={`px-2 py-0.5 rounded-[6px] text-[10px] font-semibold tracking-wide ${isDark ? "bg-[#2C2C2E] text-[#8E8E93]" : "bg-[#F2F2F7] text-[#8E8E93]"
                                }`}
                            >
                              {update.category}
                            </span>
                          )}

                          {/* Important Flag */}
                          {update.is_important && (
                            <span
                              className={`flex items-center gap-1 text-[10px] font-bold tracking-wide ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"
                                }`}
                            >
                              <FaExclamationCircle className="text-[10px]" /> Important
                            </span>
                          )}
                        </div>

                        {/* Date */}
                        <span className={`text-[11px] font-medium tracking-tight whitespace-nowrap pt-0.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                          {new Date(update.published_at || update.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </span>
                      </div>

                      <div className="pl-1">
                        <h4 className={`text-[14px] font-semibold tracking-tight leading-snug ${isDark ? "text-white" : "text-black"}`}>
                          {update.title}
                        </h4>

                        {update.description && (
                          <div className={`text-[13px] mt-1.5 leading-relaxed tracking-tight ${isDark ? "text-[#EBEBF5]/80" : "text-[#333333]"}`}>
                            <UpdateBody t={bodyPalette} content={update.description} />
                          </div>
                        )}

                        {update.features?.length > 0 && (
                          <ul className="mt-3 space-y-1.5">
                            {update.features.map((feat, i) => (
                              <li key={i} className={`flex items-start gap-2 text-[12px] tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                                <FaCheck className={`mt-0.5 flex-shrink-0 text-[10px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} />
                                <span className="leading-snug">{feat}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {!update.has_read && (
                          <button
                            onClick={() => markAsRead(update.id)}
                            className={`mt-3.5 text-[11px] cursor-pointer font-semibold tracking-wide transition-colors ${isDark ? "text-[#0A84FF] hover:text-[#5E5CE6]" : "text-[#007AFF] hover:text-[#005bb5]"
                              }`}
                          >
                            Mark as read
                          </button>
                        )}
                      </div>
                    </div>
                    {/* iOS Style Inner Divider */}
                    {idx < updates.length - 1 && (
                      <div className={`h-[1px] ml-6 ${isDark ? "bg-[#38383A]" : "bg-[#E5E5EA]"}`} />
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