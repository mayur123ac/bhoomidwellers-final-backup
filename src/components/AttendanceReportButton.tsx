"use client";
// AttendanceReportButton.tsx — the Attendance Report Center.
//
// Replaces the old "Export Excel" button, which serialised whatever single day
// was already loaded in the browser. This fetches a real date range from
// /api/attendance/report (Admin-only, server-enforced) and writes a two-sheet
// workbook.
//
// Self-contained on purpose: LiveActivityView is a 1000-line component and the
// dropdown, modal, workbook builder and their states have no reason to live in
// it. The only change there is swapping one button for one element.
//
// Uses the `xlsx` already in the bundle — no new dependency, and the same
// library the previous export used.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaFileExcel, FaCalendarAlt, FaChartBar, FaTimes } from "react-icons/fa";
// ExcelJS rather than the `xlsx` used elsewhere: the register needs cell fills,
// borders and frozen panes, all of which SheetJS community drops on write.
// Imported dynamically inside the handler so ~1MB of library is not in the
// initial dashboard bundle — it is only needed once someone downloads.
import type { ReportData } from "@/lib/attendanceWorkbook";

type Props = {
  theme: any;
  isDark: boolean;
};

/** Local YYYY-MM-DD. toISOString() would shift the date back in IST. */
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** Seconds → "194h 20m", the same shape the Live Activity table already shows. */
function hm(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function timeOnly(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export default function AttendanceReportButton({ theme, isDark }: Props) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const today = useMemo(() => toISODate(new Date()), []);
  const monthStart = useMemo(() => {
    const d = new Date();
    return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  }, []);

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click / Escape — the same affordance the
  // Working Hours popover beside it already has.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Blocks the download button and explains why, rather than failing on submit. */
  const rangeError = useMemo(() => {
    if (!from || !to) return "Select both dates.";
    if (from > to) return "The From date cannot be after the To date.";
    if (to > today) return "Future dates cannot be selected.";
    return null;
  }, [from, to, today]);

  /**
   * Dynamically imported: ExcelJS is ~1MB and is only needed at the moment
   * someone downloads, so it stays out of the dashboard's initial bundle.
   * Everything about sheet construction lives in lib/attendanceWorkbook.ts.
   */
  const buildWorkbook = useCallback(async (d: ReportData) => {
    const { buildAttendanceWorkbook, attendanceFilename } = await import("@/lib/attendanceWorkbook");
    const blob = await buildAttendanceWorkbook(d);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = attendanceFilename(d.from, d.to);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const download = useCallback(async (f: string, t: string) => {
    if (busy) return;                       // guards the double-click duplicate
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/attendance/report?from=${f}&to=${t}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Report failed");
      if (!json.data.summary.length) {
        setToast({ kind: "err", text: "No employees found for that period." });
        return;
      }
      await buildWorkbook(json.data);
      setToast({ kind: "ok", text: "Attendance report downloaded successfully" });
      setOpen(false);
      setModalOpen(false);
    } catch {
      setToast({ kind: "err", text: "Unable to generate attendance report. Please try again." });
    } finally {
      setBusy(false);
    }
  }, [busy, buildWorkbook]);

  const panelBg = isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]";
  const rowHover = isDark ? "hover:bg-white/[0.06]" : "hover:bg-slate-100";
  const fieldCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border ${isDark
    ? "bg-[#14141B] border-[#2A2A35] text-white" : "bg-white border-[#9CA3AF] text-[#1A1A1A]"}`;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${busy
          ? "opacity-60 cursor-wait border-green-500/20 text-green-500"
          : "border-green-500/30 text-green-500 bg-green-500/5 hover:bg-green-500/15 cursor-pointer"
          }`}
      >
        {busy ? (
          <>
            <span className="inline-block w-3.5 h-3.5 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
            Preparing Report...
          </>
        ) : (
          <>
            <FaFileExcel className="w-3.5 h-3.5" />
            Download Attendance
            <span className="text-[10px] opacity-70">▼</span>
          </>
        )}
      </button>

      {/* Right-aligned so it stays inside the viewport on a 1366px laptop, where
          this button sits near the right edge of the toolbar. */}
      {open && !busy && (
        <div
          role="menu"
          className={`absolute right-0 top-full mt-2 w-[280px] rounded-xl border shadow-2xl z-50 overflow-hidden ${panelBg}`}
        >
          <p className={`px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider ${theme.textMuted}`}>
            Download Attendance
          </p>

          <button
            role="menuitem"
            onClick={() => { setOpen(false); setModalOpen(true); }}
            className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${rowHover}`}
          >
            <FaCalendarAlt className="mt-0.5 text-[#9E217B] flex-shrink-0" />
            <span className="min-w-0">
              <span className={`block text-xs font-bold ${theme.text}`}>Custom Date Range</span>
              <span className={`block text-[11px] ${theme.textMuted}`}>Choose any From and To dates</span>
            </span>
          </button>

          <div className={`h-px mx-4 ${isDark ? "bg-white/10" : "bg-slate-200"}`} />

          <button
            role="menuitem"
            onClick={() => download(monthStart, today)}
            className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${rowHover}`}
          >
            <FaChartBar className="mt-0.5 text-green-500 flex-shrink-0" />
            <span className="min-w-0">
              <span className={`block text-xs font-bold ${theme.text}`}>This Month</span>
              <span className={`block text-[11px] ${theme.textMuted}`}>
                {prettyDate(monthStart)} – {prettyDate(today)}
              </span>
              <span className={`block text-[10px] mt-0.5 ${theme.textFaint ?? theme.textMuted}`}>
                {inclusiveDays(monthStart, today)} days · one click
              </span>
            </span>
          </button>
        </div>
      )}

      {/* ── Custom range modal ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Download Attendance Report"
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => !busy && setModalOpen(false)} />
          <div className={`relative w-full max-w-sm rounded-2xl border shadow-2xl ${panelBg}`}>
            <div className={`flex items-center justify-between px-5 py-3.5 border-b ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
              <h3 className={`text-sm font-bold ${theme.text}`}>Download Attendance Report</h3>
              <button onClick={() => !busy && setModalOpen(false)} className={`p-1 rounded-lg ${theme.textMuted} ${rowHover}`} aria-label="Close">
                <FaTimes className="w-3 h-3" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div>
                <label className={`block text-[11px] font-semibold mb-1 ${theme.textMuted}`}>From Date</label>
                <input type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className={`block text-[11px] font-semibold mb-1 ${theme.textMuted}`}>To Date</label>
                <input type="date" value={to} max={today} onChange={e => setTo(e.target.value)} className={fieldCls} />
              </div>

              {rangeError ? (
                <p className="text-[11px] font-semibold text-red-500">{rangeError}</p>
              ) : (
                <p className={`text-[11px] ${theme.textMuted}`}>
                  {prettyDate(from)} – {prettyDate(to)} · {inclusiveDays(from, to)} days
                </p>
              )}
            </div>

            <div className={`flex justify-end gap-2 px-5 py-3.5 border-t ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
              <button
                onClick={() => setModalOpen(false)}
                disabled={busy}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors ${isDark
                  ? "border-[#2A2A35] text-[#888899] hover:bg-white/5" : "border-[#E5E7EB] text-[#6B7280] hover:bg-slate-100"}`}
              >
                Cancel
              </button>
              <button
                onClick={() => download(from, to)}
                disabled={!!rangeError || busy}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors ${!!rangeError || busy
                  ? "opacity-50 cursor-not-allowed bg-green-600/40 text-white"
                  : "bg-green-600 hover:bg-green-500 text-white cursor-pointer"}`}
              >
                {busy ? (
                  <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Preparing Report...</>
                ) : (
                  <><FaFileExcel className="w-3 h-3" /> Download Excel</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result notice. Sits under the button rather than as a global toast so it
          reads as feedback for this action. */}
      {toast && (
        <div
          className={`absolute right-0 top-full mt-2 z-50 px-3 py-2 rounded-lg border text-[11px] font-semibold shadow-lg whitespace-nowrap ${toast.kind === "ok"
            ? "border-green-500/40 bg-green-500/10 text-green-500"
            : "border-red-500/40 bg-red-500/10 text-red-500"}`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
