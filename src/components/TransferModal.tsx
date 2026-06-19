"use client";

// components/TransferModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Drop-in reusable Transfer / Re-assign Modal for BhoomiDwellers CRM
// Usage:
//   <TransferModal
//     isOpen={isTransferModalOpen}
//     onClose={() => setIsTransferModalOpen(false)}
//     selectedLead={selectedLead}
//     assignees={combinedAssignees}          // salesManagers + siteHeads
//     isFetchingManagers={isFetchingManagers}
//     transferredBy={user.name}
//     isDark={isDark}
//     theme={t}
//     onSuccess={(updatedLead, followUp) => { refetchAll(); setAssignedSubView("cards"); }}
//     showToast={showToast}
//   />
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { FaExchangeAlt, FaTimes, FaUserTie, FaExclamationTriangle, FaCheckCircle } from "react-icons/fa";
// import ActivityTimeline from "@/components/ActivityTimeline";

interface Assignee {
  name: string;
  role?: string;
}

interface Lead {
  id: number | string;
  name: string;
  assignedTo?: string;
  assigned_to?: string;
  status?: string;
}

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLead: Lead | null;
  assignees: Assignee[];
  isFetchingManagers: boolean;
  transferredBy: string;
  isDark: boolean;
  theme: Record<string, any>;
  onSuccess: (updatedLead: any, followUp: any) => void;
  showToast: (msg: string, color?: string) => void;
}

export default function TransferModal({
  isOpen,
  onClose,
  selectedLead,
  assignees,
  isFetchingManagers,
  transferredBy,
  isDark,
  theme: t,
  onSuccess,
  showToast,
}: TransferModalProps) {
  const [transferTarget, setTransferTarget] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentManager = selectedLead?.assignedTo || selectedLead?.assigned_to || "Unassigned";
  const noteLength = transferNote.trim().length;
  const noteValid = noteLength >= 50;
  const isSameManager = transferTarget === currentManager;
  const canSubmit = transferTarget && noteValid && !isSameManager && !isTransferring;

  const handleClose = () => {
    if (isTransferring) return;
    setTransferTarget("");
    setTransferNote("");
    setError(null);
    onClose();
  };

  const handleTransfer = async () => {
    if (!canSubmit || !selectedLead) return;
    setIsTransferring(true);
    setError(null);

    try {
      const res = await fetch("/api/leads/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          transfer_to: transferTarget,
          transfer_note: transferNote,
          transferred_by: transferredBy,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message ?? "Transfer failed. Please try again.");
      }

      showToast(`✅ Lead #${selectedLead.id} transferred to ${transferTarget}!`, "green");
      onSuccess(json.data?.lead, json.data?.followUp);
      handleClose();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setIsTransferring(false);
    }
  };

  if (!isOpen || !selectedLead) return null;

  // ── Filter out current manager from dropdown options ──
  const availableAssignees = assignees.filter(a => a.name !== currentManager);

  return (
    <div
      className="fixed inset-0 bg-black/75 z-[200] flex justify-center items-center p-4 sm:p-6 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className={`rounded-2xl w-full max-w-lg shadow-2xl border overflow-hidden ${t.modalCard}`}
        style={t.modalGlass}
      >
        {/* ── Header ── */}
        <div className={`p-5 border-b flex justify-between items-start ${isDark
            ? "bg-gradient-to-r from-purple-900/30 to-purple-800/10 border-purple-500/20"
            : "bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-200"
          }`}>
          <div>
            <h2 className={`text-lg font-bold flex items-center gap-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>
              <FaExchangeAlt /> Re-assign Lead
            </h2>
            <p className={`text-xs mt-1 ${t.textMuted}`}>
              Lead <span className={`font-bold ${t.accentText}`}>#{selectedLead.id}</span> — {selectedLead.name}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isTransferring}
            className={`p-2 rounded-lg transition-colors ${t.textMuted} hover:text-red-500 ${isDark ? "hover:bg-red-500/10" : "hover:bg-red-50"}`}
          >
            <FaTimes />
          </button>
        </div>

        {/* ── Body ── */}
        <div className={`p-6 space-y-5 ${t.modalInner}`}>
          <ActivityTimeline
            lead={selectedLead}
            isDark={isDark}
            theme={t}
            compact
            maxAuditItems={3}
          />

          {/* Current Manager Badge */}
          <div className={`flex items-center gap-3 p-3 rounded-xl border ${isDark ? "bg-white/5 border-white/10" : "bg-gray-50 border-gray-200"
            }`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white ${isDark ? "bg-purple-600" : "bg-purple-500"
              }`}>
              {String(currentManager).charAt(0).toUpperCase()}
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${t.textFaint}`}>Currently Assigned To</p>
              <p className={`text-sm font-bold ${t.text}`}>{currentManager}</p>
            </div>
            <div className="ml-auto">
              <span className={`text-[10px] px-2 py-1 rounded-full font-bold border ${selectedLead.status === "Closing" ? t.statusClosing :
                  selectedLead.status === "Visit Scheduled" ? t.statusVisit : (t.statusAssigned || t.statusRouted)
                }`}>{(selectedLead.status === "Routed" || selectedLead.status === "ROUTED" ? "Assigned" : selectedLead.status) || "Assigned"}</span>
            </div>
          </div>

          {/* Arrow indicator */}
          <div className="flex items-center justify-center gap-2">
            <div className={`h-px flex-1 ${isDark ? "bg-purple-500/20" : "bg-purple-200"}`} />
            <FaExchangeAlt className={`text-sm ${isDark ? "text-purple-400" : "text-purple-500"}`} />
            <div className={`h-px flex-1 ${isDark ? "bg-purple-500/20" : "bg-purple-200"}`} />
          </div>

          {/* New Manager Dropdown */}
          <div>
            <label className={`block text-sm font-bold mb-2 ${isDark ? "text-purple-400" : "text-purple-700"}`}>
              Transfer To *
            </label>
            <div className="relative">
              <FaUserTie className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${t.textFaint}`} />
              <select
                value={transferTarget}
                onChange={e => { setTransferTarget(e.target.value); setError(null); }}
                className={`w-full rounded-xl pl-9 pr-4 py-3 text-sm outline-none transition-colors border-2 cursor-pointer appearance-none ${isDark
                    ? "bg-[#14141B] border-purple-500/40 text-white focus:border-purple-400"
                    : "bg-white border-purple-300 text-[#1A1A1A] focus:border-purple-500"
                  }`}
              >
                <option value="" disabled>— Select new manager —</option>
                {isFetchingManagers ? (
                  <option disabled>Loading managers…</option>
                ) : availableAssignees.length > 0 ? (
                  availableAssignees.map((m, i) => (
                    <option key={i} value={m.name}>
                      {m.name} ({String(m.role || "Sales Manager").replace(/_/g, " ")})
                    </option>
                  ))
                ) : (
                  <option disabled>No other managers available</option>
                )}
              </select>
            </div>

            {/* Same manager warning */}
            {isSameManager && (
              <p className="text-xs text-amber-500 mt-1.5 flex items-center gap-1">
                <FaExclamationTriangle className="text-[10px]" />
                Lead is already assigned to this manager. Choose a different one.
              </p>
            )}
          </div>

          {/* Handover Note */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`text-sm font-bold ${isDark ? "text-purple-400" : "text-purple-700"}`}>
                Handover Summary *
              </label>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${noteValid
                  ? isDark ? "text-green-400 bg-green-500/10" : "text-green-600 bg-green-50"
                  : isDark ? "text-gray-500 bg-white/5" : "text-gray-400 bg-gray-100"
                }`}>
                {noteLength}/50 min
                {noteValid && " ✓"}
              </span>
            </div>
            <p className={`text-[11px] mb-2 leading-relaxed ${t.textMuted}`}>
              Summarize all actions taken, discussions held, client interest level, and pending tasks so the new manager can continue seamlessly.
            </p>
            <textarea
              value={transferNote}
              onChange={e => { setTransferNote(e.target.value); setError(null); }}
              placeholder="e.g. Client was contacted twice and showed interest in a 2BHK under 80L. Site visit is pending. HDFC pre-approval in progress. Next step: schedule site visit and share brochure."
              rows={5}
              className={`w-full rounded-xl px-4 py-3 text-sm outline-none resize-none leading-relaxed border-2 transition-all custom-scrollbar ${isDark
                  ? `bg-[#14141B] text-white placeholder:text-gray-600 ${noteValid ? "border-green-500/50" : "border-purple-500/30 focus:border-purple-400"
                  }`
                  : `bg-white text-[#1A1A1A] placeholder:text-gray-400 ${noteValid ? "border-green-400" : "border-purple-200 focus:border-purple-500"
                  }`
                }`}
            />
          </div>

          {/* Warning Banner */}
          <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${isDark
              ? "bg-amber-900/10 border-amber-500/20 text-amber-400"
              : "bg-amber-50 border-amber-200 text-amber-700"
            }`}>
            <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-bold mb-0.5">This action will notify the new manager.</p>
              <p>The full lead history and your notes will remain visible to all parties.</p>
            </div>
          </div>

          {/* What happens info */}
          <div className={`p-3 rounded-xl border text-xs space-y-1 ${isDark
              ? "bg-blue-900/10 border-blue-500/20 text-blue-400"
              : "bg-blue-50 border-blue-200 text-blue-700"
            }`}>
            <p className="font-bold mb-1.5 flex items-center gap-1.5"><FaCheckCircle /> After transfer:</p>
            <p>• Lead is immediately reassigned to the selected manager</p>
            <p>• Transfer is logged in the follow-up history</p>
            <p>• Your handover note is preserved for the new manager</p>
            <p>• You remain listed as the capturing receptionist</p>
          </div>

          {/* Error message */}
          {error && (
            <div className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${isDark
                ? "bg-red-900/20 border-red-500/30 text-red-400"
                : "bg-red-50 border-red-200 text-red-600"
              }`}>
              <FaExclamationTriangle className="flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className={`p-5 border-t flex justify-end gap-3 ${t.modalHeader} ${t.tableBorder}`}>
          <button
            onClick={handleClose}
            disabled={isTransferring}
            className={`px-6 py-2.5 rounded-xl font-bold cursor-pointer transition-colors text-sm ${isDark
                ? "text-gray-400 hover:text-white hover:bg-white/10"
                : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              }`}
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={!canSubmit}
            className={`px-8 py-2.5 rounded-xl font-bold transition-all text-sm flex items-center gap-2 ${canSubmit
                ? "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/25 hover:shadow-purple-500/30 hover:-translate-y-0.5 cursor-pointer"
                : "opacity-40 cursor-not-allowed bg-purple-400 text-white"
              }`}
          >
            {isTransferring ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Transferring…
              </>
            ) : (
              <>
                <FaExchangeAlt />
                Confirm Transfer
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
