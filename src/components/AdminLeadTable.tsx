"use client";

/* ══════════════════════════════════════════════════════════════════════════
   AdminLeadTable — reusable sortable/column-selectable lead table for
   Admin sub-views (Sales Manager, Site Head, Receptionist).

   Mirrors the column-definition shape of EnquiryOverviewSection so the
   look, sorting, column-selector and localStorage persistence are
   consistent across every Admin-facing lead table.
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  ColumnSelector,
  SortIcon,
  isBlank,
} from "./Tableui";

/* ───────── types ───────── */

type Lead = Record<string, any>;
type Align = "left" | "right" | "center";

export type ALTColumn = {
  key: string;
  label: string;
  align?: Align;
  minWidth?: string;
  locked?: boolean;
  defaultHidden?: boolean;
  sortValue?: (l: Lead) => string | number;
  render: (l: Lead, ctx: ALTCtx) => React.ReactNode;
};

export type ALTCtx = {
  theme: any;
  isDark: boolean;
  formatDate: (d: any) => string;
};

export type AdminLeadTableProps = {
  leads: Lead[];
  columns: ALTColumn[];
  storageKey: string;
  theme: any;
  isDark: boolean;
  isLoading?: boolean;
  formatDate: (d: any) => string;
  onRowClick?: (lead: Lead) => void;
  /** Extra elements rendered in the toolbar row, after the column selector. */
  toolbarExtra?: React.ReactNode;
};

/* ───────── helpers ───────── */

function DraggableScroll({ children, className, isDark }: { children: React.ReactNode; className?: string; isDark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollL, setScrollL] = useState(0);
  return (
    <div className={className}>
      <div
        ref={ref}
        onMouseDown={(e) => { if (!ref.current) return; setDragging(true); setStartX(e.pageX - ref.current.offsetLeft); setScrollL(ref.current.scrollLeft); }}
        onMouseLeave={() => setDragging(false)}
        onMouseUp={() => setDragging(false)}
        onMouseMove={(e) => { if (!dragging || !ref.current) return; e.preventDefault(); ref.current.scrollLeft = scrollL - (e.pageX - ref.current.offsetLeft - startX) * 1.5; }}
        className={`overflow-auto custom-scrollbar pb-2 ${dragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
        style={{ maxHeight: "calc(100vh - 220px)" }}
      >
        {children}
      </div>
    </div>
  );
}

/* ═══════════ component ═══════════ */

export default function AdminLeadTable({
  leads,
  columns,
  storageKey,
  theme,
  isDark,
  isLoading = false,
  formatDate,
  onRowClick,
  toolbarExtra,
}: AdminLeadTableProps) {
  /* ── column visibility ── */
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setHiddenCols(new Set(JSON.parse(saved)));
    } catch { /* ignore */ }
  }, [storageKey]);

  const persistCols = (next: Set<string>) => {
    setHiddenCols(next);
    try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.locked || !hiddenCols.has(c.key)),
    [hiddenCols, columns]
  );

  /* ── sorting ── */
  const [sortKey, setSortKey] = useState<string | null>("lead_no");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col?.sortValue) return;
    if (sortKey !== key) {
      setSortKey(key);
      const numericFirst = ["lead_no", "budget", "created_at", "backdated", "site_visit"];
      setSortDir(numericFirst.includes(key) ? "desc" : "asc");
    } else {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return leads;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return leads;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...leads].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [leads, sortKey, sortDir, columns]);

  /* ── ctx ── */
  const ctx: ALTCtx = { theme, isDark, formatDate };

  return (
    <div className="flex flex-col gap-2">
      {/* ── toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <ColumnSelector
          columns={columns.map((c) => ({ key: c.key, label: c.label, locked: c.locked }))}
          hidden={hiddenCols}
          onToggle={(key) => {
            const next = new Set(hiddenCols);
            next.has(key) ? next.delete(key) : next.add(key);
            persistCols(next);
          }}
          onReset={() =>
            persistCols(new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)))
          }
          isDark={isDark}
        />
        {toolbarExtra}
        <span className={`text-[10px] sm:text-xs ml-auto ${theme.textFaint}`}>
          {sorted.length} lead{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── table ── */}
      <div className={`rounded-xl overflow-hidden border ${theme.tableWrap}`} style={theme.tableGlass}>
        <DraggableScroll isDark={isDark}>
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.05em] sm:tracking-[0.09em] ${theme.tableHead} ${theme.textHeader}`}>
              <tr>
                {visibleColumns.map((col) => {
                  const sortable = !!col.sortValue;
                  const dir = sortKey === col.key ? sortDir : null;
                  return (
                    <th
                      key={col.key}
                      onClick={() => sortable && toggleSort(col.key)}
                      title={sortable ? `Sort by ${col.label}` : undefined}
                      className={`
                        group px-2 py-2 sm:px-3 sm:py-3 whitespace-nowrap border-b
                        ${col.minWidth || ""}
                        ${isDark ? "border-white/[0.08]" : "border-gray-300"}
                        ${sortable ? "cursor-pointer select-none" : ""}
                        ${sortable ? (isDark ? "hover:text-white transition-colors" : "hover:text-gray-900 transition-colors") : ""}
                        ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                      `}
                    >
                      <span className={`inline-flex items-center gap-1 sm:gap-1.5 ${col.align === "right" ? "flex-row-reverse" : col.align === "center" ? "justify-center" : ""}`}>
                        {col.label}
                        {sortable && <SortIcon dir={dir} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={`px-2 py-3 sm:px-3 sm:py-4 border-b ${isDark ? "border-white/[0.045]" : "border-gray-200"}`}>
                        <div className={`h-3 rounded ${isDark ? "bg-white/[0.06]" : "bg-gray-200"} animate-pulse`} style={{ width: "60%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className={`text-center py-8 sm:py-12 text-xs sm:text-sm ${theme.textMuted}`}>
                    No leads found.
                  </td>
                </tr>
              ) : sorted.map((lead, idx) => (
                <tr
                  key={lead.id}
                  onClick={() => onRowClick?.(lead)}
                  className={`
                    transition-colors ${onRowClick ? "cursor-pointer" : ""}
                    ${idx % 2 === 1 ? (isDark ? "bg-white/[0.015]" : "bg-gray-100/60") : ""}
                    ${isDark ? "hover:bg-white/[0.045]" : "hover:bg-[#9E217B]/[0.035]"}
                  `}
                  style={lead.is_lost_lead ? { opacity: 0.55 } : undefined}
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`
                        px-2 py-2.5 sm:px-3 sm:py-3 whitespace-nowrap border-b
                        ${isDark ? "border-white/[0.045]" : "border-gray-200"}
                        ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                      `}
                    >
                      {col.render(lead, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DraggableScroll>
      </div>
    </div>
  );
}
