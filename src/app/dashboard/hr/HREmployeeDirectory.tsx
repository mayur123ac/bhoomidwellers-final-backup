"use client";

/**
 * HREmployeeDirectory — Phase 2 employee list with search, filters,
 * and drill-down to HREmployeeDetail.
 */

import { useEffect, useState, useCallback } from "react";
import HREmployeeDetail from "./HREmployeeDetail";

interface Employee {
  id: number;
  name: string;
  email: string;
  role: string;
  designation: string | null;
  department: string | null;
  employeeCode: string | null;
  joiningDate: string | null;
  employmentStatus: string | null;
  isActive: boolean;
  reportingManager: string | null;
  profileComplete: boolean;
  docsTotal: number;
  docsFulfilled: number;
}

export default function HREmployeeDirectory({ isDark }: { isDark: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Drill-down
  const [selectedEmp, setSelectedEmp] = useState<{ id: number; name: string } | null>(null);

  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textPri = isDark ? "text-white" : "text-[#1D1D1F]";
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const inputCls = `rounded-xl px-3 py-2 text-xs font-medium border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder:text-[#58585A]" : "bg-white border-[#D1D1D6] text-[#1D1D1F] placeholder:text-[#C7C7CC]"}`;

  const fetchEmployees = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/hr/employees?${params}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setEmployees(j.data.employees);
      setTotalPages(j.data.pagination.totalPages);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  // If an employee is selected, show detail view
  if (selectedEmp) {
    return <HREmployeeDetail employeeId={selectedEmp.id} employeeName={selectedEmp.name} isDark={isDark} onBack={() => setSelectedEmp(null)} />;
  }

  const capitalize = (s: string | null) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "—";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>HR Panel</p>
        <h2 className={`text-xl font-black ${textPri}`}>Employee Directory</h2>
        <p className={`text-sm mt-0.5 ${textSec}`}>{employees.length} employees shown</p>
      </div>

      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} !w-64`} placeholder="Search name, email, or employee code..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select className={inputCls} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className={`rounded-2xl animate-pulse h-64 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
      ) : employees.length === 0 ? (
        <div className={`rounded-2xl p-10 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>No employees found.</p>
        </div>
      ) : (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Employee</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Employee ID</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Role</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Designation</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Joining Date</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Docs</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => (
                  <tr key={emp.id}
                    onClick={() => setSelectedEmp({ id: emp.id, name: emp.name })}
                    className={`border-t cursor-pointer transition-colors ${isDark ? "border-[#2C2C2E] hover:bg-[#1C1C1E]" : "border-[#F5F5F7] hover:bg-gray-50"} ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 bg-emerald-600">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-xs font-semibold truncate ${textPri}`}>{emp.name}</p>
                          <p className={`text-[10px] truncate ${textSec}`}>{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-xs font-mono ${textSec}`}>{emp.id}</td>
                    <td className={`px-4 py-3 text-xs ${textSec}`}>{emp.role}</td>
                    <td className={`px-4 py-3 text-xs ${textSec}`}>{emp.designation || "—"}</td>
                    <td className={`px-4 py-3 text-xs font-mono ${textSec}`}>
                      {emp.joiningDate ? new Date(emp.joiningDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        emp.isActive
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-gray-500/15 text-gray-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${emp.isActive ? "bg-emerald-400" : "bg-gray-400"}`} />
                        {emp.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold ${emp.profileComplete ? "text-emerald-400" : "text-amber-400"}`}>
                        {emp.docsFulfilled}/{emp.docsTotal}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-30 ${isDark ? "border-[#38383A] text-[#98989D]" : "border-[#D1D1D6] text-[#86868B]"}`}>
            Prev
          </button>
          <span className={`text-xs ${textSec}`}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-30 ${isDark ? "border-[#38383A] text-[#98989D]" : "border-[#D1D1D6] text-[#86868B]"}`}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
