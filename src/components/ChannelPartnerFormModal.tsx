"use client";
// ChannelPartnerFormModal.tsx — CP Master Phase 3, extended for office-visit
// registration (Phase 4).
//
// Two variants over one table:
//
//   variant="full"         Admin / Sales Manager. Commercial terms included.
//                          The dominant real-world edit is "set the commission
//                          rate for the first time": partners auto-created from
//                          lead intake arrive with default_commission_rate NULL,
//                          and computeCPCommission hard-rejects until it is set.
//                          So when editing a rate-less partner the rate field is
//                          hoisted to the top and called out.
//
//   variant="office_visit" Receptionist / Sourcing Manager. The fuller business
//                          profile captured when a partner physically visits the
//                          office. No rate, no bank details, no status — those
//                          are commercial fields the server strips for these
//                          roles anyway.
//
// Field mapping note: the office-visit form's labels don't match the column
// names, because these columns already existed for commission tracking and
// channel_partners.id has to stay the single source of truth:
//
//   CP Name              -> name
//   CP Company Name      -> company_name
//   RERA Number          -> rera_registration_no
//   Contact Phone        -> phone                  (also the dedup key)
//   Owner/Contact Person -> owner_contact_person   (new)
//   Office Address       -> office_address         (new)
//   GST Number           -> gst_number             (new)
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaPercent, FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import { canCreatePartners, canEditPartners } from "@/lib/cpRbac";

export interface ChannelPartner {
  id: number;
  name: string;
  company_name: string | null;
  rera_registration_no: string | null;
  pan_number: string | null;
  phone: string | null;
  email: string | null;
  office_address?: string | null;
  pin_code?: string | null;
  city?: string | null;
  owner_contact_person?: string | null;
  gst_number?: string | null;
  bank_account_details?: any;
  default_commission_rate?: string | null;
  status: string;
  created_by?: string | null;
  created_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
  lead_count?: string | number;
  booking_count?: string | number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (info?: { merged: boolean; message: string }) => void;
  partner?: ChannelPartner | null; // null/undefined => create
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
  variant?: "full" | "office_visit";
}

const blankForm = {
  name: "", company_name: "", rera_registration_no: "", pan_number: "",
  phone: "", email: "", default_commission_rate: "", status: "active",
  office_address: "", pin_code: "", city: "", owner_contact_person: "", gst_number: "",
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

/** Input holds raw digits only — the "+91" prefix is rendered separately, matching
 *  the enquiry form, so there is no reformat-while-typing fighting the cursor. */
const cleanPhoneDigits = (raw: string) => raw.replace(/\D/g, "").slice(0, 10);

export default function ChannelPartnerFormModal({
  isOpen, onClose, onSaved, partner, user, isDark, t, variant = "full",
}: Props) {
  const [form, setForm] = useState({ ...blankForm });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!partner;
  const isOfficeVisit = variant === "office_visit";
  // The case the full variant is tuned for: an existing partner with no rate.
  const isFirstRateEntry =
    !isOfficeVisit && isEdit &&
    (partner?.default_commission_rate === null || partner?.default_commission_rate === undefined);

  // Create and edit are separate rights: Receptionist and Sourcing Manager can
  // register a partner but never edit one. The server re-checks from the session
  // cookie — this gate only decides what the form lets you attempt.
  const allowed = isEdit ? canEditPartners(user?.role) : canCreatePartners(user?.role);

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
        phone: cleanPhoneDigits(partner.phone || ""),
        email: partner.email || "",
        office_address: partner.office_address || "",
        pin_code: partner.pin_code || "",
        city: partner.city || "",
        owner_contact_person: partner.owner_contact_person || "",
        gst_number: partner.gst_number || "",
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

  const rateError = isOfficeVisit ? null : validateRate(form.default_commission_rate);
  const nameError = form.name.trim() === "" ? "CP Name is required." : null;

  // Every profile field is optional free text, captured as entered: no required
  // flag, no format pattern, no length rule. A partner who walks in without their
  // GST or RERA number to hand still gets recorded, and the registry shows the gap
  // (see the Sourcing Manager panel's "Profile Incomplete" count) rather than the
  // operator being blocked at the form.
  //
  // Two exceptions, both structural rather than policy:
  //   name  — channel_partners.name is NOT NULL, so a blank would fail the INSERT.
  //   phone — a partial number can't match the dedup index, which would silently
  //           create a second row for a partner who already exists.
  const officeVisitError = (() => {
    if (!isOfficeVisit) return null;
    if (form.phone && form.phone.length !== 10) return "Contact Phone must be 10 digits, or left empty.";
    return null;
  })();

  const blockingError = nameError || rateError || officeVisitError;
  const canSubmit = !busy && allowed && !blockingError;

  const handleSubmit = async () => {
    if (!canSubmit) { setError(blockingError); return; }
    setBusy(true);
    setError(null);

    const payload: any = {
      name: form.name.trim(),
      company_name: form.company_name.trim() || null,
      rera_registration_no: form.rera_registration_no.trim() || null,
      phone: form.phone.trim() || null,
      office_address: form.office_address.trim() || null,
      pin_code: form.pin_code.trim() || null,
      city: form.city.trim() || null,
      owner_contact_person: form.owner_contact_person.trim() || null,
      gst_number: form.gst_number.trim() || null,
    };

    // Commercial fields are omitted entirely for the office-visit variant. The
    // server strips them for non-commercial roles too, so this is belt and braces.
    if (!isOfficeVisit) {
      const bank =
        form.bank_account_name || form.bank_account_no || form.bank_ifsc || form.bank_name
          ? {
              account_name: form.bank_account_name || null,
              account_no: form.bank_account_no || null,
              ifsc: form.bank_ifsc || null,
              bank: form.bank_name || null,
            }
          : null;
      payload.pan_number = form.pan_number.trim() || null;
      payload.email = form.email.trim() || null;
      payload.bank_account_details = bank;
      // Blank clears the rate back to NULL, returning the partner to the
      // needs-rate queue rather than leaving a wrong number in place.
      payload.default_commission_rate =
        form.default_commission_rate.trim() === "" ? null : Number(form.default_commission_rate);
      payload.status = form.status;
    }

    try {
      const res = await fetch(isEdit ? `/api/channel-partners/${partner!.id}` : "/api/channel-partners", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.message || "Save failed."); return; }
      onSaved?.({
        merged: !!json.merged,
        message: json.message || (isEdit ? "Channel partner updated." : "Channel partner registered."),
      });
      onClose();
    } catch (e: any) {
      setError(e.message || "Network error.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Pin Code + City — the area this partner operates in. Captured on both variants
   * so an Admin edit can backfill them for the partners that came from lead intake.
   * These are the intended join keys against walkin_enquiries.pin_code / .city for
   * CP-to-demand matching; no query uses them yet.
   */
  const areaFields = (
    <>
      <div>
        <label className={labelCls}>Pin Code</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={form.pin_code}
          // Digits only — a stray letter would break an equality match against an
          // enquiry's pincode, which is the whole point of storing this.
          onChange={e => set({ pin_code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          className={inputCls}
          placeholder="e.g. 411045"
        />
      </div>
      <div>
        <label className={labelCls}>City</label>
        <input type="text" value={form.city} onChange={e => set({ city: e.target.value })}
          className={inputCls} placeholder="e.g. Pune" />
      </div>
    </>
  );

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

  const phoneField = (
    <div>
      <label className={labelCls}>Contact Phone {isOfficeVisit && <span className={t.textFaint}>(optional)</span>}</label>
      <div className={`flex items-center rounded-lg border overflow-hidden ${t.inputInner}`}>
        <span className={`px-2.5 py-2 text-sm select-none ${t.textFaint}`}>+91</span>
        <input
          type="tel"
          inputMode="numeric"
          value={form.phone}
          onChange={e => set({ phone: cleanPhoneDigits(e.target.value) })}
          className={`flex-1 px-2 py-2 text-sm bg-transparent outline-none ${t.text}`}
          placeholder="10-digit mobile"
        />
      </div>
      <p className={`text-[10px] mt-1 ${t.textFaint}`}>
        {isOfficeVisit && !form.phone
          ? "Without a phone number this can't be matched to an existing partner — a new record will be created."
          : "Used to identify this partner across leads and bookings."}
      </p>
    </div>
  );

  const title = isOfficeVisit
    ? isEdit ? "Edit Channel Partner" : "Channel Partner Office Visit"
    : isEdit ? "Edit Channel Partner" : "Add Channel Partner";

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
                <h2 className={`text-lg font-bold ${t.text}`}>{title}</h2>
                {isEdit ? (
                  <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>
                    {partner!.name}
                    {Number(partner!.lead_count || 0) > 0 && ` · ${partner!.lead_count} lead(s)`}
                    {Number(partner!.booking_count || 0) > 0 && ` · ${partner!.booking_count} booking(s)`}
                  </p>
                ) : isOfficeVisit && (
                  <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>
                    Record the partner&apos;s full business profile. Not tied to any lead.
                  </p>
                )}
              </div>
              <button onClick={onClose} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted} hover:${t.text}`}>
                <FaTimes />
              </button>
            </div>

            {!allowed && (
              <div className="mb-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                Your role cannot {isEdit ? "edit" : "register"} channel partners.
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

            {/* An existing partner on this phone number is topped up, not
                duplicated — say so before submit, not after. */}
            {isOfficeVisit && !isEdit && (
              <div className={`mb-5 rounded-lg px-3 py-2 flex items-start gap-2 text-[11px] ${
                isDark ? "bg-blue-500/10 border border-blue-500/25 text-blue-300"
                       : "bg-blue-50 border border-blue-200 text-blue-700"}`}>
                <FaInfoCircle className="mt-0.5 flex-shrink-0" />
                <span>
                  If this phone number already belongs to a registered partner, their existing
                  record is updated instead of creating a duplicate.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelCls}>CP Name *</label>
                <input type="text" value={form.name} onChange={e => set({ name: e.target.value })}
                  className={`${inputCls} ${nameError && form.name !== "" ? "border-red-500" : ""}`}
                  placeholder="Full name or agency name" />
              </div>

              <div>
                <label className={labelCls}>CP Company Name</label>
                <input type="text" value={form.company_name} onChange={e => set({ company_name: e.target.value })}
                  className={inputCls} placeholder="Company / firm" />
              </div>

              {phoneField}

              {isOfficeVisit && (
                <div className="sm:col-span-2">
                  <label className={labelCls}>Office Address</label>
                  <textarea rows={2} value={form.office_address} onChange={e => set({ office_address: e.target.value })}
                    className={`${inputCls} resize-y`} placeholder="Full office address" />
                </div>
              )}

              {isOfficeVisit && areaFields}

              <div>
                <label className={labelCls}>Owner / Contact Person</label>
                <input type="text" value={form.owner_contact_person} onChange={e => set({ owner_contact_person: e.target.value })}
                  className={inputCls} placeholder="Person met / firm owner" />
              </div>

              <div>
                <label className={labelCls}>RERA Number</label>
                <input type="text" value={form.rera_registration_no} onChange={e => set({ rera_registration_no: e.target.value })}
                  className={inputCls} placeholder="A5210001234" />
              </div>

              <div>
                {/* Stored exactly as typed — no uppercasing, no format check. */}
                <label className={labelCls}>GST Number</label>
                <input type="text" value={form.gst_number} onChange={e => set({ gst_number: e.target.value })}
                  className={inputCls} placeholder="27AAAAA0000A1Z5" />
              </div>

              {/* ── Commercial / admin-only fields ── */}
              {!isOfficeVisit && (
                <>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input type="text" value={form.email} onChange={e => set({ email: e.target.value })}
                      className={inputCls} placeholder="name@example.com" />
                  </div>

                  <div>
                    <label className={labelCls}>PAN Number</label>
                    <input type="text" value={form.pan_number} onChange={e => set({ pan_number: e.target.value.toUpperCase() })}
                      className={inputCls} placeholder="AAAAA0000A" />
                  </div>

                  <div className="sm:col-span-2">
                    <label className={labelCls}>Office Address</label>
                    <textarea rows={2} value={form.office_address} onChange={e => set({ office_address: e.target.value })}
                      className={`${inputCls} resize-y`} placeholder="Full office address" />
                  </div>

                  {areaFields}

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
                </>
              )}
            </div>

            {!isOfficeVisit && (
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
            )}

            {(error || (blockingError && form.name !== "")) && (
              <div className="mt-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                {error || blockingError}
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
                {busy ? "Saving..." : isEdit ? "Save Changes" : isOfficeVisit ? "Register Partner" : "Add Partner"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
