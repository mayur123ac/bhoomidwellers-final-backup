"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { FaCheck, FaChevronDown, FaChevronUp, FaClock, FaUser } from "react-icons/fa";
import { UserPlus, Phone, MapPin, Handshake, IndianRupee, CalendarCheck, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Animation hook — staggered pipeline transitions
// ---------------------------------------------------------------------------

/**
 * Tracks pipeline stage transitions and provides animation state.
 * - `animatingStages`: set of ordinals currently mid-animation
 * - `animationPhase`: "setup" means bars should render at scaleX(0),
 *   "go" means they should transition to scaleX(1)
 */
function usePipelineAnimation(currentOrdinal: number, tracked: boolean) {
  const prevOrdinalRef = useRef<number | null>(null);
  const isInitialRef = useRef(true);
  const [animatingStages, setAnimatingStages] = useState<Set<number>>(new Set());
  const [animationPhase, setAnimationPhase] = useState<"idle" | "setup" | "go">("idle");

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!tracked || prefersReducedMotion) {
      prevOrdinalRef.current = currentOrdinal;
      isInitialRef.current = false;
      return;
    }

    const prev = prevOrdinalRef.current;
    prevOrdinalRef.current = currentOrdinal;

    if (isInitialRef.current) {
      isInitialRef.current = false;
      return;
    }

    if (prev === null || currentOrdinal <= prev) return;

    const toAnimate = new Set<number>();
    for (let o = prev + 1; o <= currentOrdinal; o++) {
      toAnimate.add(o);
    }

    // Phase 1: render elements at scale 0
    setAnimatingStages(toAnimate);
    setAnimationPhase("setup");

    // Phase 2: on next frame, flip to scale 1 so CSS transition fires
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimationPhase("go"));
    });

    // Phase 3: clean up after animation completes
    const totalDuration = toAnimate.size * 200 + 800;
    const timer = setTimeout(() => {
      setAnimatingStages(new Set());
      setAnimationPhase("idle");
    }, totalDuration);

    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [currentOrdinal, tracked, prefersReducedMotion]);

  return { animatingStages, animationPhase, prefersReducedMotion };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StageEntry {
  stage: string;
  ordinal: number;
  entered_at: string;
  transition_type: "ACTUAL" | "INFERRED";
  duration_ms: number | null;
  duration_clamped: boolean;
  source_event: string;
  triggered_by: number | null;
  source_table: string | null;
}

interface DealStageData {
  tracked: boolean;
  leadId: number;
  currentStage: string;
  currentOrdinal: number;
  stages: StageEntry[];
  upcomingStages: { stage: string; ordinal: number }[];
  totalStages: number;
  timelineConsistent: boolean;
  userNames?: Record<string, string>;
  manualReasons?: Record<string, string>;
}

interface Props {
  leadId: number;
  isDark: boolean;
  theme: Record<string, any>;
  userRole?: string;
  refreshKey?: number;
}

// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------

const ALL_STAGES = [
  { ordinal: 1, label: "Fresh", color: "#60A5FA", Icon: UserPlus },
  { ordinal: 2, label: "Contacted", color: "#22C55E", Icon: Phone },
  { ordinal: 3, label: "Site Visit", color: "#F97316", Icon: MapPin },
  { ordinal: 4, label: "Negotiation", color: "#8B5CF6", Icon: Handshake },
  { ordinal: 5, label: "Sales", color: "#EAB308", Icon: IndianRupee },
  { ordinal: 6, label: "Booked", color: "#2563EB", Icon: CalendarCheck },
];

const EVENT_LABELS: Record<string, string> = {
  lead_assigned: "Lead assigned to Sales Manager",
  lead_assigned_from_queue: "Assigned from queue",
  lead_assigned_bulk: "Bulk import assignment",
  sales_form_submitted: "Sales form submitted",
  call_completed: "Manual call completed",
  site_visit_scheduled: "Site visit scheduled",
  site_visit_scheduled_via_salesform: "Visit scheduled via salesform",
  site_visit_completed: "Site visit marked completed",
  booking_initiated: "Booking form initiated",
  booking_confirmed: "Booking confirmed",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ${hours % 24}h`;
  const months = Math.floor(days / 30);
  return `${months}mo ${days % 30}d`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function canAdvance(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === "admin" || r === "super admin" || r === "site head" || r === "site_head";
}

function getEventLabel(sourceEvent: string): string {
  if (sourceEvent.startsWith("manual_advance_")) return "Manual advance";
  return EVENT_LABELS[sourceEvent] || sourceEvent;
}

function getSourceBadge(entry: StageEntry): { label: string; color: string } {
  if (entry.source_event.startsWith("manual_advance_")) {
    return { label: "MANUAL", color: "blue" };
  }
  if (entry.transition_type === "INFERRED") {
    return { label: "INFERRED", color: "yellow" };
  }
  return { label: "ACTUAL", color: "green" };
}

// ---------------------------------------------------------------------------
// AdvanceModal
// ---------------------------------------------------------------------------

function AdvanceModal({
  isDark,
  theme,
  currentOrdinal,
  currentStage,
  leadId,
  onClose,
  onSuccess,
}: {
  isDark: boolean;
  theme: Record<string, any>;
  currentOrdinal: number;
  currentStage: string;
  leadId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const availableStages = ALL_STAGES.filter((s) => s.ordinal > currentOrdinal);
  const [targetOrdinal, setTargetOrdinal] = useState(availableStages[0]?.ordinal ?? 0);
  const [eventTs, setEventTs] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  const targetStage = ALL_STAGES.find((s) => s.ordinal === targetOrdinal)?.label || "";

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    if (trimmed.length > 500) {
      setError("Reason must be 500 characters or fewer.");
      return;
    }
    if (!targetOrdinal) return;

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/leads/${leadId}/deal-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_ordinal: targetOrdinal,
          event_ts: new Date(eventTs).toISOString(),
          reason: trimmed,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "Failed to advance stage.");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const accentLabel = `block text-[10px] font-bold mb-1 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`;
  const inputClass = `w-full text-xs rounded-lg px-3 py-2 mb-3 ${theme.inputBg} ${theme.inputFocus} ${theme.text} outline-none`;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className={`w-full max-w-md mx-4 rounded-2xl shadow-2xl overflow-hidden ${theme.modalCard}`}
        style={theme.modalGlass}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-3 border-b ${isDark ? "border-[#333]" : "border-gray-200"}`}>
          <h3 className={`text-sm font-bold ${theme.text}`}>Move to Next Stage</h3>
          <p className={`text-[10px] mt-0.5 ${theme.textFaint}`}>
            MANUAL stage update — this will be recorded in the history.
          </p>
        </div>

        <div className="px-5 py-4">
          <div className={`flex items-center gap-3 mb-4 p-2.5 rounded-lg ${isDark ? "bg-[#1a1a2e]" : "bg-gray-50"}`}>
            <div className="text-center">
              <p className={`text-[9px] font-medium ${theme.textFaint}`}>Current</p>
              <p className={`text-xs font-bold ${theme.text}`}>{currentStage || "None"}</p>
            </div>
            <span className={`text-lg ${theme.textFaint}`}>&rarr;</span>
            <div className="text-center">
              <p className={`text-[9px] font-medium ${theme.textFaint}`}>Target</p>
              <p className={`text-xs font-bold ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>{targetStage}</p>
            </div>
          </div>

          <label className={accentLabel}>Target Stage</label>
          <select value={targetOrdinal} onChange={(e) => setTargetOrdinal(Number(e.target.value))} className={inputClass}>
            {availableStages.map((s) => (
              <option key={s.ordinal} value={s.ordinal}>
                Stage {s.ordinal}. {s.label}
              </option>
            ))}
          </select>

          <label className={accentLabel}>Date & Time</label>
          <input type="datetime-local" value={eventTs} onChange={(e) => setEventTs(e.target.value)} className={inputClass} />

          <label className={accentLabel}>Reason *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Client confirmed interest via call"
            rows={3}
            maxLength={500}
            className={`w-full text-xs rounded-lg px-3 py-2 mb-1 resize-none ${theme.inputBg} ${theme.inputFocus} ${theme.text} outline-none`}
          />
          <p className={`text-[9px] mb-3 text-right ${reason.trim().length < 3 ? (isDark ? "text-red-400" : "text-red-500") : theme.textFaint}`}>
            {reason.length}/500 {reason.trim().length > 0 && reason.trim().length < 3 && "(min 3)"}
          </p>

          {error && (
            <p className={`text-[10px] mb-3 font-medium px-2 py-1.5 rounded-lg ${isDark ? "text-red-400 bg-red-500/10" : "text-red-600 bg-red-50"}`}>
              {error}
            </p>
          )}
        </div>

        <div className={`flex gap-2 px-5 py-3 border-t ${isDark ? "border-[#333] bg-[#111]" : "border-gray-100 bg-gray-50"}`}>
          <button
            onClick={onClose}
            disabled={submitting}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${theme.textMuted} hover:opacity-80 ${isDark ? "bg-[#222] border border-[#333]" : "bg-white border border-gray-200"}`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || reason.trim().length < 3}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${isDark ? "bg-[#9E217B] hover:bg-[#b52e93] text-white" : "bg-[#9E217B] hover:bg-[#b52e93] text-white"}`}
          >
            {submitting ? "Advancing\u2026" : "Advance Stage"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// StageHistoryPanel
// ---------------------------------------------------------------------------

function StageHistoryPanel({
  stages,
  currentOrdinal,
  isDark,
  theme,
  userNames,
  manualReasons,
}: {
  stages: StageEntry[];
  currentOrdinal: number;
  isDark: boolean;
  theme: Record<string, any>;
  userNames: Record<string, string>;
  manualReasons: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = stages.length > 0 ? stages[stages.length - 1] : null;

  return (
    <div className={`mt-2 rounded-lg border ${isDark ? "border-[#333]" : "border-gray-200"}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${isDark ? "hover:bg-white/5" : "hover:bg-black/5"}`}
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wider ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
            Stage History
          </span>
          {!expanded && latest && (
            <span className={`text-[9px] sm:text-[10px] ${theme.textFaint}`}>
              &mdash; Last: {latest.stage} ({formatDate(latest.entered_at)})
            </span>
          )}
        </div>
        {expanded ? (
          <FaChevronUp className={`w-2.5 h-2.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`} />
        ) : (
          <FaChevronDown className={`w-2.5 h-2.5 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`} />
        )}
      </button>

      {expanded && (
        <div className={`px-3 pb-3 border-t ${isDark ? "border-[#333]" : "border-gray-200"}`}>
          {stages.length === 0 ? (
            <p className={`text-[10px] py-3 text-center ${theme.textFaint}`}>
              No stage transitions recorded yet.
            </p>
          ) : (
            <div className="pt-2 space-y-0">
              {stages.map((entry, idx) => {
                const badge = getSourceBadge(entry);
                const isManual = entry.source_event.startsWith("manual_advance_");
                const reason = isManual ? manualReasons[String(entry.ordinal)] : null;
                const userName = entry.triggered_by ? userNames[String(entry.triggered_by)] : null;
                const isCurrent = entry.ordinal === currentOrdinal;
                const isLast = idx === stages.length - 1;
                const liveDuration = isCurrent ? Date.now() - new Date(entry.entered_at).getTime() : null;

                // Color sync for the history timeline spine
                const stageColor = ALL_STAGES.find(s => s.ordinal === entry.ordinal)?.color || "#9ca3af";

                return (
                  <div key={entry.ordinal} className="flex gap-2.5">
                    <div className="flex flex-col items-center w-5 flex-shrink-0">
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold flex-shrink-0 text-white"
                        style={{ backgroundColor: stageColor }}
                      >
                        {isCurrent ? entry.ordinal : <FaCheck className="text-[6px]" />}
                      </div>
                      {!isLast && (
                        <div className={`w-px flex-1 min-h-[20px] ${isDark ? "bg-[#333]" : "bg-gray-200"}`} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pb-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="text-[11px] sm:text-xs font-bold"
                          style={{ color: isCurrent ? stageColor : undefined }}
                        >
                          {entry.stage}
                        </span>
                        <span className={`text-[7px] sm:text-[8px] font-bold px-1.5 py-px rounded uppercase tracking-wider ${badge.color === "green"
                          ? isDark ? "bg-green-500/15 text-green-400" : "bg-green-100 text-green-700"
                          : badge.color === "yellow"
                            ? isDark ? "bg-yellow-500/15 text-yellow-400" : "bg-yellow-100 text-yellow-700"
                            : isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-700"
                          }`}>
                          {badge.label}
                        </span>
                        {entry.duration_ms != null && (
                          <span className={`text-[9px] ${theme.textFaint}`}>
                            {formatDuration(entry.duration_ms)}
                          </span>
                        )}
                        {isCurrent && liveDuration != null && liveDuration > 0 && (
                          <span className={`text-[9px] font-medium ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
                            {formatDuration(liveDuration)} (ongoing)
                          </span>
                        )}
                      </div>

                      <p className={`text-[9px] sm:text-[10px] mt-0.5 ${theme.textFaint}`}>
                        {formatDate(entry.entered_at)}
                        {entry.source_event && (
                          <span className={`ml-1.5 ${theme.textMuted}`}>&middot; {getEventLabel(entry.source_event)}</span>
                        )}
                      </p>

                      {userName && (
                        <p className={`text-[9px] mt-0.5 flex items-center gap-1 ${theme.textFaint}`}>
                          <FaUser className="text-[7px]" /> {userName}
                        </p>
                      )}
                      {reason && (
                        <p className={`text-[9px] mt-0.5 italic ${theme.textMuted}`}>
                          &ldquo;{reason}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DealStageTimeline (main component)
// ---------------------------------------------------------------------------

export default function DealStageTimeline({ leadId, isDark, theme, userRole, refreshKey }: Props) {
  const [data, setData] = useState<DealStageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const res = await fetch(`/api/leads/${leadId}/deal-stage`);
      if (!res.ok) {
        setData(null);
        setError(true);
        return;
      }
      const json = await res.json();
      if (json.success) {
        setData(json as DealStageData);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // Animation hook — must be called unconditionally
  const trackedOrdinal = data?.tracked ? data.currentOrdinal : 0;
  const isTracked = data?.tracked ?? false;
  const { animatingStages, animationPhase, prefersReducedMotion } = usePipelineAnimation(trackedOrdinal, isTracked);

  const cardClass = `relative isolate rounded-xl border p-3 ${theme.settingsBg}`;
  const cardStyle = theme.settingsBgGl;

  // Render Loading Skeleton
  if (loading) {
    return (
      <div className={cardClass} style={cardStyle}>
        <div className="flex items-center justify-between mb-3">
          <div className={`h-3 w-24 rounded ${isDark ? "bg-[#333]" : "bg-gray-200"} animate-pulse`} />
          <div className={`h-3 w-16 rounded ${isDark ? "bg-[#333]" : "bg-gray-200"} animate-pulse`} />
        </div>
        <div className="flex w-full overflow-x-auto pb-4 pt-2 hide-scrollbar">
          <div className="flex items-start justify-between min-w-[500px] w-full relative">
            {ALL_STAGES.map((s, i) => (
              <div key={s.ordinal} className="flex-1 flex flex-col items-center relative">
                {i < ALL_STAGES.length - 1 && (
                  <div className={`absolute top-5 left-[calc(50%+20px)] w-[calc(100%-40px)] h-[2px] -z-10 ${isDark ? "bg-[#333]" : "bg-gray-200"} animate-pulse`} />
                )}
                <div className={`w-10 h-10 rounded-full ${isDark ? "bg-[#333]" : "bg-gray-200"} animate-pulse z-10`} />
                <div className={`mt-2 h-2 w-12 rounded ${isDark ? "bg-[#333]" : "bg-gray-200"} animate-pulse`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Render Error state
  if (error && !data) {
    return (
      <div className={cardClass} style={cardStyle}>
        <div className="flex items-center justify-between mb-2">
          <p className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Deal Stage</p>
        </div>
        <p className={`text-[10px] ${theme.textFaint}`}>Failed to load stage data.</p>
        <button
          onClick={fetchData}
          className={`mt-1 text-[10px] font-medium cursor-pointer ${isDark ? "text-[#d946a8] hover:text-[#e879c0]" : "text-[#9E217B] hover:text-[#b52e93]"}`}
        >
          Retry
        </button>
      </div>
    );
  }

  // Render Untracked state
  if (!data || !data.tracked) {
    return (
      <div className={cardClass} style={cardStyle}>
        <div className="flex items-center justify-between mb-3">
          <p className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Deal Stage</p>
          {canAdvance(userRole) && (
            <button
              onClick={() => setShowAdvanceModal(true)}
              className={`text-[9px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${isDark ? "bg-[#9E217B]/20 text-[#d946a8] hover:bg-[#9E217B]/30" : "bg-[#9E217B]/10 text-[#9E217B] hover:bg-[#9E217B]/20"
                }`}
            >
              + Advance
            </button>
          )}
        </div>
        <div className="flex w-full overflow-x-auto pb-4 pt-2 hide-scrollbar">
          <div className="flex items-start justify-between min-w-[500px] w-full relative">
            {ALL_STAGES.map((s, i) => (
              <div key={s.ordinal} className="flex-1 flex flex-col items-center relative">
                {i < ALL_STAGES.length - 1 && (
                  <div className={`absolute top-5 left-[calc(50%+20px)] w-[calc(100%-40px)] h-[2px] -z-10 ${isDark ? "bg-[#333]" : "bg-gray-200"}`} />
                )}
                <div className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-2 ${isDark ? "border-[#333] bg-[#1a1a2e]" : "border-gray-200 bg-white"}`}>
                  <s.Icon size={18} className={isDark ? "text-gray-600" : "text-gray-400"} />
                </div>
                <span className={`mt-2 text-[10px] sm:text-xs text-center ${theme.textFaint}`}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className={`text-[10px] ${theme.textFaint}`}>
          No stage data yet. The pipeline will update automatically when qualifying events occur.
        </p>
        {showAdvanceModal && (
          <AdvanceModal
            isDark={isDark}
            theme={theme}
            currentOrdinal={0}
            currentStage="None"
            leadId={leadId}
            onClose={() => setShowAdvanceModal(false)}
            onSuccess={() => { setShowAdvanceModal(false); fetchData(); }}
          />
        )}
      </div>
    );
  }

  // Active pipeline variables
  const { currentOrdinal, stages, currentStage, userNames, manualReasons } = data;
  const stageMap = new Map(stages.map((s) => [s.ordinal, s]));
  const canShowAdvance = canAdvance(userRole) && currentOrdinal < 6;
  const currentStageEntry = stageMap.get(currentOrdinal);
  const liveDurationMs = currentStageEntry ? Date.now() - new Date(currentStageEntry.entered_at).getTime() : null;

  return (
    <div className={cardClass} style={cardStyle}>
      <style>{`
        @keyframes ds-pop-in{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
        @keyframes ds-line-flow{from{background-position:200% 0}to{background-position:-200% 0}}
        @keyframes ds-line-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 transparent}50%{opacity:.6;box-shadow:0 0 6px 1px var(--c)}}
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
            Deal Stage
          </p>
          <span className={`text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full ${currentOrdinal === 6
            ? isDark ? "bg-green-500/20 text-green-400" : "bg-green-100 text-green-700"
            : isDark ? "bg-[#9E217B]/20 text-[#d946a8]" : "bg-[#9E217B]/10 text-[#9E217B]"
            }`}>
            {currentStage} &middot; Stage {currentOrdinal} of 6
          </span>
        </div>
      </div>

      {/* Pipeline Visual UI */}
      <div className="overflow-x-auto hide-scrollbar -mx-2 px-2 pb-2">
        <div className="flex items-start justify-between min-w-[500px] w-full relative pt-2">
          {ALL_STAGES.map((s, i) => {
            const isCompleted = s.ordinal < currentOrdinal;
            const isCurrent = s.ordinal === currentOrdinal;

            // Animation logic variables
            const nextOrdinal = s.ordinal + 1;
            const lineFilled = s.ordinal < currentOrdinal;
            const lineAnimating = animatingStages.has(nextOrdinal);
            const lineAnimDelay = lineAnimating ? `${(nextOrdinal - Math.min(...animatingStages)) * 200}ms` : "0ms";

            const nodeAnimating = animatingStages.has(s.ordinal);
            const nodeAnimDelay = nodeAnimating ? `${(s.ordinal - Math.min(...animatingStages)) * 200}ms` : "0ms";

            const animDuration = prefersReducedMotion ? "0ms" : "500ms";

            return (
              <div key={s.ordinal} className="flex-1 flex flex-col items-center relative">
                {/* Horizontal Connector Line (Behind) */}
                {i < ALL_STAGES.length - 1 && (
                  <div className={`absolute top-[20px] -translate-y-1/2 left-[calc(50%+20px)] w-[calc(100%-40px)] h-[3px] z-0 rounded-full ${isDark ? "bg-[#333]" : "bg-gray-200"}`}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        ["--c" as any]: s.color,
                        backgroundImage: `linear-gradient(90deg, ${s.color}, ${ALL_STAGES[i + 1].color}, ${s.color})`,
                        backgroundSize: "200% 100%",
                        transformOrigin: "left",
                        transform: lineAnimating
                          ? (animationPhase === "go" ? "scaleX(1)" : "scaleX(0)")
                          : (lineFilled ? "scaleX(1)" : "scaleX(0)"),
                        transition: `transform ${animDuration} ease-in-out ${lineAnimDelay}`,
                        animation: lineFilled && !lineAnimating && !prefersReducedMotion
                          ? "ds-line-flow 2s linear infinite, ds-line-pulse 1.6s ease-in-out infinite"
                          : undefined,
                      }}
                    />
                  </div>
                )}

                {/* Circular Stage Indicator */}
                <div
                  className="relative z-10 flex items-center justify-center rounded-full transition-all duration-300 w-10 h-10 border-2"
                  style={{
                    backgroundColor: isCurrent ? s.color : isCompleted ? hexToRgba(s.color, 0.1) : (isDark ? "#1a1a2e" : "#ffffff"),
                    borderColor: isCurrent ? s.color : isCompleted ? s.color : (isDark ? "#333" : "#e5e7eb"),
                  }}
                >
                  {/* Active stage pulse effect */}
                  {isCurrent && (
                    <div
                      className="absolute -inset-1.5 rounded-full animate-pulse z-[-1]"
                      style={{ backgroundColor: hexToRgba(s.color, 0.2) }}
                    />
                  )}

                  {/* Icon */}
                  <s.Icon
                    size={18}
                    color={isCurrent ? "#ffffff" : isCompleted ? s.color : (isDark ? "#6b7280" : "#9ca3af")}
                  />

                  {/* Completed Checkmark Badge */}
                  {isCompleted && (
                    <div
                      className={`absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full flex items-center justify-center ring-2 ${isDark ? "ring-[#111]" : "ring-white"}`}
                      style={nodeAnimating ? { animation: prefersReducedMotion ? "none" : `ds-pop-in 300ms cubic-bezier(0.34, 1.56, 0.64, 1) ${nodeAnimDelay} both` } : undefined}
                    >
                      <Check size={8} strokeWidth={4} color="#fff" />
                    </div>
                  )}
                </div>

                {/* Stage Label */}
                <span
                  className="mt-2 text-[10px] sm:text-xs font-semibold text-center whitespace-nowrap transition-colors"
                  style={{ color: isCurrent || isCompleted ? s.color : (isDark ? "#6b7280" : "#9ca3af") }}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Move to next stage */}
      {canShowAdvance && (() => {
        const next = ALL_STAGES.find((s) => s.ordinal === currentOrdinal + 1);
        if (!next) return null;
        return (
          <button
            type="button"
            onClick={() => setShowAdvanceModal(true)}
            className="group mt-2 mx-auto flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white cursor-pointer shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
            style={{ backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${next.color} 70%, #000) 0%, ${next.color} 50%, color-mix(in srgb, ${next.color} 85%, #fff) 100%)` }}
          >
            <next.Icon size={14} color="#fff" />
            Move to {next.label}
            <span className="transition-transform duration-200 group-hover:translate-x-1">&rarr;</span>
          </button>
        );
      })()}

      {/* Current stage info card */}
      {currentStageEntry && (
        <div className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-[10px] sm:text-[11px] mb-1 mt-2 ${isDark ? "bg-[#1a1a2e]" : "bg-gray-50"}`}>
          <div className="flex items-center gap-1.5">
            <FaClock className={`text-[9px] ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`} />
            <span className={theme.textFaint}>Entered:</span>
            <span className={`font-medium ${theme.text}`}>{formatDate(currentStageEntry.entered_at)}</span>
          </div>
          {liveDurationMs != null && liveDurationMs > 0 && (
            <div className="flex items-center gap-1">
              <span className={theme.textFaint}>Time:</span>
              <span className={`font-bold ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
                {formatDuration(liveDurationMs)}
              </span>
            </div>
          )}
          {currentStageEntry.transition_type && (
            <span className={`text-[8px] font-bold px-1.5 py-px rounded uppercase tracking-wider ${currentStageEntry.transition_type === "INFERRED"
              ? isDark ? "bg-yellow-500/15 text-yellow-400" : "bg-yellow-100 text-yellow-700"
              : isDark ? "bg-green-500/15 text-green-400" : "bg-green-100 text-green-700"
              }`}>
              {currentStageEntry.source_event?.startsWith("manual_advance_") ? "MANUAL" : currentStageEntry.transition_type}
            </span>
          )}
        </div>
      )}

      {/* Collapsible Stage History */}
      <StageHistoryPanel
        stages={stages}
        currentOrdinal={currentOrdinal}
        isDark={isDark}
        theme={theme}
        userNames={userNames || {}}
        manualReasons={manualReasons || {}}
      />

      {/* Timeline consistency warning */}
      {!data.timelineConsistent && (
        <p className={`text-[9px] mt-1.5 ${isDark ? "text-yellow-400" : "text-yellow-600"}`}>
          Timeline has inconsistent ordering — durations may be approximate.
        </p>
      )}

      {/* Advance modal */}
      {showAdvanceModal && (
        <AdvanceModal
          isDark={isDark}
          theme={theme}
          currentOrdinal={currentOrdinal}
          currentStage={currentStage}
          leadId={leadId}
          onClose={() => setShowAdvanceModal(false)}
          onSuccess={() => { setShowAdvanceModal(false); fetchData(); }}
        />
      )}
    </div>
  );
}