"use client";
// TDSTracker.tsx — Section 194-IA TDS deduction tracking for a booking.
// Renders only for bookings ≥ ₹50L and for admin / site_head roles (gated by parent).
import React, { useState } from "react";
import { formatCurrencyDisplay } from "@/lib/currency";
import { FaPlus, FaEdit, FaCheckCircle, FaHourglassHalf, FaTimes } from "react-icons/fa";

interface TDSRecord {
  id: number;
  tds_amount: number | string;
  tds_rate: number | string;
  form_26qb_filed: boolean;
  form_26qb_date: string | null;
  acknowledgement_no: string | null;
  buyer_pan: string | null;
  seller_pan: string | null;
  financial_year: string | null;
  quarter: string | null;
}

interface TDSTrackerProps {
  bookingId: number | string;
  agreementValue: number;
  initialRecords: any[];
  userRole: string;
  userName: string;
  isDark?: boolean;
}

const blankForm = {
  payment_amount: "",
  tds_rate: "1",
  tds_amount: "",
  form_26qb_filed: false,
  form_26qb_date: "",
  acknowledgement_no: "",
  buyer_pan: "",
  seller_pan: "",
};

function num(v: any): number {
  const n = parseFloat(String(v ?? "").replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

export default function TDSTracker({ bookingId, agreementValue, initialRecords, userRole, userName, isDark = false }: TDSTrackerProps) {
  const [records, setRecords] = useState<TDSRecord[]>(Array.isArray(initialRecords) ? initialRecords : []);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...blankForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = ["admin", "site_head", "site head"].includes((userRole || "").trim().toLowerCase());

  // ── Theme ──
  const textMain = isDark ? "text-white" : "text-[#1A1A1A]";
  const textMuted = isDark ? "text-[#888899]" : "text-[#6B7280]";
  const accent = isDark ? "text-[#d4006e]" : "text-[#9E217B]";
  const cardBg = isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]";
  const sectionTitle = `text-xs font-bold uppercase tracking-wider ${accent}`;
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white focus:border-[#9E217B]" : "bg-white border-[#9CA3AF] text-[#1A1A1A] focus:border-[#00AEEF]"}`;
  const labelCls = `block text-[10px] font-semibold mb-1 uppercase ${textMuted}`;
  const btnPrimary = isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white";

  // ── Derived totals ──
  const expectedTds = agreementValue * 0.01;
  const recordedTds = records.reduce((s, r) => s + num(r.tds_amount), 0);
  const pendingTds = Math.max(expectedTds - recordedTds, 0);

  // Payment amount implied by a TDS line = tds / rate × 100 (TDS is 1% of the payment).
  const impliedPayment = (r: TDSRecord) => {
    const rate = num(r.tds_rate) || 1;
    return (num(r.tds_amount) * 100) / rate;
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...blankForm });
    setError(null);
    setShowForm(true);
  };

  const openEdit = (r: TDSRecord) => {
    setEditingId(r.id);
    setForm({
      payment_amount: String(Math.round(impliedPayment(r)) || ""),
      tds_rate: String(num(r.tds_rate) || 1),
      tds_amount: String(num(r.tds_amount) || ""),
      form_26qb_filed: !!r.form_26qb_filed,
      form_26qb_date: r.form_26qb_date ? String(r.form_26qb_date).split("T")[0] : "",
      acknowledgement_no: r.acknowledgement_no || "",
      buyer_pan: r.buyer_pan || "",
      seller_pan: r.seller_pan || "",
    });
    setError(null);
    setShowForm(true);
  };

  // Auto-derive TDS from payment × rate whenever either changes (still user-overridable).
  const setPayment = (val: string) => {
    const payment = num(val);
    const rate = num(form.tds_rate) || 1;
    setForm(f => ({ ...f, payment_amount: val, tds_amount: payment > 0 ? String(Math.round(payment * rate / 100)) : f.tds_amount }));
  };
  const setRate = (val: string) => {
    const payment = num(form.payment_amount);
    const rate = num(val) || 0;
    setForm(f => ({ ...f, tds_rate: val, tds_amount: payment > 0 && rate > 0 ? String(Math.round(payment * rate / 100)) : f.tds_amount }));
  };

  const save = async () => {
    setError(null);
    if (num(form.tds_amount) <= 0) { setError("TDS amount must be greater than zero."); return; }
    setSaving(true);
    try {
      const payload: any = {
        tds_amount: num(form.tds_amount),
        tds_rate: num(form.tds_rate) || 1,
        form_26qb_filed: form.form_26qb_filed,
        form_26qb_date: form.form_26qb_date || null,
        acknowledgement_no: form.acknowledgement_no || null,
        buyer_pan: form.buyer_pan || null,
        seller_pan: form.seller_pan || null,
        user_name: userName,
        user_role: userRole,
      };
      if (editingId) payload.record_id = editingId;

      const res = await fetch(`/api/booking-applications/${bookingId}/tds`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to save TDS record");

      // Refresh the list from the server so totals stay authoritative.
      const listRes = await fetch(`/api/booking-applications/${bookingId}/tds`);
      const listJson = await listRes.json();
      if (listJson.success) setRecords(listJson.data);

      setShowForm(false);
      setEditingId(null);
      setForm({ ...blankForm });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
  };

  const Tile = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div className={`px-4 py-3 rounded-xl border ${isDark ? "border-[#2A2A35] bg-[#14141B]" : "border-[#E5E7EB] bg-[#F8FAFC]"}`}>
      <p className={`text-[10px] font-semibold uppercase ${textMuted}`}>{label}</p>
      <p className={`text-base font-bold ${color || textMain}`}>{value}</p>
    </div>
  );

  return (
    <div className={`rounded-2xl border p-5 ${cardBg}`}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className={sectionTitle}>TDS Deductions (Section 194-IA)</p>
        {canEdit && !showForm && (
          <button onClick={openCreate} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${btnPrimary}`}>
            <FaPlus className="text-[10px]" /> Record TDS
          </button>
        )}
      </div>

      <p className={`text-[11px] mb-4 ${textMuted}`}>
        Applicable: <span className="font-bold text-green-500">Yes</span> (Agreement &gt; ₹50L) · Rate: 1% ·
        Buyer must file Form 26QB and deduct 1% TDS on each payment.
      </p>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile label="Total TDS Expected" value={formatCurrencyDisplay(String(Math.round(expectedTds)))} />
        <Tile label="Total TDS Recorded" value={formatCurrencyDisplay(String(Math.round(recordedTds)))} color="text-green-500" />
        <Tile label="Pending" value={formatCurrencyDisplay(String(Math.round(pendingTds)))} color={pendingTds > 0 ? "text-amber-500" : "text-green-500"} />
      </div>

      {/* Records table */}
      {records.length === 0 ? (
        <p className={`text-xs italic ${textMuted} mb-1`}>No TDS deductions recorded yet.</p>
      ) : (
        <div className={`rounded-xl border overflow-x-auto ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className={isDark ? "bg-[#1A1A28]" : "bg-[#F8FAFC]"}>
                <th className={`text-left px-3 py-2 text-xs font-bold w-8 ${textMuted}`}>#</th>
                <th className={`text-right px-3 py-2 text-xs font-bold ${textMuted}`}>Payment</th>
                <th className={`text-right px-3 py-2 text-xs font-bold ${textMuted}`}>TDS</th>
                <th className={`text-left px-3 py-2 text-xs font-bold ${textMuted}`}>26QB</th>
                <th className={`text-left px-3 py-2 text-xs font-bold ${textMuted}`}>Ack No.</th>
                <th className={`text-left px-3 py-2 text-xs font-bold ${textMuted}`}>FY / Qtr</th>
                {canEdit && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={r.id} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#F1F5F9]"}`}>
                  <td className={`px-3 py-2 text-xs ${textMuted}`}>{i + 1}</td>
                  <td className={`px-3 py-2 text-xs text-right ${textMain}`}>{formatCurrencyDisplay(String(Math.round(impliedPayment(r))))}</td>
                  <td className={`px-3 py-2 text-xs text-right font-bold ${textMain}`}>{formatCurrencyDisplay(String(num(r.tds_amount)))}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.form_26qb_filed ? (
                      <span className="inline-flex items-center gap-1 text-green-500 font-semibold"><FaCheckCircle className="text-[10px]" /> Filed</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-500 font-semibold"><FaHourglassHalf className="text-[10px]" /> Pending</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-xs ${textMain}`}>{r.acknowledgement_no || "—"}</td>
                  <td className={`px-3 py-2 text-xs ${textMuted}`}>{r.financial_year || "—"}{r.quarter ? ` · ${r.quarter}` : ""}</td>
                  {canEdit && (
                    <td className="px-2 py-2">
                      <button onClick={() => openEdit(r)} className={`${textMuted} hover:${accent} cursor-pointer`} title="Edit"><FaEdit className="text-xs" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit form */}
      {showForm && canEdit && (
        <div className={`mt-4 rounded-xl border p-4 ${isDark ? "border-[#9E217B]/30 bg-[#14141B]" : "border-[#00AEEF]/30 bg-[#F8FAFC]"}`}>
          <div className="flex items-center justify-between mb-3">
            <p className={`text-xs font-bold uppercase ${accent}`}>{editingId ? "Edit TDS Record" : "Record TDS Deduction"}</p>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className={`${textMuted} cursor-pointer`}><FaTimes /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Payment Amount (₹)</label>
              <input type="text" value={form.payment_amount} onChange={e => setPayment(e.target.value)} placeholder="5,00,000" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>TDS Rate (%)</label>
              <input type="number" step="0.01" value={form.tds_rate} onChange={e => setRate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>TDS Amount (₹)</label>
              <input type="text" value={form.tds_amount} onChange={e => setForm(f => ({ ...f, tds_amount: e.target.value }))} placeholder="5,000" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Form 26QB Date</label>
              <input type="date" value={form.form_26qb_date} onChange={e => setForm(f => ({ ...f, form_26qb_date: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Acknowledgement No.</label>
              <input value={form.acknowledgement_no} onChange={e => setForm(f => ({ ...f, acknowledgement_no: e.target.value }))} placeholder="TDS-2026-001" className={inputCls} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input type="checkbox" checked={form.form_26qb_filed} onChange={e => setForm(f => ({ ...f, form_26qb_filed: e.target.checked }))} className="w-4 h-4 cursor-pointer" />
                <span className={`text-xs font-semibold ${textMain}`}>Form 26QB Filed</span>
              </label>
            </div>
            <div>
              <label className={labelCls}>Buyer PAN</label>
              <input value={form.buyer_pan} onChange={e => setForm(f => ({ ...f, buyer_pan: e.target.value.toUpperCase() }))} placeholder="ABCDE1234F" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Seller PAN</label>
              <input value={form.seller_pan} onChange={e => setForm(f => ({ ...f, seller_pan: e.target.value.toUpperCase() }))} placeholder="ABCDE1234F" className={inputCls} />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={save} disabled={saving} className={`text-xs font-bold px-4 py-2 rounded-lg cursor-pointer transition-colors disabled:opacity-50 ${btnPrimary}`}>
              {saving ? "Saving…" : editingId ? "Update" : "Save TDS Record"}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className={`text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer border ${isDark ? "border-[#2A2A35] text-[#888899] hover:text-white" : "border-[#9CA3AF] text-[#6B7280] hover:bg-[#F1F5F9]"}`}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
