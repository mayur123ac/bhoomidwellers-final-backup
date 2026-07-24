"use client";
// BookingFormModal.tsx — Multi-step Booking Application Form
import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import IndianCurrencyInput from "@/components/IndianCurrencyInput";
import { cleanCurrencyValue, formatIndianNumber } from "@/lib/currency";
import {
  FaTimes, FaChevronRight, FaChevronLeft, FaUser, FaHome, FaBuilding,
  FaMoneyBillWave, FaHandshake, FaFileAlt, FaCheck, FaPlus, FaTrash,
  FaPen, FaUpload, FaCheckCircle, FaPrint, FaDownload,
} from "react-icons/fa";
import { formatCurrencyDisplay, toStorageValue } from "@/lib/currency";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PaymentRow { date: string; transaction_type: string; amount: string; }

export interface JointApplicant {
  name: string;
  email: string;
  mobile: string;
  pan: string;
  aadhaar: string;
  occupation: string;
  nationality: string;
  pan_file: File | null;
  aadhaar_front_file: File | null;
  aadhaar_back_file: File | null;
}

interface BookingFormData {
  // Step 1 — Applicant
  primary_name: string; primary_email: string; primary_mobile: string;
  primary_pan: string; primary_aadhaar: string; primary_occupation: string; primary_nationality: string;
  primary_pan_file: File | null;
  primary_aadhaar_front_file: File | null;
  primary_aadhaar_back_file: File | null;

  joint_applicants: JointApplicant[];

  address: string; pin: string; state: string; country: string;
  // Step 2 — Unit
  apartment_name: string; project_name: string; tower: string; wing: string;
  property_type: string; floor_number: string; flat_number: string;
  carpet_area: string; consideration_value: string; consideration_value_words: string;
  parking_details: string; payment_details: PaymentRow[];
  witness_name: string; witness_aadhaar: string;
  // Step 3 — Source
  booking_source: "Direct" | "Channel Partner";
  direct_source: string; channel_partner_name: string; channel_partner_contact: string;
  // Booking Info
  booking_date: string; agreement_value: string; booking_amount: string; booking_remarks: string;
  // Financial Details
  token_amount: string; ocr_amount: string; ocr_received_date: string; ocr_payment_mode: string; ocr_remarks: string;
  sdr_amount: string; sdr_payment_date: string; sdr_status: string; sdr_remarks: string;
  cash_component: string; cash_component_date: string; cash_component_remarks: string;
  // Registration Details
  expected_registration_date: string; actual_registration_date: string;
  registration_status: string; registration_number: string; registration_remarks: string;
  // Loan Details
  loan_required: boolean; bank_name: string; loan_executive: string; loan_type: string; loan_reference_no: string; loan_amount: string;
  sanction_amount: string; sanction_date: string; sanction_status: string; loan_status: string;
  expected_disbursement_date: string; actual_disbursement_date: string;
  expected_disbursement_amount: string; disbursement_amount: string; disbursement_status: string;
  // Custom Charges
  custom_charges: { charge_name: string; amount: string; remarks: string; }[];
  internal_notes: string;
  // Revenue recognition — which financial items management chooses to count as
  // realized revenue. Off by default: revenue is an explicit opt-in, never auto.
  revenue_include_ocr: boolean;
  revenue_include_sdr: boolean;
  revenue_include_cash: boolean;
  revenue_include_sanction: boolean;
  revenue_include_disbursement: boolean;

  // Cost breakdown — GST is auto-computed from agreement_value × rate.
  gst_rate: string; gst_amount: string; gst_paid: string; gst_status: string;
  // Stamp Duty & Registration Fee (split) — amounts auto-computed (Maharashtra
  // defaults), the rest are captured manually as they are paid.
  stamp_duty_amount: string; stamp_duty_paid_date: string; stamp_duty_status: string;
  stamp_duty_payment_mode: string; stamp_duty_receipt_no: string;
  registration_fee_amount: string; registration_fee_paid_date: string;
  registration_fee_status: string; registration_fee_payment_mode: string;
  // Other charges (manual)
  legal_charges: string; maintenance_deposit: string; possession_charges: string;
  // Possession tracking
  expected_possession_date: string; actual_possession_date: string;
  possession_status: string; oc_cc_status: string; oc_cc_date: string;
  // Loan EMI details (pre_emi_amount / emi_amount are auto-computed)
  interest_rate: string; loan_tenure_months: string; emi_start_date: string;
  payment_type: string; pre_emi_amount: string; emi_amount: string;

  // Step 4 — Declaration
  declaration_accepted: boolean; terms_accepted: boolean; consent_accepted: boolean;
  signature_data: string; application_date: string;
}

interface BookingFormModalProps {
  existingBooking?: any;
  isEditMode?: boolean;
  isOpen: boolean;
  onClose: () => void;
  lead: any;
  user: any;
  isDark?: boolean;
  onSuccess: (booking: any) => void;
}

// ─── Number to Words ──────────────────────────────────────────────────────────
function numberToWords(num: string): string {
  const n = parseFloat(num.replace(/,/g, ""));
  if (isNaN(n) || n <= 0) return "";
  const units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function toWords(n: number): string {
    if (n === 0) return "";
    if (n < 20) return units[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + " " + toWords(n % 10);
    if (n < 1000) return units[Math.floor(n / 100)] + " Hundred " + toWords(n % 100);
    if (n < 100000) return toWords(Math.floor(n / 1000)) + "Thousand " + toWords(n % 1000);
    if (n < 10000000) return toWords(Math.floor(n / 100000)) + "Lakh " + toWords(n % 100000);
    return toWords(Math.floor(n / 10000000)) + "Crore " + toWords(n % 10000000);
  }
  return "Rupees " + toWords(Math.floor(n)).trim() + " Only";
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Applicant", icon: <FaUser /> },
  { id: 2, label: "Unit Details", icon: <FaBuilding /> },
  { id: 3, label: "Financials & Registration", icon: <FaMoneyBillWave /> },
  { id: 4, label: "Source & Notes", icon: <FaHandshake /> },
  { id: 5, label: "Declaration", icon: <FaFileAlt /> },
  { id: 6, label: "Review", icon: <FaCheckCircle /> },
];

const TERMS = [
  "All Cheques to be made in Favor of PARWATI CONSTRUCTION COLOSSAL MAS COLL ESCROW ACCT.",
  "Purchaser / Customer must provide all the required documents, processing fees and self-availability for home loan process failing to do so may/will result in interest/ Penalty/ Admin charges.",
  "Booking Amount is non-returnable after 7 days of confirmation.",
  "Agreement to be made within 15 days of booking.",
  "No civil work or other changes shall be carried in except as per sanctioned plan.",
  "Late payment interest plus additional handling charges applicable in case of late payment.",
  "If any tax imposed by Government at any time the same will be borne by the purchaser. (e.g., GST, Stamp duty)",
];


function toNumber(val: string): number {
  const n = parseFloat(toStorageValue(val));
  return isNaN(n) ? 0 : n;
}

function formatINR(n: number): string {
  return formatCurrencyDisplay(String(n));
}




function parseIndianAmount(val: string): string {
  if (!val) return "";
  let clean = val.toLowerCase().replace(/[₹\s,]/g, "");
  if (clean.includes("lakh")) {
    const num = parseFloat(clean.replace(/lakhs?/, ""));
    return !isNaN(num) ? (num * 100000).toString() : "";
  }
  if (clean.includes("cr")) {
    const num = parseFloat(clean.replace(/crores?|crs?/, ""));
    return !isNaN(num) ? (num * 10000000).toString() : "";
  }
  return clean.replace(/[^0-9]/g, "");
}

// ─── Revenue recognition ────────────────────────────────────────────────────
// A single, modular source of truth for the Financial Summary. New financial
// transaction types can be added by pushing another entry into `items`.
//
// Rules (matches real-estate accounting):
//   • Revenue counts an item only if it is BOTH actually received/completed AND
//     explicitly marked "Include in Revenue". Nothing is auto-counted.
//   • "Received" is auto-derived from the item's own date/status fields.
//   • Loan Sanction is informational (bank approval, not cash) — it never sits
//     in Scheduled Receivables and only reaches Revenue if management opts in.
//   • Scheduled Receivables = money entered but not yet received (future income).
//     It is shown separately and never reduces Balance Receivable.
type RevenueItemKey = "ocr" | "sdr" | "cash" | "sanction" | "disbursement";
type RevenueFlagKey =
  | "revenue_include_ocr" | "revenue_include_sdr" | "revenue_include_cash"
  | "revenue_include_sanction" | "revenue_include_disbursement";

interface RevenueItem {
  key: RevenueItemKey;
  label: string;
  amount: number;
  received: boolean;          // has the money actually arrived / milestone completed
  receivedLabel: string;      // wording for the status chip ("Received" / "Approved" …)
  informational: boolean;     // true = not a cash receipt (Loan Sanction)
  includeKey: RevenueFlagKey;
  included: boolean;
  countsAsRevenue: boolean;   // received && included
}

interface FinancialSummary {
  agreementValue: number;
  items: RevenueItem[];
  revenue: number;
  scheduledReceivables: number;
  balanceReceivable: number;
}

function computeFinancials(form: BookingFormData): FinancialSummary {
  const agreementValue = toNumber(form.agreement_value);

  const disbursementAmount = toNumber(form.disbursement_amount) || toNumber(form.expected_disbursement_amount);

  const base: Omit<RevenueItem, "countsAsRevenue">[] = [
    {
      key: "ocr", label: "OCR", amount: toNumber(form.ocr_amount),
      received: !!form.ocr_received_date, receivedLabel: "Received", informational: false,
      includeKey: "revenue_include_ocr", included: !!form.revenue_include_ocr,
    },
    {
      key: "sdr", label: "SDR", amount: toNumber(form.sdr_amount),
      received: form.sdr_status === "Paid", receivedLabel: "Paid", informational: false,
      includeKey: "revenue_include_sdr", included: !!form.revenue_include_sdr,
    },
    {
      key: "cash", label: "Cash Component", amount: toNumber(form.cash_component),
      received: !!form.cash_component_date, receivedLabel: "Received", informational: false,
      includeKey: "revenue_include_cash", included: !!form.revenue_include_cash,
    },
    {
      key: "sanction", label: "Loan Sanction", amount: toNumber(form.sanction_amount),
      received: form.sanction_status === "Approved", receivedLabel: "Approved", informational: true,
      includeKey: "revenue_include_sanction", included: !!form.revenue_include_sanction,
    },
    {
      key: "disbursement", label: "Loan Disbursement", amount: disbursementAmount,
      received: !!form.actual_disbursement_date || form.disbursement_status === "Completed",
      receivedLabel: "Received", informational: false,
      includeKey: "revenue_include_disbursement", included: !!form.revenue_include_disbursement,
    },
  ];

  const items: RevenueItem[] = base.map(it => ({ ...it, countsAsRevenue: it.received && it.included }));

  const revenue = items.filter(i => i.countsAsRevenue).reduce((s, i) => s + i.amount, 0);

  // Future income: entered but not yet received. Sanction excluded (informational).
  const scheduledReceivables = items
    .filter(i => !i.informational && !i.received && i.amount > 0)
    .reduce((s, i) => s + i.amount, 0);

  const balanceReceivable = agreementValue - revenue;

  return { agreementValue, items, revenue, scheduledReceivables, balanceReceivable };
}

// ─── Cost breakdown ─────────────────────────────────────────────────────────
// Total Cost to Customer = Agreement + GST + Stamp Duty + Registration Fee
// + Legal + Maintenance + Possession + Custom Charges. Auto amounts follow
// Maharashtra defaults (GST 5%, Stamp Duty 5%, Registration 1% capped ₹30K).
interface CostBreakdown {
  agreementValue: number; gstRate: number; gstAmount: number;
  stampDuty: number; registrationFee: number;
  legalCharges: number; maintenanceDeposit: number; possessionCharges: number;
  customChargesTotal: number; totalCost: number;
  loanAmount: number; ownContributionRequired: number;
}

function autoGstAmount(agreementValue: number, rate: number) { return Math.round(agreementValue * rate / 100); }
function autoStampDuty(agreementValue: number) { return Math.round(agreementValue * 0.05); }
function autoRegistrationFee(agreementValue: number) { return Math.min(Math.round(agreementValue * 0.01), 30000); }

function computeCostBreakdown(form: BookingFormData): CostBreakdown {
  const agreementValue = toNumber(form.agreement_value);
  const gstRate = toNumber(form.gst_rate) || 5;
  const gstAmount = toNumber(form.gst_amount) || autoGstAmount(agreementValue, gstRate);
  const stampDuty = toNumber(form.stamp_duty_amount) || autoStampDuty(agreementValue);
  const registrationFee = toNumber(form.registration_fee_amount) || autoRegistrationFee(agreementValue);
  const legalCharges = toNumber(form.legal_charges);
  const maintenanceDeposit = toNumber(form.maintenance_deposit);
  const possessionCharges = toNumber(form.possession_charges);
  const customChargesTotal = (form.custom_charges || []).reduce((s, c) => s + toNumber(c.amount), 0);
  const totalCost = agreementValue + gstAmount + stampDuty + registrationFee
    + legalCharges + maintenanceDeposit + possessionCharges + customChargesTotal;
  const loanAmount = form.loan_required ? (toNumber(form.sanction_amount) || toNumber(form.loan_amount)) : 0;
  // Own contribution the buyer must fund from pocket. Government pass-through
  // (stamp duty / registration) is the buyer's cost too but is excluded here so
  // this figure mirrors the API's required_own_contribution (Agreement + GST − Loan).
  const ownContributionRequired = Math.max(agreementValue + gstAmount - loanAmount, 0);
  return {
    agreementValue, gstRate, gstAmount, stampDuty, registrationFee,
    legalCharges, maintenanceDeposit, possessionCharges, customChargesTotal,
    totalCost, loanAmount, ownContributionRequired,
  };
}

// Standard amortization: EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = monthly rate.
function computeEmi(principal: number, annualRatePct: number, tenureMonths: number): number {
  if (principal <= 0 || annualRatePct <= 0 || tenureMonths <= 0) return 0;
  const r = annualRatePct / 12 / 100;
  const pow = Math.pow(1 + r, tenureMonths);
  return Math.round((principal * r * pow) / (pow - 1));
}

// Pre-EMI is interest-only on the amount disbursed so far (falls back to sanctioned).
function computePreEmi(disbursed: number, sanctioned: number, annualRatePct: number): number {
  const base = disbursed > 0 ? disbursed : sanctioned;
  if (base <= 0 || annualRatePct <= 0) return 0;
  return Math.round(base * annualRatePct / 12 / 100);
}

// Loan & Deal Tracking (LoanDealForm) drafts sections 6-7 onto the lead itself
// (walkin_enquiries.loan_tracking_info) before a booking exists. When "Mark as
// Closing" opens this modal fresh, that draft prefills the loan/financial fields.
function parseLoanTrackingDraft(lead: any): Record<string, any> {
  try {
    const raw = lead?.loan_tracking_info;
    return typeof raw === "string" ? JSON.parse(raw) : (raw || {});
  } catch {
    return {};
  }
}

function defaultForm(lead: any): BookingFormData {
  const today = new Date().toISOString().split("T")[0];
  const draft = parseLoanTrackingDraft(lead);
  return {
    primary_name: lead?.name || "", primary_email: lead?.email !== "N/A" ? (lead?.email || "") : "",
    primary_mobile: lead?.phone || "", primary_pan: "", primary_aadhaar: "", primary_occupation: lead?.occupation !== "N/A" ? (lead?.occupation || "") : "",
    primary_nationality: "Indian",
    primary_pan_file: null, primary_aadhaar_front_file: null, primary_aadhaar_back_file: null,
    joint_applicants: [],
    address: lead?.address !== "N/A" ? (lead?.address || "") : "", pin: "", state: "", country: "India",
    apartment_name: "", project_name: "", tower: "", wing: "",
    property_type: lead?.propType && lead?.propType !== "Pending" ? lead.propType : (lead?.configuration !== "N/A" ? (lead?.configuration || "") : ""),
    floor_number: "", flat_number: "", carpet_area: "",
    consideration_value: parseIndianAmount(lead?.salesBudget && lead?.salesBudget !== "Pending" ? lead.salesBudget : (lead?.budget || "")),
    consideration_value_words: "", parking_details: "",
    payment_details: [{ date: today, transaction_type: "Cheque", amount: "" }],
    witness_name: "", witness_aadhaar: "",
    booking_source: lead?.source === "Channel Partner" ? "Channel Partner" : "Direct",
    direct_source: lead?.source !== "Channel Partner"
      ? (lead?.source === "Referral" && (lead?.referral_name || lead?.referralName) ? `Referral (${lead?.referral_name || lead?.referralName})` : (lead?.source || ""))
      : "",
    channel_partner_name: lead?.cpName || lead?.cp_name || "",
    channel_partner_contact: lead?.cpPhone || lead?.cp_phone || "",

    booking_date: today, agreement_value: "", booking_amount: "", booking_remarks: "",
    token_amount: draft.token_amount || "", ocr_amount: draft.ocr_amount || "", ocr_received_date: draft.ocr_received_date || "", ocr_payment_mode: draft.ocr_payment_mode || "Cheque", ocr_remarks: draft.ocr_remarks || "",
    sdr_amount: draft.sdr_amount || "", sdr_payment_date: draft.sdr_payment_date || "", sdr_status: draft.sdr_status || "Pending", sdr_remarks: draft.sdr_remarks || "",
    cash_component: draft.cash_component || "", cash_component_date: draft.cash_component_date || "", cash_component_remarks: draft.cash_component_remarks || "",
    expected_registration_date: "", actual_registration_date: "",
    registration_status: "Pending", registration_number: "", registration_remarks: "",
    loan_required: draft.loan_required ?? false, bank_name: draft.bank_name || "", loan_executive: draft.loan_executive || "", loan_type: draft.loan_type || "", loan_reference_no: draft.loan_reference_no || "", loan_amount: draft.loan_amount || "",
    sanction_amount: draft.sanction_amount || "", sanction_date: draft.sanction_date || "", sanction_status: draft.sanction_status || "Pending", loan_status: draft.loan_status || "Pending",
    expected_disbursement_date: draft.expected_disbursement_date || "", actual_disbursement_date: draft.actual_disbursement_date || "",
    expected_disbursement_amount: draft.expected_disbursement_amount || "", disbursement_amount: draft.disbursement_amount || "", disbursement_status: draft.disbursement_status || "Pending",
    custom_charges: Array.isArray(draft.custom_charges) ? draft.custom_charges : [],
    internal_notes: "",
    revenue_include_ocr: false,
    revenue_include_sdr: false,
    revenue_include_cash: false,
    revenue_include_sanction: false,
    revenue_include_disbursement: false,

    // Phase B: draft (loan_tracking_info) is a superset of Step 3 — prefill directly, no translation.
    gst_rate: draft.gst_rate || "5", gst_amount: "", gst_paid: "", gst_status: "Pending",
    stamp_duty_amount: draft.stamp_duty_amount || "", stamp_duty_paid_date: "", stamp_duty_status: draft.stamp_duty_status || "Pending",
    stamp_duty_payment_mode: "E-Stamp", stamp_duty_receipt_no: "",
    registration_fee_amount: draft.registration_fee_amount || "", registration_fee_paid_date: "",
    registration_fee_status: draft.registration_fee_status || "Pending", registration_fee_payment_mode: "",
    legal_charges: draft.legal_charges || "", maintenance_deposit: draft.maintenance_deposit || "", possession_charges: "",
    expected_possession_date: "", actual_possession_date: "",
    possession_status: "Pre-Construction", oc_cc_status: "Pending", oc_cc_date: "",
    interest_rate: draft.interest_rate || "", loan_tenure_months: draft.loan_tenure_months || "",
    emi_start_date: draft.emi_start_date || "", payment_type: draft.payment_type || "Pre-EMI",
    pre_emi_amount: "", emi_amount: "",

    declaration_accepted: false, terms_accepted: false, consent_accepted: false,
    signature_data: "", application_date: today,
  };
}

// ─── Date Normalizer ─────────────────────────────────────────────────────────
// PostgreSQL DATE/TIMESTAMP columns are serialised by the node-postgres driver
// as full ISO-8601 strings (e.g. "2026-07-24T00:00:00.000Z") or as JS Date
// objects. HTML <input type="date"> requires exactly "YYYY-MM-DD". Any other
// format makes the input render as blank — which is the root cause of the
// date-persistence bug. This helper normalises every possible shape into the
// one format that the browser accepts.
function toDateStr(val: any): string {
  if (!val) return "";
  // Already a JS Date object
  if (val instanceof Date) return val.toISOString().split("T")[0];
  const s = String(val);
  // ISO timestamp: "2026-07-24T00:00:00.000Z" or "2026-07-24 00:00:00"
  if (s.includes("T") || (s.length > 10 && s.includes(" "))) return s.split("T")[0].split(" ")[0];
  // Already YYYY-MM-DD (10 chars)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return "";
}

// All date keys that exist in BookingFormData. Every value from existingBooking
// for these keys must be passed through toDateStr() before entering form state.
const DATE_FIELDS: (keyof BookingFormData)[] = [
  "booking_date", "application_date",
  "ocr_received_date",
  "sdr_payment_date",
  "cash_component_date",
  "sanction_date",
  "expected_disbursement_date", "actual_disbursement_date",
  "expected_registration_date", "actual_registration_date",
  "stamp_duty_paid_date",
  "registration_fee_paid_date",
  "expected_possession_date", "actual_possession_date",
  "oc_cc_date",
  "emi_start_date",
];

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function BookingFormModal({ isOpen, onClose, lead, user, isDark = false, onSuccess, existingBooking, isEditMode }: BookingFormModalProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BookingFormData>(() => defaultForm(lead));
  const [errors, setErrors] = useState<Partial<Record<keyof BookingFormData, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // ── Confirmation screen state (fully isolated from form/submit lifecycle) ──
  const [confirmedBooking, setConfirmedBooking] = useState<any | null>(null);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [termsScrolled, setTermsScrolled] = useState(false);
  const [showAdditionalPayment, setShowAdditionalPayment] = useState(false);
  const [sigMode, setSigMode] = useState<"draw" | "upload">("draw");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const termsRef = useRef<HTMLDivElement>(null);

  // Load draft from sessionStorage
  useEffect(() => {
    if (!isOpen || !lead?.id) return;
    const key = `booking_draft_${lead.id}`;
    const stored = sessionStorage.getItem(key);
    if (isEditMode && existingBooking) {
      // Map existing DB fields to form state
      const initialForm = defaultForm(lead);
      const safeBooking: any = {};
      // Remove null values so they don't override initialForm defaults
      Object.keys(existingBooking).forEach(k => {
        if (existingBooking[k] !== null && existingBooking[k] !== undefined) {
          safeBooking[k] = existingBooking[k];
        }
      });
      // ── Date normalisation ────────────────────────────────────────────────
      // PostgreSQL returns DATE columns as ISO timestamps ("2026-07-24T00:00:00.000Z")
      // which HTML <input type="date"> cannot display — it requires "YYYY-MM-DD".
      // We normalise every date field here so the form always receives the
      // correct format regardless of which API endpoint fed existingBooking.
      DATE_FIELDS.forEach(key => {
        const raw = safeBooking[key] ?? existingBooking[key];
        if (raw !== null && raw !== undefined) {
          safeBooking[key] = toDateStr(raw);
        }
      });
      setForm({
        ...initialForm,
        ...safeBooking,
        joint_applicants: typeof safeBooking.joint_applicants === 'string' ? JSON.parse(safeBooking.joint_applicants) : (safeBooking.joint_applicants || initialForm.joint_applicants),
        payment_details: typeof safeBooking.payment_details === 'string' ? JSON.parse(safeBooking.payment_details) : (safeBooking.payment_details || initialForm.payment_details)
      });
    } else if (stored) {
      try { setForm(JSON.parse(stored)); } catch { setForm(defaultForm(lead)); }
    } else {
      setForm(defaultForm(lead));
    }
    setStep(1); setErrors({}); setTermsScrolled(false);
  }, [isOpen, lead?.id]);

  // Save draft on form change
  useEffect(() => {
    if (!isOpen || !lead?.id) return;
    sessionStorage.setItem(`booking_draft_${lead.id}`, JSON.stringify(form));
  }, [form, isOpen, lead?.id]);

  // Auto-fill value in words
  useEffect(() => {
    if (form.consideration_value) {
      const words = numberToWords(form.consideration_value.replace(/[₹,]/g, ""));
      if (words) setForm(f => ({ ...f, consideration_value_words: words }));
    }
  }, [form.consideration_value]);

  // Auto-compute GST / Stamp Duty / Registration Fee from agreement value.
  // These are "Est." fields — always kept in sync so they never drift.
  useEffect(() => {
    const av = toNumber(form.agreement_value);
    const rate = toNumber(form.gst_rate) || 5;
    const gst = String(autoGstAmount(av, rate));
    const stamp = String(autoStampDuty(av));
    const reg = String(autoRegistrationFee(av));
    setForm(f => (
      f.gst_amount === gst && f.stamp_duty_amount === stamp && f.registration_fee_amount === reg
        ? f
        : { ...f, gst_amount: gst, stamp_duty_amount: stamp, registration_fee_amount: reg }
    ));
  }, [form.agreement_value, form.gst_rate]);

  // Auto-compute Pre-EMI / EMI from loan figures.
  useEffect(() => {
    if (!form.loan_required) return;
    const sanctioned = toNumber(form.sanction_amount) || toNumber(form.loan_amount);
    const disbursed = toNumber(form.disbursement_amount);
    const rate = toNumber(form.interest_rate);
    const tenure = toNumber(form.loan_tenure_months);
    const preEmi = String(computePreEmi(disbursed, sanctioned, rate));
    const emi = String(computeEmi(sanctioned, rate, tenure));
    setForm(f => (
      f.pre_emi_amount === preEmi && f.emi_amount === emi ? f : { ...f, pre_emi_amount: preEmi, emi_amount: emi }
    ));
  }, [form.loan_required, form.sanction_amount, form.loan_amount, form.disbursement_amount, form.interest_rate, form.loan_tenure_months]);

  const set = useCallback(<K extends keyof BookingFormData>(key: K, val: BookingFormData[K]) => {
    setForm(f => ({ ...f, [key]: val }));
    setErrors(e => { const ne = { ...e }; delete ne[key]; return ne; });
  }, []);

  // ── Canvas signature ──
  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath(); ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2; ctx.strokeStyle = "#000000"; // Always black for PDF visibility
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top); ctx.stroke();
  };
  const endDraw = () => {
    isDrawing.current = false;
    const canvas = canvasRef.current; if (!canvas) return;

    // Create a temporary canvas with white background for export
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext("2d");
    if (tCtx) {
      tCtx.fillStyle = "white";
      tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      tCtx.drawImage(canvas, 0, 0);
      set("signature_data", tempCanvas.toDataURL("image/png"));
    }
  };
  const clearSig = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    set("signature_data", "");
  };

  // ── Payment rows ──
  const addPayment = () => set("payment_details", [...form.payment_details, { date: new Date().toISOString().split("T")[0], transaction_type: "Cheque", amount: "" }]);
  const removePayment = (i: number) => set("payment_details", form.payment_details.filter((_, idx) => idx !== i));
  const updatePayment = (i: number, field: keyof PaymentRow, val: string) => {
    const rows = [...form.payment_details];
    rows[i] = { ...rows[i], [field]: val };
    set("payment_details", rows);
  };

  // ── Validation ──
  const validate = (s: number): boolean => {
    const e: Partial<Record<keyof BookingFormData, string>> = {};
    if (s === 1) {
      if (!form.primary_name.trim()) e.primary_name = "Name is required";
      if (!form.primary_mobile.trim()) e.primary_mobile = "Mobile is required";
      if (form.primary_aadhaar && !/^\d{12}$/.test(form.primary_aadhaar)) e.primary_aadhaar = "Aadhaar must be exactly 12 digits";
      if (form.primary_pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.primary_pan.toUpperCase())) e.primary_pan = "Invalid PAN format (e.g. ABCDE1234F)";

      // Validate joint applicants
      form.joint_applicants.forEach((ja, idx) => {
        if (ja.aadhaar && !/^\d{12}$/.test(ja.aadhaar)) (e as any)[`joint_aadhaar_${idx}`] = `Invalid Aadhaar`;
        if (ja.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(ja.pan.toUpperCase())) (e as any)[`joint_pan_${idx}`] = `Invalid PAN format`;
      });
    }
    if (s === 2) {
      if (!form.property_type.trim()) e.property_type = "Property type is required";
      if (!form.flat_number.trim()) e.flat_number = "Flat number is required";
      if (!form.consideration_value.trim()) e.consideration_value = "Consideration value is required";
    }
    if (s === 3) {
      if (!form.booking_date) e.booking_date = "Booking date is required";
      if (!form.agreement_value) e.agreement_value = "Agreement value is required";
      if (!form.booking_amount) e.booking_amount = "Booking amount is required";
    }
    if (s === 5) {
      if (!form.declaration_accepted) e.declaration_accepted = "Required";
      if (!form.terms_accepted) e.terms_accepted = "Required";
      if (!form.consent_accepted) e.consent_accepted = "Required";
      if (!form.signature_data) e.signature_data = "Signature is required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const nextStep = () => { if (validate(step)) setStep(s => Math.min(s + 1, 6)); };
  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  // ── Submit — saves booking only, NO PDF generation ──
  const handleSubmit = async () => {
    if (!validate(5)) { setStep(5); return; }
    setIsSubmitting(true);
    try {
      const formData = new FormData();

      formData.append("lead_id", lead.id.toString());
      formData.append("primary_name", form.primary_name);
      formData.append("primary_email", form.primary_email);
      formData.append("primary_mobile", form.primary_mobile);
      formData.append("primary_pan", form.primary_pan?.toUpperCase());
      formData.append("primary_aadhaar", form.primary_aadhaar);
      formData.append("primary_occupation", form.primary_occupation);
      formData.append("primary_nationality", form.primary_nationality);
      formData.append("address", form.address);
      formData.append("pin", form.pin);
      formData.append("state", form.state);
      formData.append("country", form.country);
      formData.append("apartment_name", form.apartment_name);
      formData.append("project_name", form.project_name);
      formData.append("tower", form.tower);
      formData.append("wing", form.wing);
      formData.append("property_type", form.property_type);
      formData.append("floor_number", form.floor_number);
      formData.append("flat_number", form.flat_number);
      formData.append("carpet_area", form.carpet_area);
      formData.append("consideration_value", form.consideration_value);
      formData.append("consideration_value_words", form.consideration_value_words);
      formData.append("parking_details", form.parking_details);
      formData.append("witness_name", form.witness_name);
      formData.append("witness_aadhaar", form.witness_aadhaar);
      formData.append("booking_source", form.booking_source);
      formData.append("direct_source", form.direct_source);
      formData.append("channel_partner_name", form.channel_partner_name);
      formData.append("channel_partner_contact", form.channel_partner_contact);
      formData.append("unit_cost", (form as any).unit_cost || "");
      formData.append("sdr", (form as any).sdr || "");
      formData.append("gst", (form as any).gst || "");

      // New fields
      formData.append("booking_date", form.booking_date);
      formData.append("agreement_value", form.agreement_value);
      formData.append("booking_amount", form.booking_amount);
      formData.append("booking_remarks", form.booking_remarks);
      formData.append("token_amount", form.token_amount);
      formData.append("ocr_amount", form.ocr_amount);
      formData.append("ocr_received_date", form.ocr_received_date);
      formData.append("ocr_payment_mode", form.ocr_payment_mode);
      formData.append("ocr_remarks", form.ocr_remarks);
      formData.append("sdr_amount", form.sdr_amount);
      formData.append("sdr_payment_date", form.sdr_payment_date);
      formData.append("sdr_status", form.sdr_status);
      formData.append("sdr_remarks", form.sdr_remarks);
      formData.append("cash_component", form.cash_component);
      formData.append("cash_component_date", form.cash_component_date);
      formData.append("cash_component_remarks", form.cash_component_remarks);
      formData.append("expected_registration_date", form.expected_registration_date);
      formData.append("actual_registration_date", form.actual_registration_date);
      formData.append("registration_status", form.registration_status);
      formData.append("registration_number", form.registration_number);
      formData.append("registration_remarks", form.registration_remarks);
      formData.append("loan_required", form.loan_required ? 'true' : 'false');
      formData.append("bank_name", form.bank_name);
      formData.append("loan_executive", form.loan_executive);
      formData.append("loan_type", form.loan_type);
      formData.append("loan_reference_no", form.loan_reference_no);
      formData.append("loan_amount", form.loan_amount);
      formData.append("sanction_amount", form.sanction_amount);
      formData.append("sanction_date", form.sanction_date);
      formData.append("sanction_status", form.sanction_status);
      formData.append("loan_status", form.loan_status);
      formData.append("expected_disbursement_date", form.expected_disbursement_date);
      formData.append("actual_disbursement_date", form.actual_disbursement_date);
      formData.append("expected_disbursement_amount", form.expected_disbursement_amount);
      formData.append("disbursement_amount", form.disbursement_amount);
      formData.append("disbursement_status", form.disbursement_status);
      formData.append("custom_charges", JSON.stringify(form.custom_charges));
      formData.append("internal_notes", form.internal_notes);
      // Revenue recognition flags
      formData.append("revenue_include_ocr", form.revenue_include_ocr ? 'true' : 'false');
      formData.append("revenue_include_sdr", form.revenue_include_sdr ? 'true' : 'false');
      formData.append("revenue_include_cash", form.revenue_include_cash ? 'true' : 'false');
      formData.append("revenue_include_sanction", form.revenue_include_sanction ? 'true' : 'false');
      formData.append("revenue_include_disbursement", form.revenue_include_disbursement ? 'true' : 'false');

      // Cost breakdown — GST rate is user-set; amount is derived (server also recomputes).
      formData.append("gst_rate", form.gst_rate);
      formData.append("gst_amount", form.gst_amount);
      formData.append("gst_paid", form.gst_paid);
      formData.append("gst_status", form.gst_status);
      // Stamp Duty & Registration Fee (split)
      formData.append("stamp_duty_amount", form.stamp_duty_amount);
      formData.append("stamp_duty_paid_date", form.stamp_duty_paid_date);
      formData.append("stamp_duty_status", form.stamp_duty_status);
      formData.append("stamp_duty_payment_mode", form.stamp_duty_payment_mode);
      formData.append("stamp_duty_receipt_no", form.stamp_duty_receipt_no);
      formData.append("registration_fee_amount", form.registration_fee_amount);
      formData.append("registration_fee_paid_date", form.registration_fee_paid_date);
      formData.append("registration_fee_status", form.registration_fee_status);
      formData.append("registration_fee_payment_mode", form.registration_fee_payment_mode);
      // Other charges
      formData.append("legal_charges", form.legal_charges);
      formData.append("maintenance_deposit", form.maintenance_deposit);
      formData.append("possession_charges", form.possession_charges);
      // Possession tracking
      formData.append("expected_possession_date", form.expected_possession_date);
      formData.append("actual_possession_date", form.actual_possession_date);
      formData.append("possession_status", form.possession_status);
      formData.append("oc_cc_status", form.oc_cc_status);
      formData.append("oc_cc_date", form.oc_cc_date);
      // EMI details
      formData.append("interest_rate", form.interest_rate);
      formData.append("loan_tenure_months", form.loan_tenure_months);
      formData.append("emi_start_date", form.emi_start_date);
      formData.append("payment_type", form.payment_type);
      formData.append("pre_emi_amount", form.pre_emi_amount);
      formData.append("emi_amount", form.emi_amount);

      formData.append("declaration_accepted", form.declaration_accepted ? 'true' : 'false');
      formData.append("terms_accepted", form.terms_accepted ? 'true' : 'false');
      formData.append("consent_accepted", form.consent_accepted ? 'true' : 'false');
      formData.append("signature_data", form.signature_data);
      formData.append("application_date", form.application_date);
      formData.append("created_by", user.name);
      formData.append("created_role", user.role);
      formData.append("user_name", user.name);
      formData.append("user_role", user.role);
      formData.append("payment_details", JSON.stringify(form.payment_details));
      formData.append("joint_applicants", JSON.stringify(form.joint_applicants.map(ja => ({
        name: ja.name, email: ja.email, mobile: ja.mobile,
        pan: ja.pan?.toUpperCase(), aadhaar: ja.aadhaar, occupation: ja.occupation, nationality: ja.nationality
      }))));

      if (form.primary_pan_file) formData.append("primary_pan_file", form.primary_pan_file);
      if (form.primary_aadhaar_front_file) formData.append("primary_aadhaar_front_file", form.primary_aadhaar_front_file);
      if (form.primary_aadhaar_back_file) formData.append("primary_aadhaar_back_file", form.primary_aadhaar_back_file);
      form.joint_applicants.forEach((ja, i) => {
        if (ja.pan_file) formData.append(`joint_${i}_pan_file`, ja.pan_file);
        if (ja.aadhaar_front_file) formData.append(`joint_${i}_aadhaar_front_file`, ja.aadhaar_front_file);
        if (ja.aadhaar_back_file) formData.append(`joint_${i}_aadhaar_back_file`, ja.aadhaar_back_file);
      });

      const res = await fetch(isEditMode ? `/api/booking-applications/${existingBooking.id}` : "/api/booking-applications", {
        method: isEditMode ? "PUT" : "POST",
        body: formData
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to save booking");
      const booking = json.data;

      // Clear draft immediately
      if (lead?.id) sessionStorage.removeItem(`booking_draft_${lead.id}`);

      // Fire-and-forget side effects — must NOT block confirmation screen
      fetch(`/api/walkin_enquiries/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: lead.name, status: "Closing" }),
      }).catch(() => { });

      fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(lead.id),
          salesManagerName: user.name,
          createdBy: user.role,
          message: `📋 Booking Application Submitted by ${user.name} (${user.role})\n• Booking No: ${booking.booking_number}\n• Flat: ${form.flat_number}, Floor: ${form.floor_number}\n• Amount: ${form.consideration_value}\n• Date: ${form.application_date}`,
          siteVisitDate: null,
          createdAt: new Date().toISOString(),
        }),
      }).catch(() => { });

      // Show confirmation screen — modal stays open, step irrelevant
      setConfirmedBooking(booking);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Download PDF — fully isolated; a Puppeteer failure cannot affect modal ──
  const downloadPdf = async () => {
    if (!confirmedBooking) return;
    setIsPdfGenerating(true);
    setPdfError(null);
    try {
      const res = await fetch("/api/generate-booking-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking: confirmedBooking, lead }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "PDF generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${confirmedBooking.booking_number || "Booking_Form"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Non-blocking error: keep confirmation screen open, booking unchanged
      setPdfError("Booking saved successfully. PDF generation failed. Please try downloading again later.");
    } finally {
      setIsPdfGenerating(false);
    }
  };

  // ── Close modal — notifies parent exactly once, resets state after animation ──
  const handleClose = useCallback(() => {
    if (confirmedBooking) {
      onSuccess(confirmedBooking);
    }
    onClose();
    setTimeout(() => {
      setConfirmedBooking(null);
      setPdfError(null);
      setStep(1);
    }, 300);
  }, [confirmedBooking, onSuccess, onClose]);



  // ── Theme helpers ──
  const bg = isDark ? "bg-[#0A0A0F]" : "bg-white";
  const cardBg = isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#9CA3AF]";
  const inputCls = `w-full rounded-xl px-4 py-2.5 text-sm outline-none border transition-colors ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white focus:border-[#9E217B]" : "bg-white border-[#9CA3AF] text-[#1A1A1A] focus:border-[#00AEEF]"}`;
  const labelCls = `block text-xs font-semibold mb-1 ${isDark ? "text-[#888899]" : "text-[#475569]"}`;
  const sectionTitle = `text-sm font-bold uppercase tracking-wider mb-4 ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`;
  const errCls = "text-red-400 text-xs mt-1";
  const accent = isDark ? "text-[#d4006e]" : "text-[#00AEEF]";
  const textMain = isDark ? "text-white" : "text-[#1A1A1A]";
  const textMuted = isDark ? "text-[#888899]" : "text-[#6B7280]";
  const divider = isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]";
  const btnPrimary = isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white";
  const btnSecondary = isDark ? "border border-[#2A2A35] text-[#888899] hover:bg-[#1C1C2A] hover:text-white" : "border border-[#9CA3AF] text-[#6B7280] hover:bg-[#F1F5F9]";

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
        >
          <motion.div
            initial={{ scale: 0.93, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.93, y: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className={`w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}
          >
            {/* ── Header ── */}
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                {confirmedBooking ? (
                  <h2 className={`text-lg font-bold ${textMain}`}>Booking Confirmed</h2>
                ) : (
                  <>
                    <h2 className={`text-lg font-bold ${textMain}`}>Booking Application Form</h2>
                    <p className={`text-xs mt-0.5 ${textMuted}`}>Lead #{lead?.sr_no || lead?.id} — {lead?.name}</p>
                  </>
                )}
              </div>
              <button onClick={handleClose} className={`p-2 rounded-xl transition-colors cursor-pointer ${isDark ? "text-[#888899] hover:bg-[#1C1C2A] hover:text-white" : "text-[#6B7280] hover:bg-[#F1F5F9]"}`}>
                <FaTimes />
              </button>
            </div>

            {/* ── Confirmation Screen (replaces stepper + body when booking is saved) ── */}
            {confirmedBooking ? (
              <div className={`flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center ${bg}`}>
                <AnimatePresence>
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    className="w-full max-w-md flex flex-col items-center text-center"
                  >
                    {/* Animated success icon */}
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 18 }}
                      className="w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-lg"
                      style={{ background: isDark ? "linear-gradient(135deg,#9E217B,#d4006e)" : "linear-gradient(135deg,#00AEEF,#0077c2)" }}
                    >
                      <FaCheckCircle className="text-white text-4xl" />
                    </motion.div>

                    <h3 className={`text-2xl font-bold mb-1 ${textMain}`}>Booking Confirmed!</h3>
                    <p className={`text-sm mb-6 ${textMuted}`}>The booking has been saved to the database.</p>

                    {/* Booking details card */}
                    <div className={`w-full rounded-2xl border p-5 mb-6 text-left ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {[
                          { label: "Booking No.", val: confirmedBooking.booking_number },
                          { label: "Applicant", val: confirmedBooking.primary_name },
                          { label: "Flat", val: confirmedBooking.flat_number },
                          { label: "Floor", val: confirmedBooking.floor_number },
                          { label: "Type", val: confirmedBooking.property_type },
                          { label: "Amount", val: confirmedBooking.consideration_value ? `₹${confirmedBooking.consideration_value}` : "—" },
                          { label: "Status", val: confirmedBooking.booking_status },
                          { label: "Date", val: confirmedBooking.application_date },
                        ].map(({ label, val }) => (
                          <div key={label}>
                            <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${textMuted}`}>{label}</p>
                            <p className={`font-bold text-sm ${textMain}`}>{val || "—"}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Non-blocking PDF error banner */}
                    {pdfError && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3"
                      >
                        <span className="text-amber-400 text-lg flex-shrink-0 mt-0.5">⚠</span>
                        <div className="flex-1 text-left">
                          <p className="text-xs text-amber-300 font-medium">{pdfError}</p>
                        </div>
                        <button onClick={() => setPdfError(null)} className="text-amber-400 hover:text-amber-200 text-xs flex-shrink-0">✕</button>
                      </motion.div>
                    )}

                    {/* Action buttons */}
                    <div className="w-full flex flex-col sm:flex-row gap-3">
                      {/* View Booking — opens read-only view, closes modal */}
                      <button
                        onClick={handleClose}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-colors border cursor-pointer ${btnSecondary}`}
                      >
                        <FaFileAlt className="text-xs" /> View Booking
                      </button>

                      {/* Download PDF — fully isolated, cannot break booking state */}
                      <button
                        onClick={downloadPdf}
                        disabled={isPdfGenerating}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shadow-md ${btnPrimary}`}
                      >
                        {isPdfGenerating ? (
                          <><span className="animate-spin text-sm">⟳</span> Generating...</>
                        ) : (
                          <><FaDownload className="text-xs" /> Download PDF</>
                        )}
                      </button>

                      {/* Close — dismisses modal cleanly */}
                      <button
                        onClick={handleClose}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-colors border cursor-pointer ${isDark ? "border-[#2A2A35] text-[#888899] hover:bg-[#1C1C2A]" : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#F1F5F9]"}`}
                      >
                        <FaTimes className="text-xs" /> Close
                      </button>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            ) : (
              <>

                {/* ── Stepper ── */}
                <div className={`flex items-center gap-0 px-6 py-3 border-b flex-shrink-0 overflow-x-auto ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#F1F5F9]"}`}>
                  {STEPS.map((s, i) => (
                    <React.Fragment key={s.id}>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step > s.id ? (isDark ? "bg-green-600 text-white" : "bg-green-500 text-white") : step === s.id ? (isDark ? "bg-[#9E217B] text-white" : "bg-[#00AEEF] text-white") : (isDark ? "bg-[#1C1C2A] text-[#555568]" : "bg-[#F1F5F9] text-[#9CA3AF]")}`}>
                          {step > s.id ? <FaCheck className="text-[10px]" /> : s.icon}
                        </div>
                        <span className={`text-xs font-semibold hidden sm:block ${step === s.id ? accent : textMuted}`}>{s.label}</span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`flex-1 h-px mx-2 min-w-[16px] ${step > s.id ? (isDark ? "bg-green-600" : "bg-green-500") : (isDark ? "bg-[#2A2A35]" : "bg-[#E5E7EB]")}`} />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {/* ── Body ── */}
                <div className={`flex-1 overflow-y-auto p-6 custom-scrollbar ${bg}`}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.18 }}
                    >

                      {/* ══════════ STEP 1: Applicant Details ══════════ */}
                      {step === 1 && (

                        <div className="space-y-6">
                          {/* Primary Applicant */}
                          <div>
                            <p className={sectionTitle}><FaUser className="inline mr-2" />Primary Applicant</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {[
                                { key: "primary_name", label: "Full Name (Mr./Mrs./Ms.)", placeholder: "Enter full name" },
                                { key: "primary_email", label: "Email ID", placeholder: "email@example.com" },
                                { key: "primary_mobile", label: "Mobile Number", placeholder: "10-digit mobile" },
                                { key: "primary_pan", label: "PAN Number", placeholder: "ABCDE1234F" },
                                { key: "primary_aadhaar", label: "Aadhaar Number", placeholder: "12-digit Aadhaar" },
                                { key: "primary_occupation", label: "Occupation", placeholder: "e.g. Business" },
                                { key: "primary_nationality", label: "Nationality", placeholder: "Indian" },
                              ].map(({ key, label, placeholder }) => (
                                <div key={key}>
                                  <label className={labelCls}>{label}</label>
                                  <input
                                    value={(form as any)[key]}
                                    onChange={e => {
                                      let val = e.target.value;
                                      if (key === "primary_pan") val = val.toUpperCase();
                                      set(key as keyof BookingFormData, val as any);
                                    }}
                                    placeholder={placeholder}
                                    className={`${inputCls} ${errors[key as keyof BookingFormData] ? "!border-red-500" : ""}`}
                                  />
                                  {errors[key as keyof BookingFormData] && <p className={errCls}>{errors[key as keyof BookingFormData]}</p>}
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 p-4 border rounded-xl bg-black/5 dark:bg-white/5 border-dashed">
                              <p className={`text-xs font-bold mb-3 ${textMain}`}>Applicant Documents (Max 10MB each)</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <label className={labelCls}>Upload PAN Card (Front)</label>
                                  <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={e => set("primary_pan_file", e.target.files?.[0] || null)} className="w-full text-xs" />
                                </div>
                                <div>
                                  <label className={labelCls}>Upload Aadhaar Card (Front)</label>
                                  <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={e => set("primary_aadhaar_front_file", e.target.files?.[0] || null)} className="w-full text-xs" />
                                </div>
                                <div>
                                  <label className={labelCls}>Upload Aadhaar Card (Back) <span className="opacity-60 font-normal">(Optional)</span></label>
                                  <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={e => set("primary_aadhaar_back_file", e.target.files?.[0] || null)} className="w-full text-xs" />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Dynamic Joint Applicants */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <div className="flex items-center justify-between mb-4">
                              <p className={sectionTitle} style={{ marginBottom: 0 }}><FaUser className="inline mr-2 opacity-60" />Joint Applicants</p>
                              <button
                                onClick={() => set("joint_applicants", [...form.joint_applicants, { name: "", email: "", mobile: "", pan: "", aadhaar: "", occupation: "", nationality: "Indian", pan_file: null, aadhaar_front_file: null, aadhaar_back_file: null }])}
                                className="text-xs px-3 py-1.5 rounded bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 transition"
                              >
                                + Add Joint Applicant
                              </button>
                            </div>

                            {form.joint_applicants.length === 0 && (
                              <p className={`text-xs ${textMuted} italic mb-2`}>No joint applicants added.</p>
                            )}

                            <div className="space-y-6">
                              {form.joint_applicants.map((ja, idx) => (
                                <div key={idx} className="p-4 border border-dashed rounded-xl relative">
                                  <button
                                    onClick={() => set("joint_applicants", form.joint_applicants.filter((_, i) => i !== idx))}
                                    className="absolute top-2 right-2 text-red-500 hover:text-red-700 text-xs p-1"
                                  >
                                    <FaTimes />
                                  </button>
                                  <p className={`text-xs font-bold mb-3 ${textMain}`}>Joint Applicant {idx + 1}</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                    {[
                                      { k: "name", label: "Full Name", ph: "Enter full name" },
                                      { k: "email", label: "Email ID", ph: "email@example.com" },
                                      { k: "mobile", label: "Mobile Number", ph: "10-digit mobile" },
                                      { k: "pan", label: "PAN Number", ph: "ABCDE1234F" },
                                      { k: "aadhaar", label: "Aadhaar Number", ph: "12-digit Aadhaar" },
                                      { k: "occupation", label: "Occupation", ph: "e.g. Service" },
                                      { k: "nationality", label: "Nationality", ph: "Indian" }
                                    ].map(f => (
                                      <div key={f.k}>
                                        <label className={labelCls}>{f.label}</label>
                                        <input
                                          value={(ja as any)[f.k]}
                                          onChange={e => {
                                            let val = e.target.value;
                                            if (f.k === "pan") val = val.toUpperCase();
                                            const arr = [...form.joint_applicants];
                                            (arr[idx] as any)[f.k] = val;
                                            set("joint_applicants", arr);
                                          }}
                                          placeholder={f.ph} className={inputCls}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="mt-2 pt-3 border-t border-dashed border-gray-300 dark:border-gray-700">
                                    <p className={`text-[11px] font-semibold mb-2 ${textMuted}`}>Documents (Max 10MB each)</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <div>
                                        <label className={labelCls}>Upload PAN Card (Front)</label>
                                        <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={e => {
                                          const arr = [...form.joint_applicants];
                                          arr[idx].pan_file = e.target.files?.[0] || null;
                                          set("joint_applicants", arr);
                                        }} className="w-full text-xs" />
                                      </div>
                                      <div>
                                        <label className={labelCls}>Upload Aadhaar (Front)</label>
                                        <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={e => {
                                          const arr = [...form.joint_applicants];
                                          arr[idx].aadhaar_front_file = e.target.files?.[0] || null;
                                          set("joint_applicants", arr);
                                        }} className="w-full text-xs" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Residence */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}><FaHome className="inline mr-2" />Residential Address</p>
                            <div className="space-y-4">
                              <div>
                                <label className={labelCls}>Address</label>
                                <textarea value={form.address} onChange={e => set("address", e.target.value)} placeholder="Full residential address" rows={2} className={`${inputCls} resize-none`} />
                              </div>
                              <div className="grid grid-cols-3 gap-4">
                                {[
                                  { key: "pin", label: "PIN Code", placeholder: "400001" },
                                  { key: "state", label: "State", placeholder: "Maharashtra" },
                                  { key: "country", label: "Country", placeholder: "India" },
                                ].map(({ key, label, placeholder }) => (
                                  <div key={key}>
                                    <label className={labelCls}>{label}</label>
                                    <input value={(form as any)[key]} onChange={e => set(key as keyof BookingFormData, e.target.value as any)} placeholder={placeholder} className={inputCls} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ══════════ STEP 2: Unit Details ══════════ */}
                      {step === 2 && (
                        <div className="space-y-6">
                          <div>
                            <p className={sectionTitle}><FaBuilding className="inline mr-2" />Details of Unit Applied For</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              {[
                                { key: "apartment_name", label: "Apartment Name", placeholder: "Bhoomi Heights" },
                                { key: "project_name", label: "Project Name", placeholder: "Bhoomi Dwellers" },
                                { key: "tower", label: "Tower", placeholder: "A" },
                                { key: "wing", label: "Wing", placeholder: "North" },
                              ].map(({ key, label, placeholder }) => (
                                <div key={key}>
                                  <label className={labelCls}>{label}</label>
                                  <input
                                    value={(form as any)[key]}
                                    onChange={e => set(key as keyof BookingFormData, e.target.value as any)}
                                    placeholder={placeholder}
                                    className={`${inputCls} ${errors[key as keyof BookingFormData] ? "!border-red-500" : ""}`}
                                  />
                                  {errors[key as keyof BookingFormData] && <p className={errCls}>{errors[key as keyof BookingFormData]}</p>}
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                              {[
                                { key: "property_type", label: "Type", placeholder: "2 BHK" },
                                { key: "floor_number", label: "Floor", placeholder: "12" },
                                { key: "flat_number", label: "Flat No.", placeholder: "A-1201" },
                                { key: "carpet_area", label: "Carpet Area (sq.ft.)", placeholder: "1050" },
                              ].map(({ key, label, placeholder }) => (
                                <div key={key}>
                                  <label className={labelCls}>{label}</label>
                                  <input
                                    value={(form as any)[key]}
                                    onChange={e => {
                                      let val = e.target.value;
                                      if (key === "flat_number") val = val.toUpperCase();
                                      set(key as keyof BookingFormData, val as any);
                                    }}
                                    placeholder={placeholder}
                                    className={`${inputCls} ${errors[key as keyof BookingFormData] ? "!border-red-500" : ""}`}
                                  />
                                  {errors[key as keyof BookingFormData] && <p className={errCls}>{errors[key as keyof BookingFormData]}</p>}
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className={labelCls}>Consideration Value</label>
                                <IndianCurrencyInput value={form.consideration_value} onChange={val => set("consideration_value", val)} placeholder="52,00,000" className={`${inputCls} ${errors.consideration_value ? "!border-red-500" : ""}`} />
                                {errors.consideration_value && <p className={errCls}>{errors.consideration_value}</p>}
                              </div>
                              <div>
                                <label className={labelCls}>Value In Words</label>
                                <input value={form.consideration_value_words} onChange={e => set("consideration_value_words", e.target.value)} placeholder="Auto-generated" className={inputCls} />
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className={labelCls}>Parking Details</label>
                                <input value={form.parking_details} onChange={e => set("parking_details", e.target.value)} placeholder="e.g. 1 covered parking" className={inputCls} />
                              </div>
                            </div>
                          </div>

                          {/* Payment Table */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <div className="flex items-center justify-between mb-3">
                              <p className={sectionTitle}><FaMoneyBillWave className="inline mr-2" />Payment Details</p>
                              <button onClick={addPayment} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${btnPrimary}`}>
                                <FaPlus className="text-[10px]" /> Add Row
                              </button>
                            </div>
                            <div className={`rounded-xl border overflow-hidden ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className={isDark ? "bg-[#1A1A28]" : "bg-[#F1F5F9]"}>
                                    <th className={`text-left px-3 py-2 text-xs font-bold w-8 ${textMuted}`}>Sr.</th>
                                    <th className={`text-left px-3 py-2 text-xs font-bold ${textMuted}`}>Date</th>
                                    <th className={`text-left px-3 py-2 text-xs font-bold ${textMuted}`}>Transaction Detail</th>
                                    <th className={`text-left px-3 py-2 text-xs font-bold ${textMuted}`}>Amount (₹)</th>
                                    <th className="w-8" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {form.payment_details.map((row, i) => (
                                    <tr key={i} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#F1F5F9]"}`}>
                                      <td className={`px-3 py-2 text-xs ${textMuted}`}>{i + 1}.</td>
                                      <td className="px-2 py-1.5"><input type="date" value={row.date} onChange={e => updatePayment(i, "date", e.target.value)} className={`${inputCls} text-xs py-1.5`} /></td>
                                      <td className="px-2 py-1.5">
                                        <select value={row.transaction_type} onChange={e => updatePayment(i, "transaction_type", e.target.value)} className={`${inputCls} text-xs py-1.5`}>
                                          {["Cheque", "NEFT/RTGS", "Cash", "UPI", "Demand Draft", "Other"].map(v => <option key={v} value={v}>{v}</option>)}
                                        </select>
                                      </td>
                                      <td className="px-2 py-1.5"><IndianCurrencyInput value={row.amount} onChange={val => updatePayment(i, "amount", val)} placeholder="0" className={`${inputCls} text-xs py-1.5`} /></td>
                                      <td className="px-2">
                                        <button onClick={() => removePayment(i)} className="text-red-400 hover:text-red-300 cursor-pointer"><FaTrash className="text-xs" /></button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Witness */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}>Witness Details</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className={labelCls}>Witness Name</label>
                                <input value={form.witness_name} onChange={e => set("witness_name", e.target.value)} placeholder="Full name" className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Aadhaar Number</label>
                                <input value={form.witness_aadhaar} onChange={e => set("witness_aadhaar", e.target.value)} placeholder="12-digit Aadhaar" className={inputCls} />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ══════════ STEP 3: Financials & Registration ══════════ */}
                      {step === 3 && (
                        <div className="space-y-6">
                          {/* ── Section 1: Booking & Agreement ── */}
                          <div>
                            <p className={sectionTitle}><FaMoneyBillWave className="inline mr-2" />Booking &amp; Agreement</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Booking Date</label>
                                <input type="date" value={form.booking_date} onChange={e => set("booking_date", e.target.value)} className={`${inputCls} ${errors.booking_date ? "!border-red-500" : ""}`} />
                                {errors.booking_date && <p className={errCls}>{errors.booking_date}</p>}
                              </div>
                              <div>
                                <label className={labelCls}>Agreement Value</label>
                                <IndianCurrencyInput value={form.agreement_value} onChange={val => set("agreement_value", val)} placeholder="50,00,000" className={`${inputCls} ${errors.agreement_value ? "!border-red-500" : ""}`} />
                                {errors.agreement_value && <p className={errCls}>{errors.agreement_value}</p>}
                              </div>
                              <div>
                                <label className={labelCls}>Booking Amount</label>
                                <IndianCurrencyInput value={form.booking_amount} onChange={val => set("booking_amount", val)} placeholder="1,00,000" className={`${inputCls} ${errors.booking_amount ? "!border-red-500" : ""}`} />
                                {errors.booking_amount && <p className={errCls}>{errors.booking_amount}</p>}
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Token Amount <span className="font-normal opacity-70">(part of Booking Amount)</span></label>
                                <IndianCurrencyInput value={form.token_amount} onChange={val => set("token_amount", val)} placeholder="50,000" className={inputCls} />
                              </div>
                              <div className="sm:col-span-2">
                                <label className={labelCls}>Booking Remarks</label>
                                <input value={form.booking_remarks} onChange={e => set("booking_remarks", e.target.value)} placeholder="Any initial remarks" className={inputCls} />
                              </div>
                            </div>
                            {(() => {
                              const av = toNumber(form.agreement_value);
                              const maxBooking = av * 0.10;
                              const bk = toNumber(form.booking_amount);
                              if (av <= 0) return null;
                              const over = bk > maxBooking;
                              return (
                                <div className={`mt-3 rounded-lg px-3 py-2 text-xs flex items-start gap-2 border ${over ? (isDark ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-amber-50 border-amber-300 text-amber-700") : (isDark ? "bg-[#14141B] border-[#2A2A35] text-[#888899]" : "bg-[#F8FAFC] border-[#E5E7EB] text-[#6B7280]")}`}>
                                  <span>⚠</span>
                                  <span>
                                    <strong>RERA:</strong> Booking amount should not exceed 10% of agreement value.
                                    Max allowed: <strong>{formatINR(maxBooking)}</strong>.
                                    {over && <span className="font-bold"> Current booking amount ({formatINR(bk)}) exceeds this cap.</span>}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>

                          {/* ── Section 2: Total Cost Breakdown (auto-computed) ── */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}>Total Cost Breakdown <span className="font-normal normal-case opacity-70">(auto-computed)</span></p>
                            {(() => {
                              const cost = computeCostBreakdown(form);
                              const Row = ({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) => (
                                <div className={`flex items-center justify-between px-4 py-2.5 ${strong ? "" : "border-b"} ${divider}`}>
                                  <span className={`text-xs ${strong ? `font-bold ${textMain}` : textMuted}`}>{label}{hint && <span className="ml-1 opacity-60">{hint}</span>}</span>
                                  <span className={`text-sm ${strong ? "font-extrabold" : "font-semibold"} ${textMain}`}>{formatINR(value)}</span>
                                </div>
                              );
                              return (
                                <div className={`rounded-xl border overflow-hidden ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]"}`}>
                                  <Row label="Agreement Value" value={cost.agreementValue} />
                                  <div className={`flex items-center justify-between px-4 py-2.5 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted} flex items-center gap-2`}>
                                      + GST
                                      <select value={form.gst_rate} onChange={e => set("gst_rate", e.target.value)} className={`rounded-md px-1.5 py-0.5 text-xs outline-none border ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white" : "bg-white border-[#9CA3AF] text-[#1A1A1A]"}`}>
                                        <option value="5">5% (no ITC)</option>
                                        <option value="12">12% (with ITC)</option>
                                      </select>
                                    </span>
                                    <span className={`text-sm font-semibold ${textMain}`}>{formatINR(cost.gstAmount)}</span>
                                  </div>
                                  <Row label="+ Stamp Duty" value={cost.stampDuty} hint="(5% est.)" />
                                  <Row label="+ Registration Fee" value={cost.registrationFee} hint="(1% est., cap ₹30K)" />
                                  <div className={`flex items-center justify-between px-4 py-2 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted}`}>+ Legal Charges</span>
                                    <IndianCurrencyInput value={form.legal_charges} onChange={val => set("legal_charges", val)} placeholder="0" className={`${inputCls} text-xs py-1.5 w-40 text-right`} />
                                  </div>
                                  <div className={`flex items-center justify-between px-4 py-2 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted}`}>+ Maintenance Deposit</span>
                                    <IndianCurrencyInput value={form.maintenance_deposit} onChange={val => set("maintenance_deposit", val)} placeholder="0" className={`${inputCls} text-xs py-1.5 w-40 text-right`} />
                                  </div>
                                  <Row label="+ Custom Charges" value={cost.customChargesTotal} hint="(from below)" />
                                  <div className={isDark ? "bg-[#14141B]" : "bg-[#F8FAFC]"}>
                                    <Row label="Total Cost to Customer" value={cost.totalCost} strong />
                                  </div>
                                  {form.loan_required && (
                                    <div className={`border-t ${divider}`}>
                                      <Row label="Own Contribution Required" value={cost.ownContributionRequired} hint="(Agreement + GST − Loan)" />
                                      <Row label="Loan Amount" value={cost.loanAmount} />
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>

                          {/* ── Section 3: Own Contribution (OCR) ── */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}>Own Contribution (OCR)</p>
                            {(() => {
                              const cost = computeCostBreakdown(form);
                              const paid = toNumber(form.token_amount) + toNumber(form.booking_amount) + toNumber(form.ocr_amount) + toNumber(form.cash_component);
                              const required = cost.ownContributionRequired;
                              const remaining = Math.max(required - paid, 0);
                              const breakdown = [
                                { label: "Token Amount", amount: toNumber(form.token_amount), date: form.booking_date },
                                { label: "Booking Amount", amount: toNumber(form.booking_amount), date: form.booking_date },
                                { label: "Additional Own Payment", amount: toNumber(form.ocr_amount), date: form.ocr_received_date },
                                { label: "Cash / Direct Payment", amount: toNumber(form.cash_component), date: form.cash_component_date },
                              ].filter(b => b.amount > 0);
                              return (
                                <div className={`rounded-xl border overflow-hidden mb-4 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]"}`}>
                                  <div className={`grid grid-cols-3 border-b ${divider}`}>
                                    <div className={`px-4 py-3 border-r ${divider}`}><p className={`text-[10px] font-semibold uppercase ${textMuted}`}>Required</p><p className={`font-bold text-sm ${textMain}`}>{formatINR(required)}</p></div>
                                    <div className={`px-4 py-3 border-r ${divider}`}><p className={`text-[10px] font-semibold uppercase ${textMuted}`}>Paid</p><p className="font-bold text-sm text-green-500">{formatINR(paid)}</p></div>
                                    <div className="px-4 py-3"><p className={`text-[10px] font-semibold uppercase ${textMuted}`}>Remaining</p><p className={`font-bold text-sm ${remaining > 0 ? "text-amber-500" : "text-green-500"}`}>{formatINR(remaining)}</p></div>
                                  </div>
                                  {breakdown.length === 0 ? (
                                    <p className={`px-4 py-3 text-xs italic ${textMuted}`}>No own-contribution payments captured yet.</p>
                                  ) : (
                                    <div className={`divide-y ${isDark ? "divide-[#2A2A35]" : "divide-[#F1F5F9]"}`}>
                                      {breakdown.map((b, i) => (
                                        <div key={i} className="flex items-center justify-between px-4 py-2">
                                          <span className={`text-xs ${textMain}`}>✓ {b.label}</span>
                                          <span className={`text-xs ${textMuted}`}>{b.date || "—"}</span>
                                          <span className={`text-xs font-bold ${textMain}`}>{formatINR(b.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Additional Own Payment <span className="font-normal opacity-70">(installments beyond token/booking)</span></label>
                                <IndianCurrencyInput value={form.ocr_amount} onChange={val => set("ocr_amount", val)} placeholder="0" className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Received Date</label>
                                <input type="date" value={form.ocr_received_date} onChange={e => set("ocr_received_date", e.target.value)} className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>OCR Payment Mode</label>
                                <select value={form.ocr_payment_mode} onChange={e => set("ocr_payment_mode", e.target.value)} className={inputCls}>
                                  {["Cheque", "NEFT/RTGS", "Cash", "UPI", "Demand Draft", "Other"].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="mt-4">
                              <label className={labelCls}>OCR Remarks</label>
                              <input value={form.ocr_remarks} onChange={e => set("ocr_remarks", e.target.value)} placeholder="Remarks" className={inputCls} />
                            </div>
                          </div>

                          {/* ── Section 4: Stamp Duty & Registration (split) ── */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}>Stamp Duty &amp; Registration</p>
                            <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${accent}`}>Stamp Duty</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Amount <span className="font-normal opacity-70">(auto)</span></label>
                                <input readOnly value={formatINR(toNumber(form.stamp_duty_amount))} className={`${inputCls} opacity-80 cursor-default`} />
                              </div>
                              <div>
                                <label className={labelCls}>Status</label>
                                <select value={form.stamp_duty_status} onChange={e => set("stamp_duty_status", e.target.value)} className={inputCls}>
                                  <option value="Pending">Pending</option>
                                  <option value="Paid">Paid</option>
                                </select>
                              </div>
                              <div>
                                <label className={labelCls}>Payment Mode</label>
                                <select value={form.stamp_duty_payment_mode} onChange={e => set("stamp_duty_payment_mode", e.target.value)} className={inputCls}>
                                  {["E-Stamp", "Franking", "Stamp Paper"].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className={labelCls}>Paid Date</label>
                                <input type="date" value={form.stamp_duty_paid_date} onChange={e => set("stamp_duty_paid_date", e.target.value)} className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Receipt No.</label>
                                <input value={form.stamp_duty_receipt_no} onChange={e => set("stamp_duty_receipt_no", e.target.value)} placeholder="Receipt / reference" className={inputCls} />
                              </div>
                            </div>
                            <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 mt-5 ${accent}`}>Registration</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Fee <span className="font-normal opacity-70">(auto)</span></label>
                                <input readOnly value={formatINR(toNumber(form.registration_fee_amount))} className={`${inputCls} opacity-80 cursor-default`} />
                              </div>
                              <div>
                                <label className={labelCls}>Status</label>
                                <select value={form.registration_status} onChange={e => set("registration_status", e.target.value)} className={inputCls}>
                                  <option value="Pending">Pending</option>
                                  <option value="Scheduled">Scheduled</option>
                                  <option value="Completed">Completed</option>
                                </select>
                              </div>
                              <div>
                                <label className={labelCls}>Registration Number</label>
                                <input value={form.registration_number} onChange={e => set("registration_number", e.target.value)} placeholder="Registration No." className={inputCls} />
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Expected Registration Date</label>
                                <input type="date" value={form.expected_registration_date} onChange={e => set("expected_registration_date", e.target.value)} className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Actual Registration Date</label>
                                <input type="date" value={form.actual_registration_date} onChange={e => set("actual_registration_date", e.target.value)} className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Registration Remarks</label>
                                <input value={form.registration_remarks} onChange={e => set("registration_remarks", e.target.value)} placeholder="Remarks" className={inputCls} />
                              </div>
                            </div>
                          </div>

                          {/* ── Section 5: Additional Direct Payment (collapsible, optional) ── */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <button
                              type="button"
                              onClick={() => setShowAdditionalPayment(v => !v)}
                              className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wider ${isDark ? "text-[#d4006e]" : "text-[#9E217B]"}`}
                            >
                              <FaChevronRight className={`text-[10px] transition-transform ${showAdditionalPayment ? "rotate-90" : ""}`} />
                              Additional Direct Payment (Optional)
                            </button>
                            {showAdditionalPayment && (
                              <div className="mt-4">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                  <div>
                                    <label className={labelCls}>Amount</label>
                                    <IndianCurrencyInput value={form.cash_component} onChange={val => set("cash_component", val)} placeholder="If applicable" className={inputCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Date</label>
                                    <input type="date" value={form.cash_component_date} onChange={e => set("cash_component_date", e.target.value)} className={inputCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Remarks</label>
                                    <input value={form.cash_component_remarks} onChange={e => set("cash_component_remarks", e.target.value)} placeholder="Remarks" className={inputCls} />
                                  </div>
                                </div>
                                <p className={`mt-2 text-[11px] flex items-center gap-1.5 ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                                  ⚠ This payment is outside the agreement value.
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Bank Loan Details */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <div className="flex items-center justify-between mb-4">
                              <p className={sectionTitle} style={{ marginBottom: 0 }}>Bank Loan Details</p>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <span className={`text-sm font-semibold ${textMain}`}>Loan Required?</span>
                                <input type="checkbox" checked={form.loan_required} onChange={e => set("loan_required", e.target.checked)} className="w-4 h-4 cursor-pointer" />
                              </label>
                            </div>
                            {form.loan_required && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                  <div>
                                    <label className={labelCls}>Bank Name</label>
                                    <input value={form.bank_name} onChange={e => set("bank_name", e.target.value)} placeholder="e.g. HDFC Bank" className={inputCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Loan Executive (Officer)</label>
                                    <input value={form.loan_executive} onChange={e => set("loan_executive", e.target.value)} placeholder="Name & Contact" className={inputCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Loan Type</label>
                                    <select value={form.loan_type} onChange={e => set("loan_type", e.target.value)} className={inputCls}>
                                      <option value="">Select</option>
                                      <option value="Home Loan">Home Loan</option>
                                      <option value="Top-Up Loan">Top-Up Loan</option>
                                      <option value="Balance Transfer">Balance Transfer</option>
                                      <option value="Other">Other</option>
                                    </select>
                                  </div>
                                </div>
                                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div>
                                    <label className={labelCls}>
                                      Loan Amount
                                      {form.consideration_value && <span className="ml-1 font-normal opacity-70">(Flat value - ₹{formatIndianNumber(form.consideration_value)})</span>}
                                    </label>
                                    <IndianCurrencyInput value={form.loan_amount} onChange={val => set("loan_amount", val)} placeholder="40,00,000" className={inputCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Loan Reference No.</label>
                                    <input value={form.loan_reference_no} onChange={e => set("loan_reference_no", e.target.value)} placeholder="Bank loan reference" className={inputCls} />
                                  </div>
                                </div>
                                <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4">
                                  <div>
                                    <label className={labelCls}>Sanction Amount</label>
                                    <IndianCurrencyInput value={form.sanction_amount} onChange={val => set("sanction_amount", val)} placeholder="Amount" className={inputCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Sanction Date</label>
                                    <input type="date" value={form.sanction_date} onChange={e => set("sanction_date", e.target.value)} className={inputCls} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Sanction Status</label>
                                    <select value={form.sanction_status} onChange={e => set("sanction_status", e.target.value)} className={inputCls}>
                                      <option value="Pending">Pending</option>
                                      <option value="Approved">Approved</option>
                                      <option value="Rejected">Rejected</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className={labelCls}>Overall Loan Status</label>
                                    <select value={form.loan_status} onChange={e => set("loan_status", e.target.value)} className={inputCls}>
                                      <option value="Pending">Pending</option>
                                      <option value="Sanctioned">Sanctioned</option>
                                      <option value="Partially Disbursed">Partially Disbursed</option>
                                      <option value="Fully Disbursed">Fully Disbursed</option>
                                    </select>
                                  </div>
                                </div>

                                {/* Disbursement */}
                                <div className={`border-t pt-4 mt-2 ${divider}`}>
                                  <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>Disbursement</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                      <label className={labelCls}>Expected Disbursement Date</label>
                                      <input type="date" value={form.expected_disbursement_date} onChange={e => set("expected_disbursement_date", e.target.value)} className={inputCls} />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Expected Disbursement Amount</label>
                                      <IndianCurrencyInput value={form.expected_disbursement_amount} onChange={val => set("expected_disbursement_amount", val)} placeholder="Amount" className={inputCls} />
                                    </div>
                                  </div>
                                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                      <label className={labelCls}>Actual Disbursement Date</label>
                                      <input type="date" value={form.actual_disbursement_date} onChange={e => set("actual_disbursement_date", e.target.value)} className={inputCls} />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Amount Disbursed</label>
                                      <IndianCurrencyInput value={form.disbursement_amount} onChange={val => set("disbursement_amount", val)} placeholder="Amount received" className={inputCls} />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Disbursement Status</label>
                                      <select value={form.disbursement_status} onChange={e => set("disbursement_status", e.target.value)} className={inputCls}>
                                        <option value="Pending">Pending</option>
                                        <option value="Partial">Partial</option>
                                        <option value="Completed">Completed</option>
                                      </select>
                                    </div>
                                  </div>
                                  <p className={`mt-3 text-[11px] flex items-start gap-1.5 ${textMuted}`}>
                                    <span>ℹ</span>
                                    <span>Disbursement tranches are tracked in the Loan &amp; Deal section after the booking is confirmed. This captures the initial/first disbursement only.</span>
                                  </p>
                                </div>

                                {/* EMI Details */}
                                <div className={`border-t pt-4 mt-2 ${divider}`}>
                                  <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>EMI Details</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                      <label className={labelCls}>Interest Rate (%)</label>
                                      <input type="number" step="0.01" value={form.interest_rate} onChange={e => set("interest_rate", e.target.value)} placeholder="8.5" className={inputCls} />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Tenure (months)</label>
                                      <input type="number" value={form.loan_tenure_months} onChange={e => set("loan_tenure_months", e.target.value)} placeholder="240" className={inputCls} />
                                    </div>
                                    <div>
                                      <label className={labelCls}>EMI Start Date</label>
                                      <input type="date" value={form.emi_start_date} onChange={e => set("emi_start_date", e.target.value)} className={inputCls} />
                                    </div>
                                  </div>
                                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                      <label className={labelCls}>Pre-EMI Amount <span className="font-normal opacity-70">(auto)</span></label>
                                      <input readOnly value={formatINR(toNumber(form.pre_emi_amount))} className={`${inputCls} opacity-80 cursor-default`} />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Full EMI Amount <span className="font-normal opacity-70">(auto)</span></label>
                                      <input readOnly value={formatINR(toNumber(form.emi_amount))} className={`${inputCls} opacity-80 cursor-default`} />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Payment Type</label>
                                      <select value={form.payment_type} onChange={e => set("payment_type", e.target.value)} className={inputCls}>
                                        <option value="Pre-EMI">Pre-EMI</option>
                                        <option value="Full EMI">Full EMI</option>
                                      </select>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Custom Charges */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <div className="flex items-center justify-between mb-4">
                              <p className={sectionTitle} style={{ marginBottom: 0 }}>Custom Charges</p>
                              <button
                                onClick={() => set("custom_charges", [...form.custom_charges, { charge_name: "", amount: "", remarks: "" }])}
                                className={`text-xs px-3 py-1.5 rounded transition-colors ${btnSecondary}`}
                              >
                                + Add Charge
                              </button>
                            </div>
                            {form.custom_charges.length === 0 ? (
                              <p className={`text-xs ${textMuted} italic`}>No custom charges added.</p>
                            ) : (
                              <div className="space-y-3">
                                {form.custom_charges.map((charge, idx) => (
                                  <div key={idx} className="flex gap-2 items-center">
                                    <input value={charge.charge_name} onChange={e => { const c = [...form.custom_charges]; c[idx].charge_name = e.target.value; set("custom_charges", c); }} placeholder="Charge Name" className={`${inputCls} flex-1`} />
                                    <IndianCurrencyInput value={charge.amount} onChange={val => { const c = [...form.custom_charges]; c[idx].amount = val; set("custom_charges", c); }} placeholder="Amount" className={`${inputCls} w-1/4`} />
                                    <input value={charge.remarks} onChange={e => { const c = [...form.custom_charges]; c[idx].remarks = e.target.value; set("custom_charges", c); }} placeholder="Remarks" className={`${inputCls} flex-1`} />
                                    <button onClick={() => set("custom_charges", form.custom_charges.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700 p-2"><FaTrash /></button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* ── Section 7: Financial Summary (accounting-correct) ── */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}><FaMoneyBillWave className="inline mr-2" />Financial Summary <span className="font-normal normal-case opacity-70">(auto-calculated)</span></p>
                            <p className={`text-xs mb-4 ${textMuted}`}>
                              Developer revenue (agreement + GST) is kept separate from government pass-through
                              (stamp duty &amp; registration) and other charges, so collection figures never overstate
                              the developer&apos;s income.
                            </p>
                            {(() => {
                              const cost = computeCostBreakdown(form);
                              const grossReceivable = cost.agreementValue + cost.gstAmount;
                              const govtTotal = cost.stampDuty + cost.registrationFee;
                              const othersTotal = cost.legalCharges + cost.maintenanceDeposit + cost.possessionCharges + cost.customChargesTotal;
                              const ownPaid = toNumber(form.token_amount) + toNumber(form.booking_amount) + toNumber(form.ocr_amount) + toNumber(form.cash_component);
                              const sanctioned = form.loan_required ? toNumber(form.sanction_amount) : 0;
                              const disbursed = form.loan_required ? toNumber(form.disbursement_amount) : 0;
                              const remainingOcr = Math.max(cost.ownContributionRequired - ownPaid, 0);
                              const totalReceived = ownPaid + disbursed;
                              const balance = Math.max(cost.totalCost - totalReceived, 0);
                              const Line = ({ label, value, strong, color }: { label: string; value: number; strong?: boolean; color?: string }) => (
                                <div className="flex items-center justify-between px-4 py-1.5">
                                  <span className={`text-xs ${strong ? `font-bold ${textMain}` : textMuted}`}>{label}</span>
                                  <span className={`text-xs ${strong ? "font-extrabold" : "font-semibold"} ${color || textMain}`}>{formatINR(value)}</span>
                                </div>
                              );
                              const Head = ({ children }: { children: React.ReactNode }) => (
                                <p className={`px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider ${accent}`}>{children}</p>
                              );
                              return (
                                <div className={`rounded-xl border overflow-hidden ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]"}`}>
                                  <Head>Developer Revenue</Head>
                                  <Line label="Agreement Value" value={cost.agreementValue} />
                                  <Line label={`+ GST (${cost.gstRate}%)`} value={cost.gstAmount} />
                                  <Line label="= Gross Receivable" value={grossReceivable} strong />

                                  <div className={`border-t mt-1 ${divider}`} />
                                  <Head>Government Charges (Pass-Through)</Head>
                                  <Line label="Stamp Duty" value={cost.stampDuty} />
                                  <Line label="Registration Fee" value={cost.registrationFee} />
                                  <Line label="= Govt Total" value={govtTotal} strong />

                                  <div className={`border-t mt-1 ${divider}`} />
                                  <Head>Other Charges</Head>
                                  <Line label="Legal + Maintenance + Possession" value={cost.legalCharges + cost.maintenanceDeposit + cost.possessionCharges} />
                                  <Line label="Custom Charges" value={cost.customChargesTotal} />
                                  <Line label="= Others Total" value={othersTotal} strong />

                                  <div className={isDark ? "bg-[#14141B] border-t border-[#2A2A35]" : "bg-[#F8FAFC] border-t border-[#E5E7EB]"}>
                                    <Line label="TOTAL COST TO CUSTOMER" value={cost.totalCost} strong />
                                  </div>

                                  <div className={`border-t mt-1 ${divider}`} />
                                  <Head>Funding</Head>
                                  <Line label="Own Contribution (paid)" value={ownPaid} color="text-green-500" />
                                  {form.loan_required && <Line label="Loan (sanctioned)" value={sanctioned} />}
                                  {form.loan_required && <Line label="Loan (disbursed)" value={disbursed} color="text-green-500" />}
                                  <Line label="Remaining OCR needed" value={remainingOcr} color={remainingOcr > 0 ? "text-amber-500" : "text-green-500"} />

                                  <div className={`border-t mt-1 ${divider}`} />
                                  <Head>Collection Status</Head>
                                  <Line label="Total Received" value={totalReceived} color="text-green-500" />
                                  <Line label="Total Outstanding" value={balance} color={balance > 0 ? "text-amber-500" : "text-green-500"} />

                                  <div className={isDark ? "bg-[#14141B] border-t border-[#2A2A35]" : "bg-[#F8FAFC] border-t border-[#E5E7EB]"}>
                                    <Line label="BALANCE RECEIVABLE" value={balance} strong color={balance > 0 ? "text-amber-500" : textMain} />
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Revenue recognition overrides — preserved so management can still
                                mark which items count toward realized developer revenue downstream. */}
                            <details className={`mt-4 rounded-xl border ${isDark ? "border-[#2A2A35] bg-[#121218]" : "border-[#E5E7EB] bg-white"}`}>
                              <summary className={`cursor-pointer px-4 py-2.5 text-xs font-bold uppercase tracking-wider ${textMuted}`}>
                                Revenue Recognition (advanced)
                              </summary>
                              <div className={`px-4 pb-3 pt-1 border-t ${divider}`}>
                                <p className={`text-[11px] mb-2 ${textMuted}`}>
                                  Tick an item to count it toward realized revenue once it is received/completed.
                                  Loan Sanction is informational (bank approval, not cash).
                                </p>
                                {computeFinancials(form).items.map(item => (
                                  <label key={item.key} className="flex items-center gap-2 py-1 cursor-pointer">
                                    <input type="checkbox" checked={item.included} onChange={e => set(item.includeKey, e.target.checked)} className="w-4 h-4 cursor-pointer" />
                                    <span className={`text-xs ${textMain}`}>{item.label}</span>
                                    {item.informational && <span className={`text-[9px] uppercase ${textMuted}`}>(info)</span>}
                                    <span className={`ml-auto text-[11px] ${textMuted}`}>{formatINR(item.amount)}</span>
                                  </label>
                                ))}
                              </div>
                            </details>
                          </div>

                          {/* ── Section 3C: Possession Details ── */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}>Possession Details</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className={labelCls}>Expected Possession Date</label>
                                <input type="date" value={form.expected_possession_date} onChange={e => set("expected_possession_date", e.target.value)} className={inputCls} />
                              </div>
                              <div>
                                <label className={labelCls}>Possession Status</label>
                                <select value={form.possession_status} onChange={e => set("possession_status", e.target.value)} className={inputCls}>
                                  {["Pre-Construction", "Under Construction", "Nearing Completion", "Ready for Possession", "Possession Given", "Occupied"].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className={labelCls}>OC / CC Status</label>
                                <select value={form.oc_cc_status} onChange={e => set("oc_cc_status", e.target.value)} className={inputCls}>
                                  {["Pending", "Applied", "Received"].map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={labelCls}>OC / CC Date</label>
                                <input type="date" value={form.oc_cc_date} onChange={e => set("oc_cc_date", e.target.value)} className={inputCls} />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ══════════ STEP 4: Booking Source ══════════ */}
                      {step === 4 && (
                        <div className="space-y-6">
                          <p className={sectionTitle}><FaHandshake className="inline mr-2" />Source of Booking</p>
                          <p className={`text-xs ${textMuted}`}>(To be filled in by the sales manager prior to signature of customer)</p>
                          <div className="flex gap-6">
                            {(["Direct", "Channel Partner"] as const).map(src => (
                              <label key={src} className="flex items-center gap-2 cursor-pointer">
                                <div onClick={() => set("booking_source", src)} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${form.booking_source === src ? (isDark ? "border-[#9E217B] bg-[#9E217B]" : "border-[#00AEEF] bg-[#00AEEF]") : (isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]")}`}>
                                  {form.booking_source === src && <div className="w-2 h-2 rounded-full bg-white" />}
                                </div>
                                <span className={`font-semibold text-sm ${textMain}`}>{src}</span>
                              </label>
                            ))}
                          </div>

                          {form.booking_source === "Direct" && (
                            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                              <label className={labelCls}>Please Specify Source</label>
                              <input value={form.direct_source} onChange={e => set("direct_source", e.target.value)} placeholder="e.g. Advertisement, Exhibition, Website..." className={inputCls} />
                            </motion.div>
                          )}

                          {form.booking_source === "Channel Partner" && (
                            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <label className={labelCls}>Channel Partner Name</label>
                                  <input value={form.channel_partner_name} onChange={e => set("channel_partner_name", e.target.value)} placeholder="Partner firm / individual name" className={inputCls} />
                                </div>
                                <div>
                                  <label className={labelCls}>Contact Number</label>
                                  <input value={form.channel_partner_contact} onChange={e => set("channel_partner_contact", e.target.value)} placeholder="10-digit mobile" className={inputCls} />
                                </div>
                              </div>
                            </motion.div>
                          )}

                          <div className={`border-t pt-6 ${divider}`}>
                            <p className={sectionTitle}>Internal Notes</p>
                            <p className={`text-xs ${textMuted} mb-2`}>These notes are for internal reference only and will not appear on the customer's PDF.</p>
                            <textarea
                              value={(form as any).internal_notes || ""}
                              onChange={e => set("internal_notes" as any, e.target.value)}
                              placeholder="Any internal remarks, approvals, or context..."
                              rows={4}
                              className={`${inputCls} resize-none`}
                            />
                          </div>
                        </div>
                      )}

                      {/* ══════════ STEP 5: Declaration ══════════ */}
                      {step === 5 && (
                        <div className="space-y-6">
                          <p className={sectionTitle}><FaFileAlt className="inline mr-2" />Declaration & Signature</p>

                          {/* Declaration Text */}
                          <div className={`rounded-xl border p-5 space-y-3 text-sm leading-relaxed ${isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
                            <p className={textMain}><span className="font-bold">a.</span> I/We hereby solemnly declare that all the foregoing facts are true to the best of my/our knowledge and nothing relevant has been concealed or suppressed. I/We also undertake to Inform The Company of any future changes related to the information and details shown in this Application Form.</p>
                            <p className={textMain}><span className="font-bold">b.</span> I/We hereby also declare I/We have read and understood the terms and conditions and all other information/conditions stated in the accompanying GENERAL TERMS & CONDITIONS including consideration of the units and price & payment schedules. By signing this Application form, I/We do hereby solemnly accept and agree to abide by the terms & conditions as stipulated in the accompanying GENERAL TERMS & CONDITIONS, which may be modified or amended by the Company.</p>
                            <p className={textMain}><span className="font-bold">c.</span> I/We hereby give my/our irrevocable consent to become member of a body the owners to be formed in accordance with the applicable acts, rules and bye laws and execute necessary documents as and when required.</p>
                            <p className={`font-semibold ${accent}`}>I hereby agree to all the information mentioned above and the subsequent Terms and Conditions.</p>
                          </div>

                          {/* Terms & Conditions */}
                          <div>
                            <p className={`font-bold text-sm mb-2 ${textMain}`}>Terms and Conditions: <span className={`text-xs font-normal ${textMuted}`}>(Scroll to bottom to enable checkboxes)</span></p>
                            <div
                              ref={termsRef}
                              onScroll={() => {
                                const el = termsRef.current;
                                if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 10) setTermsScrolled(true);
                              }}
                              className={`h-40 overflow-y-auto rounded-xl border p-4 text-xs space-y-2 custom-scrollbar ${isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}
                            >
                              {TERMS.map((t, i) => (
                                <p key={i} className={textMuted}><span className="font-bold">{i + 1}.</span> {t}</p>
                              ))}
                            </div>
                          </div>

                          {/* Checkboxes */}
                          <div className={`space-y-3 ${!termsScrolled ? "opacity-50 pointer-events-none" : ""}`}>
                            {[
                              { key: "declaration_accepted" as keyof BookingFormData, label: "All information provided is true and accurate to the best of my knowledge." },
                              { key: "terms_accepted" as keyof BookingFormData, label: "I have read and accept all Terms & Conditions mentioned above." },
                              { key: "consent_accepted" as keyof BookingFormData, label: "I give my irrevocable consent as stated in the declaration above." },
                            ].map(({ key, label }) => (
                              <label key={key} className="flex items-start gap-3 cursor-pointer">
                                <div onClick={() => set(key, !form[key] as any)} className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${(form[key] as boolean) ? (isDark ? "bg-[#9E217B] border-[#9E217B]" : "bg-[#00AEEF] border-[#00AEEF]") : (isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]")}`}>
                                  {(form[key] as boolean) && <FaCheck className="text-white text-[9px]" />}
                                </div>
                                <span className={`text-sm ${textMain}`}>{label}</span>
                              </label>
                            ))}
                            {(errors.declaration_accepted || errors.terms_accepted || errors.consent_accepted) && (
                              <p className={errCls}>Please accept all declarations.</p>
                            )}
                          </div>

                          {/* Application Date */}
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className={labelCls}>Application Date</label>
                              <input value={form.application_date} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} />
                            </div>
                          </div>

                          {/* Signature Pad */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className={`${labelCls} mb-0`}>Signature of Primary Applicant</label>
                              <div className="flex gap-2">
                                <button onClick={() => setSigMode("draw")} className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors flex items-center gap-1 ${sigMode === "draw" ? btnPrimary : btnSecondary}`}><FaPen className="text-[10px]" /> Draw</button>
                                <button onClick={() => setSigMode("upload")} className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors flex items-center gap-1 ${sigMode === "upload" ? btnPrimary : btnSecondary}`}><FaUpload className="text-[10px]" /> Upload</button>
                                {form.signature_data && <button onClick={clearSig} className="text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer text-red-400 hover:bg-red-500/10 border border-red-400/30">Clear</button>}
                              </div>
                            </div>

                            {sigMode === "draw" ? (
                              <canvas
                                ref={canvasRef}
                                width={600} height={140}
                                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                                className={`w-full rounded-xl border cursor-crosshair bg-white ${isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]"} ${errors.signature_data ? "!border-red-500" : ""}`}
                                style={{ touchAction: "none" }}
                              />
                            ) : (
                              <div className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${errors.signature_data ? "!border-red-500" : (isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]")}`}>
                                <input
                                  type="file" accept="image/*" id="sig-upload"
                                  className="absolute inset-0 opacity-0 cursor-pointer"
                                  onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = ev => set("signature_data", ev.target?.result as string);
                                    reader.readAsDataURL(file);
                                  }}
                                />
                                {form.signature_data ? (
                                  <img src={form.signature_data} alt="Signature" className="max-h-20 mx-auto" />
                                ) : (
                                  <>
                                    <FaUpload className={`mx-auto text-2xl mb-2 ${textMuted}`} />
                                    <p className={`text-sm ${textMuted}`}>Click to upload signature image</p>
                                  </>
                                )}
                              </div>
                            )}
                            {errors.signature_data && <p className={errCls}>{errors.signature_data}</p>}
                          </div>
                        </div>
                      )}

                      {/* ══════════ STEP 6: Review & Submit ══════════ */}
                      {step === 6 && (
                        <div className="space-y-5">
                          <p className={sectionTitle}><FaCheckCircle className="inline mr-2" />Review & Confirm</p>

                          {/* Booking Info Card */}
                          <div className={`rounded-2xl border p-5 ${isDark ? "bg-[#121218] border-[#9E217B]/30 bg-gradient-to-r from-[#9E217B]/10 to-[#0A0A0F]" : "bg-gradient-to-r from-[#EBF5FB] to-[#F0E5F5] border-[#00AEEF]/30"}`}>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                              {[
                                { label: "Lead No.", val: `#${lead?.sr_no || lead?.id}` },
                                { label: "Applicant", val: form.primary_name },
                                { label: "Mobile", val: form.primary_mobile },
                                { label: "Property", val: `${form.property_type}, Flat ${form.flat_number}` },
                                { label: "Floor", val: form.floor_number },
                                { label: "Carpet Area", val: form.carpet_area ? `${form.carpet_area} sq.ft.` : "-" },
                                { label: "Agreement Value", val: form.agreement_value ? `₹${form.agreement_value}` : "-" },
                                { label: "Booking Amount", val: form.booking_amount ? `₹${form.booking_amount}` : "-" },
                                { label: "Booking Source", val: form.booking_source },
                                { label: "Date", val: form.application_date },
                              ].map(({ label, val }) => (
                                <div key={label}>
                                  <p className={`text-xs font-semibold mb-0.5 ${textMuted}`}>{label}</p>
                                  <p className={`font-bold ${textMain}`}>{val || "-"}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Summary sections */}
                          {[
                            { title: "Primary Applicant", rows: [["Name", form.primary_name], ["Mobile", form.primary_mobile], ["Email", form.primary_email], ["PAN", form.primary_pan], ["Aadhaar", form.primary_aadhaar], ["Occupation", form.primary_occupation], ["Nationality", form.primary_nationality]] },
                            ...form.joint_applicants.map((ja, idx) => ({
                              title: `Joint Applicant ${idx + 1}`,
                              rows: [["Name", ja.name], ["Mobile", ja.mobile], ["Email", ja.email], ["PAN", ja.pan], ["Aadhaar", ja.aadhaar]]
                            })),
                            { title: "Residential Address", rows: [["Address", form.address], ["PIN", form.pin], ["State", form.state], ["Country", form.country]] },
                            { title: "Unit Details", rows: [["Apartment Name", form.apartment_name], ["Project Name", form.project_name], ["Tower", form.tower], ["Wing", form.wing], ["Type", form.property_type], ["Floor", form.floor_number], ["Flat No.", form.flat_number], ["Carpet Area", `${form.carpet_area} sq.ft.`], ["Consideration Value", form.consideration_value], ["Parking", form.parking_details], ["Witness", form.witness_name]] },
                          ].map(section => (
                            <div key={section.title} className={`rounded-xl border p-4 ${isDark ? "border-[#2A2A35] bg-[#121218]" : "border-[#E5E7EB] bg-white"}`}>
                              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>{section.title}</p>
                              <div className="grid grid-cols-2 gap-2">
                                {section.rows.filter(([, v]) => v).map(([k, v]) => (
                                  <div key={k}>
                                    <p className={`text-[10px] font-semibold ${textMuted}`}>{k}</p>
                                    <p className={`text-sm font-medium ${textMain}`}>{v || "-"}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}

                          {/* Cost Breakdown card */}
                          {toNumber(form.agreement_value) > 0 && (() => {
                            const cost = computeCostBreakdown(form);
                            const rows: [string, number][] = [
                              ["Agreement Value", cost.agreementValue],
                              [`GST (${cost.gstRate}%)`, cost.gstAmount],
                              ["Stamp Duty", cost.stampDuty],
                              ["Registration Fee", cost.registrationFee],
                              ["Legal Charges", cost.legalCharges],
                              ["Maintenance Deposit", cost.maintenanceDeposit],
                              ["Custom Charges", cost.customChargesTotal],
                            ];
                            return (
                              <div className={`rounded-xl border p-4 ${isDark ? "border-[#2A2A35] bg-[#121218]" : "border-[#E5E7EB] bg-white"}`}>
                                <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>Cost Breakdown</p>
                                {rows.filter(([, v]) => v > 0).map(([k, v]) => (
                                  <div key={k} className="flex items-center justify-between py-0.5">
                                    <span className={`text-xs ${textMuted}`}>{k}</span>
                                    <span className={`text-xs font-semibold ${textMain}`}>{formatINR(v)}</span>
                                  </div>
                                ))}
                                <div className={`flex items-center justify-between mt-2 pt-2 border-t ${divider}`}>
                                  <span className={`text-xs font-bold ${textMain}`}>Total Cost to Customer</span>
                                  <span className={`text-sm font-extrabold ${textMain}`}>{formatINR(cost.totalCost)}</span>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Loan summary card */}
                          {form.loan_required && (
                            <div className={`rounded-xl border p-4 ${isDark ? "border-[#2A2A35] bg-[#121218]" : "border-[#E5E7EB] bg-white"}`}>
                              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>Loan Summary</p>
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  ["Bank", form.bank_name],
                                  ["Loan Type", form.loan_type],
                                  ["Sanction Amount", form.sanction_amount ? formatINR(toNumber(form.sanction_amount)) : ""],
                                  ["Loan Status", form.loan_status],
                                  ["Interest Rate", form.interest_rate ? `${form.interest_rate}%` : ""],
                                  ["Tenure", form.loan_tenure_months ? `${form.loan_tenure_months} months` : ""],
                                  ["Pre-EMI", toNumber(form.pre_emi_amount) > 0 ? formatINR(toNumber(form.pre_emi_amount)) : ""],
                                  ["Full EMI", toNumber(form.emi_amount) > 0 ? formatINR(toNumber(form.emi_amount)) : ""],
                                  ["Payment Type", form.payment_type],
                                ].filter(([, v]) => v).map(([k, v]) => (
                                  <div key={k as string}>
                                    <p className={`text-[10px] font-semibold ${textMuted}`}>{k}</p>
                                    <p className={`text-sm font-medium ${textMain}`}>{v}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Possession card */}
                          {(form.expected_possession_date || form.possession_status !== "Pre-Construction" || form.oc_cc_status !== "Pending") && (
                            <div className={`rounded-xl border p-4 ${isDark ? "border-[#2A2A35] bg-[#121218]" : "border-[#E5E7EB] bg-white"}`}>
                              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>Possession</p>
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  ["Expected Possession", form.expected_possession_date],
                                  ["Possession Status", form.possession_status],
                                  ["OC / CC Status", form.oc_cc_status],
                                  ["OC / CC Date", form.oc_cc_date],
                                ].filter(([, v]) => v).map(([k, v]) => (
                                  <div key={k as string}>
                                    <p className={`text-[10px] font-semibold ${textMuted}`}>{k}</p>
                                    <p className={`text-sm font-medium ${textMain}`}>{v}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Payment table summary */}
                          {form.payment_details.some(r => r.amount) && (
                            <div className={`rounded-xl border p-4 ${isDark ? "border-[#2A2A35] bg-[#121218]" : "border-[#E5E7EB] bg-white"}`}>
                              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>Payment Details</p>
                              <table className="w-full text-sm">
                                <thead><tr className={isDark ? "text-[#888899]" : "text-[#6B7280]"}><th className="text-left text-xs py-1">Date</th><th className="text-left text-xs py-1">Transaction</th><th className="text-right text-xs py-1">Amount</th></tr></thead>
                                <tbody>{form.payment_details.filter(r => r.amount).map((r, i) => (<tr key={i}><td className={`text-xs py-1 ${textMain}`}>{r.date}</td><td className={`text-xs py-1 ${textMain}`}>{r.transaction_type}</td><td className={`text-xs py-1 text-right font-bold ${textMain}`}>₹{r.amount}</td></tr>))}</tbody>
                              </table>
                            </div>
                          )}

                          {/* Declaration status */}
                          <div className={`rounded-xl border p-4 ${isDark ? "border-[#2A2A35] bg-[#121218]" : "border-[#E5E7EB] bg-white"}`}>
                            <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>Declarations</p>
                            {[["Information accurate", form.declaration_accepted], ["Terms & Conditions accepted", form.terms_accepted], ["Irrevocable consent given", form.consent_accepted]].map(([label, val]) => (
                              <div key={label as string} className="flex items-center gap-2 mb-1.5">
                                <div className={`w-4 h-4 rounded flex items-center justify-center text-[9px] ${val ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>{val ? "✓" : "✗"}</div>
                                <span className={`text-sm ${textMain}`}>{label as string}</span>
                              </div>
                            ))}
                            {form.signature_data && (
                              <div className="mt-3">
                                <p className={`text-xs font-semibold mb-1 ${textMuted}`}>Signature</p>
                                <img src={form.signature_data} alt="Signature" className="max-h-16 border rounded-lg p-1" style={{ borderColor: isDark ? "#2A2A35" : "#E5E7EB" }} />
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* ── Footer ── */}
                <div className={`flex items-center justify-between px-6 py-4 border-t flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
                  <button
                    onClick={prevStep}
                    disabled={step === 1}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${btnSecondary}`}
                  >
                    <FaChevronLeft className="text-xs" /> Back
                  </button>

                  <span className={`text-xs font-semibold ${textMuted}`}>Step {step} of 6</span>

                  {step < 6 ? (
                    <button
                      onClick={nextStep}
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors cursor-pointer shadow-md ${btnPrimary}`}
                    >
                      Next <FaChevronRight className="text-xs" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSubmit}
                      disabled={isSubmitting}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors cursor-pointer shadow-md disabled:opacity-60 disabled:cursor-not-allowed ${isDark ? "bg-green-600 hover:bg-green-500 text-white" : "bg-green-600 hover:bg-green-500 text-white"}`}
                    >
                      {isSubmitting ? "Saving..." : <><FaCheck className="text-xs" /> Save Booking</>}
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
