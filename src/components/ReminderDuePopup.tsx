"use client";

import { useState } from "react";
import { FaClock, FaTimes, FaCheckCircle, FaPhoneAlt, FaUser, FaRupeeSign, FaBuilding } from "react-icons/fa";

export type OverdueReminder = {
  id: number;
  leadId: number;
  leadName?: string;
  leadPhone?: string;
  leadSrNo?: number;
  leadBudget?: string;
  leadConfiguration?: string;
  leadPropertyType?: string;
  assignedUserId: number;
  assignedUserName?: string;
  createdByName: string;
  reminderType: string;
  note: string | null;
  remindAt: string;
  status: string;
  createdAt: string;
};

type Props = {
  reminders: OverdueReminder[];
  isDark: boolean;
  onMarkComplete: (id: number) => void;
  onDismiss: () => void;
  onOpenLead?: (leadId: number) => void;
};

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return iso; }
}

function timeAgoLabel(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "upcoming";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m overdue`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h overdue`;
  const days = Math.floor(hrs / 24);
  return `${days}d overdue`;
}

export default function ReminderDuePopup({ reminders, isDark, onMarkComplete, onDismiss, onOpenLead }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [completing, setCompleting] = useState(false);

  if (reminders.length === 0) return null;

  const r = reminders[currentIdx] || reminders[0];
  const total = reminders.length;
  const overdue = timeAgoLabel(r.remindAt);

  const handleComplete = async () => {
    setCompleting(true);
    onMarkComplete(r.id);
    // Move to next or close
    if (currentIdx < total - 1) {
      setCurrentIdx(prev => prev);
      // The parent will remove this from the array, so currentIdx stays
    }
    setCompleting(false);
  };

  const handleNext = () => {
    if (currentIdx < total - 1) setCurrentIdx(prev => prev + 1);
  };
  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(prev => prev - 1);
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center animate-fadeIn"
      style={{
        background: isDark
          ? "radial-gradient(ellipse at center, rgba(158,33,123,0.15) 0%, rgba(0,0,0,0.92) 100%)"
          : "radial-gradient(ellipse at center, rgba(158,33,123,0.08) 0%, rgba(0,0,0,0.75) 100%)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="w-full max-w-lg mx-4 flex flex-col items-center">
        {/* Pulsing bell icon */}
        <div className="relative mb-6">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl ${isDark ? "bg-gradient-to-br from-purple-600 to-pink-600" : "bg-gradient-to-br from-[#9E217B] to-[#E91E97]"
            }`}>
            <FaClock className="w-9 h-9 text-white animate-pulse" />
          </div>
          {/* Ping ring */}
          <div className="absolute inset-0 rounded-full border-2 border-pink-400/50 animate-ping" />
        </div>

        {/* Title */}
        <h1 className="text-white text-2xl sm:text-3xl font-black tracking-tight mb-1">
          Follow-up Reminder
        </h1>
        <p className={`text-sm font-semibold mb-6 ${overdue.includes("overdue")
          ? "text-red-400"
          : "text-yellow-400"
          }`}>
          {overdue}
        </p>

        {/* Card */}
        <div className={`w-full rounded-3xl overflow-hidden shadow-2xl border ${isDark ? "bg-[#1a1a1a] border-purple-500/30" : "bg-white border-purple-200"
          }`}
          style={isDark ? {} : { boxShadow: "0 8px 40px rgba(158,33,123,0.2)" }}
        >
          {/* Lead header */}
          <div className={`px-6 py-5 border-b ${isDark ? "bg-purple-950/30 border-purple-500/20" : "bg-gradient-to-r from-purple-50 to-pink-50 border-purple-100"
            }`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                  Lead #{r.leadSrNo || r.leadId}
                </p>
                <h2 className={`text-xl sm:text-2xl font-black ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
                  {r.leadName || "Unknown Lead"}
                </h2>
              </div>
              <button
                onClick={onDismiss}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isDark ? "text-gray-500 hover:text-white hover:bg-white/10" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  }`}
              >
                <FaTimes className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Lead details grid */}
          <div className={`px-6 py-5 space-y-4 ${isDark ? "bg-[#141414]" : "bg-[#FAFBFC]"}`}>
            <div className="grid grid-cols-2 gap-4">
              {/* Phone */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-gray-100 shadow-sm"
                }`}>
                <FaPhoneAlt className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-green-400" : "text-green-600"}`} />
                <div className="min-w-0">
                  <p className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Phone</p>
                  <p className={`text-sm font-bold truncate ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
                    {r.leadPhone || "N/A"}
                  </p>
                </div>
              </div>

              {/* Budget */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-gray-100 shadow-sm"
                }`}>
                <FaRupeeSign className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-yellow-400" : "text-yellow-600"}`} />
                <div className="min-w-0">
                  <p className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Budget</p>
                  <p className={`text-sm font-bold truncate ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
                    {r.leadBudget || "N/A"}
                  </p>
                </div>
              </div>

              {/* Configuration */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-gray-100 shadow-sm"
                }`}>
                <FaBuilding className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
                <div className="min-w-0">
                  <p className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Configuration</p>
                  <p className={`text-sm font-bold truncate ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
                    {r.leadConfiguration || r.leadPropertyType || "N/A"}
                  </p>
                </div>
              </div>

              {/* Set by */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-gray-100 shadow-sm"
                }`}>
                <FaUser className={`w-3.5 h-3.5 flex-shrink-0 ${isDark ? "text-purple-400" : "text-purple-600"}`} />
                <div className="min-w-0">
                  <p className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Set By</p>
                  <p className={`text-sm font-bold truncate ${isDark ? "text-white" : "text-[#1A1A1A]"}`}>
                    {r.createdByName}
                  </p>
                </div>
              </div>
            </div>

            {/* Reason / Note */}
            {r.note && (
              <div className={`px-4 py-3 rounded-xl border ${isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-gray-100 shadow-sm"
                }`}>
                <p className={`text-[10px] uppercase font-bold tracking-wider mb-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                  Reason / Note
                </p>
                <p className={`text-sm font-semibold leading-relaxed ${isDark ? "text-gray-200" : "text-[#1A1A1A]"}`}>
                  {r.note}
                </p>
              </div>
            )}

            {/* Scheduled time */}
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${isDark ? "bg-purple-900/20 border border-purple-500/20" : "bg-purple-50 border border-purple-100"
              }`}>
              <FaClock className={`w-3.5 h-3.5 ${isDark ? "text-purple-400" : "text-purple-500"}`} />
              <p className={`text-xs font-bold ${isDark ? "text-purple-300" : "text-purple-700"}`}>
                Scheduled: {formatDateTime(r.remindAt)}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className={`px-6 py-5 border-t flex gap-3 ${isDark ? "bg-[#111] border-[#2a2a2a]" : "bg-[#F8FAFC] border-gray-100"
            }`}>
            <button
              onClick={handleComplete}
              disabled={completing}
              className="flex-1 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-lg shadow-green-600/20"
            >
              <FaCheckCircle className="w-4 h-4" />
              {completing ? "Completing..." : "Mark Complete"}
            </button>
            {onOpenLead && (
              <button
                onClick={() => onOpenLead(r.leadId)}
                className={`flex-1 py-3.5 rounded-xl font-bold text-sm cursor-pointer transition-all border-2 ${isDark
                  ? "border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
                  : "border-purple-300 text-purple-700 hover:bg-purple-50"
                  }`}
              >
                Open Lead
              </button>
            )}
            <button
              onClick={onDismiss}
              className={`px-5 py-3.5 rounded-xl font-bold text-sm cursor-pointer transition-all ${isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"
                }`}
            >
              Later
            </button>
          </div>

          {/* Pagination if multiple */}
          {total > 1 && (
            <div className={`px-6 py-3 border-t flex items-center justify-between ${isDark ? "bg-[#0d0d0d] border-[#2a2a2a]" : "bg-gray-50 border-gray-100"
              }`}>
              <button
                onClick={handlePrev}
                disabled={currentIdx === 0}
                className={`text-xs font-bold cursor-pointer transition-colors ${currentIdx === 0
                  ? "text-gray-600 cursor-not-allowed"
                  : isDark ? "text-purple-400 hover:text-purple-300" : "text-purple-600 hover:text-purple-700"
                  }`}
              >
                &larr; Previous
              </button>
              <p className={`text-xs font-bold ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                {currentIdx + 1} of {total} reminders
              </p>
              <button
                onClick={handleNext}
                disabled={currentIdx >= total - 1}
                className={`text-xs font-bold cursor-pointer transition-colors ${currentIdx >= total - 1
                  ? "text-gray-600 cursor-not-allowed"
                  : isDark ? "text-purple-400 hover:text-purple-300" : "text-purple-600 hover:text-purple-700"
                  }`}
              >
                Next &rarr;
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
