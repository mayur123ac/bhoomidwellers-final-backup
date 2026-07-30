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
//
// Assign Sourcing Manager (2026-07-29) writes channel_partners.
// assigned_sourcing_manager_id — the partner's single owner, distinct from
// walkin_enquiries.sourcing_manager_id which owns one enquiry. It is required
// when registering through the office-visit form, because a partner who walks in
// and is filed without an owner lands in a registry nobody is watching.
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes, FaPercent, FaExclamationTriangle, FaInfoCircle, FaUserTie } from "react-icons/fa";
import { canCreatePartners, canEditPartners, canAssignPartners } from "@/lib/cpRbac";
import SearchableSelect, { SelectOption } from "./SearchableSelect";

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
  /** The partner's single owning Sourcing Manager (users.id). */
  assigned_sourcing_manager_id?: number | null;
  assigned_sourcing_manager_name?: string | null;
  assigned_sourcing_manager_username?: string | null;
  /** False when the owning employee has since been deactivated. */
  assigned_sourcing_manager_active?: boolean | null;
  assigned_sourcing_manager_at?: string | null;
  assigned_sourcing_manager_by?: string | null;
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
  // Held as a string because SearchableSelect stores opaque option values; it is
  // converted to a number (or null) once, in the submit payload.
  assigned_sourcing_manager_id: "",
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

  // Sourcing Managers for the assignment dropdown. Fetched, never hardcoded —
  // the same source the CP enquiry form uses, so both screens agree on who is
  // eligible and a deactivated employee disappears from both at once.
  const [managers, setManagers] = useState<any[]>([]);
  const [managersLoading, setManagersLoading] = useState(true);
  const [managersError, setManagersError] = useState<string | null>(null);

  // ── Duplicate phone check ──
  // channel_partners.id is what the commission engine attributes leads and
  // bookings to, so a second row for a number that already exists splits one
  // partner's history in two. Checked while the number is being typed, so it is a
  // red error on the field rather than a rejection after filling the whole form.
  const [dupCheck, setDupCheck] = useState<any>(null);
  const [dupChecking, setDupChecking] = useState(false);
  // Set only when the operator confirms the prompt; sent as allow_merge so the
  // server tops up the existing partner instead of refusing.
  const [mergeConfirmed, setMergeConfirmed] = useState(false);

  // ── Pincode auto-fill ──
  // A full pincode resolves to a city and, where a territory is configured, to the
  // Sourcing Manager who covers it. Both are conveniences layered on top of fields
  // the operator can always type themselves.
  const [pinInfo, setPinInfo] = useState<{ city: string | null; sourcingManager: { id: number; name: string } | null } | null>(null);
  const [pinLooking, setPinLooking] = useState(false);
  /** Set when the manager was chosen by the pincode rather than by hand. */
  const [smAutoFilled, setSmAutoFilled] = useState(false);

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

  // Ownership is a third, narrower right. Choosing an owner while first registering
  // a partner is part of create; *changing* one afterwards is Admin-only, so for a
  // Sales Manager the field is read-only on edit and is left out of the PATCH body
  // entirely — sending it would be refused outright by the route.
  const canSetAssignment = isEdit ? canAssignPartners(user?.role) : canCreatePartners(user?.role);

  const fetchManagers = async () => {
    setManagersLoading(true);
    setManagersError(null);
    try {
      const res = await fetch("/api/users/sourcing-manager");
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setManagers(json.data);
      } else {
        // A failed fetch and a genuinely empty registry must not look identical:
        // one is retryable, the other legitimately allows an unassigned save.
        setManagersError(json.message || `Request failed (${res.status}).`);
      }
    } catch (e: any) {
      setManagersError(e?.message || "Network error.");
    } finally {
      setManagersLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchManagers();
  }, [isOpen]);

  const managerOptions: SelectOption[] = useMemo(
    () => managers.map((m: any) => ({
      value: String(m.id),
      label: m.name,
      sublabel: `ID ${m.id}${m.username ? ` · ${m.username}` : ""}${m.phone ? ` · ${m.phone}` : ""}`,
      keywords: `${m.username || ""} ${m.phone || ""} ${m.email || ""}`,
    })),
    [managers]
  );

  // Debounced so a number typed at speed costs one request, not ten. `exclude_id`
  // keeps a partner's own number from being flagged while editing them.
  useEffect(() => {
    if (!isOpen) { setDupCheck(null); return; }
    const digits = form.phone.replace(/\D/g, "");
    if (digits.length < 10) {
      // A partial number is not "available" — it simply hasn't been asked yet.
      setDupCheck(null);
      setDupChecking(false);
      setMergeConfirmed(false);
      return;
    }
    let cancelled = false;
    setDupChecking(true);
    const timer = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ phone: digits });
        if (isEdit && partner?.id) p.set("exclude_id", String(partner.id));
        const res = await fetch(`/api/channel-partners/phone-check?${p.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        setDupCheck(res.ok && json.success ? json : null);
        // Changing the number invalidates any prior confirmation — the operator
        // agreed to update one specific partner, not whichever comes next.
        if (!(res.ok && json.success && json.exists)) setMergeConfirmed(false);
      } catch {
        // A failed check is not blocking: POST re-checks and returns 409, so the
        // worst case is the error arrives on submit instead of on the field.
        if (!cancelled) setDupCheck(null);
      } finally {
        if (!cancelled) setDupChecking(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, form.phone, isEdit, partner?.id]);

  // Pincode → city + territory owner. Debounced like the phone check.
  useEffect(() => {
    if (!isOpen) { setPinInfo(null); return; }
    const pin = form.pin_code.replace(/\D/g, "");
    if (pin.length !== 6) { setPinInfo(null); setPinLooking(false); return; }
    let cancelled = false;
    setPinLooking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pincode-lookup?pincode=${pin}`);
        const json = await res.json();
        if (cancelled || !res.ok || !json.success) return;
        setPinInfo({ city: json.city, sourcingManager: json.sourcingManager });

        setForm(f => {
          const next = { ...f };
          // City is filled only when blank. Overwriting would fight an operator who
          // deliberately typed something the reference table disagrees with.
          if (json.city && !f.city.trim()) next.city = json.city;
          // Same rule for the manager: a hand-picked one is never replaced.
          if (json.sourcingManager && !f.assigned_sourcing_manager_id) {
            next.assigned_sourcing_manager_id = String(json.sourcingManager.id);
            setSmAutoFilled(true);
          }
          return next;
        });
      } catch {
        // Purely additive: a failed lookup just means nothing gets pre-filled.
        if (!cancelled) setPinInfo(null);
      } finally {
        if (!cancelled) setPinLooking(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, form.pin_code]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setMergeConfirmed(false);
    setPinInfo(null);
    setSmAutoFilled(false);
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
        assigned_sourcing_manager_id:
          partner.assigned_sourcing_manager_id != null ? String(partner.assigned_sourcing_manager_id) : "",
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

  // ── Assign Sourcing Manager ──
  // Required to register a partner through the office-visit form: reception and
  // sourcing file a walk-in partner, and one without an owner is on nobody's
  // desk. The two exceptions are structural rather than policy:
  //
  //   list still loading / failed  — blocking on a network problem would turn a
  //                                  standing partner away; the field simply
  //                                  isn't enforced until the list is known
  //   zero Sourcing Managers exist — nothing to pick; the partner is registered
  //                                  unassigned and an Admin assigns them later
  //
  // Editing is never blocked on it, in either variant: an Admin correcting a
  // legacy partner's GST number must not be forced to invent an assignment.
  const managerListKnown = !managersLoading && !managersError;
  const assignmentRequired = isOfficeVisit && !isEdit && managerListKnown && managers.length > 0;
  const assignmentError =
    assignmentRequired && !form.assigned_sourcing_manager_id
      ? "Assign a Sourcing Manager before registering this channel partner."
      : null;

  // ── Duplicate phone ──
  // Blocks the save. Cleared only by changing the number or by explicitly choosing
  // to update the existing partner instead, which is a different operation and is
  // labelled as one.
  const duplicatePhone = !!(dupCheck?.exists && !mergeConfirmed);
  const duplicateError = duplicatePhone
    ? (dupCheck.partner
      ? `This Channel Partner phone number already exists — registered to "${dupCheck.partner.name}".`
      : "This Channel Partner phone number already exists.")
    : null;

  const blockingError = nameError || rateError || officeVisitError || assignmentError || duplicateError;
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
      // Absent unless the operator confirmed the duplicate prompt; without it the
      // server refuses a duplicate phone rather than silently merging.
      ...(mergeConfirmed ? { allow_merge: true } : {}),
    };

    // Omitted, not nulled, when the role cannot set it: the PATCH route treats an
    // absent field as "leave the assignment alone" and an explicit null as
    // "unassign", so sending null here would strip a partner's owner on any
    // Sales Manager edit.
    if (canSetAssignment) {
      payload.assigned_sourcing_manager_id = form.assigned_sourcing_manager_id
        ? Number(form.assigned_sourcing_manager_id)
        : null;
    }

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
      if (!res.ok || !json.success) {
        // The live check can be outrun — someone else registering the same number
        // in the meantime, or a save before the debounce fired. Reflect the server's
        // verdict onto the field so the same red error and the same
        // "update instead" choice appear, rather than a bare toast.
        if (res.status === 409 && json.code === "DUPLICATE_PHONE") {
          setDupCheck({ exists: true, partner: json.duplicate || null, ownedByOther: !json.canMerge });
          setMergeConfirmed(false);
        }
        setError(json.message || "Save failed.");
        return;
      }
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
          placeholder="e.g. 400097"
        />
        {pinLooking ? (
          <p className={`text-[10px] mt-1 ${t.textFaint}`}>Looking up this pincode…</p>
        ) : pinInfo?.sourcingManager ? (
          <p className={`text-[10px] mt-1 ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
            Covered by <b>{pinInfo.sourcingManager.name}</b>
            {smAutoFilled ? " — selected below." : "."}
          </p>
        ) : (
          <p className={`text-[10px] mt-1 ${t.textFaint}`}>
            Fills City, and the Sourcing Manager if this area has one.
          </p>
        )}
      </div>
      <div>
        <label className={labelCls}>City</label>
        <input type="text" value={form.city} onChange={e => set({ city: e.target.value })}
          className={inputCls} placeholder="e.g. Mumbai" />
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
      <label className={labelCls}>Contact Phone {isOfficeVisit && <span className={t.textFaint}></span>}</label>
      <div className={`flex items-center rounded-lg border overflow-hidden ${duplicatePhone ? "border-red-500" : t.inputInner
        }`}>
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

      {duplicateError ? (
        <>
          <p className="text-[10px] mt-1 font-bold text-red-500">{duplicateError}</p>
          {/* A dead end would just make the operator invent a fake number. Where the
              partner is one they may act on, updating that record is offered as the
              deliberate alternative — the same top-up the registry backlog needs. */}
          {dupCheck?.partner ? (
            <button
              type="button"
              onClick={() => setMergeConfirmed(true)}
              className={`text-[10px] mt-1 underline cursor-pointer ${t.accentText}`}
            >
              Update {dupCheck.partner.name}&apos;s profile instead
            </button>
          ) : (
            <p className={`text-[10px] mt-1 ${t.textFaint}`}>
              It belongs to a partner assigned to another Sourcing Manager. Ask an Admin
              if you believe this is the same partner.
            </p>
          )}
        </>
      ) : mergeConfirmed && dupCheck?.partner ? (
        <p className={`text-[10px] mt-1 font-bold ${isDark ? "text-amber-400" : "text-amber-600"}`}>
          Updating the existing record for &ldquo;{dupCheck.partner.name}&rdquo;. Blank fields are
          left as they are; no new partner will be created.{" "}
          <button type="button" onClick={() => setMergeConfirmed(false)}
            className="underline cursor-pointer">Cancel</button>
        </p>
      ) : dupChecking ? (
        <p className={`text-[10px] mt-1 ${t.textFaint}`}>Checking this number…</p>
      ) : (
        <p className={`text-[10px] mt-1 ${t.textFaint}`}>
          {isOfficeVisit && !form.phone
            ? "Without a phone number this can't be matched to an existing partner — a new record will be created."
            : "Used to identify this partner across leads and bookings."}
        </p>
      )}
    </div>
  );

  /**
   * Assign Sourcing Manager. Shown on both variants — an Admin adding a partner
   * from the commercial form should be able to give them an owner too — but only
   * enforced on office-visit registration.
   *
   * Four states are kept distinct below rather than collapsed into one hint,
   * because they call for different actions: loading, a failed fetch (retry), an
   * empty registry (proceed unassigned), and simply not chosen yet (choose one).
   */
  const sourcingManagerField = !canSetAssignment ? (
    // Read-only for a Sales Manager editing a partner: shown, because who owns the
    // partner is useful context while editing their terms, but not editable — and
    // an inert dropdown that silently discards the change would be worse.
    <div>
      <label className={labelCls}>Sourcing Manager</label>
      <p className={`text-sm font-semibold ${t.text}`}>
        {partner?.assigned_sourcing_manager_name || <span className={t.textFaint}>Unassigned</span>}
      </p>
      <p className={`text-[10px] mt-1 ${t.textFaint}`}>
        Only an Admin can change which Sourcing Manager owns a partner.
      </p>
    </div>
  ) : (
    <div>
      <label className={labelCls}>
        Assign Sourcing Manager {assignmentRequired && <span className="text-red-500">*</span>}
      </label>
      <SearchableSelect
        value={form.assigned_sourcing_manager_id}
        // A manual pick stops being an auto-fill, so the "from pincode" note goes.
        onChange={v => { set({ assigned_sourcing_manager_id: v }); setSmAutoFilled(false); }}
        options={managerOptions}
        isDark={isDark}
        t={t}
        placeholder={managersLoading ? "Loading Sourcing Managers…" : "Search by name, ID or phone…"}
        emptyMessage={managersLoading ? "Loading…" : "No active Sourcing Managers yet"}
        disabled={managersLoading}
        ariaLabel="Assign Sourcing Manager"
      />
      {managersLoading ? (
        <p className={`text-[10px] mt-1 ${t.textFaint}`}>Loading Sourcing Managers…</p>
      ) : managersError ? (
        <p className="text-[10px] mt-1 text-red-500">
          Couldn&apos;t load Sourcing Managers ({managersError}).{" "}
          <button type="button" onClick={fetchManagers} className="underline cursor-pointer">Retry</button>
        </p>
      ) : managers.length === 0 ? (
        <p className={`text-[10px] mt-1 ${isDark ? "text-amber-400" : "text-amber-600"}`}>
          No Sourcing Managers yet — create one in Add Employee. You can still save; an Admin can assign later.
        </p>
      ) : assignmentError ? (
        <p className={`text-[10px] mt-1 ${isDark ? "text-amber-400" : "text-amber-600"}`}>
          Required — this partner needs an owner before they can be registered.
        </p>
      ) : smAutoFilled ? (
        <p className={`text-[10px] mt-1 ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
          Selected automatically from pincode {form.pin_code}. Change it if that&apos;s wrong.
        </p>
      ) : (
        <p className={`text-[10px] mt-1 ${t.textFaint}`}>
          {isEdit
            ? "Owns this partner. Clearing this returns them to the unassigned list."
            : "This partner will appear on the selected manager's dashboard."}
        </p>
      )}
      {/* On edit, who set the current assignment and when — the field alone
          doesn't say whether it was chosen deliberately or backfilled. */}
      {isEdit && partner?.assigned_sourcing_manager_by && (
        <p className={`text-[10px] mt-1 ${t.textFaint}`}>
          Assigned by {partner.assigned_sourcing_manager_by}
          {partner.assigned_sourcing_manager_at
            ? ` on ${new Date(partner.assigned_sourcing_manager_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
            : ""}
        </p>
      )}
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
              <div className={`mb-5 rounded-lg px-3 py-2 flex items-start gap-2 text-[11px] ${isDark ? "bg-blue-500/10 border border-blue-500/25 text-blue-300"
                : "bg-blue-50 border border-blue-200 text-blue-700"}`}>
                <FaInfoCircle className="mt-0.5 flex-shrink-0" />
                <span>
                  The phone number identifies this partner. If it already belongs to a
                  registered partner you&apos;ll be told, and can choose to update that
                  record instead of creating a duplicate.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={labelCls}>CP Name *</label>
                <input type="text" value={form.name} onChange={e => set({ name: e.target.value })}
                  className={`${inputCls} ${nameError && form.name !== "" ? "border-red-500" : ""}`}
                  placeholder="Full name of Channel Partner" />
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
                {/* Column is still owner_contact_person — renaming it would break
                    the CP enquiry table and overview, which read that key. The
                    meaning is now "who received them", i.e. the person on the desk. */}
                <label className={labelCls}>Attendee</label>
                <input type="text" value={form.owner_contact_person} onChange={e => set({ owner_contact_person: e.target.value })}
                  className={inputCls} placeholder="Your name" />
                <p className={`text-[10px] mt-1 ${t.textFaint}`}>Who received this partner at the front desk.</p>
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

            {/* ── Ownership, last ──
                Below the profile rather than above it, because the pincode field
                feeds it: by the time the operator reaches this the manager is
                usually already selected, and the block reads as a confirmation
                instead of a question asked before the answer was available. */}
            <div className={`mt-5 rounded-xl p-4 border ${isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30" : "bg-[#9E217B]/5 border-[#9E217B]/25"}`}>
              <div className="flex items-center gap-2 mb-2">
                <FaUserTie className={`text-[11px] ${t.accentText}`} />
                <p className={`text-xs font-bold ${t.accentText}`}>Ownership</p>
              </div>
              {sourcingManagerField}
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
                {busy
                  ? "Saving..."
                  // The label follows what the button will actually do — confirming
                  // the duplicate prompt turns this into an update, not a create.
                  : mergeConfirmed && dupCheck?.partner
                    ? "Update Existing Partner"
                    : isEdit ? "Save Changes" : isOfficeVisit ? "Register Partner" : "Add Partner"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
