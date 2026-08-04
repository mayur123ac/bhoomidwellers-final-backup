"use client";
// UnitPicker.tsx — Phase 1 of the booking-data-quality work.
//
// Why this exists: the booking form used to capture the unit as seven free-text
// boxes (project / tower / wing / type / floor / flat / carpet area). The server
// then matched that text back to a real unit in `inventory_units` by exact
// string key — see syncBookingUnit() in lib/inventorySync.ts, which keys on
// (project_name, tower, COALESCE(wing,''), floor, flat_no).
//
// Two things went wrong with free text:
//   1. A typo did not fail. It fell through to the INSERT branch and silently
//      CREATED a phantom unit with source='booking_sync' — so "Tower A" and
//      "Tower  A" became two different flats, and the real one stayed available.
//   2. Nothing checked availability. A booking could be written against a flat
//      that was already booked by someone else, and inventory would simply be
//      overwritten to point at the newer booking.
//
// Picking from real inventory fixes both: the strings handed back are the exact
// ones already in the row, so the key always matches an existing unit, and the
// picker refuses to hand back a unit that is not free.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaSearch, FaTimes, FaBuilding, FaCheck, FaLock, FaSpinner } from "react-icons/fa";

export interface PickableUnit {
  id: number;
  // apartment_name is retired — present only on rows created before that.
  apartment_name?: string | null;
  project_name: string; tower: string; wing: string | null;
  unit_type: string; floor: number; flat_no: string;
  carpet_area_sqft: string | number | null;
  built_up_area_sqft: string | number | null;
  base_price: string | number | null;
  status: string;
  lead_id: number | null; booking_id: number | null;
}

// Mirrors the badge palette in InventoryManagementView so a unit reads the same
// colour here as it does in the Inventory module.
const STATUS: Record<string, { label: string; text: string; border: string; bg: string }> = {
  available: { label: "Available", text: "text-emerald-500", border: "border-emerald-500/30", bg: "bg-emerald-500/10" },
  booked: { label: "Booked", text: "text-blue-500", border: "border-blue-500/30", bg: "bg-blue-500/10" },
  blocked: { label: "Blocked", text: "text-gray-500", border: "border-gray-400/30", bg: "bg-gray-500/10" },
  on_hold: { label: "On Hold", text: "text-amber-500", border: "border-amber-500/30", bg: "bg-amber-500/10" },
  registered: { label: "Registered", text: "text-violet-500", border: "border-violet-500/30", bg: "bg-violet-500/10" },
  refuge_area: { label: "Refuge Area", text: "text-zinc-500", border: "border-zinc-400/30", bg: "bg-zinc-500/10" },
  unfinished: { label: "Unfinished", text: "text-orange-500", border: "border-orange-500/30", bg: "bg-orange-500/10" },
  cancelled: { label: "Cancelled", text: "text-red-500", border: "border-red-500/30", bg: "bg-red-500/10" },
};
const sc = (s: string) => STATUS[s] || { label: s || "—", text: "text-gray-500", border: "border-gray-400/30", bg: "bg-gray-500/10" };

// A unit is selectable when nothing else holds it. on_hold is deliberately
// allowed: a hold is what a booking converts, and the hold-expiry sweep in
// GET /api/inventory has already released stale ones by the time we see this.
const SELECTABLE = ["available", "on_hold"];

export function isUnitSelectable(u: PickableUnit, currentBookingId?: number | null): boolean {
  // In edit mode the unit already attached to THIS booking must stay pickable,
  // or reopening the form would report its own flat as taken.
  if (currentBookingId != null && u.booking_id != null && Number(u.booking_id) === Number(currentBookingId)) return true;
  if (u.booking_id != null) return false;
  return SELECTABLE.includes((u.status || "").toLowerCase().trim());
}

export function unitLabel(u: PickableUnit): string {
  const wing = u.wing ? `/${u.wing}` : "";
  return `${u.flat_no} · ${u.tower}${wing} · Floor ${u.floor}`;
}

const num = (v: any): number => { const n = Number(String(v ?? "").replace(/[,\s₹]/g, "")); return isNaN(n) ? 0 : n; };

interface Props {
  isDark?: boolean;
  /** Set when a unit is currently chosen, so it can be shown as selected. */
  selectedUnitId?: number | null;
  /** Edit mode: the booking being edited, so its own unit stays selectable. */
  currentBookingId?: number | null;
  onSelect: (unit: PickableUnit) => void;
  onClose: () => void;
}

export default function UnitPicker({ isDark, selectedUnitId, currentBookingId, onSelect, onClose }: Props) {
  const [units, setUnits] = useState<PickableUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tower, setTower] = useState("");
  const [unitType, setUnitType] = useState("");
  const [onlySelectable, setOnlySelectable] = useState(true);

  // Debounce so typing a flat number does not fire a request per keystroke.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Guards against an earlier, slower response overwriting a later one.
  const reqSeq = useRef(0);

  const fetchUnits = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "500" });
      if (debounced.trim()) qs.set("search", debounced.trim());
      if (tower) qs.set("tower", tower);
      if (unitType) qs.set("unit_type", unitType);
      const res = await fetch(`/api/inventory?${qs.toString()}`, { credentials: "include" });
      const json = await res.json();
      if (seq !== reqSeq.current) return;
      if (!json?.success) throw new Error(json?.message || "Could not load inventory");
      setUnits(Array.isArray(json.data) ? json.data : []);
    } catch (err: any) {
      if (seq !== reqSeq.current) return;
      setError(err?.message || "Could not load inventory");
      setUnits([]);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [debounced, tower, unitType]);

  useEffect(() => { fetchUnits(); }, [fetchUnits]);

  // Filter options come from the loaded page rather than a separate endpoint —
  // the list is capped at 500 units, which covers the whole project today.
  const towers = useMemo(
    () => [...new Set(units.map(u => u.tower).filter(Boolean))].sort(),
    [units],
  );
  const types = useMemo(
    () => [...new Set(units.map(u => u.unit_type).filter(Boolean))].sort(),
    [units],
  );

  const visible = useMemo(() => {
    if (!onlySelectable) return units;
    return units.filter(u => isUnitSelectable(u, currentBookingId));
  }, [units, onlySelectable, currentBookingId]);

  const freeCount = useMemo(
    () => units.filter(u => isUnitSelectable(u, currentBookingId)).length,
    [units, currentBookingId],
  );

  const panel = isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]";
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white focus:border-[#9E217B]" : "bg-white border-[#9CA3AF] text-[#1A1A1A] focus:border-[#00AEEF]"}`;
  const textMain = isDark ? "text-white" : "text-[#1A1A1A]";
  const textMuted = isDark ? "text-[#888899]" : "text-[#6B7280]";
  const rowBase = isDark ? "border-[#2A2A35] hover:bg-[#1A1A22]" : "border-[#E5E7EB] hover:bg-[#F1F5F9]";

  return (
    // z-220: above the booking modal (200) and its loan editor (210), below the
    // tranche-override modal (240).
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-4xl max-h-[85vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${panel}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
          <div>
            <h3 className={`text-base font-bold flex items-center gap-2 ${textMain}`}>
              <FaBuilding className="text-[#00AEEF]" /> Select a Unit
            </h3>
            <p className={`text-[11px] mt-0.5 ${textMuted}`}>
              {loading ? "Loading inventory…" : `${freeCount} available of ${units.length} shown`}
            </p>
          </div>
          <button type="button" onClick={onClose} className={`p-2 rounded-lg ${textMuted} hover:text-red-500`}>
            <FaTimes />
          </button>
        </div>

        {/* Filters */}
        <div className={`px-5 py-3 border-b grid grid-cols-1 sm:grid-cols-4 gap-3 ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
          <div className="sm:col-span-2 relative">
            <FaSearch className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${textMuted}`} />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search flat no. / project…"
              className={`${inputCls} pl-8`}
            />
          </div>
          <select value={tower} onChange={e => setTower(e.target.value)} className={inputCls}>
            <option value="">All Towers</option>
            {towers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={unitType} onChange={e => setUnitType(e.target.value)} className={inputCls}>
            <option value="">All Types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className={`px-5 py-2 border-b flex items-center gap-2 ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
          <label className={`flex items-center gap-2 text-[11px] font-semibold cursor-pointer ${textMuted}`}>
            <input
              type="checkbox"
              checked={onlySelectable}
              onChange={e => setOnlySelectable(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
            />
            Show only units that can be booked
          </label>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className={`flex items-center justify-center gap-2 py-16 text-sm ${textMuted}`}>
              <FaSpinner className="animate-spin" /> Loading units…
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <p className="text-sm text-red-500 font-semibold">{error}</p>
              <button type="button" onClick={fetchUnits} className="px-4 py-2 rounded-lg text-xs font-bold bg-[#00AEEF] text-white">
                Retry
              </button>
            </div>
          )}

          {!loading && !error && visible.length === 0 && (
            <div className={`flex flex-col items-center justify-center py-16 gap-2 ${textMuted}`}>
              <FaBuilding className="text-3xl opacity-40" />
              <p className="text-sm font-semibold">No matching units</p>
              <p className="text-[11px]">
                {onlySelectable && units.length > 0
                  ? "Every matching unit is already taken — untick the filter above to see them."
                  : "Try a different search or filter."}
              </p>
            </div>
          )}

          {!loading && !error && visible.map(u => {
            const selectable = isUnitSelectable(u, currentBookingId);
            const chosen = selectedUnitId != null && Number(selectedUnitId) === Number(u.id);
            const c = sc((u.status || "").toLowerCase().trim());
            return (
              <button
                key={u.id}
                type="button"
                disabled={!selectable}
                onClick={() => selectable && onSelect(u)}
                className={`w-full text-left px-5 py-3 border-b flex items-center gap-4 transition-colors ${rowBase} ${
                  selectable ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                } ${chosen ? (isDark ? "bg-[#9E217B]/15" : "bg-[#00AEEF]/10") : ""}`}
              >
                <div className="flex-shrink-0 w-5">
                  {chosen ? <FaCheck className="text-[#00AEEF]" />
                    : !selectable ? <FaLock className={`text-xs ${textMuted}`} />
                    : null}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold truncate ${textMain}`}>{unitLabel(u)}</p>
                  <p className={`text-[11px] truncate ${textMuted}`}>
                    {u.project_name}{u.unit_type ? ` · ${u.unit_type}` : ""}
                    {num(u.carpet_area_sqft) ? ` · ${num(u.carpet_area_sqft).toLocaleString("en-IN")} sq.ft.` : ""}
                  </p>
                </div>

                {num(u.base_price) > 0 && (
                  <div className="hidden sm:block text-right flex-shrink-0">
                    <p className={`text-xs font-bold ${textMain}`}>₹{num(u.base_price).toLocaleString("en-IN")}</p>
                    <p className={`text-[10px] ${textMuted}`}>base price</p>
                  </div>
                )}

                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border flex-shrink-0 ${c.text} ${c.border} ${c.bg}`}>
                  {c.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className={`px-5 py-3 border-t flex items-center justify-between ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
          <p className={`text-[11px] ${textMuted}`}>
            Locked units are already held by another booking.
          </p>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-xs font-bold border ${isDark ? "border-[#2A2A35] text-[#888899]" : "border-[#9CA3AF] text-[#475569]"}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
