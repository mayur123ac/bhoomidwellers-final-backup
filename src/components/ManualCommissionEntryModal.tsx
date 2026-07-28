"use client";
// ManualCommissionEntryModal.tsx — CP Commission Phase 4.
//
// Records a commission against a booking by hand. Two modes:
//   • calculated — gross comes from agreement_value * the partner's rate
//   • override   — the user types the gross directly, and must say why
//
// The preview panel calls the same engine code the commit will run
// (previewCPCommission -> evaluateCommission), so the numbers shown are the
// numbers written. That includes the FY threshold decision: a manual entry counts
// toward the same cumulative total as an auto one, so the preview will show TDS
// switching on mid-entry if this commission is the one that crosses ₹20,000.
import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import { formatCurrencyDecimal } from "@/lib/currency";

interface EligibleBooking {
  id: number;
  booking_number: string | null;
  agreement_value: string | null;
  buyer_name: string | null;
}

interface Preview {
  bookingId: number;
  cpName: string;
  agreementValue: string | null;
  commissionRatePercent: string | null;
  gross: string;
  priorCumulative: string;
  cumulativeAfter: string;
  crossed: boolean;
  tdsPercent: number;
  tdsAmount: string;
  netPayable: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  partnerId: number;
  partnerName: string;
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
}

export default function ManualCommissionEntryModal({
  isOpen, onClose, onSaved, partnerId, partnerName, user, isDark, t,
}: Props) {
  const [bookings, setBookings] = useState<EligibleBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingId, setBookingId] = useState<string>("");
  const [useOverride, setUseOverride] = useState(false);
  const [overrideGross, setOverrideGross] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  useEffect(() => {
    if (!isOpen) return;
    setBookingId(""); setUseOverride(false); setOverrideGross(""); setOverrideReason("");
    setPreview(null); setPreviewError(null); setError(null);

    (async () => {
      setLoadingBookings(true);
      try {
        const res = await fetch(`/api/channel-partners/${partnerId}/eligible-bookings`);
        const json = await res.json();
        if (json.success) setBookings(json.data);
      } catch { /* non-blocking */ } finally { setLoadingBookings(false); }
    })();
  }, [isOpen, partnerId]);

  // Re-preview whenever anything affecting the numbers changes. Debounced so
  // typing an override amount doesn't fire a request per keystroke.
  const runPreview = useCallback(async () => {
    if (!bookingId) { setPreview(null); setPreviewError(null); return; }
    if (useOverride && String(overrideGross).trim() === "") { setPreview(null); setPreviewError(null); return; }

    setPreviewing(true); setPreviewError(null);
    try {
      const res = await fetch("/api/cp-commissions/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: Number(bookingId),
          ...(useOverride ? { overrideGross: Number(overrideGross) } : {}),
        }),
      });
      const json = await res.json();
      if (json.success) { setPreview(json.data); setPreviewError(null); }
      else { setPreview(null); setPreviewError(json.message || "Preview failed."); }
    } catch (e: any) {
      setPreview(null); setPreviewError(e.message || "Preview failed.");
    } finally { setPreviewing(false); }
  }, [bookingId, useOverride, overrideGross]);

  useEffect(() => {
    const id = setTimeout(runPreview, 250);
    return () => clearTimeout(id);
  }, [runPreview]);

  const reasonMissing = useOverride && !overrideReason.trim();
  const canSubmit = !busy && !!bookingId && !!preview && !reasonMissing;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/cp-commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: Number(bookingId),
          source: "manual",
          ...(useOverride ? { overrideGross: Number(overrideGross), overrideReason: overrideReason.trim() } : {}),
          user_name: user.name,
          user_role: user.role,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.message || "Save failed."); return; }
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e.message || "Network error.");
    } finally { setBusy(false); }
  };

  const money = (v: string | null | undefined) => formatCurrencyDecimal(v ?? null);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 ${t.modalCard || t.card}`}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className={`text-lg font-bold ${t.text}`}>Add Commission</h2>
                <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>{partnerName}</p>
              </div>
              <button onClick={onClose} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}><FaTimes /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>Booking *</label>
                <select value={bookingId} onChange={e => setBookingId(e.target.value)} className={`${inputCls} cursor-pointer`}>
                  <option value="">
                    {loadingBookings ? "Loading..." : bookings.length === 0 ? "No eligible bookings" : "Select a booking"}
                  </option>
                  {bookings.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.booking_number || `Booking #${b.id}`}
                      {b.buyer_name ? ` — ${b.buyer_name}` : ""}
                      {b.agreement_value ? ` (${formatCurrencyDecimal(b.agreement_value)})` : ""}
                    </option>
                  ))}
                </select>
                {!loadingBookings && bookings.length === 0 && (
                  <p className={`text-[10px] mt-1 ${t.textFaint}`}>
                    Every booking for this partner already has an active commission. Reverse one to record it again.
                  </p>
                )}
              </div>

              <label className={`flex items-center gap-2 cursor-pointer ${t.text}`}>
                <input type="checkbox" checked={useOverride} onChange={e => setUseOverride(e.target.checked)} className="cursor-pointer" />
                <span className="text-xs font-medium">Override the calculated amount</span>
              </label>

              {useOverride && (
                <div className={`rounded-xl p-4 border space-y-3 ${isDark ? "bg-amber-500/5 border-amber-500/25" : "bg-amber-50 border-amber-200"}`}>
                  <div>
                    <label className={labelCls}>Gross Commission Amount *</label>
                    <input type="text" inputMode="decimal" value={overrideGross}
                      onChange={e => setOverrideGross(e.target.value)}
                      className={inputCls} placeholder="e.g. 15000" />
                    <p className={`text-[10px] mt-1 ${t.textFaint}`}>
                      Replaces the rate calculation. TDS is still derived from this amount and the partner&apos;s FY total.
                    </p>
                  </div>
                  <div>
                    <label className={labelCls}>Reason for override *</label>
                    <textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                      rows={2}
                      className={`${inputCls} ${reasonMissing && overrideGross ? "border-red-500" : ""}`}
                      placeholder="Why does this differ from the calculated amount?" />
                    {reasonMissing && overrideGross && (
                      <p className="text-[10px] mt-1 text-red-500">A reason is required when overriding.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Live preview — same code path as commit. */}
              <div className={`rounded-xl p-4 border ${isDark ? "bg-[#151515] border-[#2a2a2a]" : "bg-slate-50 border-slate-200"}`}>
                <div className="flex items-center gap-2 mb-3">
                  <FaInfoCircle className={`text-[11px] ${t.accentText}`} />
                  <p className={`text-xs font-bold ${t.accentText}`}>Preview</p>
                  {previewing && <span className={`text-[10px] ${t.textFaint}`}>calculating...</span>}
                </div>

                {previewError && <p className="text-xs text-red-500">{previewError}</p>}
                {!previewError && !preview && (
                  <p className={`text-xs ${t.textFaint}`}>
                    {bookingId ? "Enter an amount to preview." : "Select a booking to preview the commission."}
                  </p>
                )}

                {preview && (
                  <div className="space-y-1.5 text-xs">
                    {!useOverride && (
                      <Row t={t} k="Agreement value × rate"
                        v={`${money(preview.agreementValue)} × ${preview.commissionRatePercent ?? "—"}%`} />
                    )}
                    <Row t={t} k="Gross commission" v={money(preview.gross)} bold />
                    <div className={`my-2 border-t ${isDark ? "border-[#2a2a2a]" : "border-slate-200"}`} />
                    <Row t={t} k="Partner's FY total so far" v={money(preview.priorCumulative)} />
                    <Row t={t} k="FY total incl. this" v={money(preview.cumulativeAfter)} />
                    <Row t={t} k="TDS" v={`${preview.tdsPercent}% — ${money(preview.tdsAmount)}`} />
                    <div className={`my-2 border-t ${isDark ? "border-[#2a2a2a]" : "border-slate-200"}`} />
                    <Row t={t} k="Net payable" v={money(preview.netPayable)} bold />

                    {preview.crossed && (
                      <div className={`mt-3 flex items-start gap-2 rounded-lg px-2.5 py-2 ${isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-700"}`}>
                        <FaExclamationTriangle className="text-[10px] mt-0.5 flex-shrink-0" />
                        <p className="text-[10px]">
                          This partner is over the ₹20,000 FY threshold, so {preview.tdsPercent}% TDS applies to this
                          commission. Earlier commissions this year are not affected.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">{error}</div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={onClose} className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted}`}>Cancel</button>
              <button onClick={handleSubmit} disabled={!canSubmit}
                className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary} ${!canSubmit ? "opacity-50 cursor-not-allowed" : ""}`}>
                {busy ? "Saving..." : "Record Commission"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({ t, k, v, bold }: { t: any; k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={t.textMuted}>{k}</span>
      <span className={`${bold ? "font-bold" : ""} ${t.text}`}>{v}</span>
    </div>
  );
}
