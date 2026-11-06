"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  FaChevronLeft, FaChevronDown, FaEye, FaEyeSlash,
  FaHandshake, FaExchangeAlt, FaTrashAlt,
  FaFileAlt, FaCoins, FaFlag, FaPencilAlt, FaUserTie,
  FaPhone, FaEnvelope, FaMapMarkerAlt, FaClock,
  FaHome, FaCalendarAlt, FaUser, FaHashtag,
  FaThermometerHalf, FaUserCheck, FaUserCircle,
  FaWallet, FaBuilding, FaBullseye, FaFlagCheckered,
  FaThumbsUp, FaThumbsDown, FaBan, FaCheckCircle,
} from "react-icons/fa";
import { computeDealProgress, getScoreColors, type DealProgressResult } from "@/lib/dealProgressScore";
import type { LeadPermissions, LeadDetailsTheme } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DealScoreData {
  tracked: boolean;
  currentOrdinal: number;
}

interface Props extends LeadDetailsTheme {
  lead: any;
  permissions: LeadPermissions;
  bookingData: any;
  dealStageData?: DealScoreData | null;
  onBack: () => void;
  onFillSalesform: () => void;
  onTrackLoan: () => void;
  onMarkClosing: () => void;
  onOpenLostModal: () => void;
  onRestore: () => void;
  onReopen: () => void;
  onOpenBookingView: () => void;
  onDeleteLead?: () => void;
  onFollowUps?: () => void;
  followUpCount?: number;
  formatDate: (d: string) => string;
  // Revisit
  isReturningLead?: boolean;
  showPrevLead?: boolean;
  onTogglePrevLead?: () => void;
  isLoadingRevisit?: boolean;
  revisitHistory?: any;
}

// ---------------------------------------------------------------------------
// iOS-Style Action Button
// ---------------------------------------------------------------------------

function ActionBtn({
  icon, label, onClick, className,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative flex items-center justify-center gap-1.5 
        h-8 w-8 sm:w-auto sm:h-9 sm:px-3.5 
        rounded-[10px] text-[11px] sm:text-xs font-semibold tracking-wide
        transition-all duration-200 ease-in-out
        active:scale-95 shadow-sm border border-black/5 dark:border-white/5
        hover:opacity-90 hover:shadow
        ${className}`}
    >
      {/* Icon always visible */}
      <span className="text-[13px] sm:text-[14px] flex-shrink-0">{icon}</span>

      {/* Text visible ONLY on PC/larger screens, hidden on mobile */}
      <span className="hidden sm:inline-block whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Circular score ring — SVG-based
// ---------------------------------------------------------------------------

function ScoreRing({
  progress,
  isDark,
  animate,
}: {
  progress: DealProgressResult;
  isDark: boolean;
  animate: boolean;
}) {
  const prevScoreRef = useRef(progress.score);
  const [displayScore, setDisplayScore] = useState(progress.score);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!animate || prefersReducedMotion || !progress.tracked) {
      setDisplayScore(progress.score);
      prevScoreRef.current = progress.score;
      return;
    }

    const from = prevScoreRef.current;
    const to = progress.score;
    prevScoreRef.current = to;
    if (from === to) return;

    const duration = 600;
    const start = performance.now();
    let raf: number;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress.score, progress.tracked, animate, prefersReducedMotion]);

  const colors = getScoreColors(progress.temperature, isDark);
  const size = 52;
  const strokeWidth = 4.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayScore / 100) * circumference;

  return (
    <div className="lh-ring relative flex-shrink-0 drop-shadow-sm" title={progress.tracked ? `Deal Progress: ${progress.score}%` : "Not tracked"}>
      <svg width={size} height={size} className="block -rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.ringTrack}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        {progress.tracked && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors.ring}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={(!prefersReducedMotion && animate) ? { transition: "stroke-dashoffset 600ms cubic-bezier(0.33,1,0.68,1)" } : undefined}
          />
        )}
      </svg>
      {/* Score text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-[13px] font-bold leading-none ${progress.tracked ? colors.scoreText : (isDark ? "text-gray-500" : "text-gray-400")}`}>
          {progress.tracked ? displayScore : "0"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Temperature badge (iOS pill style)
// ---------------------------------------------------------------------------

function TemperatureBadge({ progress, isDark }: { progress: DealProgressResult; isDark: boolean }) {
  if (!progress.tracked) return null;
  const colors = getScoreColors(progress.temperature, isDark);
  return (
    <span
      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider flex items-center gap-1 shadow-sm ${colors.badge}`}
      title={`Temperature: ${progress.temperatureLabel}`}
    >
      <FaThermometerHalf className="text-[8px]" />
      {progress.temperatureLabel}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Metadata cell
// ---------------------------------------------------------------------------

const TONES: Record<string, { light: string; dark: string }> = {
  indigo: { light: "bg-indigo-50 text-indigo-600", dark: "bg-indigo-500/15 text-indigo-400" },
  emerald: { light: "bg-emerald-50 text-emerald-600", dark: "bg-emerald-500/15 text-emerald-400" },
  amber: { light: "bg-amber-50 text-amber-600", dark: "bg-amber-500/15 text-amber-400" },
  sky: { light: "bg-sky-50 text-sky-600", dark: "bg-sky-500/15 text-sky-400" },
  violet: { light: "bg-violet-50 text-violet-600", dark: "bg-violet-500/15 text-violet-400" },
  pink: { light: "bg-pink-50 text-pink-600", dark: "bg-pink-500/15 text-pink-400" },
  teal: { light: "bg-teal-50 text-teal-600", dark: "bg-teal-500/15 text-teal-400" },
  rose: { light: "bg-rose-50 text-rose-600", dark: "bg-rose-500/15 text-rose-400" },
  slate: { light: "bg-slate-100 text-slate-500", dark: "bg-white/10 text-gray-400" },
};

function MetaCell({ icon, label, value, accent, tone = "slate", isDark, theme }: {
  icon?: React.ReactNode; tone?: string;
  label: string; value: string; accent?: boolean; isDark: boolean; theme: Record<string, any>;
}) {
  const t = TONES[tone] ?? TONES.slate;
  return (
    <div className="min-w-0 flex items-center gap-2.5">
      <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[13px] ring-1 ring-black/5 dark:ring-white/5 ${isDark ? t.dark : t.light}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={`text-[9px] sm:text-[10px] font-medium uppercase tracking-wider leading-none mb-1 ${theme.textFaint}`}>
          {label}
        </p>
        <p className={`text-[11px] sm:text-[13px] font-semibold truncate leading-tight ${accent ? (isDark ? "text-green-400" : "text-emerald-600") : theme.text}`}>
          {value || "\u2014"}
        </p>
      </div>
    </div>
  );

}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadDetailsHeader({
  lead, permissions, bookingData, dealStageData, isDark, theme,
  onBack, onFillSalesform, onTrackLoan, onMarkClosing,
  onOpenLostModal, onRestore, onReopen, onOpenBookingView, onDeleteLead,
  onFollowUps, followUpCount, formatDate,
  isReturningLead, showPrevLead, onTogglePrevLead, isLoadingRevisit, revisitHistory,
}: Props) {
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [showMobileDetails, setShowMobileDetails] = useState(false);

  const isLeadLocked = !!lead.is_lost_lead || lead.status === "Closing" || !!lead.closingDate;
  const isNGD = lead.status === "NON GENUINE DEMAND (NGD)" ||
    lead.leadStatus === "NON GENUINE DEMAND (NGD)" ||
    lead.leadInterestStatus === "NON GENUINE DEMAND (NGD)";
  const isActive = !lead.is_lost_lead && lead.status !== "Closing";
  const assignedTo = lead.assignedTo || lead.assigned_to;
  const createdBy = lead.created_by || lead.createdBy;

  const interestStatus = lead.leadInterestStatus;
  const isInterested = interestStatus === "Interested";
  const isNotInterested = interestStatus === "Not Interested";

  // Deal Progress Score
  const progress = useMemo(() => {
    if (!dealStageData) return computeDealProgress(0, false);
    return computeDealProgress(dealStageData.currentOrdinal, dealStageData.tracked);
  }, [dealStageData]);

  return (
    <div
      className={`sticky top-0 z-10 rounded-[14px] border shadow-sm flex-shrink-0 backdrop-blur-xl ${lead.is_lost_lead ? theme.cardLost : theme.card
        }`}
      style={theme.cardGlass}
    >
      <style>{`
        @keyframes lh-rise{from{opacity:0;transform:translate3d(0,6px,0)}to{opacity:1;transform:none}}
        @keyframes lh-slide{from{opacity:0;transform:translate3d(8px,0,0)}to{opacity:1;transform:none}}
        .lh-ring{animation:lh-rise 350ms ease-out backwards}
        .lh-actions>*{animation:lh-slide 300ms ease-out backwards;will-change:transform,opacity}
        .lh-actions>*:nth-child(1){animation-delay:80ms}
        .lh-actions>*:nth-child(2){animation-delay:120ms}
        .lh-actions>*:nth-child(3){animation-delay:160ms}
        .lh-actions>*:nth-child(4){animation-delay:200ms}
        .lh-actions>*:nth-child(5){animation-delay:240ms}
        .lh-actions>*:nth-child(6){animation-delay:280ms}
        .lh-meta>*{animation:lh-rise 300ms ease-out backwards;will-change:transform,opacity}
        .lh-meta>*:nth-child(1){animation-delay:120ms}
        .lh-meta>*:nth-child(2){animation-delay:150ms}
        .lh-meta>*:nth-child(3){animation-delay:180ms}
        .lh-meta>*:nth-child(4){animation-delay:210ms}
        .lh-meta>*:nth-child(5){animation-delay:240ms}
        .lh-meta>*:nth-child(6){animation-delay:270ms}
        .lh-meta>*:nth-child(7){animation-delay:300ms}
        .lh-meta>*:nth-child(8){animation-delay:330ms}
        .lh-meta>*>span:first-child{transition:transform .2s ease}
        .lh-meta>*:hover>span:first-child{transform:scale(1.1)}
        @media (prefers-reduced-motion:reduce){
          .lh-ring,.lh-actions>*,.lh-meta>*{animation:none}
        }
      `}</style>
      {/* == ROW 1: Score + Identity + Badges + Actions =================== */}
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 sm:px-4 sm:pt-4 sm:pb-3">
        {/* Left: back + score ring + identity */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className={`w-8 h-8 flex-shrink-0 flex items-center justify-center border rounded-full transition-all cursor-pointer shadow-sm active:scale-95 ${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-gray-50"}`}
          >
            <FaChevronLeft className="text-[11px] -ml-0.5" />
          </button>

          {/* Circular Deal Progress Score */}
          <ScoreRing progress={progress} isDark={isDark} animate={!!dealStageData} />

          <div className="min-w-0 flex flex-col justify-center">
            {/* Name line + badges */}
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <h1 className={`text-[15px] sm:text-[17px] font-bold truncate tracking-tight ${theme.text}`}>{lead.name}</h1>

              {/* Status badges */}
              {isActive && (
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider shadow-sm flex items-center gap-1 ${isDark ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  }`}><span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />Active</span>
              )}

              {/* Temperature badge */}
              <TemperatureBadge progress={progress} isDark={isDark} />

              {/* Owner badge */}
              {assignedTo && (
                <span className={`hidden sm:flex text-[9px] font-bold px-2 py-0.5 rounded-full border items-center gap-1 uppercase tracking-wider shadow-sm ${isDark ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                  <FaUserCheck className="text-[8px]" />
                  Owner: {assignedTo}
                </span>
              )}

              {isInterested && (
                <span className={`hidden md:inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border shadow-sm ${isDark ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-green-50 text-green-700 border-green-200"
                  }`}><FaThumbsUp className="text-[8px]" />Interested</span>
              )}
              {isNotInterested && (
                <span className={`hidden md:inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border shadow-sm ${isDark ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-red-50 text-red-700 border-red-200"
                  }`}><FaThumbsDown className="text-[8px]" />Not Interested</span>
              )}
              {lead.status === "Closing" && (
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 shadow-sm ${theme.statusClosing}`}>
                  <FaHandshake className="text-[9px]" /> Closing
                </span>
              )}
              {lead.is_lost_lead ? (
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 shadow-sm ${theme.statusLost}`}>
                  <FaEyeSlash className="text-[9px]" /> Lost
                </span>
              ) : isNGD ? (
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border shadow-sm flex items-center gap-1 ${theme.statusNGD}`}><FaBan className="text-[8px]" />NGD</span>
              ) : null}
              {isReturningLead && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider shadow-sm border-[rgba(5,150,105,0.45)] text-[#059669] bg-[rgba(5,150,105,0.12)]">
                  Revisit
                </span>
              )}
            </div>

            {/* Sub-line: creator + contact info */}
            <div className={`flex items-center gap-2.5 mt-0.5 text-[11px] sm:text-xs font-medium ${theme.textMuted} flex-wrap`}>
              {createdBy && (
                <span className="flex items-center gap-1.5" title="Originally created by">
                  <FaUserCircle className="text-[10px]" /> {createdBy}
                </span>
              )}
              <span className="flex items-center gap-1.5" title="Lead ID">
                <FaHashtag className="text-[10px]" /> {lead.sr_no || lead.id}
              </span>
              {lead.phone && (
                <span className="flex items-center gap-1.5" title="Phone">
                  <FaPhone className="text-[10px]" /> {lead.phone}
                </span>
              )}
              {lead.email && lead.email !== "N/A" && (
                <span className="hidden sm:flex items-center gap-1.5" title="Email">
                  <FaEnvelope className="text-[10px]" /> {lead.email}
                </span>
              )}
              {(lead.location && lead.location !== "N/A") && (
                <span className="hidden md:flex items-center gap-1.5" title="Location">
                  <FaMapMarkerAlt className="text-[10px]" /> {lead.location}
                </span>
              )}
              {lead.created_at && (
                <span className="hidden lg:flex items-center gap-1.5" title="Created">
                  <FaCalendarAlt className="text-[10px]" /> {formatDate(lead.created_at)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: actions + mobile toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Desktop actions */}
          <div className="lh-actions hidden sm:flex gap-1.5 flex-wrap justify-end">
            {bookingData ? (
              <ActionBtn icon={<FaEye />} label="View Booking" onClick={onOpenBookingView} className="bg-indigo-600 hover:bg-indigo-700 text-white" />
            ) : null}

            {isLeadLocked ? (
              <>
                <span className={`font-bold px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] ${theme.textFaint} border border-transparent`}>
                  Read Only
                </span>
                {lead.is_lost_lead && permissions.canRestoreLead && (
                  <ActionBtn icon={<FaExchangeAlt />} label="Restore Lead" onClick={onRestore} className={theme.btnWarning} />
                )}
                {lead.status === "Closing" && permissions.canReopenLead && (
                  <ActionBtn icon={<FaExchangeAlt />} label="Reopen Lead" onClick={onReopen} className={theme.btnWarning} />
                )}
              </>
            ) : (
              <>
                {permissions.canFillSalesform && (
                  <ActionBtn icon={<FaFileAlt />} label="Fill Salesform" onClick={onFillSalesform} className={theme.btnPrimary} />
                )}
                {permissions.canTrackLoan && (
                  <ActionBtn icon={<FaCoins />} label="Track Loan" onClick={onTrackLoan} className={theme.btnSecondary} />
                )}
                {permissions.canMarkClosing && (
                  <ActionBtn icon={<FaHandshake />} label="Mark Closing" onClick={onMarkClosing} className={theme.btnWarning} />
                )}
                {permissions.canMarkLost && (
                  <ActionBtn icon={<FaFlag />} label="Mark Lost" onClick={onOpenLostModal} className={theme.btnDanger} />
                )}
              </>
            )}

            {permissions.canDeleteLead && onDeleteLead && (
              <button
                onClick={onDeleteLead}
                title="Delete Lead"
                aria-label="Delete Lead"
                className="font-bold w-8 h-8 sm:w-9 sm:h-9 rounded-[10px] text-[13px] flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 text-red-500 hover:text-red-400 hover:bg-red-500/10 border border-black/5 dark:border-white/5 shadow-sm"
              >
                <FaTrashAlt />
              </button>
            )}

            {/* Divider before follow-ups */}
            {onFollowUps && (
              <>
                <div className={`hidden sm:block w-px h-6 mx-1 self-center ${isDark ? "bg-white/10" : "bg-black/10"}`} />
                <button
                  type="button"
                  onClick={onFollowUps}
                  title="Follow-ups"
                  aria-label="Follow-ups"
                  className="relative font-bold w-8 h-8 sm:h-9 sm:px-3.5 sm:w-auto rounded-[10px] text-xs flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer shadow-sm active:scale-95 bg-[#9E217B] hover:bg-[#b8268f] text-white border border-black/5 dark:border-white/5"
                >
                  <FaPencilAlt className="text-[12px] sm:text-[14px]" />
                  <span className="hidden sm:inline-block whitespace-nowrap">Follow-ups</span>
                  {(followUpCount ?? 0) > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 sm:static sm:-ml-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[9px] font-bold bg-green-500 text-white px-1 leading-none shadow-sm">
                      {followUpCount}
                    </span>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setShowMobileActions(!showMobileActions)}
            className={`sm:hidden w-8 h-8 flex-shrink-0 flex items-center justify-center border rounded-[10px] transition-all duration-200 shadow-sm active:scale-95 ${showMobileActions ? theme.btnPrimary : `${theme.textMuted} ${theme.tableBorder} ${isDark ? "bg-[#222] hover:bg-[#333]" : "bg-white hover:bg-gray-50"}`
              }`}
          >
            <FaChevronDown className={`text-[11px] transition-transform duration-300 ${showMobileActions ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Mobile actions row */}
      {showMobileActions && (
        <div className="flex gap-1.5 flex-wrap px-3 pb-3 sm:hidden animate-fadeIn">
          {bookingData ? (
            <ActionBtn icon={<FaEye />} label="Booking" onClick={onOpenBookingView} className="bg-indigo-600 hover:bg-indigo-700 text-white" />
          ) : null}
          {!isLeadLocked && (
            <>
              {permissions.canFillSalesform && <ActionBtn icon={<FaFileAlt />} label="Salesform" onClick={onFillSalesform} className={theme.btnPrimary} />}
              {permissions.canTrackLoan && <ActionBtn icon={<FaCoins />} label="Loan" onClick={onTrackLoan} className={theme.btnSecondary} />}
              {permissions.canMarkClosing && <ActionBtn icon={<FaHandshake />} label="Closing" onClick={onMarkClosing} className={theme.btnWarning} />}
              {permissions.canMarkLost && <ActionBtn icon={<FaFlag />} label="Lost" onClick={onOpenLostModal} className={theme.btnDanger} />}
            </>
          )}
          {isLeadLocked && lead.is_lost_lead && permissions.canRestoreLead && (
            <ActionBtn icon={<FaExchangeAlt />} label="Restore" onClick={onRestore} className={theme.btnWarning} />
          )}
          {isLeadLocked && lead.status === "Closing" && permissions.canReopenLead && (
            <ActionBtn icon={<FaExchangeAlt />} label="Reopen" onClick={onReopen} className={theme.btnWarning} />
          )}
          {onFollowUps && (
            <button
              type="button"
              onClick={onFollowUps}
              className="relative font-bold w-8 h-8 rounded-[10px] text-[13px] flex items-center justify-center gap-1.5 shadow-sm active:scale-95 bg-[#9E217B] hover:bg-[#b8268f] text-white border border-black/5 dark:border-white/5"
            >
              <FaPencilAlt />
              {(followUpCount ?? 0) > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[9px] font-bold bg-green-500 text-white px-1 shadow-sm">
                  {followUpCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* == ROW 2: Metadata grid ========================================= */}
      {/* Mobile details toggle */}
      <button
        type="button"
        onClick={() => setShowMobileDetails(!showMobileDetails)}
        aria-expanded={showMobileDetails}
        className={`sm:hidden w-full flex items-center justify-between px-3 py-2 border-t text-[11px] font-semibold uppercase tracking-wider cursor-pointer transition-colors ${theme.tableBorder} ${theme.textMuted}`}
      >
        <span>{showMobileDetails ? "Hide Details" : "Show Details"}</span>
        <FaChevronDown className={`text-[10px] transition-transform duration-300 ${showMobileDetails ? "rotate-180" : ""}`} />
      </button>

      {/* == ROW 2: Metadata grid (animated collapse on mobile) ========== */}
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out sm:grid-rows-[1fr] sm:opacity-100 ${showMobileDetails ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden min-h-0">
          <div className={`lh-meta grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-x-4 gap-y-4 px-3 pb-3 sm:px-4 sm:pb-4 sm:border-t pt-3 ${theme.tableBorder}`}>
            <MetaCell tone="indigo" icon={<FaBuilding />} label="Configuration" value={lead.propType || lead.configuration || "Pending"} isDark={isDark} theme={theme} />
            <MetaCell tone="emerald" icon={<FaWallet />} label="Budget" value={lead.salesBudget !== "Pending" ? lead.salesBudget : lead.budget} accent isDark={isDark} theme={theme} />
            <MetaCell tone="amber" icon={<FaCalendarAlt />} label="Timeline" value={lead.planningPurchase || "Pending"} isDark={isDark} theme={theme} />
            <MetaCell tone="sky" icon={<FaHome />} label="Use" value={lead.typeOfUse || lead.useType || "Pending"} isDark={isDark} theme={theme} />
            <MetaCell
              tone={isInterested ? "emerald" : isNotInterested ? "rose" : isNGD ? "amber" : "slate"}
              icon={isInterested ? <FaThumbsUp /> : isNotInterested ? <FaThumbsDown /> : isNGD ? <FaBan /> : <FaBullseye />}
              label="Interest"
              value={isInterested ? "Interested" : isNotInterested ? "Not Interested" : isNGD ? "NGD" : (interestStatus || "Pending")}
              isDark={isDark} theme={theme}
            />
            {assignedTo && <MetaCell tone="violet" icon={<FaUserCheck />} label="Owner" value={assignedTo} isDark={isDark} theme={theme} />}
            <MetaCell tone="pink" icon={<FaFlagCheckered />} label="Status" value={lead.status || "Assigned"} isDark={isDark} theme={theme} />
            <MetaCell tone="teal" icon={<FaCoins />} label="Loan" value={lead.loanPlanned || "Pending"} isDark={isDark} theme={theme} />
          </div>
        </div>

      </div>

      {/* == Revisit toggle (desktop) ===================================== */}
      {isReturningLead && onTogglePrevLead && (
        <div className={`px-3 pb-3 sm:px-4 sm:pb-4 border-t pt-3 ${theme.tableBorder}`}>
          <button
            type="button"
            onClick={onTogglePrevLead}
            disabled={isLoadingRevisit && !revisitHistory}
            className={`flex items-center justify-center gap-2 text-[11px] font-semibold px-4 py-1.5 rounded-full border transition-all duration-200 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-wait shadow-sm ${showPrevLead
              ? "border-[rgba(5,150,105,0.5)] text-[#059669] bg-[rgba(5,150,105,0.10)]"
              : `${theme.tableBorder} ${theme.textMuted} ${isDark ? "hover:bg-white/5" : "bg-white hover:bg-gray-50"}`
              }`}
          >
            {isLoadingRevisit && !revisitHistory ? "Loading\u2026" : `${showPrevLead ? "Hide" : "Show"} Previous Lead`}
          </button>
        </div>
      )}
    </div>
  );
}