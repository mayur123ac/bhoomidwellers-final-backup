"use client";
// EditCommissionModal.tsx — admin correction of a recorded commission.
//
// The case this exists for: a sales manager records a booking at the wrong rate
// (3% instead of 2%). The admin corrects it here, either by re-applying the right
// percentage or by typing the exact amount.
//
// The whole gross -> TDS -> net chain is recomputed server-side in NUMERIC, and
// TDS is re-decided against the partner's FY total excluding this row. Editing is
// blocked for paid and reversed commissions — see the engine for why.
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaExclamationTriangle } from "react-icons/fa";
import { formatCurrencyDecimal } from "@/lib/currency";
import { validateRate } from "./ChannelPartnerFormModal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  commission: any | null;
  partnerRate: string | null;
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
}

export default function EditCommissionModal({
  isOpen, onClose, onSaved, commission, partnerRate, user, isDark, t,
}: Props) {
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  useEffect(() => {
    if (!isOpen || !commission) return;
    // Seed with the rate this row was computed at, so the admin can see what is
    // being corrected rather than typing into an empty box.
    setMode(commission.is_override ? "amount" : "percent");
    setRate(commission.commission_rate_percent ?? partnerRate ?? "");
    setAmount(commission.gross_commission_amount ?? "");
    setReason("");
    setError(null);
  }, [isOpen, commission, partnerRate]);

  if (!commission) return null;

  const rateError = mode === "percent" ? validateRate(rate) : null;
  const amountError =
    mode === "amount" && (amount.trim() === "" || Number.isNaN(Number(amount)) || Number(amount) < 0)
      ? "Enter a valid amount."
      : null;
  const canSubmit = !busy && !rateError && !amountError;

  const agreement = commission.agreement_value;
  // Client-side echo only — the server recomputes in NUMERIC and is authoritative.
  const projected =
    mode === "percent" && !rateError && agreement && Number(agreement) > 0 && rate.trim() !== ""
      ? (Number(agreement) * Number(rate) / 100).toFixed(2)
      : mode === "amount" && !amountError ? Number(amount).toFixed(2) : null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/cp-commissions/${commission.id}/recalculate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "percent" ? { ratePercent: Number(rate) } : { grossAmount: Number(amount) }),
          reason: reason.trim() || undefined,
          user_name: user.name, user_role: user.role, updated_by: user.name,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.message || "Could not update commission."); return; }
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Network error.");
    } finally { setBusy(false); }
  };

  const tabCls = (active: boolean) =>
    `flex-1 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer text-center transition-colors ${
      active ? t.btnPrimary : `${t.textMuted} ${isDark ? "bg-[#1a1a1a]" : "bg-slate-100"}`
    }`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl p-6 ${t.modalCard || t.card}`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className={`text-lg font-bold ${t.text}`}>Edit Commission</h2>
                <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>
                  {commission.booking_number || `Booking #${commission.booking_id}`}
                  {" · currently "}
                  <strong className={t.text}>{formatCurrencyDecimal(commission.gross_commission_amount)}</strong>
                  {commission.commission_rate_percent && Number(commission.commission_rate_percent) > 0
                    ? ` at ${commission.commission_rate_percent}%` : ""}
                </p>
              </div>
              <button onClick={onClose} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}><FaTimes /></button>
            </div>

            <div className="flex gap-2 mb-4">
              <div className={tabCls(mode === "percent")} onClick={() => setMode("percent")}>By percentage</div>
              <div className={tabCls(mode === "amount")} onClick={() => setMode("amount")}>By amount</div>
            </div>

            {mode === "percent" ? (
              <div>
                <label className={labelCls}>Commission Rate (%)</label>
                <input value={rate} onChange={e => setRate(e.target.value)}
                  className={`${inputCls} ${rateError ? "border-red-500" : ""}`} placeholder="e.g. 2" />
                {rateError
                  ? <p className="text-[10px] mt-1 text-red-500">{rateError}</p>
                  : <p className={`text-[10px] mt-1 ${t.textFaint}`}>
                      Applied to this booking&apos;s agreement value of {formatCurrencyDecimal(agreement)}.
                    </p>}
              </div>
            ) : (
              <div>
                <label className={labelCls}>Commission Amount (₹)</label>
                <input value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${inputCls} ${amountError ? "border-red-500" : ""}`} placeholder="e.g. 126000" />
                {amountError
                  ? <p className="text-[10px] mt-1 text-red-500">{amountError}</p>
                  : <p className={`text-[10px] mt-1 ${t.textFaint}`}>Recorded as an override for this booking only.</p>}
              </div>
            )}

            <div className="mt-4">
              <label className={labelCls}>Reason {mode === "amount" ? "" : "(optional)"}</label>
              <input value={reason} onChange={e => setReason(e.target.value)}
                className={inputCls} placeholder="e.g. rate was entered as 3%, corrected to 2%" />
            </div>

            {projected && (
              <div className={`mt-4 rounded-lg px-3 py-2 text-xs ${isDark ? "bg-[#151515]" : "bg-slate-50"}`}>
                <div className="flex justify-between">
                  <span className={t.textMuted}>New gross</span>
                  <span className={`font-bold ${t.text}`}>{formatCurrencyDecimal(projected)}</span>
                </div>
                <p className={`text-[10px] mt-1 ${t.textFaint}`}>
                  TDS and net payable are recalculated on save, against this partner&apos;s
                  financial-year total excluding this entry.
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                <FaExclamationTriangle className="mt-0.5 flex-shrink-0 text-[10px]" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={onClose} className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted}`}>Cancel</button>
              <button onClick={handleSubmit} disabled={!canSubmit}
                className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary} ${!canSubmit ? "opacity-50 cursor-not-allowed" : ""}`}>
                {busy ? "Saving..." : "Save & recalculate"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
