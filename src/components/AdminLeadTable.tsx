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
      <div
        className={`rounded-xl overflow-hidden border ${theme.tableWrap}`}
        style={theme.tableGlass}
      >
        <DraggableScroll isDark={isDark}>
          <table className="w-full text-left border-collapse whitespace-nowrap">

            {/* ── thead: Apple-style — minimal, refined typography ── */}
            <thead>
              <tr
                className={`
                  text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.06em] sm:tracking-[0.10em]
                  ${theme.tableHead} ${theme.textHeader}
                `}
              >
                {visibleColumns.map((col) => {
                  const sortable = !!col.sortValue;
                  const dir = sortKey === col.key ? sortDir : null;
                  return (
                    <th
                      key={col.key}
                      onClick={() => sortable && toggleSort(col.key)}
                      title={sortable ? `Sort by ${col.label}` : undefined}
                      className={`
                        group px-3 py-2.5 sm:px-4 sm:py-3 whitespace-nowrap
                        border-b border-b-[1px]
                        ${col.minWidth || ""}
                        ${isDark ? "border-white/[0.07]" : "border-gray-200/80"}
                        ${sortable ? "cursor-pointer select-none" : ""}
                        ${sortable
                          ? isDark
                            ? "hover:text-white/90 transition-colors duration-150"
                            : "hover:text-gray-800 transition-colors duration-150"
                          : ""
                        }
                        ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                      `}
                    >
                      <span
                        className={`inline-flex items-center gap-1 sm:gap-1.5 ${
                          col.align === "right"
                            ? "flex-row-reverse"
                            : col.align === "center"
                            ? "justify-center"
                            : ""
                        }`}
                      >
                        {col.label}
                        {sortable && <SortIcon dir={dir} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* ── tbody ── */}
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className={`
                          px-3 py-3 sm:px-4 sm:py-4 border-b
                          ${isDark ? "border-white/[0.04]" : "border-gray-100"}
                        `}
                      >
                        <div
                          className={`h-3 rounded-full ${isDark ? "bg-white/[0.06]" : "bg-gray-200/80"} animate-pulse`}
                          style={{ width: "60%" }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    className={`text-center py-10 sm:py-14 text-xs sm:text-sm ${theme.textMuted}`}
                  >
                    No leads found.
                  </td>
                </tr>
              ) : (
                sorted.map((lead, idx) => {
                  /*
                   * ── Revisit / Re-entered Lead Detection ──────────────────────
                   * Uses the EXISTING lead_classification field set by the backend
                   * (lib/visitChain.ts → "RETURNING_LEAD").
                   * DO NOT change this detection logic — UI-only mapping.
                   */
                  const isRevisit = lead.lead_classification === "RETURNING_LEAD";

                  /*
                   * ── Row background ────────────────────────────────────────────
                   * Revisit rows  → soft green tint (semantic signal)
                   * Normal rows   → neutral (subtle zebra for readability)
                   * Selected/lost → handled via style overrides below
                   */
                  const zebraClass =
                    isRevisit
                      ? "" // green tint applied via `style` below
                      : idx % 2 === 1
                      ? isDark
                        ? "bg-white/[0.013]"
                        : "bg-gray-50/70"
                      : "";

                  /*
                   * ── Hover class ───────────────────────────────────────────────
                   * Revisit rows  → maintain green identity on hover (slightly stronger)
                   * Normal rows   → neutral hover
                   * Applied via CSS custom property trick using group-hover is not
                   * possible here without JSX state, so we handle hover inline via
                   * onMouseEnter / onMouseLeave instead of Tailwind.
                   */

                  return (
                    <RevisitAwareRow
                      key={lead.id}
                      lead={lead}
                      isRevisit={isRevisit}
                      zebraClass={zebraClass}
                      isDark={isDark}
                      onRowClick={onRowClick}
                    >
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          className={`
                            px-3 py-2.5 sm:px-4 sm:py-3 whitespace-nowrap border-b
                            ${isDark ? "border-white/[0.04]" : "border-gray-100/80"}
                            ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                          `}
                        >
                          {col.render(lead, ctx)}
                        </td>
                      ))}
                    </RevisitAwareRow>
                  );
                })
              )}
            </tbody>
          </table>
        </DraggableScroll>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RevisitAwareRow
   ─────────────────────────────────────────────────────────────────────────
   Handles hover via React state so we can apply the correct green-tinted
   background on hover for revisit rows without duplicating Tailwind utilities
   (Tailwind's JIT can't dynamically compose arbitrary rgba values in className).

   Green tint palette (Apple-like, professional):
     Normal revisit  → rgba(34, 197, 94, 0.08)   — clearly visible, not loud
     Hover revisit   → rgba(34, 197, 94, 0.13)   — slightly strengthened
     Normal row      → transparent / zebra
     Normal hover    → very subtle neutral
   ═══════════════════════════════════════════════════════════════════════════ */

function RevisitAwareRow({
  lead,
  isRevisit,
  zebraClass,
  isDark,
  onRowClick,
  children,
}: {
  lead: Lead;
  isRevisit: boolean;
  zebraClass: string;
  isDark: boolean;
  onRowClick?: (lead: Lead) => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  /*
   * Background resolution order (highest priority first):
   * 1. Lost lead → opacity dim (handled via style.opacity, not background)
   * 2. Revisit + hovered → stronger green tint
   * 3. Revisit (normal) → soft green tint
   * 4. Normal hover → neutral
   * 5. Zebra / transparent
   */
  let bgStyle: React.CSSProperties = {};

  if (isRevisit) {
    bgStyle.backgroundColor = hovered
      ? isDark
        ? "rgba(34, 197, 94, 0.13)"
        : "rgba(34, 197, 94, 0.10)"
      : isDark
      ? "rgba(34, 197, 94, 0.08)"
      : "rgba(34, 197, 94, 0.07)";
  } else if (hovered && onRowClick) {
    bgStyle.backgroundColor = isDark
      ? "rgba(255, 255, 255, 0.04)"
      : "rgba(0, 0, 0, 0.025)";
  }

  if (lead.is_lost_lead) {
    bgStyle.opacity = 0.55;
  }

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onRowClick?.(lead)}
      className={`
        transition-colors duration-150
        ${zebraClass}
        ${onRowClick ? "cursor-pointer" : ""}
      `}
      style={bgStyle}
    >
      {children}
    </tr>
  );
}
