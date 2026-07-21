"use client";
// LenderApplicationsTracker.tsx — Phase D3. Multi-bank shopping history for a lead.
// Each card is a loan_applications row (persisted immediately via the Phase C API,
// independent of the LoanDealForm save). Selecting a lender marks is_selected=true
// server-side, which copies its details into booking_loan_details / the draft (C1).
import React, { useCallback, useEffect, useState } from "react";
import { FaPlus, FaEdit, FaTrash, FaStar, FaRegStar, FaTimes } from "react-icons/fa";

export interface LoanApplication {
  id: number;
  lead_id: number;
  booking_id: number | null;
  bank_name: string;
  loan_type: string | null;
  dsa_agent_name: string | null;
  dsa_agent_contact: string | null;
  loan_executive: string | null;
  loan_reference_no: string | null;
  amount_requested: number | null;
  amount_sanctioned: number | null;
  interest_rate: number | null;
  tenure_months: number | null;
  application_date: string | null;
  status: string;
  sanction_date: string | null;
  rejection_reason: string | null;
  rejection_date: string | null;
  is_selected: boolean;
}

const STATUS_OPTS = ["Submitted", "Under Processing", "Sanctioned", "Rejected", "Withdrawn"];
const LOAN_TYPE_OPTS = ["Home Loan", "Top-Up Loan", "Balance Transfer", "Other"];

const inr = (v: any) => {
  const n = Number(v);
  return isNaN(n) || !n ? "—" : `₹${n.toLocaleString("en-IN")}`;
};
const dateOnly = (v: any) => (v ? String(v).split("T")[0] : "");

const blankForm = {
  bank_name: "", loan_type: "", dsa_agent_name: "", dsa_agent_contact: "",
  loan_executive: "", loan_reference_no: "", amount_requested: "", amount_sanctioned: "",
  interest_rate: "", tenure_months: "", application_date: "", sanction_date: "",
  status: "Submitted", rejection_reason: "", rejection_date: "",
};

interface Props {
  leadId: number | string;
  userName: string;
  userRole: string;
  isDark: boolean;
  t: any;
  // Fires whenever the list changes (load / create / edit / delete / select).
  onListChange?: (ids: number[]) => void;
  // Fires when a lender is explicitly selected — parent syncs sanction fields.
  onSelectLender?: (app: LoanApplication) => void;
}

export default function LenderApplicationsTracker({ leadId, userName, userRole, isDark, t, onListChange, onSelectLender }: Props) {
  const [apps, setApps] = useState<LoanApplication[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...blankForm });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = ["admin", "sales manager", "sales_manager", "site_head", "site head"].includes((userRole || "").trim().toLowerCase());

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  const emitList = useCallback((list: LoanApplication[]) => {
    onListChange?.(list.map(a => a.id));
  }, [onListChange]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/walkin_enquiries/${leadId}/loan-applications`);
      const json = await res.json();
      if (json.success) { setApps(json.data); emitList(json.data); }
    } catch { /* non-blocking */ }
  }, [leadId, emitList]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditingId(null); setForm({ ...blankForm }); setError(null); setShowForm(true); };
  const openEdit = (a: LoanApplication) => {
    setEditingId(a.id);
    setForm({
      bank_name: a.bank_name || "", loan_type: a.loan_type || "",
      dsa_agent_name: a.dsa_agent_name || "", dsa_agent_contact: a.dsa_agent_contact || "",
      loan_executive: a.loan_executive || "", loan_reference_no: a.loan_reference_no || "",
      amount_requested: a.amount_requested != null ? String(a.amount_requested) : "",
      amount_sanctioned: a.amount_sanctioned != null ? String(a.amount_sanctioned) : "",
      interest_rate: a.interest_rate != null ? String(a.interest_rate) : "",
      tenure_months: a.tenure_months != null ? String(a.tenure_months) : "",
      application_date: dateOnly(a.application_date), sanction_date: dateOnly(a.sanction_date),
      status: a.status || "Submitted", rejection_reason: a.rejection_reason || "", rejection_date: dateOnly(a.rejection_date),
    });
    setError(null); setShowForm(true);
  };

  const save = async () => {
    setError(null);
    if (!form.bank_name.trim()) { setError("Bank name is required."); return; }
    setBusy(true);
    try {
      const payload: any = { ...form, user_name: userName, user_role: userRole };
      const url = editingId ? `/api/loan-applications/${editingId}` : `/api/walkin_enquiries/${leadId}/loan-applications`;
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to save lender application");
      setShowForm(false); setEditingId(null); setForm({ ...blankForm });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    if (!canManage) return;
    setBusy(true);
    try {
      await fetch(`/api/loan-applications/${id}?user_role=${encodeURIComponent(userRole)}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  };

  const select = async (a: LoanApplication) => {
    if (!canManage || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/loan-applications/${a.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_selected: true, user_name: userName, user_role: userRole }),
      });
      const json = await res.json();
      if (json.success) {
        onSelectLender?.(json.data);
        await load();
      }
    } finally { setBusy(false); }
  };

  const statusChip = (s: string) => {
    const base = "text-[10px] font-bold px-2 py-0.5 rounded-full border";
    if (s === "Sanctioned") return `${base} text-emerald-500 border-emerald-500/30 bg-emerald-500/10`;
    if (s === "Rejected") return `${base} text-red-500 border-red-500/30 bg-red-500/10`;
    if (s === "Withdrawn") return `${base} text-gray-500 border-gray-400/30 bg-gray-500/10`;
    return `${base} text-amber-500 border-amber-500/30 bg-amber-500/10`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
          Lender Applications ({apps.length})
        </p>
        {canManage && !showForm && (
          <button type="button" onClick={openCreate} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#00AEEF] text-white hover:bg-[#0095cc] transition-colors">
            <FaPlus className="text-[9px]" /> Add Lender
          </button>
        )}
      </div>

      {apps.length === 0 && !showForm && (
        <p className={`text-xs italic mb-2 ${t.textFaint}`}>No lender applications yet. Add each bank the case is filed with.</p>
      )}

      {/* Cards */}
      <div className="space-y-2">
        {apps.map(a => (
          <div key={a.id} className={`rounded-xl border p-3 ${a.is_selected ? "border-[#00AEEF]/50 bg-[#00AEEF]/5" : t.innerBlock}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-sm font-bold truncate ${t.text}`}>{a.bank_name}</span>
                {a.is_selected && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-[#00AEEF] flex-shrink-0"><FaStar className="text-[9px]" /> Selected</span>
                )}
              </div>
              <span className={statusChip(a.status)}>{a.status}</span>
            </div>
            <div className={`grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-[11px] ${t.textMuted}`}>
              <span>Requested: <b className={t.text}>{inr(a.amount_requested)}</b></span>
              <span>Sanctioned: <b className={t.text}>{inr(a.amount_sanctioned)}</b></span>
              {a.interest_rate ? <span>Rate: <b className={t.text}>{a.interest_rate}%</b></span> : null}
              {a.dsa_agent_name ? <span>DSA: <b className={t.text}>{a.dsa_agent_name}</b></span> : null}
              {a.loan_reference_no ? <span>Ref: <b className={t.text}>{a.loan_reference_no}</b></span> : null}
            </div>
            {a.status === "Rejected" && a.rejection_reason && (
              <p className="text-[11px] mt-1 text-red-500">Rejected — “{a.rejection_reason}”</p>
            )}
            {canManage && (
              <div className="flex items-center gap-2 mt-2">
                {!a.is_selected && (
                  <button type="button" onClick={() => select(a)} disabled={busy} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border border-[#00AEEF]/40 text-[#00AEEF] hover:bg-[#00AEEF]/10 disabled:opacity-50">
                    <FaRegStar className="text-[9px]" /> Select this lender
                  </button>
                )}
                <button type="button" onClick={() => openEdit(a)} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded ${t.textMuted} hover:${t.text}`}>
                  <FaEdit className="text-[9px]" /> Edit
                </button>
                <button type="button" onClick={() => remove(a.id)} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded text-red-500 hover:text-red-400">
                  <FaTrash className="text-[9px]" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add / Edit form */}
      {showForm && canManage && (
        <div className={`rounded-xl border-2 border-[#00AEEF]/30 p-3 mt-3 ${t.innerBlock}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#00AEEF]">{editingId ? "Edit Lender" : "Add Lender"}</p>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className={`${t.textMuted} hover:text-red-500`}><FaTimes className="text-xs" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div><label className={labelCls}>Bank Name *</label><input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} className={inputCls} placeholder="e.g. HDFC Bank" /></div>
            <div>
              <label className={labelCls}>Loan Type</label>
              <select value={form.loan_type} onChange={e => setForm(f => ({ ...f, loan_type: e.target.value }))} className={selectCls}>
                <option value="">Select</option>
                {LOAN_TYPE_OPTS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>DSA / Agent Name</label><input value={form.dsa_agent_name} onChange={e => setForm(f => ({ ...f, dsa_agent_name: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>DSA / Agent Contact</label><input value={form.dsa_agent_contact} onChange={e => setForm(f => ({ ...f, dsa_agent_contact: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>Loan Executive (Bank Officer)</label><input value={form.loan_executive} onChange={e => setForm(f => ({ ...f, loan_executive: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>Loan Reference No.</label><input value={form.loan_reference_no} onChange={e => setForm(f => ({ ...f, loan_reference_no: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>Amount Requested</label><input value={form.amount_requested} onChange={e => setForm(f => ({ ...f, amount_requested: e.target.value }))} className={inputCls} placeholder="40,00,000" /></div>
            <div><label className={labelCls}>Amount Sanctioned</label><input value={form.amount_sanctioned} onChange={e => setForm(f => ({ ...f, amount_sanctioned: e.target.value }))} className={inputCls} placeholder="38,00,000" /></div>
            <div><label className={labelCls}>Interest Rate (%)</label><input type="number" step="0.01" value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))} className={inputCls} placeholder="8.5" /></div>
            <div><label className={labelCls}>Tenure (months)</label><input type="number" value={form.tenure_months} onChange={e => setForm(f => ({ ...f, tenure_months: e.target.value }))} className={inputCls} placeholder="240" /></div>
            <div><label className={labelCls}>Application Date</label><input type="date" value={form.application_date} onChange={e => setForm(f => ({ ...f, application_date: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>Sanction Date</label><input type="date" value={form.sanction_date} onChange={e => setForm(f => ({ ...f, sanction_date: e.target.value }))} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={selectCls}>
                {STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            {form.status === "Rejected" && (
              <div><label className={labelCls}>Rejection Reason</label><input value={form.rejection_reason} onChange={e => setForm(f => ({ ...f, rejection_reason: e.target.value }))} className={inputCls} placeholder="e.g. Low CIBIL score" /></div>
            )}
          </div>
          {error && <p className="text-red-500 text-[11px] mt-2">{error}</p>}
          <div className="flex items-center gap-2 mt-3">
            <button type="button" onClick={save} disabled={busy} className="text-xs font-bold px-4 py-2 rounded-lg bg-[#00AEEF] text-white hover:bg-[#0095cc] disabled:opacity-50">
              {busy ? "Saving…" : editingId ? "Update Lender" : "Save Lender"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className={`text-xs font-semibold px-4 py-2 rounded-lg border ${t.tableBorder} ${t.textMuted}`}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
