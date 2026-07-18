"use client";
// LoanDealView.tsx — Read-only "Deal Loan Overview" for a lead.
// Two independent data sources, shown as one panel:
//   1. loan_updates  (informal loan tracking, keyed by lead — always available)
//   2. booking_applications loan/financial columns (formal deal terms, keyed by
//      booking — only available once the lead has a booking application)
import React, { useState, useEffect } from "react";
import {
  FaUniversity,
  FaCheck,
  FaClock,
  FaFileInvoiceDollar,
  FaIdCard,
  FaMoneyCheckAlt,
  FaHandHoldingUsd,
  FaFileSignature,
} from "react-icons/fa";
import { formatCurrencyDisplay } from "@/lib/currency";

interface LoanDealViewProps {
  lead: any;
  booking: any | null;
  loanUpdate: any | null;
  isDark?: boolean;
  t: any;
}


interface Tranche {
  id: number;
  lead_id: number;
  amount: string | number;
  status: string;
  bank_reference_no: string | null;
  remarks: string | null;
  added_by_name: string | null;
  added_by_role: string | null;
  created_at: string;
}

/* ────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────── */

function getLoanStatusColor(s: string, isDark: boolean) {
  const sl = (s || "").toLowerCase();
  if (sl === "approved")
    return isDark
      ? "bg-green-900/20 text-green-400 border-green-500/30"
      : "bg-green-50 text-green-700 border-green-300";
  if (sl === "rejected")
    return isDark
      ? "bg-red-900/20 text-red-400 border-red-500/30"
      : "bg-red-50 text-red-700 border-red-300";
  if (sl === "in progress" || sl === "under review" || sl === "submitted")
    return isDark
      ? "bg-amber-900/20 text-amber-400 border-amber-500/30"
      : "bg-amber-50 text-amber-700 border-amber-300";
  return isDark
    ? "bg-gray-800/40 text-gray-400 border-gray-600/30"
    : "bg-gray-50 text-gray-600 border-gray-300";
}

function formatDate(ds: string) {
  if (!ds) return "—";
  try {
    return new Date(ds).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ds;
  }
}

const safe = (v: any) => (v === null || v === undefined || v === "" ? "—" : String(v));

// Normalises the many ways "done" gets recorded across legacy rows
// (booleans, "Uploaded", "Verified", "Received", "Yes"…) into one signal.
function isDocDone(val: any) {
  if (!val) return false;
  const v = String(val).toLowerCase();
  return ["uploaded", "verified", "received", "yes", "true", "done"].includes(v);
}

// "Received" is the legacy label for what's now called "Completed" on
// disbursement tranches — old rows saved before the rename must still count.
function isTrancheCompleted(status: string) {
  return ["completed", "received"].includes((status || "").toLowerCase());
}

/* ────────────────────────────────────────────────────────────────────────
   Stage timeline
   Six stages mirror the reviewed workflow: Qualification → Documents →
   Processing → Sanction → Disbursement → Booking. Stage state is derived
   from actual data rather than hardcoded, so the indicator always reflects
   where the deal genuinely stands.
   ──────────────────────────────────────────────────────────────────────── */

type StageState = "done" | "current" | "pending";

function deriveStages(lu: any, hasDealData: boolean, src: any): { label: string; state: StageState }[] {
  const stages: { label: string; state: StageState }[] = [
    { label: "Qualification", state: "pending" },
    { label: "Documents", state: "pending" },
    { label: "Processing", state: "pending" },
    { label: "Sanction", state: "pending" },
    { label: "Disbursement", state: "pending" },
    { label: "Booking", state: "pending" },
  ];

  if (!lu) return stages;

  // 1. Qualification — done as soon as a loan_updates row exists.
  stages[0].state = "done";

  // 2. Documents — done when every tracked doc is complete.
  const docs = [lu.doc_pan, lu.doc_aadhaar, lu.doc_salary, lu.doc_bank, lu.doc_property];
  const docsDone = docs.filter(isDocDone).length;
  if (docsDone === docs.length) stages[1].state = "done";
  else if (docsDone > 0) stages[1].state = "current";
  else stages[1].state = stages[0].state === "done" ? "current" : "pending";

  // 3. Processing — reflects the informal status field.
  const statusL = (lu.status || "").toLowerCase();
  if (["approved", "rejected", "disbursing", "completed"].includes(statusL)) {
    stages[2].state = "done";
  } else if (statusL) {
    stages[2].state = "current";
  } else if (stages[1].state === "done") {
    stages[2].state = "current";
  }

  // 4. Sanction — based on deal-level sanction status if present.
  const sanctionStatus = (src?.sanction_status || "").toLowerCase();
  if (sanctionStatus === "sanctioned" || sanctionStatus === "approved") stages[3].state = "done";
  else if (sanctionStatus) stages[3].state = "current";
  else if (statusL === "approved") stages[3].state = "current";

  // 5. Disbursement
  const disbStatus = (src?.disbursement_status || "").toLowerCase();
  if (disbStatus === "completed" || disbStatus === "disbursed") stages[4].state = "done";
  else if (disbStatus || src?.disbursement_amount) stages[4].state = "current";
  else if (stages[3].state === "done") stages[4].state = "current";

  // 6. Booking — a booking_applications row existing is the signal.
  if (hasDealData && src?.token_amount) stages[5].state = "done";
  else if (hasDealData) stages[5].state = "current";

  return stages;
}

function StageTimeline({ stages, isDark, t }: { stages: { label: string; state: StageState }[]; isDark: boolean; t: any }) {
  return (
    <div className="mb-6 sm:mb-7 overflow-x-auto">
      <div className="flex items-center min-w-[560px] sm:min-w-0">
        {stages.map((stage, i) => {
          const isLast = i === stages.length - 1;
          const dotClasses =
            stage.state === "done"
              ? "bg-emerald-500 border-emerald-500 text-white"
              : stage.state === "current"
                ? isDark
                  ? "bg-amber-500/20 border-amber-400 text-amber-400"
                  : "bg-amber-50 border-amber-400 text-amber-600"
                : isDark
                  ? "bg-transparent border-gray-600 text-gray-600"
                  : "bg-white border-gray-300 text-gray-400";
          const lineClasses =
            stage.state === "done"
              ? "bg-emerald-500"
              : isDark
                ? "bg-gray-700"
                : "bg-gray-200";
          const labelClasses =
            stage.state === "pending"
              ? t.textFaint
              : stage.state === "current"
                ? isDark
                  ? "text-amber-400"
                  : "text-amber-600"
                : isDark
                  ? "text-emerald-400"
                  : "text-emerald-700";

          return (
            <React.Fragment key={stage.label}>
              <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ width: 92 }}>
                <div
                  className={`flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 text-[10px] font-bold transition-colors ${dotClasses}`}
                >
                  {stage.state === "done" ? <FaCheck className="text-[9px]" /> : i + 1}
                </div>
                <span className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-center leading-tight ${labelClasses}`}>
                  {stage.label}
                </span>
              </div>
              {!isLast && (
                <div className={`h-[2px] flex-1 -mt-4 ${lineClasses}`} style={{ minWidth: 20 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Small building blocks
   ──────────────────────────────────────────────────────────────────────── */

function SectionHeading({
  icon,
  children,
  isDark,
  badge,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  isDark: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <h4
      className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-3 sm:mb-4 flex items-center justify-between ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"
        }`}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {children}
      </span>
      {badge}
    </h4>
  );
}

function DraftBadge({ isDark }: { isDark: boolean }) {
  return (
    <span
      className={`normal-case font-semibold text-[10px] px-2 py-0.5 rounded-full border ${isDark
        ? "border-yellow-500/30 text-yellow-400 bg-yellow-900/20"
        : "border-yellow-300 text-yellow-700 bg-yellow-50"
        }`}
    >
      Draft — no booking yet
    </span>
  );
}

function Field({ label, val, t, emphasize }: { label: string; val: any; t: any; emphasize?: "green" | "orange" | null }) {
  const valueClass = emphasize === "green"
    ? "text-emerald-500 font-bold"
    : emphasize === "orange"
      ? "text-orange-500 font-bold"
      : `font-semibold ${t.text}`;
  return (
    <div>
      <p className={`text-[10px] sm:text-xs font-medium mb-1 ${t.textFaint}`}>{label}</p>
      <p className={valueClass}>{safe(val)}</p>
    </div>
  );
}

function TrancheHistory({ tranches, isDark, t }: { tranches: Tranche[]; isDark: boolean; t: any }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${t.textMuted} hover:text-[#00AEEF] transition-colors`}
      >
        <span className="transition-transform" style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        {expanded ? "Hide" : "View"} Tranche History ({tranches.length})
      </button>
      {expanded && (
        <div className={`mt-2 rounded-lg border overflow-hidden`}>
          <div className={`grid grid-cols-[36px_1fr_80px_80px_120px] text-[10px] font-bold uppercase tracking-wider px-3 py-2 border-b ${t.textMuted} ${isDark ? "bg-gray-800/50" : "bg-gray-50"}`}>
            <span>#</span><span>Amount</span><span>Status</span><span>Bank Ref</span><span>Date & Time</span>
          </div>
          {tranches.map((tr, idx) => (
            <div key={tr.id} className={`grid grid-cols-[36px_1fr_80px_80px_120px] text-xs px-3 py-2 items-center ${idx < tranches.length - 1 ? "border-b" : ""}`}>
              <span className={`font-bold ${t.textMuted}`}>{idx + 1}</span>
              <div>
                <span className={`font-semibold ${t.text}`}>₹{Number(tr.amount).toLocaleString("en-IN")}</span>
                {tr.remarks && <p className={`text-[9px] mt-0.5 ${t.textFaint}`}>{tr.remarks}</p>}
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border text-center ${isTrancheCompleted(tr.status) ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                  : tr.status === "Scheduled" ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
                    : "text-amber-400 border-amber-500/30 bg-amber-500/10"
                }`}>{tr.status}</span>
              <span className={`text-[10px] truncate ${t.textFaint}`}>{tr.bank_reference_no || "—"}</span>
              <span className={`text-[10px] ${t.textFaint}`}>
                {new Date(tr.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}{" "}
                {new Date(tr.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Main component
   ──────────────────────────────────────────────────────────────────────── */

export default function LoanDealView({ lead, booking, loanUpdate, isDark = false, t }: LoanDealViewProps) {
  const lu = loanUpdate;

  const [tranches, setTranches] = useState<Tranche[]>([]);
  useEffect(() => {
    if (!lead?.id) { setTranches([]); return; }
    fetch(`/api/walkin_enquiries/${lead.id}/tranches`)
      .then(r => r.json())
      .then(d => { if (d.success) setTranches(d.tranches); })
      .catch(() => { });
  }, [lead?.id]);

  const sColor = getLoanStatusColor(lu?.status || "", isDark);
  const isHighProb = lu?.status?.toLowerCase() === "approved" && lead?.mongoVisitDate;

  // Resolve the deal-level source (booking if it exists, otherwise the
  // lead-level draft saved by LoanDealForm before a booking is created).
  let draft: any = {};
  if (!booking) {
    try {
      draft =
        typeof lead?.loan_tracking_info === "string"
          ? JSON.parse(lead.loan_tracking_info)
          : lead?.loan_tracking_info || {};
    } catch {
      draft = {};
    }
  }
  const src = booking || draft;
  const hasDealData = Boolean(booking) || Object.keys(draft).length > 0;

  const tranchesTotal = tranches.filter(tr => isTrancheCompleted(tr.status)).reduce((sum, tr) => sum + Number(tr.amount || 0), 0);
  const totalDisbursed = tranches.length > 0 ? tranchesTotal : Number(src?.disbursement_amount || 0);
  const sanctionAmountNum = Number(src?.sanction_amount) || 0;
  const remaining = Math.max(0, sanctionAmountNum - totalDisbursed);
  const disbursementPercent = sanctionAmountNum > 0
    ? Math.min(100, Math.round((totalDisbursed / sanctionAmountNum) * 100))
    : 0;
  const isFullyDisbursed = disbursementPercent >= 100;
  const autoDisbursementStatus = sanctionAmountNum <= 0
    ? (src?.disbursement_status || "Pending")
    : isFullyDisbursed ? "Completed" : totalDisbursed > 0 ? "Partial" : "Pending";

  let charges: any[] = [];
  try {
    charges =
      typeof src?.custom_charges === "string" ? JSON.parse(src.custom_charges) : src?.custom_charges || [];
  } catch {
    charges = [];
  }

  const docs = [
    { label: "PAN Card", val: lu?.doc_pan },
    { label: "Aadhaar Card", val: lu?.doc_aadhaar },
    { label: "Salary Slip / ITR", val: lu?.doc_salary },
    { label: "Bank Statements", val: lu?.doc_bank },
    { label: "Property Documents", val: lu?.doc_property },
  ];
  const docsDoneCount = docs.filter((d) => isDocDone(d.val)).length;

  const stages = deriveStages(lu, hasDealData, src);

  return (
    <div>
      {/* ── Header ── */}
      <h3
        className={`text-xs sm:text-sm font-bold border-b pb-2 mb-5 sm:mb-6 uppercase flex items-center justify-between ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"
          } ${t.tableBorder}`}
      >
        <span className="flex items-center gap-2">
          <FaUniversity /> Deal Loan Overview
        </span>
        {lu && (
          <span className={`normal-case font-bold px-2 py-0.5 rounded border text-[10px] ${sColor}`}>
            {safe(lu.status)}
          </span>
        )}
      </h3>

      {isHighProb && (
        <div className="mb-5 sm:mb-6 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/50 p-2 sm:p-3 rounded-lg flex items-center justify-center gap-2 text-orange-400 text-xs sm:text-sm font-bold tracking-wide shadow-md text-center">
          🚀 HIGH PROBABILITY DEAL
        </div>
      )}

      {/* ── Progress timeline — visual state of the whole deal at a glance ── */}
      {lu && <StageTimeline stages={stages} isDark={isDark} t={t} />}

      {/* ── No loan tracking yet ── */}
      {!lu ? (
        <div
          className={`rounded-lg border border-dashed p-4 sm:p-5 text-center mb-6 ${isDark ? "border-gray-700 bg-gray-900/20" : "border-gray-300 bg-gray-50"
            }`}
        >
          <FaUniversity className={`mx-auto mb-2 text-lg ${t.textFaint}`} />
          <p className={`text-xs sm:text-sm italic ${t.textMuted}`}>
            No loan tracking data yet. Use "Track Loan" to log the first update.
          </p>
        </div>
      ) : (
        <>
          {/* ── Customer Financial Profile ── */}
          <div className="mb-6">
            <SectionHeading icon={<FaIdCard />} isDark={isDark}>
              Customer Financial Profile
            </SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-4 text-xs sm:text-sm">
              <Field label="Loan Required?" val={lu.loan_required} t={t} />
              <Field label="Employment Type" val={lu.emp_type} t={t} />
              <Field label="Monthly Income" val={lu.income} t={t} />
              <Field label="Existing EMIs" val={lu.emi} t={t} />
              <Field label="Approximate CIBIL Score" val={lu.cibil} t={t} />
              <Field label="Agent Contact Number" val={lu.agent_contact} t={t} />
            </div>
          </div>

          {/* ── Document checklist ── */}
          <div className="mb-6">
            <SectionHeading
              icon={<FaFileSignature />}
              isDark={isDark}
              badge={
                <span
                  className={`normal-case font-semibold text-[10px] px-2 py-0.5 rounded-full border ${docsDoneCount === docs.length
                    ? isDark
                      ? "border-emerald-500/30 text-emerald-400 bg-emerald-900/20"
                      : "border-emerald-300 text-emerald-700 bg-emerald-50"
                    : isDark
                      ? "border-gray-600 text-gray-400 bg-gray-800/40"
                      : "border-gray-300 text-gray-600 bg-gray-100"
                    }`}
                >
                  {docsDoneCount}/{docs.length} complete
                </span>
              }
            >
              Document Checklist
            </SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {docs.map((doc, i) => {
                const done = isDocDone(doc.val);
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-2.5 rounded-lg border ${t.innerBlock}`}
                  >
                    <span className={`text-[11px] sm:text-xs font-medium ${t.text}`}>{doc.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`text-[9px] sm:text-[10px] font-semibold ${done ? "text-emerald-500" : t.textFaint
                          }`}
                      >
                        {done ? safe(doc.val) : "Pending"}
                      </span>
                      {done ? (
                        <FaCheck className="text-emerald-500 text-[10px]" />
                      ) : (
                        <FaClock className={`text-[10px] ${t.textFaint}`} />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {lu.notes && (
            <div className={`mb-6 rounded-lg border p-3 ${t.innerBlock}`}>
              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1.5 ${t.textMuted}`}>
                Notes / Remarks
              </p>
              <p className={`text-xs sm:text-sm whitespace-pre-wrap ${t.text}`}>{lu.notes}</p>
            </div>
          )}
        </>
      )}

      {/* ── Bank Loan Details + Financial Details — sourced from booking once
           it exists, otherwise from the lead-level draft. ── */}
      <div className={`border-t pt-5 sm:pt-6 ${t.tableBorder}`}>
        <SectionHeading
          icon={<FaMoneyCheckAlt />}
          isDark={isDark}
          badge={!booking && hasDealData ? <DraftBadge isDark={isDark} /> : undefined}
        >
          Bank Loan Details
        </SectionHeading>

        {!hasDealData ? (
          <p className={`text-xs sm:text-sm italic mb-2 ${t.textMuted}`}>
            No loan/deal details yet. Use "Track Loan" to log them — they'll carry over to the Booking
            Form once the deal is marked as Closing.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-4 text-xs sm:text-sm mb-5">
              <Field label="Bank Name" val={src.bank_name} t={t} />
              <Field label="Loan Executive" val={src.loan_executive} t={t} />
              <Field label="Loan Type" val={src.loan_type} t={t} />
              <Field label="Loan Reference No." val={src.loan_reference_no} t={t} />
              <Field label="Requested Loan Amount" val={formatCurrencyDisplay(src.loan_amount)} t={t} />
              <Field label="Overall Loan Status" val={src.loan_status} t={t} />
            </div>

            {/* Sanction — grouped as its own visual block since it's a distinct
                milestone, and reads Requested vs Sanctioned side by side to
                avoid the "two amounts, unclear which is which" confusion. */}
            <div className={`rounded-lg border p-3 sm:p-3.5 mb-5 ${t.innerBlock}`}>
              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>
                Sanction
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-3 text-xs sm:text-sm">
                <Field label="Requested" val={formatCurrencyDisplay(src.loan_amount)} t={t} />
                <Field label="Sanctioned" val={formatCurrencyDisplay(src.sanction_amount)} t={t} emphasize="green" />
                <Field label="Sanction Date" val={formatDate(src.sanction_date)} t={t} />
                <Field label="Status" val={src.sanction_status} t={t} />
              </div>
            </div>

            {/* Disbursement */}
            <div className={`rounded-lg border p-3 sm:p-3.5 ${t.innerBlock}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
                  Disbursement
                </p>
                {sanctionAmountNum > 0 && (
                  isFullyDisbursed ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                      ✓ Fully Disbursed
                    </span>
                  ) : totalDisbursed > 0 ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#00AEEF]/10 text-[#00AEEF] border border-[#00AEEF]/30">
                      {disbursementPercent}% Completed
                    </span>
                  ) : null
                )}
              </div>

              {/* Progress bar */}
              {sanctionAmountNum > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className={t.textMuted}>Total Disbursed</span>
                    <span className={`font-bold ${t.text}`}>
                      ₹{totalDisbursed.toLocaleString("en-IN")} / ₹{sanctionAmountNum.toLocaleString("en-IN")} ({disbursementPercent}%)
                    </span>
                  </div>
                  <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? "bg-gray-700" : "bg-gray-200"}`}>
                    <div
                      className={`h-full transition-all duration-500 ${isFullyDisbursed ? "bg-emerald-500" : "bg-[#00AEEF]"}`}
                      style={{ width: `${disbursementPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Summary: Sanctioned / Disbursed / Remaining */}
              {sanctionAmountNum > 0 && (
                <div className="grid grid-cols-3 gap-2 text-center mb-4">
                  <div className={`rounded-lg border p-2 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                    <p className={`text-[9px] uppercase tracking-wider mb-0.5 ${t.textFaint}`}>Sanctioned</p>
                    <p className={`text-xs font-bold ${t.text}`}>₹{sanctionAmountNum.toLocaleString("en-IN")}</p>
                  </div>
                  <div className={`rounded-lg border p-2 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                    <p className={`text-[9px] uppercase tracking-wider mb-0.5 ${t.textFaint}`}>Disbursed</p>
                    <p className="text-xs font-bold text-[#00AEEF]">₹{totalDisbursed.toLocaleString("en-IN")}</p>
                  </div>
                  <div className={`rounded-lg border p-2 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                    <p className={`text-[9px] uppercase tracking-wider mb-0.5 ${t.textFaint}`}>Remaining</p>
                    <p className={`text-xs font-bold ${isFullyDisbursed ? "text-emerald-500" : "text-orange-500"}`}>
                      ₹{remaining.toLocaleString("en-IN")}
                    </p>
                  </div>
                </div>
              )}

              {/* Expected vs Actual */}
              <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm mb-4">
                <div className={`rounded-lg border p-2.5 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                  <p className={`text-[9px] uppercase tracking-wider mb-1 ${t.textFaint}`}>Expected</p>
                  <p className={`font-semibold ${t.text}`}>{formatDate(src.expected_disbursement_date)}</p>
                  <p className={`text-xs ${t.textMuted}`}>{formatCurrencyDisplay(src.expected_disbursement_amount)}</p>
                </div>
                <div className={`rounded-lg border p-2.5 ${isDark ? "border-gray-700" : "border-gray-200"}`}>
                  <p className={`text-[9px] uppercase tracking-wider mb-1 ${t.textFaint}`}>Actual (Latest)</p>
                  <p className={`font-semibold ${t.text}`}>
                    {tranches.length > 0
                      ? new Date(tranches[tranches.length - 1].created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                      : formatDate(src.actual_disbursement_date)}
                  </p>
                  <p className="text-xs text-[#00AEEF] font-semibold">₹{totalDisbursed.toLocaleString("en-IN")}</p>
                </div>
              </div>

              {/* Status + Tranche count */}
              <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
                <Field label="Status" val={autoDisbursementStatus} t={t} />
                {tranches.length > 0 && <Field label="Tranches" val={tranches.length} t={t} />}
              </div>

              {/* Tranche History — collapsible */}
              {tranches.length > 0 && (
                <TrancheHistory tranches={tranches} isDark={isDark} t={t} />
              )}
            </div>

          </>
        )}
      </div>

      {/* ── Registration & Booking Financials ── */}
      {hasDealData && (
        <div className={`border-t pt-5 sm:pt-6 mt-6 ${t.tableBorder}`}>
          <SectionHeading
            icon={<FaHandHoldingUsd />}
            isDark={isDark}
            badge={!booking ? <DraftBadge isDark={isDark} /> : undefined}
          >
            Registration &amp; Booking Financials
          </SectionHeading>

          <div className="space-y-3">
            {/* Token */}
            <div className={`rounded-lg border p-3 sm:p-3.5 ${t.innerBlock}`}>
              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>
                Token
              </p>
              <Field label="Token Amount" val={formatCurrencyDisplay(src.token_amount)} t={t} emphasize="green" />
            </div>

            {/* OCR */}
            <div className={`rounded-lg border p-3 sm:p-3.5 ${t.innerBlock}`}>
              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>
                OCR
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-3 text-xs sm:text-sm">
                <Field label="Amount" val={formatCurrencyDisplay(src.ocr_amount)} t={t} emphasize="green" />
                <Field label="Received Date" val={formatDate(src.ocr_received_date)} t={t} />
                <Field label="Payment Mode" val={src.ocr_payment_mode} t={t} />
              </div>
              {src.ocr_remarks && (
                <div className="mt-3">
                  <Field label="Remarks" val={src.ocr_remarks} t={t} />
                </div>
              )}
            </div>

            {/* SDR */}
            <div className={`rounded-lg border p-3 sm:p-3.5 ${t.innerBlock}`}>
              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>
                SDR
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-3 text-xs sm:text-sm">
                <Field label="Amount" val={formatCurrencyDisplay(src.sdr_amount)} t={t} emphasize="green" />
                <Field label="Payment Date" val={formatDate(src.sdr_payment_date)} t={t} />
                <Field label="Status" val={src.sdr_status} t={t} />
              </div>
              {src.sdr_remarks && (
                <div className="mt-3">
                  <Field label="Remarks" val={src.sdr_remarks} t={t} />
                </div>
              )}
            </div>

            {/* Cash component */}
            <div className={`rounded-lg border p-3 sm:p-3.5 ${t.innerBlock}`}>
              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>
                Cash Component
              </p>
              <div className="grid grid-cols-2 gap-y-3 gap-x-3 text-xs sm:text-sm">
                <Field label="Amount" val={formatCurrencyDisplay(src.cash_component)} t={t} emphasize="green" />
                <Field label="Payment Date" val={formatDate(src.cash_component_date)} t={t} />
              </div>
              {src.cash_component_remarks && (
                <div className="mt-3">
                  <Field label="Remarks" val={src.cash_component_remarks} t={t} />
                </div>
              )}
            </div>

            {charges.length > 0 && (
              <div className={`rounded-lg border p-3 sm:p-3.5 ${t.innerBlock}`}>
                <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-2.5 ${t.textMuted}`}>
                  Custom Charges
                </p>
                <div className="space-y-1.5">
                  {charges.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs sm:text-sm">
                      <span className={t.text}>{safe(c.charge_name)}</span>
                      <span className={`font-semibold ${t.text}`}>{formatCurrencyDisplay(c.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}