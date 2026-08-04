"use client";
// PricingRulesModal.tsx — Sell.Do parity, gap 3 UI.
//
// Without a price rule the cost-sheet panel just reports "No active price rule
// covers this unit", so this is the screen that makes pricing usable at all.
//
// RULES ARE VERSIONED, NEVER EDITED. Saving always creates a NEW row with an
// effective_from date; the old one stays. A cost sheet issued last month has to
// keep explaining itself with last month's numbers, so there is deliberately no
// edit or delete action here — only "add a new version".
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaTags, FaPlus, FaInfoCircle } from "react-icons/fa";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
}

interface Project { id: number; name: string; }
interface Tower { id: number; name: string; project_id: number; }

const UNIT_TYPES = ["1 RK", "1BHK", "1.5BHK", "2BHK", "2.5BHK", "3BHK", "3.5BHK", "4BHK", "Penthouse", "Shop", "Office"];

const blank = {
  project_id: "", tower_id: "", unit_type: "",
  base_rate_per_sqft: "",
  floor_rise_per_sqft: "0", floor_rise_from_floor: "0", floor_rise_max_per_sqft: "",
  corner_premium_pct: "0", park_facing_premium_pct: "0",
  club_fee: "0", corpus_fund: "0", legal_charges: "0", maintenance_deposit: "0",
  parking_charge_per_slot: "0",
  gst_rate: "5", stamp_duty_rate: "6", registration_fee: "30000",
  effective_from: "",
};

const money = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—";
};

export default function PricingRulesModal({ isOpen, onClose, user, isDark, t }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase());

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [p, tw, r] = await Promise.all([
        fetch("/api/inventory/projects", { credentials: "include" }),
        fetch("/api/inventory/towers", { credentials: "include" }),
        fetch("/api/inventory/price-rules", { credentials: "include" }),
      ]);
      const pj = await p.json(); const tj = await tw.json(); const rj = await r.json();
      if (!pj?.success) throw new Error(pj?.message || "Could not load projects");
      setProjects(pj.data || []);
      setTowers(tj?.success ? tj.data || [] : []);
      setRules(rj?.success ? rj.data || [] : []);
    } catch (e: any) { setErr(e?.message || "Could not load pricing"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...blank }); setAdding(false); setNotice(null); setErr(null);
    load();
  }, [isOpen, load]);

  const set = (patch: Partial<typeof blank>) => { setForm(f => ({ ...f, ...patch })); setNotice(null); };

  const towersForProject = useMemo(
    () => towers.filter(tw => String(tw.project_id) === String(form.project_id)),
    [towers, form.project_id],
  );

  const validate = (): string | null => {
    if (!form.project_id) return "Pick a project.";
    const base = Number(form.base_rate_per_sqft);
    if (!Number.isFinite(base) || base <= 0) return "Base rate per sq.ft. must be greater than zero.";
    for (const [k, label] of [
      ["corner_premium_pct", "Corner premium"], ["park_facing_premium_pct", "Park facing premium"],
      ["gst_rate", "GST rate"], ["stamp_duty_rate", "Stamp duty rate"],
    ] as const) {
      const v = Number((form as any)[k]);
      if (!Number.isFinite(v) || v < 0 || v > 100) return `${label} must be between 0 and 100.`;
    }
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await fetch("/api/inventory/price-rules", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          ...form,
          tower_id: form.tower_id || null,
          unit_type: form.unit_type || null,
          floor_rise_max_per_sqft: form.floor_rise_max_per_sqft || null,
          effective_from: form.effective_from || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not save the rule");
      setNotice("New rule version saved.");
      setForm({ ...blank });
      setAdding(false);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  // A rule's scope in words. "Project-wide, all types" is the common case and
  // reads better than blank cells.
  const scopeLabel = (r: any) => {
    const parts = [r.tower_name ? `Tower ${r.tower_name}` : "Project-wide"];
    parts.push(r.unit_type || "all types");
    return parts.join(" · ");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ scale: 0.97, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, y: 12 }}
            className={`w-full max-w-4xl max-h-[88vh] rounded-4xl border shadow-2xl flex flex-col overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>

            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                <h2 className={`text-base font-bold flex items-center gap-2 ${t.text}`}><FaTags className="text-[#00AEEF]" /> Pricing Rules</h2>
                <p className={`text-[11px] ${t.textMuted}`}>Base rate, floor rise, premiums and charges used to build cost sheets</p>
              </div>
              <button onClick={onClose} className={`p-2 rounded-xl ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {err && <p className="text-red-500 text-xs mb-3">{err}</p>}
              {notice && <p className="text-emerald-500 text-xs mb-3">{notice}</p>}

              {/* Existing rules */}
              <div className="flex items-center justify-between mb-2">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>Active rules</p>
                {canManage && !adding && (
                  <button onClick={() => { setAdding(true); setErr(null); }}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] flex items-center gap-1.5">
                    <FaPlus className="text-[9px]" /> New Rule
                  </button>
                )}
              </div>

              {loading ? (
                <p className={`text-sm italic ${t.textFaint}`}>Loading…</p>
              ) : rules.length === 0 ? (
                <div className={`rounded-xl border p-4 mb-4 ${t.innerBlock}`}>
                  <p className={`text-sm font-semibold ${t.text}`}>No pricing rules yet</p>
                  <p className={`text-[11px] mt-1 ${t.textMuted}`}>
                    Until a project has one, cost sheets for its units will report
                    “No active price rule covers this unit”.
                  </p>
                </div>
              ) : (
                <div className={`rounded-xl border overflow-hidden mb-4 ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                  {rules.map((r, i) => (
                    <div key={r.id}
                      className={`px-3 py-2.5 ${i > 0 ? `border-t ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}` : ""}`}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className={`text-sm font-bold ${t.text}`}>{r.project_name}</p>
                          <p className={`text-[11px] ${t.textMuted}`}>{scopeLabel(r)} · from {String(r.effective_from).slice(0, 10)}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${t.text}`}>{money(r.base_rate_per_sqft)}<span className={`text-[10px] font-normal ${t.textMuted}`}> /sq.ft.</span></p>
                          <p className={`text-[10px] ${t.textFaint}`}>
                            GST {r.gst_rate}% · SD {r.stamp_duty_rate}%
                            {Number(r.floor_rise_per_sqft) > 0 ? ` · rise ₹${r.floor_rise_per_sqft}/floor above ${r.floor_rise_from_floor}` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* New rule form */}
              {adding && canManage && (
                <div className={`rounded-xl border p-4 ${t.innerBlock}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${t.textMuted}`}>New rule version</p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className={labelCls}>Project *</label>
                      <select value={form.project_id} onChange={e => set({ project_id: e.target.value, tower_id: "" })} className={selectCls}>
                        <option value="">Select…</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Tower</label>
                      <select value={form.tower_id} onChange={e => set({ tower_id: e.target.value })} className={selectCls} disabled={!form.project_id}>
                        <option value="">All towers</option>
                        {towersForProject.map(tw => <option key={tw.id} value={tw.id}>{tw.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Configuration</label>
                      <select value={form.unit_type} onChange={e => set({ unit_type: e.target.value })} className={selectCls}>
                        <option value="">All types</option>
                        {UNIT_TYPES.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>

                  <p className={`text-[10px] mb-3 flex items-start gap-1.5 ${t.textFaint}`}>
                    <FaInfoCircle className="mt-0.5 flex-shrink-0" />
                    A more specific rule wins: tower + configuration beats tower, which beats project-wide.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div><label className={labelCls}>Base rate / sq.ft. *</label><input value={form.base_rate_per_sqft} onChange={e => set({ base_rate_per_sqft: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} placeholder="12000" /></div>
                    <div><label className={labelCls}>Floor rise / sq.ft.</label><input value={form.floor_rise_per_sqft} onChange={e => set({ floor_rise_per_sqft: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} placeholder="50" /></div>
                    <div><label className={labelCls}>Rise starts above floor</label><input value={form.floor_rise_from_floor} onChange={e => set({ floor_rise_from_floor: e.target.value.replace(/[^\d]/g, "") })} className={inputCls} placeholder="4" /></div>
                    <div><label className={labelCls}>Rise cap / sq.ft.</label><input value={form.floor_rise_max_per_sqft} onChange={e => set({ floor_rise_max_per_sqft: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} placeholder="No cap" /></div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div><label className={labelCls}>Corner premium %</label><input value={form.corner_premium_pct} onChange={e => set({ corner_premium_pct: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} placeholder="3" /></div>
                    <div><label className={labelCls}>Park facing %</label><input value={form.park_facing_premium_pct} onChange={e => set({ park_facing_premium_pct: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} placeholder="2" /></div>
                    <div><label className={labelCls}>Parking / slot</label><input value={form.parking_charge_per_slot} onChange={e => set({ parking_charge_per_slot: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} placeholder="350000" /></div>
                    <div><label className={labelCls}>Effective from</label><input type="date" value={form.effective_from} onChange={e => set({ effective_from: e.target.value })} className={inputCls} /></div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div><label className={labelCls}>Club fee</label><input value={form.club_fee} onChange={e => set({ club_fee: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} /></div>
                    <div><label className={labelCls}>Corpus fund</label><input value={form.corpus_fund} onChange={e => set({ corpus_fund: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} /></div>
                    <div><label className={labelCls}>Legal charges</label><input value={form.legal_charges} onChange={e => set({ legal_charges: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} /></div>
                    <div><label className={labelCls}>Maintenance deposit</label><input value={form.maintenance_deposit} onChange={e => set({ maintenance_deposit: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} /></div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div><label className={labelCls}>GST %</label><input value={form.gst_rate} onChange={e => set({ gst_rate: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} /></div>
                    <div><label className={labelCls}>Stamp duty %</label><input value={form.stamp_duty_rate} onChange={e => set({ stamp_duty_rate: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} /></div>
                    <div><label className={labelCls}>Registration fee</label><input value={form.registration_fee} onChange={e => set({ registration_fee: e.target.value.replace(/[^\d.]/g, "") })} className={inputCls} /></div>
                  </div>

                  <p className={`text-[10px] mb-3 ${t.textFaint}`}>
                    Saving creates a new version — existing cost sheets keep the numbers they were issued with.
                  </p>

                  <div className="flex gap-2">
                    <button onClick={save} disabled={busy}
                      className="text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-50">
                      {busy ? "Saving…" : "Save Rule"}
                    </button>
                    <button onClick={() => { setAdding(false); setForm({ ...blank }); setErr(null); }}
                      className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
