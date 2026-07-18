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
import { FaUniversity, FaTimes, FaFileAlt, FaFileInvoiceDollar, FaPlus, FaTrash, FaCheck } from "react-icons/fa";
import IndianCurrencyInput from "@/components/IndianCurrencyInput";

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
const SANCTION_STATUS_OPTS = ["Pending", "Approved", "Rejected"];
const OVERALL_LOAN_STATUS_OPTS = ["Pending", "Sanctioned", "Partially Disbursed", "Fully Disbursed"];
const OCR_PAYMENT_MODE_OPTS = ["Cheque", "NEFT/RTGS", "Cash", "UPI", "Demand Draft", "Other"];
const SDR_STATUS_OPTS = ["Pending", "Paid"];

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

function defaultDealForm() {
  return {
    loan_required: false, bank_name: "", loan_executive: "", loan_type: "", loan_reference_no: "", loan_amount: "",
    sanction_amount: "", sanction_date: "", sanction_status: "Pending", loan_status: "Pending",
    expected_disbursement_date: "", expected_disbursement_amount: "",
    actual_disbursement_date: "", disbursement_amount: "", disbursement_status: "Pending",
    custom_charges: [] as { charge_name: string; amount: string; remarks: string }[],
    token_amount: "", ocr_amount: "", ocr_received_date: "", ocr_payment_mode: "Cheque", ocr_remarks: "",
    sdr_amount: "", sdr_payment_date: "", sdr_status: "Pending", sdr_remarks: "",
    cash_component: "", cash_component_date: "", cash_component_remarks: "",
  };
}

const dateOnly = (v: any) => (v ? String(v).split("T")[0] : "");

export default function LoanDealForm({ lead, booking, loanUpdate, user, isDark = false, t, onCancel, onSuccess }: LoanDealFormProps) {
  const [loanForm, setLoanForm] = useState(defaultLoanForm());
  const [dealForm, setDealForm] = useState(defaultDealForm());
  const isLoanRequired = loanForm.loanRequired === "Yes";
  const loanNotRequired = loanForm.loanRequired === "No";
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
      expected_disbursement_date: dateOnly(src?.expected_disbursement_date),
      expected_disbursement_amount: src?.expected_disbursement_amount ? String(src.expected_disbursement_amount) : "",
      actual_disbursement_date: dateOnly(src?.actual_disbursement_date),
      disbursement_amount: src?.disbursement_amount ? String(src.disbursement_amount) : "",
      disbursement_status: src?.disbursement_status || "Pending",
      custom_charges: customCharges,
      token_amount: src?.token_amount ? String(src.token_amount) : "",
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
        fd.set("user_role", user.role);
        fd.set("user_name", user.name);

        const bookingRes = await fetch(`/api/booking-applications/${booking.id}`, { method: "PUT", body: fd });
        const bookingJson = await bookingRes.json().catch(() => ({}));
        if (!bookingRes.ok || !bookingJson.success) {
          setError(bookingJson.message || "Loan tracking saved, but deal/financial details failed to save");
          return;
        }
      } else {
        const draftRes = await fetch(`/api/walkin_enquiries/${lead.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: lead.name, loan_tracking_info: { ...dealForm, disbursement_status: autoDisbursementStatus } }),
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

        {isLoanRequired && (
          <>
            <LoanProgressTimeline
              loanForm={loanForm}
              dealForm={dealForm}
              isLoanRequired={isLoanRequired}
              loanNotRequired={loanNotRequired}
              t={t}
            />

            {/* SECTION 2 — Customer Financial Profile */}
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
                <div><label className={labelCls}>Monthly Income</label><input type="text" value={loanForm.income} onChange={e => updateLoanForm({ income: e.target.value })} className={inputCls} placeholder="e.g. 1L" /></div>
                <div><label className={labelCls}>Existing EMIs</label><input type="text" value={loanForm.emi} onChange={e => updateLoanForm({ emi: e.target.value })} className={inputCls} placeholder="e.g. 15k" /></div>
                <div><label className={labelCls}>CIBIL Score</label><input type="text" value={loanForm.cibil} onChange={e => updateLoanForm({ cibil: e.target.value })} className={inputCls} placeholder="e.g. 750" /></div>
              </div>
            </div>

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

            {/* SECTION 5 — Loan Processing */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="🏦" title="5. Loan Processing" subtitle="Bank-side handling once documents are submitted." t={t} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Loan Executive (Officer)</label><input type="text" value={dealForm.loan_executive} onChange={e => updateDealForm({ loan_executive: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Agent Contact</label><input type="tel" value={loanForm.agentContact} onChange={e => updateLoanForm({ agentContact: e.target.value })} className={inputCls} placeholder="Agent Phone" /></div>
                <div><label className={labelCls}>Bank Name</label><input type="text" value={dealForm.bank_name} onChange={e => updateDealForm({ bank_name: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Loan Reference No.</label><input type="text" value={dealForm.loan_reference_no} onChange={e => updateDealForm({ loan_reference_no: e.target.value })} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Overall Loan Status</label>
                  <select required value={loanForm.status} onChange={e => updateLoanForm({ status: e.target.value })} className={selectCls}>
                    <option value="">Select Status</option>
                    {LOAN_STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* SECTION 6 — Sanction Details */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="✅" title="6. Sanction Details" subtitle="Confirmed once the bank approves." t={t} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Sanction Amount</label><IndianCurrencyInput value={dealForm.sanction_amount} onChange={val => updateDealForm({ sanction_amount: val })} className={inputCls} placeholder="Amount" /></div>
                <div><label className={labelCls}>Sanction Date</label><input type="date" value={dealForm.sanction_date} onChange={e => updateDealForm({ sanction_date: e.target.value })} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Sanction Status</label>
                  <select value={dealForm.sanction_status} onChange={e => updateDealForm({ sanction_status: e.target.value })} className={selectCls}>
                    {SANCTION_STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* SECTION 7 — Disbursement */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="💸" title="7. Disbursement" subtitle="Once sanction is complete." t={t} />

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
                /* Fully disbursed — collapse to a simple summary, no tranche workflow. */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={labelCls}>Disbursement Amount</label><IndianCurrencyInput value={dealForm.expected_disbursement_amount} onChange={val => updateDealForm({ expected_disbursement_amount: val })} className={inputCls} placeholder="Amount" /></div>
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

            {/* SECTION 8 — Registration & Booking Financials */}
            <div className={`border-t pt-3 ${t.tableBorder}`}>
              <SectionHeader icon="📝" title="8. Registration & Booking Financials" subtitle={!booking ? "Draft — will prefill the Booking Form on Mark as Closing" : "Booking payment lifecycle"} t={t} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={labelCls}>Token Amount</label><IndianCurrencyInput value={dealForm.token_amount} onChange={val => updateDealForm({ token_amount: val })} className={inputCls} placeholder="50,000" /></div>
                <div><label className={labelCls}>OCR Amount</label><IndianCurrencyInput value={dealForm.ocr_amount} onChange={val => updateDealForm({ ocr_amount: val })} className={inputCls} placeholder="5,00,000" /></div>
                <div><label className={labelCls}>OCR Received Date</label><input type="date" value={dealForm.ocr_received_date} onChange={e => updateDealForm({ ocr_received_date: e.target.value })} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>OCR Payment Mode</label>
                  <select value={dealForm.ocr_payment_mode} onChange={e => updateDealForm({ ocr_payment_mode: e.target.value })} className={selectCls}>
                    {OCR_PAYMENT_MODE_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2"><label className={labelCls}>OCR Remarks</label><input type="text" value={dealForm.ocr_remarks} onChange={e => updateDealForm({ ocr_remarks: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>SDR Amount</label><IndianCurrencyInput value={dealForm.sdr_amount} onChange={val => updateDealForm({ sdr_amount: val })} className={inputCls} placeholder="3,50,000" /></div>
                <div><label className={labelCls}>SDR Payment Date</label><input type="date" value={dealForm.sdr_payment_date} onChange={e => updateDealForm({ sdr_payment_date: e.target.value })} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>SDR Status</label>
                  <select value={dealForm.sdr_status} onChange={e => updateDealForm({ sdr_status: e.target.value })} className={selectCls}>
                    {SDR_STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>SDR Remarks</label><input type="text" value={dealForm.sdr_remarks} onChange={e => updateDealForm({ sdr_remarks: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Cash Component</label><IndianCurrencyInput value={dealForm.cash_component} onChange={val => updateDealForm({ cash_component: val })} className={inputCls} placeholder="If applicable" /></div>
                <div><label className={labelCls}>Cash Payment Date</label><input type="date" value={dealForm.cash_component_date} onChange={e => updateDealForm({ cash_component_date: e.target.value })} className={inputCls} /></div>
                <div className="sm:col-span-2"><label className={labelCls}>Cash Remarks</label><input type="text" value={dealForm.cash_component_remarks} onChange={e => updateDealForm({ cash_component_remarks: e.target.value })} className={inputCls} /></div>
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