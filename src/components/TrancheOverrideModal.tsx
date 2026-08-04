"use client";
/* ══════════════════════════════════════════════════════════════════════════
   TrancheOverrideModal.tsx — Phase 6.

   The admin-facing half of the one audited override in the system. It exists to
   make the weight of the action visible: the issues being bypassed are shown,
   the reason is mandatory and long enough to be a sentence, and the screen says
   plainly that the decision is logged under the admin's name.

   The 20-character minimum here is UX. The API enforces it independently — a
   request that skips this form is rejected just the same.
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useState } from "react";
import { FaExclamationTriangle, FaChevronRight, FaTimes } from "react-icons/fa";
import IndianCurrencyInput from "@/components/IndianCurrencyInput";
import type { FinancialObligation } from "@/lib/financialObligationEngine";

const MIN_REASON_LENGTH = 20;

interface Props {
  bookingId: number | string;
  obligation: FinancialObligation;
  isDark?: boolean;
  t: any;
  onSuccess: (result: { adjustmentId: number; trancheId: number }) => void;
  onClose: () => void;
}

export default function TrancheOverrideModal({
  bookingId, obligation, isDark = false, t, onSuccess, onClose,
}: Props) {
  const [amount, setAmount] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonLength = reason.trim().length;
  const reasonOk = reasonLength >= MIN_REASON_LENGTH;
  const canSubmit = reasonOk && Number(String(amount).replace(/[₹,\s]/g, "")) > 0 && !submitting;

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const labelCls = `text-xs mb-1 block ${t.textMuted}`;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/booking-applications/${bookingId}/tranche-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: String(amount).replace(/[₹,\s]/g, ""),
          expected_date: expectedDate || null,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 403) {
        setError("You do not have permission to perform overrides");
        return;
      }
      if (!res.ok || !json?.success) {
        setError(json?.message || json?.error || `Request failed (HTTP ${res.status})`);
        return;
      }
      onSuccess({ adjustmentId: json.adjustmentId, trancheId: json.trancheId });
    } catch (e: any) {
      setError(e?.message || "Network error while submitting override");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[240] flex items-start justify-center p-4 overflow-y-auto bg-black/75" style={{ backdropFilter: "blur(6px)" }}>
      <div className={`w-full max-w-lg my-8 rounded-2xl border shadow-2xl ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]"}`}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-red-500/30 bg-red-500/10 rounded-t-2xl">
          <h3 className="text-sm font-bold flex items-center gap-2 text-red-400">
            <FaExclamationTriangle /> Admin Disbursement Override
          </h3>
          <button type="button" onClick={onClose} className={`p-1 ${t.textMuted} hover:text-red-500`}>
            <FaTimes className="text-xs" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className={`text-[11px] leading-relaxed ${t.textMuted}`}>
            This booking has active financial integrity issues. This override will be permanently
            logged with your name, role, timestamp, and the current financial state.
          </p>

          <div>
            <button
              type="button"
              onClick={() => setShowIssues(v => !v)}
              className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}
            >
              <FaChevronRight className={`text-[9px] transition-transform ${showIssues ? "rotate-90" : ""}`} />
              Show current issues ({obligation.validationErrors.length})
            </button>
            {showIssues && (
              <div className="mt-2 space-y-1.5">
                {obligation.validationErrors.map((e, i) => (
                  <p key={`${e.code}-${i}`} className={`text-[10px] ${e.severity === "critical" ? "text-red-400" : e.severity === "error" ? "text-orange-400" : "text-yellow-500"}`}>
                    [{e.code}] {e.message}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tranche Amount *</label>
              <IndianCurrencyInput value={amount} onChange={setAmount} className={inputCls} placeholder="Amount" />
            </div>
            <div>
              <label className={labelCls}>Expected Date</label>
              <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Reason (required)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Explain why this disbursement must proceed despite the integrity issues above."
              className={`${inputCls} resize-none`}
            />
            <p className={`text-[10px] mt-1 ${reasonOk ? "text-emerald-500" : t.textMuted}`}>
              {reasonLength} / {MIN_REASON_LENGTH} minimum
            </p>
          </div>

          <div>
            <label className={labelCls}>Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-400">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button type="button" onClick={onClose} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="text-xs font-bold px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting…" : "Confirm Override →"}
            </button>
          </div>

          <p className={`text-[10px] text-center ${t.textFaint}`}>This action is irreversible and audited.</p>
        </div>
      </div>
    </div>
  );
}
