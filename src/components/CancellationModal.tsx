"use client";
// CancellationModal.tsx — admin cancel / edit-cancellation / reactivate.
//   mode="cancel"  → capture reason + remarks, set booking_status=Cancelled (releases the flat).
//   mode="edit"    → edit reason/remarks on a cancelled booking, OR reactivate it
//                    (→ Confirmed, re-books the flat; blocked if another booking took it).
// Admin-only in practice (the triggering buttons are admin-gated) and re-enforced server-side.
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaTimesCircle, FaUndo, FaExclamationTriangle } from "react-icons/fa";

interface Props {
  isOpen: boolean;
  mode: "cancel" | "edit";
  booking: any;
  user: { name?: string; role?: string } | null | undefined;
  isDark?: boolean;
  onClose: () => void;
  onDone: () => void;   // fired after a successful write (parent refetches + closes)
}

export default function CancellationModal({ isOpen, mode, booking, user, isDark = false, onClose, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [reactivateConfirm, setReactivateConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed fields only when the modal OPENS — not on every `booking` reference change.
  // Depending on `booking` here would let a parent re-render (dashboard refetch) reset
  // the inputs mid-typing. We read the current booking inside on open.
  useEffect(() => {
    if (isOpen) {
      setReason(mode === "edit" ? (booking?.cancellation_reason || "") : "");
      setRemarks(mode === "edit" ? (booking?.cancellation_remarks || "") : "");
      setReactivateConfirm(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  const textMain = isDark ? "text-white" : "text-[#1A1A1A]";
  const textMuted = isDark ? "text-[#888899]" : "text-[#6B7280]";
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors ${isDark ? "bg-[#121218] border-[#2A2A35] text-white focus:border-[#9E217B]" : "bg-white border-[#D1D5DB] text-[#1A1A1A] focus:border-[#00AEEF]"}`;
  const labelCls = `text-[11px] font-semibold mb-1 block ${textMuted}`;

  const flatLabel = `Flat ${booking?.flat_number || "—"}${booking?.tower ? `, Tower ${booking.tower}` : ""}${booking?.wing ? `/${booking.wing}` : ""}`;

  const submit = async (fields: Record<string, string>) => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => fd.set(k, v));
      fd.set("user_name", user?.name || "");
      fd.set("user_role", user?.role || "");
      const res = await fetch(`/api/booking-applications/${booking.id}`, { method: "PUT", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "Request failed");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = () => {
    if (!reason.trim()) { setError("A cancellation reason is required."); return; }
    submit({ booking_status: "Cancelled", cancellation_reason: reason.trim(), cancellation_remarks: remarks.trim() });
  };
  const doEditSave = () => submit({ edit_cancellation: "true", cancellation_reason: reason.trim(), cancellation_remarks: remarks.trim() });
  const doReactivate = () => submit({ booking_status: "Confirmed" });

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[210] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.93, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.93, y: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className={`w-full max-w-md rounded-2xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div className="flex items-center gap-2">
                {mode === "cancel" ? <FaTimesCircle className="text-red-500" /> : <FaUndo className="text-amber-500" />}
                <div>
                  <h2 className={`text-base font-bold ${textMain}`}>{mode === "cancel" ? "Cancel Booking" : "Edit Cancellation"}</h2>
                  <p className={`text-[11px] ${textMuted}`}>{booking?.booking_number || flatLabel}</p>
                </div>
              </div>
              <button onClick={onClose} className={`p-2 rounded-xl ${textMuted} hover:text-red-500`}><FaTimes /></button>
            </div>

            {/* Body */}
            <div className="p-5">
              {mode === "cancel" && (
                <div className={`rounded-lg border p-2.5 mb-3 text-[11px] flex items-start gap-2 ${isDark ? "bg-amber-500/5 border-amber-500/30 text-amber-400" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                  <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
                  <span>Cancelling releases <b>{flatLabel}</b> back to Available inventory. This does not process any refund.</span>
                </div>
              )}

              <div className="mb-3">
                <label className={labelCls}>Reason {mode === "cancel" ? "*" : ""}</label>
                <input value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder="e.g. Customer backed out / financing fell through" />
              </div>
              <div className="mb-1">
                <label className={labelCls}>Remarks</label>
                <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} className={inputCls} placeholder="Optional notes" />
              </div>

              {/* Reactivate section (edit mode only) */}
              {mode === "edit" && (
                <div className={`mt-4 pt-4 border-t ${isDark ? "border-[#2A2A35]" : "border-[#F1F5F9]"}`}>
                  <p className={`text-[11px] font-semibold mb-2 ${textMuted}`}>Reactivate this booking</p>
                  {!reactivateConfirm ? (
                    <button onClick={() => { setReactivateConfirm(true); setError(null); }} disabled={busy}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border border-green-500/40 text-green-600 hover:bg-green-500/10 disabled:opacity-50">
                      <FaUndo className="text-[10px]" /> Reactivate → Confirmed
                    </button>
                  ) : (
                    <div className={`rounded-lg border p-2.5 ${isDark ? "bg-green-500/5 border-green-500/30" : "bg-green-50 border-green-200"}`}>
                      <p className={`text-[11px] mb-2 ${textMain}`}>This re-books <b>{flatLabel}</b> and sets the booking back to <b>Confirmed</b>. If another booking has since taken this flat, it will be blocked.</p>
                      <div className="flex gap-2">
                        <button onClick={doReactivate} disabled={busy} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-500 disabled:opacity-50">{busy ? "Reactivating…" : "Yes, reactivate"}</button>
                        <button onClick={() => setReactivateConfirm(false)} disabled={busy} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${isDark ? "border-[#2A2A35] text-[#888899]" : "border-[#D1D5DB] text-[#6B7280]"}`}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-red-500 text-[12px] mt-3">{error}</p>}
            </div>

            {/* Footer */}
            <div className={`flex items-center justify-end gap-2 px-5 py-4 border-t ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <button onClick={onClose} disabled={busy} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${isDark ? "border-[#2A2A35] text-[#888899]" : "border-[#D1D5DB] text-[#6B7280]"}`}>
                {mode === "cancel" ? "Keep Booking" : "Close"}
              </button>
              {mode === "cancel" ? (
                <button onClick={doCancel} disabled={busy} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50">
                  <FaTimesCircle className="text-[10px]" /> {busy ? "Cancelling…" : "Confirm Cancellation"}
                </button>
              ) : (
                <button onClick={doEditSave} disabled={busy} className={`text-xs font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 ${isDark ? "bg-[#9E217B] hover:bg-[#7a1960]" : "bg-[#00AEEF] hover:bg-[#0088bb]"}`}>
                  {busy ? "Saving…" : "Save Changes"}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
