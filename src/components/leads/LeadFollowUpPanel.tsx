"use client";

import { useState } from "react";
import FollowUpComposer from "@/components/FollowUpComposer";
import FollowUpAttachments from "@/components/FollowUpAttachments";
import ManualCallBubble from "@/components/ManualCallBubble";
import type { LeadDetailsTheme } from "./types";

// ---------------------------------------------------------------------------
// EnquiryDetailsBubble — full enquiry info in System (Front Desk) card
// ---------------------------------------------------------------------------

function EnquiryDetailsBubble({ lead, theme, isDark, formatDate }: { lead: any; theme: Record<string, any>; isDark: boolean; formatDate: (d: string) => string }) {
  const [expanded, setExpanded] = useState(true);

  // Build a complete list of enquiry fields from the lead object
  const leftFields = [
    { label: "Lead No", val: lead.sr_no || lead.id },
    { label: "Customer Name", val: lead.name },
    { label: "Email", val: lead.email && lead.email !== "N/A" ? lead.email : null },
    { label: "Phone", val: lead.phone },
    { label: "Alt Phone", val: lead.altPhone || lead.alt_phone },
    { label: "Budget", val: lead.salesBudget !== "Pending" ? lead.salesBudget : lead.budget },
    { label: "Configuration", val: lead.propType || lead.configuration },
    { label: "Type of Use", val: lead.useType !== "Pending" ? lead.useType : (lead.purpose || null) },
    { label: "Planning to Buy", val: lead.planningPurchase },
  ];

  const rightFields = [
    { label: "Loan Required", val: lead.loanPlanned },
    { label: "Source", val: lead.source },
    { label: "Channel Partner", val: lead.cpName || lead.cp_name },
    { label: "CP Company", val: lead.cp_company || lead.cpCompany },
    { label: "CP Phone", val: lead.cp_phone || lead.cpPhone },
    { label: "Preferred Location", val: lead.location && lead.location !== "N/A" ? lead.location : null },
    { label: "Residential Address", val: lead.address && lead.address !== "N/A" ? lead.address : null },
    { label: "Lead Interest", val: lead.leadInterestStatus },
    { label: "Lead Status", val: lead.status },
    { label: "Assigned To", val: lead.assignedTo || lead.assigned_to },
  ];

  const renderVal = (val: any) => {
    if (!val || val === "N/A" || val === "Pending") return <span className={`${theme.textFaint}`}>Not Provided</span>;
    // Color-code interest status
    if (typeof val === "string") {
      if (val === "Interested") return <span className={`font-bold ${isDark ? "text-green-400" : "text-green-600"}`}>{val}</span>;
      if (val === "Not Interested") return <span className={`font-bold ${isDark ? "text-red-400" : "text-red-600"}`}>{val}</span>;
      if (val === "NON GENUINE DEMAND (NGD)") return <span className={`font-bold ${isDark ? "text-orange-400" : "text-orange-600"}`}>{val}</span>;
    }
    return <span className={theme.text}>{String(val)}</span>;
  };

  return (
    <div className={`text-sm ${theme.textMuted}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium">New enquiry received:</p>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`text-[10px] font-semibold cursor-pointer ${isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"}`}
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
          {/* Left column */}
          <div className="flex flex-col gap-1">
            {leftFields.map((f) => (
              <div key={f.label} className="flex items-baseline gap-1">
                <span className={`font-semibold flex-shrink-0 ${theme.textFaint}`}>{f.label}</span>
                <span className="ml-auto text-right">{renderVal(f.val)}</span>
              </div>
            ))}
          </div>
          {/* Right column */}
          <div className="flex flex-col gap-1">
            {rightFields.map((f) => (
              <div key={f.label} className="flex items-baseline gap-1">
                <span className={`font-semibold flex-shrink-0 ${theme.textFaint}`}>{f.label}</span>
                <span className="ml-auto text-right">{renderVal(f.val)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          {[
            { label: "Phone", val: lead.phone },
            { label: "Source", val: lead.source },
            { label: "Budget", val: lead.salesBudget || lead.budget },
            { label: "Config", val: lead.propType || lead.configuration },
          ].filter((f) => f.val && f.val !== "N/A" && f.val !== "Pending").map((f) => (
            <span key={f.label}>
              <span className={theme.textFaint}>{f.label}:</span> {f.val}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props extends LeadDetailsTheme {
  lead: any;
  followUps: any[];
  customNote: string;
  setCustomNote: (v: string) => void;
  onSendNote: (e: React.FormEvent<HTMLFormElement>) => void;
  onDeleteFollowUp: (id: string) => void;
  onRetryFollowUp: (msg: any) => void;
  canDeleteFollowUps: boolean;
  deletingFollowUpId: string | null;
  attView: any;
  onRefetch: () => void;
  onReminderClick: () => void;
  placeholder?: string;
  formatDate: (d: string) => string;
  /** Close button callback (null = no close button) */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadFollowUpPanel({
  lead, followUps, customNote, setCustomNote,
  onSendNote, onDeleteFollowUp, onRetryFollowUp,
  canDeleteFollowUps, deletingFollowUpId,
  attView, onRefetch, onReminderClick,
  isDark, theme, placeholder, formatDate, onClose,
}: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className={`w-full flex flex-col rounded-xl overflow-hidden shadow-2xl border min-h-full ${theme.chatPanel}`} style={theme.chatPanelGl}>
      {/* Header with follow-up count + close button */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0 ${isDark ? "border-[#333]" : "border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${theme.text}`}>Follow-ups</span>
          {followUps.length > 0 && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${isDark ? "bg-[#9E217B]/30 text-[#d946a8]" : "bg-[#9E217B]/10 text-[#9E217B]"
              }`}>
              {followUps.length}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className={`w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold cursor-pointer transition-colors ${isDark ? "text-gray-400 hover:text-white hover:bg-[#333]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              }`}
            title="Close follow-ups"
            aria-label="Close follow-ups"
          >
            &#x2715;
          </button>
        )}
      </div>

      {/* Messages */}
      <div className={`flex-1 p-4 sm:p-6 flex flex-col gap-4 ${theme.chatArea}`}>
        {/* System initial message — full enquiry details */}
        <div className="flex justify-start">
          <div className={`rounded-xl rounded-tl-none p-3 max-w-[95%] shadow-md ${theme.fupSalesform}`}>
            <div className="flex justify-between items-center mb-2 gap-3">
              <span className={`font-bold text-sm ${theme.accentText}`}>System (Front Desk)</span>
              <span className={`text-[10px] ${theme.textFaint}`}>{formatDate(lead.created_at)}</span>
            </div>
            <EnquiryDetailsBubble lead={lead} theme={theme} isDark={isDark} formatDate={formatDate} />
          </div>
        </div>

        {/* Follow-up messages */}
        {followUps.map((msg: any, idx: number) => {
          const isLoan = msg.message?.includes("\u{1F3E6} Loan Update");
          const isSF = msg.message?.includes("\u{1F4DD} Detailed Salesform Submitted");
          const isClosing = msg.message?.includes("\u2705 Lead Marked as Closing");
          const isTransfer = msg.message?.includes("\u{1F504} Lead Transferred");
          const bubble = isLoan ? theme.fupLoan : isSF ? theme.fupSalesform : isClosing ? theme.fupClosing : isTransfer ? theme.fupTransfer : theme.fupDefault;

          return (
            <div key={msg._id || idx} className="flex justify-start">
              <div className={`rounded-xl rounded-tl-none p-3 max-w-[90%] shadow-md ${bubble}`}>
                <div className="flex justify-between items-center mb-2 gap-3">
                  <span className={`font-bold text-sm ${theme.text}`}>
                    {msg.createdBy === "admin" ? `${msg.salesManagerName || "Admin"} (Admin)` : msg.salesManagerName}
                  </span>
                  <span className={`text-[10px] flex-shrink-0 flex items-center gap-1 ${theme.textFaint}`}>
                    {formatDate(msg.createdAt)}
                    {(msg.followUpType === "internal_message" || msg.followUpType === "sm_reply") && msg._status !== "sending" && msg._status !== "failed" && (
                      msg.readAt
                        ? <span className="text-blue-500 font-bold ml-0.5" title="Read">&#10003;&#10003;</span>
                        : <span className="opacity-60 ml-0.5" title="Sent">&#10003;</span>
                    )}
                  </span>
                </div>
                {msg.followUpType === "call" ? (
                  <ManualCallBubble message={msg.message} createdAt={msg.createdAt} textClass={theme.textMuted} onRecordingDeleted={onRefetch} />
                ) : (
                  <p className={`text-sm whitespace-pre-wrap leading-relaxed ${theme.textMuted}`}>{msg.message}</p>
                )}
                <FollowUpAttachments followUpId={Number(msg._id)} textClass={theme.textMuted} onDeleted={onRefetch} />
                {canDeleteFollowUps && msg._id && msg._status !== "sending" && msg._status !== "failed" && (
                  <button
                    type="button"
                    disabled={deletingFollowUpId === String(msg._id)}
                    onClick={() => setConfirmDeleteId(String(msg._id))}
                    className={`mt-1 text-[9px] font-medium transition-opacity ${isDark ? "text-red-400 hover:text-red-300" : "text-red-500 hover:text-red-600"} disabled:opacity-40`}
                  >
                    {deletingFollowUpId === String(msg._id) ? "Deleting\u2026" : "Delete"}
                  </button>
                )}
                {msg._status === "sending" && <span className="text-[9px] text-yellow-500 mt-1 block">Sending...</span>}
                {msg._status === "failed" && (
                  <span className="text-[9px] text-red-500 mt-1 flex items-center gap-1">
                    Failed to send
                    <button type="button" onClick={() => onRetryFollowUp(msg)} className="underline hover:text-red-400">Retry</button>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete confirm */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden mx-4">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-bold text-sm text-gray-900">Delete follow-up?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600 leading-relaxed">This will permanently delete this follow-up note and any attached files. This action cannot be undone.</p>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
              <button type="button" onClick={() => setConfirmDeleteId(null)} className="flex-1 px-3 py-2 text-xs font-bold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-100 transition">Cancel</button>
              <button type="button" onClick={() => { onDeleteFollowUp(confirmDeleteId); setConfirmDeleteId(null); }} className="flex-1 px-3 py-2 text-xs font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 transition">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Composer */}
      <FollowUpComposer
        value={customNote}
        onChange={setCustomNote}
        onSubmit={onSendNote}
        pendingFiles={attView.pendingFiles}
        fileError={attView.fileError}
        onAddFiles={attView.addFiles}
        onRemoveFile={attView.removeFile}
        onReminderClick={onReminderClick}
        isDark={isDark}
        theme={theme}
        placeholder={placeholder || "Add follow-up note..."}
        size="compact"
        headerGlass={theme.headerGlass}
      />
    </div>
  );
}
