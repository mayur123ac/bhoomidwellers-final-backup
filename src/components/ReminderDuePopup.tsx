"use client";

import { useState } from "react";
import { FaClock, FaTimes, FaCheckCircle, FaPhoneAlt, FaUser, FaRupeeSign, FaBuilding, FaExternalLinkAlt, FaBell, FaCheck } from "react-icons/fa";

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

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return iso; }
}

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
  const isOverdue = overdue.toLowerCase().includes("overdue");

  const handleComplete = async () => {
    setCompleting(true);
    onMarkComplete(r.id);
    if (currentIdx < total - 1) {
      setCurrentIdx(prev => prev);
    }
    setCompleting(false);
  };

  const handleNext = () => {
    if (currentIdx < total - 1) setCurrentIdx(prev => prev + 1);
  };
  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(prev => prev - 1);
  };

  const reminderTypeLabel = r.reminderType
    ? r.reminderType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "Follow-up";

  // Timeline steps
  const scheduledTime = formatDateTime(r.createdAt);
  const dueTime = formatDateTime(r.remindAt);

  return (
    <div className="fixed inset-0 z-[999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4 animate-fadeIn">
      <div
        className={`w-full sm:max-w-[460px] flex flex-col overflow-hidden shadow-2xl transition-all
          ${isDark ? "bg-[#1C1C1E] border border-white/10" : "bg-white"}
          rounded-t-[28px] sm:rounded-2xl max-h-[92vh]`}
      >
        {/* Mobile drag indicator */}
        <div className="w-10 h-1.5 rounded-full mx-auto mt-3 mb-1 sm:hidden bg-gray-300 dark:bg-gray-600" />

        {/* ── Header ── */}
        <div className={`px-5 sm:px-6 pt-3 sm:pt-5 pb-4 flex justify-between items-start`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              isOverdue ? "bg-red-100 dark:bg-red-500/20" : "bg-amber-100 dark:bg-amber-500/20"
            }`}>
              <FaClock className={`w-4.5 h-4.5 ${isOverdue ? "text-red-500" : "text-amber-500"}`} />
            </div>
            <div>
              <h2 className={`text-base sm:text-lg font-bold leading-tight ${isDark ? "text-white" : "text-gray-900"}`}>
                {reminderTypeLabel} Reminder
              </h2>
              <span className={`text-xs font-bold ${isOverdue ? "text-red-500" : "text-amber-500"}`}>
                {overdue}
              </span>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors shrink-0 mt-0.5 ${
              isDark ? "bg-white/10 hover:bg-white/20 text-gray-400" : "bg-gray-100 hover:bg-gray-200 text-gray-500"
            }`}
          >
            <FaTimes className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="px-5 sm:px-6 pb-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1">

          {/* ── LEAD Section ── */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
              Lead
            </p>
            <div className="flex items-center justify-between gap-3">
              <h3 className={`text-lg sm:text-xl font-black leading-tight ${isDark ? "text-white" : "text-gray-900"}`}>
                <span className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
                  #{r.leadSrNo || r.leadId}
                </span>
                {" "}{r.leadName || "Unknown Lead"}
              </h3>
              {onOpenLead && (
                <button
                  onClick={() => { onOpenLead(r.leadId); onDismiss(); }}
                  className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline shrink-0 cursor-pointer"
                >
                  Open Lead <FaExternalLinkAlt className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </div>

          {/* ── Lead Details Grid ── */}
          <div className={`rounded-xl border p-3.5 grid grid-cols-2 gap-3 ${
            isDark ? "bg-white/[0.03] border-white/10" : "bg-gray-50 border-gray-100"
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isDark ? "bg-blue-500/10" : "bg-blue-50"
              }`}>
                <FaPhoneAlt className={`w-3 h-3 ${isDark ? "text-blue-400" : "text-blue-500"}`} />
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Phone</p>
                <p className={`text-sm font-semibold truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}>{r.leadPhone || "N/A"}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isDark ? "bg-green-500/10" : "bg-green-50"
              }`}>
                <FaRupeeSign className={`w-3 h-3 ${isDark ? "text-green-400" : "text-green-600"}`} />
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Budget</p>
                <p className={`text-sm font-semibold truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}>{r.leadBudget || "N/A"}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isDark ? "bg-purple-500/10" : "bg-purple-50"
              }`}>
                <FaBuilding className={`w-3 h-3 ${isDark ? "text-purple-400" : "text-purple-600"}`} />
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Configuration</p>
                <p className={`text-sm font-semibold truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}>{r.leadConfiguration || r.leadPropertyType || "N/A"}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isDark ? "bg-orange-500/10" : "bg-orange-50"
              }`}>
                <FaUser className={`w-3 h-3 ${isDark ? "text-orange-400" : "text-orange-500"}`} />
              </div>
              <div className="min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Set by</p>
                <p className={`text-sm font-semibold truncate ${isDark ? "text-gray-200" : "text-gray-800"}`}>{r.createdByName}</p>
              </div>
            </div>
          </div>

          {/* ── Reason / Note ── */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
              Reason / Note
            </p>
            <p className={`text-sm font-medium leading-relaxed ${isDark ? "text-gray-200" : "text-gray-800"}`}>
              {r.note || "No specific reason provided."}
            </p>
          </div>

          {/* ── Reminder Details ── */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
              Reminder Details
            </p>
            <div className={`rounded-xl border p-3.5 flex gap-4 ${
              isDark ? "bg-white/[0.03] border-white/10" : "bg-gray-50 border-gray-100"
            }`}>
              <div className="flex items-center gap-2.5 flex-1">
                <FaClock className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-blue-400" : "text-blue-500"}`} />
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Scheduled for</p>
                  <p className={`text-sm font-bold ${isDark ? "text-gray-200" : "text-gray-800"}`}>{formatDate(r.remindAt)}</p>
                </div>
              </div>
              <div className={`w-px ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
              <div className="flex items-center gap-2.5 flex-1">
                <FaClock className={`w-3.5 h-3.5 shrink-0 ${isDark ? "text-blue-400" : "text-blue-500"}`} />
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-gray-500" : "text-gray-400"}`}>Time</p>
                  <p className={`text-sm font-bold ${isDark ? "text-gray-200" : "text-gray-800"}`}>{formatTime(r.remindAt)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Timeline ── */}
          <div className="flex flex-col gap-0 pl-1">
            {/* Scheduled */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-red-200 dark:border-red-500/30 shrink-0" />
                <div className={`w-0.5 flex-1 min-h-[28px] ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
              </div>
              <div className="pb-4">
                <p className="text-xs font-bold text-red-500">Scheduled</p>
                <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{scheduledTime}</p>
                <p className={`text-[11px] mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                  Reminder was scheduled by {r.createdByName}
                </p>
              </div>
            </div>

            {/* Due */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-amber-200 dark:border-amber-500/30 shrink-0" />
                <div className={`w-0.5 flex-1 min-h-[28px] ${isDark ? "bg-white/10" : "bg-gray-200"}`} />
              </div>
              <div className="pb-4">
                <p className="text-xs font-bold text-amber-500">Due</p>
                <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>{dueTime}</p>
                <p className={`text-[11px] mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                  Reminder is {overdue}
                </p>
              </div>
            </div>

            {/* Completed */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                  isDark ? "bg-gray-700 border-gray-600" : "bg-gray-200 border-gray-300"
                }`} />
              </div>
              <div>
                <p className={`text-xs font-bold ${isDark ? "text-gray-500" : "text-gray-400"}`}>Completed</p>
                <p className={`text-[11px] ${isDark ? "text-gray-600" : "text-gray-400"}`}>Not completed yet</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className={`px-5 sm:px-6 pt-4 pb-6 sm:pb-5 border-t ${
          isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-100 bg-gray-50/80"
        }`}>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onDismiss}
              className={`order-2 sm:order-1 sm:flex-1 px-5 py-3.5 sm:py-2.5 rounded-xl font-bold text-sm transition-all text-center cursor-pointer border ${
                isDark
                  ? "bg-transparent border-white/15 text-white hover:bg-white/10"
                  : "bg-white border-gray-200 text-gray-700 hover:bg-gray-100"
              }`}
            >
              Later
            </button>
            <button
              onClick={handleComplete}
              disabled={completing}
              className={`order-1 sm:order-2 sm:flex-1 px-5 py-3.5 sm:py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                completing
                  ? "bg-blue-500/50 cursor-not-allowed text-white"
                  : "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 active:scale-[0.98]"
              }`}
            >
              <FaCheckCircle className="w-4 h-4" />
              {completing ? "Completing..." : "Mark Complete"}
            </button>
          </div>
        </div>

        {/* ── Pagination ── */}
        {total > 1 && (
          <div className={`px-5 sm:px-6 py-3 border-t flex items-center justify-between ${
            isDark ? "border-white/10 bg-black/20" : "border-gray-200 bg-gray-100"
          }`}>
            <button
              onClick={handlePrev}
              disabled={currentIdx === 0}
              className={`text-xs font-bold transition-colors cursor-pointer ${
                currentIdx === 0
                  ? "text-gray-400 cursor-not-allowed"
                  : isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"
              }`}
            >
              &larr; Prev
            </button>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              {currentIdx + 1} of {total}
            </p>
            <button
              onClick={handleNext}
              disabled={currentIdx >= total - 1}
              className={`text-xs font-bold transition-colors cursor-pointer ${
                currentIdx >= total - 1
                  ? "text-gray-400 cursor-not-allowed"
                  : isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700"
              }`}
            >
              Next &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
