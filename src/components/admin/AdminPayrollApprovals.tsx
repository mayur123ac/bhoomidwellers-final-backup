"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ───────────────────────────────────────────────────────────────────
interface Period {
  id: number;
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  employeeCount: number;
  generatedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
}

interface PayrollRecord {
  id: number;
  userId: number;
  employeeName: string;
  employeeEmail: string;
  employeeCode: string | null;
  baseSalary: number;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  holidayDays: number;
  weekOffDays: number;
  absentDays: number;
  grossSalary: number;
  totalAdditions: number;
  totalDeductions: number;
  netPayable: number;
  incentiveTotal: number;
  status: string;
  exceptionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  adjustments: { id: number; type: string; category: string; description: string | null; amount: number; source: string }[];
}

interface IndividualRecord {
  id: number;
  userId: number;
  periodId: number;
  periodYear: number;
  periodMonth: number;
  periodStatus: string;
  employeeName: string;
  employeeEmail: string;
  employeeCode: string | null;
  baseSalary: number;
  grossSalary: number;
  totalAdditions: number;
  totalDeductions: number;
  netPayable: number;
  incentiveTotal: number;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  holidayDays: number;
  weekOffDays: number;
  absentDays: number;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft:     { bg: "bg-gray-500/15",    text: "text-gray-400",    border: "border-gray-500/30" },
  exception: { bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30" },
  submitted: { bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/30" },
  approved:  { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  rejected:  { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`}>
      {status}
    </span>
  );
}

function inr(n: number) {
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function AdminPayrollApprovals({ isDark }: { isDark: boolean }) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textPri = isDark ? "text-white" : "text-[#1D1D1F]";
  const inputCls = `w-full rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`;
  const btnPrimary = `px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${isDark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`;
  const btnSecondary = `px-4 py-2 rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#D1D1D6] text-[#86868B] hover:border-[#AEAEB2]"}`;
  const btnDanger = `px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer bg-red-600 hover:bg-red-500 text-white`;

  // ── State ─────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"individual" | "pending" | "history">("individual");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Detail view
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Individual record approvals
  const [individualRecords, setIndividualRecords] = useState<IndividualRecord[]>([]);
  const [individualLoading, setIndividualLoading] = useState(true);
  const [individualActionLoading, setIndividualActionLoading] = useState<number | null>(null);
  const [individualRejectId, setIndividualRejectId] = useState<number | null>(null);
  const [individualRejectReason, setIndividualRejectReason] = useState("");

  // ── Derived ─────────────────────────────────────────────────────────────
  const pending = periods.filter((p) => p.status === "submitted");
  const history = periods.filter((p) => p.status === "approved" || p.status === "rejected");
  const pendingIndividual = individualRecords.filter((r) => r.status === "submitted");
  const historyIndividual = individualRecords.filter((r) => r.status === "approved" || r.status === "rejected");

  // ── Fetch periods ─────────────────────────────────────────────────────────
  const fetchPeriods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/payroll/periods?limit=50");
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setPeriods(j.data?.periods || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch individual records (submitted + recently approved/rejected) ───
  const fetchIndividualRecords = useCallback(async () => {
    setIndividualLoading(true);
    try {
      // Fetch submitted records
      const [subRes, appRes, rejRes] = await Promise.all([
        fetch("/api/hr/payroll/records?status=submitted&limit=50"),
        fetch("/api/hr/payroll/records?status=approved&limit=20"),
        fetch("/api/hr/payroll/records?status=rejected&limit=20"),
      ]);
      const [subJ, appJ, rejJ] = await Promise.all([subRes.json(), appRes.json(), rejRes.json()]);
      const all = [
        ...(subJ.data?.records || []),
        ...(appJ.data?.records || []),
        ...(rejJ.data?.records || []),
      ];
      // Deduplicate by id
      const byId = new Map<number, IndividualRecord>();
      for (const r of all) byId.set(r.id, r);
      // Only include records that have submittedAt (individually submitted, not batch-cascaded without timestamp)
      setIndividualRecords(Array.from(byId.values()).filter((r) => r.submittedAt));
    } catch {
      // Non-critical — periods are the primary data
    } finally {
      setIndividualLoading(false);
    }
  }, []);

  useEffect(() => { fetchPeriods(); fetchIndividualRecords(); }, [fetchPeriods, fetchIndividualRecords]);

  // ── Individual record actions ─────────────────────────────────────────
  const handleIndividualAction = async (recordId: number, action: string, extra?: Record<string, any>) => {
    setIndividualActionLoading(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess(j.message);
      setIndividualRejectId(null);
      setIndividualRejectReason("");
      fetchIndividualRecords();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIndividualActionLoading(null);
    }
  };

  // ── Open detail ─────────────────────────────────────────────────────────
  const openDetail = async (period: Period) => {
    setSelectedPeriod(period);
    setView("detail");
    setDetailLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/periods/${period.id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSelectedPeriod(j.data.period);
      setRecords(j.data.records || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Approve / Reject ────────────────────────────────────────────────────
  const periodAction = async (action: string, extra?: Record<string, any>) => {
    if (!selectedPeriod) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/periods/${selectedPeriod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess(j.message);
      setShowRejectForm(false);
      setRejectReason("");
      setView("list");
      setSelectedPeriod(null);
      setRecords([]);
      fetchPeriods();
      fetchIndividualRecords();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Detail View ──────────────────────────────────────────────────────────
  if (view === "detail" && selectedPeriod) {
    const sp = selectedPeriod;

    // Totals from records
    const totalBase = records.reduce((s, r) => s + r.baseSalary, 0);
    const totalAdditions = records.reduce((s, r) => s + r.totalAdditions, 0);
    const totalIncentives = records.reduce((s, r) => s + r.incentiveTotal, 0);
    const totalDeductions = records.reduce((s, r) => s + r.totalDeductions, 0);

    return (
      <div className="space-y-6">
        {/* Back + Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => { setView("list"); setSelectedPeriod(null); setRecords([]); setShowRejectForm(false); }} className={btnSecondary}>
              Back
            </button>
            <div>
              <h2 className={`text-xl font-black ${textPri}`}>
                {MONTHS[sp.month - 1]} {sp.year} — Payroll Review
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={sp.status} />
                <span className={`text-xs ${textSec}`}>
                  {sp.employeeCount} employees • Submitted {sp.submittedAt ? new Date(sp.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Approve / Reject actions */}
          {sp.status === "submitted" && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => periodAction("approve")}
                disabled={actionLoading}
                className={btnPrimary}
              >
                {actionLoading ? "..." : "Approve Payroll"}
              </button>
              <button
                onClick={() => setShowRejectForm(true)}
                disabled={actionLoading}
                className={btnDanger}
              >
                Reject
              </button>
            </div>
          )}
        </div>

        {/* Messages */}
        {error && (
          <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline text-xs">dismiss</button>
          </div>
        )}
        {success && (
          <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
            {success}
          </div>
        )}

        {/* Rejection form */}
        {showRejectForm && (
          <div className={`rounded-2xl p-5 space-y-3 ${card}`}>
            <h3 className={`text-sm font-bold ${textPri}`}>Reject Payroll</h3>
            <p className={`text-xs ${textSec}`}>
              Provide a reason so HR can review and correct the submission.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              rows={3}
              className={inputCls}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => periodAction("reject", { rejectionReason: rejectReason })}
                disabled={actionLoading || !rejectReason.trim()}
                className={btnDanger}
              >
                {actionLoading ? "..." : "Confirm Reject"}
              </button>
              <button onClick={() => { setShowRejectForm(false); setRejectReason(""); }} className={btnSecondary}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Rejection history */}
        {sp.rejectionReason && sp.status === "rejected" && (
          <div className={`rounded-xl p-4 border ${isDark ? "bg-amber-500/5 border-amber-500/20" : "bg-amber-50 border-amber-200"}`}>
            <p className={`text-xs font-bold uppercase tracking-wider mb-1 text-amber-${isDark ? "400" : "600"}`}>Rejection Reason</p>
            <p className={`text-sm ${textPri}`}>{sp.rejectionReason}</p>
            {sp.rejectedAt && (
              <p className={`text-xs mt-1 ${textSec}`}>
                Rejected on {new Date(sp.rejectedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Employees</p>
            <p className={`text-lg font-black ${textPri}`}>{sp.employeeCount}</p>
          </div>
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Total Base</p>
            <p className={`text-lg font-black ${textPri}`}>{inr(totalBase)}</p>
          </div>
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Additions</p>
            <p className="text-lg font-black text-emerald-400">{inr(totalAdditions + totalIncentives)}</p>
          </div>
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Deductions</p>
            <p className="text-lg font-black text-red-400">{inr(totalDeductions)}</p>
          </div>
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Net Payroll</p>
            <p className="text-lg font-black text-emerald-400">{inr(sp.totalNet)}</p>
          </div>
        </div>

        {/* Employee breakdown table */}
        {detailLoading ? (
          <div className={`rounded-3xl animate-pulse h-64 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
        ) : records.length === 0 ? (
          <div className={`rounded-3xl p-10 flex flex-col items-center text-center gap-3 border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
            <p className={`text-sm ${textSec}`}>No records in this period.</p>
          </div>
        ) : (
          <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
            <div className={`px-5 py-3 ${isDark ? "bg-[#1C1C1E]" : "bg-[#F5F5F7]"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>
                Employee-by-Employee Breakdown
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Employee</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Working</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Present</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Absent</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Base</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Additions</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Deductions</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Incentives</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${
                        i % 2 === 0 ? (isDark ? "bg-[#0A0A0A]" : "bg-white") : (isDark ? "bg-[#111]" : "bg-[#FAFAFA]")
                      }`}
                    >
                      <td className="px-4 py-3">
                        <p className={`text-xs font-semibold ${textPri}`}>{r.employeeName}</p>
                        <p className={`text-[10px] ${textSec}`}>
                          {r.employeeCode ? `${r.employeeCode} • ` : ""}ID: {r.userId}
                        </p>
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{r.workingDays}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{r.presentDays}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${r.absentDays > 0 ? "text-red-400" : textSec}`}>{r.absentDays}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{inr(r.baseSalary)}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalAdditions > 0 ? "text-emerald-400" : textSec}`}>
                        {r.totalAdditions > 0 ? `+${inr(r.totalAdditions)}` : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalDeductions > 0 ? "text-red-400" : textSec}`}>
                        {r.totalDeductions > 0 ? `-${inr(r.totalDeductions)}` : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${r.incentiveTotal > 0 ? "text-blue-400" : textSec}`}>
                        {r.incentiveTotal > 0 ? inr(r.incentiveTotal) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${textPri}`}>{inr(r.netPayable)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`border-t-2 ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-[#F5F5F7]"}`}>
                    <td className={`px-4 py-3 text-xs font-bold ${textPri}`}>Total ({records.length} employees)</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className={`px-4 py-3 text-right text-xs font-mono font-bold ${textPri}`}>{inr(totalBase)}</td>
                    <td className="px-4 py-3 text-right text-xs font-mono font-bold text-emerald-400">
                      {totalAdditions > 0 ? `+${inr(totalAdditions)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono font-bold text-red-400">
                      {totalDeductions > 0 ? `-${inr(totalDeductions)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono font-bold text-blue-400">
                      {totalIncentives > 0 ? inr(totalIncentives) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right text-xs font-mono font-black ${textPri}`}>{inr(sp.totalNet)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Adjustments detail */}
        {records.some((r) => r.adjustments.length > 0) && (
          <div className={`rounded-2xl p-5 space-y-4 ${card}`}>
            <h3 className={`text-sm font-bold ${textPri}`}>Adjustments Detail</h3>
            {records
              .filter((r) => r.adjustments.length > 0)
              .map((r) => (
                <div key={r.id} className="space-y-2">
                  <p className={`text-xs font-semibold ${textSec}`}>{r.employeeName}</p>
                  <div className="space-y-1">
                    {r.adjustments.map((a) => (
                      <div key={a.id} className={`flex items-center justify-between text-xs px-3 py-1.5 rounded-lg ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${a.type === "addition" ? "text-emerald-400" : "text-red-400"}`}>
                            {a.type === "addition" ? "+" : "-"}
                          </span>
                          <span className={textPri}>{a.category}</span>
                          {a.description && <span className={textSec}>— {a.description}</span>}
                          {a.source !== "manual" && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? "bg-purple-500/15 text-purple-400" : "bg-purple-100 text-purple-700"}`}>
                              {a.source}
                            </span>
                          )}
                        </div>
                        <span className={`font-mono font-semibold ${a.type === "addition" ? "text-emerald-400" : "text-red-400"}`}>
                          {inr(a.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  }

  // ── List View ──────────────────────────────────────────────────────────────
  const displayList = tab === "pending" ? pending : history;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
          Admin
        </p>
        <h2 className={`text-xl font-black ${textPri}`}>Payroll Approvals</h2>
        <p className={`text-sm mt-0.5 ${textSec}`}>Review and approve monthly payroll submissions from HR</p>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-xs">dismiss</button>
        </div>
      )}
      {success && (
        <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {([
          { id: "individual" as const, label: "Individual", count: pendingIndividual.length },
          { id: "pending" as const, label: "Batch Periods", count: pending.length },
          { id: "history" as const, label: "History", count: 0 },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
              tab === t.id
                ? (isDark ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-blue-100 text-blue-700 border border-blue-200")
                : (isDark ? "text-[#98989D] hover:text-white" : "text-[#86868B] hover:text-[#1D1D1F]")
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold bg-blue-500 text-white">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Individual Records Tab ─────────────────────────────────────────── */}
      {tab === "individual" && (
        <>
          {individualLoading ? (
            <div className={`rounded-3xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
          ) : pendingIndividual.length === 0 && historyIndividual.length === 0 ? (
            <div className={`rounded-3xl p-10 flex flex-col items-center text-center gap-3 border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
              <p className={`text-sm ${textSec}`}>No individual salary submissions awaiting your approval.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Pending individual submissions */}
              {pendingIndividual.length > 0 && (
                <div className="space-y-3">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>
                    Pending Approval ({pendingIndividual.length})
                  </p>
                  {pendingIndividual.map((r) => (
                    <div key={r.id} className={`rounded-2xl p-5 ${card}`}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                          <h3 className={`text-base font-black ${textPri}`}>{r.employeeName}</h3>
                          <p className={`text-xs ${textSec}`}>
                            {r.employeeCode ? `${r.employeeCode} • ` : ""}ID: {r.userId} • {MONTHS[r.periodMonth - 1]} {r.periodYear}
                          </p>
                          {r.submittedAt && (
                            <p className={`text-[10px] mt-1 ${textSec}`}>
                              Submitted {new Date(r.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                        </div>
                        <p className={`text-xl font-black text-blue-400 shrink-0`}>
                          {inr(r.netPayable)}
                        </p>
                      </div>

                      {/* Breakdown */}
                      <div className={`mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs`}>
                        <div><span className={textSec}>Base:</span> <span className={`font-mono ${textPri}`}>{inr(r.baseSalary)}</span></div>
                        <div><span className={textSec}>Additions:</span> <span className="font-mono text-emerald-400">{r.totalAdditions > 0 ? `+${inr(r.totalAdditions)}` : "—"}</span></div>
                        <div><span className={textSec}>Deductions:</span> <span className="font-mono text-red-400">{r.totalDeductions > 0 ? `-${inr(r.totalDeductions)}` : "—"}</span></div>
                        <div><span className={textSec}>Days:</span> <span className={`font-mono ${textSec}`}>{r.presentDays}P / {r.leaveDays}L / {r.absentDays}A</span></div>
                      </div>

                      {/* Rejection reason inline form */}
                      {individualRejectId === r.id && (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={individualRejectReason}
                            onChange={(e) => setIndividualRejectReason(e.target.value)}
                            placeholder="Reason for rejection..."
                            rows={2}
                            className={inputCls}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleIndividualAction(r.id, "reject", { rejectionReason: individualRejectReason })}
                              disabled={individualActionLoading === r.id || !individualRejectReason.trim()}
                              className={btnDanger}
                            >
                              {individualActionLoading === r.id ? "..." : "Confirm Reject"}
                            </button>
                            <button onClick={() => { setIndividualRejectId(null); setIndividualRejectReason(""); }} className={btnSecondary}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      {individualRejectId !== r.id && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => handleIndividualAction(r.id, "approve")}
                            disabled={individualActionLoading === r.id}
                            className={btnPrimary}
                          >
                            {individualActionLoading === r.id ? "..." : "Approve"}
                          </button>
                          <button
                            onClick={() => setIndividualRejectId(r.id)}
                            disabled={individualActionLoading === r.id}
                            className={btnDanger}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Recently actioned individual records */}
              {historyIndividual.length > 0 && (
                <div className="space-y-3">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>
                    Recent Individual Decisions
                  </p>
                  {historyIndividual.slice(0, 10).map((r) => (
                    <div key={r.id} className={`rounded-2xl p-4 ${card}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-semibold ${textPri}`}>{r.employeeName}</p>
                            <StatusBadge status={r.status} />
                          </div>
                          <p className={`text-[10px] ${textSec}`}>
                            {MONTHS[r.periodMonth - 1]} {r.periodYear}
                            {r.approvedAt && ` • Approved ${new Date(r.approvedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                            {r.rejectedAt && ` • Rejected ${new Date(r.rejectedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                          </p>
                          {r.rejectionReason && (
                            <p className={`text-xs mt-0.5 text-amber-400 max-w-md truncate`} title={r.rejectionReason}>
                              Reason: {r.rejectionReason}
                            </p>
                          )}
                        </div>
                        <p className={`text-sm font-mono font-semibold ${textPri}`}>{inr(r.netPayable)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Batch Periods Tabs (pending / history) ─────────────────────────── */}
      {(tab === "pending" || tab === "history") && (loading ? (
        <div className={`rounded-3xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
      ) : displayList.length === 0 ? (
        <div className={`rounded-3xl p-10 flex flex-col items-center text-center gap-3 border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>
            {tab === "pending"
              ? "No batch payroll submissions awaiting your approval."
              : "No batch approval history yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map((p) => (
            <button
              key={p.id}
              onClick={() => openDetail(p)}
              className={`w-full text-left rounded-2xl p-5 transition-all cursor-pointer hover:scale-[1.005] ${card}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`text-base font-black ${textPri}`}>
                      {MONTHS[p.month - 1]} {p.year}
                    </h3>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className={`flex gap-4 text-xs ${textSec}`}>
                    <span>{p.employeeCount} employees</span>
                    <span>Gross: {inr(p.totalGross)}</span>
                    <span>Net: <strong className={textPri}>{inr(p.totalNet)}</strong></span>
                  </div>
                  {p.submittedAt && (
                    <p className={`text-[10px] mt-1.5 ${textSec}`}>
                      Submitted {new Date(p.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                  {p.status === "approved" && p.approvedAt && (
                    <p className={`text-[10px] mt-1 text-emerald-${isDark ? "400" : "600"}`}>
                      Approved {new Date(p.approvedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                  {p.status === "rejected" && (
                    <>
                      <p className={`text-[10px] mt-1 text-amber-${isDark ? "400" : "600"}`}>
                        Rejected {p.rejectedAt ? new Date(p.rejectedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                      </p>
                      {p.rejectionReason && (
                        <p className={`text-xs mt-0.5 ${textSec} max-w-md truncate`} title={p.rejectionReason}>
                          Reason: {p.rejectionReason}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className={`text-right shrink-0`}>
                  <p className={`text-xl font-black ${p.status === "submitted" ? "text-blue-400" : p.status === "approved" ? "text-emerald-400" : textPri}`}>
                    {inr(p.totalNet)}
                  </p>
                  <p className={`text-[10px] ${textSec}`}>net payable</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
