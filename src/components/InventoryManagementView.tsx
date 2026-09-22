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
  FaTrash, FaExclamationTriangle, FaBuilding, FaLock, FaTags, FaHandshake, FaChartBar,
  FaArrowLeft, FaArrowRight, FaExpand, FaCompress,
} from "react-icons/fa";
import { formatCurrencyDisplay } from "@/lib/currency";
import AddUnitModal from "./AddUnitModal";
import BulkGenerateUnitsModal from "./BulkGenerateUnitsModal";
import PricingRulesModal from "./PricingRulesModal";
import OffersModal from "./OffersModal";
import InventoryAnalyticsModal from "./InventoryAnalyticsModal";
import BuildingContextTag, { BuildingContext } from "./BuildingContextTag";

export interface InventoryUnit {
  id: number;
  apartment_name?: string | null;
  project_name: string; tower: string; wing: string | null;
  unit_type: string; floor: number; flat_no: string;
  carpet_area_sqft: string | number | null; built_up_area_sqft: string | number | null;
  rate_per_sqft: string | number | null; base_price: string | number | null;
  facing: string | null; status: string; hold_expires_at: string | null; source: string;
  lead_id: number | null; booking_id: number | null;
  project_id?: number | null; tower_id?: number | null;
  held_by?: string | null; held_for_lead_id?: number | null; hold_reason?: string | null;
  is_corner?: boolean | null; is_park_facing?: boolean | null; parking_slots?: number | null;
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
  available: { label: "Available", text: "text-[#34C759] dark:text-[#32D74B]", border: "border-[#34C759]/30 dark:border-[#32D74B]/30", bg: "bg-[#EBF9EE] dark:bg-[#32D74B]/15", hex: "#34C759" },
  booked: { label: "Booked", text: "text-[#007AFF] dark:text-[#0A84FF]", border: "border-[#007AFF]/30 dark:border-[#0A84FF]/30", bg: "bg-[#E5F1FF] dark:bg-[#0A84FF]/15", hex: "#007AFF" },
  blocked: { label: "Blocked", text: "text-[#8E8E93] dark:text-[#8E8E93]", border: "border-[#8E8E93]/30 dark:border-[#8E8E93]/30", bg: "bg-[#F2F2F7] dark:bg-[#2C2C2E]", hex: "#8E8E93" },
  on_hold: { label: "On Hold", text: "text-[#FF9500] dark:text-[#FF9F0A]", border: "border-[#FF9500]/30 dark:border-[#FF9F0A]/30", bg: "bg-[#FFF4E5] dark:bg-[#FF9F0A]/15", hex: "#FF9500" },
  registered: { label: "Registered", text: "text-[#AF52DE] dark:text-[#BF5AF2]", border: "border-[#AF52DE]/30 dark:border-[#BF5AF2]/30", bg: "bg-[#F7EBFC] dark:bg-[#BF5AF2]/15", hex: "#AF52DE" },
  refuge_area: { label: "Refuge Area", text: "text-[#8E8E93] dark:text-[#8E8E93]", border: "border-[#8E8E93]/30 dark:border-[#8E8E93]/30", bg: "bg-[#F2F2F7] dark:bg-[#2C2C2E]", hex: "#8E8E93" },
  unfinished: { label: "Unfinished", text: "text-[#FF9500] dark:text-[#FF9F0A]", border: "border-[#FF9500]/30 dark:border-[#FF9F0A]/30", bg: "bg-[#FFF4E5] dark:bg-[#FF9F0A]/15", hex: "#FF9500" },
  cancelled: { label: "Cancelled", text: "text-[#FF3B30] dark:text-[#FF453A]", border: "border-[#FF3B30]/30 dark:border-[#FF453A]/30", bg: "bg-[#FFECEB] dark:bg-[#FF453A]/15", hex: "#FF3B30" },
};
const sc = (s: string): SC => STATUS[s] || { label: s, text: "text-[#8E8E93] dark:text-[#8E8E93]", border: "border-[#8E8E93]/30", bg: "bg-[#F2F2F7] dark:bg-[#2C2C2E]", hex: "#8E8E93" };
export const getStatusColor = sc;
const STATUS_KEYS = Object.keys(STATUS);

const DUPLICATE_HEX = "#FF3B30";

type UnitTypeColor = { ink: string; darkInk: string };
const UNIT_TYPE_COLORS: Record<string, UnitTypeColor> = {
  "1RK": { ink: "#8E8E93", darkInk: "#98989D" },
  "1BHK": { ink: "#34C759", darkInk: "#32D74B" },
  "1.5BHK": { ink: "#30B0C7", darkInk: "#32ADE6" },
  "2BHK": { ink: "#007AFF", darkInk: "#0A84FF" },
  "2.5BHK": { ink: "#5856D6", darkInk: "#5E5CE6" },
  "3BHK": { ink: "#AF52DE", darkInk: "#BF5AF2" },
  "3.5BHK": { ink: "#FF2D55", darkInk: "#FF375F" },
  "4BHK": { ink: "#FF9500", darkInk: "#FF9F0A" },
  "4.5BHK": { ink: "#FF3B30", darkInk: "#FF453A" },
  "5BHK": { ink: "#A2845E", darkInk: "#AC8E68" },
  "PENTHOUSE": { ink: "#D4AF37", darkInk: "#F3C53B" },
  "SHOP": { ink: "#FF2D55", darkInk: "#FF375F" },
  "OFFICE": { ink: "#32ADE6", darkInk: "#64D2FF" },
};

export const normalizeUnitType = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, "").trim();

const UNIT_TYPE_LABELS: Record<string, string> = {
  "1RK": "1 RK", "1BHK": "1BHK", "1.5BHK": "1.5BHK", "2BHK": "2BHK", "2.5BHK": "2.5BHK",
  "3BHK": "3BHK", "3.5BHK": "3.5BHK", "4BHK": "4BHK", "4.5BHK": "4.5BHK", "5BHK": "5BHK",
  "PENTHOUSE": "Penthouse", "SHOP": "Shop", "OFFICE": "Office",
};

export const unitTypeLabel = (v: unknown): string => {
  const key = normalizeUnitType(v);
  return UNIT_TYPE_LABELS[key] || String(v ?? "").trim() || "—";
};

const hashHue = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};
const hslToHex = (h: number, s: number, l: number) => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

export function getUnitTypeColor(unitType: string, isDark = false): { key: string; ink: string; fill: string; border: string; label: string } {
  const key = normalizeUnitType(unitType);
  const found = UNIT_TYPE_COLORS[key];
  const ink = found
    ? (isDark ? found.darkInk : found.ink)
    : hslToHex(hashHue(key || "?"), 42, isDark ? 65 : 42);
  return {
    key,
    ink,
    fill: `${ink}1A`,      // 10% — a tint, never a block of colour
    border: `${ink}59`,    // 35%
    label: unitTypeLabel(unitType),
  };
}

const normFlat = (v: unknown) => String(v ?? "").trim().toLowerCase();

export interface DuplicateScoped { flat_no?: string | null; tower?: string | null; wing?: string | null }

const dupScope = (u: DuplicateScoped) =>
  `${String(u.tower ?? "").trim().toLowerCase()}|${String(u.wing ?? "").trim().toLowerCase()}`;

const dupKey = (u: DuplicateScoped) => `${dupScope(u)}|${normFlat(u.flat_no)}`;

export function findDuplicateFlats(units: DuplicateScoped[]): Set<string> {
  const seen = new Map<string, number>();
  for (const u of units) {
    if (!normFlat(u.flat_no)) continue;
    const k = dupKey(u);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

export const isDuplicateFlat = (unit: DuplicateScoped, duplicates: Set<string>) => duplicates.has(dupKey(unit));

const unitTooltip = (u: InventoryUnit, duplicate: boolean) =>
  [
    duplicate ? "Duplicate flat number —" : null,
    `${u.flat_no} · ${unitTypeLabel(u.unit_type)} · ${sc(u.status).label}`,
    u.wing ? `· Wing ${u.wing}` : null,
  ].filter(Boolean).join(" ");

function UnitTypeChip({ unitType, isDark }: { unitType: string; isDark: boolean }) {
  const c = getUnitTypeColor(unitType, isDark);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-[10px] font-semibold tracking-wide border max-w-full truncate"
      style={{ color: c.ink, backgroundColor: c.fill, borderColor: c.border }}
    >
      {c.label}
    </span>
  );
}

const CLOSED_BOOKING_STATUSES = ["cancelled", "canceled"];
const isBookingClosed = (s: unknown) => CLOSED_BOOKING_STATUSES.includes(String(s ?? "").trim().toLowerCase());
const isBookingProtected = (u: InventoryUnit) => {
  const status = (u.status || "").toLowerCase().trim();
  if (status === "booked" || status === "registered") return true;
  if (u.booking_id == null) return false;
  return !isBookingClosed(u.booking_status);
};

const ACTIVE_STATUSES = ["booked", "registered", "on_hold"];
const isLinkedActive = (u: InventoryUnit) => ACTIVE_STATUSES.includes(u.status) || u.lead_id != null || u.booking_id != null;
const linkLabel = (u: InventoryUnit) => {
  const p: string[] = [];
  if (u.booking_id) p.push(isBookingClosed(u.booking_status) ? `cancelled booking #${u.booking_id}` : `booking #${u.booking_id}`);
  if (u.lead_id) p.push(`lead #${u.lead_id}`);
  if (p.length) return p.join(" / ");
  if (u.status === "on_hold") return u.held_by ? `held by ${u.held_by}` : "on hold";
  return u.status;
};

const EDITABLE_STATUSES = ["available", "blocked", "refuge_area", "unfinished"];
const UNIT_TYPES = ["1 RK", "1BHK", "1.5BHK", "2BHK", "2.5BHK", "3BHK", "3.5BHK", "4BHK", "Penthouse", "Shop", "Office", "Other"];

function StatusBadge({ status }: { status: string }) {
  const c = sc(status);
  return <span className={`px-2 py-0.5 rounded-[6px] text-[10px] font-semibold uppercase tracking-wider inline-flex items-center flex-shrink-0 ${c.text} ${c.bg}`}>{c.label}</span>;
}

const num = (v: any): number => { const n = Number(String(v ?? "").replace(/[,\s₹]/g, "")); return isNaN(n) ? 0 : n; };
const area = (v: any) => { const n = num(v); return n ? `${n.toLocaleString("en-IN")}` : "—"; };

interface Column { key: string; label: string; w: number; sortable: boolean; numeric?: boolean; }
const COLUMNS: Column[] = [
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
  t: any; // Kept for prop compatibility, but Apple UI classes override it below.
  onOpenLead?: (leadId: number) => void;
  onOpenBooking?: (bookingId: number) => void;
}

const blankFilters = { search: "", project_name: "", tower: "", wing: "", floor: "", unit_type: "", status: "", min_area: "", max_area: "" };

interface TowerSummary {
  key: string; tower: string; tower_id: number | null;
  floors: number; total: number; available: number; booked: number; on_hold: number; blocked: number;
}
interface TypeSummary { key: string; tower: string; unit_type: string; units: number; }
interface WingSummary {
  key: string; tower: string; wing: string; floors: number;
  total: number; available: number; booked: number; on_hold: number; blocked: number;
}
interface BuildingSummary {
  key: string;
  project_name: string;
  project_id: number | null;
  floors: number; tower_count: number;
  total: number; available: number; booked: number; on_hold: number; blocked: number;
  towers: TowerSummary[];
  unit_types: TypeSummary[];
  wings: WingSummary[];
  project_status?: string | null;
}

const n0 = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

const normaliseBuilding = (r: any): BuildingSummary => ({
  key: String(r.key),
  project_name: String(r.project_name ?? "").trim() || "(Unnamed project)",
  project_id: r.project_id == null ? null : Number(r.project_id),
  floors: n0(r.floors), tower_count: n0(r.tower_count),
  total: n0(r.total), available: n0(r.available), booked: n0(r.booked),
  on_hold: n0(r.on_hold), blocked: n0(r.blocked),
  towers: (r.towers || []).map((x: any) => ({
    key: String(x.key), tower: String(x.tower ?? "").trim(),
    tower_id: x.tower_id == null ? null : Number(x.tower_id),
    floors: n0(x.floors), total: n0(x.total), available: n0(x.available),
    booked: n0(x.booked), on_hold: n0(x.on_hold), blocked: n0(x.blocked),
  })),
  unit_types: (r.unit_types || []).map((x: any) => ({
    key: String(x.key), tower: String(x.tower ?? "").trim(),
    unit_type: String(x.unit_type ?? "").trim() || "—", units: n0(x.units),
  })),
  wings: (r.wings || []).map((x: any) => ({
    key: String(x.key), tower: String(x.tower ?? "").trim(),
    wing: String(x.wing ?? "").trim(), floors: n0(x.floors),
    total: n0(x.total), available: n0(x.available), booked: n0(x.booked),
    on_hold: n0(x.on_hold), blocked: n0(x.blocked),
  })),
});

const emptyBuilding = (key: string, p: any): BuildingSummary => ({
  key,
  project_name: String(p.name ?? "").trim() || "(Unnamed project)",
  project_id: p.id == null ? null : Number(p.id),
  floors: 0, tower_count: n0(p.tower_count),
  total: 0, available: 0, booked: 0, on_hold: 0, blocked: 0,
  towers: [], unit_types: [], wings: [], project_status: p.status ?? null,
});

const rollupTypes = (rows: TypeSummary[], tower: string) =>
  Object.entries(
    rows.filter(r => !tower || r.tower === tower)
      .reduce<Record<string, { units: number; raw: string }>>((acc, r) => {
        const k = normalizeUnitType(r.unit_type);
        if (!acc[k]) acc[k] = { units: 0, raw: r.unit_type };
        acc[k].units += r.units;
        return acc;
      }, {}),
  ).map(([key, v]) => ({ key, unit_type: unitTypeLabel(v.raw), units: v.units }))
    .sort((a, b) => b.units - a.units);

const floorLabel = (f: number) => (f === 0 ? "Ground" : `Floor ${f}`);

const NO_WING = "__none__";
const wingTabLabel = (w: string) => (w ? `Wing ${w}` : "No wing");

const BUILDING_STATUS_FILTERS = [
  { value: "available", label: "Has available" },
  { value: "booked", label: "Has booked" },
  { value: "on_hold", label: "Has on hold" },
  { value: "blocked", label: "Has blocked" },
];

function BuildingCard({ b, isDark, onOpen }: { b: BuildingSummary; isDark: boolean; onOpen: () => void }) {
  const towerLine = b.towers.length === 0 ? "No towers yet"
    : b.towers.length <= 3 ? b.towers.map(x => `Tower ${x.tower}`).join(" · ")
      : `${b.towers.length} towers`;
  const namedWings = [...new Set(b.wings.map(w => w.wing).filter(Boolean))]
    .sort((a, b2) => a.localeCompare(b2, undefined, { numeric: true }));
  const wingLine = namedWings.length === 0 ? ""
    : namedWings.length <= 3 ? namedWings.map(w => `Wing ${w}`).join(" · ")
      : `${namedWings.length} wings`;
  const types = rollupTypes(b.unit_types, "").slice(0, 3);

  return (
    <button type="button" onClick={onOpen}
      className={`text-left w-full rounded-[24px] border p-5 transition-transform hover:scale-[1.02] shadow-sm ${isDark ? "bg-[#1C1C1E] border-white/5" : "bg-white border-black/5 shadow-[0_4px_24px_rgba(0,0,0,0.04)]"
        }`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0 ${isDark ? "bg-[#0A84FF]/15 text-[#0A84FF]" : "bg-[#E5F1FF] text-[#007AFF]"}`}>
          <FaBuilding className="text-[18px]" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className={`text-[15px] font-semibold tracking-tight truncate ${isDark ? "text-white" : "text-black"}`}>{b.project_name}</h3>
          <p className={`text-[12px] font-medium mt-0.5 tracking-tight truncate ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
            {towerLine}{wingLine ? `  •  ${wingLine}` : ""}
          </p>
        </div>
      </div>

      <p className={`text-[12px] font-medium tracking-tight mb-2.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
        {b.floors} floor{b.floors === 1 ? "" : "s"} · <b className={isDark ? "text-white" : "text-black"}>{b.total}</b> unit{b.total === 1 ? "" : "s"}
      </p>

      {types.length > 0 && (
        <p className={`text-[12px] font-medium tracking-tight mb-4 truncate ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
          {types.map(c => `${c.units} × ${c.unit_type}`).join("  ·  ")}
        </p>
      )}

      <div className="flex items-center gap-3.5 flex-wrap mb-4">
        {([
          ["Available", b.available, STATUS.available.hex],
          ["Booked", b.booked, STATUS.booked.hex],
          ["On Hold", b.on_hold, STATUS.on_hold.hex],
          ["Blocked", b.blocked, STATUS.blocked.hex],
        ] as [string, number, string][]).map(([label, value, hex]) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-tight">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />
            <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>{label}:</span>
            <b className={isDark ? "text-white" : "text-black"}>{value}</b>
          </span>
        ))}
      </div>

      <span className={`inline-flex items-center gap-1 text-[12px] font-semibold tracking-wide ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>
        Open <FaArrowRight className="text-[10px]" />
      </span>
    </button>
  );
}

function Stat({ label, value, hex, isDark }: { label: string; value: number; hex?: string; isDark: boolean }) {
  return (
    <div className="min-w-[86px]">
      <p className={`text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 mb-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
        {hex && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />}{label}
      </p>
      <p className={`text-[18px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>{value}</p>
    </div>
  );
}

export default function InventoryManagementView({ user, isDark, t, onOpenLead, onOpenBooking }: Props) {
  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase());
  const isAdminUser = (user?.role || "").trim().toLowerCase() === "admin";

  const [buildings, setBuildings] = useState<BuildingSummary[]>([]);
  const [bLoading, setBLoading] = useState(true);
  const [bFilters, setBFilters] = useState({ search: "", project: "", tower: "", status: "" });
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [deleteBuildingKey, setDeleteBuildingKey] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeTower, setActiveTower] = useState("");
  const [activeWing, setActiveWing] = useState("");
  const [bldMenu, setBldMenu] = useState(false);

  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"table" | "grid">("grid");
  const [filters, setFilters] = useState({ ...blankFilters });
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "tower", dir: "asc" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [colW, setColW] = useState<Record<string, number>>(() => Object.fromEntries(COLUMNS.map(c => [c.key, c.w])));

  const [addMenu, setAddMenu] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showOffers, setShowOffers] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryUnit | null>(null);
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bldDelOpen, setBldDelOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ kind: "building" | "tower" | "wing" } | null>(null);
  const [fullScreen, setFullScreen] = useState(false);

  const inputCls = `rounded-[10px] px-3 py-2 text-[13px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[#007AFF]/50 border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#E5E5EA] border-transparent text-black placeholder-[#8E8E93]"
    }`;
  const selectCls = `appearance-none cursor-pointer ${inputCls}`;

  const toggleFullScreen = useCallback(() => {
    setFullScreen(v => {
      const next = !v;
      try {
        if (next && !document.fullscreenElement) void document.documentElement.requestFullscreen?.();
        else if (!next && document.fullscreenElement) void document.exitFullscreen?.();
      } catch { /* */ }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullScreen(false); };
    const onChange = () => { if (!document.fullscreenElement) setFullScreen(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, [fullScreen]);

  useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => { }); }, []);

  const fetchBuildings = useCallback(async () => {
    setBLoading(true);
    try {
      const [aggRes, projRes] = await Promise.all([
        fetch("/api/inventory?view=buildings", { credentials: "include" }),
        fetch("/api/inventory/projects", { credentials: "include" }),
      ]);
      const agg = await aggRes.json();
      const proj = await projRes.json().catch(() => ({ success: false }));

      const byKey = new Map<string, BuildingSummary>();
      if (agg?.success) for (const r of agg.data || []) {
        const b = normaliseBuilding(r);
        byKey.set(b.key, b);
      }
      if (proj?.success) for (const p of proj.data || []) {
        const key = String(p.name ?? "").trim().toLowerCase();
        if (!key) continue;
        const found = byKey.get(key);
        if (found) {
          if (found.project_id == null && p.id != null) found.project_id = Number(p.id);
          found.project_status = p.status ?? null;
        } else {
          byKey.set(key, emptyBuilding(key, p));
        }
      }
      setBuildings([...byKey.values()].sort((a, b) => a.project_name.localeCompare(b.project_name)));
    } catch { /* */ } finally { setBLoading(false); }
  }, []);

  useEffect(() => { fetchBuildings(); }, [fetchBuildings]);

  const buildingsRef = useRef<BuildingSummary[]>([]);
  useEffect(() => { buildingsRef.current = buildings; }, [buildings]);

  const building = useMemo(() => buildings.find(b => b.key === openKey) || null, [buildings, openKey]);

  useEffect(() => {
    if (openKey && !bLoading && !building) { setOpenKey(null); setActiveTower(""); }
  }, [openKey, bLoading, building]);

  const unitsRef = useRef<InventoryUnit[]>([]);
  useEffect(() => { unitsRef.current = units; }, [units]);

  const unitParams = useCallback(() => {
    const p = new URLSearchParams();
    if (!building) return p;
    p.set("project_name", building.project_name);
    if (activeTower) p.set("tower", activeTower);
    if (activeWing === NO_WING) p.set("wing", "");
    else if (activeWing) p.set("wing", activeWing);
    else if (filters.wing) p.set("wing", filters.wing);
    if (filters.search) p.set("search", filters.search);
    if (filters.floor) p.set("floor", filters.floor);
    if (filters.unit_type) p.set("unit_type", filters.unit_type);
    if (filters.status) p.set("status", filters.status);
    if (filters.min_area) p.set("min_area", filters.min_area);
    if (filters.max_area) p.set("max_area", filters.max_area);
    p.set("limit", "500");
    return p;
  }, [building, activeTower, activeWing, filters]);

  const fetchUnits = useCallback(async () => {
    if (!building) { setUnits([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const p = unitParams();
      const res = await fetch(`/api/inventory?${p.toString()}`);
      const json = await res.json();
      if (json.success) { setUnits(json.data); setTotal(json.total ?? json.data.length); }
    } catch { /* */ } finally { setLoading(false); }
  }, [building, unitParams]);

  useEffect(() => {
    const id = setTimeout(fetchUnits, 250);
    return () => clearTimeout(id);
  }, [fetchUnits]);

  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = async () => {
    if (!building) return;
    setLoadingMore(true);
    try {
      const p = unitParams();
      p.set("offset", String(unitsRef.current.length));
      const res = await fetch(`/api/inventory?${p.toString()}`);
      const json = await res.json();
      if (json.success) setUnits(u => [...u, ...json.data]);
    } catch { /* */ } finally { setLoadingMore(false); }
  };

  const setFilter = (patch: Partial<typeof blankFilters>) => setFilters(f => ({ ...f, ...patch }));

  const openBuilding = (b: BuildingSummary) => {
    setOpenKey(b.key);
    setActiveTower(b.towers.length === 1 ? b.towers[0].tower : "");
    setActiveWing("");
    setFilters({ ...blankFilters });
    setSelected(new Set());
    setViewMode("grid");
  };

  const backToList = () => {
    setOpenKey(null); setActiveTower(""); setActiveWing(""); setBldMenu(false);
    setFilters({ ...blankFilters }); setSelected(new Set()); setUnits([]); setTotal(0);
    fetchBuildings();
  };

  const scope = useMemo(() => {
    if (!building) return null;
    if (activeWing) {
      const want = activeWing === NO_WING ? "" : activeWing;
      const rows = building.wings.filter(w => w.wing === want && (!activeTower || w.tower === activeTower));
      if (rows.length) {
        return rows.reduce((acc, w) => ({
          ...acc,
          floors: Math.max(acc.floors, w.floors),
          total: acc.total + w.total, available: acc.available + w.available,
          booked: acc.booked + w.booked, on_hold: acc.on_hold + w.on_hold, blocked: acc.blocked + w.blocked,
        }), { floors: 0, total: 0, available: 0, booked: 0, on_hold: 0, blocked: 0 });
      }
    }
    if (!activeTower) return building;
    return building.towers.find(x => x.tower === activeTower) || building;
  }, [building, activeTower, activeWing]);

  const typeChips = useMemo(
    () => (building ? rollupTypes(building.unit_types, activeTower) : []),
    [building, activeTower],
  );

  const wingsForTower = useMemo(() => {
    if (!building) return [] as { wing: string; total: number }[];
    const rows = building.wings.filter(w => !activeTower || w.tower === activeTower);
    const byWing = rows.reduce<Record<string, number>>((acc, w) => {
      acc[w.wing] = (acc[w.wing] || 0) + w.total; return acc;
    }, {});
    return Object.entries(byWing)
      .map(([wing, total]) => ({ wing, total }))
      .sort((a, b) => a.wing.localeCompare(b.wing, undefined, { numeric: true }));
  }, [building, activeTower]);

  useEffect(() => {
    if (!activeWing) return;
    const want = activeWing === NO_WING ? "" : activeWing;
    if (wingsForTower.length && !wingsForTower.some(w => w.wing === want)) setActiveWing("");
  }, [wingsForTower, activeWing]);

  const wingCtx = useMemo(
    () => (activeWing === NO_WING ? "" : activeWing) || (wingsForTower.length === 1 ? wingsForTower[0].wing : ""),
    [activeWing, wingsForTower],
  );

  const floorOptions = useMemo(
    () => [...new Set(units.map(u => u.floor))].sort((a, b) => b - a),
    [units],
  );

  const towerCtx = useMemo(
    () => activeTower || (building && building.towers.length === 1 ? building.towers[0].tower : ""),
    [activeTower, building],
  );

  const tableColumns = useMemo(
    () => COLUMNS.filter(c =>
      c.key !== "project_name"
      && !(c.key === "tower" && !!towerCtx)
      && !(c.key === "wing" && !!activeWing)),
    [towerCtx, activeWing],
  );

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

  const allSelected = sorted.length > 0 && sorted.every(u => selected.has(u.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(sorted.map(u => u.id)));
  const toggleOne = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const afterCreate = () => { setSelected(new Set()); fetchUnits(); fetchBuildings(); };
  const afterDelete = () => { setSelected(new Set()); setDeleteTarget(null); setBulkDelOpen(false); setBldDelOpen(false); fetchUnits(); fetchBuildings(); };

  const applyBuildingRename = useCallback((projectId: number, nextName: string) => {
    const nextKey = nextName.trim().toLowerCase();
    setBuildings(prev => prev
      .map(b => (b.project_id === projectId
        ? { ...b, key: nextKey, project_name: nextName }
        : b))
      .sort((a, b) => a.project_name.localeCompare(b.project_name)));
    setOpenKey(prev => {
      const wasOpen = buildings.find(b => b.key === prev);
      return wasOpen && wasOpen.project_id === projectId ? nextKey : prev;
    });
    setUnits(prev => prev.map(u => ({ ...u, project_name: nextName })));
  }, [buildings]);

  const applyTowerRename = useCallback((buildingKey: string, prevTower: string, nextName: string) => {
    setBuildings(prev => prev.map(b => (b.key !== buildingKey ? b : {
      ...b,
      towers: b.towers.map(tw => (tw.tower === prevTower ? { ...tw, tower: nextName } : tw)),
      wings: b.wings.map(w => (w.tower === prevTower ? { ...w, tower: nextName } : w)),
      unit_types: b.unit_types.map(x => (x.tower === prevTower ? { ...x, tower: nextName } : x)),
    })));
    setActiveTower(prev => (prev === prevTower ? nextName : prev));
    setUnits(prev => prev.map(u => (u.tower === prevTower ? { ...u, tower: nextName } : u)));
  }, []);

  const applyWingRename = useCallback((buildingKey: string, tower: string, prevWing: string, nextWing: string) => {
    setBuildings(prev => prev.map(b => (b.key !== buildingKey ? b : {
      ...b,
      wings: b.wings.map(w => (w.tower === tower && w.wing === prevWing ? { ...w, wing: nextWing } : w)),
    })));
    setActiveWing(prev => (prev === prevWing ? (nextWing || NO_WING) : prev));
    setUnits(prev => prev.map(u => (
      u.tower === tower && (u.wing ?? "") === prevWing ? { ...u, wing: nextWing || null } : u
    )));
  }, []);

  const applyBuildingDelete = useCallback((projectId: number) => {
    setBuildings(prev => prev.filter(b => b.project_id !== projectId));
    setOpenKey(null);
    setActiveTower("");
    setUnits([]);
    setTotal(0);
    setDeleteBuildingKey(prev => {
      const gone = buildingsRef.current.find(b => b.key === prev);
      return gone && gone.project_id === projectId ? "" : prev;
    });
  }, []);

  const selectedUnits = useMemo(() => sorted.filter(u => selected.has(u.id)), [sorted, selected]);

  const duplicateFlats = useMemo(() => findDuplicateFlats(units), [units]);
  const isDuplicate = useCallback(
    (u: InventoryUnit) => isDuplicateFlat(u, duplicateFlats),
    [duplicateFlats],
  );
  const duplicateCount = useMemo(() => units.filter(isDuplicate).length, [units, isDuplicate]);

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
        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-[6px] transition-colors ${linkClickable ? (isDark ? "text-[#0A84FF] bg-[#0A84FF]/10 hover:bg-[#0A84FF]/20" : "text-[#007AFF] bg-[#E5F1FF] hover:bg-[#007AFF]/20") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]")}`}>
        Booking #{u.booking_id}{linkClickable && <FaExternalLinkAlt className="text-[9px]" />}
      </button>
    );
    if (u.lead_id) return (
      <button type="button" onClick={e => { e.stopPropagation(); openLinked(u); }} disabled={!linkClickable}
        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-[6px] transition-colors ${linkClickable ? (isDark ? "text-[#BF5AF2] bg-[#BF5AF2]/10 hover:bg-[#BF5AF2]/20" : "text-[#AF52DE] bg-[#F7EBFC] hover:bg-[#AF52DE]/20") : (isDark ? "text-[#8E8E93]" : "text-[#8E8E93]")}`}>
        Lead #{u.lead_id}{linkClickable && <FaExternalLinkAlt className="text-[9px]" />}
      </button>
    );
    return <span className={`text-[11px] ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>—</span>;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // Level 1 — the building list
  // ═════════════════════════════════════════════════════════════════════════
  if (!building) {
    const q = bFilters.search.trim().toLowerCase();
    const towerNames = [...new Set(buildings.flatMap(b => b.towers.map(x => x.tower)).filter(Boolean))].sort();
    const visible = buildings.filter(b => {
      if (q && !(b.project_name.toLowerCase().includes(q) || b.towers.some(x => x.tower.toLowerCase().includes(q)))) return false;
      if (bFilters.project && b.key !== bFilters.project) return false;
      if (bFilters.tower && !b.towers.some(x => x.tower === bFilters.tower)) return false;
      if (bFilters.status && n0((b as any)[bFilters.status]) === 0) return false;
      return true;
    });
    const anyBFilter = Object.values(bFilters).some(Boolean);
    const deleteTargetBuilding = buildings.find(b => b.key === deleteBuildingKey && b.project_id != null) || null;

    return (
      <div className={`flex flex-col h-full overflow-hidden p-4 sm:p-6 font-sans antialiased ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`}>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div className="flex flex-col gap-1">
            <h1 className={`text-xl sm:text-2xl font-black tracking-tight ${t.accentText}`}>Inventory</h1>
            <p className={`text-[13px] font-medium tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              {bLoading ? "Loading…" : `${buildings.length} building${buildings.length === 1 ? "" : "s"}`}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowAnalytics(true)}
              className={`flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-semibold tracking-wide rounded-full border transition-all hover:bg-black/5 dark:hover:bg-white/5 ${isDark ? "border-white/10 text-white" : "border-black/10 text-black"
                }`}>
              <FaChartBar className={isDark ? "text-[#0A84FF]" : "text-[#007AFF]"} /> Analytics
            </button>
            {canManage && (
              <>
                <div className="relative">
                  <select
                    aria-label="Select building to delete"
                    value={deleteBuildingKey}
                    onChange={e => setDeleteBuildingKey(e.target.value)}
                    className={`${selectCls} w-full sm:w-[180px] pl-3 pr-8 py-2 rounded-full border ${isDark ? "bg-[#1C1C1E] border-white/10 text-white" : "bg-white border-black/10 text-black"}`}
                  >
                    <option value="">Select Building…</option>
                    {buildings.filter(b => b.project_id != null).map(b => (
                      <option key={b.key} value={b.key}>{b.project_name}</option>
                    ))}
                  </select>
                  <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
                </div>

                <button
                  onClick={() => setPurgeOpen(true)}
                  disabled={!deleteTargetBuilding}
                  title={deleteTargetBuilding ? `Delete ${deleteTargetBuilding.project_name}` : "Pick a building first"}
                  className={`flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-semibold tracking-wide rounded-full border transition-all ${deleteTargetBuilding
                    ? isDark ? "text-[#FF453A] border-[#FF453A]/40 hover:bg-[#FF453A]/10" : "text-[#FF3B30] border-[#FF3B30]/40 hover:bg-[#FFECEB]"
                    : isDark ? "text-[#8E8E93] border-white/10 opacity-50 cursor-not-allowed" : "text-[#8E8E93] border-black/10 opacity-50 cursor-not-allowed"
                    }`}
                >
                  <FaTrash /> Delete Building
                </button>
                <button onClick={() => setShowAddBuilding(true)}
                  className={`flex items-center justify-center gap-1.5 text-[13px] font-semibold tracking-wide px-5 py-2 rounded-full transition-all active:scale-95 shadow-[0_2px_8px_rgba(0,122,255,0.24)] hover:shadow-[0_4px_12px_rgba(0,122,255,0.36)] ${isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white"
                    }`}>
                  <FaPlus /> Add Building
                </button>
              </>
            )}
          </div>
        </div>

        {canManage && deleteTargetBuilding && (
          <div className={`flex items-center gap-2 mb-4 px-4 py-2.5 rounded-[12px] ${isDark ? "bg-[#FF453A]/10 text-white" : "bg-[#FFECEB] text-black"}`}>
            <FaBuilding className={isDark ? "text-[#FF453A]" : "text-[#FF3B30]"} />
            <span className="text-[13px] tracking-tight">Selected for deletion: <b className="font-semibold">{deleteTargetBuilding.project_name}</b>
              {" · "}{deleteTargetBuilding.total} unit{deleteTargetBuilding.total === 1 ? "" : "s"}</span>
            <button onClick={() => setDeleteBuildingKey("")}
              className={`text-[12px] font-semibold ml-2 hover:underline ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>Clear</button>
          </div>
        )}

        {/* ── Building filters (Apple Segmented Style) ── */}
        <div className={`flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap mb-5 p-3 rounded-[20px] shadow-sm ${isDark ? "bg-[#1C1C1E] border border-white/5" : "bg-white border border-black/5"}`}>
          <input value={bFilters.search} onChange={e => setBFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Search buildings…" className={`w-full sm:w-[220px] px-3.5 py-1.5 rounded-full text-[13px] font-medium tracking-tight outline-none border transition-colors focus:ring-2 focus:ring-[#007AFF]/50 ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-transparent text-black placeholder-[#8E8E93]"
              }`} />
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <select value={bFilters.project} onChange={e => setBFilters(f => ({ ...f, project: e.target.value }))} className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                }`}>
                <option value="">All projects</option>
                {buildings.map(b => <option key={b.key} value={b.key}>{b.project_name}</option>)}
              </select>
              <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>

            <div className="relative">
              <select value={bFilters.tower} onChange={e => setBFilters(f => ({ ...f, tower: e.target.value }))} className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                }`}>
                <option value="">All towers</option>
                {towerNames.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
              <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>

            <div className="relative">
              <select value={bFilters.status} onChange={e => setBFilters(f => ({ ...f, status: e.target.value }))} className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                }`}>
                <option value="">Any stock</option>
                {BUILDING_STATUS_FILTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>
          </div>
          {anyBFilter && (
            <button onClick={() => setBFilters({ search: "", project: "", tower: "", status: "" })}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${isDark ? "text-[#8E8E93] hover:text-[#FF453A] hover:bg-white/10" : "text-[#8E8E93] hover:text-[#FF3B30] hover:bg-black/5"}`}>Clear</button>
          )}
        </div>

        {/* ── Building cards ── */}
        <div className="flex-1 overflow-auto p-1 custom-scrollbar">
          {bLoading && buildings.length === 0 ? (
            <div className="flex items-center gap-3 py-12 px-4 justify-center">
              <div className="w-5 h-5 rounded-full border-[2.5px] border-[#8E8E93] border-t-transparent animate-spin" />
              <p className={`text-[14px] font-medium tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Loading buildings…</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <p className={`text-[15px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
                {buildings.length === 0 ? "No buildings yet." : "No buildings match these filters."}
              </p>
              {buildings.length === 0 && canManage && <p className={`text-[13px] mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Use Add Building to create one.</p>}
            </div>
          ) : (
            <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 pb-12">
              {visible.map(b => (
                <BuildingCard key={b.key} b={b} isDark={isDark} onOpen={() => openBuilding(b)} />
              ))}
            </div>
          )}
        </div>

        <InventoryAnalyticsModal isOpen={showAnalytics} onClose={() => setShowAnalytics(false)} isDark={isDark} t={t} />
        {canManage && showAddBuilding && (
          <AddBuildingModal isDark={isDark} t={t} onClose={() => setShowAddBuilding(false)}
            onCreated={() => { setShowAddBuilding(false); fetchBuildings(); }} />
        )}
        {canManage && purgeOpen && deleteTargetBuilding && (
          <BuildingPurgeModal
            building={deleteTargetBuilding} isDark={isDark} t={t}
            onClose={() => setPurgeOpen(false)}
            onDeleted={(projectId: number) => {
              setPurgeOpen(false);
              applyBuildingDelete(projectId);
              setDeleteBuildingKey("");
              fetchBuildings();
            }}
          />
        )}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Level 2 — one building: its towers, floors and flats.
  // ═════════════════════════════════════════════════════════════════════════
  const scopeLabel = activeTower ? `Tower ${activeTower}`
    : building.towers.length === 1 ? `Tower ${building.towers[0].tower}`
      : `${building.towers.length} tower${building.towers.length === 1 ? "" : "s"}`;

  return (
    <div className={fullScreen
      ? `fixed inset-0 z-[100] flex flex-col overflow-hidden px-4 pb-2 font-sans antialiased ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`
      : `flex flex-col h-full overflow-hidden font-sans antialiased ${isDark ? "bg-[#000000]" : "bg-[#F2F2F7]"}`}>

      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">

        {/* ── Pinned identity + primary actions ── */}
        <div className={`sticky top-0 z-30 px-6 py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b backdrop-blur-xl ${isDark ? "bg-[#1C1C1E]/80 border-white/10" : "bg-white/80 border-[#E5E5EA]"
          }`}>
          <div className="flex items-start gap-4 min-w-0">
            <button onClick={backToList} title="Back to Inventory"
              className={`p-2 rounded-full transition-colors flex-shrink-0 mt-0.5 ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>
              <FaArrowLeft className="text-[12px]" />
            </button>
            <div className="min-w-0">
              <h1 className={`text-[22px] font-bold flex items-center gap-2 tracking-tight ${isDark ? "text-white" : "text-black"}`}>
                {building.project_name}
              </h1>
              <p className={`text-[13px] font-medium tracking-tight mt-0.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                {scopeLabel} · {n0(scope?.floors)} floor{n0(scope?.floors) === 1 ? "" : "s"} · {n0(scope?.total)} unit{n0(scope?.total) === 1 ? "" : "s"}
                {total > units.length ? ` · showing ${units.length} of ${total} matching` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* iOS Segmented Control for Views */}
            <div className={`flex p-0.5 rounded-[10px] ${isDark ? "bg-[#2C2C2E]" : "bg-[#E5E5EA]"}`}>
              <button onClick={() => setViewMode("grid")} className={`flex items-center justify-center gap-1.5 px-4 py-1.5 text-[12px] font-medium tracking-tight rounded-[8px] transition-all shadow-sm ${viewMode === "grid" ? (isDark ? "bg-[#3A3A3C] text-white" : "bg-white text-black") : "text-[#8E8E93] shadow-none hover:text-black dark:hover:text-white"}`}>
                <FaThLarge className="text-[11px]" /> Floors
              </button>
              <button onClick={() => setViewMode("table")} className={`flex items-center justify-center gap-1.5 px-4 py-1.5 text-[12px] font-medium tracking-tight rounded-[8px] transition-all shadow-sm ${viewMode === "table" ? (isDark ? "bg-[#3A3A3C] text-white" : "bg-white text-black") : "text-[#8E8E93] shadow-none hover:text-black dark:hover:text-white"}`}>
                <FaTable className="text-[11px]" /> Table
              </button>
            </div>

            <button onClick={toggleFullScreen}
              title={fullScreen ? "Exit full screen (Esc)" : "Full screen availability"}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg transition-colors ${fullScreen ? (isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white") : (isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black")}`}>
              {fullScreen ? <FaCompress className="text-[11px]" /> : <FaExpand className="text-[11px]" />}
            </button>

            {canManage && (
              <div className="relative">
                <button onClick={() => setAddMenu(v => !v)} className={`flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-semibold tracking-wide rounded-full transition-all active:scale-95 shadow-sm ${isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white"}`}>
                  <FaPlus className="text-[10px]" /> Add Unit <FaChevronDown className="text-[9px]" />
                </button>
                <AnimatePresence>
                  {addMenu && (
                    <>
                      <div className="fixed inset-0 z-[60]" onClick={() => setAddMenu(false)} />
                      <motion.div initial={{ opacity: 0, scale: 0.95, y: 5 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 5 }} className={`absolute right-0 mt-2 w-56 rounded-[16px] border shadow-[0_12px_40px_rgba(0,0,0,0.12)] z-[61] overflow-hidden backdrop-blur-2xl ${isDark ? "bg-[#1C1C1E]/90 border-white/10" : "bg-white/95 border-black/5"}`}>
                        <button onClick={() => { setAddMenu(false); setShowAdd(true); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaPen className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Add single unit</button>
                        <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />
                        <button onClick={() => { setAddMenu(false); setShowBulk(true); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaLayerGroup className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Generate whole building</button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="relative">
              <button onClick={() => setBldMenu(v => !v)} title="Building actions"
                className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>
                <span className="font-bold mb-1">...</span>
              </button>
              <AnimatePresence>
                {bldMenu && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setBldMenu(false)} />
                    <motion.div initial={{ opacity: 0, scale: 0.95, y: 5 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 5 }} className={`absolute right-0 mt-2 w-56 rounded-[16px] border shadow-[0_12px_40px_rgba(0,0,0,0.12)] z-[61] overflow-hidden backdrop-blur-2xl ${isDark ? "bg-[#1C1C1E]/90 border-white/10" : "bg-white/95 border-black/5"}`}>
                      {canManage && <button onClick={() => { setBldMenu(false); setShowPricing(true); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaTags className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Pricing</button>}
                      {canManage && <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />}
                      {canManage && <button onClick={() => { setBldMenu(false); setShowOffers(true); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaHandshake className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Offers</button>}
                      <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />
                      <button onClick={() => { setBldMenu(false); setShowAnalytics(true); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaChartBar className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Analytics</button>

                      {canManage && <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />}
                      {canManage && <button onClick={() => { setBldMenu(false); setRenameTarget({ kind: "building" }); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaPen className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Rename building</button>}
                      {canManage && activeTower && <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />}
                      {canManage && activeTower && <button onClick={() => { setBldMenu(false); setRenameTarget({ kind: "tower" }); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaPen className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Rename tower “{activeTower}”</button>}
                      {canManage && activeTower && activeWing && <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />}
                      {canManage && activeTower && activeWing && <button onClick={() => { setBldMenu(false); setRenameTarget({ kind: "wing" }); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-left transition-colors ${isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"}`}><FaPen className={`text-[12px] ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`} /> Rename wing {activeWing === NO_WING ? "(no wing)" : `“${activeWing}”`}</button>}

                      {isAdminUser && <div className={`h-[1px] w-full ${isDark ? "bg-white/10" : "bg-black/5"}`} />}
                      {isAdminUser && <button onClick={() => { setBldMenu(false); setBldDelOpen(true); }} className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-left transition-colors ${isDark ? "text-[#FF453A] hover:bg-[#FF453A]/10" : "text-[#FF3B30] hover:bg-[#FFECEB]"}`}><FaTrash className="text-[12px]" /> Delete building</button>}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 max-w-[1800px] mx-auto">
          {/* ── Building statistics ── */}
          <div className={`flex items-center gap-4 flex-wrap rounded-[20px] border px-5 py-4 mb-4 shadow-sm ${isDark ? "bg-[#1C1C1E] border-white/5" : "bg-white border-black/5"}`}>
            <Stat label="Total Units" value={n0(scope?.total)} isDark={isDark} />
            <Stat label="Available" value={n0(scope?.available)} hex={STATUS.available.hex} isDark={isDark} />
            <Stat label="Booked" value={n0(scope?.booked)} hex={STATUS.booked.hex} isDark={isDark} />
            <Stat label="On Hold" value={n0(scope?.on_hold)} hex={STATUS.on_hold.hex} isDark={isDark} />
            <Stat label="Blocked" value={n0(scope?.blocked)} hex={STATUS.blocked.hex} isDark={isDark} />

            {typeChips.length > 0 && (
              <div className={`flex items-center gap-2 flex-wrap pl-4 ml-2 border-l ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
                {typeChips.map(c => {
                  const col = getUnitTypeColor(c.unit_type, isDark);
                  return (
                    <span key={c.key} className="text-[11px] font-semibold px-2.5 py-1 rounded-[8px] border"
                      style={{ color: col.ink, backgroundColor: col.fill, borderColor: col.border }}>
                      {col.label}: <b>{c.units}</b>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Tower tabs ── */}
          {building.towers.length > 1 && (
            <div className={`flex items-center gap-2 flex-wrap mb-4`}>
              <button onClick={() => setActiveTower("")}
                className={`px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${activeTower === "" ? (isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white") : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#E5E5EA] text-[#8E8E93] hover:bg-[#D1D1D6] hover:text-black")}`}>
                All towers
              </button>
              {building.towers.map(x => (
                <button key={x.tower} onClick={() => setActiveTower(x.tower)}
                  className={`px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${activeTower === x.tower ? (isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white") : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#E5E5EA] text-[#8E8E93] hover:bg-[#D1D1D6] hover:text-black")}`}>
                  Tower {x.tower} <span className="opacity-70 ml-0.5">({x.total})</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Wing tabs ── */}
          {(wingsForTower.length > 1 || (wingsForTower.length === 1 && !!wingsForTower[0].wing)) && (
            <div className={`flex items-center gap-2 flex-wrap mb-4`}>
              <button onClick={() => setActiveWing("")}
                className={`px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${activeWing === "" ? (isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white") : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#E5E5EA] text-[#8E8E93] hover:bg-[#D1D1D6] hover:text-black")}`}>
                All wings
              </button>
              {wingsForTower.map(w => {
                const val = w.wing || NO_WING;
                return (
                  <button key={val} onClick={() => setActiveWing(val)}
                    className={`px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${activeWing === val ? (isDark ? "bg-[#0A84FF] text-white" : "bg-[#007AFF] text-white") : (isDark ? "bg-[#2C2C2E] text-[#8E8E93] hover:bg-[#3A3A3C] hover:text-white" : "bg-[#E5E5EA] text-[#8E8E93] hover:bg-[#D1D1D6] hover:text-black")}`}>
                    {wingTabLabel(w.wing)} <span className="opacity-70 ml-0.5">({w.total})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Filters ── */}
          <div className={`flex items-center gap-3 flex-wrap rounded-[20px] p-3 mb-5 shadow-sm border ${isDark ? "bg-[#1C1C1E] border-white/5" : "bg-white border-black/5"}`}>
            <input value={filters.search} onChange={e => setFilter({ search: e.target.value })} placeholder="Search flat…"
              className={`w-full sm:w-[220px] px-3.5 py-1.5 rounded-full text-[13px] font-medium tracking-tight outline-none border transition-colors focus:ring-2 focus:ring-[#007AFF]/50 ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-transparent text-black placeholder-[#8E8E93]"
                }`}
            />

            <div className="relative">
              <select value={filters.floor} onChange={e => setFilter({ floor: e.target.value })} className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                }`}>
                <option value="">All floors</option>
                {floorOptions.map(f => <option key={f} value={String(f)}>{floorLabel(f)}</option>)}
              </select>
              <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>

            <div className="relative">
              <select value={filters.unit_type} onChange={e => setFilter({ unit_type: e.target.value })} className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                }`}>
                <option value="">All types</option>
                {UNIT_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>

            <div className="relative">
              <select value={filters.status} onChange={e => setFilter({ status: e.target.value })} className={`appearance-none outline-none cursor-pointer pl-3.5 pr-8 py-1.5 rounded-full text-[13px] font-medium tracking-tight transition-colors ${isDark ? "bg-[#2C2C2E] text-white hover:bg-[#3A3A3C]" : "bg-[#E5E5EA] text-black hover:bg-[#D1D1D6]"
                }`}>
                <option value="">All statuses</option>
                {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </select>
              <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
            </div>

            <div className="flex items-center gap-2">
              <input value={filters.min_area} onChange={e => setFilter({ min_area: e.target.value })} placeholder="Min sqft" type="number"
                className={`w-[100px] px-3.5 py-1.5 rounded-full text-[13px] font-medium tracking-tight outline-none border transition-colors focus:ring-2 focus:ring-[#007AFF]/50 ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-transparent text-black placeholder-[#8E8E93]"
                  }`}
              />
              <input value={filters.max_area} onChange={e => setFilter({ max_area: e.target.value })} placeholder="Max sqft" type="number"
                className={`w-[100px] px-3.5 py-1.5 rounded-full text-[13px] font-medium tracking-tight outline-none border transition-colors focus:ring-2 focus:ring-[#007AFF]/50 ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-transparent text-black placeholder-[#8E8E93]"
                  }`}
              />
            </div>
            {Object.values(filters).some(Boolean) && (
              <button onClick={() => setFilters({ ...blankFilters })} className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${isDark ? "text-[#8E8E93] hover:text-[#FF453A] hover:bg-white/10" : "text-[#8E8E93] hover:text-[#FF3B30] hover:bg-black/5"}`}>Clear</button>
            )}
          </div>

          {/* Selection bar */}
          {selected.size > 0 && (
            <div className={`flex items-center gap-3 mb-4 px-4 py-2.5 rounded-[14px] shadow-sm ${isDark ? "bg-[#0A84FF]/15 border border-[#0A84FF]/30" : "bg-[#E5F1FF] border border-[#007AFF]/20"}`}>
              <span className={`text-[13px] font-bold tracking-tight ${isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}`}>{selected.size} selected</span>
              {isAdminUser && (
                <button onClick={() => setBulkDelOpen(true)} className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors ${isDark ? "bg-[#FF453A] text-white hover:bg-[#FF3B30]" : "bg-[#FF3B30] text-white hover:bg-[#D70015]"}`}>
                  <FaTrash className="text-[10px]" /> Delete selected
                </button>
              )}
              <span className={`text-[12px] font-medium ml-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Other bulk actions in Phase 6</span>
              <button onClick={() => setSelected(new Set())} className={`ml-auto text-[12px] font-semibold transition-colors ${isDark ? "text-[#0A84FF] hover:underline" : "text-[#007AFF] hover:underline"}`}>Clear selection</button>
            </div>
          )}

          {duplicateCount > 0 && (
            <div className={`flex items-center gap-2.5 mb-4 px-4 py-2.5 rounded-[14px] shadow-sm ${isDark ? "bg-[#FF453A]/10 border border-[#FF453A]/20 text-white" : "bg-[#FFECEB] border border-[#FF3B30]/20 text-black"}`}>
              <FaExclamationTriangle className={`text-[14px] flex-shrink-0 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`} />
              <span className="text-[13px] font-medium tracking-tight">
                <b className="font-semibold">{duplicateCount}</b> unit{duplicateCount === 1 ? " uses a" : "s use"} duplicate flat number
                {duplicateFlats.size === 1 ? "" : "s"} — highlighted in red below.
              </span>
            </div>
          )}

          <div className="min-h-[500px] pb-12">
            {loading && units.length === 0 ? (
              <div className="flex justify-center py-12"><div className="w-6 h-6 rounded-full border-[3px] border-[#8E8E93] border-t-transparent animate-spin" /></div>
            ) : units.length === 0 ? (
              <p className={`text-[14px] font-medium text-center py-16 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                {n0(scope?.total) === 0
                  ? `This building has no units yet. ${canManage ? "Use Add Unit → Generate whole building." : ""}`
                  : "No units match these filters."}
              </p>
            ) : viewMode === "table" ? (
              <TableView
                columns={tableColumns} colW={colW} sort={sort} sorted={sorted} t={t}
                allSelected={allSelected} selected={selected} toggleAll={toggleAll} toggleOne={toggleOne}
                toggleSort={toggleSort} onResizeStart={onResizeStart} onRowClick={(id: number) => setDrawerId(id)} linkChip={linkChip}
                canDelete={isAdminUser} onDeleteUnit={(u: InventoryUnit) => setDeleteTarget(u)}
                isDuplicate={isDuplicate} isDark={isDark}
              />
            ) : (
              <GridView floorsGrouped={floorsGrouped} t={t} onCellClick={(id) => setDrawerId(id)} isDuplicate={isDuplicate} isDark={isDark}
                ctx={fullScreen ? undefined : { project_name: building.project_name, tower: towerCtx, wing: wingCtx }} />
            )}

            {units.length > 0 && total > units.length && (
              <div className="flex justify-center mt-6">
                <button onClick={loadMore} disabled={loadingMore}
                  className={`text-[13px] font-semibold px-5 py-2.5 rounded-full transition-colors disabled:opacity-50 ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#E5E5EA] hover:bg-[#D1D1D6] text-black"}`}>
                  {loadingMore ? "Loading…" : `Load more (${total - units.length} left)`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {canManage && (
        <AddUnitModal isOpen={showAdd} onClose={() => setShowAdd(false)} onCreated={afterCreate} user={user} isDark={isDark} t={t}
          existingUnits={units.map(u => ({ project_name: u.project_name, tower: u.tower, wing: u.wing, floor: u.floor, flat_no: u.flat_no }))}
          defaults={{ project_name: building.project_name, tower: towerCtx }} />
      )}
      {canManage && (
        <BulkGenerateUnitsModal isOpen={showBulk} onClose={() => setShowBulk(false)} onCreated={afterCreate} user={user} isDark={isDark} t={t}
          defaults={{ project_name: building.project_name, tower: towerCtx, wing: wingCtx }} />
      )}
      {canManage && (
        <PricingRulesModal isOpen={showPricing} onClose={() => setShowPricing(false)} user={user} isDark={isDark} t={t} />
      )}
      {canManage && (
        <OffersModal isOpen={showOffers} onClose={() => setShowOffers(false)} user={user} isDark={isDark} t={t} onChanged={fetchUnits} />
      )}
      <InventoryAnalyticsModal isOpen={showAnalytics} onClose={() => setShowAnalytics(false)} isDark={isDark} t={t} />

      {isAdminUser && deleteTarget && (
        <DeleteUnitModal unit={deleteTarget} user={user} isDark={isDark} t={t} onClose={() => setDeleteTarget(null)} onDeleted={afterDelete} />
      )}
      {isAdminUser && bulkDelOpen && (
        <BulkDeleteModal selectedUnits={selectedUnits} user={user} isDark={isDark} t={t} onClose={() => setBulkDelOpen(false)} onDeleted={afterDelete} />
      )}
      {isAdminUser && bldDelOpen && (
        <BuildingDeleteModal user={user} isDark={isDark} t={t} onClose={() => setBldDelOpen(false)} onDeleted={afterDelete}
          defaults={{ project_name: building.project_name, tower: towerCtx, wing: wingCtx }}
          building={building}
          onBuildingPurged={applyBuildingDelete} />
      )}

      {canManage && renameTarget && building && (
        <RenameModal
          kind={renameTarget.kind}
          isDark={isDark}
          t={t}
          target={{
            project_id: building.project_id,
            project_name: building.project_name,
            tower: activeTower,
            tower_id: building.towers.find(tw => tw.tower === activeTower)?.tower_id ?? null,
            wing: activeWing === NO_WING ? "" : activeWing,
          }}
          onClose={() => setRenameTarget(null)}
          onRenamed={(nextName: string) => {
            if (renameTarget.kind === "building") applyBuildingRename(building.project_id!, nextName);
            else if (renameTarget.kind === "tower") applyTowerRename(building.key, activeTower, nextName);
            else applyWingRename(building.key, activeTower, activeWing === NO_WING ? "" : activeWing, nextName);
          }}
        />
      )}

      <UnitDrawer unitId={drawerId} onClose={() => setDrawerId(null)} user={user} canManage={canManage} isAdminUser={isAdminUser} isDark={isDark} t={t}
        onOpenLead={onOpenLead} onOpenBooking={onOpenBooking} onChanged={fetchUnits}
        onRequestDelete={(u: InventoryUnit) => { setDrawerId(null); setDeleteTarget(u); }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Table view
// ═══════════════════════════════════════════════════════════════════════════
function TableView({ columns, colW, sort, sorted, t, allSelected, selected, toggleAll, toggleOne, toggleSort, onResizeStart, onRowClick, linkChip, canDelete, onDeleteUnit, isDuplicate, isDark }: any) {
  const totalW = 40 + columns.reduce((s: number, c: Column) => s + colW[c.key], 0) + (canDelete ? 56 : 0);
  const sortIcon = (key: string) => sort.key !== key ? <FaSort className="text-[10px] opacity-40" /> : sort.dir === "asc" ? <FaSortUp className="text-[10px]" /> : <FaSortDown className="text-[10px]" />;

  const cell = (u: InventoryUnit, key: string) => {
    if (key === "flat_no" && isDuplicate?.(u)) return (
      <span title={unitTooltip(u, true)} className={`inline-flex items-center gap-1.5 font-bold ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>
        <FaExclamationTriangle className="text-[10px] flex-shrink-0" />
        {u.flat_no}
      </span>
    );
    if (key === "unit_type") return <UnitTypeChip unitType={u.unit_type} isDark={isDark} />;
    if (key === "status") return <StatusBadge status={u.status} />;
    if (key === "linked") return linkChip(u);
    if (key === "carpet_area_sqft") return area(u.carpet_area_sqft);
    if (key === "source") return <span className={`text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{String(u.source || "").replace("_", " ")}</span>;
    const v = (u as any)[key];
    return v === null || v === undefined || v === "" ? <span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>—</span> : <span className={`text-[13px] font-medium tracking-tight ${isDark ? "text-white" : "text-black"}`}>{String(v)}</span>;
  };

  return (
    <div className={`rounded-[24px] overflow-hidden border shadow-sm ${isDark ? "bg-[#1C1C1E] border-white/10" : "bg-white border-black/5"}`}>
      <div className="overflow-x-auto custom-scrollbar">
        <table style={{ tableLayout: "fixed", width: totalW, minWidth: "100%" }} className="text-left border-collapse">
          <colgroup>
            <col style={{ width: 44 }} />
            {columns.map((c: Column) => <col key={c.key} style={{ width: colW[c.key] }} />)}
            {canDelete && <col style={{ width: 56 }} />}
          </colgroup>
          <thead>
            <tr className={`border-b ${isDark ? "bg-[#2C2C2E]/50 border-[#38383A]" : "bg-[#F9F9F9] border-[#E5E5EA]"}`}>
              <th className="px-4 py-3.5 top-0">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className={`w-3.5 h-3.5 rounded-[4px] cursor-pointer transition-all focus:ring-2 focus:ring-offset-1 outline-none ${isDark ? "accent-[#0A84FF] focus:ring-[#0A84FF]/50" : "accent-[#007AFF] focus:ring-[#007AFF]/50"
                    }`}
                />
              </th>
              {columns.map((c: Column) => (
                <th
                  key={c.key}
                  className={`relative px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider select-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className={`flex items-center gap-1.5 transition-colors ${c.sortable ? (isDark ? "cursor-pointer hover:text-white" : "cursor-pointer hover:text-black") : "cursor-default"}`}
                  >
                    <span className="truncate">{c.label}</span>
                    {c.sortable && sortIcon(c.key)}
                  </button>
                  <span
                    onMouseDown={e => onResizeStart(e, c.key)}
                    className={`absolute top-0 right-0 h-full w-2 cursor-col-resize transition-colors ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"}`}
                  />
                </th>
              ))}
              {canDelete && (
                <th className={`px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-right ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className={`divide-y ${isDark ? "divide-[#38383A]" : "divide-[#E5E5EA]"}`}>
            {sorted.map((u: InventoryUnit) => (
              <tr
                key={u.id}
                onClick={() => onRowClick(u.id)}
                title={isDuplicate?.(u) ? "Duplicate flat number" : undefined}
                className={`cursor-pointer group transition-colors ${isDuplicate?.(u) ? (isDark ? "bg-[#FF453A]/10" : "bg-[#FFECEB]") : selected.has(u.id) ? (isDark ? "bg-[#0A84FF]/10" : "bg-[#E5F1FF]") : (isDark ? "hover:bg-white/[0.02]" : "hover:bg-black/[0.02]")
                  }`}
              >
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggleOne(u.id)}
                    className={`w-3.5 h-3.5 rounded-[4px] cursor-pointer transition-all focus:ring-2 focus:ring-offset-1 outline-none ${isDark ? "accent-[#0A84FF] focus:ring-[#0A84FF]/50" : "accent-[#007AFF] focus:ring-[#007AFF]/50"
                      }`}
                  />
                </td>
                {columns.map((c: Column) => (
                  <td key={c.key} className={`px-4 py-3 truncate ${c.numeric ? "text-center tabular-nums" : ""}`}>
                    {cell(u, c.key)}
                  </td>
                ))}
                {canDelete && (
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    {isBookingProtected(u) ? (
                      <span
                        title={`Locked — this unit is linked to a booking and cannot be deleted.`}
                        className={`inline-flex items-center justify-center p-2 rounded-full cursor-not-allowed ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}
                      >
                        <FaLock className="text-[12px]" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onDeleteUnit(u)}
                        title={isLinkedActive(u) ? `Delete — warning: ${linkLabel(u)}` : "Delete unit"}
                        className={`p-2 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 ${isDark ? "text-[#FF453A] hover:bg-[#FF453A]/15" : "text-[#FF3B30] hover:bg-[#FFECEB]"
                          }`}
                      >
                        <FaTrash className="text-[12px]" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One flat in the floor grid
// ═══════════════════════════════════════════════════════════════════════════
function UnitCell({ u, t, isDark, duplicate, onClick }: { u: InventoryUnit; t: any; isDark: boolean; duplicate: boolean; onClick: () => void }) {
  const type = getUnitTypeColor(u.unit_type, isDark);
  const status = sc(u.status);
  return (
    <button
      type="button"
      onClick={onClick}
      title={unitTooltip(u, duplicate)}
      className="relative w-full min-w-0 h-[64px] px-2 rounded-[14px] flex flex-col items-center justify-center leading-tight transition-transform hover:scale-[1.03] active:scale-95 shadow-sm"
      style={{
        backgroundColor: duplicate ? (isDark ? "rgba(255,69,58,0.15)" : "#FFECEB") : type.fill,
        border: duplicate ? `1.5px solid ${isDark ? "#FF453A" : "#FF3B30"}` : `1px solid ${type.border}`,
      }}
    >
      <span
        className="absolute top-1.5 right-1.5 w-[8px] h-[8px] rounded-full shadow-sm"
        style={{ backgroundColor: status.hex }}
        title={status.label}
      />
      <span className={`inline-flex items-center gap-1 max-w-full text-[14px] font-semibold tracking-tight ${duplicate ? (isDark ? "text-[#FF453A]" : "text-[#FF3B30]") : (isDark ? "text-white" : "text-black")}`}>
        {duplicate && <FaExclamationTriangle className="text-[10px] flex-shrink-0" aria-hidden />}
        <span className="truncate">{u.flat_no}</span>
      </span>
      <span className="text-[10px] font-bold tracking-wide uppercase mt-0.5" style={{ color: type.ink }}>{type.label}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Grid / heatmap view
// ═══════════════════════════════════════════════════════════════════════════
const TILE_MIN = 88;
const TILE_MAX = 168;
const TILE_GAP = 8;
const FLOOR_LABEL_W = 60;

function GridView({ floorsGrouped, t, onCellClick, isDuplicate, isDark, ctx }: { floorsGrouped: [number, InventoryUnit[]][]; t: any; onCellClick: (id: number) => void; isDuplicate?: (u: InventoryUnit) => boolean; isDark: boolean; ctx?: BuildingContext }) {
  const anyDuplicate = floorsGrouped.some(([, us]) => us.some(u => isDuplicate?.(u)));
  const cols = Math.max(1, ...floorsGrouped.map(([, us]) => us.length));

  const typesPresent = [...new Map(
    floorsGrouped.flatMap(([, us]) => us.map(u => u.unit_type))
      .filter(Boolean)
      .map(ut => [normalizeUnitType(ut), unitTypeLabel(ut)] as [string, string]),
  ).entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));

  return (
    <div className={`p-4 rounded-[24px] shadow-sm border ${isDark ? "bg-[#1C1C1E] border-white/5" : "bg-white border-black/5"}`}>
      {ctx && <BuildingContextTag ctx={ctx} t={t} compact className="mb-4" />}

      {/* ── Legend ── */}
      <div className={`flex items-start gap-x-8 gap-y-3 flex-wrap mb-5 pb-4 border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
        {typesPresent.length > 0 && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Unit types</span>
            {typesPresent.map(([key, label]) => {
              const c = getUnitTypeColor(key, isDark);
              return (
                <span key={key} className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-tight">
                  <span className="w-3.5 h-3.5 rounded-[4px] shadow-sm" style={{ backgroundColor: c.fill, border: `1px solid ${c.ink}` }} />
                  <span style={{ color: c.ink }}>{label}</span>
                </span>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Status</span>
          {STATUS_KEYS.map(s => (
            <span key={s} className={`inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
              <span className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: STATUS[s].hex }} />
              <span>{STATUS[s].label}</span>
            </span>
          ))}
        </div>
        {anyDuplicate && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Special</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-tight">
              <span className="w-3.5 h-3.5 rounded-[4px] flex items-center justify-center shadow-sm" style={{ backgroundColor: isDark ? "rgba(255,69,58,0.15)" : "#FFECEB", border: `1.5px solid ${isDark ? "#FF453A" : "#FF3B30"}` }} />
              <span className={isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}>Duplicate flat number</span>
            </span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <div className="space-y-2" style={{ minWidth: FLOOR_LABEL_W + cols * (TILE_MIN + TILE_GAP) }}>
          {floorsGrouped.map(([floor, us]) => (
            <div key={floor} className="flex items-stretch" style={{ gap: TILE_GAP }}>
              <div
                className={`flex-shrink-0 sticky left-0 z-10 flex items-center justify-end pr-3 text-[12px] font-semibold tracking-tight backdrop-blur-md ${isDark ? "text-[#8E8E93] bg-[#1C1C1E]/80" : "text-[#8E8E93] bg-white/80"}`}
                style={{ width: FLOOR_LABEL_W }}
              >
                {floor === 0 ? "Ground" : `Fl ${floor}`}
              </div>
              <div
                className="grid flex-1"
                style={{
                  gap: TILE_GAP,
                  gridTemplateColumns: `repeat(${cols}, minmax(${TILE_MIN}px, 1fr))`,
                  maxWidth: cols * TILE_MAX + (cols - 1) * TILE_GAP,
                }}
              >
                {us.map(u => (
                  <UnitCell key={u.id} u={u} t={t} isDark={isDark}
                    duplicate={!!isDuplicate?.(u)} onClick={() => onCellClick(u.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Modals
// ═══════════════════════════════════════════════════════════════════════════
function ModalShell({ isDark, onClose, children, maxW = "max-w-lg" }: any) {
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className={`w-full ${maxW} rounded-[24px] shadow-[0_24px_48px_rgba(0,0,0,0.2)] border overflow-hidden ${isDark ? "bg-[#1C1C1E] border-white/10" : "bg-white border-black/5"}`}>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

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

  const inputCls = `w-full rounded-[12px] px-4 py-2.5 text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[#FF3B30]/50 border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-[#F2F2F7] border-transparent text-black"}`;

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-[#FF453A]/15 text-[#FF453A]" : "bg-[#FFECEB] text-[#FF3B30]"}`}>
            <FaTrash className="text-[16px]" />
          </div>
          <h2 className={`text-[18px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>{linked ? "Delete a linked flat?" : `Delete flat ${unit.flat_no}?`}</h2>
        </div>
        {linked ? (
          <>
            <p className={`text-[13px] leading-relaxed mb-4 ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>
              This flat is currently <b className={isDark ? "text-white" : "text-black"}>{statusPhrase}</b>{linkPhrase ? <> and linked to <b className={isDark ? "text-white" : "text-black"}>{linkPhrase}</b></> : null}. Deleting it will <b>NOT</b> cancel the booking, but the flat's inventory record will be removed and this link will be lost.
            </p>
            <label className={`text-[11px] font-semibold uppercase tracking-wider block mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Type <b className={isDark ? "text-white" : "text-black"}>{unit.flat_no}</b> to confirm</label>
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={String(unit.flat_no)} className={inputCls} />
          </>
        ) : (
          <p className={`text-[13px] leading-relaxed mb-4 ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>This soft-deletes the unit — it's kept in history and recoverable, not permanently removed. Continue?</p>
        )}
        {err && <p className={`text-[12px] font-medium mt-3 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>Cancel</button>
          <button onClick={doDelete} disabled={busy || !canConfirm} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-[#FF453A]" : "bg-[#FF3B30]"}`}>
            {busy ? "Deleting…" : linked ? "Force delete" : "Delete"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

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
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-[#FF453A]/15 text-[#FF453A]" : "bg-[#FFECEB] text-[#FF3B30]"}`}>
            <FaTrash className="text-[16px]" />
          </div>
          <h2 className={`text-[18px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>Delete selected units</h2>
        </div>

        {result ? (
          <>
            <p className={`text-[14px] font-medium tracking-tight mb-4 ${isDark ? "text-white" : "text-black"}`}>
              <b>{result.deleted}</b> deleted{result.skipped ? <>, <b>{result.skipped}</b> skipped (linked)</> : null}.
            </p>
            {result.skipped_details.length > 0 && (
              <div className={`rounded-[14px] border p-3 max-h-40 overflow-y-auto custom-scrollbar mb-4 ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-[#F2F2F7] border-[#E5E5EA]"}`}>
                {result.skipped_details.map((s: any, i: number) => <p key={i} className={`text-[12px] tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}><b className={isDark ? "text-white" : "text-black"}>{s.flat_no}</b> — {s.reason}</p>)}
              </div>
            )}
            <div className="flex justify-end mt-2"><button onClick={onDeleted} className={`px-6 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`}>Done</button></div>
          </>
        ) : (
          <>
            <p className={`text-[14px] font-medium tracking-tight mb-4 ${isDark ? "text-white" : "text-black"}`}>
              <b>{deletable.length}</b> deletable, <b>{skipped.length}</b> skipped (linked)
            </p>
            {skipped.length > 0 && (
              <div className={`rounded-[14px] border p-3 mb-4 max-h-40 overflow-y-auto custom-scrollbar ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-[#F2F2F7] border-[#E5E5EA]"}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Skipped (linked / active)</p>
                {skipped.map((u: InventoryUnit) => <p key={u.id} className={`text-[12px] tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}><b className={isDark ? "text-white" : "text-black"}>{u.flat_no}</b> — linked to {linkLabel(u)}</p>)}
              </div>
            )}
            <p className={`text-[12px] leading-relaxed mb-4 ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>Deletable units are soft-deleted (kept in history, recoverable). Linked units are skipped.</p>
            {err && <p className={`text-[12px] font-medium mb-3 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{err}</p>}
            <div className="flex justify-end gap-3 mt-2">
              <button onClick={onClose} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>Cancel</button>
              <button onClick={commit} disabled={busy || deletable.length === 0} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-[#FF453A]" : "bg-[#FF3B30]"}`}>
                {busy ? "Deleting…" : `Delete ${deletable.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function AddBuildingModal({ isDark, t, onClose, onCreated }: any) {
  const [name, setName] = useState("");
  const [tower, setTower] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inputCls = `w-full rounded-[12px] px-4 py-2.5 text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[#007AFF]/50 border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-[#F2F2F7] border-transparent text-black"}`;

  const submit = async () => {
    if (!name.trim()) { setErr("Building / project name is required."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/inventory/projects", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ name: name.trim(), city: city.trim() || null }),
      });
      const json = await res.json();

      let projectId: number | null = json?.data?.id ?? null;
      if (!json.success) {
        if (res.status === 409 && tower.trim()) {
          const listRes = await fetch("/api/inventory/projects", { credentials: "include" });
          const list = await listRes.json();
          const found = (list?.data || []).find(
            (p: any) => String(p.name || "").trim().toLowerCase() === name.trim().toLowerCase(),
          );
          if (!found) throw new Error(json.message || "Could not create the building");
          projectId = Number(found.id);
        } else {
          throw new Error(json.message || "Could not create the building");
        }
      }

      if (tower.trim() && projectId) {
        const tRes = await fetch("/api/inventory/towers", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ project_id: projectId, name: tower.trim() }),
        });
        const tJson = await tRes.json();
        if (!tJson.success && tRes.status !== 409) throw new Error(tJson.message || "Building created, but the tower could not be added.");
      }
      onCreated();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-10 h-10 rounded-[12px] flex items-center justify-center ${isDark ? "bg-[#0A84FF]/15 text-[#0A84FF]" : "bg-[#E5F1FF] text-[#007AFF]"}`}>
            <FaBuilding className="text-[18px]" />
          </div>
          <h2 className={`text-[18px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>Add building</h2>
        </div>
        <div className="space-y-4 mb-4">
          <div>
            <label className={`text-[11px] font-semibold uppercase tracking-wider mb-2 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Building / project name *</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="VR Buildcom" />
          </div>
          <div>
            <label className={`text-[11px] font-semibold uppercase tracking-wider mb-2 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>First tower (optional)</label>
            <input value={tower} onChange={e => setTower(e.target.value)} className={inputCls} placeholder="A" />
          </div>
          <div>
            <label className={`text-[11px] font-semibold uppercase tracking-wider mb-2 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>City (optional)</label>
            <input value={city} onChange={e => setCity(e.target.value)} className={inputCls} placeholder="Mumbai" />
          </div>
        </div>
        <p className={`text-[12px] leading-relaxed mb-4 ${isDark ? "text-[#EBEBF5]/80" : "text-[#333333]"}`}>The building starts empty — open it and use Add Unit to generate its flats.</p>
        {err && <p className={`text-[12px] font-medium mb-3 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{err}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>Cancel</button>
          <button onClick={submit} disabled={busy || !name.trim()} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`}>
            {busy ? "Creating…" : "Create building"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function RenameModal({ kind, isDark, t, target, onClose, onRenamed }: any) {
  const label = kind === "building" ? "building" : kind === "tower" ? "tower" : "wing";
  const current = kind === "building" ? target.project_name : kind === "tower" ? target.tower : target.wing;
  const [name, setName] = useState(kind === "wing" ? (current || "") : current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = String(name ?? "").trim();
  const canSave = kind === "wing" ? trimmed !== String(current ?? "").trim() : !!trimmed && trimmed !== String(current ?? "").trim();

  const commit = async () => {
    if (!canSave || busy) return;
    setBusy(true); setErr(null);
    try {
      let res: Response;
      if (kind === "building") {
        res = await fetch(`/api/inventory/projects/${target.project_id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify({ name: trimmed }),
        });
      } else if (kind === "tower") {
        res = await fetch(`/api/inventory/towers/${target.tower_id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify({ name: trimmed }),
        });
      } else {
        res = await fetch(`/api/inventory/wings`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            project_name: target.project_name, tower: target.tower,
            wing: target.wing, new_wing: trimmed,
          }),
        });
      }
      const json = await res.json().catch(() => ({ success: false, message: "Unexpected response" }));
      if (!json.success) throw new Error(json.message || `Could not rename this ${label}`);
      onRenamed(trimmed, json.data);
      onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const missingId =
    (kind === "building" && target.project_id == null) ||
    (kind === "tower" && target.tower_id == null);

  const inputCls = `w-full rounded-[12px] px-4 py-2.5 text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[#007AFF]/50 border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-transparent text-black placeholder-[#8E8E93]"}`;

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-[#0A84FF]/15 text-[#0A84FF]" : "bg-[#E5F1FF] text-[#007AFF]"}`}>
            <FaPen className="text-[16px]" />
          </div>
          <h2 className={`text-[18px] font-semibold tracking-tight capitalize ${isDark ? "text-white" : "text-black"}`}>Rename {label}</h2>
        </div>

        {missingId ? (
          <p className={`text-[13px] leading-relaxed mb-4 ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>
            This {label} has no record to rename yet — its units were created before the
            {label === "building" ? " building" : " tower"} registry existed. Generate inventory for it once and it
            becomes renameable.
          </p>
        ) : (
          <>
            <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              Current name
            </label>
            <p className={`text-[15px] font-semibold tracking-tight mb-4 ${isDark ? "text-white" : "text-black"}`}>{current || "(no wing)"}</p>

            <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>New name</label>
            <input
              autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commit(); }}
              placeholder={kind === "wing" ? "Leave blank for no wing" : `New ${label} name`}
              className={inputCls}
            />
            <p className={`text-[12px] mt-3 leading-relaxed ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
              Every unit in this {label} is updated, along with any booking that references it.
            </p>
          </>
        )}

        {err && <p className={`text-[12px] font-medium mt-3 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{err}</p>}

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>Cancel</button>
          {!missingId && (
            <button onClick={commit} disabled={!canSave || busy}
              className={`px-6 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`}>
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function BuildingPurgeModal({ building, isDark, t, onClose, onDeleted }: any) {
  const [deps, setDeps] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; blocking: any[] } | null>(null);
  const [typed, setTyped] = useState("");
  const inputCls = `w-full rounded-[12px] px-4 py-2.5 text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[#FF3B30]/50 border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-transparent text-black placeholder-[#8E8E93]"}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/inventory/projects/${building.project_id}`, { credentials: "include" });
        const json = await res.json();
        if (live && json.success) setDeps(json.data);
        else if (live) setErr(json.message || "Could not read this building's contents.");
      } catch {
        if (live) setErr("Could not read this building's contents.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [building.project_id]);

  const blocked = !!deps && deps.active_bookings > 0;
  const confirmOk = typed.trim().toLowerCase() === String(building.project_name).trim().toLowerCase();

  const commit = async () => {
    if (!confirmOk || blocked) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/inventory/projects/${building.project_id}`, {
        method: "DELETE", credentials: "include",
      });
      const json = await res.json().catch(() => ({ success: false, message: "Unexpected response" }));
      if (!json.success) {
        if (json.blocking?.length) setRefusal({ message: json.message, blocking: json.blocking });
        else setErr(json.message || "Delete failed.");
        return;
      }
      onDeleted(building.project_id);
    } catch (e: any) {
      setErr(e.message || "Delete failed.");
    } finally { setBusy(false); }
  };

  const Row = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
    <div className={`flex items-center justify-between py-2 border-b last:border-0 ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
      <span className={`text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{label}</span>
      <span className={`text-[13px] font-semibold ${tone || (isDark ? "text-white" : "text-black")}`}>{value}</span>
    </div>
  );

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-[#FF453A]/15 text-[#FF453A]" : "bg-[#FFECEB] text-[#FF3B30]"}`}>
            <FaExclamationTriangle className="text-[16px]" />
          </div>
          <h2 className={`text-[18px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>Delete Building?</h2>
        </div>
        <p className={`text-[13px] leading-relaxed mb-4 ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>
          Are you sure you want to delete <b className={isDark ? "text-white" : "text-black"}>{building.project_name}</b>?
        </p>

        {loading ? (
          <p className={`text-[12px] italic ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Checking what this building contains…</p>
        ) : refusal ? (
          <>
            <div className={`rounded-[14px] border p-4 mb-4 ${isDark ? "bg-[#FF453A]/10 border-[#FF453A]/20" : "bg-[#FFECEB] border-[#FF3B30]/20"}`}>
              <p className={`text-[13px] font-semibold ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{refusal.message}</p>
            </div>
            <div className={`rounded-[14px] border p-3 max-h-40 overflow-y-auto custom-scrollbar ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-[#F2F2F7] border-[#E5E5EA]"}`}>
              {refusal.blocking.map((b: any, i: number) => (
                <p key={i} className={`text-[12px] tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}><b className={isDark ? "text-white" : "text-black"}>{b.flat_no}</b> — {b.reason}</p>
              ))}
            </div>
            <div className="flex justify-end mt-6">
              <button onClick={onClose} className={`px-6 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className={`rounded-[16px] border p-4 mb-4 ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-[#F2F2F7] border-[#E5E5EA]"}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>This building contains</p>
              <Row label="Towers" value={deps?.towers ?? 0} />
              <Row label="Wings" value={deps?.wings ?? 0} />
              <Row label="Floors" value={deps?.floors ?? 0} />
              <Row label="Units" value={deps?.units ?? 0} />
              <Row label="Active bookings" value={deps?.active_bookings ?? 0} tone={deps?.active_bookings ? (isDark ? "text-[#FF453A]" : "text-[#FF3B30]") : undefined} />
              {!!deps?.history_preserved_units && <Row label="Flats with past bookings" value={deps.history_preserved_units} tone={isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"} />}
              {!!deps?.archived_units && <Row label="Already-deleted flats" value={deps.archived_units} />}
            </div>

            {blocked ? (
              <div className={`rounded-[14px] border p-4 mb-4 ${isDark ? "bg-[#FF453A]/10 border-[#FF453A]/20" : "bg-[#FFECEB] border-[#FF3B30]/20"}`}>
                <p className={`text-[12px] leading-relaxed ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>
                  <b>{deps.active_bookings}</b> flat{deps.active_bookings === 1 ? " is" : "s are"} still held by a live booking. Cancel or move {deps.active_bookings === 1 ? "that booking" : "those bookings"} first — the building cannot be deleted while a sale points at it.
                </p>
                <div className="mt-3 max-h-28 overflow-y-auto custom-scrollbar">
                  {(deps.blocking || []).map((b: any, i: number) => (
                    <p key={i} className={`text-[12px] tracking-tight ${isDark ? "text-[#FF453A]/80" : "text-[#FF3B30]/80"}`}><b className="font-semibold">{b.flat_no}</b> — {b.reason}</p>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <p className={`text-[12px] leading-relaxed mb-4 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  The building, its towers, its price rules and its unsold stock are removed permanently.
                  {!!deps?.history_preserved_units && (
                    <> Flats that a cancelled booking once occupied are <b className={isDark ? "text-white" : "text-black"}>archived instead of erased</b>, so their booking history stays readable.</>
                  )}{" "}
                  Bookings, payments and customer records are never touched.
                </p>
                <label className={`text-[11px] font-semibold uppercase tracking-wider block mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  Type <b className={isDark ? "text-white" : "text-black"}>{building.project_name}</b> to confirm
                </label>
                <input value={typed} onChange={e => setTyped(e.target.value)} className={inputCls} placeholder={building.project_name} autoFocus />
              </>
            )}

            {err && <p className={`text-[12px] font-medium mt-3 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{err}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={onClose} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>Cancel</button>
              <button onClick={commit} disabled={busy || blocked || !confirmOk}
                className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-[#FF453A]" : "bg-[#FF3B30]"}`}>
                {busy ? "Deleting…" : "Delete Permanently"}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function BuildingDeleteModal({ user, isDark, t, onClose, onDeleted, defaults, building, onBuildingPurged }: any) {
  const [scope, setScope] = useState({ project_name: defaults?.project_name || "", tower: defaults?.tower || "", wing: defaults?.wing || "" });
  const [preview, setPreview] = useState<{ matched: number; linked: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const inputCls = `w-full rounded-[12px] px-4 py-2.5 text-[14px] font-medium tracking-tight outline-none transition-all focus:ring-2 focus:ring-[#FF3B30]/50 border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder-[#8E8E93]" : "bg-[#F2F2F7] border-transparent text-black placeholder-[#8E8E93]"}`;
  const ready = !!(scope.project_name.trim() && scope.tower.trim());

  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    const id = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        const p = new URLSearchParams();
        p.set("project_name", scope.project_name.trim());
        p.set("tower", scope.tower.trim());
        if (scope.wing.trim()) p.set("wing", scope.wing.trim());
        const res = await fetch(`/api/inventory/building?${p.toString()}`);
        const json = await res.json();
        if (json.success) setPreview({ matched: json.matched, linked: json.linked });
      } catch { /* */ } finally { setLoadingPreview(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [scope, ready]);

  const confirmOk = ready && (typed.trim().toLowerCase() === scope.tower.trim().toLowerCase() || typed.trim() === "DELETE");
  const deletable = preview ? preview.matched - preview.linked : 0;

  const purgesWholeBuilding = !!building?.project_id && !scope.wing.trim()
    && (!scope.tower.trim() || building.tower_count <= 1);

  const commit = async () => {
    if (!confirmOk) return;
    setBusy(true); setErr(null);
    try {
      if (purgesWholeBuilding) {
        const res = await fetch(`/api/inventory/projects/${building.project_id}`, {
          method: "DELETE", credentials: "include",
        });
        const json = await res.json().catch(() => ({ success: false, message: "Unexpected response" }));
        if (!json.success) {
          const blocking = (json.blocking || []).map((b: any) => ({ flat_no: b.flat_no, reason: b.reason }));
          setResult({ deleted: 0, skipped: blocking.length, skipped_details: blocking, refused: json.message });
          return;
        }
        setResult({
          deleted: json.data.deleted_units,
          skipped: 0,
          skipped_details: [],
          purged: json.data,
        });
        onBuildingPurged?.(building.project_id);
        return;
      }

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
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-[#FF453A]/15 text-[#FF453A]" : "bg-[#FFECEB] text-[#FF3B30]"}`}>
            <FaBuilding className="text-[16px]" />
          </div>
          <h2 className={`text-[18px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>
            {building ? `Delete ${building.project_name}?` : "Delete whole building / tower"}
          </h2>
        </div>

        {result ? (
          <>
            <p className={`text-[14px] font-medium tracking-tight mb-4 ${isDark ? "text-white" : "text-black"}`}>
              <b>{result.deleted}</b> deleted{result.skipped ? <>, <b>{result.skipped}</b> skipped (linked)</> : null}.
            </p>
            {(result.skipped_details || []).length > 0 && (
              <div className={`rounded-[14px] border p-4 max-h-40 overflow-y-auto custom-scrollbar mb-4 ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-[#F2F2F7] border-[#E5E5EA]"}`}>
                {result.skipped_details.map((s: any, i: number) => <p key={i} className={`text-[12px] tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}><b className={isDark ? "text-white" : "text-black"}>{s.flat_no}</b> — {s.reason}</p>)}
              </div>
            )}
            <div className="flex justify-end mt-2"><button onClick={onDeleted} className={`px-6 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`}>Done</button></div>
          </>
        ) : (
          <>
            {building && (
              <>
                <p className={`text-[13px] leading-relaxed mb-3 ${isDark ? "text-[#EBEBF5]/90" : "text-[#333333]"}`}>
                  This building contains <b className={isDark ? "text-white" : "text-black"}>{building.total}</b> inventory unit{building.total === 1 ? "" : "s"}. Deleting it may affect:
                </p>
                <ul className={`text-[12px] font-medium leading-relaxed mb-5 pl-4 list-disc ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                  <li>Inventory records</li>
                  <li>Booking links</li>
                  <li>Pricing & Offers</li>
                  <li>Historical records</li>
                </ul>
              </>
            )}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={`text-[11px] font-semibold uppercase tracking-wider mb-2 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Project *</label>
                <input value={scope.project_name} readOnly={!!building}
                  onChange={e => setScope(s => ({ ...s, project_name: e.target.value }))}
                  className={`${inputCls} ${building ? "opacity-70 cursor-not-allowed" : ""}`} />
              </div>
              <div>
                <label className={`text-[11px] font-semibold uppercase tracking-wider mb-2 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Tower *</label>
                {building?.towers?.length ? (
                  <div className="relative">
                    <select value={scope.tower} onChange={e => setScope(s => ({ ...s, tower: e.target.value }))} className={`appearance-none cursor-pointer ${inputCls}`}>
                      <option value="">Select a tower…</option>
                      {building.towers.map((x: TowerSummary) => (
                        <option key={x.tower} value={x.tower}>Tower {x.tower} ({x.total} units)</option>
                      ))}
                    </select>
                    <FaChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
                  </div>
                ) : (
                  <input value={scope.tower} onChange={e => setScope(s => ({ ...s, tower: e.target.value }))} className={inputCls} />
                )}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className={`text-[11px] font-semibold uppercase tracking-wider mb-2 block ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Wing</label>
                <input value={scope.wing} onChange={e => setScope(s => ({ ...s, wing: e.target.value }))} className={inputCls} placeholder="All wings" />
              </div>
            </div>
            {building && building.towers.length > 1 && (
              <p className={`text-[12px] mb-4 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                This project has {building.towers.length} towers. Deletion is scoped to one tower at a time.
              </p>
            )}
            {!ready ? <p className={`text-[12px] font-medium italic mb-4 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Enter project and tower to preview.</p> : (
              <div className={`rounded-[14px] border p-4 mb-4 ${isDark ? "bg-[#2C2C2E] border-[#38383A]" : "bg-[#F2F2F7] border-[#E5E5EA]"}`}>
                {loadingPreview ? <p className={`text-[12px] italic ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Counting…</p> : preview ? (
                  <p className={`text-[13px] font-medium tracking-tight ${isDark ? "text-white" : "text-black"}`}><b className={isDark ? "text-[#0A84FF]" : "text-[#007AFF]"}>{preview.matched}</b> units match · <b className={isDark ? "text-[#FF9F0A]" : "text-[#FF9500]"}>{preview.linked}</b> blocked (linked) · <b className={isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}>{deletable}</b> will be deleted</p>
                ) : null}
              </div>
            )}
            <p className={`text-[13px] leading-relaxed mb-4 ${isDark ? "text-white" : "text-black"}`}>This soft-deletes every unlinked unit in the scope (kept in history). Linked/active units are skipped.</p>
            <label className={`text-[11px] font-semibold uppercase tracking-wider block mb-2 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Type the tower name <b className={isDark ? "text-white" : "text-black"}>{scope.tower || "…"}</b> (or <b className={isDark ? "text-white" : "text-black"}>DELETE</b>) to confirm</label>
            <input value={typed} onChange={e => setTyped(e.target.value)} className={inputCls} placeholder={scope.tower || "DELETE"} />
            {err && <p className={`text-[12px] font-medium mt-3 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{err}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={onClose} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-black"}`}>Cancel</button>
              <button onClick={commit} disabled={busy || !confirmOk || deletable === 0} className={`px-5 py-2.5 rounded-full text-[13px] font-semibold tracking-wide text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-[#FF453A]" : "bg-[#FF3B30]"}`}>
                {busy ? "Deleting…" : `Delete ${deletable} unit${deletable === 1 ? "" : "s"}`}
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

  const detailRows: Array<[string, React.ReactNode]> = unit ? [
    ["Type", unitTypeLabel(unit.unit_type)],
    ["Carpet area", `${area(unit.carpet_area_sqft)} sqft`],
    ...(num(unit.built_up_area_sqft) ? [["Built-up area", `${area(unit.built_up_area_sqft)} sqft`] as [string, React.ReactNode]] : []),
    ...(unit.facing ? [["Facing", unit.facing] as [string, React.ReactNode]] : []),
    ...(num(unit.rate_per_sqft) ? [["Rate / sqft", formatCurrencyDisplay(unit.rate_per_sqft)] as [string, React.ReactNode]] : []),
    ...(num(unit.base_price) ? [["Base price", formatCurrencyDisplay(unit.base_price)] as [string, React.ReactNode]] : []),
    ["Source", String(unit.source || "").replace("_", " ")],
    ...(unit.is_corner ? [["Corner unit", "Yes"] as [string, React.ReactNode]] : []),
    ...(unit.is_park_facing ? [["Park facing", "Yes"] as [string, React.ReactNode]] : []),
    ...(num(unit.parking_slots) ? [["Parking slots", String(unit.parking_slots)] as [string, React.ReactNode]] : []),
  ] : [];

  return (
    <AnimatePresence>
      {unitId != null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex justify-end bg-black/40 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className={`w-full max-w-[440px] h-full flex flex-col border-l shadow-2xl ${isDark ? "bg-[#1C1C1E] border-white/10" : "bg-white border-black/5"}`}>

            <div className={`flex items-center justify-between px-6 py-5 border-b flex-shrink-0 ${isDark ? "bg-[#2C2C2E]/20 border-[#38383A]" : "bg-[#F9F9F9] border-[#E5E5EA]"}`}>
              <div>
                <h2 className={`text-[20px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>{unit ? `Flat ${unit.flat_no}` : "Unit"}</h2>
                {unit && <p className={`text-[12px] font-medium tracking-tight mt-0.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{unit.project_name} · Tower {unit.tower}{unit.wing ? " · Wing " + unit.wing : ""} · {unit.floor === 0 ? "Ground" : "Floor " + unit.floor}</p>}
              </div>
              <button onClick={onClose} className={`p-2 rounded-full transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-[#8E8E93]" : "bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#8E8E93]"}`}>
                <FaTimes className="text-[14px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-6">
              {loading || !unit ? <div className="flex justify-center py-10"><div className="w-6 h-6 rounded-full border-[3px] border-[#8E8E93] border-t-transparent animate-spin" /></div> : (
                <>
                  <div className={`rounded-[16px] border p-4 ${isDark ? "bg-[#2C2C2E]/50 border-[#38383A]" : "bg-[#F2F2F7]/50 border-[#E5E5EA]"}`}>
                    <div className="flex items-center justify-between mb-4">
                      <StatusBadge status={unit.status} />
                      <div className="flex items-center gap-3">
                        {canManage && !editing && <button onClick={() => setEditing(true)} className={`text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${isDark ? "text-[#0A84FF] hover:underline" : "text-[#007AFF] hover:underline"}`}><FaPen className="text-[10px]" /> Edit</button>}
                        {isAdminUser && (
                          isBookingProtected(unit) ? (
                            <span title="Locked — linked to booking" className={`inline-flex items-center gap-1.5 text-[12px] font-semibold cursor-not-allowed ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                              <FaLock className="text-[10px]" /> Locked
                            </span>
                          ) : (
                            <button onClick={() => onRequestDelete(unit)} className={`text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${isDark ? "text-[#FF453A] hover:underline" : "text-[#FF3B30] hover:underline"}`}><FaTrash className="text-[10px]" /> Delete</button>
                          )
                        )}
                      </div>
                    </div>
                    {editing && (
                      <div className={`mt-2 pt-4 border-t ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
                        <div className="relative mb-3">
                          <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className={`appearance-none w-full rounded-[10px] px-3.5 py-2 text-[13px] font-medium tracking-tight outline-none border transition-colors focus:ring-2 focus:ring-[#007AFF]/50 cursor-pointer ${isDark ? "bg-[#1C1C1E] border-[#38383A] text-white" : "bg-white border-[#E5E5EA] text-black"}`}>
                            {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
                          </select>
                          <FaChevronDown className={`absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`} />
                        </div>
                        <p className={`text-[11px] mb-3 leading-relaxed ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Booked/Registered are set by the booking flow; not manually settable.</p>
                        {err && <p className={`text-[12px] font-medium mb-3 ${isDark ? "text-[#FF453A]" : "text-[#FF3B30]"}`}>{err}</p>}
                        <div className="flex gap-2">
                          <button onClick={saveStatus} disabled={busy} className={`px-4 py-2 rounded-full text-[12px] font-semibold tracking-wide text-white transition-all active:scale-95 disabled:opacity-50 ${isDark ? "bg-[#0A84FF]" : "bg-[#007AFF]"}`}>{busy ? "Saving…" : "Save"}</button>
                          <button onClick={() => { setEditing(false); setNewStatus(unit.status); setErr(null); }} className={`px-4 py-2 rounded-full text-[12px] font-semibold tracking-wide transition-colors ${isDark ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white" : "bg-[#E5E5EA] hover:bg-[#D1D1D6] text-black"}`}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <section>
                    <p className={`text-[11px] font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Details</p>
                    <div className={`rounded-[16px] border ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-white"}`}>
                      {detailRows.map(([label, value], i) => (
                        <div key={label} className={`flex items-center justify-between gap-3 px-4 py-3 ${i !== detailRows.length - 1 ? (isDark ? "border-b border-[#38383A]" : "border-b border-[#E5E5EA]") : ""}`}>
                          <span className={`text-[12px] font-medium ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{label}</span>
                          <span className={`text-[13px] font-semibold tracking-tight text-right tabular-nums ${isDark ? "text-white" : "text-black"}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {(unit.booking_id || unit.lead_id) && (
                    <section>
                      <p className={`text-[11px] font-semibold uppercase tracking-wider mb-3 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>Linked To</p>
                      <div className={`rounded-[16px] border p-4 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-white"}`}>
                        {(unit.lead_name || unit.lead_id) && (
                          <div className="mb-3">
                            <p className={`text-[14px] font-semibold tracking-tight ${isDark ? "text-white" : "text-black"}`}>{unit.lead_name || `Lead #${unit.lead_id}`}</p>
                            <div className={`text-[12px] font-medium tracking-tight mt-1 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                              {unit.lead_phone ? <span>{unit.lead_phone}</span> : null}
                              {unit.lead_phone && unit.lead_email ? " · " : ""}
                              {unit.lead_email ? <span>{unit.lead_email}</span> : null}
                            </div>
                          </div>
                        )}
                        {unit.booking_id && (
                          <div className={`text-[12px] font-medium tracking-tight mb-4 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>
                            Booking <b className={isDark ? "text-white" : "text-black"}>{unit.booking_number || `#${unit.booking_id}`}</b>
                            {unit.booking_status ? <> · {unit.booking_status}</> : null}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3">
                          {(onOpenLead && unit.lead_id) ? (
                            <button onClick={() => onOpenLead!(unit.lead_id!)} className={`text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${isDark ? "text-[#0A84FF] hover:underline" : "text-[#007AFF] hover:underline"}`}>
                              Open Lead <FaExternalLinkAlt className="text-[10px]" />
                            </button>
                          ) : null}
                          {(onOpenBooking && unit.booking_id) ? (
                            <button onClick={() => onOpenBooking!(unit.booking_id!)} className={`text-[12px] font-semibold flex items-center gap-1.5 transition-colors ${isDark ? "text-[#BF5AF2] hover:underline" : "text-[#AF52DE] hover:underline"}`}>
                              Open Booking <FaExternalLinkAlt className="text-[10px]" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  )}

                  <section>
                    <p className={`text-[11px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}><FaHistory className="text-[10px]" /> History ({history.length})</p>
                    <div className="space-y-3">
                      {history.length === 0 && <p className={`text-[13px] italic ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>No history yet.</p>}
                      {history.map(h => (
                        <div key={h.id} className={`rounded-[14px] border p-4 ${isDark ? "border-[#38383A] bg-[#2C2C2E]/20" : "border-[#E5E5EA] bg-[#F9F9F9]"}`}>
                          <div className="flex items-center gap-2 mb-2">
                            {h.old_status && <><StatusBadge status={h.old_status} /><span className={isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}>→</span></>}
                            <StatusBadge status={h.new_status} />
                          </div>
                          {h.reason && <p className={`text-[12px] mb-2 leading-relaxed ${isDark ? "text-white" : "text-black"}`}>{h.reason}</p>}
                          <p className={`text-[11px] font-medium tracking-tight ${isDark ? "text-[#8E8E93]" : "text-[#8E8E93]"}`}>{h.changed_by || "System"} · {new Date(h.changed_at).toLocaleString("en-IN")}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}