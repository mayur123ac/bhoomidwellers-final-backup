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
  draft: { bg: "bg-gray-500/15", text: "text-gray-400", border: "border-gray-500/30" },
  exception: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30" },
  submitted: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  approved: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  rejected: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
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

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-3 h-3"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function HRPayroll({ isDark, userRole }: { isDark: boolean; userRole: string }) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textPri = isDark ? "text-white" : "text-[#1D1D1F]";
  const inputCls = `w-full rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`;
  const cellInputCls = `w-24 rounded-lg px-2 py-1 text-xs font-mono text-right border outline-none ${isDark ? "bg-[#2C2C2E] border-[#48484A] text-white focus:border-blue-500" : "bg-white border-[#D1D1D6] text-[#1D1D1F] focus:border-blue-500"}`;
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

  // Individual record submission
  const [confirmSubmitRecord, setConfirmSubmitRecord] = useState<PayrollRecord | null>(null);
  const [recordActionLoading, setRecordActionLoading] = useState(false);

  // ── Inline edit state ───────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBase, setEditBase] = useState(0);
  const [editAdditions, setEditAdditions] = useState(0);
  const [editDeductions, setEditDeductions] = useState(0);
  const [editOverrideNet, setEditOverrideNet] = useState(false);
  const [editNetValue, setEditNetValue] = useState(0);
  const [editNetReason, setEditNetReason] = useState("");
  const [editExceptionReason, setEditExceptionReason] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (r: PayrollRecord) => {
    setEditingId(r.id);
    setEditBase(r.baseSalary);
    setEditAdditions(r.totalAdditions);
    setEditDeductions(r.totalDeductions);
    setEditOverrideNet(false);
    setEditNetValue(r.netPayable);
    setEditNetReason("");
    setEditExceptionReason("");
    setEditSaving(false);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditOverrideNet(false);
  };

  const handleSaveEdit = async (record: PayrollRecord) => {
    // ── Validation ─────────────────────────────────────────────────────
    if (editBase < 0 || !Number.isFinite(editBase)) {
      setError("Base salary must be a valid non-negative number."); return;
    }
    if (editAdditions < 0 || !Number.isFinite(editAdditions)) {
      setError("Additions must be a valid non-negative number."); return;
    }
    if (editDeductions < 0 || !Number.isFinite(editDeductions)) {
      setError("Deductions must be a valid non-negative number."); return;
    }
    if (record.status === "exception" && editBase > 0 && !editExceptionReason.trim()) {
      setError("A justification is required for manual base salary override on exception records."); return;
    }
    if (editOverrideNet && !editNetReason.trim()) {
      setError("A reason is required for net payable override."); return;
    }
    if (editOverrideNet && (editNetValue < 0 || !Number.isFinite(editNetValue))) {
      setError("Override net payable must be a valid non-negative number."); return;
    }

    const computedNet = editBase + editAdditions - editDeductions;
    const finalNet = editOverrideNet ? editNetValue : computedNet;

    // Check nothing changed
    const baseChanged = editBase !== record.baseSalary;
    const addChanged = editAdditions !== record.totalAdditions;
    const dedChanged = editDeductions !== record.totalDeductions;
    const netChanged = finalNet !== record.netPayable;

    if (!baseChanged && !addChanged && !dedChanged && !netChanged && !editOverrideNet) {
      cancelEdit(); return;
    }

    setEditSaving(true);
    setError(null);

    try {
      // ── 1. PATCH record with final values ───────────────────────────
      const patchBody: Record<string, unknown> = {};

      if (baseChanged) {
        patchBody.baseSalary = editBase;
        patchBody.grossSalary = editBase; // gross = base in this payroll system
      }

      if (addChanged) patchBody.totalAdditions = editAdditions;
      if (dedChanged) patchBody.totalDeductions = editDeductions;
      patchBody.netPayable = finalNet;

      // Exception resolution with manual override note
      if (record.status === "exception" && editBase > 0) {
        patchBody.resolveException = true;
        patchBody.exceptionReason = `MANUAL OVERRIDE: ${editExceptionReason.trim()}`;
      }

      const res = await fetch(`/api/hr/payroll/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);

      // ── 2. Create audit adjustment records for changes ──────────────
      const auditPromises: Promise<Response>[] = [];

      if (addChanged) {
        const delta = editAdditions - record.totalAdditions;
        auditPromises.push(
          fetch(`/api/hr/payroll/records/${record.id}/adjustments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: delta > 0 ? "addition" : "deduction",
              category: "Manual Adjustment",
              description: `Inline edit: additions ${inr(record.totalAdditions)} \u2192 ${inr(editAdditions)}`,
              amount: Math.abs(delta),
            }),
          })
        );
      }

      if (dedChanged) {
        const delta = editDeductions - record.totalDeductions;
        auditPromises.push(
          fetch(`/api/hr/payroll/records/${record.id}/adjustments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: delta > 0 ? "deduction" : "addition",
              category: "Manual Adjustment",
              description: `Inline edit: deductions ${inr(record.totalDeductions)} \u2192 ${inr(editDeductions)}`,
              amount: Math.abs(delta),
            }),
          })
        );
      }

      if (editOverrideNet && editNetValue !== computedNet) {
        const overrideDelta = editNetValue - computedNet;
        auditPromises.push(
          fetch(`/api/hr/payroll/records/${record.id}/adjustments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: overrideDelta > 0 ? "addition" : "deduction",
              category: "Net Override",
              description: `Net override: ${inr(computedNet)} \u2192 ${inr(editNetValue)}. Reason: ${editNetReason.trim()}`,
              amount: Math.abs(overrideDelta),
            }),
          })
        );
      }

      // Fire audit adjustments (non-critical — values already saved by PATCH)
      if (auditPromises.length > 0) {
        await Promise.allSettled(auditPromises);
      }

      // ── 3. Re-PATCH to ensure authoritative values survive adjustment recalculation
      if (auditPromises.length > 0) {
        await fetch(`/api/hr/payroll/records/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            totalAdditions: editAdditions,
            totalDeductions: editDeductions,
            netPayable: finalNet,
          }),
        });
      }

      setSuccess("Record updated.");
      setEditingId(null);
      if (selectedPeriod) await openDetail(selectedPeriod);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setEditSaving(false);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSubmitRecord = async (record: PayrollRecord) => {
    setRecordActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/payroll/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess(j.message);
      setConfirmSubmitRecord(null);
      if (selectedPeriod) await openDetail(selectedPeriod);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit.");
    } finally {
      setRecordActionLoading(false);
    }
  };

  // ── Fetch periods ─────────────────────────────────────────────────────────
  const fetchPeriods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/payroll/periods?limit=50");
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setPeriods(j.data?.periods || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load periods.");
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate.");
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
    setEditingId(null);
    try {
      const res = await fetch(`/api/hr/payroll/periods/${period.id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSelectedPeriod(j.data.period);
      setRecords(j.data.records || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load period.");
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Period actions ────────────────────────────────────────────────────────
  const periodAction = async (action: string, extra?: Record<string, unknown>) => {
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
      await openDetail(selectedPeriod);
      fetchPeriods();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setActionLoading(false);
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to record payment.");
    } finally {
      setPaySubmitting(false);
    }
  };

  // ── List View ─────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="space-y-6 p-4">
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
                      className={`border-t cursor-pointer transition-colors ${isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"
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
                        {p.generatedAt ? new Date(p.generatedAt).toLocaleDateString("en-IN") : "\u2014"}
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
          <button onClick={() => { setView("list"); setSelectedPeriod(null); setRecords([]); setEditingId(null); }} className={btnSecondary}>
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
              <span className="text-xs font-semibold px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
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
                {records.map((r, i) => {
                  const isEditing = editingId === r.id;
                  const canEdit = (r.status === "draft" || r.status === "exception") && sp?.status !== "submitted" && sp?.status !== "approved";
                  const isException = r.status === "exception";
                  const computedNet = isEditing ? editBase + editAdditions - editDeductions : 0;
                  const isDirty = isEditing && (
                    editBase !== r.baseSalary ||
                    editAdditions !== r.totalAdditions ||
                    editDeductions !== r.totalDeductions ||
                    editOverrideNet
                  );
                  const rowBg = isEditing
                    ? (isDark ? "bg-blue-500/5" : "bg-blue-50/50")
                    : r.status === "exception"
                      ? (isDark ? "bg-red-500/5" : "bg-red-50")
                      : (i % 2 === 0 ? (isDark ? "bg-[#0A0A0A]" : "bg-white") : (isDark ? "bg-[#111]" : "bg-[#FAFAFA]"));

                  return (
                    <tr
                      key={r.id}
                      className={`border-t transition-colors ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${rowBg}`}
                    >
                      {/* Employee */}
                      <td className="px-4 py-3">
                        <div>
                          <p className={`text-xs font-semibold ${textPri}`}>{r.employeeName}</p>
                          <p className={`text-[10px] ${textSec}`}>ID: {r.userId}</p>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                        {r.exceptionReason && !isEditing && (
                          <p className="text-[10px] text-red-400 mt-1 max-w-[200px]" title={r.exceptionReason}>
                            {r.exceptionReason}
                          </p>
                        )}
                        {r.rejectionReason && r.status === "rejected" && (
                          <p className="text-[10px] text-amber-400 mt-1 max-w-[200px]" title={r.rejectionReason}>
                            Rejected: {r.rejectionReason}
                          </p>
                        )}
                        {r.submittedAt && r.status === "submitted" && (
                          <p className={`text-[10px] mt-1 ${textSec}`}>Pending approval</p>
                        )}
                        {r.approvedAt && r.status === "approved" && (
                          <p className={`text-[10px] mt-1 text-emerald-${isDark ? "400" : "600"}`}>
                            Approved {new Date(r.approvedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </p>
                        )}
                        {isEditing && isDirty && (
                          <p className="text-[10px] text-amber-400 mt-1 font-semibold">Unsaved changes</p>
                        )}
                      </td>

                      {/* Working / Present / Absent */}
                      <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{r.workingDays}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{r.presentDays}</td>
                      <td className={`px-4 py-3 text-right text-xs font-mono ${r.absentDays > 0 ? "text-red-400" : textSec}`}>{r.absentDays}</td>

                      {/* ── Base ───────────────────────────────────────── */}
                      <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <PencilIcon className="w-3 h-3 text-blue-400 shrink-0" />
                            <input
                              type="number"
                              value={editBase}
                              onChange={(e) => setEditBase(Math.max(0, Number(e.target.value) || 0))}
                              className={cellInputCls}
                              min={0}
                              step={1000}
                            />
                          </div>
                        ) : (
                          <span className={canEdit ? "group cursor-pointer" : ""} onClick={canEdit ? (e) => { e.stopPropagation(); startEdit(r); } : undefined}>
                            {inr(r.baseSalary)}
                            {canEdit && <PencilIcon className="w-2.5 h-2.5 inline-block ml-1 opacity-30 group-hover:opacity-80 transition-opacity" />}
                          </span>
                        )}
                      </td>

                      {/* ── Additions ──────────────────────────────────── */}
                      <td className={`px-4 py-3 text-right text-xs font-mono ${isEditing ? "" : (r.totalAdditions > 0 ? "text-emerald-400" : textSec)}`}>
                        {isEditing ? (
                          <div>
                            <div className="flex items-center justify-end gap-1">
                              <PencilIcon className="w-3 h-3 text-blue-400 shrink-0" />
                              <input
                                type="number"
                                value={editAdditions}
                                onChange={(e) => setEditAdditions(Math.max(0, Number(e.target.value) || 0))}
                                className={cellInputCls}
                                min={0}
                                step={500}
                              />
                            </div>
                            {r.incentiveTotal > 0 && (
                              <p className="text-[9px] text-purple-400 mt-0.5 text-right">
                                incl. {inr(r.incentiveTotal)} incentives
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className={canEdit ? "group cursor-pointer" : ""} onClick={canEdit ? (e) => { e.stopPropagation(); startEdit(r); } : undefined}>
                            {r.totalAdditions > 0 ? `+${inr(r.totalAdditions)}` : "\u2014"}
                            {canEdit && <PencilIcon className="w-2.5 h-2.5 inline-block ml-1 opacity-30 group-hover:opacity-80 transition-opacity" />}
                          </span>
                        )}
                      </td>

                      {/* ── Deductions ─────────────────────────────────── */}
                      <td className={`px-4 py-3 text-right text-xs font-mono ${isEditing ? "" : (r.totalDeductions > 0 ? "text-red-400" : textSec)}`}>
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <PencilIcon className="w-3 h-3 text-blue-400 shrink-0" />
                            <input
                              type="number"
                              value={editDeductions}
                              onChange={(e) => setEditDeductions(Math.max(0, Number(e.target.value) || 0))}
                              className={cellInputCls}
                              min={0}
                              step={500}
                            />
                          </div>
                        ) : (
                          <span className={canEdit ? "group cursor-pointer" : ""} onClick={canEdit ? (e) => { e.stopPropagation(); startEdit(r); } : undefined}>
                            {r.totalDeductions > 0 ? `-${inr(r.totalDeductions)}` : "\u2014"}
                            {canEdit && <PencilIcon className="w-2.5 h-2.5 inline-block ml-1 opacity-30 group-hover:opacity-80 transition-opacity" />}
                          </span>
                        )}
                      </td>

                      {/* ── Net ────────────────────────────────────────── */}
                      <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${textPri}`}>
                        {isEditing ? (
                          <div className="text-right">
                            {editOverrideNet ? (
                              <>
                                <p className={`line-through text-[10px] ${textSec}`}>{inr(computedNet)}</p>
                                <p className="text-amber-400 font-bold">{inr(editNetValue)}</p>
                              </>
                            ) : (
                              <p>{inr(computedNet)}</p>
                            )}
                          </div>
                        ) : (
                          inr(r.netPayable)
                        )}
                      </td>

                      {/* ── Actions ────────────────────────────────────── */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="space-y-2">
                            {/* Exception override reason */}
                            {isException && editBase > 0 && (
                              <div className="text-left">
                                <input
                                  value={editExceptionReason}
                                  onChange={(e) => setEditExceptionReason(e.target.value)}
                                  placeholder="Override reason (required)"
                                  className={`w-full rounded-lg px-2 py-1 text-[11px] border outline-none ${isDark ? "bg-[#2C2C2E] border-[#48484A] text-white placeholder:text-[#58585A]" : "bg-white border-[#D1D1D6] text-[#1D1D1F] placeholder:text-[#AEAEB2]"}`}
                                />
                                <p className={`text-[9px] mt-0.5 ${textSec}`}>One-period override only</p>
                              </div>
                            )}

                            {/* Net override controls */}
                            {!editOverrideNet ? (
                              <button
                                onClick={() => { setEditOverrideNet(true); setEditNetValue(computedNet); }}
                                className={`text-[10px] px-2 py-0.5 rounded font-medium cursor-pointer ${isDark ? "text-amber-400 hover:bg-amber-500/10" : "text-amber-600 hover:bg-amber-50"}`}
                              >
                                Override Net
                              </button>
                            ) : (
                              <div className="text-left space-y-1">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={editNetValue}
                                    onChange={(e) => setEditNetValue(Math.max(0, Number(e.target.value) || 0))}
                                    className={cellInputCls}
                                    min={0}
                                  />
                                  <button
                                    onClick={() => { setEditOverrideNet(false); setEditNetReason(""); }}
                                    className={`text-[10px] cursor-pointer ${isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}
                                    title="Cancel override"
                                  >
                                    undo
                                  </button>
                                </div>
                                <input
                                  value={editNetReason}
                                  onChange={(e) => setEditNetReason(e.target.value)}
                                  placeholder="Override reason (required)"
                                  className={`w-full rounded-lg px-2 py-1 text-[11px] border outline-none ${isDark ? "bg-[#2C2C2E] border-[#48484A] text-white placeholder:text-[#58585A]" : "bg-white border-[#D1D1D6] text-[#1D1D1F] placeholder:text-[#AEAEB2]"}`}
                                />
                              </div>
                            )}

                            {/* Save / Cancel */}
                            <div className="flex gap-1 justify-center">
                              <button
                                onClick={() => handleSaveEdit(r)}
                                disabled={editSaving || !isDirty}
                                className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer disabled:opacity-40 ${isDark ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
                              >
                                {editSaving ? "Saving..." : "Save"}
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={editSaving}
                                className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-gray-500/15 text-gray-400 hover:bg-gray-500/25" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-center flex-wrap">
                            {/* Individual submit */}
                            {r.status === "draft" && r.baseSalary > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmSubmitRecord(r); }}
                                className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
                              >
                                Submit
                              </button>
                            )}
                            {/* Resubmit after rejection */}
                            {r.status === "rejected" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmSubmitRecord(r); }}
                                className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
                              >
                                Resubmit
                              </button>
                            )}
                            {/* Inline edit trigger */}
                            {canEdit && (
                              <button
                                onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                                className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}
                              >
                                + Adjust
                              </button>
                            )}
                            {/* Pay button */}
                            {r.status === "approved" && isAdmin && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowPayForm(showPayForm === r.id ? null : r.id); setPayAmount(String(r.netPayable)); }}
                                className={`text-[10px] px-2 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
                              >
                                Pay
                              </button>
                            )}
                          </div>
                        )}

                        {/* Payment form inline */}
                        {showPayForm === r.id && !isEditing && (
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm individual submission modal */}
      {confirmSubmitRecord && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className={`w-full max-w-lg rounded-3xl p-6 space-y-4 ${isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-2xl"}`}>
            <h3 className={`text-lg font-black ${textPri}`}>Submit for Admin Approval</h3>
            <p className={`text-sm ${textSec}`}>
              You are submitting <strong className={textPri}>{confirmSubmitRecord.employeeName}</strong>&apos;s
              payroll for {sp ? `${MONTHS[sp.month - 1]} ${sp.year}` : "this period"}.
            </p>

            <div className={`rounded-xl p-4 space-y-2 ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
              <div className="flex justify-between text-xs">
                <span className={textSec}>Base Salary</span>
                <span className={`font-mono ${textPri}`}>{inr(confirmSubmitRecord.baseSalary)}</span>
              </div>
              {confirmSubmitRecord.totalAdditions > 0 && (
                <div className="flex justify-between text-xs">
                  <span className={textSec}>Additions</span>
                  <span className="font-mono text-emerald-400">+{inr(confirmSubmitRecord.totalAdditions)}</span>
                </div>
              )}
              {confirmSubmitRecord.totalDeductions > 0 && (
                <div className="flex justify-between text-xs">
                  <span className={textSec}>Deductions</span>
                  <span className="font-mono text-red-400">-{inr(confirmSubmitRecord.totalDeductions)}</span>
                </div>
              )}
              <div className={`flex justify-between text-sm font-bold pt-2 border-t ${isDark ? "border-[#38383A]" : "border-[#D1D1D6]"}`}>
                <span className={textPri}>Net Payable</span>
                <span className="font-mono text-emerald-400">{inr(confirmSubmitRecord.netPayable)}</span>
              </div>
              <div className="flex justify-between text-xs pt-1">
                <span className={textSec}>Days</span>
                <span className={`font-mono ${textSec}`}>
                  {confirmSubmitRecord.presentDays}P / {confirmSubmitRecord.leaveDays}L / {confirmSubmitRecord.absentDays}A / {confirmSubmitRecord.workingDays}W
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleSubmitRecord(confirmSubmitRecord)}
                disabled={recordActionLoading}
                className={btnPrimary}
              >
                {recordActionLoading ? "Submitting..." : "Confirm & Submit"}
              </button>
              <button
                onClick={() => setConfirmSubmitRecord(null)}
                className={btnSecondary}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjustments detail per record */}
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
                        {a.description && <span className={textSec}>{"\u2014"} {a.description}</span>}
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
