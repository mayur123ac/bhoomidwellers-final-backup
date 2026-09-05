"use client";

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { FaSearch, FaTimes, FaUniversity } from "react-icons/fa";

interface Props {
  user: { name: string; role: string; _id?: string };
  isDark: boolean;
  t: any;
  title?: string;
  subtitle?: string;
}

type BankerVisitRow = Record<string, any>;

const fmtDate = (raw: any) => {
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
};

const dash = (t: any) => <span className={t.textFaint}>&mdash;</span>;

const COLUMNS = [
  "Sr. No.",

  "Banker Name",

  "Contact Number",
  "Bank Name",
  "Branch Name",
  "Designation",
  "Reporting Manager",
  "Sales Manager",
  "Attended By",
  "Date",
];

function BankerVisitsTable({ user, isDark, t, title, subtitle }: Props) {
  const [rows, setRows] = useState<BankerVisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/banker-visits");
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "Failed to load banker visits.");
        return;
      }
      setRows(json.data || []);
    } catch (err: any) {
      setError(err.message || "Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const deferredSearch = useDeferredValue(search);
  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter(
      (r) =>
        [
          r.banker_name,
          r.bank_name,
          r.branch_name,
          r.designation,
          r.reporting_manager,
          r.sales_manager_name,
          r.attended_by_name,
        ].some((v) => String(v ?? "").toLowerCase().includes(q)) ||
        (digits.length >= 3 &&
          String(r.contact_number ?? "")
            .replace(/\D/g, "")
            .includes(digits))
    );
  }, [rows, deferredSearch]);

  const inputCls = `rounded-xl px-3 py-2 text-xs outline-none transition-all ${isDark
    ? "bg-[#1C1C1E] text-white placeholder-gray-500 focus:bg-[#2C2C2E] border border-white/5"
    : "bg-black/5 text-black placeholder-gray-500 focus:bg-black/10 border border-black/5"
    }`;

  const cell = `px-3 py-3 whitespace-nowrap ${t.textMuted}`;

  return (
    <div className="flex flex-col h-full overflow-hidden p-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 mb-3 px-2 pt-2">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <FaUniversity className={`hidden sm:inline-block ${t.accentText}`} />
          <div>
            <h2
              className={`text-sm sm:text-base font-bold tracking-tight ${t.text}`}
            >
              {title || "Bankers Info"}
            </h2>
            {subtitle && (
              <p className={`text-[10px] sm:text-[11px] ${t.textFaint}`}>
                {subtitle}
              </p>
            )}
          </div>
          {!loading && (
            <span className={`text-[10px] sm:text-xs ${t.textFaint}`}>
              ({rows.length})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <FaSearch
              className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] ${t.textFaint}`}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search banker, bank, branch..."
              className={`${inputCls} pl-8 w-full sm:w-56 text-[10px] sm:text-xs py-1.5 sm:py-2`}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`flex-1 overflow-auto mx-2 rounded-3xl ${t.card}`}>
        <table className="w-full text-left border-collapse">
          <thead
            className={`sticky top-0 z-10 backdrop-blur-xl ${isDark
              ? "bg-[#000000]/70 border-b border-white/10"
              : "bg-white/70 border-b border-black/5"
              }`}
          >
            <tr
              className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}
            >
              {COLUMNS.map((h) => (
                <th
                  key={h}
                  className="px-3 py-3 whitespace-nowrap font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr
                    key={`skel-${i}`}
                    className={
                      isDark
                        ? "border-b border-white/5"
                        : "border-b border-black/5"
                    }
                  >
                    {COLUMNS.map((_, ci) => (
                      <td key={ci} className="px-3 py-3">
                        <div
                          className={`h-3 rounded-full animate-pulse ${isDark ? "bg-white/10" : "bg-black/10"
                            }`}
                          style={{ width: `${40 + Math.random() * 60}px` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            )}

            {!loading && rows.length === 0 && error && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-16 text-center"
                >
                  <FaTimes className="mx-auto mb-3 text-2xl text-red-500" />
                  <p
                    className={`text-sm font-semibold tracking-tight mb-1 ${t.text}`}
                  >
                    Could not load banker visits
                  </p>
                  <p className={`text-xs mb-4 ${t.textMuted}`}>{error}</p>
                  <button
                    onClick={fetchData}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${t.btnPrimary}`}
                  >
                    Try again
                  </button>
                </td>
              </tr>
            )}

            {!loading &&
              !(rows.length === 0 && error) &&
              visible.length === 0 && (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
                    className="px-4 py-16 text-center"
                  >
                    <FaUniversity
                      className={`mx-auto mb-3 text-2xl ${t.textFaint}`}
                    />
                    <p
                      className={`text-sm font-semibold tracking-tight mb-1 ${t.text}`}
                    >
                      {search
                        ? "No banker visits match your search"
                        : "No banker visits yet"}
                    </p>
                    <p className={`text-xs ${t.textMuted}`}>
                      {search
                        ? "Try a different name, bank, or branch."
                        : "Banker visits will appear here when a receptionist records one and assigns it to you."}
                    </p>
                  </td>
                </tr>
              )}

            {!loading &&
              visible.map((r, i) => (
                <tr
                  key={r.id}
                  className={`text-xs transition-colors ${t.tableRow} ${isDark
                    ? "border-b border-white/5 hover:bg-white/5"
                    : "border-b border-black/5 hover:bg-black/5"
                    }`}
                >
                  <td
                    className={`px-3 py-3 whitespace-nowrap ${t.textMuted}`}
                  >
                    {i + 1}
                  </td>
                  <td
                    className={`px-3 py-3 font-medium whitespace-nowrap ${t.text}`}
                  >
                    {r.banker_name}
                  </td>


                  <td className={cell}>{r.contact_number || dash(t)}</td>
                  <td className={cell}>{r.bank_name || dash(t)}</td>
                  <td className={cell}>{r.branch_name || dash(t)}</td>
                  <td className={cell}>{r.designation || dash(t)}</td>
                  <td className={cell}>
                    {r.reporting_manager || dash(t)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {r.sales_manager_name ? (
                      <span className={`font-medium ${t.text}`}>
                        {r.sales_manager_name}
                      </span>
                    ) : (
                      <span className={`text-[10px] ${t.textFaint}`}>
                        Not Assigned
                      </span>
                    )}
                  </td>
                  <td className={cell}>
                    {r.attended_by_name || dash(t)}
                  </td>
                  <td className={cell}>{fmtDate(r.created_at) || dash(t)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default React.memo(BankerVisitsTable);
