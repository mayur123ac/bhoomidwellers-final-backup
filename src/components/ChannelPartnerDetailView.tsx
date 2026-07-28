"use client";
// ChannelPartnerDetailView.tsx — CP Commission Phase 4.
// One partner's commission history, their FY position against the TDS threshold,
// and the entry point for recording a commission by hand.
import React, { useCallback, useEffect, useState } from "react";
import { FaArrowLeft, FaPlus, FaUndo, FaExclamationTriangle, FaPen, FaSyncAlt } from "react-icons/fa";
import { formatCurrencyDecimal } from "@/lib/currency";
import ManualCommissionEntryModal from "./ManualCommissionEntryModal";
import EditCommissionModal from "./EditCommissionModal";
import type { ChannelPartner } from "./ChannelPartnerFormModal";

interface CommissionRow {
  id: number;
  booking_id: number;
  booking_number: string | null;
  buyer_name: string | null;
  gross_commission_amount: string;
  tds_percent: string;
  tds_amount: string;
  net_payable_amount: string;
  status: string;
  commission_source: string | null;
  is_override: boolean | null;
  override_reason: string | null;
  reversal_reason: string | null;
  created_at: string;
}

interface FySummary { label: string; total: string; thresholdInr: number; }

interface Props {
  partner: ChannelPartner;
  onBack: () => void;
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
}

export default function ChannelPartnerDetailView({ partner, onBack, user, isDark, t }: Props) {
  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase());

  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [fy, setFy] = useState<FySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [reversing, setReversing] = useState<CommissionRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CommissionRow | null>(null);
  const [cascadeBusy, setCascadeBusy] = useState(false);
  const [cascadeMsg, setCascadeMsg] = useState<string | null>(null);

  // Correcting a recorded payable is admin-only — the wrong rate is typically
  // entered by a sales manager, so they must not be able to correct it themselves.
  const isAdmin = (user?.role || "").trim().toLowerCase() === "admin";

  // Re-applies the partner's current rate to every open, non-override commission.
  const recalcAll = async () => {
    setCascadeBusy(true); setCascadeMsg(null);
    try {
      const res = await fetch(`/api/channel-partners/${partner.id}/recalculate-commissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: user.name, user_role: user.role, updated_by: user.name }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setCascadeMsg(json.message || "Could not recalculate."); return; }
      setCascadeMsg(
        json.updatedCount === 0
          ? "Nothing to recalculate — open commissions are all overrides or already match."
          : `Recalculated ${json.updatedCount} commission(s) at ${json.rate}%.`
      );
      fetchAll();
    } catch (e: any) {
      setCascadeMsg(e?.message || "Network error.");
    } finally { setCascadeBusy(false); }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/channel-partners/${partner.id}/commissions`);
      const json = await res.json();
      if (json.success) { setRows(json.data); setFy(json.fySummary); }
    } catch { /* non-blocking */ } finally { setLoading(false); }
  }, [partner.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const doReverse = async () => {
    if (!reversing || !reason.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/cp-commissions/${reversing.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), user_name: user.name, updated_by: user.name }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.message || "Reversal failed."); return; }
      setReversing(null); setReason("");
      fetchAll();
    } catch (e: any) { setError(e.message || "Network error."); }
    finally { setBusy(false); }
  };

  const total = Number(fy?.total ?? 0);
  const threshold = fy?.thresholdInr ?? 20000;
  const pct = Math.min(100, threshold > 0 ? (total / threshold) * 100 : 0);
  const over = total > threshold;

  const statusChip = (s: string) => {
    const map: Record<string, string> = {
      accrued: "bg-sky-500/15 text-sky-500",
      due: "bg-amber-500/15 text-amber-500",
      paid: "bg-emerald-500/15 text-emerald-500",
      reversed: "bg-gray-500/15 text-gray-500",
    };
    return map[s] || "bg-gray-500/15 text-gray-500";
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-1">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-2 pt-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg cursor-pointer ${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}`}>
            <FaArrowLeft className="text-xs" />
          </button>
          <div>
            <h2 className={`text-base font-bold ${t.text}`}>{partner.name}</h2>
            <p className={`text-[11px] ${t.textMuted}`}>
              {partner.company_name || "—"}
              {partner.phone ? ` · ${partner.phone}` : ""}
              {" · "}
              {partner.default_commission_rate === null
                ? <span className="text-amber-500 font-bold">no rate set</span>
                : `${partner.default_commission_rate}%`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && partner.default_commission_rate !== null && rows.some(r => r.status === "accrued" || r.status === "due") && (
            <button onClick={recalcAll} disabled={cascadeBusy}
              title={`Re-apply ${partner.default_commission_rate}% to open commissions`}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"} ${cascadeBusy ? "opacity-50" : ""}`}>
              <FaSyncAlt className="text-[10px]" /> {cascadeBusy ? "Recalculating..." : "Re-apply rate"}
            </button>
          )}
          {canManage && (
            <button onClick={() => setAddOpen(true)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary}`}>
              <FaPlus className="text-[10px]" /> Add Commission
            </button>
          )}
        </div>
      </div>

      {/* ── FY threshold progress ── */}
      {fy && (
        <div className={`mx-2 mb-4 rounded-xl p-4 ${t.card}`}>
          <div className="flex items-center justify-between mb-2">
            <p className={`text-xs font-bold ${t.text}`}>{fy.label} commission total</p>
            <p className={`text-xs font-bold ${t.text}`}>
              {formatCurrencyDecimal(fy.total)}
              <span className={`font-normal ${t.textFaint}`}> / {formatCurrencyDecimal(String(threshold))} threshold</span>
            </p>
          </div>
          <div className={`h-2 rounded-full overflow-hidden ${isDark ? "bg-[#252525]" : "bg-slate-200"}`}>
            <div className={`h-full rounded-full transition-all ${over ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className={`text-[10px] mt-2 ${t.textMuted}`}>
            {over
              ? `Over the ₹${threshold.toLocaleString("en-IN")} threshold — 2% TDS applies to new commissions this FY. Earlier ones are not affected.`
              : `Under the ₹${threshold.toLocaleString("en-IN")} threshold — no TDS yet. Counts every non-reversed commission, manual and automatic alike.`}
          </p>
        </div>
      )}

      {cascadeMsg && (
        <div className={`mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] ${isDark ? "bg-sky-500/10 text-sky-400" : "bg-sky-50 text-sky-700"}`}>
          {cascadeMsg}
        </div>
      )}

      {/* ── Commissions table ── */}
      <div className={`flex-1 overflow-auto mx-2 rounded-xl ${t.card}`}>
        <table className="w-full text-left border-collapse">
          <thead className={`sticky top-0 z-10 ${t.tableHead || (isDark ? "bg-[#1a1a1a]" : "bg-slate-50")}`}>
            <tr className={`text-[11px] uppercase ${t.textMuted}`}>
              {["Booking", "Gross", "TDS", "Net", "Source", "Status", "Date", ""].map(h => (
                <th key={h} className="px-4 py-3 whitespace-nowrap font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className={`px-4 py-10 text-center text-xs ${t.textFaint}`}>Loading...</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-16 text-center">
                <p className={`text-sm font-bold mb-1 ${t.text}`}>No commissions yet</p>
                <p className={`text-xs ${t.textMuted}`}>Record one against any booking attributed to this partner.</p>
              </td></tr>
            )}
            {!loading && rows.map(r => {
              const isReversed = r.status === "reversed";
              return (
                <tr key={r.id} className={`text-xs ${t.tableRow} ${isDark ? "border-b border-[#222]" : ""} ${isReversed ? "opacity-60" : ""}`}>
                  <td className={`px-4 py-3 ${t.text}`}>
                    <span className="font-bold">{r.booking_number || `#${r.booking_id}`}</span>
                    {r.buyer_name && <span className={`block text-[10px] ${t.textFaint}`}>{r.buyer_name}</span>}
                  </td>
                  <td className={`px-4 py-3 font-bold ${t.text}`}>{formatCurrencyDecimal(r.gross_commission_amount)}</td>
                  <td className={`px-4 py-3 ${t.textMuted}`}>
                    {Number(r.tds_percent) === 0 ? <span className={t.textFaint}>—</span> : `${r.tds_percent}% · ${formatCurrencyDecimal(r.tds_amount)}`}
                  </td>
                  <td className={`px-4 py-3 font-bold ${t.text}`}>{formatCurrencyDecimal(r.net_payable_amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.commission_source === "manual" ? "bg-purple-500/15 text-purple-500" : "bg-slate-500/15 text-slate-500"}`}>
                      {r.commission_source === "manual" ? "Manual" : "Auto"}
                    </span>
                    {r.is_override && (
                      <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500" title={r.override_reason || ""}>
                        Override
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusChip(r.status)}`} title={r.reversal_reason || ""}>
                      {r.status}
                    </span>
                  </td>
                  <td className={`px-4 py-3 whitespace-nowrap ${t.textFaint}`}>{new Date(r.created_at).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && !isReversed && r.status !== "paid" && (
                      <button onClick={() => setEditing(r)}
                        className={`px-3 py-1.5 mr-1 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}`}>
                        <FaPen className="inline text-[9px] mr-1" /> Edit
                      </button>
                    )}
                    {canManage && !isReversed && r.status !== "paid" && (
                      <button onClick={() => { setReversing(r); setReason(""); setError(null); }}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}`}>
                        <FaUndo className="inline text-[9px] mr-1" /> Reverse
                      </button>
                    )}
                    {r.status === "paid" && <span className={`text-[10px] ${t.textFaint}`}>paid — manual correction only</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Reverse confirmation ── */}
      {reversing && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setReversing(null)}>
          <div onClick={e => e.stopPropagation()} className={`w-full max-w-md rounded-2xl p-6 ${t.modalCard || t.card}`}>
            <div className="flex items-center gap-2 mb-3">
              <FaExclamationTriangle className="text-amber-500 text-sm" />
              <h3 className={`text-base font-bold ${t.text}`}>Reverse commission</h3>
            </div>
            <p className={`text-xs mb-4 ${t.textMuted}`}>
              Commission #{reversing.id} for {reversing.booking_number || `booking #${reversing.booking_id}`}
              {" "}({formatCurrencyDecimal(reversing.gross_commission_amount)}). The row is kept and marked reversed,
              and the booking becomes available for a new commission.
            </p>
            <label className={`text-[11px] mb-1 block ${t.textMuted}`}>Reason *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              className={`w-full rounded-lg px-3 py-2 text-sm outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`}
              placeholder="Why is this being reversed?" />
            {error && <p className="text-[11px] mt-2 text-red-500">{error}</p>}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button onClick={() => setReversing(null)} className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted}`}>Cancel</button>
              <button onClick={doReverse} disabled={busy || !reason.trim()}
                className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary} ${busy || !reason.trim() ? "opacity-50 cursor-not-allowed" : ""}`}>
                {busy ? "Reversing..." : "Reverse"}
              </button>
            </div>
          </div>
        </div>
      )}

      <EditCommissionModal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        onSaved={fetchAll}
        commission={editing}
        // Optional on the interface now: the API omits the rate entirely for roles
        // without commercial visibility. This view is only reachable for roles that
        // have it, so absent collapses to null — same as "no rate agreed yet".
        partnerRate={partner.default_commission_rate ?? null}
        user={user}
        isDark={isDark}
        t={t}
      />

      <ManualCommissionEntryModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={fetchAll}
        partnerId={partner.id}
        partnerName={partner.name}
        user={user}
        isDark={isDark}
        t={t}
      />
    </div>
  );
}
