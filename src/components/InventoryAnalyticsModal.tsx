"use client";
// InventoryAnalyticsModal.tsx — Sell.Do parity, gap 5: stock movement.
//
// RevenueIntelligenceView answers "how much did we collect". This answers the
// different question Sell.Do's inventory reports answer: how much stock is left,
// how fast it is moving, and which configurations are actually selling.
//
// ─────────────────────────────────────────────────────────────────────────────
// VISUAL DESIGN NOTES (why it looks like this)
//
// • Colour follows the ENTITY, not the chart slot. Available/On hold/Sold reuse
//   the exact status hexes the grid, heatmap and badges already use, so a colour
//   means the same thing everywhere in the module. Assigning fresh categorical
//   slots here would have made "green" mean one thing in the table and another
//   in the chart.
//
// • Dark mode is SELECTED, not flipped. The light hexes (#10b981 / #f59e0b)
//   measure OKLCH L 0.70 and 0.77 — outside the dark band — so dark uses darker
//   steps of the same hues, validated as their own set.
//
//   Validator results (surface #FFFFFF light / #0D0D12 dark):
//     light categorical #10b981,#f59e0b,#3b82f6 → PASS, contrast WARN (<3:1)
//     dark  categorical #059669,#d97706,#3987e5 → PASS, CVD ΔE 7.9 (6–8 band)
//     light ordinal     #86b6ef,#3987e5,#1c5cab → PASS
//     dark  ordinal     #86b6ef,#2a78d6,#184f95 → PASS
//
//   The light WARN obliges visible labels or a table view; the dark 6–8 CVD band
//   is legal only WITH secondary encoding. Both are discharged the same way: a
//   legend is always present, segments are separated by a 2px surface gap, wide
//   segments carry direct labels, and a full table view is one click away.
//
// • Forms are chosen by the data's job: headline counts are stat tiles (not a
//   bar chart of five numbers); absorption is a meter (a single ratio against a
//   limit); composition is a stacked bar (never a pie); velocity is COLUMNS, not
//   a line — weekly buckets are discrete and often sparse, and a line between
//   two distant weeks would imply sales that did not happen.
//
// • One filter row above everything, so every figure describes the same slice.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaChartBar, FaTable, FaChartArea } from "react-icons/fa";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  isDark: boolean;
  t: any;
}

// ── Palette (validated; see header) ──────────────────────────────────────────
const SERIES = {
  light: { available: "#10b981", on_hold: "#f59e0b", sold: "#3b82f6" },
  dark: { available: "#059669", on_hold: "#d97706", sold: "#3987e5" },
};
// Ordinal ramp for the ageing buckets. On light, heavier = darker; on dark,
// heavier = lighter, because prominence against the surface is what carries
// "this stock has been sitting longest".
const AGE_RAMP = {
  light: ["#86b6ef", "#3987e5", "#1c5cab"],
  dark: ["#184f95", "#2a78d6", "#86b6ef"],
};

const SERIES_LABEL: Record<string, string> = {
  available: "Available", on_hold: "On hold", sold: "Sold",
};
const SERIES_ORDER = ["available", "on_hold", "sold"] as const;
type SeriesKey = typeof SERIES_ORDER[number];

const nf = (n: any) => Number(n || 0).toLocaleString("en-IN");
// Stat-tile values use proportional figures and compact above 10 lakh — a raw
// ₹1,24,00,000 in a tile is unreadable at a glance.
const compactINR = (v: any) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n === 0) return "₹0";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

export default function InventoryAnalyticsModal({ isOpen, onClose, isDark, t }: Props) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState("");
  const [days, setDays] = useState("90");
  const [asTable, setAsTable] = useState(false);

  const C = isDark ? SERIES.dark : SERIES.light;
  const RAMP = isDark ? AGE_RAMP.dark : AGE_RAMP.light;
  // The surface the marks sit on — it is what the 2px separator gaps are painted
  // in, so it must match the card behind them exactly.
  const surface = isDark ? "#0D0D12" : "#FFFFFF";
  const grid = isDark ? "#2c2c2a" : "#e1e0d9";
  const muted = "#898781";

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams({ days });
      if (projectId) qs.set("project_id", projectId);
      const res = await fetch(`/api/inventory/analytics?${qs}`, { credentials: "include" });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.message || "Could not load analytics");
      setData(json.data);
    } catch (e: any) { setErr(e?.message || "Could not load analytics"); }
    finally { setLoading(false); }
  }, [projectId, days]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/inventory/projects", { credentials: "include" })
      .then(r => r.json()).then(j => { if (j?.success) setProjects(j.data || []); })
      .catch(() => { /* the filter degrades to "All projects" */ });
  }, [isOpen]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const totals = data?.totals || {};

  // Normalise the API shapes into one {key, label, available, on_hold, sold} list
  // so a single stacked-bar renderer serves both type and tower.
  //
  // `key` is separate from `label` on purpose. The analytics query groups towers
  // by (project, tower), and a tower called "A" exists in almost every project —
  // so the tower NAME alone is neither a unique React key nor an unambiguous
  // label. The index is folded in as a final guard, since GROUP BY also treats
  // NULL and '' as different rows that both display as "—".
  const composition = useCallback((rows: any[], labelKey: string, scopeKey?: string) =>
    (rows || []).map((r, i) => {
      const name = String(r[labelKey] ?? "").trim() || "—";
      const scope = scopeKey ? String(r[scopeKey] ?? "").trim() : "";
      return {
        key: `${scope}|${name}|${i}`,
        label: scope ? `${scope} · ${name}` : name,
        available: Number(r.available || 0),
        on_hold: Number(r.on_hold || 0),
        sold: Number(r.sold || 0),
        total: Number(r.total || 0),
      };
    }).filter(r => r.total > 0), []);

  const byType = useMemo(() => composition(data?.by_unit_type, "unit_type"), [data, composition]);
  // Scoped by project — "A" on its own is ambiguous across five projects, and the
  // filter above may well be showing all of them at once.
  const byTower = useMemo(() => composition(data?.by_tower, "tower", "project"), [data, composition]);

  const velocity = useMemo(() => (data?.velocity || []).map((v: any) => ({
    week: String(v.week).slice(0, 10), sold: Number(v.sold || 0),
  })), [data]);
  const velMax = useMemo(() => Math.max(1, ...velocity.map((v: any) => v.sold)), [velocity]);

  const ageing = data?.ageing || { under_30d: 0, d30_90: 0, over_90d: 0 };
  const ageRows = [
    { label: "Under 30 days", value: Number(ageing.under_30d || 0) },
    { label: "30 – 90 days", value: Number(ageing.d30_90 || 0) },
    { label: "Over 90 days", value: Number(ageing.over_90d || 0) },
  ];
  const ageMax = Math.max(1, ...ageRows.map(r => r.value));

  // ── Stacked composition bar ────────────────────────────────────────────────
  // 2px surface-coloured gaps do the separating (never a stroke around a mark),
  // and a segment is only labelled when the text genuinely fits — a clipped
  // label is worse than none, and the value stays available in the table view.
  const StackBar = ({ row }: { row: any }) => {
    const total = row.available + row.on_hold + row.sold;
    if (total <= 0) return null;
    return (
      <div className="flex items-center gap-3 py-1.5">
        {/* Wide enough for "Project · Tower"; truncation is backed by the title
            attribute and by the table view, so no value is ever gated. */}
        <span className={`text-[11px] w-36 flex-shrink-0 truncate ${t.textMuted}`} title={row.label}>{row.label}</span>
        <div className="flex-1 flex h-5 rounded" style={{ background: "transparent" }}>
          {SERIES_ORDER.map((k, i) => {
            const v = row[k] as number;
            if (v <= 0) return null;
            const pct = (v / total) * 100;
            const isFirst = SERIES_ORDER.slice(0, i).every(p => (row[p] as number) <= 0);
            const isLast = SERIES_ORDER.slice(i + 1).every(p => (row[p] as number) <= 0);
            return (
              <div
                key={k}
                title={`${SERIES_LABEL[k]}: ${nf(v)} of ${nf(total)}`}
                style={{
                  width: `${pct}%`,
                  background: C[k as SeriesKey],
                  marginRight: isLast ? 0 : 2,          // the surface gap
                  borderTopLeftRadius: isFirst ? 4 : 0,
                  borderBottomLeftRadius: isFirst ? 4 : 0,
                  borderTopRightRadius: isLast ? 4 : 0,
                  borderBottomRightRadius: isLast ? 4 : 0,
                }}
                className="h-5 flex items-center justify-center overflow-visible"
              >
                {/* Only label a segment wide enough to hold the number. White ink
                    inside a saturated fill always clears contrast. */}
                {pct >= 14 && (
                  <span className="text-[10px] font-bold text-white leading-none">{nf(v)}</span>
                )}
              </div>
            );
          })}
        </div>
        <span className={`text-[11px] font-bold w-10 text-right flex-shrink-0 ${t.text}`} style={{ fontVariantNumeric: "tabular-nums" }}>{nf(total)}</span>
      </div>
    );
  };

  const Legend = () => (
    <div className="flex items-center gap-4 flex-wrap mb-2">
      {SERIES_ORDER.map(k => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: C[k] }} />
          {/* Text wears text tokens, never the series colour. */}
          <span className={`text-[10px] font-semibold ${t.textMuted}`}>{SERIES_LABEL[k]}</span>
        </span>
      ))}
    </div>
  );

  const Card = ({ title, subtitle, children }: any) => (
    <div className={`rounded-xl border p-3.5 ${t.innerBlock}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>{title}</p>
      {subtitle && <p className={`text-[10px] mb-2 ${t.textFaint}`}>{subtitle}</p>}
      <div className={subtitle ? "" : "mt-2"}>{children}</div>
    </div>
  );

  const Tile = ({ label, value, tone }: { label: string; value: any; tone?: string }) => (
    <div className={`rounded-xl border p-3 ${t.innerBlock}`}>
      <p className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>{label}</p>
      {/* Proportional figures — tabular-nums makes a standalone number look loose. */}
      <p className={`text-xl font-bold mt-0.5 ${tone ? "" : t.text}`} style={tone ? { color: tone } : undefined}>{value}</p>
    </div>
  );

  const selectCls = `rounded-lg px-2.5 py-1.5 text-xs border cursor-pointer ${t.inputInner} ${t.text} ${t.inputFocus}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ scale: 0.97, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, y: 12 }}
            className={`w-full max-w-5xl max-h-[90vh] rounded-4xl border shadow-2xl flex flex-col overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>

            <div className={`flex items-center justify-between px-5 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                <h2 className={`text-base font-bold flex items-center gap-2 ${t.text}`}>
                  <FaChartBar className="text-[#00AEEF]" /> Inventory Analytics
                </h2>
                <p className={`text-[11px] ${t.textMuted}`}>Stock position, absorption and sales velocity</p>
              </div>
              <button onClick={onClose} className={`p-2 rounded-xl ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
            </div>

            {/* One filter row above everything it scopes — never per-chart filters. */}
            <div className={`px-5 py-2.5 border-b flex items-center gap-2 flex-wrap ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} className={selectCls}>
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={days} onChange={e => setDays(e.target.value)} className={selectCls}>
                {[["30", "Last 30 days"], ["90", "Last 90 days"], ["180", "Last 6 months"], ["365", "Last year"]].map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <div className="flex-1" />
              <button onClick={() => setAsTable(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${t.tableBorder} ${t.text}`}>
                {asTable ? <><FaChartArea className="text-[10px]" /> Charts</> : <><FaTable className="text-[10px]" /> Table view</>}
              </button>
            </div>

            {/* Refetch holds the previous render at reduced opacity — no skeleton flash. */}
            <div className={`flex-1 overflow-y-auto p-5 transition-opacity ${loading && data ? "opacity-60" : ""}`}>
              {err && <p className="text-red-500 text-xs mb-3">{err}</p>}
              {loading && !data ? (
                <p className={`text-sm italic ${t.textFaint}`}>Loading…</p>
              ) : !data ? null : totals.total_units === 0 ? (
                <div className={`rounded-xl border p-4 ${t.innerBlock}`}>
                  <p className={`text-sm font-semibold ${t.text}`}>No inventory in this scope</p>
                  <p className={`text-[11px] mt-1 ${t.textMuted}`}>Add units or bulk-generate a building to see stock analytics.</p>
                </div>
              ) : (
                <>
                  {/* ── KPI row: headline counts are tiles, not a bar chart ── */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                    <Tile label="Total units" value={nf(totals.total_units)} />
                    <Tile label="Available" value={nf(totals.available)} tone={C.available} />
                    <Tile label="On hold" value={nf(totals.on_hold)} tone={C.on_hold} />
                    <Tile label="Sold" value={nf(totals.sold)} tone={C.sold} />
                    <Tile label="Unsold value" value={compactINR(totals.available_value)} />
                  </div>

                  {/* ── Absorption: one ratio against a limit → a meter ── */}
                  <div className={`rounded-xl border p-3.5 mb-4 ${t.innerBlock}`}>
                    <div className="flex items-baseline justify-between mb-2">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>Absorption</p>
                      <p className={`text-2xl font-bold ${t.text}`}>{totals.absorption_pct}%</p>
                    </div>
                    {/* Unfilled track is a lighter step of the fill's own ramp, so
                        state reads across the whole bar. */}
                    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: isDark ? "#184f95" : "#cde2fb" }}>
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, Math.max(0, Number(totals.absorption_pct) || 0))}%`,
                        background: C.sold,
                      }} />
                    </div>
                    <p className={`text-[10px] mt-1.5 ${t.textFaint}`}>
                      {nf(totals.sold)} of {nf(totals.total_units)} units sold or registered
                    </p>
                  </div>

                  {asTable ? (
                    /* ── Table view: the WCAG-clean twin. Every charted value is
                          reachable here, which is what discharges the light-mode
                          contrast WARN. ── */
                    <div className={`rounded-xl border overflow-hidden ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                      <table className="w-full text-left" style={{ fontVariantNumeric: "tabular-nums" }}>
                        <thead>
                          <tr className={isDark ? "bg-[#121218]" : "bg-[#F8FAFC]"}>
                            {["Breakdown", "Available", "On hold", "Sold", "Total"].map(h => (
                              <th key={h} className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${t.textMuted}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[["Configuration", byType], ["Tower", byTower]].map(([groupLabel, rows]: any) => (
                            <React.Fragment key={groupLabel}>
                              <tr><td colSpan={5} className={`px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest ${t.textFaint}`}>{groupLabel}</td></tr>
                              {rows.map((r: any) => (
                                <tr key={groupLabel + r.key} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                                  <td className={`px-3 py-1.5 text-xs font-semibold ${t.text}`}>{r.label}</td>
                                  <td className={`px-3 py-1.5 text-xs ${t.textMuted}`}>{nf(r.available)}</td>
                                  <td className={`px-3 py-1.5 text-xs ${t.textMuted}`}>{nf(r.on_hold)}</td>
                                  <td className={`px-3 py-1.5 text-xs ${t.textMuted}`}>{nf(r.sold)}</td>
                                  <td className={`px-3 py-1.5 text-xs font-bold ${t.text}`}>{nf(r.total)}</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          ))}
                          <tr><td colSpan={5} className={`px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest ${t.textFaint}`}>Sales velocity</td></tr>
                          {velocity.length === 0 ? (
                            <tr><td colSpan={5} className={`px-3 py-1.5 text-xs ${t.textFaint}`}>No sales in this window</td></tr>
                          ) : velocity.map((v: any) => (
                            <tr key={v.week} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                              <td className={`px-3 py-1.5 text-xs font-semibold ${t.text}`}>Week of {v.week}</td>
                              <td colSpan={3} />
                              <td className={`px-3 py-1.5 text-xs font-bold ${t.text}`}>{nf(v.sold)}</td>
                            </tr>
                          ))}
                          <tr><td colSpan={5} className={`px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest ${t.textFaint}`}>Available stock ageing</td></tr>
                          {ageRows.map(r => (
                            <tr key={r.label} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                              <td className={`px-3 py-1.5 text-xs font-semibold ${t.text}`}>{r.label}</td>
                              <td colSpan={3} />
                              <td className={`px-3 py-1.5 text-xs font-bold ${t.text}`}>{nf(r.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <Card title="By configuration" subtitle="Which unit types are moving">
                        <Legend />
                        {byType.length === 0
                          ? <p className={`text-[11px] italic ${t.textFaint}`}>No units.</p>
                          : byType.map(r => <StackBar key={r.key} row={r} />)}
                      </Card>

                      <Card title="By tower" subtitle="Stock position per tower">
                        <Legend />
                        {byTower.length === 0
                          ? <p className={`text-[11px] italic ${t.textFaint}`}>No units.</p>
                          : byTower.map(r => <StackBar key={r.key} row={r} />)}
                      </Card>

                      {/* Columns, not a line: weekly buckets are discrete and often
                          sparse, and a line between two distant weeks would draw
                          sales that never happened. */}
                      <Card title="Sales velocity" subtitle={`Units entering a sold status · last ${data.window_days} days`}>
                        {velocity.length === 0 ? (
                          <p className={`text-[11px] italic ${t.textFaint}`}>No sales in this window.</p>
                        ) : (
                          <div className="flex items-end gap-2 h-32 pt-4 border-b" style={{ borderColor: grid }}>
                            {velocity.map((v: any) => (
                              <div key={v.week} className="flex-1 flex flex-col items-center justify-end h-full" title={`Week of ${v.week}: ${v.sold} sold`}>
                                {/* Value on the cap — few enough columns that every
                                    one can be labelled without becoming noise. */}
                                <span className={`text-[10px] font-bold mb-1 ${t.text}`}>{v.sold}</span>
                                <div style={{
                                  height: `${(v.sold / velMax) * 100}%`,
                                  maxWidth: 24, width: "100%",
                                  background: C.sold,
                                  borderTopLeftRadius: 4, borderTopRightRadius: 4,
                                }} />
                              </div>
                            ))}
                          </div>
                        )}
                        {velocity.length > 0 && (
                          <div className="flex gap-2 mt-1">
                            {velocity.map((v: any) => (
                              <span key={v.week} className={`flex-1 text-center text-[9px] ${t.textFaint}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                                {v.week.slice(5)}
                              </span>
                            ))}
                          </div>
                        )}
                      </Card>

                      <Card title="Available stock ageing" subtitle="How long unsold units have been on the books">
                        {ageRows.map((r, i) => (
                          <div key={r.label} className="flex items-center gap-3 py-1.5">
                            <span className={`text-[11px] w-24 flex-shrink-0 ${t.textMuted}`}>{r.label}</span>
                            <div className="flex-1 h-5 flex items-center">
                              <div style={{
                                width: `${(r.value / ageMax) * 100}%`,
                                background: RAMP[i],
                                borderTopRightRadius: 4, borderBottomRightRadius: 4,
                              }} className="h-5 min-w-[2px]" />
                            </div>
                            <span className={`text-[11px] font-bold w-8 text-right flex-shrink-0 ${t.text}`} style={{ fontVariantNumeric: "tabular-nums" }}>{nf(r.value)}</span>
                          </div>
                        ))}
                      </Card>

                      {(data.active_holds || []).length > 0 && (
                        <div className="lg:col-span-2">
                          <Card title="Active holds" subtitle="Who is holding what, and until when">
                            <table className="w-full text-left" style={{ fontVariantNumeric: "tabular-nums" }}>
                              <thead>
                                <tr>
                                  {["Flat", "Held by", "For", "Expires"].map(h => (
                                    <th key={h} className={`py-1 text-[10px] font-bold uppercase tracking-wider ${t.textMuted}`}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {data.active_holds.map((h: any) => (
                                  <tr key={h.id} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                                    <td className={`py-1.5 text-xs font-semibold ${t.text}`}>{h.flat_no} · {h.tower}</td>
                                    <td className={`py-1.5 text-xs ${t.textMuted}`}>{h.held_by || "—"}</td>
                                    <td className={`py-1.5 text-xs ${t.textMuted}`}>{h.held_for_lead_name || (h.held_for_lead_id ? `Lead #${h.held_for_lead_id}` : "—")}</td>
                                    <td className={`py-1.5 text-xs ${t.textMuted}`}>
                                      {h.hold_expires_at ? new Date(h.hold_expires_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </Card>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
