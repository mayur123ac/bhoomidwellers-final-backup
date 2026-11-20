"use client";

import { useState, useRef, useEffect } from "react";
import {
  FaPhone, FaHome, FaCalendarAlt, FaDatabase, FaInfoCircle,
  FaPencilAlt, FaCheck, FaTimes,
} from "react-icons/fa";
import InlineContactField from "@/components/InlineContactField";
import type { InlineContactFieldTheme } from "@/components/InlineContactField";
import { contactFieldSave } from "@/lib/contactFieldSave";
import type { LeadDetailsTheme, LeadPermissions, LeadUser } from "./types";

// ---------------------------------------------------------------------------
// Section Header — compact with accent left border
// ---------------------------------------------------------------------------

function SectionHeader({ icon, title, isDark }: { icon: React.ReactNode; title: string; isDark: boolean }) {
  return (
    <h3 className={`flex items-center gap-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
      {icon}
      {title}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Field row — label/value pair, compact (read-only)
// ---------------------------------------------------------------------------

function Field({ label, value, accent, isDark, theme }: {
  label: string; value: string | React.ReactNode; accent?: boolean; isDark: boolean; theme: Record<string, any>;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 py-0.5 px-1 -mx-1 rounded transition-colors duration-150 ${isDark ? "hover:bg-white/5" : "hover:bg-black/[0.04]"}`}>
      <span className={`text-[10px] sm:text-[11px] font-medium flex-shrink-0 ${theme.textFaint}`}>{label}</span>
      <span className={`text-[11px] sm:text-xs font-semibold text-right truncate ${accent ? (isDark ? "text-green-400" : "text-emerald-600") : theme.text
        }`}>
        {value || "—"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditableField — Field with grey pencil, inline edit, auto follow-up log
// ---------------------------------------------------------------------------

function EditableField({ label, value, dbColumn, accent, isDark, theme, leadId, currentUser, canEdit, onSaved }: {
  label: string;
  value: string;
  dbColumn: string;
  accent?: boolean;
  isDark: boolean;
  theme: Record<string, any>;
  leadId: number;
  currentUser: LeadUser;
  canEdit: boolean;
  onSaved: (dbColumn: string, newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [editing]);

  const displayValue = value && value !== "N/A" && value !== "Pending" && value !== "Not Provided" ? value : "";

  function startEdit() {
    if (!canEdit || saving) return;
    setDraft(displayValue);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    if (saving) return;
    setEditing(false);
    setError(null);
  }

  async function handleSave() {
    const trimmed = draft.trim();
    if (trimmed === displayValue) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/walkin_enquiries/${leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [dbColumn]: trimmed || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.message || "Update failed");

      // Log the edit as a follow-up note
      const now = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
      await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(leadId),
          salesManagerName: currentUser.name || "System",
          createdBy: currentUser.role === "admin" ? "admin" : "sales",
          message: `✏️ ${label} — Edited ${now}`,
          siteVisitDate: null,
        }),
      }).catch(() => {}); // best-effort, don't block the save

      onSaved(dbColumn, trimmed);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") cancelEdit();
  }

  if (editing) {
    return (
      <div className="py-0.5 px-1 -mx-1" style={{ animation: "pi-in 180ms ease-out" }}>
        <div className="flex items-center gap-1">
          <span className={`text-[10px] sm:text-[11px] font-medium flex-shrink-0 ${theme.textFaint}`}>{label}</span>
          <div className="flex-1 flex items-center gap-1 justify-end">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={e => { setDraft(e.target.value); setError(null); }}
              onKeyDown={handleKeyDown}
              disabled={saving}
              maxLength={255}
              className={`w-full min-w-0 px-1.5 py-0.5 rounded text-[11px] sm:text-xs font-semibold outline-none transition-all ${theme.text} ${isDark ? "bg-white/10 border-white/20" : "bg-black/5 border-black/10"} border ${saving ? "opacity-50" : ""} ${error ? "!border-red-500/70" : ""}`}
            />
            <button type="button" onClick={handleSave} disabled={saving} className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-all cursor-pointer disabled:opacity-40 ${isDark ? "text-green-400 hover:bg-green-500/20" : "text-green-600 hover:bg-green-100"}`}>
              {saving ? <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="28 56" /></svg> : <FaCheck className="text-[8px]" />}
            </button>
            <button type="button" onClick={cancelEdit} disabled={saving} className={`flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-all cursor-pointer disabled:opacity-40 ${isDark ? "text-red-400 hover:bg-red-500/20" : "text-red-500 hover:bg-red-100"}`}>
              <FaTimes className="text-[8px]" />
            </button>
          </div>
        </div>
        {error && <p className="text-[9px] text-red-400 text-right mt-0.5">{error}</p>}
      </div>
    );
  }

  return (
    <div className={`flex items-baseline justify-between gap-2 py-0.5 px-1 -mx-1 rounded transition-colors duration-150 ${isDark ? "hover:bg-white/5" : "hover:bg-black/[0.04]"}`}>
      <span className={`text-[10px] sm:text-[11px] font-medium flex-shrink-0 ${theme.textFaint}`}>{label}</span>
      <span className="flex items-center gap-1">
        <span className={`text-[11px] sm:text-xs font-semibold text-right truncate ${accent ? (isDark ? "text-green-400" : "text-emerald-600") : theme.text}`}>
          {displayValue || "—"}
        </span>
        {canEdit && (
          <button type="button" onClick={startEdit} title={`Edit ${label}`} className="cursor-pointer flex-shrink-0 w-4 h-4 flex items-center justify-center">
            <FaPencilAlt className={`text-[8px] ${isDark ? "text-gray-500" : "text-gray-400"}`} />
          </button>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props extends LeadDetailsTheme {
  lead: any;
  permissions: LeadPermissions;
  loanDealLatest: any;
  currentUser: LeadUser;
  onLeadUpdate: (updater: (prev: any) => any) => void;
  onShowToast: (msg: string) => void;
  showExtendedFields?: boolean;
  renderAfterPersonalInfo?: () => React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadPersonalInfo({
  lead, permissions, loanDealLatest, currentUser,
  isDark, theme,
  onLeadUpdate, onShowToast,
  showExtendedFields,
  renderAfterPersonalInfo,
}: Props) {
  const save = async (field: "email" | "phone" | "alt_phone" | "location", val: string) => {
    const r = await contactFieldSave(lead.id, field, val);
    if (!r.success) throw new Error(r.message);
    onShowToast("Contact details updated successfully.");
  };

  const icfTheme = theme as unknown as InlineContactFieldTheme;
  const canEditField = permissions.canEditFields;
  const isLocked = !!lead.is_lost_lead || lead.status === "Closing";

  const handleFieldSaved = (dbColumn: string, newVal: string) => {
    onLeadUpdate((p: any) => ({ ...p, [dbColumn]: newVal || null }));
    onShowToast("Field updated successfully.");
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }); }
    catch { return d; }
  };

  const sectionCard = `pi-card rounded-lg border p-2.5 sm:p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${theme.settingsBg}`;
  const cardStyle = (i: number) => ({ ...theme.settingsBgGl, animationDelay: `${i * 70}ms` });

  const interestStatus = lead.leadInterestStatus;
  const interestColor =
    interestStatus === "Interested" ? (isDark ? "text-green-400" : "text-green-600")
      : interestStatus === "Not Interested" ? (isDark ? "text-red-400" : "text-red-600")
        : interestStatus === "NON GENUINE DEMAND (NGD)" ? (isDark ? "text-orange-400" : "text-orange-600")
          : theme.text;

  return (
    <div className="flex flex-col gap-2">

      <style>{`
        @keyframes pi-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .pi-card{animation:pi-in 400ms cubic-bezier(0.22,1,0.36,1) backwards}
        @media (prefers-reduced-motion: reduce){.pi-card{animation:none}}
      `}</style>

      {/* ── Contact Details ──────────────────────────────────────── */}
      <div className={sectionCard} style={cardStyle(0)}>
        <SectionHeader icon={<FaPhone className="text-[10px]" />} title="Contact Details" isDark={isDark} />
        <div className="flex flex-col gap-1.5 text-xs">
          <InlineContactField
            label="Phone" value={lead.phone} fieldType="tel"
            isDark={isDark} theme={icfTheme} mono
            canEdit={permissions.canEditPhone}
            onSave={async (val) => { await save("phone", val); onLeadUpdate((p: any) => ({ ...p, phone: val })); }}
          />
          <InlineContactField
            label="Alt Phone" value={lead.altPhone ?? lead.alt_phone} fieldType="tel"
            isDark={isDark} theme={icfTheme} mono
            canEdit={permissions.canEditPhone}
            onSave={async (val) => { await save("alt_phone", val); onLeadUpdate((p: any) => ({ ...p, altPhone: val, alt_phone: val })); }}
          />
          <InlineContactField
            label="Email" value={lead.email} fieldType="email"
            isDark={isDark} theme={icfTheme}
            canEdit={permissions.canEditContact}
            onSave={async (val) => { await save("email", val); onLeadUpdate((p: any) => ({ ...p, email: val || "N/A" })); }}
          />
          <Field label="Site Location" value={lead.site_location_name || "Not Provided"} isDark={isDark} theme={theme} />
        </div>
      </div>

      {/* ── Requirement ──────────────────────────────────────────── */}
      <div className={sectionCard} style={cardStyle(1)}>
        <SectionHeader icon={<FaHome className="text-[10px]" />} title="Requirement" isDark={isDark} />
        <div className="flex flex-col">
          <Field label="Property Type" value={lead.propType || "Pending"} isDark={isDark} theme={theme} />
          <Field label="Type of Use" value={lead.useType !== "Pending" ? lead.useType : (lead.purpose || "N/A")} isDark={isDark} theme={theme} />
          <EditableField label="Budget" value={lead.salesBudget !== "Pending" ? lead.salesBudget : lead.budget} dbColumn="budget" accent isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
          <Field label="Planning to Buy" value={lead.planningPurchase || "Pending"} isDark={isDark} theme={theme} />
          <EditableField label="Loan Required" value={loanDealLatest?.loan_required || lead.loanPlanned || "Pending"} dbColumn="loan_planned" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
          <div className="pt-1">
            <InlineContactField
              label="Location" value={lead.location} fieldType="text"
              isDark={isDark} theme={icfTheme}
              canEdit={permissions.canEditContact}
              onSave={async (val) => { await save("location", val); onLeadUpdate((p: any) => ({ ...p, location: val || "N/A" })); }}
            />
          </div>
        </div>
      </div>

      {/* ── Address ──────────────────────────────────────────────── */}
      <div className={sectionCard} style={cardStyle(2)}>
        <SectionHeader icon={<FaInfoCircle className="text-[10px]" />} title="Address & Status" isDark={isDark} />
        <div className="flex flex-col">
          <EditableField label="Residential Address" value={lead.address && lead.address !== "N/A" ? lead.address : "Not Provided"} dbColumn="address" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
          {showExtendedFields && (
            <>
              <EditableField label="Pin Code" value={lead.pinCode || lead.pin_code || "N/A"} dbColumn="pin_code" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
              <EditableField label="City" value={lead.city || "N/A"} dbColumn="city" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
            </>
          )}
          <div className={`mt-1.5 pt-1.5 border-t ${theme.tableBorder}`}>
            <Field label="Lead Interest" value={
              <span className={`font-bold ${interestColor}`}>{interestStatus && interestStatus !== "Pending" ? interestStatus : "Pending"}</span>
            } isDark={isDark} theme={theme} />
            <Field label="Loan Status" value={lead.loanStatus && lead.loanStatus !== "N/A" ? lead.loanStatus : "N/A"} isDark={isDark} theme={theme} />
            <Field label="Status" value={
              <span className={`font-bold ${lead.status === "Closing" ? "text-amber-500"
                : lead.status === "Visit Scheduled" ? "text-orange-400"
                  : theme.accentText
                }`}>{lead.status || "Assigned"}</span>
            } isDark={isDark} theme={theme} />
            <Field label="Backdated Entry" value={
              lead.auto_date_enabled === false && lead.enquiry_date
                ? formatDate(lead.enquiry_date).split(",")[0]
                : "Null"
            } isDark={isDark} theme={theme} />
          </div>
        </div>
      </div>

      {/* ── Site Visit ──────────────────────────────────────────── */}
      <div className={sectionCard} style={cardStyle(3)}>
        <SectionHeader icon={<FaCalendarAlt className="text-[10px]" />} title="Site Visit" isDark={isDark} />
        <Field
          label="Site Visit Date"
          value={lead.mongoVisitDate ? formatDate(lead.mongoVisitDate) : "Not Scheduled"}
          isDark={isDark} theme={theme}
        />
        {renderAfterPersonalInfo && renderAfterPersonalInfo()}
      </div>

      {/* ── Source Data ──────────────────────────────────────────── */}
      <div className={sectionCard} style={cardStyle(4)}>
        <SectionHeader icon={<FaDatabase className="text-[10px]" />} title={lead.source && lead.source !== "N/A" ? `${lead.source} Data` : "Source Data"} isDark={isDark} />
        <div className="flex flex-col">
          <Field label="Primary Source" value={lead.source || "N/A"} isDark={isDark} theme={theme} />
          {lead.source === "Others" && (
            <EditableField label="Specified Name" value={lead.sourceOther || "N/A"} dbColumn="source_other" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
          )}
        </div>
        {lead.source === "Channel Partner" ? (
          <div className={`mt-1.5 pt-1.5 border-t ${theme.tableBorder}`}>
            <EditableField label="CP Name" value={lead.cpName || lead.cp_name || "N/A"} dbColumn="cp_name" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
            <EditableField label="CP Company" value={lead.cp_company || lead.cpCompany || "N/A"} dbColumn="cp_company" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
            <EditableField label="CP Phone" value={lead.cp_phone || lead.cpPhone || "N/A"} dbColumn="cp_phone" isDark={isDark} theme={theme} leadId={lead.id} currentUser={currentUser} canEdit={canEditField && !isLocked} onSaved={handleFieldSaved} />
          </div>
        ) : lead.source === "Referral" ? (
          <div className={`mt-1.5 pt-1.5 border-t ${theme.tableBorder}`}>
            <Field label="Referred By" value={lead.referral_name || "N/A"} isDark={isDark} theme={theme} />
          </div>
        ) : null}
      </div>

      {/* ── Lost Lead Record ─────────────────────────────────────── */}
      {lead.is_lost_lead && (
        <div className={`rounded-lg border p-2.5 sm:p-3 ${theme.statusLost}`}>
          <p className="crm-eyebrow mb-1">Lost Lead Record</p>
          <p className={`text-[11px] sm:text-xs leading-relaxed ${theme.textMuted}`}>{lead.lost_lead_reason || "No reason recorded."}</p>
          <p className={`text-[9px] sm:text-[10px] mt-1.5 ${theme.textFaint}`}>
            Marked by {lead.lost_lead_marked_by || "Unknown"} on {lead.lost_lead_marked_at ? formatDate(lead.lost_lead_marked_at) : "-"}
          </p>
        </div>
      )}
    </div>
  );
}
