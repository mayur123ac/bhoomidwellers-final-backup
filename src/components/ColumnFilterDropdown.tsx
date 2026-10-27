"use client";
import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaFilter, FaSearch, FaSortAlphaDown, FaSortAlphaUp } from "react-icons/fa";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FilterableColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "date";
}

export type ColFilters = Record<string, Set<string> | null>;
export type ColSort = { key: string; direction: "asc" | "desc" } | null;

// ── Hook: useColumnFilters ───────────────────────────────────────────────────
// Manages filter/sort state and provides helpers to apply them to a data array.

export function useColumnFilters() {
  const [colFilters, setColFilters] = useState<ColFilters>({});
  const [colSort, setColSort] = useState<ColSort>(null);
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);

  const applyFilter = useCallback((key: string, vals: Set<string> | null) => {
    setColFilters(prev => ({ ...prev, [key]: vals }));
  }, []);

  const applySort = useCallback((key: string, dir: "asc" | "desc" | null) => {
    setColSort(dir ? { key, direction: dir } : null);
  }, []);

  const clearAllFilters = useCallback(() => {
    setColFilters({});
    setColSort(null);
  }, []);

  /** Filter rows by all active column filters. `getDisplayValue` maps a row + column key to the string shown in the dropdown. */
  const filterRows = useCallback(
    <T,>(rows: T[], getDisplayValue: (row: T, colKey: string) => string): T[] => {
      let result = rows;
      for (const [colKey, allowedVals] of Object.entries(colFilters)) {
        if (!allowedVals) continue;
        result = result.filter(row => {
          const displayVal = getDisplayValue(row, colKey);
          const normalized = displayVal === "" ? "(Blanks)" : displayVal;
          return allowedVals.has(normalized);
        });
      }
      return result;
    },
    [colFilters],
  );

  /** Sort rows by the active column sort. `getDisplayValue` maps a row + column key to the string used for comparison. */
  const sortRows = useCallback(
    <T,>(rows: T[], getDisplayValue: (row: T, colKey: string) => string): T[] => {
      if (!colSort) return rows;
      const { key, direction } = colSort;
      return [...rows].sort((a, b) => {
        const av = getDisplayValue(a, key);
        const bv = getDisplayValue(b, key);
        const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
        return direction === "asc" ? cmp : -cmp;
      });
    },
    [colSort],
  );

  return {
    colFilters,
    colSort,
    openFilterCol,
    setOpenFilterCol,
    applyFilter,
    applySort,
    clearAllFilters,
    filterRows,
    sortRows,
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const DROPDOWN_W = 256; // w-64
const DROPDOWN_MAX_H = 420; // approximate max rendered height

// ── Component: ColumnFilterDropdown ──────────────────────────────────────────

interface ColumnFilterDropdownProps {
  column: FilterableColumn;
  /** Raw data to extract distinct values from. Each entry should have `column.key` mapped to a display string. */
  data: Record<string, unknown>[];
  activeFilter: Set<string> | null;
  activeSort: ColSort;
  onApply: (selectedValues: Set<string> | null) => void;
  onSort: (direction: "asc" | "desc" | null) => void;
  onClose: () => void;
  isDark: boolean;
  /** Accent color for OK button and checkboxes. Defaults to "#007AFF". */
  accent?: string;
}

const ColumnFilterDropdown: React.FC<ColumnFilterDropdownProps> = ({
  column, data, activeFilter, activeSort, onApply, onSort, onClose, isDark,
  accent = "#007AFF",
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Stable onClose ref to avoid re-registering listeners on every render
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ── Position the dropdown relative to the invisible anchor marker ────────
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const reposition = () => {
      if (!anchor || !document.body.contains(anchor)) {
        setCoords(null);
        return;
      }
      // Use the parent <th> (or whatever positioned ancestor) as the anchor rect
      const parentEl = anchor.closest("th") || anchor.parentElement;
      const rect = parentEl ? parentEl.getBoundingClientRect() : anchor.getBoundingClientRect();

      let top = rect.bottom + 4;
      let left = rect.left;

      // Flip up if not enough room below
      if (top + DROPDOWN_MAX_H > window.innerHeight - 8) {
        top = rect.top - DROPDOWN_MAX_H - 4;
      }
      // If flipped up goes above viewport, pin to top
      if (top < 8) top = 8;

      // Clamp horizontally
      if (left + DROPDOWN_W > window.innerWidth - 8) {
        left = window.innerWidth - DROPDOWN_W - 8;
      }
      if (left < 8) left = 8;

      setCoords({ top, left });
    };

    reposition();

    // Auto-focus search after positioning
    const focusTimer = setTimeout(() => searchRef.current?.focus(), 30);

    // Reposition on scroll (capture phase to catch scrollable containers) and resize
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);

  // ── Click-outside dismissal ──────────────────────────────────────────────
  useEffect(() => {
    const listener = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      // Click inside the portalled dropdown — keep open
      if (dropdownRef.current?.contains(target)) return;
      // Click on the trigger <th> or its button — let the toggle handler manage it
      const th = anchorRef.current?.closest("th") || anchorRef.current?.parentElement;
      if (th?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, []);

  // ── Escape key dismissal ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── Unique values and selection state ────────────────────────────────────
  const uniqueValues = useMemo(() => {
    const values = new Set<string>();
    data.forEach(row => {
      const val = row[column.key];
      values.add(val === null || val === undefined || val === "" ? "(Blanks)" : String(val));
    });
    return Array.from(values).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [data, column.key]);

  const [search, setSearch] = useState("");
  const [tempSelected, setTempSelected] = useState<Set<string>>(
    activeFilter ? new Set(activeFilter) : new Set(uniqueValues),
  );

  const filteredValues = useMemo(() => {
    if (!search) return uniqueValues;
    return uniqueValues.filter(v => v.toLowerCase().includes(search.toLowerCase()));
  }, [uniqueValues, search]);

  const allFilteredSelected = filteredValues.length > 0 && filteredValues.every(v => tempSelected.has(v));
  const someFilteredSelected = filteredValues.some(v => tempSelected.has(v)) && !allFilteredSelected;

  const toggleSelectAll = () => {
    const next = new Set(tempSelected);
    if (allFilteredSelected) {
      filteredValues.forEach(v => next.delete(v));
    } else {
      filteredValues.forEach(v => next.add(v));
    }
    setTempSelected(next);
  };

  const toggleValue = (val: string) => {
    const next = new Set(tempSelected);
    next.has(val) ? next.delete(val) : next.add(val);
    setTempSelected(next);
  };

  const handleApply = () => {
    onApply(tempSelected.size === uniqueValues.length ? null : tempSelected);
    onClose();
  };

  // ── Styles ───────────────────────────────────────────────────────────────
  const baseText = isDark ? "text-gray-200" : "text-gray-700";
  const baseBg = isDark ? "bg-[#1C1C1E] border-white/10" : "bg-white border-gray-200";
  const hoverBg = isDark ? "hover:bg-white/5" : "hover:bg-gray-50";

  const sortLabel = (dir: "asc" | "desc") => {
    if (column.type === "number") return dir === "asc" ? "Smallest to Largest" : "Largest to Smallest";
    if (column.type === "date") return dir === "asc" ? "Oldest to Newest" : "Newest to Oldest";
    return dir === "asc" ? "A to Z" : "Z to A";
  };

  // ── Render ───────────────────────────────────────────────────────────────
  // Invisible anchor marker stays in the DOM tree (inside the <th>).
  // The actual dropdown is portalled to document.body to escape overflow clipping.
  const dropdown = coords ? (
    <div
      ref={dropdownRef}
      role="dialog"
      aria-label={`Filter ${column.label}`}
      onClick={e => e.stopPropagation()}
      style={{ position: "fixed", top: coords.top, left: coords.left, width: DROPDOWN_W, zIndex: 9999 }}
      className={`shadow-2xl rounded-xl border overflow-hidden flex flex-col text-sm font-normal normal-case ${baseBg}`}
    >
      {/* Sort */}
      <div className={`p-2 border-b ${isDark ? "border-white/[0.08]" : "border-gray-100"}`}>
        <button
          onClick={() => { onSort("asc"); onClose(); }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer ${hoverBg} ${baseText} ${activeSort?.direction === "asc" ? "font-bold" : ""}`}
        >
          <FaSortAlphaDown className={isDark ? "text-gray-500" : "text-gray-400"} />
          Sort {sortLabel("asc")}
        </button>
        <button
          onClick={() => { onSort("desc"); onClose(); }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 mt-1 rounded-lg cursor-pointer ${hoverBg} ${baseText} ${activeSort?.direction === "desc" ? "font-bold" : ""}`}
        >
          <FaSortAlphaUp className={isDark ? "text-gray-500" : "text-gray-400"} />
          Sort {sortLabel("desc")}
        </button>
        {activeSort && (
          <button
            onClick={() => { onSort(null); onClose(); }}
            className={`w-full text-left px-9 py-1.5 mt-1 text-xs text-red-500 rounded-lg cursor-pointer ${hoverBg}`}
          >
            Clear Sort
          </button>
        )}
      </div>

      {/* Search */}
      <div className="p-2">
        <div className={`flex items-center px-3 py-1.5 rounded-lg border ${isDark ? "bg-black/20 border-white/10" : "bg-gray-50 border-gray-200"}`}>
          <FaSearch className={`mr-2 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Escape" && setSearch("")}
            className={`w-full bg-transparent outline-none text-xs ${isDark ? "text-gray-200 placeholder:text-gray-500" : "text-gray-700 placeholder:text-gray-400"}`}
          />
        </div>
      </div>

      {/* Checkboxes */}
      <div className={`max-h-48 overflow-y-auto px-2 pb-2 ${baseText}`}>
        <label className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer ${hoverBg}`}>
          <input
            type="checkbox"
            checked={allFilteredSelected}
            ref={input => { if (input) input.indeterminate = someFilteredSelected; }}
            onChange={toggleSelectAll}
            className="rounded border-gray-300"
            style={{ accentColor: accent }}
          />
          <span className="text-xs font-semibold">(Select All)</span>
        </label>
        {filteredValues.map(val => (
          <label key={val} className={`flex items-center gap-2 px-2 py-1 cursor-pointer rounded-lg ${hoverBg}`}>
            <input
              type="checkbox"
              checked={tempSelected.has(val)}
              onChange={() => toggleValue(val)}
              className="rounded border-gray-300"
              style={{ accentColor: accent }}
            />
            <span className="text-xs truncate">{val}</span>
          </label>
        ))}
        {filteredValues.length === 0 && (
          <div className={`px-2 py-3 text-center text-xs italic ${isDark ? "text-gray-500" : "text-gray-400"}`}>
            No matches found
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={`p-2 border-t flex justify-end gap-2 ${isDark ? "border-white/[0.08] bg-white/[0.02]" : "border-gray-100 bg-gray-50"}`}>
        <button
          onClick={onClose}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${isDark ? "border-white/10 text-gray-300 hover:bg-white/5" : "border-gray-200 text-gray-600 hover:bg-white"}`}
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          className="px-3 py-1.5 text-xs font-medium rounded-lg text-white cursor-pointer"
          style={{ backgroundColor: accent }}
        >
          OK
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* Invisible anchor marker — stays in the DOM tree inside the <th> so we
          can read its viewport position via getBoundingClientRect(). */}
      <span ref={anchorRef} className="absolute top-full left-0 w-0 h-0 pointer-events-none" aria-hidden="true" />
      {typeof document !== "undefined" && dropdown && createPortal(dropdown, document.body)}
    </>
  );
};

export default ColumnFilterDropdown;

// ── Component: FilterableColumnHeader ────────────────────────────────────────
// A <th> that renders the column label with a filter/sort button and dropdown.

interface FilterableColumnHeaderProps {
  column: FilterableColumn;
  isFiltered: boolean;
  colSort: ColSort;
  isOpen: boolean;
  onToggle: () => void;
  isDark: boolean;
  /** Accent color for active indicators. Defaults to "#007AFF". */
  accent?: string;
  /** Extra className for the <th>. */
  className?: string;
  children?: React.ReactNode;
  /** Forwarded to the underlying <th> for drag-and-drop column reordering. */
  draggable?: boolean;
  "data-colkey"?: string;
  onDragStart?: React.DragEventHandler<HTMLTableCellElement>;
  onDragOver?: React.DragEventHandler<HTMLTableCellElement>;
  onDrop?: React.DragEventHandler<HTMLTableCellElement>;
  onDragEnd?: React.DragEventHandler<HTMLTableCellElement>;
  onTouchStart?: React.TouchEventHandler<HTMLTableCellElement>;
  onTouchMove?: React.TouchEventHandler<HTMLTableCellElement>;
  onTouchEnd?: React.TouchEventHandler<HTMLTableCellElement>;
}

export const FilterableColumnHeader: React.FC<FilterableColumnHeaderProps> = ({
  column, isFiltered, colSort, isOpen, onToggle, isDark,
  accent = "#007AFF", className = "", children,
  draggable, "data-colkey": dataColkey,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onTouchStart, onTouchMove, onTouchEnd,
}) => {
  const isSorted = colSort?.key === column.key;
  const isActive = isFiltered || isSorted;

  return (
    <th
      className={`px-3 sm:px-4 py-3 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider border-b relative ${isDark ? "border-slate-800 text-slate-400" : "border-slate-200 text-[#475569]"
        } ${className}`}
      draggable={draggable}
      data-colkey={dataColkey}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onToggle(); }}
        className={`group flex items-center gap-1.5 whitespace-nowrap transition-colors ${isActive
          ? ""
          : isDark ? "text-slate-400 hover:text-slate-200" : "text-[#475569] hover:text-slate-700"
          }`}
        style={isActive ? { color: accent } : undefined}
        title={`Filter / Sort by ${column.label}`}
      >
        {column.label}
        <span
          className={`inline-flex items-center justify-center w-4 h-4 rounded transition-colors ${isActive
            ? ""
            : isDark ? "text-slate-600 group-hover:text-slate-400" : "text-slate-300 group-hover:text-slate-500"
            }`}
          style={isActive ? { backgroundColor: `${accent}22`, color: accent } : undefined}
        >
          {isSorted
            ? colSort?.direction === "asc" ? <FaSortAlphaDown className="w-2.5 h-2.5" /> : <FaSortAlphaUp className="w-2.5 h-2.5" />
            : <FaFilter className="w-2 h-2 cursor-pointer" />}
        </span>
        {isFiltered && (
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: accent }} />
        )}
      </button>
      {children}
    </th>
  );
};
