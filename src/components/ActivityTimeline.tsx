"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FaCalendarAlt,
  FaCheckCircle,
  FaClock,
  FaHandshake,
  FaHistory,
  FaPhoneAlt,
  FaUserCheck,
} from "react-icons/fa";

interface AssignmentLog {
  id: number | string;
  lead_id: number | string;
  assigned_to?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  reason?: string | null;
}

interface ActivityTimelineProps {
  lead: any;
  isDark: boolean;
  theme?: Record<string, any>;
  compact?: boolean;
  showAudit?: boolean;
  maxAuditItems?: number;
  className?: string;
}

const completedStatuses = new Set(["Completed", "Closing", "Closed"]);
const contactedStatuses = new Set([
  "Contacted",
  "Interested",
  "Visit Scheduled",
  "Completed",
  "Closing",
  "Closed",
]);
const visitStatuses = new Set(["Visit Scheduled", "Completed", "Closing", "Closed"]);

function formatTimelineDate(value: any) {
  if (!value || value === "N/A" || value === "Pending") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseJsonArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function firstPresent(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

export default function ActivityTimeline({
  lead,
  isDark,
  theme,
  compact = false,
  showAudit = true,
  maxAuditItems = 4,
  className = "",
}: ActivityTimelineProps) {
  const [auditLogs, setAuditLogs] = useState<AssignmentLog[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [isAuditCollapsed, setIsAuditCollapsed] = useState(true);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(false);
  useEffect(() => {
    if (!showAudit || !lead?.id) {
      setAuditLogs([]);
      return;
    }

    let cancelled = false;
    setIsLoadingAudit(true);

    fetch(`/api/leads/${lead.id}/assignment-history`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json) => {
        if (!cancelled) setAuditLogs(Array.isArray(json.data) ? json.data : []);
      })
      .catch(() => {
        if (!cancelled) setAuditLogs([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAudit(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lead?.id, showAudit]);

  const timeline = useMemo(() => {
    const status = lead?.status || "Assigned";
    const visitHistory = parseJsonArray(lead?.site_visit_history);
    const latestHistoryVisit = visitHistory
      .map((item) =>
        firstPresent(
          item?.visit_date,
          item?.siteVisitDate,
          item?.scheduled_at,
          item?.date
        )
      )
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    const visitDate = firstPresent(
      lead?.mongoVisitDate,
      lead?.site_visit_date,
      lead?.siteVisitDate,
      latestHistoryVisit
    );
    const completedDate = firstPresent(
      lead?.closingDate,
      lead?.closing_date,
      lead?.completed_at,
      completedStatuses.has(status) ? lead?.last_activity_at : null
    );

    return [
      {
        key: "assigned",
        label: "Assigned",
        detail: lead?.assigned_to || lead?.assign_manager || "Unassigned",
        date: firstPresent(lead?.assigned_at, lead?.created_at, lead?.enquiry_date),
        done: Boolean(lead?.assigned_at || lead?.assigned_to || lead?.assign_manager),
        icon: FaUserCheck,
      },
      {
        key: "contacted",
        label: "Contacted",
        detail: lead?.first_contact_at ? "First contact logged" : "Awaiting first contact",
        date: lead?.first_contact_at,
        done: Boolean(lead?.first_contact_at || contactedStatuses.has(status)),
        icon: FaPhoneAlt,
      },
      {
        key: "visit",
        label: "Visit Scheduled",
        detail: visitDate ? "Site visit scheduled" : "No visit scheduled",
        date: visitDate,
        done: Boolean(visitDate || visitStatuses.has(status)),
        icon: FaCalendarAlt,
      },
      {
        key: "completed",
        label: "Completed",
        detail: completedStatuses.has(status) ? status : "Deal not completed",
        date: completedDate,
        done: completedStatuses.has(status),
        icon: FaHandshake,
      },
    ];
  }, [lead]);

  const visibleLogs = auditLogs.slice(0, maxAuditItems);
  const panelClass =
    theme?.tableWrap ||
    (isDark ? "bg-[#1a1a1a] border-[#2a2a2a]" : "bg-white border-indigo-300");
  const textClass = theme?.text || (isDark ? "text-white" : "text-[#1A1A1A]");
  const mutedClass = theme?.textMuted || (isDark ? "text-gray-400" : "text-[#6B7280]");
  const faintClass = theme?.textFaint || (isDark ? "text-gray-500" : "text-[#9CA3AF]");
  const accentClass = theme?.accentText || (isDark ? "text-[#d946a8]" : "text-[#9E217B]");
  const borderClass = theme?.tableBorder || (isDark ? "border-[#2a2a2a]" : "border-[#D1D5DB]");
  const innerClass =
    theme?.innerBlock ||
    (isDark ? "bg-[#121212] border-[#333]" : "bg-white border-indigo-200");

  return (
    <section className={`rounded-xl border p-4 ${panelClass} ${className}`}>
      {/* --- ACTIVITY TIMELINE DESIGN SECTION START --- */}
      <div 
        className="flex items-center justify-between gap-3 mb-4 cursor-pointer select-none"
        onClick={() => setIsTimelineCollapsed((prev) => !prev)}
      >
        <div>
          <h3 className={`text-sm font-bold flex items-center gap-2 ${textClass}`}>
            <FaHistory className={accentClass} /> Activity Timeline
          </h3>
          {!compact && (
            <p className={`text-[11px] mt-0.5 ${faintClass}`}>
              Assigned -&gt; Contacted -&gt; Visit Scheduled -&gt; Completed
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${innerClass}`}>
            {lead?.status || "Assigned"}
          </span>
          <span className={`text-[10px] ${faintClass}`}>
            {isTimelineCollapsed ? "▼ Show" : "▲ Hide"}
          </span>
        </div>
      </div>

      {!isTimelineCollapsed && (
        <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"}`}>
          {timeline.map((stage) => {
            const Icon = stage.icon;
            return (
              <div key={stage.key} className={`rounded-lg border p-3 ${innerClass}`}>
                <div className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 ${
                      stage.done
                        ? isDark
                          ? "bg-green-500/10 border-green-500/40 text-green-400"
                          : "bg-green-50 border-green-300 text-green-600"
                        : isDark
                          ? "bg-white/5 border-white/10 text-gray-500"
                          : "bg-gray-50 border-gray-200 text-gray-400"
                    }`}
                  >
                    {stage.done ? <FaCheckCircle className="text-sm" /> : <FaClock className="text-sm" />}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-bold ${textClass}`}>
                      <Icon className="inline mr-1.5 text-[10px]" />
                      {stage.label}
                    </p>
                    <p className={`text-[11px] mt-1 truncate ${mutedClass}`}>{stage.detail}</p>
                    <p className={`text-[10px] mt-1 ${faintClass}`}>{formatTimelineDate(stage.date)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* --- ACTIVITY TIMELINE DESIGN SECTION END --- */}

      {showAudit && (
        <div className={`mt-4 pt-4 border-t ${borderClass}`}>
          <div
            className="flex items-center justify-between mb-2 cursor-pointer select-none"
            onClick={() => setIsAuditCollapsed((prev) => !prev)}
          >
            <p className={`text-xs font-bold uppercase tracking-wider ${faintClass} flex items-center gap-2`}>
              Assignment History
              <span className="text-[10px] bg-gray-500/20 px-1.5 py-0.5 rounded">
                {visibleLogs.length}
              </span>
            </p>
            <div className="flex items-center gap-2">
              {isLoadingAudit && <span className={`text-[10px] ${faintClass}`}>Loading...</span>}
              <span className={`text-[10px] ${faintClass}`}>
                {isAuditCollapsed ? "▼ Show" : "▲ Hide"}
              </span>
            </div>
          </div>
          {!isAuditCollapsed && (
            <>
              {visibleLogs.length === 0 && !isLoadingAudit ? (
                <p className={`text-xs ${mutedClass}`}>No assignment audit entries yet.</p>
              ) : (
                <div className="space-y-2">
                  {visibleLogs.map((log) => (
                    <div key={log.id} className={`rounded-lg border px-3 py-2 ${innerClass}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`text-xs font-bold truncate ${textClass}`}>
                            {log.assigned_to || "Unassigned"}
                          </p>
                          <p className={`text-[11px] mt-0.5 ${mutedClass}`}>
                            by {log.assigned_by || "System"}{log.reason ? ` - ${log.reason}` : ""}
                          </p>
                        </div>
                        <span className={`text-[10px] text-right flex-shrink-0 ${faintClass}`}>
                          {formatTimelineDate(log.assigned_at)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
