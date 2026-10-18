"use client";

// HRConnect — HR-side inbox for employee requests (Phase 4A).
// Shows filterable list of requests, conversation threading, status management.

import { useEffect, useState, useCallback, useRef } from "react";
import {
  IoChevronBack, IoSend, IoFunnel, IoSearch,
  IoCheckmarkCircle, IoTimeOutline, IoAlertCircle,
  IoEllipsisHorizontal, IoLockClosed,
} from "react-icons/io5";

interface HRConnectProps {
  isDark: boolean;
}

interface Request {
  id: number;
  requesterId: number;
  requesterName: string;
  requesterEmail: string;
  assignedHrId: number | null;
  assignedHrName: string | null;
  category: string;
  subject: string;
  priority: string;
  status: string;
  messageCount: number;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: number;
  senderId: number;
  senderName: string;
  body: string;
  attachmentKey: string | null;
  attachmentName: string | null;
  isInternal: boolean;
  createdAt: string;
}

const CATEGORIES = [
  { value: "", label: "All Categories" },
  { value: "leave", label: "Leave" },
  { value: "salary", label: "Salary" },
  { value: "attendance", label: "Attendance" },
  { value: "documents", label: "Documents" },
  { value: "policy", label: "Policy" },
  { value: "grievance", label: "Grievance" },
  { value: "other", label: "Other" },
];

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "awaiting_employee", label: "Awaiting Employee" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  normal: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  low: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const STATUS_ICONS: Record<string, typeof IoTimeOutline> = {
  open: IoAlertCircle,
  in_progress: IoTimeOutline,
  awaiting_employee: IoEllipsisHorizontal,
  resolved: IoCheckmarkCircle,
  closed: IoLockClosed,
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  awaiting_employee: "Awaiting Employee",
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

export default function HRConnect({ isDark }: HRConnectProps) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [search, setSearch] = useState("");

  // Detail view
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ request: Request; messages: Message[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Reply
  const [replyBody, setReplyBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Status update
  const [showStatusMenu, setShowStatusMenu] = useState(false);

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

  // ── Fetch list ──────────────────────────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (filterStatus) sp.set("status", filterStatus);
      if (filterCategory) sp.set("category", filterCategory);
      sp.set("limit", "50");
      const res = await fetch(`/api/hr/connect/requests?${sp}`);
      const json = await res.json();
      if (json.success) {
        let list = json.data.requests as Request[];
        if (search.trim()) {
          const q = search.toLowerCase();
          list = list.filter(
            (r) =>
              r.subject.toLowerCase().includes(q) ||
              r.requesterName.toLowerCase().includes(q) ||
              r.category.toLowerCase().includes(q)
          );
        }
        setRequests(list);
        setTotal(json.data.total);
      }
    } catch {}
    setLoading(false);
  }, [filterStatus, filterCategory, search]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ── Fetch detail ────────────────────────────────────────────────────────
  const fetchDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/hr/connect/requests/${id}`);
      const json = await res.json();
      if (json.success) {
        setDetail(json.data);
      }
    } catch {}
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages]);

  // ── Send reply ──────────────────────────────────────────────────────────
  const handleSendReply = async () => {
    if (!replyBody.trim() || !selectedId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/hr/connect/requests/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody.trim(), isInternal }),
      });
      const json = await res.json();
      if (json.success) {
        setReplyBody("");
        setIsInternal(false);
        fetchDetail(selectedId);
      }
    } catch {}
    setSending(false);
  };

  // ── Update status ───────────────────────────────────────────────────────
  const handleStatusChange = async (newStatus: string) => {
    if (!selectedId) return;
    setShowStatusMenu(false);
    try {
      const res = await fetch(`/api/hr/connect/requests/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (json.success) {
        fetchDetail(selectedId);
        fetchRequests();
      }
    } catch {}
  };

  // ── List view ───────────────────────────────────────────────────────────
  if (!selectedId) {
    return (
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <IoSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[#636366]" size={14} />
            <input
              className={`${inputCls} pl-8`}
              placeholder="Search requests..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className={inputCls.replace("w-full", "w-auto")}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <select
            className={inputCls.replace("w-full", "w-auto")}
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Stats */}
        <div className="flex gap-3 text-xs">
          <span className={isDark ? "text-[#98989D]" : "text-[#86868B]"}>
            {total} total requests
          </span>
          <span className="text-emerald-500 font-semibold">
            {requests.filter((r) => r.status === "open").length} open
          </span>
          <span className="text-amber-500 font-semibold">
            {requests.filter((r) => r.status === "in_progress").length} in progress
          </span>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`rounded-xl h-20 animate-pulse border ${card}`} />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className={`rounded-xl p-8 text-center border ${card}`}>
            <p className={isDark ? "text-[#98989D]" : "text-[#86868B]"}>
              No requests found.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => {
              const StatusIcon = STATUS_ICONS[r.status] || IoTimeOutline;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left rounded-xl p-4 border transition hover:scale-[1.005] cursor-pointer ${card}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${PRIORITY_COLORS[r.priority] || PRIORITY_COLORS.normal}`}>
                          {r.priority.toUpperCase()}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          isDark ? "bg-[#2C2C2E] text-[#98989D]" : "bg-[#F2F2F7] text-[#6E6E73]"
                        }`}>
                          {r.category}
                        </span>
                      </div>
                      <p className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
                        {r.subject}
                      </p>
                      <p className={`text-xs mt-0.5 ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
                        {r.requesterName} &middot; {timeAgo(r.createdAt)}
                        {r.messageCount > 1 && ` \u00B7 ${r.messageCount} messages`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusIcon size={14} className={
                        r.status === "open" ? "text-red-400" :
                        r.status === "resolved" ? "text-emerald-400" :
                        r.status === "closed" ? "text-gray-400" :
                        "text-amber-400"
                      } />
                      <span className={`text-[10px] font-medium ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Detail / conversation view ──────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-160px)]">
      {/* Header */}
      <div className={`flex items-center gap-3 p-4 border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
        <button
          onClick={() => { setSelectedId(null); setDetail(null); setShowStatusMenu(false); }}
          className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#F2F2F7]"}`}
        >
          <IoChevronBack size={18} />
        </button>
        {detail && (
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
              {detail.request.subject}
            </p>
            <p className={`text-xs ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
              {detail.request.requesterName} &middot; {detail.request.category}
            </p>
          </div>
        )}
        {detail && (
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                isDark ? "bg-[#2C2C2E] border-[#48484A] text-white" : "bg-[#F2F2F7] border-[#D1D1D6] text-[#1D1D1F]"
              }`}
            >
              {STATUS_LABELS[detail.request.status] || detail.request.status}
            </button>
            {showStatusMenu && (
              <div className={`absolute right-0 top-full mt-1 w-48 rounded-xl shadow-xl border z-50 overflow-hidden ${card}`}>
                {["open", "in_progress", "awaiting_employee", "resolved", "closed"].map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    disabled={s === detail.request.status}
                    className={`w-full text-left px-3 py-2 text-xs font-medium transition ${
                      s === detail.request.status
                        ? isDark ? "bg-[#2C2C2E] text-[#636366]" : "bg-[#F2F2F7] text-[#C7C7CC]"
                        : isDark ? "hover:bg-[#2C2C2E] text-white" : "hover:bg-[#F2F2F7] text-[#1D1D1F]"
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {detailLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className={`rounded-xl h-16 animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
            ))}
          </div>
        ) : detail?.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl p-3 border ${
              m.isInternal
                ? isDark ? "bg-amber-900/10 border-amber-500/20" : "bg-amber-50 border-amber-200"
                : card
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
                {m.senderName}
                {m.isInternal && (
                  <span className="ml-2 text-[10px] font-bold text-amber-500">INTERNAL NOTE</span>
                )}
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

      {/* Reply box */}
      {detail && detail.request.status !== "closed" && (
        <div className={`p-4 border-t ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="flex items-center gap-2 mb-2">
            <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${
              isDark ? "text-[#98989D]" : "text-[#6E6E73]"
            }`}>
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="rounded"
              />
              Internal note (HR only)
            </label>
          </div>
          <div className="flex gap-2">
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              placeholder={isInternal ? "Add an internal note..." : "Type your reply..."}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSendReply();
              }}
            />
            <button
              onClick={handleSendReply}
              disabled={!replyBody.trim() || sending}
              className={`${btnPrimary} shrink-0 self-end disabled:opacity-50`}
            >
              <IoSend size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
