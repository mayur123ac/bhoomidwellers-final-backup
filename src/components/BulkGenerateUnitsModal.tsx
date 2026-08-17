"use client";
// BulkGenerateUnitsModal.tsx — Inventory Phase 3, reworked in Phase 9 around a
// repeating FLAT-POSITION PATTERN.
//
// THE IDEA
// A tower is not a list of 48 independently-configured flats; it is one floor
// plan repeated N times. So the user configures each POSITION on a floor once —
// position 01 is a 2 BHK of 650 sqft, position 04 is a 1 BHK of 450 — and the
// generator repeats that plan down every floor. The old form asked for a single
// "default unit type" for the whole building, which meant a building with a 1 BHK
// in the corner had to be fixed by hand in 12 preview rows.
//
// The pattern is the source of truth, held as `positions[]` + `num_floors`. The
// 48 rows are DERIVED from it (see buildRows) — never edited into existence one
// by one — so changing position 01 changes 101/201/301/… together, by
// construction rather than by a bulk edit.
//
// Steps: 1 config (pattern editor + live matrix preview) → 2 preview (matrix +
// editable row table, one last chance to drop refuge floors) → 3 done.
//
// The commit still POSTs a flat units[] array to /api/inventory/bulk-generate,
// unchanged — that route already accepts every per-unit field a position carries,
// so the pattern is expanded here and the backend is untouched.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaTimes, FaTrash, FaLayerGroup, FaArrowLeft, FaCheckCircle, FaPlus,
  FaChevronDown, FaChevronRight, FaExclamationTriangle, FaTable, FaThLarge,
} from "react-icons/fa";
import ProjectTowerPicker from "./ProjectTowerPicker";

const STATUS_OPTS: { label: string; value: string }[] = [
  { label: "Available", value: "available" },
  { label: "Blocked", value: "blocked" },
  { label: "Refuge Area", value: "refuge_area" },
  { label: "Unfinished", value: "unfinished" },
];
const UNIT_TYPE_OPTS = ["1 RK", "1BHK", "1.5BHK", "2BHK", "2.5BHK", "3BHK", "3.5BHK", "4BHK", "Penthouse", "Shop", "Office", "Other"];
const MAX_UNITS = 2000;
const MAX_POSITIONS = 99;

// Token-based flat numbering. Indian builders number flats many ways, so the scheme
// is a pattern of tokens the user picks/edits rather than one hardcoded format:
//   {WING}      wing code — omitted (with its trailing separator) when the tower has no wing
//   {FLOOR}     floor number, no padding      {FLOOR:02}  floor, zero-padded to 2 digits
//   {UNIT}      unit index, no padding        {UNIT:02}   unit index, zero-padded to 2 digits
//
// {UNIT} is the POSITION number — position 01 on floor 12 is 1201. There is
// deliberately no second numbering algorithm for the pattern feature.
const NUMBERING_PRESETS: { pattern: string; example: string }[] = [
  { pattern: "{FLOOR}{UNIT:02}", example: "104 / 1204" },
  { pattern: "{WING}{FLOOR}{UNIT:02}", example: "B1204" },
  { pattern: "{WING}-{FLOOR:02}{UNIT:02}", example: "B-1204" },
  { pattern: "{FLOOR:02}{UNIT:02}", example: "0104 / 1204" },
  { pattern: "{FLOOR}{UNIT}", example: "124" },
];

// How floor 0 (ground) renders in the {FLOOR} tokens.
const GROUND_MODES: { value: string; label: string; hint: string }[] = [
  { value: "zero", label: "00", hint: "floor 0 → 00 / 0" },
  { value: "letter", label: "G", hint: "floor 0 → G" },
  { value: "exclude", label: "Exclude", hint: "floor 0 → no floor digits" },
];

// Render one flat number from a token pattern.
function renderFlatNo(pattern: string, opts: { wing: string; floor: number; unit: number; groundMode: string }): string {
  const { wing, floor, unit, groundMode } = opts;
  let s = pattern;

  // {WING} → the code, or removed together with any trailing separator (non-alphanumeric,
  // non-brace chars) when the tower has no wing — so "{WING}-101" becomes "101", not "-101".
  const w = (wing || "").trim();
  s = w ? s.replace(/\{WING\}/g, w) : s.replace(/\{WING\}[^A-Za-z0-9{]*/g, "");

  // {FLOOR} / {FLOOR:02} — floor 0 honours the ground-floor mode; all other floors are numeric.
  const floorText = (pad: boolean) => {
    if (floor === 0) {
      if (groundMode === "letter") return "G";
      if (groundMode === "exclude") return "";
    }
    const base = String(floor);
    return pad ? base.padStart(2, "0") : base;
  };
  s = s.replace(/\{FLOOR:02\}/g, floorText(true)).replace(/\{FLOOR\}/g, floorText(false));

  // {UNIT} / {UNIT:02}
  s = s.replace(/\{UNIT:02\}/g, String(unit).padStart(2, "0")).replace(/\{UNIT\}/g, String(unit));

  return s;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;                 // fired after a successful commit (parent refresh)
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
  /**
   * Prefill for the building the generator was launched from. Launching from
   * inside a building already answers "which project / tower", so re-asking
   * would be the one place the new hierarchy leaks back into a flat form.
   * The fields stay editable — this is a default, not a lock.
   */
  defaults?: Partial<Record<"project_name" | "tower" | "wing", string>>;
}

/** One flat position on a floor. Everything here repeats on every floor. */
interface Position {
  key: string;
  position: string;              // "1".."99" — rendered zero-padded, stored raw
  unit_type: string;
  carpet_area_sqft: string;
  built_up_area_sqft: string;
  rate_per_sqft: string;
  base_price: string;
  facing: string;
  parking_slots: string;
  is_corner: boolean;
  is_park_facing: boolean;
}

/** A generated flat — derived from (floor × position), never hand-authored. */
interface Row {
  key: string;
  posKey: string;                // which position this flat inherits
  position: string;
  floor: number;
  flat_no: string;
  unit_type: string;
  carpet_area_sqft: string;
  built_up_area_sqft: string;
  rate_per_sqft: string;
  base_price: string;
  facing: string;
  parking_slots: string;
  is_corner: boolean;
  is_park_facing: boolean;
  status: string;
  exists?: boolean;              // already in the DB — the backend will skip it
}

let posSeq = 0;
const newPosition = (position: string, unit_type = "2BHK"): Position => ({
  key: `p${++posSeq}`,
  position, unit_type,
  carpet_area_sqft: "", built_up_area_sqft: "", rate_per_sqft: "", base_price: "",
  facing: "", parking_slots: "", is_corner: false, is_park_facing: false,
});

const pad2 = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(n).padStart(2, "0") : String(v || "");
};

// apartment_name intentionally absent — dropped from the booking form, so
// inventory drops it too. See AddUnitModal for the same note.
// unit_type / carpet live on the POSITIONS now, not here: a building-wide
// default is exactly what this rework removes.
const blankConfig = {
  project_name: "", tower: "", wing: "",
  num_floors: "", start_floor: "1",
  numbering_preset: NUMBERING_PRESETS[0].pattern, custom_pattern: "", ground_floor_mode: "zero",
  default_status: "available",
};

export default function BulkGenerateUnitsModal({ isOpen, onClose, onCreated, user, isDark, t, defaults }: Props) {
  const [step, setStep] = useState<"config" | "preview" | "done">("config");
  const [config, setConfig] = useState({ ...blankConfig, ...defaults });
  const [positions, setPositions] = useState<Position[]>(() => [newPosition("1"), newPosition("2")]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmedEdit, setConfirmedEdit] = useState<Set<string>>(new Set());
  const [pendingEdit, setPendingEdit] = useState<Position | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Position | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [previewMode, setPreviewMode] = useState<"matrix" | "table">("matrix");
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ created: number; skipped: number; total: number; skipped_details: { flat_no: string; reason: string }[] } | null>(null);

  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase());

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const cellCls = `w-full rounded-md px-2 py-1 text-xs outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  const setC = (patch: Partial<typeof blankConfig>) => { setConfig(c => ({ ...c, ...patch })); setError(null); };

  const numFloors = Math.max(0, Number(config.num_floors) || 0);
  const startFloor = Number(config.start_floor);
  const pattern = (config.numbering_preset === "custom" ? config.custom_pattern : config.numbering_preset).trim();

  // ── Pattern summary (§10) — every figure derived, none hardcoded ──
  const totalUnits = numFloors * positions.length;
  const typeSummary = useMemo(() => {
    const perFloor = positions.reduce<Record<string, number>>((acc, p) => {
      acc[p.unit_type] = (acc[p.unit_type] || 0) + 1; return acc;
    }, {});
    return Object.entries(perFloor)
      .map(([unit_type, perFloorCount]) => ({ unit_type, perFloorCount, units: perFloorCount * numFloors }))
      .sort((a, b) => b.units - a.units);
  }, [positions, numFloors]);

  // ── The expansion: pattern → flats. One place, used by both the live preview
  // and the committed rows, so what you review is what gets created. ──
  const buildRows = useCallback((): Row[] => {
    if (!pattern || !Number.isInteger(startFloor) || numFloors < 1) return [];
    const out: Row[] = [];
    for (let i = 0; i < numFloors; i++) {
      const floor = startFloor + i;
      for (const p of positions) {
        const unit = Number(p.position);
        out.push({
          key: `${floor}-${p.key}`,
          posKey: p.key,
          position: p.position,
          floor,
          flat_no: renderFlatNo(pattern, { wing: config.wing, floor, unit, groundMode: config.ground_floor_mode }),
          unit_type: p.unit_type,
          carpet_area_sqft: p.carpet_area_sqft,
          built_up_area_sqft: p.built_up_area_sqft,
          rate_per_sqft: p.rate_per_sqft,
          base_price: p.base_price,
          facing: p.facing,
          parking_slots: p.parking_slots,
          is_corner: p.is_corner,
          is_park_facing: p.is_park_facing,
          status: config.default_status,
        });
      }
    }
    return out;
  }, [pattern, startFloor, numFloors, positions, config.wing, config.ground_floor_mode, config.default_status]);

  // Live matrix on the config step — capped, because a 50-floor tower does not
  // need 50 rendered rows to prove the pattern repeats.
  const livePreview = useMemo(() => buildRows(), [buildRows]);

  const resetAll = () => {
    setStep("config");
    setConfig({ ...blankConfig, ...defaults });
    setPositions([newPosition("1"), newPosition("2")]);
    setExpanded(null); setConfirmedEdit(new Set());
    setPendingEdit(null); setPendingRemove(null);
    setRows([]); setPreviewMode("matrix"); setError(null); setSummary(null);
  };

  // Re-apply the launching building's prefill each time the modal opens. Without
  // this, opening the generator from a second building would still carry the
  // first one's project/tower, because the config state outlives a close.
  useEffect(() => {
    if (isOpen) setConfig(c => ({ ...c, ...defaults }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaults?.project_name, defaults?.tower, defaults?.wing]);
  const handleClose = () => { resetAll(); onClose(); };

  // ── Position editing ─────────────────────────────────────────────────────
  const setPos = (key: string, patch: Partial<Position>) => {
    setPositions(ps => ps.map(p => (p.key === key ? { ...p, ...patch } : p)));
    setError(null);
  };

  // §6 — opening a position for editing warns that the change lands on every
  // floor. Confirmed once per position, not once per keystroke.
  const requestExpand = (p: Position) => {
    if (expanded === p.key) { setExpanded(null); return; }
    if (confirmedEdit.has(p.key) || numFloors <= 1) { setExpanded(p.key); return; }
    setPendingEdit(p);
  };

  const addPosition = () => {
    if (positions.length >= MAX_POSITIONS) { setError(`A floor can hold at most ${MAX_POSITIONS} positions.`); return; }
    // Next free number, so adding never lands on a duplicate.
    const used = new Set(positions.map(p => Number(p.position)));
    let next = 1;
    while (used.has(next) && next < MAX_POSITIONS) next++;
    setPositions(ps => [...ps, newPosition(String(next), ps[ps.length - 1]?.unit_type || "2BHK")]);
    setError(null);
  };

  const removePosition = (key: string) => {
    setPositions(ps => ps.filter(p => p.key !== key));
    setExpanded(e => (e === key ? null : e));
    setPendingRemove(null);
    setError(null);
  };

  // ── Validation (§8) ──────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!config.project_name.trim()) return "Project name is required.";
    if (!config.tower.trim()) return "Tower is required.";
    if (config.start_floor === "" || !Number.isInteger(startFloor)) return "Starting floor must be a whole number (0 = Ground).";
    if (!Number.isInteger(Number(config.num_floors)) || numFloors < 1) return "Number of floors must be at least 1.";
    if (positions.length === 0) return "Add at least one flat position — the building cannot be generated without one.";
    if (!pattern) return "Enter a numbering pattern (or pick a preset).";

    const seen = new Map<number, string>();
    for (const p of positions) {
      const raw = String(p.position).trim();
      if (!/^\d+$/.test(raw)) return `Position "${raw || "(blank)"}" must be numeric (01–${MAX_POSITIONS}).`;
      const n = Number(raw);
      if (n < 1 || n > MAX_POSITIONS) return `Position ${pad2(raw)} is out of range — use 01–${MAX_POSITIONS}.`;
      if (seen.has(n)) return `Position ${pad2(raw)} already exists.`;
      seen.set(n, p.key);
      if (!p.unit_type.trim()) return `Position ${pad2(raw)} needs a unit type.`;
      // The API skips any unit without a carpet area, so a blank one here would
      // silently produce nothing for that position across the whole building.
      if (!p.carpet_area_sqft.trim() || !(Number(p.carpet_area_sqft) > 0)) return `Position ${pad2(raw)} needs a carpet area.`;
    }

    if (totalUnits > MAX_UNITS) return `That's ${totalUnits} units — over the ${MAX_UNITS} per-batch limit. Reduce floors or positions.`;

    // Two positions rendering the same flat number (e.g. {FLOOR} with positions
    // 1 and 01) would collide on the unique index, so catch it before the API.
    const firstFloor = livePreview.filter(r => r.floor === startFloor).map(r => r.flat_no);
    const dupe = firstFloor.find((f, i) => firstFloor.indexOf(f) !== i);
    if (dupe) return `Two positions both generate flat "${dupe}" — check the numbering pattern.`;
    return null;
  };

  // ── Step 1 → 2 ───────────────────────────────────────────────────────────
  // Also asks the server which of these flats already exist, so "48 units" does
  // not turn into "12 created, 36 skipped" as a surprise on the summary screen.
  const markExisting = async (built: Row[]) => {
    setCheckingExisting(true);
    try {
      const found = new Set<string>();
      let offset = 0;
      for (let page = 0; page < 4; page++) {
        const p = new URLSearchParams({
          project_name: config.project_name.trim(),
          tower: config.tower.trim(),
          limit: "500",
          offset: String(offset),
        });
        if (config.wing.trim()) p.set("wing", config.wing.trim());
        const res = await fetch(`/api/inventory?${p.toString()}`, { credentials: "include" });
        const json = await res.json();
        if (!json?.success) break;
        for (const u of json.data || []) found.add(`${u.floor}|${String(u.flat_no).toLowerCase()}`);
        offset += (json.data || []).length;
        if (offset >= (json.total ?? 0) || (json.data || []).length === 0) break;
      }
      return built.map(r => ({ ...r, exists: found.has(`${r.floor}|${r.flat_no.toLowerCase()}`) }));
    } catch {
      // A failed pre-check must not block generation — the backend's ON CONFLICT
      // is the real guard, this is only advance notice.
      return built;
    } finally {
      setCheckingExisting(false);
    }
  };

  const generatePreview = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    const built = buildRows();
    setRows(await markExisting(built));
    setStep("preview");
  };

  const updateRow = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const deleteRow = (key: string) => setRows(rs => rs.filter(r => r.key !== key));

  // ── Step 2 → 3: commit ───────────────────────────────────────────────────
  const confirmCreate = async () => {
    if (!canManage) { setError("Only Admin and Sales Managers can generate units."); return; }
    if (rows.length === 0) { setError("No rows to create — add at least one unit."); return; }
    setBusy(true); setError(null);
    try {
      const units = rows.map(r => ({
        project_name: config.project_name.trim(),
        tower: config.tower.trim(),
        wing: config.wing.trim() || null,
        unit_type: r.unit_type,
        floor: r.floor,
        flat_no: String(r.flat_no).trim(),
        carpet_area_sqft: r.carpet_area_sqft,
        built_up_area_sqft: r.built_up_area_sqft,
        rate_per_sqft: r.rate_per_sqft,
        base_price: r.base_price,
        facing: r.facing.trim() || null,
        parking_slots: r.parking_slots,
        is_corner: r.is_corner,
        is_park_facing: r.is_park_facing,
        status: r.status,
      }));
      const res = await fetch("/api/inventory/bulk-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units, user_name: user.name, user_role: user.role }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to create units");
      setSummary({ created: json.created, skipped: json.skipped, total: json.total, skipped_details: json.skipped_details || [] });
      setStep("done");
      onCreated?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const overLimit = rows.length > MAX_UNITS;
  const existingCount = rows.filter(r => r.exists).length;

  // Floors present in a row set, high floor first (how a building is read).
  const floorsOf = (rs: Row[]) => [...new Set(rs.map(r => r.floor))].sort((a, b) => b - a);

  // ── The matrix: floors down, positions across ──
  const Matrix = ({ rs, limit }: { rs: Row[]; limit?: number }) => {
    const floors = floorsOf(rs);
    const shown = limit ? floors.slice(0, limit) : floors;
    const hidden = floors.length - shown.length;
    return (
      <div className="overflow-x-auto">
        <table className="border-collapse text-left">
          <thead>
            <tr>
              <th className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider ${t.textMuted}`}>Floor</th>
              {positions.map(p => (
                <th key={p.key} className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-center ${t.textMuted}`}>
                  Pos {pad2(p.position)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(f => (
              <tr key={f} className={`border-t ${t.tableBorder}`}>
                <td className={`px-2 py-1.5 text-[11px] font-bold whitespace-nowrap ${t.textMuted}`}>
                  {f === 0 ? "Ground" : `Floor ${f}`}
                </td>
                {positions.map(p => {
                  const cell = rs.find(r => r.floor === f && r.posKey === p.key);
                  if (!cell) return <td key={p.key} className={`px-2 py-1.5 text-center text-[11px] ${t.textFaint}`}>—</td>;
                  return (
                    <td key={p.key} className="px-1 py-1">
                      <div className={`rounded-lg border px-2 py-1.5 text-center ${cell.exists ? "border-amber-500/50 bg-amber-500/5" : `${t.tableBorder}`}`}>
                        <p className={`text-xs font-bold font-mono ${t.text}`}>{cell.flat_no}</p>
                        <p className={`text-[10px] ${t.textMuted}`}>{cell.unit_type}</p>
                        {cell.exists && <p className="text-[9px] font-bold text-amber-500 uppercase tracking-wide">exists</p>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {hidden > 0 && (
              <tr className={`border-t ${t.tableBorder}`}>
                <td className={`px-2 py-2 text-[11px] italic ${t.textFaint}`}>…</td>
                <td colSpan={positions.length} className={`px-2 py-2 text-[11px] italic ${t.textFaint}`}>
                  + {hidden} more floor{hidden === 1 ? "" : "s"}, same pattern
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onMouseDown={e => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <motion.div
            initial={{ scale: 0.93, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.93, y: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className={`relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-4xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div className="flex items-center gap-2.5">
                <FaLayerGroup className="text-[#00AEEF]" />
                <div>
                  <h2 className={`text-lg font-bold ${t.text}`}>Create Whole Building</h2>
                  <p className={`text-xs mt-0.5 ${t.textMuted}`}>
                    {step === "config" ? "Step 1 · Define the flat pattern" : step === "preview" ? `Step 2 · Review & edit (${rows.length} units)` : "Done"}
                  </p>
                </div>
              </div>
              <button type="button" onClick={handleClose} className={`p-2 rounded-xl transition-colors cursor-pointer ${t.textMuted} hover:text-red-500`}>
                <FaTimes />
              </button>
            </div>

            {/* Body */}
            <div className={`flex-1 overflow-y-auto p-6 ${isDark ? "bg-[#0D0D12]" : "bg-white"}`}>
              {/* ── STEP 1: CONFIG ── */}
              {step === "config" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ProjectTowerPicker
                      t={t}
                      projectName={config.project_name}
                      towerName={config.tower}
                      onChange={patch => setC(patch as any)}
                    />
                    <div><label className={labelCls}>Wing</label><input value={config.wing} onChange={e => setC({ wing: e.target.value })} className={inputCls} placeholder="Optional" /></div>
                    <div>
                      <label className={labelCls}>Default Status</label>
                      <select value={config.default_status} onChange={e => setC({ default_status: e.target.value })} className={selectCls}>
                        {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className={`mt-4 pt-4 border-t ${t.tableBorder}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>Layout</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div><label className={labelCls}>No. of Floors *</label><input type="number" min="1" value={config.num_floors} onChange={e => setC({ num_floors: e.target.value })} className={inputCls} placeholder="e.g. 12" /></div>
                      <div><label className={labelCls}>Starting Floor *<span className="opacity-60"> (0 = Ground)</span></label><input type="number" value={config.start_floor} onChange={e => setC({ start_floor: e.target.value })} className={inputCls} placeholder="1" /></div>
                      <div>
                        <label className={labelCls}>Flats / Floor</label>
                        {/* Derived, never asked for: the pattern below is the one
                            source of truth for how many flats a floor holds. */}
                        <div className={`rounded-lg px-3 py-2 text-sm border ${t.inputInner} ${t.textMuted}`}>
                          <b className={t.text}>{positions.length}</b> — from the pattern
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── FLAT POSITION PATTERN (§1, §4) ── */}
                  <div className={`mt-4 pt-4 border-t ${t.tableBorder}`}>
                    <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>Flat Position Pattern</p>
                      <button type="button" onClick={addPosition}
                        className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">
                        <FaPlus className="text-[9px]" /> Add Position
                      </button>
                    </div>
                    <p className={`text-[11px] mb-3 ${t.textFaint}`}>
                      Configure one floor. <b className="text-[#00AEEF]">This pattern repeats on every floor</b> — position 01 becomes 101, 201, 301 …
                    </p>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>
                            <th className="py-2 pr-2 font-bold w-8" />
                            <th className="py-2 pr-2 font-bold">Position</th>
                            <th className="py-2 pr-2 font-bold">Unit Type *</th>
                            <th className="py-2 pr-2 font-bold">Carpet (sqft) *</th>
                            <th className="py-2 pr-2 font-bold">Rate / sqft</th>
                            <th className="py-2 pr-2 font-bold">Parking</th>
                            <th className="py-2 font-bold text-right">—</th>
                          </tr>
                        </thead>
                        <tbody>
                          {positions.map(p => (
                            <React.Fragment key={p.key}>
                              <tr className={`border-t ${t.tableBorder}`}>
                                <td className="py-1.5 pr-1">
                                  <button type="button" onClick={() => requestExpand(p)} title="More fields for this position"
                                    className={`p-1.5 rounded ${t.textMuted} hover:text-[#00AEEF]`}>
                                    {expanded === p.key ? <FaChevronDown className="text-[10px]" /> : <FaChevronRight className="text-[10px]" />}
                                  </button>
                                </td>
                                <td className="py-1.5 pr-2 w-24">
                                  <input value={p.position} onChange={e => setPos(p.key, { position: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                                    className={`${cellCls} font-mono`} placeholder="01" />
                                </td>
                                <td className="py-1.5 pr-2 min-w-[110px]">
                                  <select value={p.unit_type} onChange={e => setPos(p.key, { unit_type: e.target.value })} className={`${cellCls} cursor-pointer`}>
                                    {UNIT_TYPE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                </td>
                                <td className="py-1.5 pr-2 min-w-[100px]">
                                  <input type="number" step="0.01" value={p.carpet_area_sqft} onChange={e => setPos(p.key, { carpet_area_sqft: e.target.value })} className={cellCls} placeholder="650" />
                                </td>
                                <td className="py-1.5 pr-2 min-w-[100px]">
                                  <input type="number" step="0.01" value={p.rate_per_sqft} onChange={e => setPos(p.key, { rate_per_sqft: e.target.value })} className={cellCls} placeholder="—" />
                                </td>
                                <td className="py-1.5 pr-2 w-20">
                                  <input type="number" min="0" value={p.parking_slots} onChange={e => setPos(p.key, { parking_slots: e.target.value })} className={cellCls} placeholder="0" />
                                </td>
                                <td className="py-1.5 text-right">
                                  <button type="button" onClick={() => setPendingRemove(p)} className="p-1.5 rounded text-red-500 hover:text-red-400" title="Remove position">
                                    <FaTrash className="text-[11px]" />
                                  </button>
                                </td>
                              </tr>
                              {expanded === p.key && (
                                <tr className={`border-t ${t.tableBorder}`}>
                                  <td />
                                  <td colSpan={6} className="py-2 pr-2">
                                    <div className={`rounded-xl border p-3 ${t.innerBlock}`}>
                                      <p className={`text-[11px] mb-2 ${t.textMuted}`}>
                                        Editing <b className={t.text}>Position {pad2(p.position)}</b> — applies to every floor
                                        {numFloors > 0 && <> ({numFloors} flat{numFloors === 1 ? "" : "s"})</>}.
                                      </p>
                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                        <div><label className={labelCls}>Built-up (sqft)</label><input type="number" step="0.01" value={p.built_up_area_sqft} onChange={e => setPos(p.key, { built_up_area_sqft: e.target.value })} className={cellCls} /></div>
                                        <div><label className={labelCls}>Base Price (₹)</label><input type="number" step="0.01" value={p.base_price} onChange={e => setPos(p.key, { base_price: e.target.value })} className={cellCls} /></div>
                                        <div><label className={labelCls}>Facing</label><input value={p.facing} onChange={e => setPos(p.key, { facing: e.target.value })} className={cellCls} placeholder="East" /></div>
                                        <div className="flex items-end gap-3 pb-1">
                                          <label className={`flex items-center gap-1.5 text-[11px] ${t.text}`}>
                                            <input type="checkbox" checked={p.is_corner} onChange={e => setPos(p.key, { is_corner: e.target.checked })} className="accent-[#00AEEF]" /> Corner
                                          </label>
                                          <label className={`flex items-center gap-1.5 text-[11px] ${t.text}`}>
                                            <input type="checkbox" checked={p.is_park_facing} onChange={e => setPos(p.key, { is_park_facing: e.target.checked })} className="accent-[#00AEEF]" /> Park facing
                                          </label>
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                          {positions.length === 0 && (
                            <tr><td colSpan={7} className={`py-5 text-center text-xs italic ${t.textFaint}`}>No positions. Add at least one to generate the building.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Numbering ── */}
                  <div className={`mt-4 pt-4 border-t ${t.tableBorder}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>Numbering</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Numbering Pattern</label>
                        <select value={config.numbering_preset} onChange={e => setC({ numbering_preset: e.target.value })} className={selectCls}>
                          {NUMBERING_PRESETS.map(p => <option key={p.pattern} value={p.pattern}>{p.pattern} → {p.example}</option>)}
                          <option value="custom">Custom…</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Ground Floor (0) shows as</label>
                        <select value={config.ground_floor_mode} onChange={e => setC({ ground_floor_mode: e.target.value })} className={selectCls}>
                          {GROUND_MODES.map(g => <option key={g.value} value={g.value}>{g.label} — {g.hint}</option>)}
                        </select>
                      </div>
                      {config.numbering_preset === "custom" && (
                        <div className="sm:col-span-2">
                          <label className={labelCls}>Custom Pattern <span className="opacity-60">— tokens: {"{WING} {FLOOR} {FLOOR:02} {UNIT} {UNIT:02}"}</span></label>
                          <input value={config.custom_pattern} onChange={e => setC({ custom_pattern: e.target.value })} className={`${inputCls} font-mono`} placeholder="e.g. {WING}-{FLOOR:02}{UNIT:02}" />
                        </div>
                      )}
                    </div>
                    <p className={`text-[11px] mt-2 ${t.textFaint}`}>{"{UNIT}"} is the position number — position 01 on floor 12 becomes 1201.</p>
                  </div>

                  {/* ── Pattern summary (§10) ── */}
                  <div className={`mt-4 pt-4 border-t ${t.tableBorder}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>Pattern Summary</p>
                    <div className="flex items-start gap-6 flex-wrap">
                      <div>
                        <p className={`text-lg font-bold ${t.text}`}>{numFloors}</p>
                        <p className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>Floors</p>
                      </div>
                      <div>
                        <p className={`text-lg font-bold ${t.text}`}>{positions.length}</p>
                        <p className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>Flats / Floor</p>
                      </div>
                      <div>
                        <p className={`text-lg font-bold ${totalUnits > MAX_UNITS ? "text-red-500" : t.text}`}>{totalUnits}</p>
                        <p className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>Total Units</p>
                      </div>
                      <div className={`pl-6 border-l ${t.tableBorder} flex items-start gap-5 flex-wrap`}>
                        {typeSummary.map(s => (
                          <div key={s.unit_type}>
                            <p className={`text-lg font-bold ${t.text}`}>{s.units}</p>
                            <p className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>
                              {s.unit_type} <span className="opacity-70">({s.perFloorCount} × {numFloors})</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── Live matrix (§5, §14) — the pattern made visible before saving ── */}
                  {livePreview.length > 0 && (
                    <div className={`mt-4 pt-4 border-t ${t.tableBorder}`}>
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${t.textMuted}`}>Generated Pattern</p>
                      <p className={`text-[11px] mb-3 ${t.textFaint}`}>↓ the positions above, repeated on every floor ↓</p>
                      <Matrix rs={livePreview} limit={6} />
                    </div>
                  )}
                </>
              )}

              {/* ── STEP 2: PREVIEW ── */}
              {step === "preview" && (
                <>
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <p className={`text-[11px] ${t.textFaint}`}>
                      {existingCount > 0
                        ? <><b className="text-amber-500">{existingCount}</b> of these already exist and will be skipped — existing records are never overwritten. </>
                        : null}
                      Edit any row, or drop the ones that don&apos;t apply (refuge floors, lift lobbies).
                    </p>
                    <div className={`flex items-center rounded-3xl border overflow-hidden ${t.tableBorder}`}>
                      <button type="button" onClick={() => setPreviewMode("matrix")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${previewMode === "matrix" ? "bg-[#00AEEF] text-white" : t.textMuted}`}><FaThLarge className="text-[10px]" /> Matrix</button>
                      <button type="button" onClick={() => setPreviewMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${previewMode === "table" ? "bg-[#00AEEF] text-white" : t.textMuted}`}><FaTable className="text-[10px]" /> Rows</button>
                    </div>
                  </div>

                  {previewMode === "matrix" ? (
                    <Matrix rs={rows} />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>
                            <th className="py-2 pr-2 font-bold">#</th>
                            <th className="py-2 pr-2 font-bold">Floor</th>
                            <th className="py-2 pr-2 font-bold">Pos</th>
                            <th className="py-2 pr-2 font-bold">Flat No.</th>
                            <th className="py-2 pr-2 font-bold">Unit Type</th>
                            <th className="py-2 pr-2 font-bold">Carpet (sqft)</th>
                            <th className="py-2 pr-2 font-bold">Status</th>
                            <th className="py-2 font-bold text-right">—</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={r.key} className={`border-t ${t.tableBorder}`}>
                              <td className={`py-1.5 pr-2 text-xs ${t.textFaint}`}>{i + 1}</td>
                              <td className={`py-1.5 pr-2 text-xs ${t.text}`}>{r.floor}</td>
                              <td className={`py-1.5 pr-2 text-xs font-mono ${t.textMuted}`}>{pad2(r.position)}</td>
                              <td className="py-1.5 pr-2 min-w-[110px]">
                                <input value={r.flat_no} onChange={e => updateRow(r.key, { flat_no: e.target.value })} className={cellCls} />
                                {r.exists && <span className="text-[9px] font-bold text-amber-500 uppercase">exists — will skip</span>}
                              </td>
                              <td className="py-1.5 pr-2 min-w-[110px]">
                                <select value={r.unit_type} onChange={e => updateRow(r.key, { unit_type: e.target.value })} className={`${cellCls} cursor-pointer`}>
                                  {UNIT_TYPE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </td>
                              <td className="py-1.5 pr-2 min-w-[90px]"><input type="number" step="0.01" value={r.carpet_area_sqft} onChange={e => updateRow(r.key, { carpet_area_sqft: e.target.value })} className={cellCls} placeholder="—" /></td>
                              <td className="py-1.5 pr-2 min-w-[120px]">
                                <select value={r.status} onChange={e => updateRow(r.key, { status: e.target.value })} className={`${cellCls} cursor-pointer`}>
                                  {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </td>
                              <td className="py-1.5 text-right">
                                <button type="button" onClick={() => deleteRow(r.key)} className="p-1.5 rounded text-red-500 hover:text-red-400" title="Remove row"><FaTrash className="text-[11px]" /></button>
                              </td>
                            </tr>
                          ))}
                          {rows.length === 0 && (
                            <tr><td colSpan={8} className={`py-6 text-center text-xs italic ${t.textFaint}`}>All rows removed. Go back to reconfigure.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {/* ── STEP 3: DONE ── */}
              {step === "done" && summary && (
                <div className="flex flex-col items-center text-center py-6">
                  <FaCheckCircle className="text-emerald-500 text-4xl mb-4" />
                  <h3 className={`text-xl font-bold mb-1 ${t.text}`}>{summary.created} unit{summary.created === 1 ? "" : "s"} created</h3>
                  <p className={`text-sm mb-4 ${t.textMuted}`}>
                    {summary.skipped > 0
                      ? `${summary.skipped} skipped (already existed), out of ${summary.total} total.`
                      : `All ${summary.total} units added successfully.`}
                  </p>
                  {summary.skipped_details.length > 0 && (
                    <div className={`w-full max-w-md rounded-xl border p-3 text-left ${t.innerBlock}`}>
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${t.textMuted}`}>Skipped</p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {summary.skipped_details.map((s, i) => (
                          <p key={i} className={`text-[11px] ${t.textFaint}`}><b className={t.text}>{s.flat_no}</b> — {s.reason}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-red-500 text-[12px] mt-3">{error}</p>}
            </div>

            {/* ── Confirmations (§6, §7) — inline, so they cannot be missed ── */}
            {pendingEdit && (
              <div className="absolute inset-0 z-[5] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.55)" }}>
                <div className={`w-full max-w-sm rounded-3xl border p-5 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>
                  <div className="flex items-center gap-2 mb-2"><FaExclamationTriangle className="text-amber-500" /><h3 className={`text-sm font-bold ${t.text}`}>Edit Position {pad2(pendingEdit.position)}?</h3></div>
                  <p className={`text-xs leading-relaxed mb-4 ${t.text}`}>
                    Changing Position {pad2(pendingEdit.position)} will update the generated configuration for this position across all {numFloors} floor{numFloors === 1 ? "" : "s"}. Continue?
                  </p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setPendingEdit(null)} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
                    <button type="button"
                      onClick={() => { setConfirmedEdit(s => new Set(s).add(pendingEdit.key)); setExpanded(pendingEdit.key); setPendingEdit(null); }}
                      className="text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">Continue</button>
                  </div>
                </div>
              </div>
            )}
            {pendingRemove && (
              <div className="absolute inset-0 z-[5] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.55)" }}>
                <div className={`w-full max-w-sm rounded-3xl border p-5 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>
                  <div className="flex items-center gap-2 mb-2"><FaExclamationTriangle className="text-red-500" /><h3 className={`text-sm font-bold ${t.text}`}>Remove Position {pad2(pendingRemove.position)}?</h3></div>
                  <p className={`text-xs leading-relaxed mb-4 ${t.text}`}>
                    This removes the flat at this position from every floor — {numFloors} flat{numFloors === 1 ? "" : "s"} will no longer be generated.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setPendingRemove(null)} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
                    <button type="button" onClick={() => removePosition(pendingRemove.key)} className="text-xs font-bold px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600">Remove</button>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className={`flex items-center justify-between gap-2 px-6 py-4 border-t flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                {step === "preview" && (
                  <button type="button" onClick={() => setStep("config")} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg ${t.textMuted} hover:${t.text}`}>
                    <FaArrowLeft className="text-[10px]" /> Back
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {step === "done" ? (
                  <button type="button" onClick={handleClose} className="text-xs font-bold px-5 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">Done</button>
                ) : (
                  <>
                    <button type="button" onClick={handleClose} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
                    {step === "config" ? (
                      <button type="button" onClick={generatePreview} disabled={checkingExisting} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-50">
                        {checkingExisting ? "Checking…" : `Generate Preview${totalUnits > 0 ? ` (${totalUnits})` : ""}`}
                      </button>
                    ) : (
                      <button type="button" onClick={confirmCreate} disabled={busy || !canManage || rows.length === 0 || overLimit} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-50">
                        {busy ? "Creating…" : `Confirm & Create ${rows.length} Unit${rows.length === 1 ? "" : "s"}`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
