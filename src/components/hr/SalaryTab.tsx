"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import {
  IoChevronBack, IoSend, IoAdd, IoCheckmarkCircle,
  IoTimeOutline, IoAlertCircle, IoLockClosed, IoEllipsisHorizontal,
  IoChatbubblesOutline,
} from "react-icons/io5";

// ── Types ───────────────────────────────────────────────────────────────────
interface CurrentSalary {
  baseSalary: number;
  effectiveFrom: string;
  revisionReason: string | null;
}

interface LatestPay {
  periodYear: number;
  periodMonth: number;
  netPayable: number;
  totalPaid: number;
  outstanding: number;
  status: string;
  periodStatus: string;
}

interface PayrollRecord {
  id: number;
  periodYear: number;
  periodMonth: number;
  baseSalary: number;
  grossSalary: number;
  totalAdditions: number;
  totalDeductions: number;
  netPayable: number;
  incentiveTotal: number;
  status: string;
  totalPaid: number;
  outstanding: number;
}

interface SalaryHistoryEntry {
  baseSalary: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  revisionReason: string | null;
}

interface CompensationData {
  year: number;
  currentSalary: CurrentSalary | null;
  salaryHistory: SalaryHistoryEntry[];
  latestPay: LatestPay | null;
  payrollRecords: PayrollRecord[];
  incentiveSummary: Record<string, { count: number; total: number }>;
}

// ── HR Connect types ────────────────────────────────────────────────────────
interface HRRequest {
  id: number;
  category: string;
  subject: string;
  priority: string;
  status: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface HRMessage {
  id: number;
  senderId: number;
  senderName: string;
  body: string;
  attachmentName: string | null;
  isInternal: boolean;
  createdAt: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function inr(n: number) {
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

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

// Backend-accepted category values mapped to employee-friendly labels.
// The CHECK constraint allows: leave, salary, attendance, documents, policy, grievance, other
const CONNECT_CATEGORIES = [
  { value: "salary", label: "Salary / Salary Revision" },
  { value: "other", label: "Incentives / Commission" },
  { value: "salary", label: "Payroll / Deductions", displayValue: "payroll_deductions" },
  { value: "salary", label: "Payment Not Received", displayValue: "payment_missing" },
  { value: "other", label: "Payslip Request", displayValue: "payslip" },
  { value: "attendance", label: "Attendance" },
  { value: "leave", label: "Leave" },
  { value: "documents", label: "Documents" },
  { value: "other", label: "General HR Query" },
];

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  awaiting_employee: "Awaiting You",
  resolved: "Resolved",
  closed: "Closed",
};

const STATUS_COLORS: Record<string, string> = {
  open: "text-red-400",
  in_progress: "text-amber-400",
  awaiting_employee: "text-blue-400",
  resolved: "text-emerald-400",
  closed: "text-gray-400",
};

// ── Main Component ──────────────────────────────────────────────────────────
export default function SalaryTab({ isDark }: { isDark: boolean }) {
  const router = useRouter();

  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const textPri = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const inputCls = `w-full rounded-xl px-3 py-2.5 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder:text-[#636366]" : "bg-white border-[#D1D1D6] text-[#1D1D1F] placeholder:text-[#AEAEB2]"}`;
  const btnPrimary = `px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${isDark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`;
  const btnSecondary = `px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#D1D1D6] text-[#86868B] hover:border-[#AEAEB2]"}`;

  // ── Salary State ───────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<"overview" | "verifying" | "detailed">("overview");
  const [salaryToken, setSalaryToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number>(0);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [data, setData] = useState<CompensationData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataYear, setDataYear] = useState(new Date().getFullYear());

  // ── HR Connect State ───────────────────────────────────────────────────────
  const [connectView, setConnectView] = useState<"summary" | "list" | "new" | "detail">("summary");
  const [hrRequests, setHrRequests] = useState<HRRequest[]>([]);
  const [hrLoading, setHrLoading] = useState(true);
  const [hrError, setHrError] = useState("");

  // New request form
  const [newCatIdx, setNewCatIdx] = useState(0);
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Detail / conversation
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ request: any; messages: HRMessage[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Salary: Verify password ─────────────────────────────────────────────
  const handleVerify = async () => {
    if (!password.trim()) {
      setVerifyError("Please enter your password.");
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch("/api/me/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json();
      if (!res.ok) {
        setVerifyError(j.message || "Verification failed.");
        return;
      }
      const token = j.salaryViewToken;
      const expiresAt = Date.now() + (j.expiresInSeconds || 300) * 1000;
      setSalaryToken(token);
      setTokenExpiresAt(expiresAt);
      setPassword("");
      setPhase("detailed");
      fetchCompensation(token, dataYear);
    } catch (e: any) {
      setVerifyError(e.message || "Network error.");
    } finally {
      setVerifying(false);
    }
  };

  // ── Salary: Fetch compensation ──────────────────────────────────────────
  const fetchCompensation = useCallback(async (token: string, year: number) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const res = await fetch(`/api/me/compensation?year=${year}`, {
        headers: { "x-salary-token": token },
      });
      const j = await res.json();
      if (!res.ok) {
        if (j.code === "SALARY_AUTH_REQUIRED" || j.code === "SALARY_AUTH_INVALID") {
          setPhase("overview");
          setSalaryToken(null);
          setDataError("Session expired. Please verify your password again.");
          return;
        }
        throw new Error(j.message || `HTTP ${res.status}`);
      }
      setData(j.data);
      setDataYear(j.data.year);
    } catch (e: any) {
      setDataError(e.message);
    } finally {
      setDataLoading(false);
    }
  }, []);

  const handleYearChange = (year: number) => {
    if (!salaryToken || Date.now() > tokenExpiresAt) {
      setPhase("overview");
      setSalaryToken(null);
      setDataError("Session expired. Please verify your password again.");
      return;
    }
    setDataYear(year);
    fetchCompensation(salaryToken, year);
  };

  // ── HR Connect: Fetch requests ──────────────────────────────────────────
  const fetchHRRequests = useCallback(async () => {
    setHrLoading(true);
    setHrError("");
    try {
      const res = await fetch("/api/hr/connect/requests?limit=50");
      const json = await res.json();
      if (json.success) {
        setHrRequests(json.data.requests);
      } else {
        setHrError(json.message || "Failed to load requests.");
      }
    } catch {
      setHrError("Could not load HR requests.");
    }
    setHrLoading(false);
  }, []);

  useEffect(() => { fetchHRRequests(); }, [fetchHRRequests]);

  // ── HR Connect: Submit new request ──────────────────────────────────────
  const handleSubmitRequest = async () => {
    setSubmitError("");
    setSubmitSuccess(false);
    if (!newSubject.trim() || !newBody.trim()) {
      setSubmitError("Subject and message are required.");
      return;
    }
    setSubmitting(true);
    try {
      const catEntry = CONNECT_CATEGORIES[newCatIdx];
      const res = await fetch("/api/hr/connect/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: catEntry.value,
          subject: newSubject.trim(),
          body: newBody.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNewCatIdx(0);
        setNewSubject("");
        setNewBody("");
        setSubmitSuccess(true);
        setConnectView("list");
        fetchHRRequests();
      } else {
        setSubmitError(json.message || "Failed to submit.");
      }
    } catch {
      setSubmitError("Network error.");
    }
    setSubmitting(false);
  };

  // ── HR Connect: Fetch detail ────────────────────────────────────────────
  const openConversation = (id: number) => {
    setSelectedId(id);
    setConnectView("detail");
    setReplyBody("");
    setSubmitSuccess(false);
  };

  useEffect(() => {
    if (connectView === "detail" && selectedId) {
      setDetailLoading(true);
      fetch(`/api/hr/connect/requests/${selectedId}`)
        .then((r) => r.json())
        .then((json) => { if (json.success) setDetail(json.data); })
        .catch(() => { })
        .finally(() => setDetailLoading(false));
    }
  }, [connectView, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages]);

  // ── HR Connect: Send reply ──────────────────────────────────────────────
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
        const r2 = await fetch(`/api/hr/connect/requests/${selectedId}`);
        const j2 = await r2.json();
        if (j2.success) setDetail(j2.data);
        fetchHRRequests();
      }
    } catch { }
    setSending(false);
  };

  // ── Chart data ──────────────────────────────────────────────────────────
  const chartData = data?.payrollRecords
    .slice()
    .sort((a, b) => a.periodMonth - b.periodMonth)
    .map((r) => ({
      month: MONTHS[r.periodMonth - 1],
      "Base Salary": r.baseSalary,
      Additions: r.totalAdditions,
      Deductions: r.totalDeductions,
      "Net Pay": r.netPayable,
    })) || [];

  // ── Derived HR Connect stats ────────────────────────────────────────────
  const openRequests = hrRequests.filter((r) => r.status === "open" || r.status === "in_progress" || r.status === "awaiting_employee");
  const awaitingYou = hrRequests.filter((r) => r.status === "awaiting_employee");

  // ── Status icon helper ──────────────────────────────────────────────────
  function StatusIcon({ status }: { status: string }) {
    const Icon =
      status === "open" ? IoAlertCircle :
        status === "resolved" ? IoCheckmarkCircle :
          status === "closed" ? IoLockClosed :
            status === "awaiting_employee" ? IoEllipsisHorizontal :
              IoTimeOutline;
    return <Icon size={14} className={STATUS_COLORS[status] || "text-gray-400"} />;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HR CONNECT SECTION — renders below salary cards in all phases
  // ══════════════════════════════════════════════════════════════════════════
  function renderHRConnect() {
    // ── New request form ────────────────────────────────────────────────
    if (connectView === "new") {
      return (
        <div className={`rounded-2xl p-5 ${card}`}>
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => { setConnectView("summary"); setSubmitError(""); }} className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#F2F2F7]"}`}>
              <IoChevronBack size={18} className={textSec} />
            </button>
            <h3 className={`text-sm font-bold ${textPri}`}>Ask HR a Question</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1.5 ${textSec}`}>Category</label>
              <select className={inputCls} value={newCatIdx} onChange={(e) => setNewCatIdx(Number(e.target.value))}>
                {CONNECT_CATEGORIES.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1.5 ${textSec}`}>Subject</label>
              <input className={inputCls} placeholder="Brief summary of your question" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} maxLength={200} />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1.5 ${textSec}`}>Message</label>
              <textarea className={`${inputCls} resize-none`} rows={4} placeholder="Describe your question in detail..." value={newBody} onChange={(e) => setNewBody(e.target.value)} maxLength={4000} />
            </div>
            {submitError && (
              <div className="rounded-xl p-2.5 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
                {submitError}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={handleSubmitRequest} disabled={submitting} className={`${btnPrimary} disabled:opacity-50`}>
                {submitting ? "Sending..." : "Send to HR"}
              </button>
              <button onClick={() => { setConnectView("summary"); setSubmitError(""); }} className={btnSecondary}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── Conversation detail ─────────────────────────────────────────────
    if (connectView === "detail" && selectedId) {
      return (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          {/* Header */}
          <div className={`px-5 py-3 flex items-center gap-2 ${isDark ? "bg-[#1C1C1E]" : "bg-[#F5F5F7]"}`}>
            <button onClick={() => { setConnectView("list"); setDetail(null); }} className={`p-1 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-white"}`}>
              <IoChevronBack size={16} className={textSec} />
            </button>
            {detail ? (
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${textPri}`}>{detail.request.subject}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] ${textSec}`}>{detail.request.category}</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${STATUS_COLORS[detail.request.status] || textSec}`}>
                    <StatusIcon status={detail.request.status} />
                    {STATUS_LABELS[detail.request.status] || detail.request.status}
                  </span>
                </div>
              </div>
            ) : (
              <span className={`text-sm ${textSec}`}>Loading...</span>
            )}
          </div>

          {/* Messages */}
          <div className="max-h-[400px] overflow-y-auto p-4 space-y-2.5">
            {detailLoading ? (
              <div className={`rounded-xl h-16 animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
            ) : detail?.messages.map((m) => (
              <div key={m.id} className={`rounded-xl p-3 border ${isDark ? "border-[#2C2C2E] bg-[#0A0A0A]" : "border-[#F2F2F7] bg-white"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${textPri}`}>{m.senderName}</span>
                  <span className={`text-[10px] ${isDark ? "text-[#636366]" : "text-[#C7C7CC]"}`}>
                    {timeAgo(m.createdAt)}
                  </span>
                </div>
                <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isDark ? "text-[#E5E5EA]" : "text-[#3A3A3C]"}`}>
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
            <div className={`px-4 py-3 border-t ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#E5E5EA] bg-[#F5F5F7]"}`}>
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
                  maxLength={4000}
                />
                <button
                  onClick={handleReply}
                  disabled={!replyBody.trim() || sending}
                  className={`px-3 py-2 rounded-xl transition shrink-0 self-end disabled:opacity-40 cursor-pointer ${isDark ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                >
                  <IoSend size={16} />
                </button>
              </div>
              <p className={`text-[10px] mt-1.5 ${textSec}`}>Ctrl+Enter to send</p>
            </div>
          )}

          {/* Closed notice */}
          {detail && detail.request.status === "closed" && (
            <div className={`px-4 py-3 text-center border-t ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
              <p className={`text-xs ${textSec}`}>This request is closed. Open a new request if you need further help.</p>
            </div>
          )}
        </div>
      );
    }

    // ── Request list ────────────────────────────────────────────────────
    if (connectView === "list") {
      return (
        <div className={`rounded-2xl p-5 ${card}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setConnectView("summary")} className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#F2F2F7]"}`}>
                <IoChevronBack size={16} className={textSec} />
              </button>
              <h3 className={`text-sm font-bold ${textPri}`}>My HR Requests</h3>
            </div>
            <button
              onClick={() => { setConnectView("new"); setSubmitSuccess(false); }}
              className={`${btnPrimary} flex items-center gap-1.5 !px-3 !py-2 text-xs`}
            >
              <IoAdd size={14} /> New
            </button>
          </div>

          {submitSuccess && (
            <div className="rounded-xl p-2.5 mb-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
              Request submitted! HR will respond soon.
            </div>
          )}

          {hrLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className={`rounded-xl h-14 animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
              ))}
            </div>
          ) : hrError ? (
            <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
              {hrError}
            </div>
          ) : hrRequests.length === 0 ? (
            <div className={`rounded-xl p-6 text-center ${isDark ? "bg-[#0A0A0A]" : "bg-[#F5F5F7]"} rounded-xl`}>
              <p className={`text-sm ${textSec}`}>No requests yet.</p>
              <p className={`text-xs mt-1 ${textSec}`}>Tap "New" to ask HR a question.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {hrRequests.map((r) => (
                <button
                  key={r.id}
                  onClick={() => openConversation(r.id)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border transition hover:scale-[1.003] cursor-pointer ${isDark ? "border-[#2C2C2E] bg-[#0A0A0A] hover:border-[#38383A]" : "border-[#F2F2F7] bg-white hover:border-[#D1D1D6]"}`}
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon status={r.status} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${textPri}`}>{r.subject}</p>
                      <p className={`text-[10px] ${textSec}`}>
                        {r.category} &middot; {STATUS_LABELS[r.status] || r.status} &middot; {timeAgo(r.updatedAt || r.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.status === "awaiting_employee" && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" title="Awaiting your reply" />
                      )}
                      {r.messageCount > 1 && (
                        <span className={`text-[10px] font-medium ${textSec}`}>{r.messageCount}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── Summary card (default) ──────────────────────────────────────────
    return (
      <div className={`rounded-2xl p-5 ${card}`}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
              HR Connect
            </p>
            <p className={`text-sm ${textSec}`}>Have a question about your salary or payroll? Chat with HR.</p>
          </div>
          <IoChatbubblesOutline size={24} className={`shrink-0 ${isDark ? "text-emerald-400/40" : "text-emerald-600/30"}`} />
        </div>

        {/* Action button */}
        <button
          onClick={() => { setConnectView("new"); setSubmitSuccess(false); }}
          className={`${btnPrimary} flex items-center gap-1.5 text-xs mb-4`}
        >
          <IoAdd size={14} /> Ask HR a Question
        </button>

        {submitSuccess && (
          <div className="rounded-xl p-2.5 mb-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
            Request submitted! HR will respond soon.
          </div>
        )}

        {/* Pending requests summary */}
        {hrLoading ? (
          <div className={`rounded-xl h-10 animate-pulse ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`} />
        ) : openRequests.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className={`text-xs font-semibold ${textPri}`}>
                {openRequests.length} pending request{openRequests.length !== 1 ? "s" : ""}
                {awaitingYou.length > 0 && (
                  <span className="ml-2 text-blue-400 font-bold">
                    {awaitingYou.length} awaiting you
                  </span>
                )}
              </p>
              <button
                onClick={() => setConnectView("list")}
                className={`text-xs font-semibold cursor-pointer ${isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-700"}`}
              >
                View all
              </button>
            </div>

            {/* Show latest 3 requests */}
            {hrRequests.slice(0, 3).map((r) => (
              <button
                key={r.id}
                onClick={() => openConversation(r.id)}
                className={`w-full text-left rounded-xl px-3 py-2 border transition hover:scale-[1.003] cursor-pointer ${isDark ? "border-[#2C2C2E] bg-[#0A0A0A] hover:border-[#38383A]" : "border-[#F2F2F7] bg-white hover:border-[#D1D1D6]"}`}
              >
                <div className="flex items-center gap-2">
                  <StatusIcon status={r.status} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${textPri}`}>{r.subject}</p>
                    <p className={`text-[10px] ${textSec}`}>
                      {STATUS_LABELS[r.status] || r.status} &middot; {timeAgo(r.updatedAt || r.createdAt)}
                    </p>
                  </div>
                  {r.status === "awaiting_employee" && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" title="Awaiting your reply" />
                  )}
                </div>
              </button>
            ))}

            {hrRequests.length > 3 && (
              <button
                onClick={() => setConnectView("list")}
                className={`w-full text-center text-xs font-medium py-1.5 cursor-pointer ${isDark ? "text-emerald-400" : "text-emerald-600"}`}
              >
                View all {hrRequests.length} requests
              </button>
            )}
          </div>
        ) : hrRequests.length > 0 ? (
          <div className="flex items-center justify-between">
            <p className={`text-xs ${textSec}`}>
              {hrRequests.length} past request{hrRequests.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={() => setConnectView("list")}
              className={`text-xs font-semibold cursor-pointer ${isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-700"}`}
            >
              View history
            </button>
          </div>
        ) : !hrError ? (
          <p className={`text-xs ${textSec}`}>No requests yet. Your conversations with HR will appear here.</p>
        ) : null}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OVERVIEW + VERIFYING PHASE
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === "overview" || phase === "verifying") {
    return (
      <div className="space-y-6 p-3 sm:p-6">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
            Compensation
          </p>
          <h2 className={`text-xl font-black ${textPri}`}>My Salary</h2>
          <p className={`text-sm mt-0.5 ${textSec}`}>Click to verify your identity and view details</p>
        </div>

        {dataError && (
          <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-medium">
            {dataError}
          </div>
        )}

        {/* Salary overview card */}
        <button
          onClick={() => setPhase("verifying")}
          className={`w-full text-left rounded-2xl p-6 transition-all cursor-pointer hover:scale-[1.01] ${card}`}
        >
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>Your Salary</p>
          <p className={`text-3xl font-black ${textPri}`}>
            <span className={isDark ? "text-[#48484A]" : "text-[#D1D1D6]"}>Tap to reveal</span>
          </p>
          <p className={`text-xs mt-2 ${textSec}`}>Password verification required</p>
        </button>

        {/* Your Pay card */}
        <button
          onClick={() => setPhase("verifying")}
          className={`w-full text-left rounded-2xl p-6 transition-all cursor-pointer hover:scale-[1.01] ${card}`}
        >
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>Your Pay</p>
          <p className={`text-3xl font-black ${textPri}`}>
            <span className={isDark ? "text-[#48484A]" : "text-[#D1D1D6]"}>Tap to reveal</span>
          </p>
          <p className={`text-xs mt-2 ${textSec}`}>View your latest payslip and payment details</p>
        </button>

        {/* HR Connect — always visible, independent of salary verification */}
        {renderHRConnect()}

        {/* Verification modal */}
        {phase === "verifying" && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className={`w-full max-w-md rounded-3xl p-6 space-y-5 ${isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-2xl"}`}>
              <div>
                <h3 className={`text-lg font-black ${textPri}`}>Verify Your Identity</h3>
                <p className={`text-sm mt-1 ${textSec}`}>
                  Enter your CRM login password to view your detailed salary information.
                </p>
              </div>

              {verifyError && (
                <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium">
                  {verifyError}
                </div>
              )}

              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                  placeholder="Enter your password"
                  className={inputCls}
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold cursor-pointer ${textSec}`}
                  tabIndex={-1}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className={btnPrimary}
                >
                  {verifying ? "Verifying..." : "Continue"}
                </button>
                <button
                  onClick={() => { setPhase("overview"); setPassword(""); setVerifyError(null); }}
                  className={btnSecondary}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DETAILED PHASE (salary unlocked)
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
            Compensation
          </p>
          <h2 className={`text-xl font-black ${textPri}`}>My Salary Details</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dataYear}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            className={`rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`}
          >
            {[0, 1, 2].map((offset) => {
              const y = new Date().getFullYear() - offset;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
          <button onClick={() => { setPhase("overview"); setSalaryToken(null); setData(null); }} className={btnSecondary}>
            Lock
          </button>
        </div>
      </div>

      {dataError && (
        <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium">
          {dataError}
        </div>
      )}

      {dataLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`rounded-2xl animate-pulse h-24 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
          ))}
        </div>
      ) : !data ? (
        <div className={`rounded-2xl p-8 text-center ${card}`}>
          <p className={textSec}>No compensation data available.</p>
        </div>
      ) : (
        <>
          {/* A. Current Compensation Card */}
          <div className={`rounded-2xl p-6 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>
              Current Monthly Salary
            </p>
            {data.currentSalary ? (
              <>
                <p className={`text-3xl font-black ${textPri}`}>
                  {inr(data.currentSalary.baseSalary)}
                  <span className={`text-sm font-medium ml-2 ${textSec}`}>/ month</span>
                </p>
                <p className={`text-xs mt-2 ${textSec}`}>
                  Effective from {new Date(data.currentSalary.effectiveFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  {data.currentSalary.revisionReason && ` — ${data.currentSalary.revisionReason}`}
                </p>
              </>
            ) : (
              <p className={`text-sm ${textSec}`}>No salary configured. Contact HR.</p>
            )}
          </div>

          {/* Your Pay card */}
          {data.latestPay ? (
            <div className={`rounded-2xl p-6 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>
                Your Pay — {MONTHS[data.latestPay.periodMonth - 1]} {data.latestPay.periodYear}
              </p>
              <div className="flex items-baseline gap-4 flex-wrap">
                <p className={`text-3xl font-black text-emerald-${isDark ? "400" : "600"}`}>
                  {inr(data.latestPay.netPayable)}
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${data.latestPay.status === "approved"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                  }`}>
                  {data.latestPay.periodStatus}
                </span>
              </div>
              <div className={`mt-3 flex gap-6 text-xs ${textSec}`}>
                <span>Paid: <strong className={textPri}>{inr(data.latestPay.totalPaid)}</strong></span>
                {data.latestPay.outstanding > 0 && (
                  <span>Outstanding: <strong className="text-amber-400">{inr(data.latestPay.outstanding)}</strong></span>
                )}
              </div>
            </div>
          ) : (
            <div className={`rounded-2xl p-6 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>Your Pay</p>
              <p className={`text-sm ${textSec}`}>No finalized payroll available for {dataYear}.</p>
            </div>
          )}

          {/* B. Salary + Incentive Graph */}
          {chartData.length > 0 && (
            <div className={`rounded-2xl p-5 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-4 ${textSec}`}>
                Monthly Compensation — {dataYear}
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} barCategoryGap="20%">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? "#2C2C2E" : "#E5E5EA"}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: isDark ? "#98989D" : "#86868B" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: isDark ? "#98989D" : "#86868B" }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#1C1C1E" : "#fff",
                      border: `1px solid ${isDark ? "#38383A" : "#E5E5EA"}`,
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value) => inr(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Base Salary" fill={isDark ? "#3B82F6" : "#2563EB"} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Additions" fill={isDark ? "#34D399" : "#059669"} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Deductions" fill={isDark ? "#F87171" : "#DC2626"} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* C. Monthly Payroll History */}
          {data.payrollRecords.length > 0 && (
            <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
              <div className={`px-5 py-3 ${isDark ? "bg-[#1C1C1E]" : "bg-[#F5F5F7]"}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>
                  Monthly Payroll History
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Period</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Base</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Additions</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Deductions</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Net</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Paid</th>
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payrollRecords.map((r, i) => (
                      <tr key={r.id} className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${i % 2 === 0 ? (isDark ? "bg-[#0A0A0A]" : "bg-white") : (isDark ? "bg-[#111]" : "bg-[#FAFAFA]")
                        }`}>
                        <td className={`px-4 py-3 font-semibold text-xs ${textPri}`}>
                          {MONTHS[r.periodMonth - 1]} {r.periodYear}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{inr(r.baseSalary)}</td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalAdditions > 0 ? "text-emerald-400" : textSec}`}>
                          {r.totalAdditions > 0 ? `+${inr(r.totalAdditions)}` : "\u2014"}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalDeductions > 0 ? "text-red-400" : textSec}`}>
                          {r.totalDeductions > 0 ? `-${inr(r.totalDeductions)}` : "\u2014"}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${textPri}`}>{inr(r.netPayable)}</td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalPaid > 0 ? "text-emerald-400" : textSec}`}>
                          {r.totalPaid > 0 ? inr(r.totalPaid) : "\u2014"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${r.status === "approved"
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                            }`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* D. Incentives */}
          {(data.incentiveSummary.approved || data.incentiveSummary.paid) && (
            <div className={`rounded-2xl p-5 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${textSec}`}>
                Incentives — {dataYear}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {data.incentiveSummary.approved && (
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Approved</p>
                    <p className={`text-lg font-black text-emerald-400`}>{inr(data.incentiveSummary.approved.total)}</p>
                    <p className={`text-xs ${textSec}`}>{data.incentiveSummary.approved.count} entries</p>
                  </div>
                )}
                {data.incentiveSummary.paid && (
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Paid</p>
                    <p className={`text-lg font-black ${textPri}`}>{inr(data.incentiveSummary.paid.total)}</p>
                    <p className={`text-xs ${textSec}`}>{data.incentiveSummary.paid.count} entries</p>
                  </div>
                )}
                {data.incentiveSummary.pending && (
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Pending Review</p>
                    <p className={`text-lg font-black text-amber-400`}>{inr(data.incentiveSummary.pending.total)}</p>
                    <p className={`text-xs ${textSec}`}>{data.incentiveSummary.pending.count} entries</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* E. Salary Revision History */}
          {data.salaryHistory && data.salaryHistory.length > 1 && (
            <div className={`rounded-2xl p-5 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${textSec}`}>
                Salary Revision History
              </p>
              <div className="space-y-2">
                {data.salaryHistory.map((s: any, i: number) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-xl ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                    <div>
                      <p className={`text-sm font-semibold ${textPri}`}>{inr(s.baseSalary)}</p>
                      <p className={`text-[10px] ${textSec}`}>
                        {new Date(s.effectiveFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        {s.effectiveTo && ` \u2014 ${new Date(s.effectiveTo).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                      </p>
                    </div>
                    {s.revisionReason && (
                      <p className={`text-xs ${textSec} max-w-[200px] text-right truncate`} title={s.revisionReason}>
                        {s.revisionReason}
                      </p>
                    )}
                    {i === 0 && !s.effectiveTo && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                        Current
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty states */}
          {data.payrollRecords.length === 0 && (
            <div className={`rounded-2xl p-8 text-center ${card}`}>
              <p className={`text-sm ${textSec}`}>No finalized payroll records for {dataYear}.</p>
              <p className={`text-xs mt-1 ${textSec}`}>Payroll records appear here after HR processes and approves them.</p>
            </div>
          )}

          {!data.incentiveSummary.approved && !data.incentiveSummary.paid && (
            <div className={`rounded-2xl p-6 text-center ${card}`}>
              <p className={`text-sm ${textSec}`}>No incentives recorded for {dataYear}.</p>
            </div>
          )}
        </>
      )}

      {/* HR Connect — always visible below salary details */}
      {renderHRConnect()}
    </div>
  );
}
