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
  FaArrowLeft, FaArrowRight,
} from "react-icons/fa";
import { formatCurrencyDisplay } from "@/lib/currency";
import AddUnitModal from "./AddUnitModal";
import BulkGenerateUnitsModal from "./BulkGenerateUnitsModal";
import PricingRulesModal from "./PricingRulesModal";
import OffersModal from "./OffersModal";
import InventoryAnalyticsModal from "./InventoryAnalyticsModal";
import { Radius } from "lucide-react";

export interface InventoryUnit {
  id: number;
  // apartment_name is retired — no longer captured or shown. Kept optional on the
  // type because the column still exists and pre-retirement rows still return it.
  apartment_name?: string | null;
  project_name: string; tower: string; wing: string | null;
  unit_type: string; floor: number; flat_no: string;
  carpet_area_sqft: string | number | null; built_up_area_sqft: string | number | null;
  rate_per_sqft: string | number | null; base_price: string | number | null;
  facing: string | null; status: string; hold_expires_at: string | null; source: string;
  lead_id: number | null; booking_id: number | null;
  // Sell.Do parity additions. Optional because a cached/older payload may predate them.
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
/** Canonical accessor for a status' colours. `sc` remains as the short alias. */
export const getStatusColor = sc;
const STATUS_KEYS = Object.keys(STATUS);

// Duplicate-flat-number red. Deliberately the same red as `cancelled`: the palette
// already reads red as "something is wrong here". A duplicate outranks the unit-type
// tint on a cell, but never replaces the status indicator — see UnitCell.
const DUPLICATE_HEX = "#ef4444";

// ═══════════════════════════════════════════════════════════════════════════
// Unit-type colours — a SECOND, independent visual channel
// ═══════════════════════════════════════════════════════════════════════════
// Type and status answer different questions ("what is this flat?" vs "can I sell
// it?"), so they get different channels rather than competing for one: the type
// owns the cell's fill, the status owns a dot/badge on top of it. Overwriting one
// with the other is what made the old grid unable to show both at once.
//
// Each entry is the INK — the colour used for text and border. Fills are derived
// from it at low alpha, so a type is one value here, not three scattered ones.
// `dark` is a lightened ink for dark surfaces, because a 45%-lightness ink that
// reads well on white is unreadable on #0D0D12.
type UnitTypeColor = { ink: string; darkInk: string };

// Keys are NORMALISED (upper-case, spaces stripped) because live data spells the
// same type three ways — "2 BHK", "2BHK", "1Bhk" all exist in inventory_units.
const UNIT_TYPE_COLORS: Record<string, UnitTypeColor> = {
  "1RK": { ink: "#64748b", darkInk: "#94a3b8" },       // slate
  "1BHK": { ink: "#0d9488", darkInk: "#2dd4bf" },      // teal
  "1.5BHK": { ink: "#0284c7", darkInk: "#38bdf8" },    // sky
  "2BHK": { ink: "#4f46e5", darkInk: "#818cf8" },      // indigo
  "2.5BHK": { ink: "#7c3aed", darkInk: "#a78bfa" },    // violet
  "3BHK": { ink: "#c026d3", darkInk: "#e879f9" },      // fuchsia
  "3.5BHK": { ink: "#db2777", darkInk: "#f472b6" },    // pink
  "4BHK": { ink: "#ea580c", darkInk: "#fb923c" },      // orange
  "PENTHOUSE": { ink: "#a16207", darkInk: "#eab308" }, // yellow
  "SHOP": { ink: "#047857", darkInk: "#34d399" },      // emerald
  "OFFICE": { ink: "#0369a1", darkInk: "#7dd3fc" },    // deep sky
};

export const normalizeUnitType = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, "").trim();

// Deterministic fallback for a type nobody has assigned a colour to — a new
// configuration must still be distinguishable in the grid the day it is created,
// without an edit here. Saturation and lightness are FIXED so a generated colour
// lands in the same professional register as the curated ones; only the hue moves.
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

/**
 * The one place a unit type becomes a colour. Everything that paints a type —
 * grid cell, table chip, legend — reads it from here, so adding a type is one
 * line above and nothing else.
 */
export function getUnitTypeColor(unitType: string, isDark = false): { ink: string; fill: string; border: string; label: string } {
  const key = normalizeUnitType(unitType);
  const found = UNIT_TYPE_COLORS[key];
  const ink = found
    ? (isDark ? found.darkInk : found.ink)
    : hslToHex(hashHue(key || "?"), 42, isDark ? 65 : 42);
  return {
    ink,
    fill: `${ink}1A`,      // 10% — a tint, never a block of colour
    border: `${ink}59`,    // 35%
    label: String(unitType ?? "").trim() || "—",
  };
}

// ── Duplicate flat numbers (detection logic unchanged — only relocated) ──
// Compared case- and space-insensitively, so "B-1204" and "b-1204 " are one number.
const normFlat = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Flat numbers that occur more than once in the given set of units. */
export function findDuplicateFlats(units: { flat_no?: string | null }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const u of units) {
    const k = normFlat(u.flat_no);
    if (!k) continue;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/** Is this flat number one of the duplicates found above? */
export const isDuplicateFlat = (flatNo: unknown, duplicates: Set<string>) => duplicates.has(normFlat(flatNo));

/** Tooltip shared by both views: "Duplicate flat number — 101 · 2BHK · Available". */
const unitTooltip = (u: InventoryUnit, duplicate: boolean) =>
  [
    duplicate ? "Duplicate flat number —" : null,
    `${u.flat_no} · ${u.unit_type} · ${sc(u.status).label}`,
    u.wing ? `· Wing ${u.wing}` : null,
  ].filter(Boolean).join(" ");

/** Type pill used in the table's Type column and in the legend. */
function UnitTypeChip({ unitType, isDark }: { unitType: string; isDark: boolean }) {
  const c = getUnitTypeColor(unitType, isDark);
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border max-w-full truncate"
      style={{ color: c.ink, backgroundColor: c.fill, borderColor: c.border }}
    >
      {c.label}
    </span>
  );
}


// ── Booking protection (mirrors lib/inventoryDelete.isBookingProtected) ──
// A unit is HARD-PROTECTED when it has a booking_id, status booked/registered,
// or source = booking sync. These units show a lock instead of a delete button,
// and the backend refuses deletion even if force=true is passed.
const isBookingProtected = (u: InventoryUnit) => {
  const status = (u.status || "").toLowerCase().trim();
  const source = (u.source || "").toLowerCase().trim();
  return (
    status === "booked" ||
    status === "registered" ||
    u.booking_id != null ||
    source === "booking sync" ||
    source === "booking_sync"
  );
};

// Delete guardrail (mirrors the server in lib/inventoryDelete.ts). A unit is
// "linked/active" — and so guarded — when booked/registered/on_hold or tied to a lead/booking.
const ACTIVE_STATUSES = ["booked", "registered", "on_hold"];
const isLinkedActive = (u: InventoryUnit) => ACTIVE_STATUSES.includes(u.status) || u.lead_id != null || u.booking_id != null;
const linkLabel = (u: InventoryUnit) => {
  const p: string[] = [];
  if (u.booking_id) p.push(`booking #${u.booking_id}`);
  if (u.lead_id) p.push(`lead #${u.lead_id}`);
  if (p.length) return p.join(" / ");
  // Naming the holder is the point of hold ownership — "on hold" alone was the
  // old, unattributable state that nobody dared release.
  if (u.status === "on_hold") return u.held_by ? `held by ${u.held_by}` : "on hold";
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

// project_name / tower stay in the filter shape because the fetch still sends
// them — but inside a building they come from the opened building, not from a
// box the user has to retype.
const blankFilters = { search: "", project_name: "", tower: "", wing: "", floor: "", unit_type: "", status: "", min_area: "", max_area: "" };

// ═══════════════════════════════════════════════════════════════════════════
// Building level (GET /api/inventory?view=buildings)
// ═══════════════════════════════════════════════════════════════════════════
// A "building" is a PROJECT — the parent row in inventory_projects — and its
// towers are the level below it, exactly as the schema and the FK chain
// (inventory_projects → inventory_towers → inventory_units) define it. Towers
// are NOT separate buildings: a project with Tower A and Tower B is one card
// with two towers inside, not two cards.
interface TowerSummary {
  key: string; tower: string; tower_id: number | null;
  floors: number; total: number; available: number; booked: number; on_hold: number; blocked: number;
}
interface TypeSummary { key: string; tower: string; unit_type: string; units: number; }
interface BuildingSummary {
  key: string;                 // LOWER(TRIM(project_name)) — the grouping key
  project_name: string;        // canonical display name
  project_id: number | null;
  floors: number; tower_count: number;
  total: number; available: number; booked: number; on_hold: number; blocked: number;
  towers: TowerSummary[];
  unit_types: TypeSummary[];
  project_status?: string | null;   // from inventory_projects (upcoming/active/…)
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
});

// A project that exists in inventory_projects but has no stock yet. It still gets
// a card — otherwise "Add Building" would appear to do nothing until the first
// unit is generated, and there would be nowhere to launch the generator from.
const emptyBuilding = (key: string, p: any): BuildingSummary => ({
  key,
  project_name: String(p.name ?? "").trim() || "(Unnamed project)",
  project_id: p.id == null ? null : Number(p.id),
  floors: 0, tower_count: n0(p.tower_count),
  total: 0, available: 0, booked: 0, on_hold: 0, blocked: 0,
  towers: [], unit_types: [], project_status: p.status ?? null,
});

// Roll per-(tower, type) rows up to a single breakdown, optionally for one tower.
const rollupTypes = (rows: TypeSummary[], tower: string) =>
  Object.entries(
    rows.filter(r => !tower || r.tower === tower)
      .reduce<Record<string, number>>((acc, r) => { acc[r.unit_type] = (acc[r.unit_type] || 0) + r.units; return acc; }, {}),
  ).map(([unit_type, units]) => ({ unit_type, units })).sort((a, b) => b.units - a.units);

const floorLabel = (f: number) => (f === 0 ? "Ground" : `Floor ${f}`);

// Landing-page status filter — "show me buildings that still have X". Limited to
// the four buckets the aggregate counts (registered is folded into booked), so a
// dropdown never offers a filter the data behind the cards cannot answer.
const BUILDING_STATUS_FILTERS = [
  { value: "available", label: "Has available" },
  { value: "booked", label: "Has booked" },
  { value: "on_hold", label: "Has on hold" },
  { value: "blocked", label: "Has blocked" },
];

// ── Building card (landing page) ──
// Enough to decide which building to open, and deliberately no more — the card
// is a doorway, not a dashboard.
function BuildingCard({ b, t, onOpen }: { b: BuildingSummary; t: any; onOpen: () => void }) {
  const towerLine = b.towers.length === 0 ? "No towers yet"
    : b.towers.length <= 3 ? b.towers.map(x => `Tower ${x.tower}`).join(" · ")
      : `${b.towers.length} towers`;
  const types = rollupTypes(b.unit_types, "").slice(0, 3);

  return (
    <button type="button" onClick={onOpen}
      className={`text-left w-full rounded-3xl border p-4 transition-colors ${t.innerBlock} hover:border-[#00AEEF]`}>
      <div className="flex items-start gap-2 mb-2">
        <FaBuilding className="text-[#00AEEF] mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <h3 className={`text-sm font-bold truncate ${t.text}`}>{b.project_name}</h3>
          <p className={`text-[11px] truncate ${t.textMuted}`}>{towerLine}</p>
        </div>
      </div>

      <p className={`text-[11px] mb-2 ${t.textMuted}`}>
        {b.floors} floor{b.floors === 1 ? "" : "s"} · <b className={t.text}>{b.total}</b> unit{b.total === 1 ? "" : "s"}
      </p>

      {types.length > 0 && (
        <p className={`text-[11px] mb-3 truncate ${t.textMuted}`}>
          {types.map(c => `${c.units} × ${c.unit_type}`).join("  ·  ")}
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap mb-3">
        {([
          ["Available", b.available, STATUS.available.hex],
          ["Booked", b.booked, STATUS.booked.hex],
          ["On Hold", b.on_hold, STATUS.on_hold.hex],
          ["Blocked", b.blocked, STATUS.blocked.hex],
        ] as [string, number, string][]).map(([label, value, hex]) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />
            <span className={t.textMuted}>{label}:</span>
            <b className={t.text}>{value}</b>
          </span>
        ))}
      </div>

      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#00AEEF]">
        Open <FaArrowRight className="text-[9px]" />
      </span>
    </button>
  );
}

// One figure in the building header strip.
function Stat({ label, value, t, hex }: { label: string; value: number; t: any; hex?: string }) {
  return (
    <div className="min-w-[86px]">
      <p className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${t.textMuted}`}>
        {hex && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />}{label}
      </p>
      <p className={`text-base font-bold ${t.text}`}>{value}</p>
    </div>
  );
}

export default function InventoryManagementView({ user, isDark, t, onOpenLead, onOpenBooking }: Props) {
  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase())
  const isAdminUser = (user?.role || "").trim().toLowerCase() === "admin"; // delete is admin-only

  // ── Level 1: the building list (landing) ──
  const [buildings, setBuildings] = useState<BuildingSummary[]>([]);
  const [bLoading, setBLoading] = useState(true);
  const [bFilters, setBFilters] = useState({ search: "", project: "", tower: "", status: "" });
  const [showAddBuilding, setShowAddBuilding] = useState(false);

  // ── Level 2: the opened building (null = landing) ──
  // Held as the grouping key, not the object, so the header statistics re-read
  // themselves from the refreshed aggregate after every create/delete.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeTower, setActiveTower] = useState("");
  const [bldMenu, setBldMenu] = useState(false);

  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Inside a building the floor grid is the primary read — it is the view that
  // shows the building → floor → flat shape. The table stays one click away.
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
  const [deleteTarget, setDeleteTarget] = useState<InventoryUnit | null>(null); // single delete
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  const [bldDelOpen, setBldDelOpen] = useState(false);

  const inputCls = `rounded-lg px-2.5 py-1.5 text-xs outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;

  // ── Building list fetch ──
  // Two existing endpoints, no new one: the grouped mode of /api/inventory for
  // live unit statistics, and /api/inventory/projects so a project with no stock
  // yet still gets a card to generate into.
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
          // The units carry the name; the project row carries the id and status.
          if (found.project_id == null && p.id != null) found.project_id = Number(p.id);
          found.project_status = p.status ?? null;
        } else {
          byKey.set(key, emptyBuilding(key, p));
        }
      }
      setBuildings([...byKey.values()].sort((a, b) => a.project_name.localeCompare(b.project_name)));
    } catch { /* non-blocking */ } finally { setBLoading(false); }
  }, []);

  useEffect(() => { fetchBuildings(); }, [fetchBuildings]);

  const building = useMemo(() => buildings.find(b => b.key === openKey) || null, [buildings, openKey]);

  // A building whose last unit was deleted and that has no project row left has
  // nothing to show — fall back to the list rather than an empty detail page.
  useEffect(() => {
    if (openKey && !bLoading && !building) { setOpenKey(null); setActiveTower(""); }
  }, [openKey, bLoading, building]);

  // ── Unit fetch — only ever runs inside a building ──
  // The landing page deliberately loads no units at all: that request is what the
  // old flat screen opened with, and it is what this redesign exists to remove.
  const unitsRef = useRef<InventoryUnit[]>([]);
  useEffect(() => { unitsRef.current = units; }, [units]);

  const unitParams = useCallback(() => {
    const p = new URLSearchParams();
    if (!building) return p;
    p.set("project_name", building.project_name);
    if (activeTower) p.set("tower", activeTower);
    if (filters.search) p.set("search", filters.search);
    if (filters.wing) p.set("wing", filters.wing);
    if (filters.floor) p.set("floor", filters.floor);
    if (filters.unit_type) p.set("unit_type", filters.unit_type);
    if (filters.status) p.set("status", filters.status);
    if (filters.min_area) p.set("min_area", filters.min_area);
    if (filters.max_area) p.set("max_area", filters.max_area);
    p.set("limit", "500");
    return p;
  }, [building, activeTower, filters]);

  const fetchUnits = useCallback(async () => {
    if (!building) { setUnits([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const p = unitParams();
      const res = await fetch(`/api/inventory?${p.toString()}`);
      const json = await res.json();
      if (json.success) { setUnits(json.data); setTotal(json.total ?? json.data.length); }
    } catch { /* non-blocking */ } finally { setLoading(false); }
  }, [building, unitParams]);

  // Debounced refetch on filter / building / tower change.
  useEffect(() => {
    const id = setTimeout(fetchUnits, 250);
    return () => clearTimeout(id);
  }, [fetchUnits]);

  // Page 2+ of a large tower. The server caps a page at 500, so more stock is
  // reached by offset rather than by asking for a bigger page.
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
    } catch { /* non-blocking */ } finally { setLoadingMore(false); }
  };

  const setFilter = (patch: Partial<typeof blankFilters>) => setFilters(f => ({ ...f, ...patch }));

  const openBuilding = (b: BuildingSummary) => {
    setOpenKey(b.key);
    setActiveTower(b.towers.length === 1 ? b.towers[0].tower : "");
    setFilters({ ...blankFilters });
    setSelected(new Set());
    setViewMode("grid");
  };
  const backToList = () => {
    setOpenKey(null); setActiveTower(""); setBldMenu(false);
    setFilters({ ...blankFilters }); setSelected(new Set()); setUnits([]); setTotal(0);
    fetchBuildings();
  };

  // Statistics are read from the aggregate, never from the (capped) unit list, so
  // they stay right for a tower with more than one page of stock.
  const scope = useMemo(() => {
    if (!building) return null;
    if (!activeTower) return building;
    return building.towers.find(x => x.tower === activeTower) || building;
  }, [building, activeTower]);
  const typeChips = useMemo(
    () => (building ? rollupTypes(building.unit_types, activeTower) : []),
    [building, activeTower],
  );
  // Floor options for the in-building filter come from the loaded units.
  const floorOptions = useMemo(
    () => [...new Set(units.map(u => u.floor))].sort((a, b) => b - a),
    [units],
  );

  // The tower the user is effectively inside: the selected tab, or the only
  // tower this building has. Drives the creator prefills and the delete scope.
  const towerCtx = useMemo(
    () => activeTower || (building && building.towers.length === 1 ? building.towers[0].tower : ""),
    [activeTower, building],
  );

  // Inside a building the project column is the building you are already in, and
  // the tower column repeats the tab you are on — both are noise that pushes the
  // flat number off the left of a narrow screen.
  const tableColumns = useMemo(
    () => COLUMNS.filter(c => c.key !== "project_name" && !(c.key === "tower" && !!towerCtx)),
    [towerCtx],
  );

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

  // Both refresh the building aggregate as well as the unit list — the header
  // statistics and the card counts come from the aggregate, so refreshing only
  // the rows would leave "126 units" on screen after 126 became 130.
  const afterCreate = () => { setSelected(new Set()); fetchUnits(); fetchBuildings(); };
  const afterDelete = () => { setSelected(new Set()); setDeleteTarget(null); setBulkDelOpen(false); setBldDelOpen(false); fetchUnits(); fetchBuildings(); };
  const selectedUnits = useMemo(() => sorted.filter(u => selected.has(u.id)), [sorted, selected]);

  // ── Heatmap grouping (floors desc, flats sorted within a floor) ──
  // ── Duplicate flat numbers ──
  // The unique index only stops a repeat within (project, tower, wing, floor),
  // so the same flat_no CAN legitimately end up on two floors or two wings of
  // one building — usually a numbering-pattern mistake, and always something
  // that makes a flat ambiguous to talk about on a call. Compared across the
  // units currently loaded, case- and space-insensitively, so "B-1204" and
  // "b-1204 " count as the same number.
  const duplicateFlats = useMemo(() => findDuplicateFlats(units), [units]);
  const isDuplicate = useCallback(
    (u: InventoryUnit) => isDuplicateFlat(u.flat_no, duplicateFlats),
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

  // ═════════════════════════════════════════════════════════════════════════
  // Level 1 — the building list. This screen answers "which buildings do I
  // have?", so it loads no unit rows at all.
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

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h1 className={`text-lg font-bold ${t.text}`}>Inventory</h1>
            <p className={`text-[11px] ${t.textMuted}`}>
              {bLoading ? "Loading…" : `${buildings.length} building${buildings.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Analytics is read-only, so it stays open to every role that can
                see inventory — unlike Pricing and Offers, which change commercials. */}
            <button onClick={() => setShowAnalytics(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${t.tableBorder} ${t.text} hover:border-[#00AEEF]`}>
              <FaChartBar className="text-[10px] text-[#00AEEF]" /> Analytics
            </button>
            {canManage && (
              <button onClick={() => setShowAddBuilding(true)}
                className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">
                <FaPlus className="text-[10px]" /> Add Building
              </button>
            )}
          </div>
        </div>

        {/* ── Building filters ── */}
        <div className={`flex items-center gap-2 flex-wrap mb-3 p-2.5 rounded-xl border ${t.innerBlock}`}>
          <input value={bFilters.search} onChange={e => setBFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Search buildings…" className={`${inputCls} w-56`} />
          <select value={bFilters.project} onChange={e => setBFilters(f => ({ ...f, project: e.target.value }))} className={`${selectCls} w-40`}>
            <option value="">All projects</option>
            {buildings.map(b => <option key={b.key} value={b.key}>{b.project_name}</option>)}
          </select>
          <select value={bFilters.tower} onChange={e => setBFilters(f => ({ ...f, tower: e.target.value }))} className={`${selectCls} w-32`}>
            <option value="">All towers</option>
            {towerNames.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={bFilters.status} onChange={e => setBFilters(f => ({ ...f, status: e.target.value }))} className={`${selectCls} w-40`}>
            <option value="">Any stock</option>
            {BUILDING_STATUS_FILTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {anyBFilter && (
            <button onClick={() => setBFilters({ search: "", project: "", tower: "", status: "" })}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded-lg ${t.textMuted} hover:text-red-500`}>Clear</button>
          )}
        </div>

        {/* ── Building cards ── */}
        <div className="flex-1 overflow-auto p-1">
          {bLoading && buildings.length === 0 ? (
            <p className={`text-sm italic ${t.textFaint} p-4`}>Loading buildings…</p>
          ) : visible.length === 0 ? (
            <p className={`text-sm italic ${t.textFaint} p-4`}>
              {buildings.length === 0
                ? `No buildings yet. ${canManage ? "Use Add Building to create one, then generate its inventory." : ""}`
                : "No buildings match these filters."}
            </p>
          ) : (
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {visible.map(b => (
                <BuildingCard key={b.key} b={b} t={t} onOpen={() => openBuilding(b)} />
              ))}
            </div>
          )}
        </div>

        <InventoryAnalyticsModal isOpen={showAnalytics} onClose={() => setShowAnalytics(false)} isDark={isDark} t={t} />
        {canManage && showAddBuilding && (
          <AddBuildingModal isDark={isDark} t={t} onClose={() => setShowAddBuilding(false)}
            onCreated={() => { setShowAddBuilding(false); fetchBuildings(); }} />
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Breadcrumb + back ── */}
      <button onClick={backToList}
        className={`self-start flex items-center gap-1.5 mb-2 text-[11px] font-semibold ${t.textMuted} hover:text-[#00AEEF]`}>
        <FaArrowLeft className="text-[9px]" /> Back to Inventory
      </button>

      {/* ── Building header ── */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <h1 className={`text-lg font-bold flex items-center gap-2 ${t.text}`}>
            <FaBuilding className="text-[#00AEEF] text-sm" /> {building.project_name}
          </h1>
          <p className={`text-[11px] ${t.textMuted}`}>
            {scopeLabel} · {n0(scope?.floors)} floor{n0(scope?.floors) === 1 ? "" : "s"} · {n0(scope?.total)} unit{n0(scope?.total) === 1 ? "" : "s"}
            {total > units.length ? ` · showing ${units.length} of ${total} matching` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center rounded-3xl border overflow-hidden ${t.tableBorder}`}>
            <button onClick={() => setViewMode("grid")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${viewMode === "grid" ? "bg-[#00AEEF] text-white" : `${t.textMuted}`}`}><FaThLarge className="text-[10px]" /> Floors</button>
            <button onClick={() => setViewMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${viewMode === "table" ? "bg-[#00AEEF] text-white" : `${t.textMuted}`}`}><FaTable className="text-[10px]" /> Table</button>
          </div>

          {/* Add Unit menu (managers only) — scoped to THIS building. */}
          {canManage && (
            <div className="relative">
              <button onClick={() => setAddMenu(v => !v)} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">
                <FaPlus className="text-[10px]" /> Add Unit <FaChevronDown className="text-[8px]" />
              </button>
              {addMenu && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setAddMenu(false)} />
                  <div className={`absolute right-0 mt-1 w-56 rounded-xl border shadow-xl z-[61] overflow-hidden ${t.modalCard}`}>
                    <button onClick={() => { setAddMenu(false); setShowAdd(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 ${t.text}`}><FaPen className="text-[10px] text-[#00AEEF]" /> Add single unit</button>
                    <button onClick={() => { setAddMenu(false); setShowBulk(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 border-t ${t.tableBorder} ${t.text}`}><FaLayerGroup className="text-[10px] text-[#00AEEF]" /> Generate whole building</button>
                  </div>
                </>
              )}
            </div>
          )}

          {canManage && (
            <button onClick={() => setShowPricing(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${t.tableBorder} ${t.text} hover:border-[#00AEEF]`}>
              <FaTags className="text-[10px] text-[#00AEEF]" /> Pricing
            </button>
          )}
          {canManage && (
            <button onClick={() => setShowOffers(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${t.tableBorder} ${t.text} hover:border-[#00AEEF]`}>
              <FaHandshake className="text-[10px] text-[#00AEEF]" /> Offers
            </button>
          )}
          <button onClick={() => setShowAnalytics(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${t.tableBorder} ${t.text} hover:border-[#00AEEF]`}>
            <FaChartBar className="text-[10px] text-[#00AEEF]" /> Analytics
          </button>

          {/* Building-scoped action menu. Whole-building delete lives in here —
              never as a standing button on the list screen. */}
          <div className="relative">
            <button onClick={() => setBldMenu(v => !v)} title="Building actions"
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${t.tableBorder} ${t.text} hover:border-[#00AEEF]`}>⋯</button>
            {bldMenu && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setBldMenu(false)} />
                <div className={`absolute right-0 mt-1 w-56 rounded-xl border shadow-xl z-[61] overflow-hidden ${t.modalCard}`}>
                  {canManage && (
                    <button onClick={() => { setBldMenu(false); setShowBulk(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 ${t.text}`}><FaLayerGroup className="text-[10px] text-[#00AEEF]" /> Generate inventory</button>
                  )}
                  {canManage && (
                    <button onClick={() => { setBldMenu(false); setShowPricing(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 border-t ${t.tableBorder} ${t.text}`}><FaTags className="text-[10px] text-[#00AEEF]" /> Pricing</button>
                  )}
                  {canManage && (
                    <button onClick={() => { setBldMenu(false); setShowOffers(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 border-t ${t.tableBorder} ${t.text}`}><FaHandshake className="text-[10px] text-[#00AEEF]" /> Offers</button>
                  )}
                  <button onClick={() => { setBldMenu(false); setShowAnalytics(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-left hover:bg-[#00AEEF]/10 border-t ${t.tableBorder} ${t.text}`}><FaChartBar className="text-[10px] text-[#00AEEF]" /> Analytics</button>
                  {isAdminUser && (
                    <button onClick={() => { setBldMenu(false); setBldDelOpen(true); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-left text-red-500 hover:bg-red-500/10 border-t ${t.tableBorder}`}><FaTrash className="text-[10px]" /> Delete building</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Building statistics (from the aggregate, never the capped row list) ── */}
      <div className={`flex items-center gap-2 flex-wrap mb-3 p-3 rounded-xl border ${t.innerBlock}`}>
        <Stat label="Total Units" value={n0(scope?.total)} t={t} />
        <Stat label="Available" value={n0(scope?.available)} t={t} hex={STATUS.available.hex} />
        <Stat label="Booked" value={n0(scope?.booked)} t={t} hex={STATUS.booked.hex} />
        <Stat label="On Hold" value={n0(scope?.on_hold)} t={t} hex={STATUS.on_hold.hex} />
        <Stat label="Blocked" value={n0(scope?.blocked)} t={t} hex={STATUS.blocked.hex} />
        {typeChips.length > 0 && (
          <div className={`flex items-center gap-1.5 flex-wrap pl-3 ml-1 border-l ${t.tableBorder}`}>
            {typeChips.map(c => (
              <span key={c.unit_type} className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${t.tableBorder} ${t.textMuted}`}>
                {c.unit_type}: <b className={t.text}>{c.units}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Tower tabs (only when the building actually has more than one) ── */}
      {building.towers.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <button onClick={() => setActiveTower("")}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold border ${activeTower === "" ? "bg-[#00AEEF] text-white border-[#00AEEF]" : `${t.tableBorder} ${t.textMuted}`}`}>
            All towers
          </button>
          {building.towers.map(x => (
            <button key={x.tower} onClick={() => setActiveTower(x.tower)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold border ${activeTower === x.tower ? "bg-[#00AEEF] text-white border-[#00AEEF]" : `${t.tableBorder} ${t.textMuted}`}`}>
              Tower {x.tower} <span className="opacity-70">({x.total})</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Filters — scoped to this building; no project/tower retyping ── */}
      <div className={`flex items-center gap-2 flex-wrap mb-3 p-2.5 rounded-xl border ${t.innerBlock}`}>
        <input value={filters.search} onChange={e => setFilter({ search: e.target.value })} placeholder="Search flat…" className={`${inputCls} w-48`} />
        <select value={filters.floor} onChange={e => setFilter({ floor: e.target.value })} className={`${selectCls} w-32`}>
          <option value="">All floors</option>
          {floorOptions.map(f => <option key={f} value={String(f)}>{floorLabel(f)}</option>)}
        </select>
        <input value={filters.wing} onChange={e => setFilter({ wing: e.target.value })} placeholder="Wing" className={`${inputCls} w-20`} />
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

      {/* Duplicate flat numbers — surfaced as a count so the red cells below are
          explained rather than just alarming. */}
      {duplicateCount > 0 && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5">
          <FaExclamationTriangle className="text-red-500 text-[11px] flex-shrink-0" />
          <span className={`text-[11px] ${t.text}`}>
            <b>{duplicateCount}</b> unit{duplicateCount === 1 ? " uses a" : "s use"} duplicate flat number
            {duplicateFlats.size === 1 ? "" : "s"} — highlighted in red below.
          </span>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto rounded-3xl p-3">
        {loading && units.length === 0 ? (
          <p className={`text-sm italic ${t.textFaint} p-4`}>Loading inventory…</p>
        ) : units.length === 0 ? (
          <p className={`text-sm italic ${t.textFaint} p-4`}>
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
          <GridView floorsGrouped={floorsGrouped} t={t} onCellClick={(id) => setDrawerId(id)} isDuplicate={isDuplicate} isDark={isDark} />
        )}

        {units.length > 0 && total > units.length && (
          <div className="flex justify-center mt-3">
            <button onClick={loadMore} disabled={loadingMore}
              className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.text} hover:border-[#00AEEF] disabled:opacity-50`}>
              {loadingMore ? "Loading…" : `Load more (${total - units.length} left)`}
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {/* Both creators are launched from inside a building, so the building is
          prefilled — the user never re-picks the project they are already in. */}
      {canManage && (
        <AddUnitModal isOpen={showAdd} onClose={() => setShowAdd(false)} onCreated={afterCreate} user={user} isDark={isDark} t={t}
          existingUnits={units.map(u => ({ project_name: u.project_name, tower: u.tower, wing: u.wing, floor: u.floor, flat_no: u.flat_no }))}
          defaults={{ project_name: building.project_name, tower: towerCtx }} />
      )}
      {canManage && (
        <BulkGenerateUnitsModal isOpen={showBulk} onClose={() => setShowBulk(false)} onCreated={afterCreate} user={user} isDark={isDark} t={t}
          defaults={{ project_name: building.project_name, tower: towerCtx }} />
      )}
      {canManage && (
        <PricingRulesModal isOpen={showPricing} onClose={() => setShowPricing(false)} user={user} isDark={isDark} t={t} />
      )}
      {canManage && (
        <OffersModal isOpen={showOffers} onClose={() => setShowOffers(false)} user={user} isDark={isDark} t={t} onChanged={fetchUnits} />
      )}
      <InventoryAnalyticsModal isOpen={showAnalytics} onClose={() => setShowAnalytics(false)} isDark={isDark} t={t} />

      {/* ── Delete modals (admin only) ── */}
      {isAdminUser && deleteTarget && (
        <DeleteUnitModal unit={deleteTarget} user={user} isDark={isDark} t={t} onClose={() => setDeleteTarget(null)} onDeleted={afterDelete} />
      )}
      {isAdminUser && bulkDelOpen && (
        <BulkDeleteModal selectedUnits={selectedUnits} user={user} isDark={isDark} t={t} onClose={() => setBulkDelOpen(false)} onDeleted={afterDelete} />
      )}
      {isAdminUser && bldDelOpen && (
        <BuildingDeleteModal user={user} isDark={isDark} t={t} onClose={() => setBldDelOpen(false)} onDeleted={afterDelete}
          defaults={{ project_name: building.project_name, tower: towerCtx, wing: filters.wing }}
          building={building} />
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
function TableView({ columns, colW, sort, sorted, t, allSelected, selected, toggleAll, toggleOne, toggleSort, onResizeStart, onRowClick, linkChip, canDelete, onDeleteUnit, isDuplicate, isDark }: any) {
  const totalW = 40 + columns.reduce((s: number, c: Column) => s + colW[c.key], 0) + (canDelete ? 56 : 0);
  const sortIcon = (key: string) => sort.key !== key ? <FaSort className="text-[8px] opacity-40" /> : sort.dir === "asc" ? <FaSortUp className="text-[8px]" /> : <FaSortDown className="text-[8px]" />;
  const cell = (u: InventoryUnit, key: string) => {
    // The flat number is the only cell that turns red: the status badge keeps
    // its own colour, because a duplicate says nothing about whether the flat is
    // available.
    if (key === "flat_no" && isDuplicate?.(u)) return (
      <span title={unitTooltip(u, true)} className="inline-flex items-center gap-1 font-bold text-red-500">
        <FaExclamationTriangle className="text-[9px] flex-shrink-0" />
        {u.flat_no}
      </span>
    );
    // Type gets the same ink as the grid; status keeps its own badge. The two
    // columns read as two systems because they are two systems.
    if (key === "unit_type") return <UnitTypeChip unitType={u.unit_type} isDark={isDark} />;
    if (key === "status") return <StatusBadge status={u.status} />;
    if (key === "linked") return linkChip(u);
    if (key === "carpet_area_sqft") return area(u.carpet_area_sqft);
    if (key === "source") return <span className={`text-[10px] ${t.textMuted}`}>{String(u.source || "").replace("_", " ")}</span>;
    const v = (u as any)[key];
    return v === null || v === undefined || v === "" ? <span className={t.textFaint}>—</span> : String(v);
  };
  return (
    <div className={`rounded-3xl border ${t.tableBorder} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table
          style={{ tableLayout: "fixed", width: totalW, minWidth: "100%" }}
          className="text-left border-collapse"
        >
          <colgroup>
            <col style={{ width: 40 }} />
            {columns.map((c: Column) => <col key={c.key} style={{ width: colW[c.key] }} />)}
            {canDelete && <col style={{ width: 56 }} />}
          </colgroup>
          <thead>
            <tr className={`${t.tableHead}`}>
              <th className="px-2 py-2 top-0">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="cursor-pointer accent-[#00AEEF]"
                />
              </th>
              {columns.map((c: Column) => (
                <th
                  key={c.key}
                  className={`relative px-2 py-2 text-[10px] font-bold uppercase tracking-wider ${t.textMuted} select-none`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className={`flex items-center gap-1 ${c.sortable ? "cursor-pointer hover:text-[#00AEEF]" : "cursor-default"}`}
                  >
                    <span className="truncate">{c.label}</span>
                    {c.sortable && sortIcon(c.key)}
                  </button>
                  <span
                    onMouseDown={e => onResizeStart(e, c.key)}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-[#00AEEF]/40"
                  />
                </th>
              ))}
              {canDelete && (
                <th className={`px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-right ${t.textMuted}`}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((u: InventoryUnit) => (
              <tr
                key={u.id}
                onClick={() => onRowClick(u.id)}
                title={isDuplicate?.(u) ? "Duplicate flat number" : undefined}
                className={`border-t ${t.tableBorder} ${t.tableRow} cursor-pointer ${
                  isDuplicate?.(u) ? "bg-red-500/5" : selected.has(u.id) ? "bg-[#00AEEF]/5" : ""
                }`}
              >
                <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggleOne(u.id)}
                    className="cursor-pointer accent-[#00AEEF]"
                  />
                </td>
                {columns.map((c: Column) => (
                  <td key={c.key} className={`px-2 py-1.5 text-xs truncate ${t.text}`}>
                    {cell(u, c.key)}
                  </td>
                ))}
                {canDelete && (
                  <td className="px-2 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                    {isBookingProtected(u) ? (
                      // Hard-locked: unit is tied to a booking and cannot be deleted.
                      <span
                        title={`Locked — this unit is linked to a booking and cannot be deleted.`}
                        className="inline-flex items-center justify-center p-1.5 rounded text-gray-400 cursor-not-allowed"
                      >
                        <FaLock className="text-[11px]" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onDeleteUnit(u)}
                        title={isLinkedActive(u) ? `Delete — warning: ${linkLabel(u)}` : "Delete unit"}
                        className="p-1.5 rounded text-red-500 hover:bg-red-500/10"
                      >
                        <FaTrash className="text-[11px]" />
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
// Three pieces of information, three channels that cannot mask each other:
//   fill + type label ink → what the flat IS   (unit type)
//   dot, top-right       → what the flat is DOING (status)
//   red frame + ⚠        → the flat number is ambiguous (duplicate)
// The duplicate frame outranks the type fill, but takes neither the type label
// nor the status dot with it — a duplicate that hides the booking is worse than
// the duplicate.
function UnitCell({ u, t, isDark, duplicate, onClick }: { u: InventoryUnit; t: any; isDark: boolean; duplicate: boolean; onClick: () => void }) {
  const type = getUnitTypeColor(u.unit_type, isDark);
  const status = sc(u.status);
  return (
    <button
      type="button"
      onClick={onClick}
      title={unitTooltip(u, duplicate)}
      className="relative w-[68px] h-[52px] rounded-lg flex flex-col items-center justify-center leading-tight transition-transform hover:scale-105"
      style={{
        backgroundColor: duplicate ? `${DUPLICATE_HEX}14` : type.fill,
        border: duplicate ? `1.5px solid ${DUPLICATE_HEX}` : `1px solid ${type.border}`,
      }}
    >
      {duplicate && (
        <FaExclamationTriangle className="absolute top-1 left-1 text-[8px] text-red-500" aria-hidden />
      )}
      {/* Status stays legible on a duplicate — it is a separate channel. */}
      <span
        className="absolute top-1 right-1 w-[7px] h-[7px] rounded-full"
        style={{ backgroundColor: status.hex }}
        title={status.label}
      />
      <span className={`text-[11px] font-bold ${duplicate ? "text-red-500" : t.text}`}>{u.flat_no}</span>
      <span className="text-[9px] font-bold" style={{ color: type.ink }}>{type.label}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Grid / heatmap view
// ═══════════════════════════════════════════════════════════════════════════
function GridView({ floorsGrouped, t, onCellClick, isDuplicate, isDark }: { floorsGrouped: [number, InventoryUnit[]][]; t: any; onCellClick: (id: number) => void; isDuplicate?: (u: InventoryUnit) => boolean; isDark: boolean }) {
  const anyDuplicate = floorsGrouped.some(([, us]) => us.some(u => isDuplicate?.(u)));
  // Only the types actually standing in this building — a legend listing every
  // configuration the system knows about would be longer than most towers' stock.
  const typesPresent = [...new Set(floorsGrouped.flatMap(([, us]) => us.map(u => u.unit_type)))]
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

  return (
    <div>
      {/* ── Legend: two independent channels, plus the override ── */}
      <div className={`flex items-start gap-x-6 gap-y-2 flex-wrap mb-3 pb-3 border-b ${t.tableBorder}`}>
        {typesPresent.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] font-bold uppercase tracking-widest ${t.textFaint}`}>Unit types</span>
            {typesPresent.map(ut => {
              const c = getUnitTypeColor(ut, isDark);
              return (
                <span key={ut} className="inline-flex items-center gap-1.5 text-[10px]">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: c.fill, border: `1px solid ${c.ink}` }} />
                  <span className={t.textMuted}>{ut}</span>
                </span>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[9px] font-bold uppercase tracking-widest ${t.textFaint}`}>Status</span>
          {STATUS_KEYS.map(s => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[10px]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS[s].hex }} />
              <span className={t.textMuted}>{STATUS[s].label}</span>
            </span>
          ))}
        </div>
        {anyDuplicate && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] font-bold uppercase tracking-widest ${t.textFaint}`}>Special</span>
            <span className="inline-flex items-center gap-1.5 text-[10px]">
              <span className="w-3 h-3 rounded flex items-center justify-center" style={{ backgroundColor: DUPLICATE_HEX + "1A", border: `1.5px solid ${DUPLICATE_HEX}` }} />
              <span className="text-red-500 font-semibold">Duplicate flat number</span>
            </span>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {floorsGrouped.map(([floor, us]) => (
          <div key={floor} className="flex items-center gap-2">
            <div className={`w-14 flex-shrink-0 text-right text-[11px] font-bold ${t.textMuted}`}>{floor === 0 ? "Ground" : `Fl ${floor}`}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {us.map(u => (
                <UnitCell key={u.id} u={u} t={t} isDark={isDark}
                  duplicate={!!isDuplicate?.(u)} onClick={() => onCellClick(u.id)} />
              ))}
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
          className={`w-full ${maxW} rounded-4xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>
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

// ═══════════════════════════════════════════════════════════════════════════
// Add Building (Admin / Sales Manager)
// ═══════════════════════════════════════════════════════════════════════════
// Creates the project row — and optionally its first tower — through the
// existing hierarchy endpoints. No inventory is generated here: a building
// starts empty and its stock is generated from inside it, which is what keeps
// "add a building" and "generate 126 flats" two separate, reversible decisions.
function AddBuildingModal({ isDark, t, onClose, onCreated }: any) {
  const [name, setName] = useState("");
  const [tower, setTower] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border ${t.inputInner} ${t.text} ${t.inputFocus}`;

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
        // 409 = the case-insensitive unique index. Adding a tower to a building
        // that already exists is a reasonable thing to be doing, so resolve the
        // existing project rather than making the user go and find it.
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
        // A duplicate tower is not a failure of "add building" — the tower the
        // user asked for exists, which is the outcome they wanted.
        if (!tJson.success && tRes.status !== 409) throw new Error(tJson.message || "Building created, but the tower could not be added.");
      }
      onCreated();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <ModalShell isDark={isDark} onClose={onClose} maxW="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <FaBuilding className="text-[#00AEEF]" />
          <h2 className={`text-base font-bold ${t.text}`}>Add building</h2>
        </div>
        <div className="space-y-2.5 mb-3">
          <div>
            <label className={`text-[11px] mb-1 block ${t.textMuted}`}>Building / project name *</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="VR Buildcom" />
          </div>
          <div>
            <label className={`text-[11px] mb-1 block ${t.textMuted}`}>First tower (optional)</label>
            <input value={tower} onChange={e => setTower(e.target.value)} className={inputCls} placeholder="A" />
          </div>
          <div>
            <label className={`text-[11px] mb-1 block ${t.textMuted}`}>City (optional)</label>
            <input value={city} onChange={e => setCity(e.target.value)} className={inputCls} placeholder="Mumbai" />
          </div>
        </div>
        <p className={`text-[11px] mb-3 ${t.textFaint}`}>The building starts empty — open it and use Add Unit to generate its flats.</p>
        {err && <p className="text-red-500 text-[11px] mb-2">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
          <button onClick={submit} disabled={busy || !name.trim()} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-40">
            {busy ? "Creating…" : "Create building"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// Whole-building delete: scope inputs, live preview count (+ linked-blocked), type-to-confirm.
function BuildingDeleteModal({ user, isDark, t, onClose, onDeleted, defaults, building }: any) {
  const [scope, setScope] = useState({ project_name: defaults?.project_name || "", tower: defaults?.tower || "", wing: defaults?.wing || "" });
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
        <div className="flex items-center gap-2 mb-3">
          <FaBuilding className="text-red-500" />
          <h2 className={`text-base font-bold ${t.text}`}>
            {building ? `Delete ${building.project_name}?` : "Delete whole building / tower"}
          </h2>
        </div>
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
            {building && (
              <>
                <p className={`text-xs leading-relaxed mb-2 ${t.text}`}>
                  This building contains <b>{building.total}</b> inventory unit{building.total === 1 ? "" : "s"}. Deleting it may affect:
                </p>
                <ul className={`text-[11px] leading-relaxed mb-3 pl-4 list-disc ${t.textMuted}`}>
                  <li>Inventory records</li>
                  <li>Booking links</li>
                  <li>Pricing</li>
                  <li>Offers</li>
                  <li>Historical records</li>
                </ul>
              </>
            )}
            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <div>
                <label className={`text-[11px] mb-1 block ${t.textMuted}`}>Project *</label>
                {/* Locked when opened from inside a building — the scope is the
                    building you are in, not something to retype. */}
                <input value={scope.project_name} readOnly={!!building}
                  onChange={e => setScope(s => ({ ...s, project_name: e.target.value }))}
                  className={`${inputCls} ${building ? "opacity-70 cursor-not-allowed" : ""}`} />
              </div>
              <div>
                <label className={`text-[11px] mb-1 block ${t.textMuted}`}>Tower *</label>
                {/* The backend scopes a building delete by project + tower, so a
                    multi-tower project is deleted one tower at a time. */}
                {building?.towers?.length ? (
                  <select value={scope.tower} onChange={e => setScope(s => ({ ...s, tower: e.target.value }))} className={`${inputCls} cursor-pointer`}>
                    <option value="">Select a tower…</option>
                    {building.towers.map((x: TowerSummary) => (
                      <option key={x.tower} value={x.tower}>Tower {x.tower} ({x.total} units)</option>
                    ))}
                  </select>
                ) : (
                  <input value={scope.tower} onChange={e => setScope(s => ({ ...s, tower: e.target.value }))} className={inputCls} />
                )}
              </div>
              <div><label className={`text-[11px] mb-1 block ${t.textMuted}`}>Wing</label><input value={scope.wing} onChange={e => setScope(s => ({ ...s, wing: e.target.value }))} className={inputCls} placeholder="All wings" /></div>
            </div>
            {building && building.towers.length > 1 && (
              <p className={`text-[11px] mb-2 ${t.textFaint}`}>
                This project has {building.towers.length} towers. Deletion is scoped to one tower at a time.
              </p>
            )}
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
  // ── Hold with ownership (Sell.Do parity, gap 2) ──
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdHours, setHoldHours] = useState("48");
  const [holdReason, setHoldReason] = useState("");
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdErr, setHoldErr] = useState<string | null>(null);
  // ── Cost sheet (Sell.Do parity, gap 3) ──
  // `sheet` is a live PREVIEW recomputed server-side as the discount changes —
  // never computed in the browser, so the figure on screen is exactly what would
  // be persisted. `issued` is the saved history.
  const [sheet, setSheet] = useState<any | null>(null);
  const [issued, setIssued] = useState<any[]>([]);
  const [discount, setDiscount] = useState("");
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetErr, setSheetErr] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // ── Offer (Sell.Do parity, gap 4) ──
  const [offerPrice, setOfferPrice] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerMsg, setOfferMsg] = useState<string | null>(null);
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

  // Place / release a hold. Both go through the dedicated endpoint rather than a
  // plain status PATCH, because only that route records who holds it, for whom,
  // and until when — and enforces that only the owner or an Admin may release.
  const doHold = async () => {
    if (!unit) return;
    setHoldBusy(true); setHoldErr(null);
    try {
      const res = await fetch(`/api/inventory/${unit.id}/hold`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          hours: Number(holdHours),
          lead_id: unit.lead_id ?? null,
          reason: holdReason.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not hold this unit");
      setHoldOpen(false); setHoldReason(""); await load(); onChanged?.();
    } catch (e: any) { setHoldErr(e.message); } finally { setHoldBusy(false); }
  };

  const doRelease = async () => {
    if (!unit) return;
    setHoldBusy(true); setHoldErr(null);
    try {
      const res = await fetch(`/api/inventory/${unit.id}/hold`, {
        method: "DELETE", credentials: "include",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not release this hold");
      await load(); onChanged?.();
    } catch (e: any) { setHoldErr(e.message); } finally { setHoldBusy(false); }
  };

  // Preview is debounced and always server-computed. Doing the arithmetic in the
  // browser would risk the number shown differing from the number stored.
  const previewSheet = useCallback(async (discountAmount: string) => {
    if (!unit) return;
    setSheetBusy(true); setSheetErr(null);
    try {
      const res = await fetch(`/api/inventory/${unit.id}/cost-sheet`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ preview: true, discount_amount: discountAmount || 0 }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not build a cost sheet");
      setSheet(json.data);
    } catch (e: any) { setSheetErr(e.message); setSheet(null); } finally { setSheetBusy(false); }
  }, [unit]);

  const loadIssued = useCallback(async () => {
    if (!unit) return;
    try {
      const res = await fetch(`/api/inventory/${unit.id}/cost-sheet`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setIssued(json.data || []);
    } catch { /* history is supplementary — never block the panel on it */ }
  }, [unit]);

  useEffect(() => {
    if (!sheetOpen) return;
    const id = setTimeout(() => previewSheet(discount), 350);
    return () => clearTimeout(id);
  }, [sheetOpen, discount, previewSheet]);

  const issueSheet = async () => {
    if (!unit) return;
    setSheetBusy(true); setSheetErr(null);
    try {
      const res = await fetch(`/api/inventory/${unit.id}/cost-sheet`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          discount_amount: discount || 0,
          lead_id: unit.lead_id ?? null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not issue the cost sheet");
      await loadIssued();
    } catch (e: any) { setSheetErr(e.message); } finally { setSheetBusy(false); }
  };

  const money = (v: any) => `₹${Math.round(num(v)).toLocaleString("en-IN")}`;

  // The list price is the CURRENT sheet's total, so the discount the server bands
  // on is the one the agent is actually looking at. Deriving it from an older
  // issued sheet would band against a number nobody quoted.
  const raiseOffer = async () => {
    if (!unit || !sheet) return;
    setOfferBusy(true); setOfferMsg(null); setSheetErr(null);
    try {
      const res = await fetch("/api/inventory/offers", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          unit_id: unit.id,
          lead_id: unit.lead_id ?? null,
          project_id: unit.project_id ?? null,
          list_price: sheet.total_amount,
          offered_price: Number(offerPrice || 0),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not raise the offer");
      const o = json.data;
      setOfferMsg(
        o.status === "approved"
          ? "Offer recorded at list price — no approval needed."
          : `Sent for ${o.required_approver_role} approval (${o.discount_pct}% discount).`,
      );
      setOfferOpen(false); setOfferPrice("");
    } catch (e: any) { setSheetErr(e.message); } finally { setOfferBusy(false); }
  };

  const fmtWhen = (v: any) => {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
                      {isAdminUser && (
                        unit && isBookingProtected(unit) ? (
                          // Hard-locked: show a read-only badge, no delete action.
                          <span
                            title="Locked — this unit is linked to a booking and cannot be deleted."
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 cursor-not-allowed"
                          >
                            <FaLock className="text-[9px]" /> Locked
                          </span>
                        ) : (
                          <button onClick={() => onRequestDelete(unit)} className="text-[11px] font-semibold text-red-500 hover:underline flex items-center gap-1"><FaTrash className="text-[9px]" /> Delete</button>
                        )
                      )}
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

                  {/* ── Hold (Sell.Do parity, gap 2) ──
                      A hold used to be a status with an expiry and no owner, so the
                      grid could say "on hold" and nobody could say whose. */}
                  {unit.status === "on_hold" ? (
                    <div className={`rounded-xl border p-3 mb-3 ${isDark ? "border-amber-500/40 bg-amber-500/5" : "border-amber-500/40 bg-amber-50"}`}>
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-amber-500">On Hold</p>
                        {canManage && (
                          <button onClick={doRelease} disabled={holdBusy}
                            className="text-[11px] font-semibold text-red-500 hover:underline disabled:opacity-50">
                            {holdBusy ? "Releasing…" : "Release"}
                          </button>
                        )}
                      </div>
                      {row("Held by", unit.held_by || "—")}
                      {row("For lead", unit.held_for_lead_id ? `#${unit.held_for_lead_id}` : "—")}
                      {row("Expires", fmtWhen(unit.hold_expires_at))}
                      {unit.hold_reason && row("Reason", unit.hold_reason)}
                      {holdErr && <p className="text-red-500 text-[11px] mt-1">{holdErr}</p>}
                    </div>
                  ) : unit.status === "available" && canManage ? (
                    <div className="mb-3">
                      {holdOpen ? (
                        <div className={`rounded-xl border p-3 ${t.innerBlock}`}>
                          <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${t.textMuted}`}>Place a hold</p>
                          <div className="flex gap-2 mb-2">
                            <div className="flex-1">
                              <label className={`text-[10px] block mb-1 ${t.textMuted}`}>Hours</label>
                              <select value={holdHours} onChange={e => setHoldHours(e.target.value)}
                                className={`w-full rounded-lg px-2.5 py-1.5 text-xs border cursor-pointer ${t.inputInner} ${t.text} ${t.inputFocus}`}>
                                {["24", "48", "72", "168"].map(h => (
                                  <option key={h} value={h}>{Number(h) >= 168 ? "7 days" : `${h} hours`}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-[2]">
                              <label className={`text-[10px] block mb-1 ${t.textMuted}`}>Reason (optional)</label>
                              <input value={holdReason} onChange={e => setHoldReason(e.target.value)}
                                placeholder="Token expected Friday"
                                className={`w-full rounded-lg px-2.5 py-1.5 text-xs border ${t.inputInner} ${t.text} ${t.inputFocus}`} />
                            </div>
                          </div>
                          {unit.lead_id && (
                            <p className={`text-[10px] mb-2 ${t.textFaint}`}>Will be held for lead #{unit.lead_id}.</p>
                          )}
                          {holdErr && <p className="text-red-500 text-[11px] mb-2">{holdErr}</p>}
                          <div className="flex gap-2">
                            <button onClick={doHold} disabled={holdBusy}
                              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
                              {holdBusy ? "Holding…" : "Hold Unit"}
                            </button>
                            <button onClick={() => { setHoldOpen(false); setHoldErr(null); }}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setHoldOpen(true); setHoldErr(null); }}
                          className="text-[11px] font-semibold text-amber-500 hover:underline flex items-center gap-1">
                          <FaLock className="text-[9px]" /> Hold this unit
                        </button>
                      )}
                    </div>
                  ) : null}

                  {/* Details */}
                  <div className={`rounded-xl border p-3 mb-3 ${t.innerBlock}`}>
                    {row("Type", unit.unit_type)}
                    {row("Carpet area", `${area(unit.carpet_area_sqft)} sqft`)}
                    {num(unit.built_up_area_sqft) ? row("Built-up area", `${area(unit.built_up_area_sqft)} sqft`) : null}
                    {unit.facing ? row("Facing", unit.facing) : null}
                    {num(unit.rate_per_sqft) ? row("Rate / sqft", formatCurrencyDisplay(unit.rate_per_sqft)) : null}
                    {num(unit.base_price) ? row("Base price", formatCurrencyDisplay(unit.base_price)) : null}
                    {row("Source", String(unit.source || "").replace("_", " "))}
                    {unit.is_corner ? row("Corner unit", "Yes") : null}
                    {unit.is_park_facing ? row("Park facing", "Yes") : null}
                    {num(unit.parking_slots) ? row("Parking slots", String(unit.parking_slots)) : null}
                  </div>

                  {/* ── Cost sheet (Sell.Do parity, gap 3) ──
                      Every component is shown, not just the total: a cost sheet that
                      cannot show its own arithmetic is useless in a negotiation. */}
                  {canManage && (
                    <div className={`rounded-xl border p-3 mb-3 ${t.innerBlock}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>Cost Sheet</p>
                        <button
                          onClick={() => { const next = !sheetOpen; setSheetOpen(next); if (next) loadIssued(); }}
                          className="text-[11px] font-semibold text-[#00AEEF] hover:underline"
                        >
                          {sheetOpen ? "Hide" : "Build"}
                        </button>
                      </div>

                      {sheetOpen && (
                        <>
                          <div className="mb-2">
                            <label className={`text-[10px] block mb-1 ${t.textMuted}`}>Discount (₹)</label>
                            <input
                              value={discount}
                              onChange={e => setDiscount(e.target.value.replace(/[^\d]/g, ""))}
                              placeholder="0"
                              className={`w-full rounded-lg px-2.5 py-1.5 text-xs border ${t.inputInner} ${t.text} ${t.inputFocus}`}
                            />
                          </div>

                          {sheetErr && <p className="text-red-500 text-[11px] mb-2">{sheetErr}</p>}
                          {sheetBusy && !sheet && <p className={`text-[11px] italic ${t.textFaint}`}>Calculating…</p>}

                          {sheet && (
                            <>
                              <div className={`rounded-lg border p-2.5 mb-2 ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                                {(sheet.lines || []).map((l: any) => {
                                  const strong = l.key === "agreement_value" || l.key === "total";
                                  return (
                                    <div key={l.key}
                                      className={`flex justify-between gap-3 py-1 ${strong ? `border-t mt-1 pt-1.5 ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}` : ""}`}>
                                      <div className="min-w-0">
                                        <span className={`text-[11px] ${strong ? `font-bold ${t.text}` : t.textMuted}`}>{l.label}</span>
                                        {l.detail && <span className={`block text-[9px] ${t.textFaint}`}>{l.detail}</span>}
                                      </div>
                                      <span className={`text-xs whitespace-nowrap ${l.amount < 0 ? "text-red-500 font-semibold"
                                        : strong ? `font-bold ${t.text}` : `font-semibold ${t.text}`}`}>
                                        {l.amount < 0 ? `− ${money(Math.abs(l.amount))}` : money(l.amount)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="flex gap-2 flex-wrap">
                                <button onClick={issueSheet} disabled={sheetBusy}
                                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-50">
                                  {sheetBusy ? "Working…" : "Issue Cost Sheet"}
                                </button>
                                {!unit.booking_id && (
                                  <button onClick={() => { setOfferOpen(v => !v); setOfferMsg(null); setOfferPrice(String(Math.round(num(sheet.total_amount)))); }}
                                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${t.tableBorder} ${t.text}`}>
                                    Raise Offer
                                  </button>
                                )}
                              </div>
                              <p className={`text-[9px] mt-1 ${t.textFaint}`}>
                                Issuing saves a numbered version and supersedes the previous one.
                              </p>

                              {offerOpen && (
                                <div className={`mt-2 rounded-lg border p-2.5 ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                                  <label className={`text-[10px] block mb-1 ${t.textMuted}`}>Offered price (₹)</label>
                                  <input value={offerPrice} onChange={e => setOfferPrice(e.target.value.replace(/[^\d]/g, ""))}
                                    className={`w-full rounded-lg px-2.5 py-1.5 text-xs border mb-1 ${t.inputInner} ${t.text} ${t.inputFocus}`} />
                                  <p className={`text-[9px] mb-2 ${t.textFaint}`}>
                                    List price {money(sheet.total_amount)}. A discount routes to whichever
                                    approval band it falls in; you cannot approve your own request.
                                  </p>
                                  <button onClick={raiseOffer} disabled={offerBusy || !offerPrice}
                                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
                                    {offerBusy ? "Sending…" : "Send Offer"}
                                  </button>
                                </div>
                              )}

                              {offerMsg && <p className="text-emerald-500 text-[11px] mt-2">{offerMsg}</p>}
                            </>
                          )}

                          {issued.length > 0 && (
                            <div className={`mt-3 pt-2 border-t ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                              <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${t.textMuted}`}>Issued</p>
                              {issued.map((s: any) => (
                                <div key={s.id} className="flex justify-between gap-3 py-1">
                                  <span className={`text-[11px] ${t.textMuted}`}>
                                    v{s.version} · {fmtWhen(s.created_at)}
                                    {s.status !== "issued" && <span className={t.textFaint}> · {s.status}</span>}
                                  </span>
                                  <span className={`text-xs font-semibold ${t.text}`}>{money(s.total_amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

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
