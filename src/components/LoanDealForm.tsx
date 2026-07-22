"use client";
// LoanDealForm.tsx — Unified loan + deal-financial tracking form for a lead.
//
// Writes to two independent tables, both submitted together:
//   - Sections 1-5 (Loan Decision / Bank & Loan / Financial Qualification /
//     Documents / Notes) -> loan_updates, via POST /api/loan. Works for any
//     lead, no booking required.
//   - Sections 6-8 (Sanction / Disbursement / Registration & Booking
//     Financials) -> always editable. If the lead already has a booking
//     application, they save straight into its booking_loan_details +
//     booking_financials tables via the existing PUT
//     /api/booking-applications/[id]. If not, they're saved as a draft on
//     the lead itself (walkin_enquiries.loan_tracking_info JSONB) via the
//     existing PUT /api/walkin_enquiries/[id]. When the sales manager later
//     clicks "Mark as Closing" and BookingFormModal opens for a fresh booking,
//     it reads that same draft to prefill sections 6-8 — see defaultForm() in
//     BookingFormModal.tsx.
//
// Disbursement tranches live in their own lead-scoped table
// (disbursement_tranches) via /api/walkin_enquiries/[id]/tranches — see the
// tranche handlers below. Total Disbursed and Disbursement Status are derived
// from completed tranches, never manually entered.
//
// NOTE ON LIVE POLLING: the parent dashboards refetch leads/bookings every
// few seconds for real-time sync. That refetch produces new object
// references for `lead`/`booking`/`loanUpdate` even when nothing actually
// changed, which would otherwise retrigger the population effects below and
// silently wipe out whatever the user is mid-typing. The `isDirty` flag
// guards against that: once the user touches any field, background prop
// refreshes are ignored until they switch to a different lead (or the form
// unmounts after a successful save).
import React, { useState, useEffect, useCallback } from "react";
import { FaUniversity, FaTimes, FaFileAlt, FaFileInvoiceDollar, FaPlus, FaTrash, FaCheck, FaChevronRight } from "react-icons/fa";
import IndianCurrencyInput from "@/components/IndianCurrencyInput";
import LenderApplicationsTracker, { type LoanApplication } from "@/components/LenderApplicationsTracker";
import PddChecklist from "@/components/PddChecklist";

interface LoanDealFormProps {
  lead: any;
  booking: any | null;
  loanUpdate: any | null;
  user: any;
  isDark?: boolean;
  t: any;
  onCancel: () => void;
  onSuccess: () => void;
}

interface Tranche {
  id: number;
  lead_id: number;
  amount: string | number;
  status: string;
  bank_reference_no: string | null;
  remarks: string | null;
  receiving_date: string | null;
  added_by_name: string | null;
  added_by_role: string | null;
  created_at: string;
}

// "Received" is the legacy label for what's now called "Completed" — old
// tranches saved before the rename must still count toward the total.
const isTrancheCompleted = (status: string) => ["completed", "received"].includes((status || "").toLowerCase());

const LOAN_REQUIRED_OPTS = ["Yes", "No", "Not Sure"];
const LOAN_STATUS_OPTS = ["Approved", "In Progress", "Rejected"];
const LOAN_TYPE_OPTS = ["Home Loan", "Top-Up Loan", "Balance Transfer", "Other"];

// ─────────────────────────────────────────────────────────────────────────
// Module-level helper components. These MUST live outside LoanDealForm:
// if defined inside the component body, React treats them as a brand-new
// component type on every render, forcing a full remount of their subtree
// (and killing input focus on every keystroke nearby). Keeping them here
// also prevents the earlier bug where SectionHeader recursively rendered
// itself and hung the tab.
// ─────────────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle, t }: { icon: string; title: string; subtitle: string; t: any }) {
  return (
    <div className="mb-3">
      <h4 className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2 text-[#00AEEF]`}>
        <span className="text-sm">{icon}</span> {title}
      </h4>
      <p className={`text-[10px] normal-case font-normal ${t.textFaint}`}>{subtitle}</p>
    </div>
  );
}

function LoanProgressTimeline({
  loanForm,
  dealForm,
  isLoanRequired,
  loanNotRequired,
  t,
}: {
  loanForm: any;
  dealForm: any;
  isLoanRequired: boolean;
  loanNotRequired: boolean;
  t: any;
}) {
  const stages = ["Qualification", "Documents", "Processing", "Sanction", "Disbursement", "Booking"];
  const docsReady = [loanForm.docPan, loanForm.docAadhaar, loanForm.docSalary, loanForm.docBank, loanForm.docProperty].every(
    (d: string) => d === "Uploaded"
  );
  const currentIdx = loanNotRequired
    ? 0
    : dealForm.disbursement_status === "Completed"
      ? 5
      : dealForm.sanction_status === "Approved"
        ? 4
        : dealForm.loan_executive || dealForm.loan_reference_no
          ? 3
          : docsReady
            ? 2
            : isLoanRequired
              ? 1
              : 0;

  return (
    <div className="flex items-center justify-between mb-4 px-1">
      {stages.map((s, i) => (
        <React.Fragment key={s}>
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i <= currentIdx
                ? "bg-[#00AEEF] text-white"
                : `${t.innerBlock} ${t.textFaint} border border-gray-300`
                }`}
            >
              {i + 1}
            </div>
            <span className={`text-[9px] font-semibold ${i <= currentIdx ? t.text : t.textFaint}`}>{s}</span>
          </div>
          {i < stages.length - 1 && (
            <div
              className="flex-1 mx-1 border-t-2"
              style={{
                borderStyle: "dashed",
                borderColor: i < currentIdx ? "#00AEEF" : "#D1D5DB",
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function DisbursementProgressBar({ totalDisbursed, sanctionAmount, percent, isDark, t }: {
  totalDisbursed: number; sanctionAmount: number; percent: number; isDark: boolean; t: any;
}) {
  const remaining = Math.max(0, sanctionAmount - totalDisbursed);
  const isComplete = percent >= 100;

  return (
    <div className={`rounded-xl border p-4 mb-4 ${t.innerBlock}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>
          Disbursement Progress
        </span>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${isComplete
          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
          : "bg-[#00AEEF]/10 text-[#00AEEF] border-[#00AEEF]/30"
          }`}>
          {isComplete ? "✓ Fully Disbursed" : `${percent}% Completed`}
        </span>
      </div>

      <div className={`w-full h-2.5 rounded-full overflow-hidden mb-4 ${isDark ? "bg-gray-700/60" : "bg-gray-200"}`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? "bg-emerald-500" : "bg-gradient-to-r from-[#00AEEF] to-[#0095cc]"}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="grid grid-cols-3 divide-x divide-gray-500/10">
        <div className="text-center px-2">
          <p className={`text-[9px] font-semibold uppercase tracking-wider mb-1 ${t.textFaint}`}>Sanctioned</p>
          <p className={`text-sm font-bold ${t.text}`}>₹{sanctionAmount.toLocaleString("en-IN")}</p>
        </div>
        <div className="text-center px-2">
          <p className={`text-[9px] font-semibold uppercase tracking-wider mb-1 ${t.textFaint}`}>Disbursed</p>
          <p className="text-sm font-bold text-[#00AEEF]">₹{totalDisbursed.toLocaleString("en-IN")}</p>
        </div>
        <div className="text-center px-2">
          <p className={`text-[9px] font-semibold uppercase tracking-wider mb-1 ${t.textFaint}`}>Remaining</p>
          <p className={`text-sm font-bold ${isComplete ? "text-emerald-500" : "text-orange-500"}`}>
            ₹{remaining.toLocaleString("en-IN")}
          </p>
        </div>
      </div>
    </div>
  );
}

function defaultLoanForm() {
  return {
    loanRequired: "", status: "", bank: "", amountReq: "", amountApp: "",
    cibil: "", agent: "", agentContact: "", empType: "", income: "", emi: "",
    docPan: "Pending", docAadhaar: "Pending", docSalary: "Pending", docBank: "Pending", docProperty: "Pending",
    notes: "",
  };
}

// Phase B: dealForm is a SUPERSET aligned to the redesigned BookingFormModal Step 3.
// The legacy ocr_* / sdr_* keys are kept only so the current Section 8 UI keeps
// compiling — they are excluded from the draft written to loan_tracking_info (see
// buildDraft() in handleSubmit) and are slated for removal in Phase D's UI redesign.
// Reusable auto/manual charge block for Stamp Duty and Registration Fee.
// In "auto" the amount is Agreement Value × percent (read-only display); in
// "manual" it's a normal editable input. Percent stays adjustable (e.g. 4% vs 5%).
function StampDutyBlock({
  title, mode, onMode, percent, onPercent, agreementValue, computed,
  capped, capLabel, manualValue, onManual, statusValue, onStatus,
  t, inputCls, selectCls, labelCls,
}: {
  title: string;
  mode: "auto" | "manual";
  onMode: (m: "auto" | "manual") => void;
  percent: string;
  onPercent: (v: string) => void;
  agreementValue: number;
  computed: number;
  capped?: boolean;
  capLabel?: string;
  manualValue: string;
  onManual: (v: string) => void;
  statusValue: string;
  onStatus: (v: string) => void;
  t: any; inputCls: string; selectCls: string; labelCls: string;
}) {
  const isAuto = mode === "auto";
  return (
    <div className={`rounded-xl border p-3 mt-3 ${t.innerBlock}`}>
      <div className="flex items-center justify-between mb-2">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>{title}</p>
        {/* Auto / Manual segmented toggle */}
        <div className={`flex items-center rounded-full border overflow-hidden text-[10px] font-bold ${t.tableBorder}`}>
          <button type="button" onClick={() => onMode("auto")} className={`px-2.5 py-1 transition-colors ${isAuto ? "bg-[#00AEEF] text-white" : `${t.textMuted}`}`}>Auto-Calculate</button>
          <button type="button" onClick={() => onMode("manual")} className={`px-2.5 py-1 transition-colors ${!isAuto ? "bg-[#00AEEF] text-white" : `${t.textMuted}`}`}>Manual Entry</button>
        </div>
      </div>

      {isAuto && (
        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
          <span className={t.textMuted}>₹{agreementValue.toLocaleString("en-IN")}</span>
          <span className={t.textFaint}>×</span>
          <input
            type="number" step="0.01" value={percent} onChange={e => onPercent(e.target.value)}
            className={`${inputCls} w-16 text-center py-1`}
          />
          <span className={t.textFaint}>% =</span>
          <span className={`font-bold ${t.text}`}>₹{computed.toLocaleString("en-IN")}</span>
          {capped && capLabel && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-amber-500 border-amber-500/30 bg-amber-500/10">{capLabel}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{title} Amount{isAuto ? " (auto)" : ""}</label>
          {isAuto ? (
            <div className={`${inputCls} opacity-70 cursor-not-allowed flex items-center`}>₹{computed.toLocaleString("en-IN")}</div>
          ) : (
            <IndianCurrencyInput value={manualValue} onChange={onManual} className={inputCls} placeholder="Amount" />
          )}
        </div>
        <div>
          <label className={labelCls}>{title} Status</label>
          <select value={statusValue} onChange={e => onStatus(e.target.value)} className={selectCls}>
            <option value="Pending">Pending</option>
            <option value="Paid">Paid</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function defaultDealForm() {
  return {
    loan_required: false, bank_name: "", loan_executive: "", loan_type: "", loan_reference_no: "", loan_amount: "",
    sanction_amount: "", sanction_date: "", sanction_status: "Pending", loan_status: "Pending",
    interest_rate: "", loan_tenure_months: "",
    expected_disbursement_date: "", expected_disbursement_amount: "",
    actual_disbursement_date: "", disbursement_amount: "", disbursement_status: "Pending",
    custom_charges: [] as { charge_name: string; amount: string; remarks: string }[],
    token_amount: "",
    // Phase-1-3 aligned booking financials
    gst_rate: "5", stamp_duty_amount: "", stamp_duty_status: "Pending",
    registration_fee_amount: "", registration_fee_status: "Pending",
    legal_charges: "", maintenance_deposit: "",
    // Estimate-only agreement value for stamp-duty/registration auto-calc before a
    // booking exists. NEVER written to booking_applications.agreement_value.
    agreement_value_estimate: "",
    cash_component: "", cash_component_date: "", cash_component_remarks: "",
    // Multi-bank shopping history — references loan_applications rows by id.
    loan_application_ids: [] as number[],
    // ── Legacy (Phase D will remove the Section 8 UI that binds to these) ──
    ocr_amount: "", ocr_received_date: "", ocr_payment_mode: "Cheque", ocr_remarks: "",
    sdr_amount: "", sdr_payment_date: "", sdr_status: "Pending", sdr_remarks: "",
  };
}

const dateOnly = (v: any) => (v ? String(v).split("T")[0] : "");

export default function LoanDealForm({ lead, booking, loanUpdate, user, isDark = false, t, onCancel, onSuccess }: LoanDealFormProps) {
  const [loanForm, setLoanForm] = useState(defaultLoanForm());
  const [dealForm, setDealForm] = useState(defaultDealForm());
  const isLoanRequired = loanForm.loanRequired === "Yes";
  const loanNotRequired = loanForm.loanRequired === "No";
  const loanNotSure = loanForm.loanRequired === "Not Sure";
  // Qualifying the customer's income/CIBIL is useful groundwork even before the
  // loan decision is final — so the profile shows for "Yes" and "Not Sure".
  const showFinancialProfile = isLoanRequired || loanNotSure;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // True once the user has edited any field. While dirty, background prop
  // refreshes (live polling) must never silently overwrite in-progress edits.
  const [isDirty, setIsDirty] = useState(false);

  const [tranches, setTranches] = useState<Tranche[]>([]);
  const [showAddTranche, setShowAddTranche] = useState(false);
  const [trancheAmount, setTrancheAmount] = useState("");
  const [trancheStatus, setTrancheStatus] = useState("Pending");
  const [trancheReceivingDate, setTrancheReceivingDate] = useState("");
  const [trancheBankRef, setTrancheBankRef] = useState("");
  const [trancheRemarks, setTrancheRemarks] = useState("");
  const [isAddingTranche, setIsAddingTranche] = useState(false);

  // Phase D: multi-lender applications + collapsible cash + computed OCR.
  const [loanAppIds, setLoanAppIds] = useState<number[]>([]);
  const [showAdditionalPayment, setShowAdditionalPayment] = useState(false);
  const [ownContributionPaid, setOwnContributionPaid] = useState<number | null>(null);

  // Stamp Duty / Registration Fee auto-calc toggles (UI-only; no new DB column).
  // Percent stays adjustable — e.g. 4% for a female co-owner in Maharashtra.
  const [stampDutyMode, setStampDutyMode] = useState<"auto" | "manual">("auto");
  const [stampDutyPercent, setStampDutyPercent] = useState("5");
  const [registrationFeeMode, setRegistrationFeeMode] = useState<"auto" | "manual">("auto");
  const [registrationFeePercent, setRegistrationFeePercent] = useState("1");

  // Selecting a lender copies its terms into the local deal form so the sanction
  // amount (and therefore the disbursement progress) reflects the chosen bank.
  const handleSelectLender = useCallback((app: LoanApplication) => {
    setIsDirty(true);
    const sanctionStatus = app.status === "Sanctioned" ? "Approved" : app.status === "Rejected" ? "Rejected" : "Pending";
    const loanStatus = app.status === "Sanctioned" ? "Sanctioned" : "Pending";
    setDealForm(prev => ({
      ...prev,
      bank_name: app.bank_name || prev.bank_name,
      loan_type: app.loan_type || prev.loan_type,
      loan_executive: app.loan_executive || prev.loan_executive,
      loan_reference_no: app.loan_reference_no || prev.loan_reference_no,
      loan_amount: app.amount_requested != null ? String(app.amount_requested) : prev.loan_amount,
      sanction_amount: app.amount_sanctioned != null ? String(app.amount_sanctioned) : prev.sanction_amount,
      sanction_date: app.sanction_date ? String(app.sanction_date).split("T")[0] : prev.sanction_date,
      sanction_status: sanctionStatus,
      loan_status: loanStatus,
      interest_rate: app.interest_rate != null ? String(app.interest_rate) : prev.interest_rate,
      loan_tenure_months: app.tenure_months != null ? String(app.tenure_months) : prev.loan_tenure_months,
    }));
  }, []);

  // Switching to a different lead is the only time we want to force a fresh
  // populate — reset the guard so the population effects below run again.
  useEffect(() => {
    setIsDirty(false);
  }, [lead?.id]);

  useEffect(() => {
    if (isDirty) return;
    setLoanForm({
      loanRequired: loanUpdate?.loan_required || "",
      status: loanUpdate?.status && loanUpdate.status !== "Pending" ? loanUpdate.status : "",
      bank: loanUpdate?.bank_name || "",
      amountReq: loanUpdate?.amount_requested || "",
      amountApp: loanUpdate?.amount_approved || "",
      cibil: loanUpdate?.cibil || "",
      agent: loanUpdate?.agent || "",
      agentContact: loanUpdate?.agent_contact || "",
      empType: loanUpdate?.emp_type || "",
      income: loanUpdate?.income || "",
      emi: loanUpdate?.emi || "",
      docPan: loanUpdate?.doc_pan || "Pending",
      docAadhaar: loanUpdate?.doc_aadhaar || "Pending",
      docSalary: loanUpdate?.doc_salary || "Pending",
      docBank: loanUpdate?.doc_bank || "Pending",
      docProperty: loanUpdate?.doc_property || "Pending",
      notes: loanUpdate?.notes || "",
    });
  }, [loanUpdate, lead?.id, isDirty]);

  useEffect(() => {
    if (isDirty) return;
    // Prefer the real booking's saved values; fall back to the lead-level draft
    // (walkin_enquiries.loan_tracking_info) when there's no booking yet.
    let draft: any = {};
    if (!booking) {
      try {
        draft = typeof lead?.loan_tracking_info === "string" ? JSON.parse(lead.loan_tracking_info) : (lead?.loan_tracking_info || {});
      } catch { draft = {}; }
    }
    const src = booking || draft;
    let customCharges: any[] = [];
    try { customCharges = typeof src?.custom_charges === "string" ? JSON.parse(src.custom_charges) : (src?.custom_charges || []); } catch { customCharges = []; }
    setDealForm({
      loan_required: !!src?.loan_required,
      bank_name: src?.bank_name || "",
      loan_executive: src?.loan_executive || "",
      loan_type: src?.loan_type || "",
      loan_reference_no: src?.loan_reference_no || "",
      loan_amount: src?.loan_amount ? String(src.loan_amount) : "",
      sanction_amount: src?.sanction_amount ? String(src.sanction_amount) : "",
      sanction_date: dateOnly(src?.sanction_date),
      sanction_status: src?.sanction_status || "Pending",
      loan_status: src?.loan_status || "Pending",
      interest_rate: src?.interest_rate ? String(src.interest_rate) : "",
      loan_tenure_months: src?.loan_tenure_months ? String(src.loan_tenure_months) : "",
      expected_disbursement_date: dateOnly(src?.expected_disbursement_date),
      expected_disbursement_amount: src?.expected_disbursement_amount ? String(src.expected_disbursement_amount) : "",
      actual_disbursement_date: dateOnly(src?.actual_disbursement_date),
      disbursement_amount: src?.disbursement_amount ? String(src.disbursement_amount) : "",
      disbursement_status: src?.disbursement_status || "Pending",
      custom_charges: customCharges,
      token_amount: src?.token_amount ? String(src.token_amount) : "",
      // Phase-1-3 aligned booking financials (from booking row or superset draft)
      gst_rate: src?.gst_rate ? String(src.gst_rate) : "5",
      stamp_duty_amount: src?.stamp_duty_amount ? String(src.stamp_duty_amount) : "",
      stamp_duty_status: src?.stamp_duty_status || "Pending",
      registration_fee_amount: src?.registration_fee_amount ? String(src.registration_fee_amount) : "",
      registration_fee_status: src?.registration_fee_status || "Pending",
      legal_charges: src?.legal_charges ? String(src.legal_charges) : "",
      maintenance_deposit: src?.maintenance_deposit ? String(src.maintenance_deposit) : "",
      // Estimate is only meaningful pre-booking; it lives on the draft, never the booking.
      agreement_value_estimate: draft?.agreement_value_estimate ? String(draft.agreement_value_estimate) : "",
      loan_application_ids: Array.isArray(draft?.loan_application_ids) ? draft.loan_application_ids : [],
      ocr_amount: src?.ocr_amount ? String(src.ocr_amount) : "",
      ocr_received_date: dateOnly(src?.ocr_received_date),
      ocr_payment_mode: src?.ocr_payment_mode || "Cheque",
      ocr_remarks: src?.ocr_remarks || "",
      sdr_amount: src?.sdr_amount ? String(src.sdr_amount) : "",
      sdr_payment_date: dateOnly(src?.sdr_payment_date),
      sdr_status: src?.sdr_status || "Pending",
      sdr_remarks: src?.sdr_remarks || "",
      cash_component: src?.cash_component ? String(src.cash_component) : "",
      cash_component_date: dateOnly(src?.cash_component_date),
      cash_component_remarks: src?.cash_component_remarks || "",
    });
  }, [booking, lead?.id, lead?.loan_tracking_info, isDirty]);

  // Fetch tranches keyed by lead — disbursement tracking is independent of booking.
  useEffect(() => {
    if (!lead?.id) { setTranches([]); return; }
    fetch(`/api/walkin_enquiries/${lead.id}/tranches`)
      .then(r => r.json())
      .then(d => { if (d.success) setTranches(d.tranches); })
      .catch(() => { });
  }, [lead?.id]);

  // OCR is a computed value (sum of the buyer's own payments from the ledger),
  // not a manual input — read it from the payment-summary once a booking exists.
  useEffect(() => {
    if (!booking?.id) { setOwnContributionPaid(null); return; }
    fetch(`/api/booking-applications/${booking.id}/payment-summary`)
      .then(r => r.json())
      .then(d => { if (d.success) setOwnContributionPaid(Number(d.data?.own_contribution?.paid) || 0); })
      .catch(() => { });
  }, [booking?.id]);

  // All direct field edits funnel through these two helpers so every keystroke
  // marks the form dirty and blocks the population effects above.
  const updateLoanForm = useCallback((patch: Partial<ReturnType<typeof defaultLoanForm>>) => {
    setIsDirty(true);
    setLoanForm(prev => ({ ...prev, ...patch }));
  }, []);
  const updateDealForm = useCallback((patch: Partial<ReturnType<typeof defaultDealForm>>) => {
    setIsDirty(true);
    setDealForm(prev => ({ ...prev, ...patch }));
  }, []);

  const addCharge = useCallback(() => {
    setIsDirty(true);
    setDealForm(f => ({ ...f, custom_charges: [...f.custom_charges, { charge_name: "", amount: "", remarks: "" }] }));
  }, []);
  const removeCharge = useCallback((i: number) => {
    setIsDirty(true);
    setDealForm(f => ({ ...f, custom_charges: f.custom_charges.filter((_, idx) => idx !== i) }));
  }, []);
  const updateCharge = useCallback((i: number, key: "charge_name" | "amount" | "remarks", val: string) => {
    setIsDirty(true);
    setDealForm(f => {
      const rows = [...f.custom_charges];
      rows[i] = { ...rows[i], [key]: val };
      return { ...f, custom_charges: rows };
    });
  }, []);

  // Total Disbursed only counts tranches that have actually completed —
  // Pending/Scheduled tranches are earmarked but not yet money-out-the-door.
  const totalDisbursed = tranches.filter(tr => isTrancheCompleted(tr.status)).reduce((sum, tr) => sum + Number(tr.amount || 0), 0);
  const sanctionAmountNum = Number(dealForm.sanction_amount) || 0;
  const disbursementPercent = sanctionAmountNum > 0
    ? Math.min(100, Math.round((totalDisbursed / sanctionAmountNum) * 100))
    : 0;
  const canAddTranche = totalDisbursed < sanctionAmountNum;
  // Same role convention as middleware.ts's route protection.
  const userRole = (user.role || "").trim().toLowerCase();
  const isSalesManager = userRole === "sales manager";
  const canManageDisbursement = isSalesManager || userRole === "admin";
  // Once a sanction amount exists, disbursement only ever reads as Partial or
  // Completed — there's no meaningful "Pending" once tranches can be added.
  const autoDisbursementStatus = sanctionAmountNum <= 0
    ? dealForm.disbursement_status
    : totalDisbursed >= sanctionAmountNum
      ? "Completed"
      : "Partial";
  const isFullyDisbursed = autoDisbursementStatus === "Completed";

  // ── Stamp Duty / Registration Fee auto-calc ──
  const num = (v: any) => { const n = Number(String(v ?? "").replace(/[₹,\s]/g, "")); return isNaN(n) ? 0 : n; };
  // Agreement value source: the real booking wins; otherwise the estimate-only field.
  const agreementValueForCalc = booking?.agreement_value ? Number(booking.agreement_value) : num(dealForm.agreement_value_estimate);
  const computedStampDuty = Math.round(agreementValueForCalc * (num(stampDutyPercent)) / 100);
  const registrationFeeRaw = Math.round(agreementValueForCalc * (num(registrationFeePercent)) / 100);
  const REGISTRATION_FEE_CAP = 30000;
  const computedRegistrationFee = Math.min(registrationFeeRaw, REGISTRATION_FEE_CAP);
  const registrationFeeCapped = registrationFeeRaw >= REGISTRATION_FEE_CAP && agreementValueForCalc > 0;
  // The final value each field contributes, honoring its mode. Used for both the
  // live display sync and the save payload, so the two never diverge.
  const finalStampDuty = stampDutyMode === "auto" ? String(computedStampDuty) : dealForm.stamp_duty_amount;
  const finalRegistrationFee = registrationFeeMode === "auto" ? String(computedRegistrationFee) : dealForm.registration_fee_amount;

  // Smart default: default is "auto", but if a record already has a stamp-duty /
  // registration value that doesn't match a straight 5% / 1% auto calc (e.g. it was
  // entered manually or at 4% for a female co-owner), start that block in "manual"
  // so reopening never silently recomputes and overwrites a deliberate number.
  useEffect(() => {
    let d: any = {};
    if (!booking) { try { d = typeof lead?.loan_tracking_info === "string" ? JSON.parse(lead.loan_tracking_info) : (lead?.loan_tracking_info || {}); } catch { d = {}; } }
    const s: any = booking || d;
    const av = booking?.agreement_value ? Number(booking.agreement_value) : num(s?.agreement_value_estimate);
    const sd = num(s?.stamp_duty_amount);
    const rf = num(s?.registration_fee_amount);
    setStampDutyMode(sd > 0 && av > 0 && sd !== Math.round(av * 5 / 100) ? "manual" : "auto");
    setRegistrationFeeMode(rf > 0 && av > 0 && rf !== Math.min(Math.round(av * 1 / 100), 30000) ? "manual" : "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, booking?.id]);

  // Keep dealForm in sync with the computed value while in auto mode (display reads
  // the computed value directly, so this is belt-and-suspenders for the save path).
  useEffect(() => {
    if (stampDutyMode !== "auto") return;
    setDealForm(prev => (prev.stamp_duty_amount === finalStampDuty ? prev : { ...prev, stamp_duty_amount: finalStampDuty }));
  }, [stampDutyMode, finalStampDuty]);
  useEffect(() => {
    if (registrationFeeMode !== "auto") return;
    setDealForm(prev => (prev.registration_fee_amount === finalRegistrationFee ? prev : { ...prev, registration_fee_amount: finalRegistrationFee }));
  }, [registrationFeeMode, finalRegistrationFee]);

  const resetTrancheForm = () => {
    setTrancheAmount(""); setTrancheStatus("Pending"); setTrancheReceivingDate(""); setTrancheBankRef(""); setTrancheRemarks("");
  };

  const handleAddTranche = async () => {
    if (!lead?.id || isAddingTranche) return;
    setIsAddingTranche(true);
    try {
      const res = await fetch(`/api/walkin_enquiries/${lead.id}/tranches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: trancheAmount,
          status: trancheStatus,
          receiving_date: trancheReceivingDate,
          bank_reference_no: trancheBankRef,
          remarks: trancheRemarks,
          sanction_amount: dealForm.sanction_amount,
          user_name: user.name,
          user_role: user.role,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setTranches(prev => [...prev, json.tranche]);
        const newTotal = Number(json.totalDisbursed);
        setDealForm(f => ({
          ...f,
          disbursement_amount: String(newTotal),
          disbursement_status: sanctionAmountNum > 0 && newTotal >= sanctionAmountNum ? "Completed" : "Partial",
        }));
        resetTrancheForm();
        setShowAddTranche(false);
      } else {
        setError(json.message || "Failed to add tranche");
      }
    } finally {
      setIsAddingTranche(false);
    }
  };

  const inputCls = `w-full rounded-lg px-4 py-2 text-sm outline-none transition-colors border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const selectCls = `w-full rounded-lg px-4 py-2 text-sm sm:py-2.5 outline-none cursor-pointer border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const labelCls = `text-xs mb-1 block ${t.textMuted}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      // ── Sections 1-5: loan_updates (always) ──
      const loanRes = await fetch("/api/loan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(lead.id),
          salesManagerName: user.name,
          createdBy: user.role === "admin" ? "admin" : "sales",
          loanRequired: loanForm.loanRequired,
          status: loanForm.status,
          bank: loanForm.bank,
          amountReq: loanForm.amountReq,
          amountApp: loanForm.amountApp,
          cibil: loanForm.cibil,
          agent: loanForm.agent,
          agentContact: loanForm.agentContact,
          empType: loanForm.empType,
          income: loanForm.income,
          emi: loanForm.emi,
          docPan: loanForm.docPan,
          docAadhaar: loanForm.docAadhaar,
          docSalary: loanForm.docSalary,
          docBank: loanForm.docBank,
          docProperty: loanForm.docProperty,
          notes: loanForm.notes,
        }),
      });
      const loanJson = await loanRes.json().catch(() => ({}));
      if (!loanRes.ok || !loanJson.success) {
        setError(loanJson.message || "Failed to save loan tracking update");
        return;
      }

      // ── Sections 6-8: booking_loan_details + booking_financials if a booking
      // already exists, otherwise saved as a draft on the lead itself so
      // BookingFormModal can prefill from it when the booking is later created ──
      if (booking?.id) {
        const fd = new FormData();
        // Copy every existing booking field forward first, so fields this form
        // doesn't touch (applicant info, unit details, etc.) are never blanked —
        // PUT /api/booking-applications/[id] overwrites whatever is present in the FormData.
        Object.entries(booking).forEach(([k, v]) => {
          if (v === null || v === undefined) return;
          fd.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        });

        fd.set("loan_required", dealForm.loan_required ? "true" : "false");
        fd.set("bank_name", dealForm.bank_name);
        fd.set("loan_executive", dealForm.loan_executive);
        fd.set("loan_type", dealForm.loan_type);
        fd.set("loan_reference_no", dealForm.loan_reference_no);
        fd.set("loan_amount", dealForm.loan_amount);
        fd.set("sanction_amount", dealForm.sanction_amount);
        fd.set("sanction_date", dealForm.sanction_date);
        fd.set("sanction_status", dealForm.sanction_status);
        fd.set("loan_status", dealForm.loan_status);
        fd.set("expected_disbursement_date", dealForm.expected_disbursement_date);
        fd.set("expected_disbursement_amount", dealForm.expected_disbursement_amount);
        fd.set("actual_disbursement_date", dealForm.actual_disbursement_date);
        fd.set("disbursement_amount", dealForm.disbursement_amount);
        fd.set("disbursement_status", autoDisbursementStatus);
        fd.set("custom_charges", JSON.stringify(dealForm.custom_charges));
        fd.set("token_amount", dealForm.token_amount);
        // Phase-1-3 aligned booking financials (now collected by Section 8's swapped inputs).
        // Safe to send: the population effect seeds these from the existing booking, so an
        // untouched field re-sends its current value rather than blanking it.
        fd.set("gst_rate", dealForm.gst_rate);
        // Mode-resolved final values so auto/manual both persist the right number.
        fd.set("stamp_duty_amount", finalStampDuty);
        fd.set("stamp_duty_status", dealForm.stamp_duty_status);
        fd.set("registration_fee_amount", finalRegistrationFee);
        fd.set("registration_fee_status", dealForm.registration_fee_status);
        fd.set("legal_charges", dealForm.legal_charges);
        fd.set("maintenance_deposit", dealForm.maintenance_deposit);
        // Legacy OCR/SDR still forwarded to preserve existing booking values (no UI to edit them).
        fd.set("ocr_amount", dealForm.ocr_amount);
        fd.set("ocr_received_date", dealForm.ocr_received_date);
        fd.set("ocr_payment_mode", dealForm.ocr_payment_mode);
        fd.set("ocr_remarks", dealForm.ocr_remarks);
        fd.set("sdr_amount", dealForm.sdr_amount);
        fd.set("sdr_payment_date", dealForm.sdr_payment_date);
        fd.set("sdr_status", dealForm.sdr_status);
        fd.set("sdr_remarks", dealForm.sdr_remarks);
        fd.set("cash_component", dealForm.cash_component);
        fd.set("cash_component_date", dealForm.cash_component_date);
        fd.set("cash_component_remarks", dealForm.cash_component_remarks);
        fd.set("loan_application_ids", JSON.stringify(loanAppIds));
        fd.set("user_role", user.role);
        fd.set("user_name", user.name);

        const bookingRes = await fetch(`/api/booking-applications/${booking.id}`, { method: "PUT", body: fd });
        const bookingJson = await bookingRes.json().catch(() => ({}));
        if (!bookingRes.ok || !bookingJson.success) {
          setError(bookingJson.message || "Loan tracking saved, but deal/financial details failed to save");
          return;
        }
      } else {
        // Phase B: write the draft in the exact superset shape BookingFormModal.defaultForm
        // reads — a direct field-for-field copy with no translation layer. Legacy ocr_* /
        // sdr_* are intentionally excluded (ocr is a computed ledger sum; sdr is replaced by
        // the stamp-duty / registration split).
        const loanTrackingDraft = {
          loan_required: dealForm.loan_required,
          bank_name: dealForm.bank_name,
          loan_executive: dealForm.loan_executive,
          loan_type: dealForm.loan_type,
          loan_reference_no: dealForm.loan_reference_no,
          loan_amount: dealForm.loan_amount,
          sanction_amount: dealForm.sanction_amount,
          sanction_date: dealForm.sanction_date,
          sanction_status: dealForm.sanction_status,
          loan_status: dealForm.loan_status,
          interest_rate: dealForm.interest_rate,
          loan_tenure_months: dealForm.loan_tenure_months,
          expected_disbursement_date: dealForm.expected_disbursement_date,
          expected_disbursement_amount: dealForm.expected_disbursement_amount,
          actual_disbursement_date: dealForm.actual_disbursement_date,
          disbursement_amount: dealForm.disbursement_amount,
          disbursement_status: autoDisbursementStatus,
          token_amount: dealForm.token_amount,
          gst_rate: dealForm.gst_rate,
          stamp_duty_amount: finalStampDuty,
          stamp_duty_status: dealForm.stamp_duty_status,
          registration_fee_amount: finalRegistrationFee,
          registration_fee_status: dealForm.registration_fee_status,
          legal_charges: dealForm.legal_charges,
          maintenance_deposit: dealForm.maintenance_deposit,
          // Estimate-only — persisted on the draft so the calc survives round-trips.
          // Deliberately NOT sent as agreement_value (that's the booking's real field).
          agreement_value_estimate: dealForm.agreement_value_estimate,
          cash_component: dealForm.cash_component,
          cash_component_date: dealForm.cash_component_date,
          cash_component_remarks: dealForm.cash_component_remarks,
          custom_charges: dealForm.custom_charges,
          loan_application_ids: loanAppIds,
        };
        const draftRes = await fetch(`/api/walkin_enquiries/${lead.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: lead.name, loan_tracking_info: loanTrackingDraft }),
        });
        const draftJson = await draftRes.json().catch(() => ({}));
        if (!draftRes.ok || !draftJson.success) {
          setError(draftJson.message || "Loan tracking saved, but deal/financial draft failed to save");
          return;
        }
      }

      setIsDirty(false);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || "Network error while saving loan details");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`rounded-xl border p-3 sm:p-3 shadow-xl overflow-y-auto custom-scrollbar flex flex-col animate-fadeIn max-h-[80vh] lg:max-h-[calc(100vh-185px)] ${t.modalCard}`} style={t.modalGlass}>
      <div className={`flex justify-between items-center mb-4 border-b pb-3 flex-shrink-0 ${t.tableBorder}`}>
        <div>
          <h3 className={`text-base sm:text-lg font-bold flex items-center gap-2 ${isDark ? "text-[#00AEEF]" : "text-[#00AEEF]"}`}><FaUniversity /> Loan & Deal Tracking</h3>
          <p className={`text-xs mt-0.5 ${t.textFaint}`}>For Lead #{lead.sr_no || lead.id}</p>
        </div>
        <button type="button" onClick={onCancel} className={`p-2 ${t.textMuted} hover:text-red-500`}><FaTimes /></button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 flex-shrink-0">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 flex-1">

        {/* SECTION 1 — Qualification */}
        <div>
          <SectionHeader icon="🤝" title="1. Deal Qualification" subtitle="Is the customer purchasing with a loan?" t={t} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Loan Required? *</label>
              <select required value={loanForm.loanRequired} onChange={e => updateLoanForm({ loanRequired: e.target.value })} className={selectCls}>
                <option value="">Select</option>
                {LOAN_REQUIRED_OPTS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {loanNotRequired && (
          <div className={`rounded-lg p-4 text-center text-sm font-semibold ${t.innerBlock} ${t.textMuted}`}>
            Customer will purchase without loan.
          </div>
        )}

        {loanNotSure && (
          <div className={`rounded-lg p-4 text-center text-sm ${t.innerBlock} ${t.textMuted}`}>
            <p className="font-semibold mb-1">Loan requirement not yet confirmed.</p>
            <p className="text-xs">You can still capture the customer&apos;s financial profile below — switch this to &quot;Yes&quot; once they decide to proceed with a loan.</p>
          </div>
        )}

        {/* SECTION 2 — Customer Financial Profile (shown for Yes and Not Sure) */}
        {showFinancialProfile && (
          <div className={`border-t pt-3 ${t.tableBorder}`}>
            <SectionHeader icon="📄" title="2. Customer Financial Profile" subtitle="Understand the customer's income and repayment capacity." t={t} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Employment</label>
                <select value={loanForm.empType} onChange={e => updateLoanForm({ empType: e.target.value })} className={selectCls}>
                  <option value="">Select</option>
                  <option>Salaried</option><option>Self-employed</option>
                </select>
              </div>
              <div><label className={labelCls}>Monthly Income</label><IndianCurrencyInput
                value={loanForm.income}
                onChange={val => updateLoanForm({ income: val })}
                className={inputCls}
                placeholder="Monthly Income"
              /></div>
              <div><label className={labelCls}>Existing EMIs</label><IndianCurrencyInput
                value={loanForm.emi}
                onChange={val => updateLoanForm({ income: val })}
                className={inputCls}
                placeholder="EXisting Emi"
              /></div>
              <div><label className={labelCls}>CIBIL Score</label><input type="text" value={loanForm.cibil} onChange={e => updateLoanForm({ cibil: e.target.value })} className={inputCls} placeholder="e.g. 750" /></div>
            </div>
          </div>
        )}

        {isLoanRequired && (
          <>
            <LoanProgressTimeline
              loanForm={loanForm}
              dealForm={dealForm}
              isLoanRequired={isLoanRequired}
              loanNotRequired={loanNotRequired}
              t={t}
            />

            {/* SECTION 3 — Loan Requirement */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="💰" title="3. Loan Requirement" subtitle="What the customer is asking for." t={t} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className={labelCls}>Required Loan Amount</label><input type="text" value={loanForm.amountReq} onChange={e => updateLoanForm({ amountReq: e.target.value })} className={inputCls} placeholder="e.g. 60L" /></div>
                <div>
                  <label className={labelCls}>Loan Type</label>
                  <select value={dealForm.loan_type} onChange={e => updateDealForm({ loan_type: e.target.value })} className={selectCls}>
                    <option value="">Select</option>
                    {LOAN_TYPE_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Preferred Bank (Optional)</label><input type="text" value={dealForm.bank_name} onChange={e => updateDealForm({ bank_name: e.target.value })} className={inputCls} placeholder="e.g. HDFC" /></div>
              </div>
            </div>

            {/* SECTION 4 — Document Collection */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="📁" title="4. Document Collection" subtitle="Track which documents have been received from the customer." t={t} />
              <div className={`rounded-lg border divide-y ${t.innerBlock}`}>
                {["docPan", "docAadhaar", "docSalary", "docBank", "docProperty"].map(docKey => {
                  const label = docKey === "docPan" ? "PAN Card" : docKey === "docAadhaar" ? "Aadhaar Card" : docKey === "docSalary" ? "Salary Slips / ITR" : docKey === "docBank" ? "Bank Statements" : "Property Documents";
                  const isUploaded = (loanForm as any)[docKey] === "Uploaded";
                  return (
                    <div key={docKey} className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center border flex-shrink-0 ${isUploaded ? "bg-green-500 border-green-500" : `${t.innerBlock} border-gray-400`}`}>
                          {isUploaded && <FaCheck className="text-white text-[8px]" />}
                        </span>
                        <span className={`text-xs font-medium ${t.text}`}>{label}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateLoanForm({ [docKey]: isUploaded ? "Pending" : "Uploaded" })}
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${isUploaded ? "text-green-400 border-green-500/40 bg-green-500/10" : "text-gray-500 border-gray-400/40 bg-gray-500/5"}`}
                      >
                        {isUploaded ? "✓ Uploaded" : "Pending"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* SECTION 5 — Loan Processing (activity-log level: agent + overall status) */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="🏦" title="5. Loan Processing" subtitle="Agent handling and overall status. Bank-specific details live per lender below." t={t} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className={labelCls}>DSA / Agent Name</label><input type="text" value={loanForm.agent} onChange={e => updateLoanForm({ agent: e.target.value })} className={inputCls} placeholder="Agent name" /></div>
                <div><label className={labelCls}>Agent Contact</label><input type="tel" value={loanForm.agentContact} onChange={e => updateLoanForm({ agentContact: e.target.value })} className={inputCls} placeholder="Agent Phone" /></div>
                <div>
                  <label className={labelCls}>Overall Loan Status</label>
                  <select required value={loanForm.status} onChange={e => updateLoanForm({ status: e.target.value })} className={selectCls}>
                    <option value="">Select Status</option>
                    {LOAN_STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* SECTION 6 — Lender Applications (multi-bank tracker; replaces single-bank + sanction) */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="✅" title="6. Lender Applications" subtitle="File with multiple banks; select the one the buyer proceeds with — its sanction drives disbursement." t={t} />
              <LenderApplicationsTracker
                leadId={lead.id}
                userName={user.name}
                userRole={user.role}
                isDark={isDark}
                t={t}
                onListChange={setLoanAppIds}
                onSelectLender={handleSelectLender}
              />
              {sanctionAmountNum > 0 && (
                <p className={`text-[11px] mt-2 ${t.textMuted}`}>
                  Selected lender sanction: <b className={t.text}>₹{sanctionAmountNum.toLocaleString("en-IN")}</b>
                  {dealForm.bank_name ? <> · {dealForm.bank_name}</> : null}
                </p>
              )}
            </div>

            {/* SECTION 7 — Disbursement */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="💸" title="7. Disbursement" subtitle="Once sanction is complete." t={t} />

              {/* Planning — forward-looking estimates, always shown once sanctioned,
                  above the progress/tranches. Distinct from the actual-disbursement summary. */}
              {sanctionAmountNum > 0 && (
                <div className={`rounded-xl border p-3 mb-3 ${t.innerBlock}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${t.textMuted}`}>Planning (Expected)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Expected Disbursement Date</label>
                      <input type="date" value={dealForm.expected_disbursement_date} onChange={e => updateDealForm({ expected_disbursement_date: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Expected Disbursement Amount</label>
                      <IndianCurrencyInput value={dealForm.expected_disbursement_amount} onChange={val => updateDealForm({ expected_disbursement_amount: val })} className={inputCls} placeholder="Amount" />
                    </div>
                  </div>
                </div>
              )}

              {sanctionAmountNum > 0 && (
                <DisbursementProgressBar
                  totalDisbursed={totalDisbursed}
                  sanctionAmount={sanctionAmountNum}
                  percent={disbursementPercent}
                  isDark={isDark}
                  t={t}
                />
              )}

              {isFullyDisbursed ? (
                /* Fully disbursed — collapse to a summary. Total Disbursed is derived from
                   completed tranches, so it's read-only, never a hand-edited value. */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Total Disbursed <span className="opacity-70">(from tranches)</span></label>
                    <div className={`${inputCls} opacity-70 cursor-not-allowed flex items-center`}>₹{totalDisbursed.toLocaleString("en-IN")}</div>
                  </div>
                  <div><label className={labelCls}>Actual Disbursement Date</label><input type="date" value={dealForm.actual_disbursement_date} onChange={e => updateDealForm({ actual_disbursement_date: e.target.value })} className={inputCls} /></div>
                </div>
              ) : (
                <>
                  {/* ── Tranche history — card rows, not a cramped grid ── */}
                  {sanctionAmountNum > 0 && tranches.length > 0 && (
                    <div className="mb-3">
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${t.textMuted}`}>
                        Tranche History ({tranches.length})
                      </p>
                      <div className="space-y-2">
                        {tranches.map((tr, idx) => (
                          <div key={tr.id} className={`rounded-xl border p-3 ${t.innerBlock}`}>
                            {/* Row 1: number + amount + status badge */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2.5">
                                <span className="w-6 h-6 rounded-full bg-[#00AEEF]/10 border border-[#00AEEF]/30 text-[#00AEEF] flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                  {idx + 1}
                                </span>
                                <span className={`text-sm font-bold ${t.text}`}>
                                  ₹{Number(tr.amount).toLocaleString("en-IN")}
                                </span>
                              </div>
                              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${isTrancheCompleted(tr.status)
                                ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                                : tr.status === "Scheduled"
                                  ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
                                  : "text-amber-400 border-amber-500/30 bg-amber-500/10"
                                }`}>
                                {tr.status}
                              </span>
                            </div>
                            {/* Row 2: metadata */}
                            <div className="grid grid-cols-3 gap-2 pl-[34px]">
                              <div>
                                <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Receiving Date</p>
                                <p className={`text-[11px] font-medium ${t.text}`}>
                                  {tr.receiving_date ? new Date(tr.receiving_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                                </p>
                              </div>
                              <div>
                                <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Bank Ref</p>
                                <p className={`text-[11px] font-medium truncate ${t.text}`}>{tr.bank_reference_no || "—"}</p>
                              </div>
                              <div>
                                <p className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Created</p>
                                <p className={`text-[11px] font-medium ${t.text}`}>
                                  {new Date(tr.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                </p>
                              </div>
                            </div>
                            {/* Row 3: remarks, only if present */}
                            {tr.remarks && (
                              <p className={`text-[10px] mt-2 pl-[34px] italic ${t.textFaint}`}>
                                "{tr.remarks}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Add Tranche button ── */}
                  {canManageDisbursement && sanctionAmountNum > 0 && canAddTranche && !showAddTranche && (
                    <button
                      type="button"
                      onClick={() => setShowAddTranche(true)}
                      className="flex items-center justify-center gap-1.5 w-full text-xs font-bold px-3 py-2.5 rounded-xl mb-3 bg-[#00AEEF] text-white hover:bg-[#0095cc] transition-colors shadow-sm"
                    >
                      <FaPlus className="text-[10px]" /> Add Tranche
                    </button>
                  )}

                  {/* ── Add Tranche form ── */}
                  {showAddTranche && (
                    <div className={`rounded-xl border-2 border-[#00AEEF]/30 p-4 mb-3 ${t.innerBlock}`}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#00AEEF]">
                          New Tranche #{tranches.length + 1}
                        </p>
                        <button
                          type="button"
                          onClick={() => { setShowAddTranche(false); resetTrancheForm(); }}
                          className={`p-1 rounded ${t.textMuted} hover:text-red-500`}
                        >
                          <FaTimes className="text-xs" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>Disbursement Amount *</label>
                          <IndianCurrencyInput value={trancheAmount} onChange={setTrancheAmount} className={inputCls} placeholder="Amount" />
                        </div>
                        <div>
                          <label className={labelCls}>Receiving Date</label>
                          <input type="date" value={trancheReceivingDate} onChange={e => setTrancheReceivingDate(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>Status</label>
                          <select value={trancheStatus} onChange={e => setTrancheStatus(e.target.value)} className={selectCls}>
                            <option>Pending</option><option>Scheduled</option><option>Completed</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>Bank Reference No.</label>
                          <input type="text" value={trancheBankRef} onChange={e => setTrancheBankRef(e.target.value)} className={inputCls} placeholder="e.g. NEFT/RTGS ref" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className={labelCls}>Remarks (optional)</label>
                          <input type="text" value={trancheRemarks} onChange={e => setTrancheRemarks(e.target.value)} className={inputCls} placeholder="Any notes" />
                        </div>
                      </div>
                      {(() => {
                        const remaining = Math.max(0, sanctionAmountNum - totalDisbursed);
                        const enteredAmt = Number(String(trancheAmount || "").replace(/,/g, "")) || 0;
                        const exceedsRemaining = enteredAmt > remaining && remaining > 0;
                        return (
                          <>
                            {exceedsRemaining && (
                              <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] font-semibold text-red-400">
                                ⚠ Amount exceeds remaining disbursement (₹{remaining.toLocaleString("en-IN")})
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={isAddingTranche || !trancheAmount || exceedsRemaining}
                              onClick={handleAddTranche}
                              className="w-full mt-3 text-xs font-bold py-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed bg-[#00AEEF] text-white hover:bg-[#0095cc] transition-colors shadow-sm"
                            >
                              {isAddingTranche ? "Saving..." : "Save Tranche"}
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}

              {/* ── Auto-computed status (read-only) ── */}
              <div className="mt-3">
                <label className={labelCls}>Disbursement Status</label>
                <div className={`${inputCls} cursor-not-allowed opacity-70 flex items-center justify-between`}>
                  <span>{autoDisbursementStatus}</span>
                  <span className={`text-[9px] uppercase tracking-wider ${t.textFaint}`}>Auto</span>
                </div>
              </div>
            </div>

            {/* SECTION 7.5 — Post-Disbursement Documents (only once fully disbursed) */}
            {isFullyDisbursed && (
              <div className={`border-t pt-3 ${t.tableBorder}`}>
                <SectionHeader icon="📑" title="7.5 Post-Disbursement Documents (PDD)" subtitle="Originals the bank requires after full disbursement." t={t} />
                <PddChecklist
                  bookingId={booking?.id ?? null}
                  userName={user.name}
                  userRole={user.role}
                  isDark={isDark}
                  t={t}
                  disbursementDate={dealForm.actual_disbursement_date || null}
                />
              </div>
            )}

            {/* SECTION 8 — Registration & Booking Financials */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="📝" title="8. Registration & Booking Financials" subtitle={!booking ? "Draft — will prefill the Booking Form on Mark as Closing" : "Booking payment lifecycle"} t={t} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Token Amount</label><IndianCurrencyInput value={dealForm.token_amount} onChange={val => updateDealForm({ token_amount: val })} className={inputCls} placeholder="50,000" /></div>
                <div>
                  <label className={labelCls}>GST Rate</label>
                  <select value={dealForm.gst_rate} onChange={e => updateDealForm({ gst_rate: e.target.value })} className={selectCls}>
                    <option value="5">5% (no ITC)</option>
                    <option value="12">12% (with ITC)</option>
                  </select>
                </div>
              </div>

              {/* Agreement value source for stamp-duty / registration auto-calc */}
              <div className="mt-3">
                {booking?.agreement_value ? (
                  <div className={`rounded-lg border p-2.5 flex items-center justify-between ${t.innerBlock}`}>
                    <span className={`text-[11px] font-semibold ${t.textMuted}`}>Agreement Value <span className="opacity-70">(from booking)</span></span>
                    <span className={`text-sm font-bold ${t.text}`}>₹{Number(booking.agreement_value).toLocaleString("en-IN")}</span>
                  </div>
                ) : (
                  <div>
                    <label className={labelCls}>Agreement Value (Estimate) <span className="opacity-70">— used only for the calculations below</span></label>
                    <IndianCurrencyInput value={dealForm.agreement_value_estimate} onChange={val => updateDealForm({ agreement_value_estimate: val })} className={inputCls} placeholder="e.g. 50,00,000" />
                  </div>
                )}
              </div>

              {/* Stamp Duty — auto/manual */}
              <StampDutyBlock
                title="Stamp Duty"
                mode={stampDutyMode}
                onMode={m => { setIsDirty(true); setStampDutyMode(m); }}
                percent={stampDutyPercent}
                onPercent={v => { setIsDirty(true); setStampDutyPercent(v); }}
                agreementValue={agreementValueForCalc}
                computed={computedStampDuty}
                manualValue={dealForm.stamp_duty_amount}
                onManual={val => updateDealForm({ stamp_duty_amount: val })}
                statusValue={dealForm.stamp_duty_status}
                onStatus={v => updateDealForm({ stamp_duty_status: v })}
                t={t} inputCls={inputCls} selectCls={selectCls} labelCls={labelCls}
              />

              {/* Registration Fee — auto/manual, capped at ₹30,000 */}
              <StampDutyBlock
                title="Registration Fee"
                mode={registrationFeeMode}
                onMode={m => { setIsDirty(true); setRegistrationFeeMode(m); }}
                percent={registrationFeePercent}
                onPercent={v => { setIsDirty(true); setRegistrationFeePercent(v); }}
                agreementValue={agreementValueForCalc}
                computed={computedRegistrationFee}
                capped={registrationFeeCapped}
                capLabel="Capped at ₹30,000"
                manualValue={dealForm.registration_fee_amount}
                onManual={val => updateDealForm({ registration_fee_amount: val })}
                statusValue={dealForm.registration_fee_status}
                onStatus={v => updateDealForm({ registration_fee_status: v })}
                t={t} inputCls={inputCls} selectCls={selectCls} labelCls={labelCls}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div><label className={labelCls}>Legal Charges</label><IndianCurrencyInput value={dealForm.legal_charges} onChange={val => updateDealForm({ legal_charges: val })} className={inputCls} placeholder="If applicable" /></div>
                <div><label className={labelCls}>Maintenance Deposit</label><IndianCurrencyInput value={dealForm.maintenance_deposit} onChange={val => updateDealForm({ maintenance_deposit: val })} className={inputCls} placeholder="If applicable" /></div>
              </div>

              {/* D6: OCR is a computed value (buyer's own payments from the ledger), not an input */}
              <div className={`mt-3 rounded-lg border p-3 ${t.innerBlock}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-semibold ${t.textMuted}`}>Own Contribution So Far (OCR)</span>
                  {booking?.id ? (
                    <span className="text-sm font-bold text-emerald-500">₹{(ownContributionPaid ?? 0).toLocaleString("en-IN")}</span>
                  ) : (
                    <span className={`text-[11px] italic ${t.textFaint}`}>Not yet trackable — computes once booking is created</span>
                  )}
                </div>
              </div>

              {/* D7: Additional Direct Payment — collapsed, relabeled, with compliance note */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowAdditionalPayment(v => !v)}
                  className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}
                >
                  <FaChevronRight className={`text-[9px] transition-transform ${showAdditionalPayment ? "rotate-90" : ""}`} />
                  Additional Direct Payment (Optional)
                </button>
                {showAdditionalPayment && (
                  <div className="mt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div><label className={labelCls}>Amount</label><IndianCurrencyInput value={dealForm.cash_component} onChange={val => updateDealForm({ cash_component: val })} className={inputCls} placeholder="If applicable" /></div>
                      <div><label className={labelCls}>Date</label><input type="date" value={dealForm.cash_component_date} onChange={e => updateDealForm({ cash_component_date: e.target.value })} className={inputCls} /></div>
                      <div><label className={labelCls}>Remarks</label><input type="text" value={dealForm.cash_component_remarks} onChange={e => updateDealForm({ cash_component_remarks: e.target.value })} className={inputCls} /></div>
                    </div>
                    <p className={`mt-2 text-[11px] ${isDark ? "text-amber-400" : "text-amber-600"}`}>⚠ This payment is outside the agreement value.</p>
                  </div>
                )}
              </div>

              {/* Custom Charges */}
              <div className="flex items-center justify-between mt-3 mb-2">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>Custom Charges</p>
                <button type="button" onClick={addCharge} className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded ${t.btnSecondary}`}>
                  <FaPlus className="text-[9px]" /> Add Charge
                </button>
              </div>
              {dealForm.custom_charges.map((c, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr_auto] gap-2 mb-2 items-center">
                  <input type="text" value={c.charge_name} onChange={e => updateCharge(i, "charge_name", e.target.value)} placeholder="Charge name" className={`${inputCls} text-xs py-1.5`} />
                  <IndianCurrencyInput value={c.amount} onChange={val => updateCharge(i, "amount", val)} placeholder="Amount" className={`${inputCls} text-xs py-1.5`} />
                  <input type="text" value={c.remarks} onChange={e => updateCharge(i, "remarks", e.target.value)} placeholder="Remarks" className={`${inputCls} text-xs py-1.5`} />
                  <button type="button" onClick={() => removeCharge(i)} className="text-red-500 hover:text-red-400 p-1"><FaTrash className="text-xs" /></button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* SECTION 9 — Internal Notes (always visible, even if no loan) */}
        <div className={`border-t pt-3 ${t.tableBorder}`}>
          <SectionHeader icon="🗒️" title="9. Internal Notes" subtitle="Sales team remarks, bank feedback, customer concerns — not shown to the customer." t={t} />
          <textarea value={loanForm.notes} onChange={e => updateLoanForm({ notes: e.target.value })}
            className={`w-full rounded-lg px-4 py-2.5 text-sm outline-none resize-none h-20 custom-scrollbar border ${t.inputInner} ${t.text} ${t.inputFocus}`}
            placeholder="Bank feedback, CIBIL issues, internal notes..." />
        </div>

        <button type="submit" disabled={isSubmitting} className={`mt-4 flex-shrink-0 w-full font-bold py-3 rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-60 ${t.btnSecondary}`}>
          {isSubmitting ? "Saving..." : "Save Loan & Deal Tracker"}
        </button>
      </form>
    </div>
  );
}