"use client";

import { AlertTriangle, Ghost } from "lucide-react";
import { FaTimes } from "react-icons/fa";
import type { CSSProperties, FormEvent } from "react";

type LostLead = {
  id: string | number;
  name?: string;
  sr_no?: number;
};

type LostLeadTheme = {
  modalCard: string;
  modalGlass: CSSProperties;
  textMuted: string;
  textFaint: string;
  settingsBg: string;
  text: string;
};

type LostLeadModalProps = {
  lead: LostLead;
  reason: string;
  error: string;
  isSaving: boolean;
  isDark: boolean;
  theme: LostLeadTheme;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
};

export default function LostLeadModal({
  lead,
  reason,
  error,
  isSaving,
  isDark,
  theme,
  onReasonChange,
  onClose,
  onSubmit,
}: LostLeadModalProps) {
  const trimmedLength = reason.trim().length;

  return (
    <div className="fixed inset-0 bg-black/75 z-[200] flex items-center justify-center p-4 animate-fadeIn" style={{ backdropFilter: "blur(8px)" }}>
      <div className={`rounded-2xl w-full max-w-lg shadow-2xl border overflow-hidden ${theme.modalCard}`} style={theme.modalGlass}>
        <div className={`p-5 border-b flex items-start justify-between ${isDark ? "bg-red-950/25 border-red-500/20" : "bg-red-50 border-red-200"}`}>
          <div>
            <h2 className={`font-bold flex items-center gap-2 ${isDark ? "text-red-300" : "text-red-700"}`}>
              <AlertTriangle className="w-5 h-5" /> Mark Lead as Lost?
            </h2>
            <p className={`text-xs mt-1 ${theme.textMuted}`}>This lead will be marked inactive across Sales Manager, Admin, and Site Head panels.</p>
          </div>
          <button type="button" onClick={onClose} className={`p-2 ${theme.textMuted} hover:text-red-500`}><FaTimes /></button>
        </div>
        <form onSubmit={onSubmit} className={`p-5 space-y-4 ${isDark ? "bg-[#121212]" : "bg-[#F8FAFC]"}`}>
          <div className={`rounded-xl border p-3 ${theme.settingsBg}`}>
            <p className={`text-xs font-bold ${theme.text}`}>#{lead.sr_no || lead.id} - {lead.name}</p>
            <p className={`text-[10px] mt-1 ${theme.textFaint}`}>The lead stays visible for history and reporting.</p>
          </div>
          <div>
            <label className={`block text-xs font-bold mb-1.5 ${isDark ? "text-red-300" : "text-red-700"}`}>Reason *</label>
            <textarea
              required
              rows={4}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="e.g. Customer stopped responding after repeated calls and WhatsApp follow-ups."
              className={`w-full rounded-xl px-4 py-3 text-sm outline-none resize-none border-2 transition-colors ${isDark ? "bg-[#1a1a1a] border-red-500/30 text-white focus:border-red-500" : "bg-white border-red-200 text-[#1A1A1A] focus:border-red-500"}`}
            />
            <div className="mt-1.5 flex justify-between gap-3">
              <p className={`text-[10px] ${error ? "text-red-400" : theme.textFaint}`}>{error || "Minimum 10 characters required."}</p>
              <p className={`text-[10px] ${trimmedLength >= 10 ? "text-green-500" : theme.textFaint}`}>{trimmedLength}/10</p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 py-2.5 rounded-lg font-bold cursor-pointer transition-colors ${theme.textMuted} hover:text-red-500 border ${isDark ? "border-[#333]" : "border-gray-200"}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || trimmedLength < 10}
              className={`flex-1 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 ${isSaving || trimmedLength < 10 ? "opacity-50 cursor-not-allowed bg-red-500/40 text-white" : "cursor-pointer bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"}`}
            >
              <Ghost className="w-4 h-4" /> {isSaving ? "Saving..." : "Mark as Lost"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
