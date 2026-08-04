"use client";
// OffersModal.tsx — Sell.Do parity, gap 4 UI: the negotiation queue.
//
// Shows offers awaiting a decision and the history behind them, and lets an
// authorised approver accept, reject or counter.
//
// Two server rules govern what happens here, and the UI states both rather than
// letting a user discover them via a 403:
//   • The band FROZEN on the offer decides who may approve it. A Sales Manager
//     cannot approve a discount that landed in the Admin band.
//   • Nobody decides their own request — Admin included. That is the entire
//     point of an approval step.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaHandshake, FaCheck, FaBan, FaExchangeAlt, FaInfoCircle } from "react-icons/fa";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
  /** Refresh the unit grid after a decision — an accepted offer can change stock. */
  onChanged?: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "text-amber-500 border-amber-500/30 bg-amber-500/10",
  approved: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  accepted: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  rejected: "text-red-500 border-red-500/30 bg-red-500/10",
  countered: "text-blue-500 border-blue-500/30 bg-blue-500/10",
  expired: "text-gray-500 border-gray-400/30 bg-gray-500/10",
  withdrawn: "text-gray-500 border-gray-400/30 bg-gray-500/10",
};

const money = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${Math.round(n).toLocaleString("en-IN")}` : "—";
};

const normRole = (r: unknown) => String(r ?? "").trim().toLowerCase().replace(/_/g, " ");

export default function OffersModal({ isOpen, onClose, user, isDark, t, onChanged }: Props) {
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [counterFor, setCounterFor] = useState<number | null>(null);
  const [counterPrice, setCounterPrice] = useState("");
  const [remarks, setRemarks] = useState("");

  const actor = user?.name || "";
  const actorRole = normRole(user?.role);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = tab === "pending" ? "?status=pending" : "";
      const res = await fetch(`/api/inventory/offers${qs}`, { credentials: "include" });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.message || "Could not load offers");
      setOffers(json.data || []);
    } catch (e: any) { setErr(e?.message || "Could not load offers"); }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => {
    if (!isOpen) return;
    setCounterFor(null); setCounterPrice(""); setRemarks(""); setErr(null);
    load();
  }, [isOpen, load]);

  const decide = async (id: number, decision: "approved" | "rejected" | "countered") => {
    setBusyId(id); setErr(null);
    try {
      const res = await fetch(`/api/inventory/offers/${id}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          decision,
          counter_price: decision === "countered" ? counterPrice : undefined,
          remarks: remarks.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Could not record the decision");
      setCounterFor(null); setCounterPrice(""); setRemarks("");
      await load();
      onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusyId(null); }
  };

  /**
   * Why this user cannot decide a given offer, or null if they can.
   *
   * Mirrors the server's two checks so the buttons explain themselves instead of
   * failing with a 403 after the click. The server remains the authority — this
   * is a courtesy, not the gate.
   */
  const blockedReason = (o: any): string | null => {
    if (o.status !== "pending") return null;
    if (o.requested_by && o.requested_by === actor) return "You raised this — it needs a second person.";
    const required = normRole(o.required_approver_role);
    if (required && actorRole !== "admin" && actorRole !== required) {
      return `Needs ${o.required_approver_role} approval.`;
    }
    return null;
  };

  const pendingCount = useMemo(() => offers.filter(o => o.status === "pending").length, [offers]);

  const inputCls = `w-full rounded-lg px-2.5 py-1.5 text-xs border ${t.inputInner} ${t.text} ${t.inputFocus}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ scale: 0.97, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, y: 12 }}
            className={`w-full max-w-3xl max-h-[88vh] rounded-4xl border shadow-2xl flex flex-col overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}>

            <div className={`flex items-center justify-between px-5 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                <h2 className={`text-base font-bold flex items-center gap-2 ${t.text}`}>
                  <FaHandshake className="text-[#00AEEF]" /> Offers
                </h2>
                <p className={`text-[11px] ${t.textMuted}`}>
                  {loading ? "Loading…" : `${pendingCount} awaiting a decision`}
                </p>
              </div>
              <button onClick={onClose} className={`p-2 rounded-xl ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
            </div>

            <div className={`px-5 py-2 border-b flex gap-2 ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
              {(["pending", "all"] as const).map(k => (
                <button key={k} onClick={() => setTab(k)}
                  className={`px-3 py-1 text-[11px] font-bold rounded-lg ${tab === k ? "bg-[#00AEEF] text-white" : t.textMuted}`}>
                  {k === "pending" ? "Pending" : "All"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {err && <p className="text-red-500 text-xs mb-3">{err}</p>}

              {loading ? (
                <p className={`text-sm italic ${t.textFaint}`}>Loading…</p>
              ) : offers.length === 0 ? (
                <div className={`rounded-xl border p-4 ${t.innerBlock}`}>
                  <p className={`text-sm font-semibold ${t.text}`}>
                    {tab === "pending" ? "Nothing awaiting approval" : "No offers yet"}
                  </p>
                  <p className={`text-[11px] mt-1 ${t.textMuted}`}>
                    Raise one from a unit’s cost sheet in the inventory drawer.
                  </p>
                </div>
              ) : offers.map(o => {
                const blocked = blockedReason(o);
                const canDecide = o.status === "pending" && !blocked;
                return (
                  <div key={o.id} className={`rounded-xl border p-3 mb-2.5 ${t.innerBlock}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-bold ${t.text}`}>
                          Flat {o.flat_no} · {o.tower}{o.floor != null ? ` · Floor ${o.floor}` : ""}
                        </p>
                        <p className={`text-[11px] ${t.textMuted}`}>
                          {o.project_name}
                          {o.lead_name ? ` · ${o.lead_name}` : o.lead_id ? ` · Lead #${o.lead_id}` : ""}
                          {o.requested_by ? ` · by ${o.requested_by}` : ""}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border flex-shrink-0 ${STATUS_STYLE[o.status] || STATUS_STYLE.expired}`}>
                        {o.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 flex-wrap mb-2">
                      <div>
                        <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>List</p>
                        <p className={`text-xs font-semibold ${t.text}`}>{money(o.list_price)}</p>
                      </div>
                      <div>
                        <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Offered</p>
                        <p className={`text-xs font-bold ${t.text}`}>{money(o.offered_price)}</p>
                      </div>
                      <div>
                        <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Discount</p>
                        <p className="text-xs font-bold text-red-500">
                          {money(o.discount_amount)} <span className="font-normal">({o.discount_pct}%)</span>
                        </p>
                      </div>
                      {o.required_approver_role && (
                        <div>
                          <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Band</p>
                          <p className={`text-xs font-semibold capitalize ${t.text}`}>{o.required_approver_role}</p>
                        </div>
                      )}
                      {o.counter_price != null && (
                        <div>
                          <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Countered at</p>
                          <p className="text-xs font-bold text-blue-500">{money(o.counter_price)}</p>
                        </div>
                      )}
                    </div>

                    {o.remarks && <p className={`text-[11px] mb-2 ${t.textMuted}`}>“{o.remarks}”</p>}

                    {o.status !== "pending" && o.decided_by && (
                      <p className={`text-[10px] ${t.textFaint}`}>
                        {o.status} by {o.decided_by}
                        {o.decision_remarks ? ` — ${o.decision_remarks}` : ""}
                      </p>
                    )}

                    {o.status === "pending" && (
                      blocked ? (
                        <p className={`text-[11px] flex items-center gap-1.5 ${t.textFaint}`}>
                          <FaInfoCircle className="flex-shrink-0" /> {blocked}
                        </p>
                      ) : counterFor === o.id ? (
                        <div className="mt-1">
                          <div className="flex gap-2 mb-2">
                            <input value={counterPrice} onChange={e => setCounterPrice(e.target.value.replace(/[^\d]/g, ""))}
                              placeholder="Counter price" className={inputCls} />
                            <input value={remarks} onChange={e => setRemarks(e.target.value)}
                              placeholder="Remarks (optional)" className={inputCls} />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => decide(o.id, "countered")} disabled={busyId === o.id || !counterPrice}
                              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                              {busyId === o.id ? "Saving…" : "Send Counter"}
                            </button>
                            <button onClick={() => { setCounterFor(null); setCounterPrice(""); }}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => decide(o.id, "approved")} disabled={busyId === o.id || !canDecide}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1.5">
                            <FaCheck className="text-[9px]" /> Approve
                          </button>
                          <button onClick={() => decide(o.id, "rejected")} disabled={busyId === o.id || !canDecide}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 flex items-center gap-1.5">
                            <FaBan className="text-[9px]" /> Reject
                          </button>
                          <button onClick={() => { setCounterFor(o.id); setCounterPrice(""); }} disabled={busyId === o.id || !canDecide}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${t.tableBorder} ${t.text} disabled:opacity-50 flex items-center gap-1.5`}>
                            <FaExchangeAlt className="text-[9px]" /> Counter
                          </button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
