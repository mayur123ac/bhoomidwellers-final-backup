"use client";

import {
  FaPhone, FaHome, FaCalendarAlt, FaDatabase, FaInfoCircle,
} from "react-icons/fa";
import InlineContactField from "@/components/InlineContactField";
import type { InlineContactFieldTheme } from "@/components/InlineContactField";
import { contactFieldSave } from "@/lib/contactFieldSave";
import type { LeadDetailsTheme, LeadPermissions } from "./types";

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
// Field row — label/value pair, compact
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
// Props
// ---------------------------------------------------------------------------

interface Props extends LeadDetailsTheme {
  lead: any;
  permissions: LeadPermissions;
  loanDealLatest: any;
  onLeadUpdate: (updater: (prev: any) => any) => void;
  onShowToast: (msg: string) => void;
  showExtendedFields?: boolean;
  renderAfterPersonalInfo?: () => React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadPersonalInfo({
  lead, permissions, loanDealLatest,
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
        </div>
      </div>

      {/* ── Requirement ──────────────────────────────────────────── */}
      <div className={sectionCard} style={cardStyle(1)}>
        <SectionHeader icon={<FaHome className="text-[10px]" />} title="Requirement" isDark={isDark} />
        <div className="flex flex-col">
          <Field label="Property Type" value={lead.propType || "Pending"} isDark={isDark} theme={theme} />
          <Field label="Type of Use" value={lead.useType !== "Pending" ? lead.useType : (lead.purpose || "N/A")} isDark={isDark} theme={theme} />
          <Field label="Budget" value={lead.salesBudget !== "Pending" ? lead.salesBudget : lead.budget} accent isDark={isDark} theme={theme} />
          <Field label="Planning to Buy" value={lead.planningPurchase || "Pending"} isDark={isDark} theme={theme} />
          <Field label="Loan Required" value={loanDealLatest?.loan_required || lead.loanPlanned || "Pending"} isDark={isDark} theme={theme} />
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
          <Field label="Residential Address" value={lead.address && lead.address !== "N/A" ? lead.address : "Not Provided"} isDark={isDark} theme={theme} />
          {showExtendedFields && (
            <>
              <Field label="Pin Code" value={lead.pinCode || lead.pin_code || "N/A"} isDark={isDark} theme={theme} />
              <Field label="City" value={lead.city || "N/A"} isDark={isDark} theme={theme} />
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
            <Field label="Specified Name" value={lead.sourceOther} isDark={isDark} theme={theme} />
          )}
        </div>
        {lead.source === "Channel Partner" ? (
          <div className={`mt-1.5 pt-1.5 border-t ${theme.tableBorder}`}>
            <Field label="CP Name" value={lead.cpName || lead.cp_name || "N/A"} isDark={isDark} theme={theme} />
            <Field label="CP Company" value={lead.cp_company || lead.cpCompany || "N/A"} isDark={isDark} theme={theme} />
            <Field label="CP Phone" value={lead.cp_phone || lead.cpPhone || "N/A"} isDark={isDark} theme={theme} />
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
