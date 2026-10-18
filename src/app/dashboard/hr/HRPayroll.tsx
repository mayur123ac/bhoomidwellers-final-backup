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
  adjustments: Adjustment[];
}

interface Adjustment {
  id: number;
  type: "addition" | "deduction";
  category: string;
  description: string | null;
  amount: number;
  source: string;
  sourceId: number | null;
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
export default function HRPayroll({ isDark, userRole }: { isDark: boolean; userRole: string }) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textPri = isDark ? "text-white" : "text-[#1D1D1F]";
  const inputCls = `w-full rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`;
  const btnPrimary = `px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${isDark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`;
  const btnSecondary = `px-4 py-2 rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#D1D1D6] text-[#86868B] hover:border-[#AEAEB2]"}`;
  const btnDanger = `px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer bg-red-600 hover:bg-red-500 text-white`;

  const isAdmin = userRole?.toLowerCase().replace(/_/g, " ") === "admin";

  // ── State ─────────────────────────────────────────────────────────────────
  const [view, setView] = useState<"list" | "detail">("list");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Generate form
  const [showGenerate, setShowGenerate] = useState(false);
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [genMonth, setGenMonth] = useState(new Date().getMonth() || 12); // prev month
  const [generating, setGenerating] = useState(false);

  // Detail view
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Adjustment form
  const [showAdjForm, setShowAdjForm] = useState<number | null>(null);
  const [adjType, setAdjType] = useState<"addition" | "deduction">("addition");
  const [adjCategory, setAdjCategory] = useState("");
  const [adjDesc, setAdjDesc] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjSubmitting, setAdjSubmitting] = useState(false);

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

  useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

  // ── Generate payroll ──────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/payroll/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: genYear, month: genMonth }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess(j.message || "Payroll generated.");
      setShowGenerate(false);
      fetchPeriods();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // ── Load period detail ────────────────────────────────────────────────────
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

  // ── Period actions ────────────────────────────────────────────────────────
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
      // Reload
      await openDetail(selectedPeriod);
      fetchPeriods();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // ── Add adjustment ────────────────────────────────────────────────────────
  const handleAddAdjustment = async (recordId: number) => {
    if (!adjCategory.trim() || !adjAmount || Number(adjAmount) <= 0) {
      setError("Category and positive amount are required.");
      return;
    }
    setAdjSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/records/${recordId}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: adjType,
          category: adjCategory.trim(),
          description: adjDesc.trim() || null,
          amount: Number(adjAmount),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess(j.message);
      setShowAdjForm(null);
      setAdjCategory(""); setAdjDesc(""); setAdjAmount("");
      if (selectedPeriod) await openDetail(selectedPeriod);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdjSubmitting(false);
    }
  };

  // ── Record payment ────────────────────────────────────────────────────────
  const [showPayForm, setShowPayForm] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payRef, setPayRef] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);

  const handleRecordPayment = async (recordId: number) => {
    if (!payAmount || Number(payAmount) <= 0 || !payDate) {
      setError("Amount and payment date are required.");
      return;
    }
    setPaySubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/records/${recordId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(payAmount),
          paymentDate: payDate,
          paymentReference: payRef.trim() || null,
          paymentMethod: payMethod.trim() || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess(j.message);
      setShowPayForm(null);
      setPayAmount(""); setPayRef(""); setPayMethod("");
      if (selectedPeriod) await openDetail(selectedPeriod);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPaySubmitting(false);
    }
  };

  // ── List View ─────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
              HR Dashboard
            </p>
            <h2 className={`text-xl font-black ${textPri}`}>Payroll</h2>
            <p className={`text-sm mt-0.5 ${textSec}`}>Monthly payroll periods and processing</p>
          </div>
          <button onClick={() => setShowGenerate(true)} className={btnPrimary}>
            + Generate Payroll
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
            {success}
          </div>
        )}

        {/* Generate form */}
        {showGenerate && (
          <div className={`rounded-2xl p-5 space-y-4 ${card}`}>
            <h3 className={`text-sm font-bold ${textPri}`}>Generate Monthly Payroll</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`text-xs font-semibold block mb-1 ${textSec}`}>Year</label>
                <input type="number" value={genYear} onChange={(e) => setGenYear(Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={`text-xs font-semibold block mb-1 ${textSec}`}>Month</label>
                <select value={genMonth} onChange={(e) => setGenMonth(Number(e.target.value))} className={inputCls}>
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleGenerate} disabled={generating} className={btnPrimary}>
                {generating ? "Generating..." : "Generate"}
              </button>
              <button onClick={() => setShowGenerate(false)} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        )}

        {/* Periods table */}
        {loading ? (
          <div className={`rounded-3xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
        ) : periods.length === 0 ? (
          <div className={`rounded-3xl p-10 flex flex-col items-center text-center gap-3 border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
            <p className={`text-sm ${textSec}`}>No payroll periods yet. Generate your first payroll above.</p>
          </div>
        ) : (
          <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Period</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Employees</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Total Gross</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Net Payable</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Generated</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p, i) => (
                    <tr
                      key={p.id}
                      onClick={() => openDetail(p)}
                      className={`border-t cursor-pointer transition-colors ${
                        isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"
                      } ${i % 2 === 0 ? (isDark ? "bg-[#0A0A0A]" : "bg-white") : (isDark ? "bg-[#111]" : "bg-[#FAFAFA]")}`}
                    >
                      <td className={`px-4 py-3 font-semibold text-xs ${textPri}`}>
                        {MONTHS[p.month - 1]} {p.year}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                      <td className={`px-4 py-3 text-right text-xs ${textSec}`}>{p.employeeCount}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{inr(p.totalGross)}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${textPri}`}>{inr(p.totalNet)}</td>
                      <td className={`px-4 py-3 text-right text-xs ${textSec}`}>
                        {p.generatedAt ? new Date(p.generatedAt).toLocaleDateString("en-IN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Detail View ───────────────────────────────────────────────────────────
  const sp = selectedPeriod;

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => { setView("list"); setSelectedPeriod(null); setRecords([]); }} className={btnSecondary}>
            Back
          </button>
          <div>
            <h2 className={`text-xl font-black ${textPri}`}>
              {sp ? `${MONTHS[sp.month - 1]} ${sp.year}` : "Period Detail"}
            </h2>
            {sp && (
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={sp.status} />
                <span className={`text-xs ${textSec}`}>
                  {sp.employeeCount} employees
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {sp && (
          <div className="flex gap-2 flex-wrap">
            {(sp.status === "draft" || sp.status === "rejected") && (
              <button
                onClick={() => periodAction("submit")}
                disabled={actionLoading}
                className={btnPrimary}
              >
                {actionLoading ? "..." : "Submit for Approval"}
              </button>
            )}
            {sp.status === "submitted" && isAdmin && (
              <>
                <button
                  onClick={() => periodAction("approve")}
                  disabled={actionLoading}
                  className={btnPrimary}
                >
                  {actionLoading ? "..." : "Approve"}
                </button>
                <button
                  onClick={() => setShowRejectForm(true)}
                  disabled={actionLoading}
                  className={btnDanger}
                >
                  Reject
                </button>
              </>
            )}
            {sp.status === "approved" && isAdmin && (
              <span className={`text-xs font-semibold px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30`}>
                Approved
              </span>
            )}
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

      {/* Rejection reason form */}
      {showRejectForm && (
        <div className={`rounded-2xl p-5 space-y-3 ${card}`}>
          <h3 className={`text-sm font-bold ${textPri}`}>Reject Payroll</h3>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
            rows={3}
            className={inputCls}
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

      {/* Rejection notice */}
      {sp?.rejectionReason && sp.status === "rejected" && (
        <div className={`rounded-xl p-4 border ${isDark ? "bg-amber-500/5 border-amber-500/20" : "bg-amber-50 border-amber-200"}`}>
          <p className={`text-xs font-bold uppercase tracking-wider mb-1 text-amber-${isDark ? "400" : "600"}`}>Rejection Reason</p>
          <p className={`text-sm ${textPri}`}>{sp.rejectionReason}</p>
        </div>
      )}

      {/* Summary KPIs */}
      {sp && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Gross</p>
            <p className={`text-lg font-black ${textPri}`}>{inr(sp.totalGross)}</p>
          </div>
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Deductions</p>
            <p className="text-lg font-black text-red-400">{inr(sp.totalDeductions)}</p>
          </div>
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Net Payable</p>
            <p className="text-lg font-black text-emerald-400">{inr(sp.totalNet)}</p>
          </div>
          <div className={`rounded-2xl p-4 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Employees</p>
            <p className={`text-lg font-black ${textPri}`}>{sp.employeeCount}</p>
          </div>
        </div>
      )}

      {/* Records table */}
      {detailLoading ? (
        <div className={`rounded-3xl animate-pulse h-64 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
      ) : records.length === 0 ? (
        <div className={`rounded-3xl p-10 flex flex-col items-center text-center gap-3 border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>No records in this period.</p>
        </div>
      ) : (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Employee</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Working</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Present</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Absent</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Base</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Additions</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Deductions</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Net</th>
                  <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`border-t transition-colors ${
                      isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"
                    } ${r.status === "exception" ? (isDark ? "bg-red-500/5" : "bg-red-50") : (i % 2 === 0 ? (isDark ? "bg-[#0A0A0A]" : "bg-white") : (isDark ? "bg-[#111]" : "bg-[#FAFAFA]"))}`}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className={`text-xs font-semibold ${textPri}`}>{r.employeeName}</p>
                        <p className={`text-[10px] ${textSec}`}>ID: {r.userId}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                      {r.exceptionReason && (
                        <p className="text-[10px] text-red-400 mt-1 max-w-[150px] truncate" title={r.exceptionReason}>
                          {r.exceptionReason}
                        </p>
                      )}
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
                    <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${textPri}`}>{inr(r.netPayable)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        {(r.status === "draft" || r.status === "exception") && sp?.status !== "submitted" && sp?.status !== "approved" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowAdjForm(showAdjForm === r.id ? null : r.id); }}
                            className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
                          >
                            + Adjust
                          </button>
                        )}
                        {r.status === "approved" && isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowPayForm(showPayForm === r.id ? null : r.id); setPayAmount(String(r.netPayable)); }}
                            className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
                          >
                            Pay
                          </button>
                        )}
                      </div>

                      {/* Adjustment form inline */}
                      {showAdjForm === r.id && (
                        <div className={`mt-2 p-3 rounded-xl text-left space-y-2 ${card}`} onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-2">
                            <select value={adjType} onChange={(e) => setAdjType(e.target.value as any)} className={`${inputCls} !w-auto`}>
                              <option value="addition">Addition</option>
                              <option value="deduction">Deduction</option>
                            </select>
                            <input value={adjCategory} onChange={(e) => setAdjCategory(e.target.value)} placeholder="Category" className={inputCls} />
                          </div>
                          <input value={adjDesc} onChange={(e) => setAdjDesc(e.target.value)} placeholder="Description (optional)" className={inputCls} />
                          <input type="number" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="Amount" className={inputCls} />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAddAdjustment(r.id)}
                              disabled={adjSubmitting}
                              className={`text-xs ${btnPrimary}`}
                            >
                              {adjSubmitting ? "..." : "Add"}
                            </button>
                            <button onClick={() => setShowAdjForm(null)} className={`text-xs ${btnSecondary}`}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Payment form inline */}
                      {showPayForm === r.id && (
                        <div className={`mt-2 p-3 rounded-xl text-left space-y-2 ${card}`} onClick={(e) => e.stopPropagation()}>
                          <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Amount" className={inputCls} />
                          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputCls} />
                          <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Reference (optional)" className={inputCls} />
                          <input value={payMethod} onChange={(e) => setPayMethod(e.target.value)} placeholder="Method (optional)" className={inputCls} />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRecordPayment(r.id)}
                              disabled={paySubmitting}
                              className={`text-xs ${btnPrimary}`}
                            >
                              {paySubmitting ? "..." : "Record Payment"}
                            </button>
                            <button onClick={() => setShowPayForm(null)} className={`text-xs ${btnSecondary}`}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Adjustments detail per record (expandable) */}
      {records.filter((r) => r.adjustments.length > 0).length > 0 && (
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
