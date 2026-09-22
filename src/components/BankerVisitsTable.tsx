"use client";

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaSearch, FaTimes, FaUniversity, FaEllipsisV, FaTrash } from "react-icons/fa";
import { normalizeRole } from "@/lib/cpRbac";

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

const BASE_COLUMNS = [
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
  const role = normalizeRole(user?.role);
  const isAdmin = role === "admin";

  const [rows, setRows] = useState<BankerVisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // ── Admin delete state ──
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BankerVisitRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const columns = useMemo(
    () => (isAdmin ? [...BASE_COLUMNS, "Action"] : BASE_COLUMNS),
    [isAdmin]
  );

  // Close kebab menu on outside click
  useEffect(() => {
    if (activeMenuId === null) return;
    const close = () => setActiveMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [activeMenuId]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 5000);
  };

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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/banker-visits/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setDeleteError(json.message || "Delete failed.");
        return;
      }
      setDeleteTarget(null);
      flash(json.message || "Banker visit deleted successfully.");
      fetchData();
    } catch (e: any) {
      setDeleteError(e.message || "Network error.");
    } finally {
      setDeleteBusy(false);
    }
  };

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
    <div className="flex flex-col gap-4 overflow-hidden p-4 sm:p-6 font-sans antialiased ">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 mb-3 px-2 pt-2">
        <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
          <FaUniversity className={`hidden h-8 w-8 sm:inline-block ${t.accentText}`} />
          <div>
            <h2
              className={`text-base sm:text-xl font-black tracking-tight ${t.accentText}`}
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

      {notice && (
        <div className={`mx-2 mb-3 rounded-2xl px-4 py-3 text-[11px] transition-all ${isDark
          ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-400"
          : "bg-emerald-50 border border-emerald-200/50 text-emerald-700"}`}>
          {notice}
        </div>
      )}

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
              className={`text-[10px] uppercase tracking-wider border-b border-gray-400 ${t.textMuted}`}
            >
              {columns.map((h) => (
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
                    {columns.map((_, ci) => (
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
                  colSpan={columns.length}
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
                    colSpan={columns.length}
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
                  {isAdmin && (
                    <td className="px-2 py-3 whitespace-nowrap">
                      <div className="relative inline-block">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId((prev) => (prev === r.id ? null : r.id));
                          }}
                          className={`p-1.5 rounded-lg cursor-pointer transition-colors ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"} ${t.textMuted}`}
                          title="Actions"
                          aria-label="Banker visit actions"
                        >
                          <FaEllipsisV className="text-[11px]" />
                        </button>
                        {activeMenuId === r.id && (
                          <div
                            className={`absolute right-0 top-full mt-1 z-50 rounded-xl shadow-xl border py-1 w-[136px] ${isDark ? "bg-[#2C2C2E] border-white/10" : "bg-white border-black/10"}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => {
                                setActiveMenuId(null);
                                setDeleteError(null);
                                setDeleteTarget(r);
                              }}
                              className="block w-full text-left px-3.5 py-2 text-[11px] cursor-pointer transition-colors text-red-500 hover:bg-red-500/10"
                            >
                              <FaTrash className="inline text-[9px] mr-2 opacity-60" />Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Delete confirmation modal ── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !deleteBusy && setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl p-6 shadow-2xl ${isDark ? "bg-[#1C1C1E] border border-white/10" : "bg-white border border-black/5"}`}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className={`text-base font-bold ${t.text}`}>Delete this banker visit?</h3>
                <button
                  onClick={() => !deleteBusy && setDeleteTarget(null)}
                  className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}
                >
                  <FaTimes />
                </button>
              </div>

              <div className={`rounded-xl p-3 mb-4 ${isDark ? "bg-white/5" : "bg-black/5"}`}>
                <p className={`text-xs font-bold mb-1 ${t.text}`}>{deleteTarget.banker_name}</p>
                <p className={`text-[11px] ${t.textMuted}`}>
                  {deleteTarget.bank_name} &middot; {deleteTarget.branch_name}
                </p>
              </div>

              <p className={`text-xs mb-4 ${t.textMuted}`}>
                This permanently removes the banker visit record. This action cannot be undone.
              </p>

              {deleteError && (
                <div className="mb-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteBusy}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${t.textMuted}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteBusy}
                  className={`px-5 py-2 rounded-xl text-xs font-bold cursor-pointer bg-red-600 hover:bg-red-700 text-white ${deleteBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {deleteBusy ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default React.memo(BankerVisitsTable);
