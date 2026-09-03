"use client";

import { useState, type FormEvent } from "react";
import { FaTimes, FaClock, FaCalendarAlt } from "react-icons/fa";

type ReminderLead = {
  id: string | number;
  name?: string;
  sr_no?: number;
};

type ReminderTheme = {
  modalCard: string;
  modalGlass: React.CSSProperties;
  textMuted: string;
  textFaint: string;
  settingsBg: string;
  text: string;
};

type ReminderModalProps = {
  lead: ReminderLead;
  isDark: boolean;
  theme: ReminderTheme;
  onClose: () => void;
  onSubmit: (remindAt: string, note: string) => Promise<void>;
};

type QuickOption = {
  label: string;
  days: number;
};

const QUICK_OPTIONS: QuickOption[] = [
  { label: "Tomorrow", days: 1 },
  { label: "Day after tomorrow", days: 2 },
  { label: "In 3 days", days: 3 },
  { label: "In 1 week", days: 7 },
];

function getQuickDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0); // default to 10:00 AM
  return d;
}

function toLocalDatetimeString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function getMinDatetime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  return toLocalDatetimeString(now);
}

export default function ReminderModal({
  lead,
  isDark,
  theme,
  onClose,
  onSubmit,
}: ReminderModalProps) {
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [selectedQuick, setSelectedQuick] = useState<number | null>(null);
  const [customDatetime, setCustomDatetime] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const handleQuickSelect = (days: number) => {
    setSelectedQuick(days);
    setMode("quick");
    setError("");
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    let remindAt: string;
    if (mode === "quick" && selectedQuick !== null) {
      remindAt = getQuickDate(selectedQuick).toISOString();
    } else if (mode === "custom" && customDatetime) {
      const d = new Date(customDatetime);
      if (isNaN(d.getTime())) {
        setError("Invalid date/time.");
        return;
      }
      if (d.getTime() <= Date.now()) {
        setError("Must be in the future.");
        return;
      }
      remindAt = d.toISOString();
    } else {
      setError("Select a date or pick a quick option.");
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit(remindAt, note.trim());
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to create reminder.");
      setIsSaving(false);
    }
  };

  const canSubmit =
    !isSaving &&
    ((mode === "quick" && selectedQuick !== null) ||
      (mode === "custom" && customDatetime));

  const accentBg = isDark ? "bg-[#9E217B]" : "bg-[#9E217B]";
  const accentHover = isDark ? "hover:bg-[#b8268f]" : "hover:bg-[#8a1d6b]";

  return (
    <div
      className="fixed inset-0 bg-black/75 z-[200] flex items-center justify-center p-4 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}
    >
      <div
        className={`rounded-2xl w-full max-w-md shadow-2xl border overflow-hidden ${theme.modalCard}`}
        style={theme.modalGlass}
      >
        {/* Header */}
        <div
          className={`p-5 border-b flex items-start justify-between ${
            isDark
              ? "bg-purple-950/25 border-purple-500/20"
              : "bg-purple-50 border-purple-200"
          }`}
        >
          <div>
            <h2
              className={`font-bold flex items-center gap-2 ${
                isDark ? "text-purple-300" : "text-purple-700"
              }`}
            >
              <FaClock className="w-4 h-4" /> Set Follow-up Reminder
            </h2>
            <p className={`text-xs mt-1 ${theme.textMuted}`}>
              #{lead.sr_no || lead.id} &mdash; {lead.name || "Lead"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-2 ${theme.textMuted} hover:text-purple-500`}
          >
            <FaTimes />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          className={`p-5 space-y-4 ${isDark ? "bg-[#121212]" : "bg-[#F8FAFC]"}`}
        >
          {/* Quick options */}
          <div className="space-y-2">
            <p
              className={`text-xs font-bold ${
                isDark ? "text-purple-300" : "text-purple-700"
              }`}
            >
              Quick options
            </p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_OPTIONS.map((opt) => {
                const isSelected =
                  mode === "quick" && selectedQuick === opt.days;
                return (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => handleQuickSelect(opt.days)}
                    className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      isSelected
                        ? isDark
                          ? "bg-purple-600 border-purple-400 text-white shadow-lg shadow-purple-600/20"
                          : "bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/20"
                        : isDark
                        ? "bg-[#1a1a1a] border-[#333] text-gray-300 hover:border-purple-500/50"
                        : "bg-white border-gray-200 text-gray-700 hover:border-purple-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom date/time */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setMode("custom");
                setSelectedQuick(null);
                setError("");
              }}
              className={`text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                mode === "custom"
                  ? isDark
                    ? "text-purple-300"
                    : "text-purple-700"
                  : theme.textMuted
              }`}
            >
              <FaCalendarAlt className="text-[10px]" /> Custom date &amp; time
            </button>
            {mode === "custom" && (
              <input
                type="datetime-local"
                value={customDatetime}
                min={getMinDatetime()}
                onChange={(e) => {
                  setCustomDatetime(e.target.value);
                  setError("");
                }}
                className={`w-full rounded-xl px-4 py-3 text-sm outline-none border-2 transition-colors ${
                  isDark
                    ? "bg-[#1a1a1a] border-purple-500/30 text-white focus:border-purple-500"
                    : "bg-white border-purple-200 text-[#1A1A1A] focus:border-purple-500"
                }`}
              />
            )}
          </div>

          {/* Note */}
          <div>
            <label
              className={`block text-xs font-bold mb-1.5 ${theme.textMuted}`}
            >
              Note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Call about site visit confirmation"
              maxLength={500}
              className={`w-full rounded-xl px-4 py-3 text-sm outline-none border-2 transition-colors ${
                isDark
                  ? "bg-[#1a1a1a] border-[#333] text-white focus:border-purple-500"
                  : "bg-white border-gray-200 text-[#1A1A1A] focus:border-purple-500"
              }`}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 font-semibold">{error}</p>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 py-2.5 rounded-lg font-bold cursor-pointer transition-colors ${theme.textMuted} hover:text-purple-500 border ${
                isDark ? "border-[#333]" : "border-gray-200"
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`flex-1 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 ${
                !canSubmit
                  ? "opacity-50 cursor-not-allowed bg-purple-500/40 text-white"
                  : `cursor-pointer ${accentBg} ${accentHover} text-white shadow-lg shadow-purple-600/20`
              }`}
            >
              <FaClock className="w-3.5 h-3.5" />{" "}
              {isSaving ? "Setting..." : "Set Reminder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
