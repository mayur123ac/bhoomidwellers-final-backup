"use client";

import { useEffect, useState, useCallback } from "react";
import { HOLIDAY_TYPES } from "@/lib/hr/constants";

interface Holiday {
  id: number;
  holiday_date: string;
  name: string;
  type: string;
  is_active: boolean;
  created_by_name: string | null;
  deactivated_by_name: string | null;
  deactivated_at: string | null;
  created_at: string;
}

export default function HRHolidays({ isDark }: { isDark: boolean }) {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [fName, setFName] = useState("");
  const [fDate, setFDate] = useState("");
  const [fType, setFType] = useState<string>("public");

  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const inputCls = `w-full rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`;

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (showInactive) params.set("includeInactive", "true");
      const res = await fetch(`/api/hr/holidays?${params}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setHolidays(j.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [year, showInactive]);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  const handleCreate = async () => {
    if (!fName.trim() || !fDate) { setFormError("Name and date are required."); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/hr/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holidayDate: fDate, name: fName.trim(), type: fType }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess("Holiday created.");
      setShowForm(false);
      setFName(""); setFDate(""); setFType("public");
      fetchHolidays();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: number) => {
    if (!confirm("Deactivate this holiday? It will no longer affect attendance.")) return;
    try {
      const res = await fetch(`/api/hr/holidays/${id}`, { method: "PATCH" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess("Holiday deactivated.");
      fetchHolidays();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const activeCount = holidays.filter(h => h.is_active).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>HR Panel</p>
          <h2 className={`text-xl font-black ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>Holiday Management</h2>
          <p className={`text-sm mt-0.5 ${textSec}`}>{activeCount} active holiday{activeCount !== 1 ? "s" : ""} in {year}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className={`rounded-xl px-3 py-2 text-xs font-medium border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <label className={`flex items-center gap-1.5 text-xs ${textSec}`}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-emerald-500" />
            Show inactive
          </label>
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer">
            + Add Holiday
          </button>
        </div>
      </div>

      {/* Success/Error */}
      {success && <div className="rounded-xl p-3 text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{success}</div>}
      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}

      {/* Create form */}
      {showForm && (
        <div className={`rounded-2xl p-5 space-y-4 ${card}`}>
          <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>New Holiday</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Name</label>
              <input className={inputCls} value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Republic Day" />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Date</label>
              <input type="date" className={inputCls} value={fDate} onChange={e => setFDate(e.target.value)} />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Type</label>
              <select className={inputCls} value={fType} onChange={e => setFType(e.target.value)}>
                {HOLIDAY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
          {formError && <p className="text-red-400 text-xs">{formError}</p>}
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
              {submitting ? "Creating..." : "Create Holiday"}
            </button>
            <button onClick={() => { setShowForm(false); setFormError(null); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D]" : "border-[#D1D1D6] text-[#86868B]"}`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className={`rounded-2xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
      ) : holidays.length === 0 ? (
        <div className={`rounded-2xl p-10 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>No holidays found for {year}.</p>
        </div>
      ) : (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Date</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Name</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Type</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Created By</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h, i) => (
                  <tr key={h.id} className={`border-t transition-colors ${isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"} ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                    <td className="px-4 py-3 font-mono text-xs">{new Date(h.holiday_date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className={`px-4 py-3 font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>{h.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${h.type === "public" ? "bg-blue-500/15 text-blue-400" : h.type === "restricted" ? "bg-amber-500/15 text-amber-400" : "bg-purple-500/15 text-purple-400"}`}>{h.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      {h.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/15 text-gray-400">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-xs ${textSec}`}>{h.created_by_name || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {h.is_active && (
                        <button onClick={() => handleDeactivate(h.id)}
                          className="text-[10px] font-bold text-red-400 hover:text-red-300 cursor-pointer">
                          Deactivate
                        </button>
                      )}
                      {!h.is_active && h.deactivated_by_name && (
                        <span className={`text-[10px] ${textSec}`}>by {h.deactivated_by_name}</span>
                      )}
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
