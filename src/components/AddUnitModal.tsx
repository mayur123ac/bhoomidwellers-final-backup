"use client";
// AddUnitModal.tsx — Inventory Phase 2. Manual single-unit entry.
// Covers all core fields + a manual-only status dropdown (Available / Blocked /
// Refuge Area / Unfinished — booked/registered are sync-only). Duplicate units are
// caught inline against the passed-in list before submit; the server also enforces
// the unique constraint (409) as the source of truth.
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaPlus } from "react-icons/fa";
import IndianCurrencyInput from "./IndianCurrencyInput";

// Manual-settable statuses only. booked/registered come from the booking-sync
// flow; on_hold/cancelled are lifecycle-driven — none are offered here.
const STATUS_OPTS: { label: string; value: string }[] = [
  { label: "Available", value: "available" },
  { label: "Blocked", value: "blocked" },
  { label: "Refuge Area", value: "refuge_area" },
  { label: "Unfinished", value: "unfinished" },
];

const UNIT_TYPE_OPTS = ["1 RK", "1BHK", "1.5BHK", "2BHK", "2.5BHK", "3BHK", "3.5BHK", "4BHK", "Penthouse", "Shop", "Office", "Other"];

type ExistingUnit = { project_name: string; tower: string; wing: string | null; floor: number | string; flat_no: string };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (unit: any) => void;          // fired after a successful create
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
  // Current units, used for the inline duplicate pre-check (server still enforces).
  existingUnits?: ExistingUnit[];
  // Optional prefill so adding several units in one building isn't repetitive.
  defaults?: Partial<Record<"apartment_name" | "project_name" | "tower" | "wing" | "unit_type", string>>;
}

const blankForm = {
  apartment_name: "", project_name: "", tower: "", wing: "", unit_type: "",
  floor: "", flat_no: "", carpet_area_sqft: "", built_up_area_sqft: "",
  rate_per_sqft: "", base_price: "", facing: "", status: "available",
};

const norm = (v: any) => String(v ?? "").trim().toLowerCase();
const numOf = (v: any) => Number(String(v ?? "").replace(/[,\s₹]/g, ""));

export default function AddUnitModal({ isOpen, onClose, onCreated, user, isDark, t, existingUnits = [], defaults }: Props) {
  const [form, setForm] = useState({ ...blankForm });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase());

  // Reset (and apply any building defaults) each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setForm({ ...blankForm, ...defaults });
      setError(null);
      setNotice(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  const set = (patch: Partial<typeof blankForm>) => { setForm(f => ({ ...f, ...patch })); setNotice(null); };

  const isDuplicate = () =>
    existingUnits.some(u =>
      norm(u.project_name) === norm(form.project_name) &&
      norm(u.tower) === norm(form.tower) &&
      norm(u.wing || "") === norm(form.wing) &&
      String(u.floor) === String(Number(form.floor)) &&
      norm(u.flat_no) === norm(form.flat_no),
    );

  const validate = (): string | null => {
    const required: [keyof typeof blankForm, string][] = [
      ["apartment_name", "Apartment name"], ["project_name", "Project name"],
      ["tower", "Tower"], ["unit_type", "Unit type"], ["flat_no", "Flat no."],
    ];
    for (const [k, label] of required) {
      if (!String(form[k]).trim()) return `${label} is required.`;
    }
    if (form.floor === "" || isNaN(Number(form.floor))) return "Floor is required (use 0 for ground).";
    const carpet = numOf(form.carpet_area_sqft);
    if (!carpet || carpet <= 0) return "Carpet area (sqft) is required.";
    if (isDuplicate())
      return `Unit ${form.flat_no.trim()} already exists in ${form.tower.trim()}${form.wing.trim() ? "/" + form.wing.trim() : ""}, floor ${Number(form.floor)}.`;
    return null;
  };

  const save = async (addAnother: boolean) => {
    if (!canManage) { setError("Only Admin and Sales Managers can add units."); return; }
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = {
        apartment_name: form.apartment_name.trim(),
        project_name: form.project_name.trim(),
        tower: form.tower.trim(),
        wing: form.wing.trim() || null,
        unit_type: form.unit_type,
        floor: Number(form.floor),
        flat_no: form.flat_no.trim(),
        carpet_area_sqft: form.carpet_area_sqft,
        built_up_area_sqft: form.built_up_area_sqft || null,
        rate_per_sqft: form.rate_per_sqft || null,
        base_price: form.base_price || null,
        facing: form.facing.trim() || null,
        status: form.status,
        user_name: user.name,
        user_role: user.role,
      };
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to create unit");
      onCreated?.(json.data);
      if (addAnother) {
        // Keep the building context; clear only the per-unit fields.
        setForm(f => ({
          ...f, flat_no: "", floor: "", carpet_area_sqft: "", built_up_area_sqft: "",
          rate_per_sqft: "", base_price: "", facing: "", status: "available",
        }));
        setNotice(`Unit ${payload.flat_no} added. Enter the next one.`);
      } else {
        handleClose();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => { setForm({ ...blankForm }); setError(null); setNotice(null); onClose(); };

  if (!isOpen) return null;

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
            className={`w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                <h2 className={`text-lg font-bold ${t.text}`}>Add Unit</h2>
                <p className={`text-xs mt-0.5 ${t.textMuted}`}>Manual single-unit entry</p>
              </div>
              <button type="button" onClick={handleClose} className={`p-2 rounded-xl transition-colors cursor-pointer ${t.textMuted} hover:text-red-500`}>
                <FaTimes />
              </button>
            </div>

            {/* Body */}
            <div className={`flex-1 overflow-y-auto p-6 ${isDark ? "bg-[#0D0D12]" : "bg-white"}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Apartment Name *</label><input value={form.apartment_name} onChange={e => set({ apartment_name: e.target.value })} className={inputCls} placeholder="e.g. Colossal Mas" /></div>
                <div><label className={labelCls}>Project Name *</label><input value={form.project_name} onChange={e => set({ project_name: e.target.value })} className={inputCls} placeholder="e.g. Phase 1" /></div>
                <div><label className={labelCls}>Tower *</label><input value={form.tower} onChange={e => set({ tower: e.target.value })} className={inputCls} placeholder="e.g. A" /></div>
                <div><label className={labelCls}>Wing</label><input value={form.wing} onChange={e => set({ wing: e.target.value })} className={inputCls} placeholder="Optional" /></div>
                <div>
                  <label className={labelCls}>Unit Type *</label>
                  <select value={form.unit_type} onChange={e => set({ unit_type: e.target.value })} className={selectCls}>
                    <option value="">Select</option>
                    {UNIT_TYPE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Facing</label><input value={form.facing} onChange={e => set({ facing: e.target.value })} className={inputCls} placeholder="e.g. Garden-facing" /></div>
                <div><label className={labelCls}>Floor * <span className="opacity-60">(0 = Ground)</span></label><input type="number" value={form.floor} onChange={e => set({ floor: e.target.value })} className={inputCls} placeholder="e.g. 7" /></div>
                <div><label className={labelCls}>Flat No. *</label><input value={form.flat_no} onChange={e => set({ flat_no: e.target.value })} className={inputCls} placeholder="e.g. 701" /></div>
                <div><label className={labelCls}>Carpet Area (sqft) *</label><input type="number" step="0.01" value={form.carpet_area_sqft} onChange={e => set({ carpet_area_sqft: e.target.value })} className={inputCls} placeholder="e.g. 645" /></div>
                <div><label className={labelCls}>Built-up Area (sqft)</label><input type="number" step="0.01" value={form.built_up_area_sqft} onChange={e => set({ built_up_area_sqft: e.target.value })} className={inputCls} placeholder="Optional" /></div>
                <div><label className={labelCls}>Rate / sqft</label><IndianCurrencyInput value={form.rate_per_sqft} onChange={val => set({ rate_per_sqft: val })} className={inputCls} placeholder="e.g. 8,500" /></div>
                <div><label className={labelCls}>Base Price</label><IndianCurrencyInput value={form.base_price} onChange={val => set({ base_price: val })} className={inputCls} placeholder="e.g. 54,00,000" /></div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Status</label>
                  <select value={form.status} onChange={e => set({ status: e.target.value })} className={selectCls}>
                    {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {error && <p className="text-red-500 text-[12px] mt-3">{error}</p>}
              {notice && <p className="text-emerald-500 text-[12px] mt-3">{notice}</p>}
            </div>

            {/* Footer */}
            <div className={`flex items-center justify-end gap-2 px-6 py-4 border-t flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <button type="button" onClick={handleClose} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
              <button type="button" onClick={() => save(true)} disabled={busy || !canManage} className="text-xs font-bold px-4 py-2 rounded-lg border border-[#00AEEF]/40 text-[#00AEEF] hover:bg-[#00AEEF]/10 disabled:opacity-50">
                {busy ? "Saving…" : "Save & Add Another"}
              </button>
              <button type="button" onClick={() => save(false)} disabled={busy || !canManage} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-50">
                <FaPlus className="text-[10px]" /> {busy ? "Saving…" : "Add Unit"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
