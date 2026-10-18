"use client";

// EmployeeHRConnect — employee-facing view for HR Connect.
// Submit new requests to HR and view/reply to existing ones.
// Can be embedded in any dashboard as a panel or modal.

import { useEffect, useState, useCallback, useRef } from "react";
import {
  IoChevronBack, IoSend, IoAdd, IoCheckmarkCircle,
  IoTimeOutline, IoAlertCircle, IoLockClosed, IoEllipsisHorizontal,
} from "react-icons/io5";

interface Props {
  isDark: boolean;
  onClose?: () => void;
}

interface Request {
  id: number;
  category: string;
  subject: string;
  priority: string;
  status: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: number;
  senderId: number;
  senderName: string;
  body: string;
  attachmentName: string | null;
  isInternal: boolean;
  createdAt: string;
}

const CATEGORIES = [
  { value: "leave", label: "Leave" },
  { value: "salary", label: "Salary" },
  { value: "attendance", label: "Attendance" },
  { value: "documents", label: "Documents" },
  { value: "policy", label: "Policy" },
  { value: "grievance", label: "Grievance" },
  { value: "other", label: "Other" },
];

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  awaiting_employee: "Awaiting You",
  resolved: "Resolved",
  closed: "Closed",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type View = "list" | "new" | "detail";

export default function EmployeeHRConnect({ isDark, onClose }: Props) {
  const [view, setView] = useState<View>("list");
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  // New request form
  const [newCategory, setNewCategory] = useState("other");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Detail
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ request: any; messages: Message[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const card = isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA]";
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border outline-none transition ${
    isDark
      ? "bg-[#2C2C2E] border-[#48484A] text-white placeholder-[#636366] focus:border-emerald-500"
      : "bg-white border-[#D1D1D6] text-[#1D1D1F] placeholder-[#8E8E93] focus:border-emerald-600"
  }`;
  const btnPrimary = `px-4 py-2 rounded-lg text-sm font-semibold transition ${
    isDark
      ? "bg-emerald-600 text-white hover:bg-emerald-500"
      : "bg-emerald-600 text-white hover:bg-emerald-700"
  }`;
  const btnSecondary = `px-4 py-2 rounded-lg text-sm font-medium transition ${
    isDark
      ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C] border border-[#48484A]"
      : "bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA] border border-[#D1D1D6]"
  }`;

  // ── Fetch list ──────────────────────────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/connect/requests?limit=50");
      const json = await res.json();
      if (json.success) setRequests(json.data.requests);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ── Submit new ──────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitError("");
    if (!newSubject.trim() || !newBody.trim()) {
      setSubmitError("Subject and message are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/connect/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: newCategory,
          subject: newSubject.trim(),
          body: newBody.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNewCategory("other");
        setNewSubject("");
        setNewBody("");
        setView("list");
        fetchRequests();
      } else {
        setSubmitError(json.message || "Failed to submit.");
      }
    } catch {
      setSubmitError("Network error.");
    }
    setSubmitting(false);
  };

  // ── Fetch detail ────────────────────────────────────────────────────────
  const openDetail = (id: number) => {
    setSelectedId(id);
    setView("detail");
  };

  useEffect(() => {
    if (view === "detail" && selectedId) {
      setDetailLoading(true);
      fetch(`/api/hr/connect/requests/${selectedId}`)
        .then((r) => r.json())
        .then((json) => { if (json.success) setDetail(json.data); })
        .catch(() => {})
        .finally(() => setDetailLoading(false));
    }
  }, [view, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages]);

  // ── Send reply ──────────────────────────────────────────────────────────
  const handleReply = async () => {
    if (!replyBody.trim() || !selectedId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/hr/connect/requests/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setReplyBody("");
        // Refresh
        const r2 = await fetch(`/api/hr/connect/requests/${selectedId}`);
        const j2 = await r2.json();
        if (j2.success) setDetail(j2.data);
      }
    } catch {}
    setSending(false);
  };

  // ── New request form ────────────────────────────────────────────────────
  if (view === "new") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setView("list")} className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#F2F2F7]"}`}>
            <IoChevronBack size={18} />
          </button>
          <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>New Request</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>Category</label>
            <select className={inputCls} value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>Subject</label>
            <input className={inputCls} placeholder="Brief summary of your request" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${isDark ? "text-[#98989D]" : "text-[#6E6E73]"}`}>Message</label>
            <textarea className={`${inputCls} resize-none`} rows={4} placeholder="Describe your request in detail..." value={newBody} onChange={(e) => setNewBody(e.target.value)} />
          </div>
          {submitError && <p className="text-xs text-red-400">{submitError}</p>}
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={submitting} className={`${btnPrimary} disabled:opacity-50`}>
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
            <button onClick={() => setView("list")} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail view ─────────────────────────────────────────────────────────
  if (view === "detail") {
    return (
      <div className="flex flex-col h-full max-h-[calc(100vh-200px)]">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => { setView("list"); setDetail(null); }} className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#F2F2F7]"}`}>
            <IoChevronBack size={18} />
          </button>
          {detail && (
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
                {detail.request.subject}
              </p>
              <p className={`text-[10px] ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
                {detail.request.category} &middot; {STATUS_LABELS[detail.request.status] || detail.request.status}
              </p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {detailLoading ? (
            <div className={`rounded-xl h-16 animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
          ) : detail?.messages.map((m) => (
            <div key={m.id} className={`rounded-xl p-3 border ${card}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
                  {m.senderName}
                </span>
                <span className={`text-[10px] ${isDark ? "text-[#636366]" : "text-[#8E8E93]"}`}>
                  {timeAgo(m.createdAt)}
                </span>
              </div>
              <p className={`text-sm whitespace-pre-wrap ${isDark ? "text-[#E5E5EA]" : "text-[#3A3A3C]"}`}>
                {m.body}
              </p>
              {m.attachmentName && (
                <p className="text-xs text-emerald-500 mt-1 font-medium">
                  Attachment: {m.attachmentName}
                </p>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {detail && detail.request.status !== "closed" && (
          <div className={`pt-3 mt-3 border-t ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
            <div className="flex gap-2">
              <textarea
                className={`${inputCls} resize-none`}
                rows={2}
                placeholder="Type your reply..."
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleReply();
                }}
              />
              <button onClick={handleReply} disabled={!replyBody.trim() || sending} className={`${btnPrimary} shrink-0 self-end disabled:opacity-50`}>
                <IoSend size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
          HR Connect
        </h3>
        <button onClick={() => setView("new")} className={`${btnPrimary} flex items-center gap-1.5 text-xs`}>
          <IoAdd size={14} /> New Request
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`rounded-xl h-16 animate-pulse border ${card}`} />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className={`rounded-xl p-8 text-center border ${card}`}>
          <p className={`text-sm ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
            No requests yet. Tap "New Request" to reach HR.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const StatusIcon =
              r.status === "open" ? IoAlertCircle :
              r.status === "resolved" ? IoCheckmarkCircle :
              r.status === "closed" ? IoLockClosed :
              r.status === "awaiting_employee" ? IoEllipsisHorizontal :
              IoTimeOutline;
            const statusColor =
              r.status === "open" ? "text-red-400" :
              r.status === "resolved" ? "text-emerald-400" :
              r.status === "closed" ? "text-gray-400" :
              "text-amber-400";
            return (
              <button
                key={r.id}
                onClick={() => openDetail(r.id)}
                className={`w-full text-left rounded-xl p-3 border transition hover:scale-[1.005] cursor-pointer ${card}`}
              >
                <div className="flex items-center gap-2">
                  <StatusIcon size={14} className={statusColor} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
                      {r.subject}
                    </p>
                    <p className={`text-[10px] ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
                      {r.category} &middot; {STATUS_LABELS[r.status]} &middot; {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  {r.messageCount > 1 && (
                    <span className={`text-[10px] font-medium ${isDark ? "text-[#636366]" : "text-[#8E8E93]"}`}>
                      {r.messageCount} msgs
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
