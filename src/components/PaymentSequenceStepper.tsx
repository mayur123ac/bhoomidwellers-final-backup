"use client";
// PaymentSequenceStepper.tsx — Phase 7: a soft, data-driven guide through the
// real-estate payment timeline. Completion is auto-detected from the booking's
// actual data; out-of-order progress is surfaced as a non-blocking advisory.
import React from "react";
import { FaCheck } from "react-icons/fa";

interface PaymentSequenceStepperProps {
  booking: any;
  isDark?: boolean;
}

function num(v: any): number {
  const n = parseFloat(String(v ?? "").replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}
function hasVal(v: any): boolean {
  return !!v && v !== "null" && v !== "undefined";
}

interface SeqStep {
  key: string;
  name: string;
  section: string;      // element id to scroll to
  applicable: boolean;  // false → not part of this booking's path (e.g. loan steps when no loan)
  done: boolean;
}

export default function PaymentSequenceStepper({ booking, isDark = false }: PaymentSequenceStepperProps) {
  const loanRequired = !!booking.loan_required;

  let milestones: any[] = [];
  try { milestones = typeof booking.payment_milestones === "string" ? JSON.parse(booking.payment_milestones) : (booking.payment_milestones || []); } catch { milestones = []; }
  // Construction-stage payments = any milestone beyond Booking/Agreement (order > 2) with money paid.
  const constructionPaid = milestones.some((m: any) => Number(m.milestone_order) > 2 && num(m.paid_amount) > 0);

  const steps: SeqStep[] = [
    { key: "token", name: "Token", section: "sec-financials", applicable: true, done: num(booking.token_amount) > 0 },
    { key: "booking", name: "Booking", section: "sec-financials", applicable: true, done: num(booking.booking_amount) > 0 },
    { key: "agreement", name: "Agreement", section: "sec-financials", applicable: true, done: num(booking.agreement_value) > 0 },
    { key: "ocr", name: "OCR", section: "sec-financials", applicable: true, done: hasVal(booking.ocr_received_date) || num(booking.ocr_amount) > 0 },
    { key: "sanction", name: "Sanction", section: "sec-loan", applicable: loanRequired, done: booking.sanction_status === "Approved" || num(booking.sanction_amount) > 0 },
    { key: "stamp", name: "Stamp Duty", section: "sec-financials", applicable: true, done: booking.stamp_duty_status === "Paid" || booking.sdr_status === "Paid" },
    { key: "registration", name: "Registration", section: "sec-registration", applicable: true, done: booking.registration_status === "Completed" || hasVal(booking.actual_registration_date) },
    { key: "disbursement", name: "Disbursement", section: "sec-loan", applicable: loanRequired, done: ["Completed", "Partial"].includes(booking.disbursement_status) || num(booking.disbursement_amount) > 0 || hasVal(booking.actual_disbursement_date) },
    { key: "milestones", name: "Construction", section: "sec-milestones", applicable: milestones.length > 0, done: constructionPaid },
    { key: "possession", name: "Possession", section: "sec-possession", applicable: true, done: ["Possession Given", "Occupied"].includes(booking.possession_status) || hasVal(booking.actual_possession_date) },
  ];

  const applicable = steps.filter(s => s.applicable);
  const firstPendingKey = applicable.find(s => !s.done)?.key;

  // Out-of-sequence: a completed step preceded by an earlier applicable step that is NOT complete.
  const outOfSequence: string[] = [];
  for (let i = 0; i < applicable.length; i++) {
    if (!applicable[i].done) continue;
    const earlierPending = applicable.slice(0, i).find(s => !s.done);
    if (earlierPending) outOfSequence.push(`${applicable[i].name} recorded before ${earlierPending.name}`);
  }

  const scrollTo = (id: string) => {
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const textMuted = isDark ? "text-[#888899]" : "text-[#6B7280]";
  const accent = isDark ? "text-[#d4006e]" : "text-[#9E217B]";
  const cardBg = isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]";

  const dotStyles = (s: SeqStep) => {
    if (s.done) return isDark ? "bg-green-500 border-green-500 text-white" : "bg-green-500 border-green-500 text-white";
    if (s.key === firstPendingKey) return isDark ? "bg-amber-500/20 border-amber-500 text-amber-400" : "bg-amber-50 border-amber-400 text-amber-600";
    return isDark ? "bg-[#14141B] border-[#2A2A35] text-[#555]" : "bg-[#F1F5F9] border-[#D1D5DB] text-[#9CA3AF]";
  };
  const labelStyles = (s: SeqStep) => {
    if (s.done) return "text-green-500";
    if (s.key === firstPendingKey) return isDark ? "text-amber-400" : "text-amber-600";
    return textMuted;
  };

  return (
    <div className={`rounded-2xl border p-5 ${cardBg}`}>
      <p className={`text-xs font-bold uppercase tracking-wider mb-4 ${accent}`}>Payment Sequence</p>

      <div className="overflow-x-auto pb-1">
        <div className="flex items-start min-w-max">
          {applicable.map((s, i) => (
            <div key={s.key} className="flex items-start">
              <button
                type="button"
                onClick={() => scrollTo(s.section)}
                className="flex flex-col items-center gap-1.5 cursor-pointer group px-1"
                title={`Go to ${s.name}`}
                style={{ minWidth: 70 }}
              >
                <span className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-bold transition-transform group-hover:scale-110 ${dotStyles(s)}`}>
                  {s.done ? <FaCheck className="text-[10px]" /> : i + 1}
                </span>
                <span className={`text-[10px] font-semibold text-center leading-tight ${labelStyles(s)}`}>{s.name}</span>
              </button>
              {i < applicable.length - 1 && (
                <span className={`h-[2px] w-6 sm:w-10 mt-4 flex-shrink-0 ${s.done ? "bg-green-500" : (isDark ? "bg-[#2A2A35]" : "bg-[#E5E7EB]")}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className={`flex items-center gap-4 mt-3 text-[10px] ${textMuted}`}>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> Completed</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full border-2 border-amber-400 inline-block" /> In progress</span>
        <span className="flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full inline-block ${isDark ? "bg-[#2A2A35]" : "bg-[#E5E7EB]"}`} /> Upcoming</span>
      </div>

      {/* Soft, non-blocking out-of-sequence advisory */}
      {outOfSequence.length > 0 && (
        <div className={`mt-4 rounded-lg px-3 py-2 text-xs flex items-start gap-2 border ${isDark ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-amber-50 border-amber-300 text-amber-700"}`}>
          <span>⚠</span>
          <span>
            <strong>Out-of-sequence note:</strong> {outOfSequence.join("; ")}. This is unusual but allowed — real-world
            payments sometimes arrive out of order. No action required.
          </span>
        </div>
      )}
    </div>
  );
}
