"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { FaTimes, FaClock, FaCalendarAlt, FaCheck, FaTrash, FaChevronDown } from "react-icons/fa";

// ── Types (public) ──────────────────────────────────────────────────────────

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

// ── Types (internal) ────────────────────────────────────────────────────────

type UpcomingReminder = {
  id: number;
  leadId: number;
  leadName: string;
  leadPhone: string;
  leadSrNo?: number;
  assignedUserId: string | number;
  assignedUserName: string;
  reminderType: string;
  note: string | null;
  remindAt: string;
  status: string;
  createdAt: string;
};

type QuickOption = { label: string; days: number };

// ── Constants ───────────────────────────────────────────────────────────────

const QUICK_OPTIONS: QuickOption[] = [
  { label: "Tomorrow", days: 1 },
  { label: "Day after tomorrow", days: 2 },
  { label: "In 3 days", days: 3 },
  { label: "In 1 week", days: 7 },
];

const PAGE_SIZE = 10;

// ── Helpers ─────────────────────────────────────────────────────────────────

function getQuickDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
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

function formatIST(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function getStatusInfo(status: string, remindAt: string): { label: string; color: string } {
  const now = Date.now();
  const due = new Date(remindAt).getTime();
  if (status === "notified" || (status === "pending" && due <= now)) {
    return { label: "Overdue", color: "text-red-400 bg-red-500/10 border-red-500/20" };
  }
  if (status === "pending" && due <= now + 60 * 60 * 1000) {
    return { label: "Due Soon", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
  }
  return { label: "Pending", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export default function ReminderModal({
  lead,
  isDark,
  theme,
  onClose,
  onSubmit,
}: ReminderModalProps) {
  const [activeTab, setActiveTab] = useState<"new" | "upcoming">("new");
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const bg = isDark ? "bg-[#121212]" : "bg-[#F8FAFC]";
  const borderSoft = isDark ? "border-[#2a2a2a]" : "border-gray-200";

  return (
    <div
      className="fixed inset-0 bg-black/75 z-[200] flex items-center justify-center p-4 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}
    >
      <div
        className={`rounded-2xl w-full max-w-md shadow-2xl border overflow-hidden flex flex-col ${theme.modalCard}`}
        style={{ ...theme.modalGlass, maxHeight: "90vh" }}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
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
              <FaClock className="w-4 h-4" /> Follow-up Reminders
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

        {/* ── Tab Bar (iOS segmented control style) ────────────────────── */}
        <div className={`px-5 pt-4 pb-2 ${bg}`}>
          <div
            className={`flex rounded-xl p-1 border ${
              isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-gray-100 border-gray-200"
            }`}
          >
            {(["new", "upcoming"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  activeTab === tab
                    ? isDark
                      ? "bg-purple-600 text-white shadow-md"
                      : "bg-white text-purple-700 shadow-md"
                    : isDark
                    ? "text-gray-400 hover:text-gray-200"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab === "new" ? "New Reminder" : "Upcoming"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab Content ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "new" ? (
            <CreateTab
              lead={lead}
              isDark={isDark}
              theme={theme}
              onClose={onClose}
              onSubmit={onSubmit}
              onCreated={triggerRefresh}
            />
          ) : (
            <UpcomingTab
              lead={lead}
              isDark={isDark}
              theme={theme}
              refreshKey={refreshKey}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Create Tab (preserves exact existing form)
// ═══════════════════════════════════════════════════════════════════════════

function CreateTab({
  lead,
  isDark,
  theme,
  onClose,
  onSubmit,
  onCreated,
}: {
  lead: ReminderLead;
  isDark: boolean;
  theme: ReminderTheme;
  onClose: () => void;
  onSubmit: (remindAt: string, note: string) => Promise<void>;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [selectedQuick, setSelectedQuick] = useState<number | null>(null);
  const [customDatetime, setCustomDatetime] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const handleQuickSelect = (days: number) => {
    setSelectedQuick(days);
    setMode("quick");
    setCustomDatetime("");
    setError("");
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    let remindAt: string;
    if (mode === "quick" && selectedQuick !== null) {
      remindAt = getQuickDate(selectedQuick).toISOString();
    } else if (mode === "custom" && customDatetime) {
      const [datePart, timePart] = customDatetime.split("T");
      if (!datePart || !timePart) {
        setError("Invalid date/time.");
        return;
      }
      const [yr, mo, dy] = datePart.split("-").map(Number);
      const [hr, mn] = timePart.split(":").map(Number);
      const d = new Date(yr, mo - 1, dy, hr, mn, 0, 0);
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
      onCreated();
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

  const accentBg = "bg-[#9E217B]";
  const accentHover = isDark ? "hover:bg-[#b8268f]" : "hover:bg-[#8a1d6b]";

  return (
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
            const isSelected = mode === "quick" && selectedQuick === opt.days;
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
              setSelectedQuick(null);
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
        <label className={`block text-xs font-bold mb-1.5 ${theme.textMuted}`}>
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
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Upcoming Tab
// ═══════════════════════════════════════════════════════════════════════════

function UpcomingTab({
  lead,
  isDark,
  theme,
  refreshKey,
}: {
  lead: ReminderLead;
  isDark: boolean;
  theme: ReminderTheme;
  refreshKey: number;
}) {
  const [reminders, setReminders] = useState<UpcomingReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchReminders = useCallback(
    async (pageNum: number, append = false) => {
      try {
        if (!append) setLoading(true);
        else setLoadingMore(true);

        const url = `/api/reminders?lead_id=${lead.id}&status=pending,notified&page=${pageNum}&limit=${PAGE_SIZE}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch reminders");
        const json = await res.json();

        if (!json.success || !Array.isArray(json.data)) {
          throw new Error(json.message || "Invalid response");
        }

        const items: UpcomingReminder[] = json.data;
        setReminders((prev) => (append ? [...prev, ...items] : items));
        setHasMore(json.hasMore ?? false);
        setPage(pageNum);
        setError("");
      } catch (err: any) {
        setError(err?.message || "Failed to load reminders");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [lead.id],
  );

  useEffect(() => {
    fetchReminders(1);
  }, [fetchReminders, refreshKey]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleComplete = async (id: number) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Failed to complete");
      }
      setReminders((prev) => prev.filter((r) => r.id !== id));
      showToast("Reminder completed");
    } catch (err: any) {
      showToast(err?.message || "Error completing reminder");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: number) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || "Failed to delete");
      }
      setReminders((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteId(null);
      showToast("Reminder deleted");
    } catch (err: any) {
      showToast(err?.message || "Error deleting reminder");
    } finally {
      setActionLoading(null);
    }
  };

  const cardBg = isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-gray-200";
  const bg = isDark ? "bg-[#121212]" : "bg-[#F8FAFC]";

  // ── Loading state ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`p-8 flex items-center justify-center ${bg}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className={`text-xs ${theme.textMuted}`}>Loading reminders...</p>
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────
  if (error && reminders.length === 0) {
    return (
      <div className={`p-8 text-center ${bg}`}>
        <p className="text-xs text-red-400 font-semibold">{error}</p>
        <button
          type="button"
          onClick={() => fetchReminders(1)}
          className="mt-3 text-xs text-purple-400 hover:text-purple-300 font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────
  if (reminders.length === 0) {
    return (
      <div className={`p-8 text-center ${bg}`}>
        <div className={`text-3xl mb-3 ${theme.textFaint}`}>
          <FaClock className="mx-auto opacity-30" />
        </div>
        <p className={`text-sm font-semibold ${theme.textMuted}`}>
          No upcoming reminders
        </p>
        <p className={`text-xs mt-1 ${theme.textFaint}`}>
          Create one from the &ldquo;New Reminder&rdquo; tab
        </p>
      </div>
    );
  }

  // ── Reminder list ───────────────────────────────────────────────────
  return (
    <div className={`p-4 space-y-3 ${bg}`}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] px-4 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold shadow-xl animate-fadeIn">
          {toast}
        </div>
      )}

      {reminders.map((r) => {
        const statusInfo = getStatusInfo(r.status, r.remindAt);
        const isDeleting = confirmDeleteId === r.id;
        const isActing = actionLoading === r.id;

        return (
          <div
            key={r.id}
            className={`rounded-xl border p-4 transition-all ${cardBg} ${
              isActing ? "opacity-60 pointer-events-none" : ""
            }`}
          >
            {/* Top row: lead info + status badge */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                  {r.leadName || "Lead"}
                </p>
                <p className={`text-[11px] mt-0.5 ${theme.textFaint}`}>
                  #{r.leadSrNo || r.leadId}
                </p>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${statusInfo.color}`}
              >
                {statusInfo.label}
              </span>
            </div>

            {/* Date/time */}
            <div className={`mt-2 flex items-center gap-1.5 text-xs ${theme.textMuted}`}>
              <FaCalendarAlt className="text-[10px] shrink-0" />
              <span>{formatIST(r.remindAt)}</span>
            </div>

            {/* Note */}
            {r.note && (
              <p className={`mt-1.5 text-xs leading-relaxed ${theme.textFaint}`}>
                {r.note}
              </p>
            )}

            {/* Type + created */}
            <div className={`mt-2 flex items-center gap-3 text-[10px] ${theme.textFaint}`}>
              <span className="capitalize">{r.reminderType?.replace(/_/g, " ")}</span>
              <span>Created {formatIST(r.createdAt)}</span>
            </div>

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              {isDeleting ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    disabled={isActing}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-bold bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    {isActing ? "Deleting..." : "Confirm Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                      isDark
                        ? "border-[#333] text-gray-400 hover:text-white"
                        : "border-gray-200 text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleComplete(r.id)}
                    disabled={isActing}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                      isDark
                        ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/20"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    }`}
                  >
                    <FaCheck className="text-[9px]" />
                    {isActing ? "..." : "Complete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(r.id)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                      isDark
                        ? "bg-red-600/10 text-red-400 hover:bg-red-600/20 border border-red-500/20"
                        : "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                    }`}
                  >
                    <FaTrash className="text-[9px]" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Load more */}
      {hasMore && (
        <button
          type="button"
          onClick={() => fetchReminders(page + 1, true)}
          disabled={loadingMore}
          className={`w-full py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 border ${
            isDark
              ? "border-[#333] text-purple-400 hover:bg-purple-600/10"
              : "border-gray-200 text-purple-600 hover:bg-purple-50"
          }`}
        >
          <FaChevronDown className="text-[9px]" />
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
