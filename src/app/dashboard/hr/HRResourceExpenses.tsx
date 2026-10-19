"use client";

import { useEffect, useState, useCallback } from "react";
import {
  IoAddOutline,
  IoTrashOutline,
  IoPhonePortraitOutline,
  IoLaptopOutline,
  IoCarOutline,
  IoCubeOutline,
  IoCheckmarkCircle,
  IoCloseCircle,
} from "react-icons/io5";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ResourceExpense {
  id: number;
  userId: number;
  employeeName: string;
  expenseType: string;
  description: string;
  purchaseDate: string;
  purchaseCost: number;
  allocationMethod: string;
  allocationMonths: number;
  monthlyAmount: number;
  allocationStart: string;
  allocationEnd: string;
  isCompanyExpense: boolean;
  status: string;
}

interface Employee {
  id: number;
  name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

const EXPENSE_ICONS: Record<string, React.ComponentType<{ size: number; className?: string }>> = {
  phone: IoPhonePortraitOutline,
  laptop: IoLaptopOutline,
  travel: IoCarOutline,
  furniture: IoCubeOutline,
  software: IoCubeOutline,
  other: IoCubeOutline,
};

const EXPENSE_LABELS: Record<string, string> = {
  phone: "Phone",
  laptop: "Laptop",
  furniture: "Furniture",
  travel: "Travel",
  software: "Software",
  other: "Other",
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function HRResourceExpenses({ isDark }: { isDark: boolean }) {
  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textAccent = isDark ? "text-emerald-400" : "text-emerald-600";
  const cardCls = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const inputCls = `w-full px-3 py-2 rounded-xl text-sm border outline-none transition-colors ${
    isDark ? "bg-[#2C2C2E] border-[#38383A] text-white focus:border-emerald-500" : "bg-white border-[#E5E5EA] text-[#1D1D1F] focus:border-emerald-500"
  }`;
  const btnPrimary = `px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all ${
    isDark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"
  }`;
  const btnSecondary = `px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all border ${
    isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#E5E5EA] text-[#86868B] hover:border-[#D1D1D6]"
  }`;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ResourceExpense[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    userId: "",
    expenseType: "phone",
    description: "",
    purchaseDate: new Date().toISOString().slice(0, 10),
    purchaseCost: "",
    allocationMethod: "one_time" as "one_time" | "monthly",
    allocationMonths: "12",
    isCompanyExpense: true,
  });

  const fetchExpenses = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/resource-expenses?page=${p}&limit=15`);
      const j = await res.json();
      if (j.success) {
        setExpenses(j.data.records);
        setTotal(j.data.pagination.total);
        setPage(p);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/employees");
      const j = await res.json();
      if (j.success) {
        setEmployees((j.data || []).map((e: any) => ({ id: e.id, name: e.name })));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchExpenses(); fetchEmployees(); }, [fetchExpenses, fetchEmployees]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 4000); return () => clearTimeout(t); }
  }, [success]);

  const createExpense = async () => {
    if (!form.userId || !form.description || !form.purchaseCost) {
      setError("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/resource-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: Number(form.userId),
          expenseType: form.expenseType,
          description: form.description,
          purchaseDate: form.purchaseDate,
          purchaseCost: Number(form.purchaseCost),
          allocationMethod: form.allocationMethod,
          allocationMonths: form.allocationMethod === "monthly" ? Number(form.allocationMonths) : 1,
          isCompanyExpense: form.isCompanyExpense,
        }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message);
      setSuccess("Resource expense recorded.");
      setShowForm(false);
      setForm({
        userId: "", expenseType: "phone", description: "", purchaseDate: new Date().toISOString().slice(0, 10),
        purchaseCost: "", allocationMethod: "one_time", allocationMonths: "12", isCompanyExpense: true,
      });
      fetchExpenses(page);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const writeOff = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/resource-expenses/${id}`, { method: "DELETE" });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message);
      setSuccess("Expense written off.");
      fetchExpenses(page);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Summary stats
  const totalActive = expenses.filter((e) => e.status === "active").reduce((s, e) => s + e.purchaseCost, 0);
  const totalMonthly = expenses.filter((e) => e.status === "active" && e.allocationMethod === "monthly").reduce((s, e) => s + e.monthlyAmount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${textAccent}`}>Expenses</p>
          <h2 className={`text-xl font-black ${textPrimary}`}>Employee Resources</h2>
          <p className={`text-sm mt-0.5 ${textSecondary}`}>
            Track phone, laptop, and other resource costs allocated to employees
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className={btnPrimary}>
          <span className="flex items-center gap-1.5">
            <IoAddOutline size={16} /> Add Expense
          </span>
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium flex items-center gap-2">
          <IoCloseCircle size={16} /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs underline cursor-pointer">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium flex items-center gap-2">
          <IoCheckmarkCircle size={16} /> {success}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`rounded-2xl p-4 ${cardCls}`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${textSecondary}`}>Total Active Expenses</span>
          <p className={`text-2xl font-black mt-1 ${textPrimary}`}>{fmtCurrency(totalActive)}</p>
          <span className={`text-xs ${textSecondary}`}>{expenses.filter((e) => e.status === "active").length} items</span>
        </div>
        <div className={`rounded-2xl p-4 ${cardCls}`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${textSecondary}`}>Monthly Allocation</span>
          <p className={`text-2xl font-black mt-1 ${textAccent}`}>{fmtCurrency(totalMonthly)}</p>
          <span className={`text-xs ${textSecondary}`}>Per month cost spread</span>
        </div>
      </div>

      {/* Add Expense Form */}
      {showForm && (
        <div className={`rounded-2xl p-5 border ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA] shadow-sm"}`}>
          <h3 className={`text-sm font-semibold mb-4 ${textPrimary}`}>New Resource Expense</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Employee *</label>
              <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} className={inputCls}>
                <option value="">Select employee</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Type *</label>
              <select value={form.expenseType} onChange={(e) => setForm({ ...form, expenseType: e.target.value })} className={inputCls}>
                {Object.entries(EXPENSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Description *</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g., iPhone 15 Pro" className={inputCls} />
            </div>
            <div>
              <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Purchase Date</label>
              <input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Purchase Cost (INR) *</label>
              <input type="number" min="1" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Allocation Method</label>
              <select value={form.allocationMethod} onChange={(e) => setForm({ ...form, allocationMethod: e.target.value as any })} className={inputCls}>
                <option value="one_time">One-Time (Full Cost)</option>
                <option value="monthly">Monthly Allocation</option>
              </select>
            </div>
            {form.allocationMethod === "monthly" && (
              <div>
                <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Allocation Months</label>
                <input type="number" min="1" max="60" value={form.allocationMonths} onChange={(e) => setForm({ ...form, allocationMonths: e.target.value })} className={inputCls} />
                {form.purchaseCost && form.allocationMonths && (
                  <p className={`text-[10px] mt-1 ${textSecondary}`}>
                    Monthly: {fmtCurrency(Number(form.purchaseCost) / Number(form.allocationMonths))}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isCompanyExpense"
                checked={form.isCompanyExpense}
                onChange={(e) => setForm({ ...form, isCompanyExpense: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="isCompanyExpense" className={`text-xs ${textSecondary}`}>
                Company expense (not employee payroll deduction)
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={createExpense} disabled={saving} className={btnPrimary}>
              {saving ? "Saving..." : "Add Expense"}
            </button>
            <button onClick={() => setShowForm(false)} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {/* Expenses Table */}
      {loading ? (
        <div className={`rounded-2xl h-48 animate-pulse ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
      ) : expenses.length === 0 ? (
        <div className={`rounded-2xl p-10 flex flex-col items-center text-center gap-2 border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <IoCubeOutline size={32} className={isDark ? "text-[#48484A]" : "text-[#C7C7CC]"} />
          <p className={`text-sm ${textSecondary}`}>No resource expenses recorded yet.</p>
        </div>
      ) : (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Employee</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Item</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Cost</th>
                  <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Allocation</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Monthly</th>
                  <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Status</th>
                  <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp, i) => {
                  const Icon = EXPENSE_ICONS[exp.expenseType] || IoCubeOutline;
                  return (
                    <tr
                      key={exp.id}
                      className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${
                        i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium ${textPrimary}`}>{exp.employeeName}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Icon size={14} className={textAccent} />
                          <div>
                            <p className={`text-xs font-medium ${textPrimary}`}>{exp.description}</p>
                            <p className={`text-[10px] ${textSecondary}`}>{EXPENSE_LABELS[exp.expenseType]} — {exp.purchaseDate}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs ${textPrimary}`}>{fmtCurrency(exp.purchaseCost)}</td>
                      <td className={`px-4 py-2.5 text-center text-xs ${textSecondary}`}>
                        {exp.allocationMethod === "monthly" ? `${exp.allocationMonths} mo` : "One-time"}
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs font-medium ${textAccent}`}>{fmtCurrency(exp.monthlyAmount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          exp.status === "active"
                            ? isDark ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-emerald-100 text-emerald-700 border-emerald-200"
                            : exp.status === "completed"
                              ? isDark ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "bg-blue-100 text-blue-700 border-blue-200"
                              : isDark ? "bg-gray-500/15 text-gray-400 border-gray-500/30" : "bg-gray-100 text-gray-500 border-gray-200"
                        }`}>
                          {exp.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {exp.status === "active" && (
                          <button
                            onClick={() => writeOff(exp.id)}
                            className="p-1.5 rounded-lg cursor-pointer text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Write off"
                          >
                            <IoTrashOutline size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {total > 15 && (
            <div className={`flex items-center justify-center gap-2 py-3 border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"}`}>
              <button disabled={page <= 1} onClick={() => fetchExpenses(page - 1)} className={btnSecondary}>Previous</button>
              <span className={`text-xs ${textSecondary}`}>Page {page} of {Math.ceil(total / 15)}</span>
              <button disabled={page >= Math.ceil(total / 15)} onClick={() => fetchExpenses(page + 1)} className={btnSecondary}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
