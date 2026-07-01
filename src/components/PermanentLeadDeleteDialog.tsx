"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

type PermanentLeadDeleteDialogProps = {
  open: boolean;
  lead: any;
  isDark?: boolean;
  isDeleting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (reason?: string) => void | Promise<void>;
};

const deletionItems = [
  "Lead information",
  "Customer details",
  "Aadhaar image",
  "PAN image",
  "Booking documents",
  "Generated PDFs",
  "Notes",
  "Follow-up history",
  "Site visit history",
  "Activity logs",
  "Uploaded files",
  "Any related records",
];

export default function PermanentLeadDeleteDialog({
  open,
  lead,
  isDark = false,
  isDeleting = false,
  error = null,
  onClose,
  onConfirm,
}: PermanentLeadDeleteDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setConfirmation("");
      setReason("");
    }
  }, [open]);

  if (!open || !lead) return null;

  const canConfirm = confirmation === "DELETE" && !isDeleting;
  const leadNumber = lead.sr_no || lead.id;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/75 p-4 sm:p-6 animate-fadeIn"
      style={{ backdropFilter: "blur(8px)" }}
    >
      <div
        className={`w-full max-w-2xl overflow-hidden rounded-xl border shadow-2xl ${
          isDark ? "border-red-900/50 bg-[#171717] text-white" : "border-red-200 bg-white text-[#1A1A1A]"
        }`}
      >
        <div
          className={`flex items-start justify-between gap-4 border-b p-5 ${
            isDark ? "border-red-900/40 bg-red-950/30" : "border-red-200 bg-red-50"
          }`}
        >
          <div className="flex gap-3">
            <div className={`mt-0.5 rounded-lg p-2 ${isDark ? "bg-red-500/10 text-red-300" : "bg-red-100 text-red-700"}`}>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className={`text-lg font-black ${isDark ? "text-red-300" : "text-red-700"}`}>
                Delete Lead Permanently?
              </h2>
              <p className={`mt-1 text-xs font-semibold ${isDark ? "text-red-200/80" : "text-red-700/80"}`}>
                Lead #{leadNumber} - {lead.name || "Unnamed Lead"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className={`rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isDark ? "text-gray-400 hover:bg-white/5 hover:text-white" : "text-gray-500 hover:bg-red-100 hover:text-red-700"
            }`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={`max-h-[70vh] overflow-y-auto p-5 ${isDark ? "bg-[#111]" : "bg-white"}`}>
          <p className={`text-sm font-bold ${isDark ? "text-red-200" : "text-red-700"}`}>
            This action cannot be undone.
          </p>
          <p className={`mt-4 text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}>
            The following data will be permanently deleted:
          </p>
          <ul className={`mt-3 grid gap-2 text-sm sm:grid-cols-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
            {deletionItems.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 space-y-4">
            <div>
              <label className={`mb-2 block text-xs font-bold uppercase ${isDark ? "text-gray-300" : "text-gray-600"}`}>
                Reason
              </label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Optional reason for audit log"
                disabled={isDeleting}
                className={`w-full resize-none rounded-xl border px-4 py-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isDark
                    ? "border-[#333] bg-[#171717] text-white focus:border-red-500"
                    : "border-gray-200 bg-white text-[#1A1A1A] focus:border-red-500"
                }`}
              />
            </div>

            <div>
              <label className={`mb-2 block text-xs font-bold uppercase ${isDark ? "text-gray-300" : "text-gray-600"}`}>
                Type DELETE to confirm
              </label>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={isDeleting}
                autoFocus
                className={`w-full rounded-xl border px-4 py-3 font-mono text-sm font-bold outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  isDark
                    ? "border-red-900/40 bg-[#171717] text-white focus:border-red-500"
                    : "border-red-200 bg-white text-[#1A1A1A] focus:border-red-500"
                }`}
              />
            </div>

            {error && (
              <div className={`rounded-xl border p-3 text-sm font-semibold ${isDark ? "border-red-900/50 bg-red-950/30 text-red-200" : "border-red-200 bg-red-50 text-red-700"}`}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div className={`flex flex-col-reverse gap-3 border-t p-5 sm:flex-row sm:justify-end ${isDark ? "border-[#2a2a2a] bg-[#151515]" : "border-gray-200 bg-gray-50"}`}>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isDark ? "text-gray-300 hover:bg-white/5 hover:text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim() || undefined)}
            disabled={!canConfirm}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-black text-white transition-colors ${
              canConfirm
                ? "bg-red-600 hover:bg-red-500"
                : "cursor-not-allowed bg-red-400/50"
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {isDeleting ? "Deleting..." : "Delete Permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
