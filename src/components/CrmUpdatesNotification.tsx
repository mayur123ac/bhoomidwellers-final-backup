"use client";

import { useState, useEffect } from "react";
import { FaBullhorn, FaTimes, FaCheck, FaExclamationCircle } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";

interface CrmUpdate {
  id: number;
  version: string;
  title: string;
  description: string;
  category: string;
  features: string[] | string;
  is_important: boolean;
  created_at: string;
  has_read: boolean;
}

export default function CrmUpdatesNotification({ user, theme, isDark, isOpen, onToggle }: { user: any, theme: any, isDark: boolean, isOpen?: boolean, onToggle?: () => void }) {
  const [updates, setUpdates] = useState<CrmUpdate[]>([]);
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const isActuallyOpen = isOpen !== undefined ? isOpen : internalIsOpen;

  const handleToggle = () => {
    if (onToggle) onToggle();
    else setInternalIsOpen(!internalIsOpen);
  };

  const userId = user?.id || user?._id;

  useEffect(() => {
    if (!userId) return;
    fetchUpdates();
  }, [userId]);

  const fetchUpdates = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/updates?userId=${userId}`);
      if (res.ok) {
        const json = await res.json();
        setUpdates(json.data || []);
      }
    } catch (e) {
      console.error("Failed to fetch updates:", e);
    }
  };

  const markAsRead = async (updateId: number) => {
    if (!userId) return;
    try {
      // Optimistically update UI
      setUpdates((prev) =>
        prev.map((u) => (u.id === updateId ? { ...u, has_read: true } : u))
      );

      await fetch(`/api/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read", userId, updateId }),
      });
    } catch (e) {
      console.error("Failed to mark update as read:", e);
    }
  };

  const unreadCount = updates.filter((u) => !u.has_read).length;

  return (
    <div className="relative">
      <div
        className="relative cursor-pointer"
        onClick={handleToggle}
      >
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
            className={`absolute top-12 right-0 w-[360px] border rounded-xl shadow-2xl flex flex-col z-50 ${theme.dropdown}`}
            style={theme.dropdownGlass}
          >
            <div className={`p-4 border-b flex justify-between items-center ${theme.tableBorder}`}>
              <h3 className={`font-bold text-sm flex items-center gap-2 ${theme.text}`}>
                <FaBullhorn className="text-[#9E217B]" />
                System Updates
              </h3>
              <button onClick={() => onToggle ? onToggle() : setInternalIsOpen(false)} className={`${theme.textMuted} hover:text-red-500 transition-colors`}>
              <FaTimes className="text-xs" />
            </button>
          </div>

          <div className={`max-h-[400px] overflow-y-auto ${theme.scroll}`}>
            {updates.length === 0 ? (
              <p className={`p-6 text-center text-xs ${theme.textMuted}`}>No new updates.</p>
            ) : (
              updates.map((update) => {
                let parsedFeatures: string[] = [];
                try {
                  if (typeof update.features === "string") {
                    parsedFeatures = JSON.parse(update.features);
                  } else if (Array.isArray(update.features)) {
                    parsedFeatures = update.features;
                  }
                } catch {
                  parsedFeatures = [];
                }

                return (
                  <div
                    key={update.id}
                    className={`p-4 border-b last:border-b-0 transition-colors ${!update.has_read
                      ? (isDark ? "bg-[#9E217B]/10 border-[#9E217B]/20" : "bg-[#9E217B]/5 border-[#9E217B]/10")
                      : (isDark ? "hover:bg-white/5 border-[#333]" : "hover:bg-black/5 border-[#E5E7EB]")
                      }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isDark ? "bg-indigo-900/40 text-indigo-300" : "bg-indigo-100 text-indigo-700"
                          }`}>
                          v{update.version}
                        </span>
                        {update.is_important && (
                          <span className={`flex items-center gap-1 text-[10px] font-bold ${isDark ? "text-red-400" : "text-red-600"
                            }`}>
                            <FaExclamationCircle /> Important
                          </span>
                        )}
                        {!update.has_read && (
                          <span className="w-2 h-2 bg-[#9E217B] rounded-full animate-pulse" />
                        )}
                      </div>
                      <span className={`text-[10px] ${theme.textMuted}`}>
                        {new Date(update.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </span>
                    </div>

                    <h4 className={`text-sm font-bold ${theme.text}`}>{update.title}</h4>

                    {update.description && (
                      <p className={`text-xs mt-1 leading-relaxed ${theme.textMuted}`}>
                        {update.description}
                      </p>
                    )}

                    {parsedFeatures.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {parsedFeatures.map((feat, i) => (
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
                );
              })
            )}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

