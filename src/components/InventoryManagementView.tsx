"use client";
// InventoryManagementView.tsx — Inventory Phase 5.
// Table view (sortable + resizable columns, filters, multi-select) and a
// floor×flat grid/heatmap, an Add-Unit menu wiring the Phase 2/3 modals, and a
// right-side unit detail drawer with the full inventory_unit_history log.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaPlus, FaTable, FaThLarge, FaTimes, FaSort, FaSortUp, FaSortDown,
  FaHistory, FaExternalLinkAlt, FaChevronDown, FaLayerGroup, FaPen,
  FaTrash, FaExclamationTriangle, FaBuilding,
} from "react-icons/fa";
import { formatCurrencyDisplay } from "@/lib/currency";
import AddUnitModal from "./AddUnitModal";
import BulkGenerateUnitsModal from "./BulkGenerateUnitsModal";

export interface InventoryUnit {
  id: number;
  apartment_name: string; project_name: string; tower: string; wing: string | null;
  unit_type: string; floor: number; flat_no: string;
  carpet_area_sqft: string | number | null; built_up_area_sqft: string | number | null;
  rate_per_sqft: string | number | null; base_price: string | number | null;
  facing: string | null; status: string; hold_expires_at: string | null; source: string;
  lead_id: number | null; booking_id: number | null;
  created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
  lead_name?: string | null; lead_phone?: string | null; lead_email?: string | null;
  lead_assigned_to?: string | null;   // ← NEW
  booking_number?: string | null; booking_status?: string | null; booking_primary_name?: string | null;
}
interface HistoryRow { id: number; old_status: string | null; new_status: string; changed_by: string | null; reason: string | null; changed_at: string; }

// ── 8-status config (badge classes + heatmap hex) ──
type SC = { label: string; text: string; border: string; bg: string; hex: string };
const STATUS: Record<string, SC> = {
  available: { label: "Available", text: "text-emerald-500", border: "border-emerald-500/30", bg: "bg-emerald-500/10", hex: "#10b981" },
  booked: { label: "Booked", text: "text-blue-500", border: "border-blue-500/30", bg: "bg-blue-500/10", hex: "#3b82f6" },
  blocked: { label: "Blocked", text: "text-gray-500", border: "border-gray-400/30", bg: "bg-gray-500/10", hex: "#6b7280" },
  on_hold: { label: "On Hold", text: "text-amber-500", border: "border-amber-500/30", bg: "bg-amber-500/10", hex: "#f59e0b" },
  registered: { label: "Registered", text: "text-violet-500", border: "border-violet-500/30", bg: "bg-violet-500/10", hex: "#8b5cf6" },
  refuge_area: { label: "Refuge Area", text: "text-zinc-500", border: "border-zinc-400/30", bg: "bg-zinc-500/10", hex: "#71717a" },
  unfinished: { label: "Unfinished", text: "text-orange-500", border: "border-orange-500/30", bg: "bg-orange-500/10", hex: "#f97316" },
  cancelled: { label: "Cancelled", text: "text-red-500", border: "border-red-500/30", bg: "bg-red-500/10", hex: "#ef4444" },
};
const sc = (s: string): SC => STATUS[s] || { label: s, text: "text-gray-500", border: "border-gray-400/30", bg: "bg-gray-500/10", hex: "#9ca3af" };
const STATUS_KEYS = Object.keys(STATUS);


// Delete guardrail (mirrors the server in lib/inventoryDelete.ts). A unit is
// "linked/active" — and so guarded — when booked/registered/on_hold or tied to a lead/booking.
const ACTIVE_STATUSES = ["booked", "registered", "on_hold"];
const isLinkedActive = (u: InventoryUnit) => ACTIVE_STATUSES.includes(u.status) || u.lead_id != null || u.booking_id != null;
const linkLabel = (u: InventoryUnit) => {
  const p: string[] = [];
  if (u.booking_id) p.push(`booking #${u.booking_id}`);
  if (u.lead_id) p.push(`lead #${u.lead_id}`);
  if (p.length) return p.join(" / ");
  if (u.status === "on_hold") return "on hold";
  return u.status;
};
// Statuses a manager may set by hand (booked/registered are sync-only; on_hold needs an expiry; cancelled via booking flow).
const EDITABLE_STATUSES = ["available", "blocked", "refuge_area", "unfinished"];
const UNIT_TYPES = ["1 RK", "1BHK", "1.5BHK", "2BHK", "2.5BHK", "3BHK", "3.5BHK", "4BHK", "Penthouse", "Shop", "Office", "Other"];

function StatusBadge({ status }: { status: string }) {
  const c = sc(status);
  return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border inline-flex items-center flex-shrink-0 ${c.text} ${c.border} ${c.bg}`}>{c.label}</span>;
}

const num = (v: any): number => { const n = Number(String(v ?? "").replace(/[,\s₹]/g, "")); return isNaN(n) ? 0 : n; };
const area = (v: any) => { const n = num(v); return n ? `${n.toLocaleString("en-IN")}` : "—"; };

interface Column { key: string; label: string; w: number; sortable: boolean; numeric?: boolean; }
const COLUMNS: Column[] = [
  { key: "apartment_name", label: "Apartment", w: 150, sortable: true },
  { key: "project_name", label: "Project", w: 130, sortable: true },
  { key: "tower", label: "Tower", w: 70, sortable: true },
  { key: "wing", label: "Wing", w: 64, sortable: true },
  { key: "floor", label: "Floor", w: 64, sortable: true, numeric: true },
  { key: "flat_no", label: "Flat No.", w: 90, sortable: true },
  { key: "unit_type", label: "Type", w: 96, sortable: true },
  { key: "carpet_area_sqft", label: "Carpet (sqft)", w: 108, sortable: true, numeric: true },
  { key: "status", label: "Status", w: 116, sortable: true },
  { key: "source", label: "Source", w: 118, sortable: true },
  { key: "linked", label: "Linked", w: 140, sortable: false },
];

interface Props {
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
  onOpenLead?: (leadId: number) => void;
  onOpenBooking?: (bookingId: number) => void;
}

const blankFilters = { search: "", project_name: "", tower: "", wing: "", floor: "", unit_type: "", status: "", min_area: "", max_area: "" };

export default function InventoryManagementView({ user, isDark, t, onOpenLead, onOpenBooking }: Props) {
  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase())
  const isAdminUser = (user?.role || "").trim().toLowerCase() === "admin"; // delete is admin-only

  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [filters, setFilters] = useState({ ...blankFilters });
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "tower", dir: "asc" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [colW, setColW] = useState<Record<string, number>>(() => Object.fromEntries(COLUMNS.map(c => [c.key, c.w])));
  const [addMenu, setAddMenu] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryUnit | null>(null); // single delete
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bldDelOpen, setBldDelOpen] = useState(false);

  const inputCls = `rounded-lg px-2.5 py-1.5 text-xs outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;

  // ── Fetch (server-side filters; sorting is client-side so every column sorts) ──
  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.search) p.set("search", filters.search);
      if (filters.project_name) p.set("project_name", filters.project_name);
      if (filters.tower) p.set("tower", filters.tower);
      if (filters.wing) p.set("wing", filters.wing);
      if (filters.floor) p.set("floor", filters.floor);
      if (filters.unit_type) p.set("unit_type", filters.unit_type);
      if (filters.status) p.set("status", filters.status);
      if (filters.min_area) p.set("min_area", filters.min_area);
      if (filters.max_area) p.set("max_area", filters.max_area);
      p.set("limit", "500");
      const res = await fetch(`/api/inventory?${p.toString()}`);
      const json = await res.json();
      if (json.success) { setUnits(json.data); setTotal(json.total ?? json.data.length); }
    } catch { /* non-blocking */ } finally { setLoading(false); }
  }, [filters]);

  // Debounced refetch on filter change.
  useEffect(() => {
    const id = setTimeout(fetchUnits, 250);
    return () => clearTimeout(id);
  }, [fetchUnits]);

  const setFilter = (patch: Partial<typeof blankFilters>) => setFilters(f => ({ ...f, ...patch }));

  // ── Sorting (client-side) ──
  const sorted = useMemo(() => {
    const col = COLUMNS.find(c => c.key === sort.key);
    const arr = [...units];
    arr.sort((a, b) => {
      let av: any = (a as any)[sort.key], bv: any = (b as any)[sort.key];
      if (sort.key === "status") { av = sc(a.status).label; bv = sc(b.status).label; }
      if (col?.numeric) { av = num(av); bv = num(bv); return sort.dir === "asc" ? av - bv : bv - av; }
      av = String(av ?? "").toLowerCase(); bv = String(bv ?? "").toLowerCase();
      return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return arr;
  }, [units, sort]);

  const toggleSort = (key: string) => {
    const col = COLUMNS.find(c => c.key === key);
    if (!col?.sortable) return;
    setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };

  // ── Column resize ──
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizing.current; if (!r) return;
    setColW(w => ({ ...w, [r.key]: Math.max(50, r.startW + (e.clientX - r.startX)) }));
  }, []);
  const onResizeEnd = useCallback(() => {
    resizing.current = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
  }, [onResizeMove]);
  const onResizeStart = (e: React.MouseEvent, key: string) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startW: colW[key] };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  };

  // ── Multi-select ──
  const allSelected = sorted.length > 0 && sorted.every(u => selected.has(u.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(sorted.map(u => u.id)));
  const toggleOne = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const afterCreate = () => { setSelected(new Set()); fetchUnits(); };
  const afterDelete = () => { setSelected(new Set()); setDeleteTarget(null); setBulkDelOpen(false); setBldDelOpen(false); fetchUnits(); };
  const selectedUnits = useMemo(() => sorted.filter(u => selected.has(u.id)), [sorted, selected]);

  // ── Heatmap grouping (floors desc, flats sorted within a floor) ──
  const floorsGrouped = useMemo(() => {
    const byFloor = new Map<number, InventoryUnit[]>();
    for (const u of sorted) { if (!byFloor.has(u.floor)) byFloor.set(u.floor, []); byFloor.get(u.floor)!.push(u); }
    return [...byFloor.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([floor, us]) => [floor, [...us].sort((a, b) => a.flat_no.localeCompare(b.flat_no, undefined, { numeric: true }))] as [number, InventoryUnit[]]);
  }, [sorted]);

  const openLinked = (u: InventoryUnit) => {
    if (u.lead_id && onOpenLead) onOpenLead(u.lead_id);
    else if (u.booking_id && onOpenBooking) onOpenBooking(u.booking_id);
  };
  const linkClickable = !!(onOpenLead || onOpenBooking);
  const linkChip = (u: InventoryUnit) => {
    if (u.booking_id) return (
      <button type="button" onClick={e => { e.stopPropagation(); openLinked(u); }} disabled={!linkClickable}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${linkClickable ? "text-blue-500 hover:bg-blue-500/10 cursor-pointer" : t.textMuted}`}>
        Booking #{u.booking_id}{linkClickable && <FaExternalLinkAlt className="text-[7px]" />}
      </button>
    );
    if (u.lead_id) return (
      <button type="button" onClick={e => { e.stopPropagation(); openLinked(u); }} disabled={!linkClickable}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${linkClickable ? "text-[#00AEEF] hover:bg-[#00AEEF]/10 cursor-pointer" : t.textMuted}`}>
        Lead #{u.lead_id}{linkClickable && <FaExternalLinkAlt className="text-[7px]" />}
      </button>
    );
    return <span className={`text-[10px] ${t.textFaint}`}>—</span>;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h1 className={`text-lg font-bold ${t.text}`}>Inventory</h1>
          <p className={`text-[11px] ${t.textMuted}`}>{loading ? "Loading…" : `${total} unit${total === 1 ? "" : "s"}`}{total > units.length ? ` (showing ${units.length})` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className={`flex items-center rounded-lg border overflow-hidden ${t.tableBorder}`}>
            <button onClick={() => setViewMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${viewMode === "table" ? "bg-[#00AEEF] text-white" : `${t.textMuted}`}`}><FaTable className="text-[10px]" /> Table</button>
            <button onClick={() => setViewMode("grid")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${viewMode === "grid" ? "bg-[#00AEEF] text-white" : `${t.textMuted}`}`}><FaThLarge className="text-[10px]" /> Grid</button>
          </div>
          {/* Add Unit menu (managers only) */}
          {canManage && (
            <div className="relative">
              <button onClick={() => setAddMenu(v => !v)} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">
                <FaPlus className="text-[10px]" /> Add Unit <FaChevronDown className="text-[8px]" />
              </button>
              {addMenu && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setAddMenu(false)} />
                  <div className={`absolute right-0 mt-1 w-52 rounded-xl border shadow-xl z-[61] overflow-hidden ${t.modalCard}`}>
                    <button onClick={() => { setAddMenu(false); setShowAdd(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 ${t.text}`}><FaPen className="text-[10px] text-[#00AEEF]" /> Manual entry</button>
                    <button onClick={() => { setAddMenu(false); setShowBulk(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 border-t ${t.tableBorder} ${t.text}`}><FaLayerGroup className="text-[10px] text-[#00AEEF]" /> Bulk generate building</button>
                  </div>
                </>
              )}
            </div>
          )}
          {/* Whole-building delete (admin only) — separate from row/bulk-select */}
          {isAdminUser && (
            <button onClick={() => setBldDelOpen(true)} title="Delete a whole building/tower"
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10">
              <FaBuilding className="text-[10px]" /> Delete building
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className={`flex items-center gap-2 flex-wrap mb-3 p-2.5 rounded-xl border ${t.innerBlock}`}>
        <input value={filters.search} onChange={e => setFilter({ search: e.target.value })} placeholder="Search flat / apartment / project…" className={`${inputCls} w-56`} />
        <input value={filters.project_name} onChange={e => setFilter({ project_name: e.target.value })} placeholder="Project" className={`${inputCls} w-28`} />
        <input value={filters.tower} onChange={e => setFilter({ tower: e.target.value })} placeholder="Tower" className={`${inputCls} w-20`} />
        <input value={filters.wing} onChange={e => setFilter({ wing: e.target.value })} placeholder="Wing" className={`${inputCls} w-20`} />
        <input value={filters.floor} onChange={e => setFilter({ floor: e.target.value })} placeholder="Floor" className={`${inputCls} w-20`} />
        <select value={filters.unit_type} onChange={e => setFilter({ unit_type: e.target.value })} className={`${selectCls} w-28`}>
          <option value="">All types</option>{UNIT_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={filters.status} onChange={e => setFilter({ status: e.target.value })} className={`${selectCls} w-32`}>
          <option value="">All statuses</option>{STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
        <input value={filters.min_area} onChange={e => setFilter({ min_area: e.target.value })} placeholder="Min sqft" type="number" className={`${inputCls} w-24`} />
        <input value={filters.max_area} onChange={e => setFilter({ max_area: e.target.value })} placeholder="Max sqft" type="number" className={`${inputCls} w-24`} />
        {Object.values(filters).some(Boolean) && (
          <button onClick={() => setFilters({ ...blankFilters })} className={`text-[11px] font-semibold px-2 py-1.5 rounded-lg ${t.textMuted} hover:text-red-500`}>Clear</button>
        )}
      </div>

      {/* Selection bar (bulk actions land in Phase 6) */}
      {selected.size > 0 && (
        <div className={`flex items-center gap-3 mb-2 px-3 py-2 rounded-lg border border-[#00AEEF]/30 bg-[#00AEEF]/5`}>
          <span className={`text-xs font-bold ${t.text}`}>{selected.size} selected</span>
          {isAdminUser && (
            <button onClick={() => setBulkDelOpen(true)} className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20">
              <FaTrash className="text-[9px]" /> Delete selected
            </button>
          )}
          <span className={`text-[11px] ${t.textMuted}`}>Other bulk actions in Phase 6</span>
          <button onClick={() => setSelected(new Set())} className={`ml-auto text-[11px] font-semibold ${t.textMuted} hover:text-red-500`}>Clear selection</button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {loading && units.length === 0 ? (
          <p className={`text-sm italic ${t.textFaint} p-4`}>Loading inventory…</p>
        ) : units.length === 0 ? (
          <p className={`text-sm italic ${t.textFaint} p-4`}>No units match. {canManage ? "Add units with the button above." : ""}</p>
        ) : viewMode === "table" ? (
          <TableView
            columns={COLUMNS} colW={colW} sort={sort} sorted={sorted} t={t}
            allSelected={allSelected} selected={selected} toggleAll={toggleAll} toggleOne={toggleOne}
            toggleSort={toggleSort} onResizeStart={onResizeStart} onRowClick={(id: number) => setDrawerId(id)} linkChip={linkChip}
            canDelete={isAdminUser} onDeleteUnit={(u: InventoryUnit) => setDeleteTarget(u)}
          />
        ) : (
          <GridView floorsGrouped={floorsGrouped} t={t} onCellClick={(id) => setDrawerId(id)} />
        )}
      </div>

      {/* ── Modals ── */}
      {canManage && (
        <AddUnitModal isOpen={showAdd} onClose={() => setShowAdd(false)} onCreated={afterCreate} user={user} isDark={isDark} t={t}
          existingUnits={units.map(u => ({ project_name: u.project_name, tower: u.tower, wing: u.wing, floor: u.floor, flat_no: u.flat_no }))} />
      )}
      {canManage && (
        <BulkGenerateUnitsModal isOpen={showBulk} onClose={() => setShowBulk(false)} onCreated={afterCreate} user={user} isDark={isDark} t={t} />
      )}

      {/* ── Delete modals (admin only) ── */}
      {isAdminUser && deleteTarget && (
        <DeleteUnitModal unit={deleteTarget} user={user} isDark={isDark} t={t} onClose={() => setDeleteTarget(null)} onDeleted={afterDelete} />
      )}
      {isAdminUser && bulkDelOpen && (
        <BulkDeleteModal selectedUnits={selectedUnits} user={user} isDark={isDark} t={t} onClose={() => setBulkDelOpen(false)} onDeleted={afterDelete} />
      )}
      {isAdminUser && bldDelOpen && (
        <BuildingDeleteModal user={user} isDark={isDark} t={t} onClose={() => setBldDelOpen(false)} onDeleted={afterDelete}
          defaults={{ project_name: filters.project_name, tower: filters.tower, wing: filters.wing }} />
      )}

      {/* ── Detail drawer ── */}
      <UnitDrawer unitId={drawerId} onClose={() => setDrawerId(null)} user={user} canManage={canManage} isAdminUser={isAdminUser} isDark={isDark} t={t}
        onOpenLead={onOpenLead} onOpenBooking={onOpenBooking} onChanged={fetchUnits}
        onRequestDelete={(u: InventoryUnit) => { setDrawerId(null); setDeleteTarget(u); }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Table view
// ═══════════════════════════════════════════════════════════════════════════
function TableView({ columns, colW, sort, sorted, t, allSelected, selected, toggleAll, toggleOne, toggleSort, onResizeStart, onRowClick, linkChip, canDelete, onDeleteUnit }: any) {
  const totalW = 40 + columns.reduce((s: number, c: Column) => s + colW[c.key], 0) + (canDelete ? 56 : 0);
  const sortIcon = (key: string) => sort.key !== key ? <FaSort className="text-[8px] opacity-40" /> : sort.dir === "asc" ? <FaSortUp className="text-[8px]" /> : <FaSortDown className="text-[8px]" />;
  const cell = (u: InventoryUnit, key: string) => {
    if (key === "status") return <StatusBadge status={u.status} />;
    if (key === "linked") return linkChip(u);
    if (key === "carpet_area_sqft") return area(u.carpet_area_sqft);
    if (key === "source") return <span className={`text-[10px] ${t.textMuted}`}>{String(u.source || "").replace("_", " ")}</span>;
    const v = (u as any)[key];
    return v === null || v === undefined || v === "" ? <span className={t.textFaint}>—</span> : String(v);
  };
  return (
    <table style={{ tableLayout: "fixed", width: totalW, minWidth: "100%" }} className="text-left border-collapse">
      <colgroup>
        <col style={{ width: 40 }} />
        {columns.map((c: Column) => <col key={c.key} style={{ width: colW[c.key] }} />)}
        {canDelete && <col style={{ width: 56 }} />}
      </colgroup>
      <thead>
        <tr className={`${t.tableHead}`}>
          <th className="px-2 py-2 sticky top-0"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer accent-[#00AEEF]" /></th>
          {columns.map((c: Column) => (
            <th key={c.key} className={`relative px-2 py-2 text-[10px] font-bold uppercase tracking-wider ${t.textMuted} select-none`}>
              <button type="button" onClick={() => toggleSort(c.key)} className={`flex items-center gap-1 ${c.sortable ? "cursor-pointer hover:text-[#00AEEF]" : "cursor-default"}`}>
                <span className="truncate">{c.label}</span>{c.sortable && sortIcon(c.key)}
              </button>
              <span onMouseDown={e => onResizeStart(e, c.key)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-[#00AEEF]/40" />
            </th>
          ))}
          {canDelete && <th className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-right ${t.textMuted}`}>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {sorted.map((u: InventoryUnit) => (
          <tr key={u.id} onClick={() => onRowClick(u.id)} className={`border-t ${t.tableBorder} ${t.tableRow} cursor-pointer ${selected.has(u.id) ? "bg-[#00AEEF]/5" : ""}`}>
            <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} className="cursor-pointer accent-[#00AEEF]" /></td>
            {columns.map((c: Column) => (
              <td key={c.key} className={`px-2 py-1.5 text-xs truncate ${t.text}`}>{cell(u, c.key)}</td>
            ))}
            {canDelete && (
              <td className="px-2 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                <button type="button" onClick={() => onDeleteUnit(u)} title={isLinkedActive(u) ? `Delete — warning: ${linkLabel(u)}` : "Delete unit"}
                  className="p-1.5 rounded text-red-500 hover:bg-red-500/10"><FaTrash className="text-[11px]" /></button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Grid / heatmap view
// ═══════════════════════════════════════════════════════════════════════════
function GridView({ floorsGrouped, t, onCellClick }: { floorsGrouped: [number, InventoryUnit[]][]; t: any; onCellClick: (id: number) => void }) {
  return (
    <div>
      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        {STATUS_KEYS.map(s => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[10px]">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: STATUS[s].hex + "33", border: `1px solid ${STATUS[s].hex}` }} />
            <span className={t.textMuted}>{STATUS[s].label}</span>
          </span>
        ))}
      </div>
      <div className="space-y-1.5">
        {floorsGrouped.map(([floor, us]) => (
          <div key={floor} className="flex items-center gap-2">
            <div className={`w-14 flex-shrink-0 text-right text-[11px] font-bold ${t.textMuted}`}>{floor === 0 ? "Ground" : `Fl ${floor}`}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {us.map(u => {
                const c = sc(u.status);
                return (
                  <button key={u.id} type="button" onClick={() => onCellClick(u.id)}
                    title={`${u.flat_no} · ${u.unit_type} · ${c.label}${u.wing ? " · Wing " + u.wing : ""}`}
                    className="w-14 h-11 rounded-md flex flex-col items-center justify-center text-[9px] font-bold leading-tight transition-transform hover:scale-105"
                    style={{ backgroundColor: c.hex + "26", border: `1px solid ${c.hex}80`, color: c.hex }}>
                    <span>{u.flat_no}</span>
                    <span className="opacity-70 font-semibold">{u.unit_type}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Delete modals (admin only) — soft-delete, guardrail, history logged server-side
// ═══════════════════════════════════════════════════════════════════════════
function ModalShell({ isDark, onClose, children, maxW = "max-w-lg" }: any) {
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[210] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <motion.div initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className={`w-full ${maxW} rounded-2xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Single delete: standard confirm for an unlinked unit; a hard warning + type-the-flat-number
// override for a linked/active one (which the server also requires via ?force=true).
function DeleteUnitModal({ unit, user, isDark, t, onClose, onDeleted }: any) {
  const linked = isLinkedActive(unit);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const statusPhrase = unit.status === "on_hold" ? "on hold" : unit.status;
  const linkParts: string[] = [];
  if (unit.booking_id) linkParts.push(`booking #${unit.booking_id}`);
  if (unit.lead_id) linkParts.push(`lead #${unit.lead_id}`);
  const linkPhrase = linkParts.join(" / ");
  const canConfirm = !linked || typed.trim() === String(unit.flat_no);

  const doDelete = async () => {
    if (!canConfirm) return;
    setBusy(true); setErr(null);
    try {
      const qs = new URLSearchParams({ user_role: user.role, user_name: user.name });
      if (linked) qs.set("force", "true");
      const res = await fetch(`/api/inventory/${unit.id}?${qs.toString()}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to delete unit");
      onDeleted();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <FaExclamationTriangle className={linked ? "text-red-500" : "text-amber-500"} />
          <h2 className={`text-base font-bold ${t.text}`}>{linked ? "Delete a linked flat?" : `Delete flat ${unit.flat_no}?`}</h2>
        </div>
        {linked ? (
          <>
            <p className={`text-xs leading-relaxed mb-3 ${t.text}`}>
              This flat is currently <b>{statusPhrase}</b>{linkPhrase ? <> and linked to <b>{linkPhrase}</b></> : null}. Deleting it will <b>NOT</b> cancel the booking, but the flat&apos;s inventory record will be removed and this link will be lost. Are you sure you want to proceed?
            </p>
            <label className={`text-[11px] block mb-1 ${t.textMuted}`}>Type the flat number <b className={t.text}>{unit.flat_no}</b> to confirm</label>
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={String(unit.flat_no)} className={`w-full rounded-lg px-3 py-2 text-sm border ${t.inputInner} ${t.text} ${t.inputFocus}`} />
          </>
        ) : (
          <p className={`text-xs leading-relaxed mb-3 ${t.text}`}>This soft-deletes the unit — it&apos;s kept in history and recoverable (sets <code>deleted_at</code>), not permanently removed. Continue?</p>
        )}
        {err && <p className="text-red-500 text-[11px] mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
          <button onClick={doDelete} disabled={busy || !canConfirm} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40">
            <FaTrash className="text-[10px]" /> {busy ? "Deleting…" : linked ? "Force delete" : "Delete"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// Bulk delete: preview deletable vs skipped(linked), commit, then show the result summary.
function BulkDeleteModal({ selectedUnits, user, isDark, t, onClose, onDeleted }: any) {
  const deletable = selectedUnits.filter((u: InventoryUnit) => !isLinkedActive(u));
  const skipped = selectedUnits.filter((u: InventoryUnit) => isLinkedActive(u));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ deleted: number; skipped: number; skipped_details: any[] } | null>(null);

  const commit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/inventory/bulk`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedUnits.map((u: InventoryUnit) => u.id), user_name: user.name, user_role: user.role }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to delete");
      setResult({ deleted: json.deleted, skipped: json.skipped, skipped_details: json.skipped_details || [] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3"><FaTrash className="text-red-500" /><h2 className={`text-base font-bold ${t.text}`}>Delete selected units</h2></div>
        {result ? (
          <>
            <p className={`text-sm mb-3 ${t.text}`}><b>{result.deleted}</b> deleted{result.skipped ? <>, <b>{result.skipped}</b> skipped (linked)</> : null}.</p>
            {result.skipped_details.length > 0 && (
              <div className={`rounded-lg border p-2.5 max-h-40 overflow-y-auto ${t.innerBlock}`}>
                {result.skipped_details.map((s: any, i: number) => <p key={i} className={`text-[11px] ${t.textFaint}`}><b className={t.text}>{s.flat_no}</b> — {s.reason}</p>)}
              </div>
            )}
            <div className="flex justify-end mt-4"><button onClick={onDeleted} className="text-xs font-bold px-5 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">Done</button></div>
          </>
        ) : (
          <>
            <p className={`text-sm mb-2 ${t.text}`}><b>{deletable.length}</b> deletable, <b>{skipped.length}</b> skipped (linked)</p>
            {skipped.length > 0 && (
              <div className={`rounded-lg border p-2.5 mb-2 max-h-40 overflow-y-auto ${t.innerBlock}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${t.textMuted}`}>Skipped (linked / active)</p>
                {skipped.map((u: InventoryUnit) => <p key={u.id} className={`text-[11px] ${t.textFaint}`}><b className={t.text}>{u.flat_no}</b> — linked to {linkLabel(u)}</p>)}
              </div>
            )}
            <p className={`text-[11px] ${t.textFaint} mb-3`}>Deletable units are soft-deleted (kept in history, recoverable). Linked units are skipped.</p>
            {err && <p className="text-red-500 text-[11px] mb-2">{err}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
              <button onClick={commit} disabled={busy || deletable.length === 0} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40">
                <FaTrash className="text-[10px]" /> {busy ? "Deleting…" : `Delete ${deletable.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// Whole-building delete: scope inputs, live preview count (+ linked-blocked), type-to-confirm.
function BuildingDeleteModal({ user, isDark, t, onClose, onDeleted, defaults }: any) {
  const [scope, setScope] = useState({ apartment_name: "", project_name: defaults?.project_name || "", tower: defaults?.tower || "", wing: defaults?.wing || "" });
  const [preview, setPreview] = useState<{ matched: number; linked: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const ready = !!(scope.project_name.trim() && scope.tower.trim());

  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    const id = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        // Accurate COUNT(*) preview — never capped, matches the uncapped delete scope.
        const p = new URLSearchParams();
        p.set("project_name", scope.project_name.trim());
        p.set("tower", scope.tower.trim());
        if (scope.wing.trim()) p.set("wing", scope.wing.trim());
        if (scope.apartment_name.trim()) p.set("apartment_name", scope.apartment_name.trim());
        const res = await fetch(`/api/inventory/building?${p.toString()}`);
        const json = await res.json();
        if (json.success) setPreview({ matched: json.matched, linked: json.linked });
      } catch { /* */ } finally { setLoadingPreview(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [scope, ready]);

  const confirmOk = ready && (typed.trim().toLowerCase() === scope.tower.trim().toLowerCase() || typed.trim() === "DELETE");
  const deletable = preview ? preview.matched - preview.linked : 0;

  const commit = async () => {
    if (!confirmOk) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/inventory/building`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, user_name: user.name, user_role: user.role }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to delete building");
      setResult(json);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-lg">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3"><FaBuilding className="text-red-500" /><h2 className={`text-base font-bold ${t.text}`}>Delete whole building / tower</h2></div>
        {result ? (
          <>
            <p className={`text-sm mb-3 ${t.text}`}><b>{result.deleted}</b> deleted{result.skipped ? <>, <b>{result.skipped}</b> skipped (linked)</> : null}.</p>
            {(result.skipped_details || []).length > 0 && (
              <div className={`rounded-lg border p-2.5 max-h-40 overflow-y-auto ${t.innerBlock}`}>
                {result.skipped_details.map((s: any, i: number) => <p key={i} className={`text-[11px] ${t.textFaint}`}><b className={t.text}>{s.flat_no}</b> — {s.reason}</p>)}
              </div>
            )}
            <div className="flex justify-end mt-4"><button onClick={onDeleted} className="text-xs font-bold px-5 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">Done</button></div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <div><label className={`text-[11px] mb-1 block ${t.textMuted}`}>Project *</label><input value={scope.project_name} onChange={e => setScope(s => ({ ...s, project_name: e.target.value }))} className={inputCls} /></div>
              <div><label className={`text-[11px] mb-1 block ${t.textMuted}`}>Tower *</label><input value={scope.tower} onChange={e => setScope(s => ({ ...s, tower: e.target.value }))} className={inputCls} /></div>
              <div><label className={`text-[11px] mb-1 block ${t.textMuted}`}>Wing</label><input value={scope.wing} onChange={e => setScope(s => ({ ...s, wing: e.target.value }))} className={inputCls} placeholder="All wings" /></div>
              <div><label className={`text-[11px] mb-1 block ${t.textMuted}`}>Apartment</label><input value={scope.apartment_name} onChange={e => setScope(s => ({ ...s, apartment_name: e.target.value }))} className={inputCls} placeholder="Optional" /></div>
            </div>
            {!ready ? <p className={`text-[11px] ${t.textFaint} mb-3`}>Enter project and tower to preview.</p> : (
              <div className={`rounded-lg border p-3 mb-3 ${t.innerBlock}`}>
                {loadingPreview ? <p className={`text-[11px] ${t.textFaint}`}>Counting…</p> : preview ? (
                  <p className={`text-xs ${t.text}`}><b>{preview.matched}</b> units match · <b className="text-amber-500">{preview.linked}</b> blocked (linked) · <b className="text-red-500">{deletable}</b> will be deleted</p>
                ) : null}
              </div>
            )}
            <p className={`text-xs leading-relaxed mb-2 ${t.text}`}>This soft-deletes every unlinked unit in the scope (kept in history). Linked/active units are skipped.</p>
            <label className={`text-[11px] block mb-1 ${t.textMuted}`}>Type the tower name <b className={t.text}>{scope.tower || "…"}</b> (or <b className={t.text}>DELETE</b>) to confirm</label>
            <input value={typed} onChange={e => setTyped(e.target.value)} className={inputCls} placeholder={scope.tower || "DELETE"} />
            {err && <p className="text-red-500 text-[11px] mt-2">{err}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
              <button onClick={commit} disabled={busy || !confirmOk || deletable === 0} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40">
                <FaTrash className="text-[10px]" /> {busy ? "Deleting…" : `Delete ${deletable} unit${deletable === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit detail drawer
// ═══════════════════════════════════════════════════════════════════════════
function UnitDrawer({ unitId, onClose, user, canManage, isAdminUser, isDark, t, onOpenLead, onOpenBooking, onChanged, onRequestDelete }: any) {
  const [unit, setUnit] = useState<InventoryUnit | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const roleClean = (user?.role || "").trim().toLowerCase();
  const isSalesManagerUser = ["sales manager", "sales_manager"].includes(roleClean);
  const isOwnLead = !!(unit?.lead_assigned_to && user?.name && unit.lead_assigned_to === user.name);
  // Admin always sees everything. A Sales Manager sees full contact details only
  // for leads assigned to them; otherwise just name + booking number.
  const fullLinkedDetails = isAdminUser || !isSalesManagerUser || isOwnLead;
  const load = useCallback(async () => {
    if (unitId == null) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/inventory/${unitId}`);
      const json = await res.json();
      if (json.success) { setUnit(json.data); setHistory(json.data.history || []); setNewStatus(json.data.status); }
    } catch { /* */ } finally { setLoading(false); }
  }, [unitId]);
  useEffect(() => { setEditing(false); load(); }, [load]);

  const saveStatus = async () => {
    if (!unit) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/inventory/${unit.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, user_name: user.name, user_role: user.role }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to update status");
      setEditing(false); await load(); onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const row = (label: string, val: any) => (
    <div className="flex justify-between gap-3 py-1.5"><span className={`text-[11px] ${t.textMuted}`}>{label}</span><span className={`text-xs font-semibold text-right ${t.text}`}>{val ?? "—"}</span></div>
  );

  return (
    <AnimatePresence>
      {unitId != null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className={`w-full max-w-md h-full flex flex-col border-l ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>
            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                <h2 className={`text-base font-bold ${t.text}`}>{unit ? `Flat ${unit.flat_no}` : "Unit"}</h2>
                {unit && <p className={`text-[11px] ${t.textMuted}`}>{unit.project_name} · {unit.tower}{unit.wing ? "/" + unit.wing : ""} · {unit.floor === 0 ? "Ground" : "Floor " + unit.floor}</p>}
              </div>
              <button onClick={onClose} className={`p-2 rounded-xl ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {loading || !unit ? <p className={`text-sm italic ${t.textFaint}`}>Loading…</p> : (
                <>
                  {/* Status + edit */}
                  <div className="flex items-center justify-between mb-3">
                    <StatusBadge status={unit.status} />
                    <div className="flex items-center gap-3">
                      {canManage && !editing && <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-[#00AEEF] hover:underline flex items-center gap-1"><FaPen className="text-[9px]" /> Change status</button>}
                      {isAdminUser && <button onClick={() => onRequestDelete(unit)} className="text-[11px] font-semibold text-red-500 hover:underline flex items-center gap-1"><FaTrash className="text-[9px]" /> Delete</button>}
                    </div>
                  </div>
                  {editing && (
                    <div className={`rounded-lg border p-2.5 mb-3 ${t.innerBlock}`}>
                      <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className={`w-full rounded-lg px-2.5 py-1.5 text-xs border cursor-pointer ${t.inputInner} ${t.text} ${t.inputFocus}`}>
                        {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
                      </select>
                      <p className={`text-[10px] mt-1 ${t.textFaint}`}>Booked/Registered are set by the booking flow; not manually settable.</p>
                      {err && <p className="text-red-500 text-[11px] mt-1">{err}</p>}
                      <div className="flex gap-2 mt-2">
                        <button onClick={saveStatus} disabled={busy} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
                        <button onClick={() => { setEditing(false); setNewStatus(unit.status); setErr(null); }} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Details */}
                  <div className={`rounded-xl border p-3 mb-3 ${t.innerBlock}`}>
                    {row("Apartment", unit.apartment_name)}
                    {row("Type", unit.unit_type)}
                    {row("Carpet area", `${area(unit.carpet_area_sqft)} sqft`)}
                    {num(unit.built_up_area_sqft) ? row("Built-up area", `${area(unit.built_up_area_sqft)} sqft`) : null}
                    {unit.facing ? row("Facing", unit.facing) : null}
                    {num(unit.rate_per_sqft) ? row("Rate / sqft", formatCurrencyDisplay(unit.rate_per_sqft)) : null}
                    {num(unit.base_price) ? row("Base price", formatCurrencyDisplay(unit.base_price)) : null}
                    {row("Source", String(unit.source || "").replace("_", " "))}
                  </div>

                  {(unit.booking_id || unit.lead_id) && (
                    <div className={`rounded-xl border p-3 mb-3 ${t.innerBlock}`}>
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${t.textMuted}`}>Linked</p>
                      {fullLinkedDetails ? (
                        <>
                          {(unit.lead_name || unit.lead_id) && (
                            <div className="mb-2">
                              <p className={`text-sm font-bold ${t.text}`}>{unit.lead_name || `Lead #${unit.lead_id}`}</p>
                              <div className={`text-[11px] ${t.textMuted}`}>
                                {unit.lead_phone ? <span>{unit.lead_phone}</span> : null}
                                {unit.lead_phone && unit.lead_email ? " · " : ""}
                                {unit.lead_email ? <span>{unit.lead_email}</span> : null}
                                {unit.lead_id ? <span className={t.textFaint}> · Lead #{unit.lead_id}</span> : null}
                              </div>
                            </div>
                          )}
                          {unit.booking_id && (
                            <div className={`text-[11px] mb-2 ${t.textMuted}`}>
                              Booking <b className={t.text}>{unit.booking_number || `#${unit.booking_id}`}</b>
                              {unit.booking_status ? <> · <span className={t.text}>{unit.booking_status}</span></> : null}
                              {unit.booking_primary_name ? <> · {unit.booking_primary_name}</> : null}
                            </div>
                          )}
                          {(onOpenLead && unit.lead_id) ? (
                            <button onClick={() => onOpenLead!(unit.lead_id!)} className="flex items-center gap-1.5 text-xs font-bold text-[#00AEEF] hover:underline">
                              Open booking of this lead <FaExternalLinkAlt className="text-[8px]" />
                            </button>
                          ) : (onOpenBooking && unit.booking_id) ? (
                            <button onClick={() => onOpenBooking!(unit.booking_id!)} className="flex items-center gap-1.5 text-xs font-bold text-blue-500 hover:underline">
                              Open booking #{unit.booking_id} <FaExternalLinkAlt className="text-[8px]" />
                            </button>
                          ) : null}
                        </>
                      ) : (
                        // Restricted view: not this sales manager's lead — name + booking number only.
                        <div className="text-sm">
                          <span className={`font-bold ${t.text}`}>{unit.booking_primary_name || unit.lead_name || `Lead #${unit.lead_id}`}</span>
                          {unit.booking_number && <span className={`ml-1 text-[11px] ${t.textMuted}`}>Booking {unit.booking_number}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* History */}
                  <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5 ${t.textMuted}`}><FaHistory className="text-[9px]" /> History ({history.length})</p>
                  <div className="space-y-2">
                    {history.length === 0 && <p className={`text-[11px] italic ${t.textFaint}`}>No history yet.</p>}
                    {history.map(h => (
                      <div key={h.id} className={`rounded-lg border p-2.5 ${t.innerBlock}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          {h.old_status && <><StatusBadge status={h.old_status} /><span className={t.textFaint}>→</span></>}
                          <StatusBadge status={h.new_status} />
                        </div>
                        {h.reason && <p className={`text-[11px] ${t.text}`}>{h.reason}</p>}
                        <p className={`text-[10px] ${t.textFaint}`}>{h.changed_by || "System"} · {new Date(h.changed_at).toLocaleString("en-IN")}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
