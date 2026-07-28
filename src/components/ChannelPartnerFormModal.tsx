"use client";
// ChannelPartnerFormModal.tsx — CP Master Phase 3. Add / edit a channel partner.
//
// The dominant real-world edit right now is "set the commission rate for the
// first time": partners auto-created from lead intake arrive with
// default_commission_rate NULL, and computeCPCommission hard-rejects until it is
// set. So when editing a rate-less partner the rate field is hoisted to the top
// and called out, rather than sitting mid-form with everything else.
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaPercent, FaExclamationTriangle } from "react-icons/fa";

export interface ChannelPartner {
  id: number;
  name: string;
  company_name: string | null;
  rera_registration_no: string | null;
  pan_number: string | null;
  phone: string | null;
  email: string | null;
  bank_account_details: any;
  default_commission_rate: string | null;
  status: string;
  lead_count?: string | number;
  booking_count?: string | number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  partner?: ChannelPartner | null; // null/undefined => create
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
}

const blankForm = {
  name: "", company_name: "", rera_registration_no: "", pan_number: "",
  phone: "", email: "", default_commission_rate: "", status: "active",
  bank_account_name: "", bank_account_no: "", bank_ifsc: "", bank_name: "",
};

/**
 * default_commission_rate is NUMERIC(5,2) with a CHECK of 0..100, so the column
 * physically cannot hold more than 2 decimal places — 0.205 silently becomes
 * 0.21. Rejecting a 3rd decimal here means the user picks the rounding rather
 * than discovering it after the fact on a commission that has already accrued.
 */
export function validateRate(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null; // blank is legitimate — partner exists, terms not agreed yet
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return /^\d+(\.\d{3,})$/.test(s)
      ? "Rate supports at most 2 decimal places."
      : "Rate must be a number, e.g. 2 or 1.75.";
  }
  const n = Number(s);
  if (n < 0 || n > 100) return "Rate must be between 0 and 100.";
  return null;
}

export default function ChannelPartnerFormModal({ isOpen, onClose, onSaved, partner, user, isDark, t }: Props) {
  const [form, setForm] = useState({ ...blankForm });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!partner;
  // The case this modal is tuned for: an existing partner that has never had a rate.
  const isFirstRateEntry = isEdit && (partner?.default_commission_rate === null || partner?.default_commission_rate === undefined);

  const canManage = ["admin", "sales manager", "sales_manager"].includes((user?.role || "").trim().toLowerCase());

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (partner) {
      const bank = partner.bank_account_details || {};
      setForm({
        name: partner.name || "",
        company_name: partner.company_name || "",
        rera_registration_no: partner.rera_registration_no || "",
        pan_number: partner.pan_number || "",
        phone: partner.phone || "",
        email: partner.email || "",
        default_commission_rate: partner.default_commission_rate ?? "",
        status: partner.status || "active",
        bank_account_name: bank.account_name || "",
        bank_account_no: bank.account_no || "",
        bank_ifsc: bank.ifsc || "",
        bank_name: bank.bank || "",
      });
    } else {
      setForm({ ...blankForm });
    }
  }, [isOpen, partner]);

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `${inputCls} cursor-pointer`;
  const labelCls = `text-[11px] mb-1 block ${t.textMuted}`;

  const set = (patch: Partial<typeof blankForm>) => { setForm(f => ({ ...f, ...patch })); setError(null); };

  const rateError = validateRate(form.default_commission_rate);
  const nameError = form.name.trim() === "" ? "Name is required." : null;
  const canSubmit = !busy && canManage && !rateError && !nameError;

  const handleSubmit = async () => {
    if (!canSubmit) { setError(nameError || rateError); return; }
    setBusy(true);
    setError(null);

    const bank =
      form.bank_account_name || form.bank_account_no || form.bank_ifsc || form.bank_name
        ? {
            account_name: form.bank_account_name || null,
            account_no: form.bank_account_no || null,
            ifsc: form.bank_ifsc || null,
            bank: form.bank_name || null,
          }
        : null;

    const payload: any = {
      name: form.name.trim(),
      company_name: form.company_name.trim() || null,
      rera_registration_no: form.rera_registration_no.trim() || null,
      pan_number: form.pan_number.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      bank_account_details: bank,
      // Blank clears the rate back to NULL, returning the partner to the
      // needs-rate queue rather than leaving a wrong number in place.
      default_commission_rate: form.default_commission_rate.trim() === "" ? null : Number(form.default_commission_rate),
      status: form.status,
      user_name: user.name,
      user_role: user.role, // server re-checks; the UI gate alone is not a control
      updated_by: user.name,
      created_by: user.name,
    };

    try {
      const res = await fetch(isEdit ? `/api/channel-partners/${partner!.id}` : "/api/channel-partners", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.message || "Save failed."); return; }
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e.message || "Network error.");
    } finally {
      setBusy(false);
    }
  };

  const rateField = (
    <div>
      <label className={labelCls}>
        Commission Rate (%) {isFirstRateEntry && <span className={t.accentText}>— not set yet</span>}
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={form.default_commission_rate}
          onChange={e => set({ default_commission_rate: e.target.value })}
          className={`${inputCls} pr-8 ${rateError ? "border-red-500" : ""}`}
          placeholder="e.g. 2 or 1.75"
          autoFocus={isFirstRateEntry}
        />
        <FaPercent className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] ${t.textFaint}`} />
      </div>
      {rateError
        ? <p className="text-[10px] mt-1 text-red-500">{rateError}</p>
        : <p className={`text-[10px] mt-1 ${t.textFaint}`}>0–100, up to 2 decimal places. Leave blank if terms aren&apos;t agreed yet.</p>}
    </div>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
            onClick={e => e.stopPropagation()}
            className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 ${t.modalCard || t.card}`}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className={`text-lg font-bold ${t.text}`}>
                  {isEdit ? "Edit Channel Partner" : "Add Channel Partner"}
                </h2>
                {isEdit && (
                  <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>
                    {partner!.name}
                    {Number(partner!.lead_count || 0) > 0 && ` · ${partner!.lead_count} lead(s)`}
                    {Number(partner!.booking_count || 0) > 0 && ` · ${partner!.booking_count} booking(s)`}
                  </p>
                )}
              </div>
              <button onClick={onClose} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted} hover:${t.text}`}>
                <FaTimes />
              </button>
            </div>

            {!canManage && (
              <div className="mb-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                Your role cannot add or edit channel partners.
              </div>
            )}

            {/* Rate hoisted to the top when it has never been set — that is the
                edit people are actually here to make. */}
            {isFirstRateEntry && (
              <div className={`mb-5 rounded-xl p-4 border ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30" : "bg-[#9E217B]/5 border-[#9E217B]/25"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <FaExclamationTriangle className={`text-[11px] ${t.accentText}`} />
                  <p className={`text-xs font-bold ${t.accentText}`}>Set commission rate</p>
                </div>
                <p className={`text-[11px] mb-3 ${t.textMuted}`}>
                  Commission can&apos;t be calculated for this partner&apos;s bookings until a rate is set.
                </p>
                {rateField}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelCls}>Partner Name *</label>
                <input type="text" value={form.name} onChange={e => set({ name: e.target.value })}
                  className={`${inputCls} ${nameError && form.name !== "" ? "border-red-500" : ""}`} placeholder="Full name or agency name" />
              </div>

              <div>
                <label className={labelCls}>Company Name</label>
                <input type="text" value={form.company_name} onChange={e => set({ company_name: e.target.value })}
                  className={inputCls} placeholder="Company / firm" />
              </div>

              <div>
                <label className={labelCls}>Phone</label>
                <input type="text" value={form.phone} onChange={e => set({ phone: e.target.value })}
                  className={inputCls} placeholder="10-digit mobile" />
                <p className={`text-[10px] mt-1 ${t.textFaint}`}>Used to identify this partner across leads.</p>
              </div>

              <div>
                <label className={labelCls}>Email</label>
                <input type="text" value={form.email} onChange={e => set({ email: e.target.value })}
                  className={inputCls} placeholder="name@example.com" />
              </div>

              <div>
                <label className={labelCls}>RERA Registration No.</label>
                <input type="text" value={form.rera_registration_no} onChange={e => set({ rera_registration_no: e.target.value })}
                  className={inputCls} placeholder="A5210001234" />
              </div>

              <div>
                <label className={labelCls}>PAN Number</label>
                <input type="text" value={form.pan_number} onChange={e => set({ pan_number: e.target.value.toUpperCase() })}
                  className={inputCls} placeholder="AAAAA0000A" />
              </div>

              <div>
                <label className={labelCls}>Status</label>
                <select value={form.status} onChange={e => set({ status: e.target.value })} className={selectCls}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                <p className={`text-[10px] mt-1 ${t.textFaint}`}>Inactive partners can&apos;t accrue new commission.</p>
              </div>

              {/* When the rate already exists it stays inline with everything else. */}
              {!isFirstRateEntry && rateField}
            </div>

            <div className={`mt-5 pt-4 border-t ${isDark ? "border-[#2a2a2a]" : "border-indigo-100"}`}>
              <p className={`text-xs font-bold mb-3 ${t.sectionTitle}`}>Bank Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Account Holder Name</label>
                  <input type="text" value={form.bank_account_name} onChange={e => set({ bank_account_name: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Account Number</label>
                  <input type="text" value={form.bank_account_no} onChange={e => set({ bank_account_no: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>IFSC Code</label>
                  <input type="text" value={form.bank_ifsc} onChange={e => set({ bank_ifsc: e.target.value.toUpperCase() })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Bank Name</label>
                  <input type="text" value={form.bank_name} onChange={e => set({ bank_name: e.target.value })} className={inputCls} />
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={onClose} className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted}`}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary} ${!canSubmit ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {busy ? "Saving..." : isEdit ? "Save Changes" : "Add Partner"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
