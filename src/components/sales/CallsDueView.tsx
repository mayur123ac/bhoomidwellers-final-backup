"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { FaPhoneAlt, FaSyncAlt, FaDownload, FaArrowLeft } from "react-icons/fa";
import { Ghost } from "lucide-react";
import { SearchBar, Pagination, SkeletonRows } from "@/components/Tableui";
import { formatBudget } from "@/lib/formatBudget";

interface CallsDueLead {
  id: number;
  sr_no: number | null;
  name: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  configuration: string | null;
  budget: string | null;
  source: string | null;
  source_other: string | null;
  status: string | null;
  is_lost_lead: boolean;
  lost_lead_reason: string | null;
  created_at: string;
  assigned_at: string | null;
  enquiry_date: string | null;
  auto_date_enabled: boolean | null;
  cp_name: string | null;
  cp_company: string | null;
  cp_phone: string | null;
  lead_classification: string | null;
  latest_visit_date: string | null;
  latest_visit_status: string | null;
  purpose: string | null;
  loan_planned: string | null;
}

const COLUMNS = [
  { key: "lead_no", label: "LEAD NO." },
  { key: "name", label: "NAME" },
  { key: "call_due_from", label: "CALL DUE FROM" },
  { key: "prop_type", label: "PROP. TYPE" },
  { key: "budget", label: "BUDGET" },
  { key: "source", label: "SOURCE" },
  { key: "cp_name", label: "CP NAME" },
  { key: "cp_company", label: "CP COMPANY" },
  { key: "cp_phone", label: "CP PHONE" },
  { key: "status", label: "STATUS" },
  { key: "lost_status", label: "LOST STATUS" },
  { key: "interest", label: "INTEREST" },
  { key: "date_created", label: "DATE CREATED" },
  { key: "site_visit", label: "SITE VISIT" },
] as const;

function formatDate(ds: string | null | undefined): string {
  if (!ds || ds === "Pending" || ds === "N/A") return "-";
  try {
    return new Date(ds).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ds;
  }
}

function formatDateTime(ds: string | null | undefined): string {
  if (!ds || ds === "Pending" || ds === "N/A") return "-";
  try {
    return new Date(ds).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ds;
  }
}

function daysSince(ds: string | null | undefined): number | null {
  if (!ds) return null;
  try {
    const then = new Date(ds);
    const now = new Date();
    return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export default function CallsDueView({
  isDark,
  t,
  onBack,
  onOpenLead,
}: {
  isDark: boolean;
  t: any;
  onBack?: () => void;
  onOpenLead?: (lead: any) => void;
}) {
  const [data, setData] = useState<CallsDueLead[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const searchDebounce = useRef<NodeJS.Timeout | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search to avoid firing on every keystroke
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [search]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(false);
      const params = new URLSearchParams({
        limit: String(rowsPerPage),
        offset: String((page - 1) * rowsPerPage),
      });
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());

      const res = await fetch(`/api/sales-manager/calls-due?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [page, rowsPerPage, debouncedSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const downloadCSV = () => {
    if (!data.length) return;
    const rows = data.map((l) => ({
      "Lead No.": l.sr_no || l.id,
      Name: l.name,
      "Call Due From": formatDate(l.assigned_at ?? l.created_at),
      "Prop. Type": l.configuration || "",
      Budget: formatBudget(l.budget, null),
      Source: l.source || "",
      "CP Name": l.cp_name || "",
      "CP Company": l.cp_company || "",
      "CP Phone": l.cp_phone || "",
      Status: l.status || "Assigned",
      "Lost Status": l.is_lost_lead ? "Lost Lead" : "Active",
      Interest: "",
      "Date Created": formatDate(l.created_at),
      "Site Visit": l.latest_visit_date ? formatDate(l.latest_visit_date) : "",
    }));
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        headers.map((k) => JSON.stringify((r as any)[k] ?? "", null)).join(",")
      ),
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );
    a.setAttribute("download", "SM_Calls_Due.csv");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getStatusStyle = (s: string) => {
    if (s === "New Lead") return t.statusNew;
    if (s === "Assigned") return t.statusAssigned;
    if (s === "Contacted") return t.statusContacted;
    if (s === "Interested") return t.statusInterested;
    if (s === "Visit Scheduled") return t.statusVisit;
    if (s === "Completed") return t.statusCompleted;
    if (s === "Closing" || s === "Closed") return t.statusClosing;
    if (s === "Lost Lead") return t.statusLost;
    return t.statusAssigned;
  };

  return (
    <div className="animate-fadeIn flex flex-col gap-4 h-full">
      {/* Header */}
      <div
        className={`rounded-2xl border overflow-hidden ${
          isDark ? "bg-slate-950 border-slate-800" : "bg-white border-slate-200/60 shadow-sm"
        }`}
      >
        {/* Toolbar row 1 */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex flex-wrap items-center gap-3 sm:gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                isDark
                  ? "bg-white/10 text-slate-300 hover:bg-white/20"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title="Back to Dashboard"
            >
              <FaArrowLeft size={12} />
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-[#B01A79] dark:bg-[#B01A79]/20 dark:text-pink-400">
              <FaPhoneAlt size={14} />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h3
                  className={`font-bold text-[16px] sm:text-[17px] tracking-tight ${t.text}`}
                >
                  Calls Due
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-100 text-[#B01A79] dark:bg-[#B01A79]/20 dark:text-pink-400 tabular-nums">
                  {isLoading ? "..." : total.toLocaleString("en-IN")}
                </span>
              </div>
              <p
                className={`text-[11px] sm:text-xs ${
                  isDark ? "text-slate-500" : "text-slate-400"
                }`}
              >
                Leads assigned to you that have not yet been contacted by call.
              </p>
            </div>
          </div>

          <div className="w-full order-last sm:order-none mt-1 sm:mt-0 sm:w-auto sm:flex-1">
            <SearchBar
              value={search}
              onChange={setSearch}
              isDark={isDark}
              placeholder="Search by Lead No, Name, Source, CP..."
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
            <button
              type="button"
              onClick={downloadCSV}
              className={`h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                isDark
                  ? "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm"
              }`}
              title="Export as CSV"
            >
              <FaDownload className="text-[11px]" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              type="button"
              onClick={fetchData}
              className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                isDark
                  ? "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm"
              }`}
              title="Refresh"
            >
              <FaSyncAlt className="text-[11px]" />
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div
            className={`mx-4 sm:mx-6 mb-4 p-3 rounded-xl text-sm flex items-center justify-between ${
              isDark
                ? "bg-red-950/30 border border-red-900/50 text-red-400"
                : "bg-red-50 border border-red-200 text-red-600"
            }`}
          >
            <span>Unable to load calls due data.</span>
            <button
              onClick={fetchData}
              className="underline hover:no-underline font-semibold"
            >
              Retry
            </button>
          </div>
        )}

        {/* Data Table */}
        <div className="overflow-x-auto w-full custom-scrollbar">
          <table className="w-full text-left text-xs sm:text-sm whitespace-nowrap">
            <thead className={isDark ? "bg-slate-900/50" : "bg-slate-50/50"}>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 sm:px-4 py-3 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider border-b ${
                      isDark
                        ? "border-slate-800 text-slate-400"
                        : "border-slate-200 text-[#475569]"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              className={`divide-y ${
                isDark ? "divide-slate-800/60" : "divide-slate-100"
              }`}
            >
              {isLoading ? (
                <SkeletonRows cols={COLUMNS.length} rows={8} isDark={isDark} />
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
                    className={`text-center py-16 text-sm font-medium ${
                      isDark ? "text-slate-500" : "text-slate-400"
                    }`}
                  >
                    {debouncedSearch.trim()
                      ? "No leads match your search."
                      : "No calls due — all your leads have been contacted!"}
                  </td>
                </tr>
              ) : (
                data.map((lead) => {
                  const callDueFrom = lead.assigned_at ?? lead.created_at;
                  const daysOverdue = daysSince(callDueFrom);
                  const isLost = !!lead.is_lost_lead;

                  return (
                    <tr
                      key={lead.id}
                      className={`group cursor-pointer transition-colors duration-200 ${
                        isDark
                          ? "hover:bg-slate-800/40"
                          : "hover:bg-slate-50"
                      }`}
                      style={isLost ? { opacity: 0.55 } : undefined}
                      onClick={() => onOpenLead?.(lead)}
                    >
                      {/* LEAD NO. */}
                      <td
                        className={`px-3 sm:px-4 py-3 text-[11px] sm:text-sm font-bold ${t.accentText}`}
                      >
                        #{lead.sr_no || lead.id}
                      </td>

                      {/* NAME */}
                      <td className={`px-3 sm:px-4 py-3 ${t.text}`}>
                        <span className="font-bold text-[13px] leading-none">
                          {lead.name}
                        </span>
                      </td>

                      {/* CALL DUE FROM */}
                      <td className="px-3 sm:px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={`text-[12px] sm:text-[13px] font-semibold ${
                              isDark ? "text-slate-300" : "text-slate-600"
                            }`}
                          >
                            {formatDate(callDueFrom)}
                          </span>
                          {daysOverdue !== null && daysOverdue > 0 && (
                            <span
                              className={`text-[10px] font-bold ${
                                daysOverdue > 7
                                  ? "text-red-500"
                                  : daysOverdue > 3
                                  ? "text-orange-500"
                                  : isDark
                                  ? "text-slate-500"
                                  : "text-slate-400"
                              }`}
                            >
                              {daysOverdue}d ago
                            </span>
                          )}
                        </div>
                      </td>

                      {/* PROP. TYPE */}
                      <td
                        className={`px-3 sm:px-4 py-3 text-[12px] sm:text-[13px] font-medium ${
                          isDark ? "text-slate-300" : "text-slate-600"
                        }`}
                      >
                        {lead.configuration || "Pending"}
                      </td>

                      {/* BUDGET */}
                      <td
                        className={`px-3 sm:px-4 py-3 text-[12px] sm:text-[13px] font-bold ${
                          isDark ? "text-emerald-400" : "text-[#039953]"
                        }`}
                      >
                        {formatBudget(lead.budget, null) || "—"}
                      </td>

                      {/* SOURCE */}
                      <td
                        className={`px-3 sm:px-4 py-3 text-[11px] sm:text-xs font-medium ${
                          isDark ? "text-slate-400" : "text-slate-500"
                        }`}
                      >
                        {lead.source || "—"}
                      </td>

                      {/* CP NAME */}
                      <td
                        className={`px-3 sm:px-4 py-3 text-[12px] sm:text-[13px] font-medium ${
                          isDark ? "text-slate-300" : "text-slate-600"
                        }`}
                      >
                        {lead.cp_name || "—"}
                      </td>

                      {/* CP COMPANY */}
                      <td
                        className={`px-3 sm:px-4 py-3 text-[12px] sm:text-[13px] font-medium ${
                          isDark ? "text-slate-300" : "text-slate-600"
                        }`}
                      >
                        {lead.cp_company || "—"}
                      </td>

                      {/* CP PHONE */}
                      <td
                        className={`px-3 sm:px-4 py-3 font-mono text-[11px] sm:text-xs font-medium ${
                          isDark ? "text-slate-400" : "text-slate-500"
                        }`}
                      >
                        {lead.cp_phone || "—"}
                      </td>

                      {/* STATUS */}
                      <td className="px-3 sm:px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wide border ${getStatusStyle(
                            lead.status || "Assigned"
                          )}`}
                        >
                          {lead.status || "Assigned"}
                        </span>
                      </td>

                      {/* LOST STATUS */}
                      <td className="px-3 sm:px-4 py-3">
                        {isLost ? (
                          <span
                            className={`px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border inline-flex items-center gap-1 ${t.statusLost}`}
                          >
                            <Ghost className="w-3 h-3" /> Lost Lead
                          </span>
                        ) : (
                          <span
                            className={`text-[11px] sm:text-xs font-semibold ${
                              isDark ? "text-slate-400" : "text-slate-500"
                            }`}
                          >
                            Active
                          </span>
                        )}
                      </td>

                      {/* INTEREST */}
                      <td className="px-3 sm:px-4 py-3">
                        <span
                          className={`text-[11px] sm:text-xs italic ${
                            isDark ? "text-slate-600" : "text-slate-400"
                          }`}
                        >
                          —
                        </span>
                      </td>

                      {/* DATE CREATED */}
                      <td
                        className={`px-3 sm:px-4 py-3 text-[11px] sm:text-xs font-medium whitespace-normal min-w-[100px] sm:min-w-[120px] ${
                          isDark ? "text-slate-400" : "text-slate-500"
                        }`}
                      >
                        {formatDateTime(lead.created_at)}
                      </td>

                      {/* SITE VISIT */}
                      <td className="px-3 sm:px-4 py-3">
                        {lead.latest_visit_date ? (
                          <span className="text-[#F49A25] font-semibold whitespace-nowrap text-[11px] sm:text-xs">
                            {formatDate(lead.latest_visit_date)}
                          </span>
                        ) : (
                          <span
                            className={`text-[11px] sm:text-xs italic ${
                              isDark ? "text-slate-600" : "text-slate-400"
                            }`}
                          >
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!isLoading && total > 0 && (
          <Pagination
            page={page}
            rowsPerPage={rowsPerPage}
            total={total}
            onPageChange={setPage}
            onRowsPerPageChange={setRowsPerPage}
            isDark={isDark}
          />
        )}
      </div>
    </div>
  );
}
