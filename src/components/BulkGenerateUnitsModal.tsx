"use client";
// BulkGenerateUnitsModal.tsx — Inventory Phase 3. "Create whole building" generator.
// Step 1 (config): building details + floors/units/numbering → builds the matrix
//   entirely client-side (no DB write).
// Step 2 (preview): editable table (flat no. / carpet / type / status per row) with
//   a delete-row action to drop slots that don't apply (refuge floors, lift lobbies).
// Step 3 (done): commit via POST /api/inventory/bulk-generate, then show the
//   created-vs-skipped(duplicate) summary.
import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaTrash, FaLayerGroup, FaArrowLeft, FaCheckCircle } from "react-icons/fa";

const STATUS_OPTS: { label: string; value: string }[] = [
  { label: "Available", value: "available" },
  { label: "Blocked", value: "blocked" },
  { label: "Refuge Area", value: "refuge_area" },
  { label: "Unfinished", value: "unfinished" },
];
const UNIT_TYPE_OPTS = ["1 RK", "1BHK", "1.5BHK", "2BHK", "2.5BHK", "3BHK", "3.5BHK", "4BHK", "Penthouse", "Shop", "Office", "Other"];
const MAX_UNITS = 2000;

// Token-based flat numbering. Indian builders number flats many ways, so the scheme
// is a pattern of tokens the user picks/edits rather than one hardcoded format:
//   {WING}      wing code — omitted (with its trailing separator) when the tower has no wing
//   {FLOOR}     floor number, no padding      {FLOOR:02}  floor, zero-padded to 2 digits
//   {UNIT}      unit index, no padding        {UNIT:02}   unit index, zero-padded to 2 digits
const NUMBERING_PRESETS: { pattern: string; example: string }[] = [
  { pattern: "{WING}-{FLOOR:02}{UNIT:02}", example: "B-1204" },
  { pattern: "{WING}{FLOOR}{UNIT:02}", example: "B1204" },
  { pattern: "{FLOOR:02}{UNIT:02}", example: "1204" },
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
}

type Row = { key: string; floor: number; flat_no: string; unit_type: string; carpet_area_sqft: string; status: string };

const blankConfig = {
  apartment_name: "", project_name: "", tower: "", wing: "", unit_type: "2BHK",
  num_floors: "", units_per_floor: "", start_floor: "1",
  numbering_preset: NUMBERING_PRESETS[0].pattern, custom_pattern: "", ground_floor_mode: "zero",
  default_carpet: "", default_status: "available",
};

export default function BulkGenerateUnitsModal({ isOpen, onClose, onCreated, user, isDark, t }: Props) {
  const [step, setStep] = useState<"config" | "preview" | "done">("config");
  const [config, setConfig] = useState({ ...blankConfig });
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ created: number; skipped: number; total: number; skipped_details: { flat_no: string; reason: string }[] } | null>(null);

  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase());

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const cellCls = `w-full rounded-md px-2 py-1 text-xs outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  const setC = (patch: Partial<typeof blankConfig>) => { setConfig(c => ({ ...c, ...patch })); setError(null); };

  const projectedCount = useMemo(() => {
    const nf = Number(config.num_floors), upf = Number(config.units_per_floor);
    return nf > 0 && upf > 0 ? nf * upf : 0;
  }, [config.num_floors, config.units_per_floor]);

  // The first few flat numbers the current pattern + config would actually produce.
  const previewExamples = useMemo(() => {
    const pat = (config.numbering_preset === "custom" ? config.custom_pattern : config.numbering_preset).trim();
    if (!pat) return [];
    const sf = Number(config.start_floor);
    if (!Number.isInteger(sf)) return [];
    const nf = Math.max(1, Number(config.num_floors) || 1);
    const upf = Math.max(1, Number(config.units_per_floor) || 1);
    const out: string[] = [];
    outer: for (let i = 0; i < nf; i++) {
      for (let u = 1; u <= upf; u++) {
        out.push(renderFlatNo(pat, { wing: config.wing, floor: sf + i, unit: u, groundMode: config.ground_floor_mode }));
        if (out.length >= 3) break outer;
      }
    }
    return out;
  }, [config.numbering_preset, config.custom_pattern, config.wing, config.start_floor, config.num_floors, config.units_per_floor, config.ground_floor_mode]);

  const resetAll = () => { setStep("config"); setConfig({ ...blankConfig }); setRows([]); setError(null); setSummary(null); };
  const handleClose = () => { resetAll(); onClose(); };

  // ── Step 1 → 2: build the matrix client-side ──
  const generatePreview = () => {
    setError(null);
    for (const [k, label] of [["apartment_name", "Apartment name"], ["project_name", "Project name"], ["tower", "Tower"], ["unit_type", "Unit type"]] as const) {
      if (!String((config as any)[k]).trim()) { setError(`${label} is required.`); return; }
    }
    const nf = Number(config.num_floors), upf = Number(config.units_per_floor), sf = Number(config.start_floor);
    if (!Number.isInteger(nf) || nf < 1) { setError("Number of floors must be at least 1."); return; }
    if (!Number.isInteger(upf) || upf < 1) { setError("Units per floor must be at least 1."); return; }
    if (config.start_floor === "" || !Number.isInteger(sf)) { setError("Starting floor must be a whole number (0 = Ground)."); return; }
    if (nf * upf > MAX_UNITS) { setError(`That's ${nf * upf} units — over the ${MAX_UNITS} per-batch limit. Reduce floors or units per floor.`); return; }

    const pattern = (config.numbering_preset === "custom" ? config.custom_pattern : config.numbering_preset).trim();
    if (!pattern) { setError("Enter a numbering pattern (or pick a preset)."); return; }
    const out: Row[] = [];
    for (let i = 0; i < nf; i++) {
      const floor = sf + i;
      for (let u = 1; u <= upf; u++) {
        out.push({
          key: `${floor}-${u}`,
          floor,
          flat_no: renderFlatNo(pattern, { wing: config.wing, floor, unit: u, groundMode: config.ground_floor_mode }),
          unit_type: config.unit_type,
          carpet_area_sqft: config.default_carpet,
          status: config.default_status,
        });
      }
    }
    setRows(out);
    setStep("preview");
  };

  const updateRow = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const deleteRow = (key: string) => setRows(rs => rs.filter(r => r.key !== key));

  // ── Step 2 → 3: commit ──
  const confirmCreate = async () => {
    if (!canManage) { setError("Only Admin and Sales Managers can generate units."); return; }
    if (rows.length === 0) { setError("No rows to create — add at least one unit."); return; }
    setBusy(true); setError(null);
    try {
      const units = rows.map(r => ({
        apartment_name: config.apartment_name.trim(),
        project_name: config.project_name.trim(),
        tower: config.tower.trim(),
        wing: config.wing.trim() || null,
        unit_type: r.unit_type,
        floor: r.floor,
        flat_no: String(r.flat_no).trim(),
        carpet_area_sqft: r.carpet_area_sqft,
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
            className={`w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div className="flex items-center gap-2.5">
                <FaLayerGroup className="text-[#00AEEF]" />
                <div>
                  <h2 className={`text-lg font-bold ${t.text}`}>Create Whole Building</h2>
                  <p className={`text-xs mt-0.5 ${t.textMuted}`}>
                    {step === "config" ? "Step 1 · Configure the layout" : step === "preview" ? `Step 2 · Review & edit (${rows.length} units)` : "Done"}
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
                    <div><label className={labelCls}>Apartment Name *</label><input value={config.apartment_name} onChange={e => setC({ apartment_name: e.target.value })} className={inputCls} placeholder="e.g. Colossal Mas" /></div>
                    <div><label className={labelCls}>Project Name *</label><input value={config.project_name} onChange={e => setC({ project_name: e.target.value })} className={inputCls} placeholder="e.g. Phase 1" /></div>
                    <div><label className={labelCls}>Tower *</label><input value={config.tower} onChange={e => setC({ tower: e.target.value })} className={inputCls} placeholder="e.g. A" /></div>
                    <div><label className={labelCls}>Wing</label><input value={config.wing} onChange={e => setC({ wing: e.target.value })} className={inputCls} placeholder="Optional" /></div>
                    <div>
                      <label className={labelCls}>Default Unit Type *</label>
                      <select value={config.unit_type} onChange={e => setC({ unit_type: e.target.value })} className={selectCls}>
                        {UNIT_TYPE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
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
                      <div><label className={labelCls}>Units / Floor *</label><input type="number" min="1" value={config.units_per_floor} onChange={e => setC({ units_per_floor: e.target.value })} className={inputCls} placeholder="e.g. 4" /></div>
                      <div><label className={labelCls}>Starting Floor *<span className="opacity-60"> (0 = Ground)</span></label><input type="number" value={config.start_floor} onChange={e => setC({ start_floor: e.target.value })} className={inputCls} placeholder="1" /></div>
                      <div><label className={labelCls}>Default Carpet (sqft)</label><input type="number" step="0.01" value={config.default_carpet} onChange={e => setC({ default_carpet: e.target.value })} className={inputCls} placeholder="e.g. 645" /></div>
                    </div>
                  </div>

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
                    <p className={`text-[11px] mt-3 ${t.textFaint}`}>
                      {previewExamples.length > 0
                        ? <>Preview: <b className={`${t.text} font-mono`}>{previewExamples.join(",  ")}</b> … Editable per row in the next step.</>
                        : <>Enter a numbering pattern to preview flat numbers.</>}
                      {projectedCount > 0 && <> This generates <b className={t.text}>{projectedCount}</b> units.</>}
                    </p>
                  </div>
                </>
              )}

              {/* ── STEP 2: PREVIEW ── */}
              {step === "preview" && (
                <div className="overflow-x-auto">
                  <p className={`text-[11px] mb-3 ${t.textFaint}`}>Edit any cell, or delete rows that don't apply (refuge floors, lift lobbies). Duplicates of existing units are skipped automatically on save.</p>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>
                        <th className="py-2 pr-2 font-bold">#</th>
                        <th className="py-2 pr-2 font-bold">Floor</th>
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
                          <td className="py-1.5 pr-2 min-w-[110px]"><input value={r.flat_no} onChange={e => updateRow(r.key, { flat_no: e.target.value })} className={cellCls} /></td>
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
                        <tr><td colSpan={7} className={`py-6 text-center text-xs italic ${t.textFaint}`}>All rows removed. Go back to reconfigure.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
                      <button type="button" onClick={generatePreview} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc]">Generate Preview</button>
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
