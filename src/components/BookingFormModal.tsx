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
import { formatCurrencyDisplay, formatCurrencyDecimal, toStorageValue } from "@/lib/currency";
// Single definition of how a GST rate is resolved and applied — see lib/gst.ts
// for why `|| 5` could not express "default when absent" for a field whose zero
// is meaningful.
import { resolveGstRate, calcGstAmount, parseGstRate, GST_RATE_PRESETS } from "@/lib/gst";
import {
  resolveStampDutyRate, resolveRegistrationFeeRate, calcStampDuty, parseRatePercent,
  STAMP_DUTY_RATE_PRESETS,
} from "@/lib/charges";
import LoanDealForm from "@/components/LoanDealForm";
import { buildTheme } from "@/lib/crmTheme";
import { useFinancialStatus, canOverride } from "@/components/FinancialPositionCard";
import TrancheOverrideModal from "@/components/TrancheOverrideModal";
// Reused so the inline rate field enforces exactly what the CP Master enforces —
// 0-100 and at most 2dp, matching NUMERIC(5,2).
import { validateRate } from "./ChannelPartnerFormModal";
import UnitPicker, { type PickableUnit, unitLabel } from "./UnitPicker";

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
  // CP commission intent — recorded against the partner when the booking saves.
  cp_commission_mode: "auto" | "manual" | "none";
  cp_commission_amount: string; cp_commission_reason: string;
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
  // Stamp Duty & Registration Fee (split) — like GST, the RATE is the stored
  // thing and the amount is derived from agreement_value × rate. Both rates are
  // bare percentage strings ("5", "4", "0.5"), same shape as gst_rate; the
  // Maharashtra defaults are applied only when no rate was ever chosen.
  // The rest are captured manually as they are paid.
  stamp_duty_rate: string;
  stamp_duty_amount: string; stamp_duty_paid_date: string; stamp_duty_status: string;
  stamp_duty_payment_mode: string; stamp_duty_receipt_no: string;
  registration_fee_rate: string;
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
//   • Revenue counts an item only if it is BOTH actually received/completed AND
//     explicitly marked "Include in Revenue". Nothing is auto-counted.
//   • "Received" is auto-derived from the item's own date/status fields.
//   • Loan Sanction is informational (bank approval, not cash) — it never sits
//     in Scheduled Receivables and only reaches Revenue if management opts in.
//   • Scheduled Receivables = money entered but not yet received (future income).
//     It is shown separately and never reduces Balance Receivable.
type RevenueItemKey = "ocr" | "sdr" | "cash" | "sanction" | "disbursement";
type RevenueFlagKey =
  | "revenue_include_ocr" | "revenue_include_sdr" | "revenue_include_cash"
  | "revenue_include_sanction" | "revenue_include_disbursement";

interface RevenueItem {
  key: RevenueItemKey;
  label: string;
  amount: number;
  received: boolean;          // has the money actually arrived / milestone completed
  receivedLabel: string;      // wording for the status chip ("Received" / "Approved" …)
  informational: boolean;     // true = not a cash receipt (Loan Sanction)
  includeKey: RevenueFlagKey;
  included: boolean;
  countsAsRevenue: boolean;   // received && included
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
// Maharashtra defaults (GST 5%, Stamp Duty 5%). Registration Fee is not derived:
// it is entered directly, like Legal Charges and Custom Charges.
interface CostBreakdown {
  agreementValue: number; gstRate: number; gstAmount: number;
  stampDutyRate: number; registrationFeeRate: number;
  stampDuty: number; registrationFee: number;
  legalCharges: number; maintenanceDeposit: number; possessionCharges: number;
  customChargesTotal: number; totalCost: number;
  loanAmount: number; ownContributionRequired: number;
}

function autoGstAmount(agreementValue: number, rate: number) { return Math.round(agreementValue * rate / 100); }

function computeCostBreakdown(form: BookingFormData): CostBreakdown {
  const agreementValue = toNumber(form.agreement_value);
  const gstRate = resolveGstRate(form.gst_rate);
  // An explicitly entered ₹0 must survive. `toNumber(...) || autoGstAmount(...)`
  // read a genuine zero as "not set" and recomputed it at the default rate, so a
  // 0% booking still showed GST in the cost breakdown. Emptiness, not falsiness,
  // is what means "derive it".
  const enteredGstAmount = String(form.gst_amount ?? "").trim();
  const gstAmount = enteredGstAmount === ""
    ? calcGstAmount(agreementValue, gstRate)
    : toNumber(enteredGstAmount);
  // Stamp duty and registration fee follow exactly the same rule as GST above:
  // the rate is what's stored, the amount derives from it, and only an EMPTY
  // amount means "derive". A deliberately typed ₹0 is a real figure and survives.
  const stampDutyRate = resolveStampDutyRate(form.stamp_duty_rate);
  const enteredStampDuty = String(form.stamp_duty_amount ?? "").trim();
  const stampDuty = enteredStampDuty === ""
    ? calcStampDuty(agreementValue, stampDutyRate)
    : toNumber(enteredStampDuty);
  // Registration fee does NOT follow the GST / stamp duty rule above. It is typed
  // in directly, like Legal Charges and Custom Charges: never derived from
  // agreement value, never capped at ₹30,000. Empty or unparseable means ₹0 —
  // there is no percentage left to fall back to.
  //
  // The rate is still resolved and persisted so historic bookings keep whatever
  // rate they were saved with, but nothing computes from it any more.
  const registrationFeeRate = resolveRegistrationFeeRate(form.registration_fee_rate);
  const registrationFee = toNumber(form.registration_fee_amount);
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
    agreementValue, gstRate, gstAmount,
    stampDutyRate, registrationFeeRate, stampDuty, registrationFee,
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
    // Default to auto for CP-sourced bookings; nothing is recorded for direct ones.
    cp_commission_mode: lead?.source === "Channel Partner" ? "auto" : "none",
    cp_commission_amount: "",
    cp_commission_reason: "",

    // agreement_value seeds from the loan form's estimate-only field. That field
    // exists precisely so stamp duty / registration can be calculated before a
    // booking exists; when the booking is finally raised it is the best available
    // starting number, and it stays editable here.
    booking_date: today, agreement_value: draft.agreement_value_estimate || "", booking_amount: "", booking_remarks: "",
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
    // parseGstRate, not `||`: a draft saved with 0% arrives here as 0 or "0" and
    // must stay 0. gst_amount is left blank on purpose so the effect below
    // derives it from this rate.
    gst_rate: String(resolveGstRate(draft.gst_rate)),
    gst_amount: "", gst_paid: "", gst_status: "Pending",
    // Same "prefer the draft, fall back to the statutory default" rule as
    // gst_rate above. resolve*, not `||`: a draft saved at 0% arrives as 0 or
    // "0", which is falsy, and must not be reset to 5% / 1%.
    stamp_duty_rate: String(resolveStampDutyRate(draft.stamp_duty_rate)),
    registration_fee_rate: String(resolveRegistrationFeeRate(draft.registration_fee_rate)),
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
  // ── Edit-vs-create is decided HERE, not by the caller ───────────────────────
  //
  // The bug this fixes: the modal is opened from six places, and one of them —
  // "Mark Closing" — passes isEditMode=false / existingBooking=null
  // unconditionally. After a closed lead is REOPENED it leaves "Closing" status,
  // the Mark Closing button reappears, and clicking it opened this form in CREATE
  // mode even though a booking already existed. The form then showed defaults
  // instead of the saved booking and, on save, POSTed a SECOND
  // booking_applications row for the same lead. That had already happened in
  // production (lead 134 → bookings 15 and 17, both Confirmed).
  //
  // Trusting every call site to pass the right flags is what failed. So the modal
  // now looks the booking up itself: if the lead has one, this is an edit, no
  // matter what was passed in. `POST /api/booking-applications` also refuses a
  // duplicate server-side — this is the usable half, that is the guarantee.
  const [resolvedBooking, setResolvedBooking] = useState<any | null>(null);
  const [resolvingBooking, setResolvingBooking] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // The booking actually being edited, and whether we are editing at all.
  // Everything below reads these — never the raw props.
  const effBooking = existingBooking?.id ? existingBooking : resolvedBooking;
  const effEdit = !!effBooking?.id || !!isEditMode;

  useEffect(() => {
    if (!isOpen || !lead?.id) { setResolvedBooking(null); setResolveError(null); return; }
    // A caller that already handed us the booking has done the work.
    if (existingBooking?.id) { setResolvedBooking(null); setResolveError(null); return; }

    let cancelled = false;
    setResolvingBooking(true);
    setResolveError(null);
    (async () => {
      try {
        // view=summary: this only needs to know whether a live booking EXISTS and
        // what its id and status are. The default (full) response carries the
        // whole booking aggregate — every joined financial, loan and registration
        // field plus two aggregate views — to answer a yes/no question.
        const res = await fetch(`/api/booking-applications?lead_id=${lead.id}&view=summary`, { credentials: "include" });
        const json = await res.json();
        if (cancelled) return;
        // Cancelled bookings are not "the" booking — a lead whose booking was
        // cancelled may legitimately start a new one.
        const live = (json?.data || []).find(
          (b: any) => String(b.booking_status || "").toLowerCase() !== "cancelled",
        );
        setResolvedBooking(live ?? null);
      } catch (err: any) {
        // Fail LOUD, not open. Silently continuing in create mode is exactly how
        // the duplicate booking got written, so the form refuses to guess.
        if (!cancelled) setResolveError("Could not check whether this lead already has a booking. Close and retry.");
      } finally {
        if (!cancelled) setResolvingBooking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, lead?.id, existingBooking?.id]);

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
  // ── Step 2 unit selection (Phase 1) ─────────────────────────────────────────
  // The seven unit fields are still the things that get submitted — the server
  // contract is unchanged — but they are now normally filled BY picking a real
  // row out of inventory_units rather than typed. See UnitPicker.tsx for why.
  //
  // `manualUnitEntry` is the deliberate escape hatch: bookings for stock that
  // was never loaded into inventory, and every already-saved booking made
  // before this existed, still have to be editable. It is not a fallback for
  // "the picker failed" — it is an explicit operator choice.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<PickableUnit | null>(null);
  const [manualUnitEntry, setManualUnitEntry] = useState(false);
  // CP commission preview. Computed server-side (NUMERIC) rather than in JS so the
  // figure shown here is exactly what gets written on save.
  const [cpPreview, setCpPreview] = useState<any | null>(null);
  const [cpPreviewError, setCpPreviewError] = useState<string | null>(null);
  const [cpMaster, setCpMaster] = useState<any | null>(null);
  // Inline rate fix. A missing rate is the single most likely blocker here (every
  // partner discovered from lead intake starts without one), and sending the user
  // to another screen mid-booking loses the form. Settable in place instead.
  const [cpPreviewCode, setCpPreviewCode] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  // ── Loan-form prefill (Step 3) ──────────────────────────────────────────────
  // Agreement Value, GST Rate and Token Amount are all captured in the Loan &
  // Deal form's Section 8 before a booking exists. They are carried over here so
  // the operator isn't re-keying figures the sales manager already agreed.
  //
  // `loanPrefilled` marks which of the three are currently showing a carried-over
  // value; the hint under the field reads off it, and `set()` clears the flag on
  // the first edit. `touchedRef` is what makes the booking form's values win: once
  // a key is in it, no later prefill pass may overwrite it.
  const PREFILL_KEYS = ["agreement_value", "gst_rate", "token_amount",
    "stamp_duty_rate", "registration_fee_rate"] as const;
  const [loanPrefilled, setLoanPrefilled] = useState<Record<string, boolean>>({});
  const touchedRef = useRef<Set<string>>(new Set());
  // True when this open restored a sessionStorage draft. That draft is prior work
  // in *this* form — including whatever an earlier prefill pass put there — so the
  // on-open pass must leave it alone. (The loan-editor round trip still refreshes
  // it: that one is the operator asking for the new numbers.)
  const restoredDraftRef = useRef(false);
  // The drivers of every derived figure, as hydrated from a saved booking:
  // agreement value plus each of the three rates. While the live form still
  // matches all four, the derived-figures effect must not overwrite persisted
  // stamp duty / registration fee / GST amount. Null in create mode, where
  // deriving from the start is correct.
  const derivedBaselineRef = useRef<{ av: string; rate: string; sdRate: string; regRate: string } | null>(null);
  // ── FOE: derived financial state for THIS booking (Phase 4) ────────────────
  // Only meaningful for a saved booking — a new one has no row to derive from,
  // so no request is made and the OCR section stays fully editable.
  //
  // Read-only display + gating. This never changes what the form submits; the
  // server-side gate in PUT /api/booking-applications/[id] remains the actual
  // enforcement, and this is the version of it the operator can see.
  const foe = useFinancialStatus(isOpen && effEdit ? effBooking?.id ?? null : null);
  // Fail OPEN: a failed fetch must never stop a legitimate booking being saved.
  const ocrLocked = foe.obligation ? foe.obligation.canAcceptMoreOCR === false : false;
  const foeCriticals = foe.obligation?.validationErrors.filter(e => e.severity === "critical") ?? [];
  const [showTrancheOverride, setShowTrancheOverride] = useState(false);

  const [showLoanEditor, setShowLoanEditor] = useState(false);
  const [loanEditorUpdate, setLoanEditorUpdate] = useState<any>(null);
  const [loanEditorLoading, setLoanEditorLoading] = useState(false);

  // Lead objects reach this modal in two shapes: raw DB rows (snake_case, from the
  // receptionist/closed-lead paths) and the dashboard's mapped camelCase shape.
  // Accept both so attribution works regardless of which screen opened the form.
  const cpId: number | null = lead?.channel_partner_id ?? lead?.channelPartnerId ?? null;

  // Mirrors the server-side gate on PATCH /api/channel-partners/:id — the button is
  // hidden for roles the API would reject anyway.
  const canSetRate = ["admin", "sales manager", "sales_manager"]
    .includes((user?.role || "").trim().toLowerCase());

  const saveCpRate = async () => {
    const invalid = validateRate(rateInput);
    if (invalid) { setRateError(invalid); return; }
    setRateSaving(true); setRateError(null);
    try {
      const res = await fetch(`/api/channel-partners/${cpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_commission_rate: Number(rateInput),
          user_name: user?.name, user_role: user?.role, updated_by: user?.name,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setRateError(json.message || "Could not save rate."); return; }
      setCpMaster(json.data);
      setRateInput("");
      // Nudge the debounced preview so the calculated figure appears immediately.
      setForm(f => ({ ...f }));
    } catch (e: any) {
      setRateError(e?.message || "Could not save rate.");
    } finally { setRateSaving(false); }
  };

  // Prefill the CP name/contact from the partner master once the lead's partner is
  // known. The lead's own cp_name/cp_phone seed the form (see defaultForm), but the
  // master record is the canonical one — it carries the name the partner was first
  // registered under, and a phone even when the lead's copy is blank. Only fills
  // empty fields, so anything typed here is never overwritten.
  useEffect(() => {
    if (!cpId) { setCpMaster(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/channel-partners/${cpId}`);
        const json = await res.json();
        if (cancelled || !json.success) return;
        setCpMaster(json.data);
        setForm(f => ({
          ...f,
          channel_partner_name: f.channel_partner_name?.trim() ? f.channel_partner_name : (json.data.name || ""),
          channel_partner_contact: f.channel_partner_contact?.trim() ? f.channel_partner_contact : (json.data.phone || ""),
        }));
      } catch { /* prefill is a convenience; failure must not block the form */ }
    })();
    return () => { cancelled = true; };
  }, [cpId]);

  // Live commission preview, debounced. Fires on agreement value, mode, and manual
  // amount. Uses the partner-level preview because the booking row does not exist
  // yet — same engine arithmetic and same FY threshold query as the save path.
  useEffect(() => {
    const isCp = form.booking_source === "Channel Partner";
    const mode = form.cp_commission_mode;
    // Note "none" is NOT excluded: the commission is still calculated and shown so
    // the user can see what they are choosing not to record. Only the save is opted out of.
    if (!isCp || !cpId) { setCpPreview(null); setCpPreviewError(null); return; }

    const agreement = Number(String(form.agreement_value || "").replace(/[₹,\s]/g, ""));
    const manualAmt = Number(String(form.cp_commission_amount || "").replace(/[₹,\s]/g, ""));
    if (mode !== "manual" && !(agreement > 0)) { setCpPreview(null); setCpPreviewError(null); return; }
    if (mode === "manual" && !(manualAmt >= 0 && String(form.cp_commission_amount).trim() !== "")) {
      setCpPreview(null); setCpPreviewError(null); return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/cp-commissions/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelPartnerId: cpId,
            agreementValue: agreement || null,
            ...(mode === "manual" ? { overrideGross: manualAmt } : {}),
          }),
        });
        const json = await res.json();
        if (json.success) { setCpPreview(json.data); setCpPreviewError(null); setCpPreviewCode(null); }
        else {
          setCpPreview(null);
          setCpPreviewError(json.message || "Could not calculate commission.");
          setCpPreviewCode(json.code || null);
        }
      } catch {
        setCpPreview(null); setCpPreviewError("Could not calculate commission."); setCpPreviewCode(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [cpId, form.booking_source, form.cp_commission_mode, form.agreement_value, form.cp_commission_amount]);
  const [sigMode, setSigMode] = useState<"draw" | "upload">("draw");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const termsRef = useRef<HTMLDivElement>(null);

  // Load draft from sessionStorage
  useEffect(() => {
    if (!isOpen || !lead?.id) return;
    // Wait for the booking lookup. Hydrating from defaults first and correcting
    // afterwards is the race in §10 — the operator would see (and could start
    // editing) blank fields that then jump.
    if (resolvingBooking) return;

    const key = `booking_draft_${lead.id}`;
    const stored = sessionStorage.getItem(key);
    // Fresh open → nothing is "touched" or "prefilled" yet.
    touchedRef.current = new Set();
    setLoanPrefilled({});
    if (effEdit && effBooking) {
      // Map existing DB fields to form state
      const initialForm = defaultForm(lead);
      const safeBooking: any = {};
      // Only null/undefined fall through to the default. A persisted 0, false or
      // "" is a real saved value and must survive — this is the `||` hazard in §9,
      // and it is why the test is `!== null && !== undefined` rather than truthiness.
      Object.keys(effBooking).forEach(k => {
        if (effBooking[k] !== null && effBooking[k] !== undefined) {
          safeBooking[k] = effBooking[k];
        }
      });
      // ── Date normalisation ────────────────────────────────────────────────
      // PostgreSQL returns DATE columns as ISO timestamps ("2026-07-24T00:00:00.000Z")
      // which HTML <input type="date"> cannot display — it requires "YYYY-MM-DD".
      // We normalise every date field here so the form always receives the
      // correct format regardless of which API endpoint fed existingBooking.
      DATE_FIELDS.forEach(key => {
        const raw = safeBooking[key] ?? effBooking[key];
        if (raw !== null && raw !== undefined) {
          safeBooking[key] = toDateStr(raw);
        }
      });

      // NUMERIC columns arrive as strings with scale ("5.00", "25000.00").
      // Left as-is the GST rate box shows "5.00" and every money input shows a
      // trailing ".00", so an untouched form looks edited. Trim the scale without
      // changing the value — 0 stays 0.
      const trimNum = (v: any) => {
        const s = String(v ?? "").trim();
        if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return v;
        return String(Number(s));
      };
      ["gst_rate", "gst_amount", "gst_paid", "agreement_value", "booking_amount",
        "stamp_duty_rate", "registration_fee_rate",
        "stamp_duty_amount", "registration_fee_amount", "legal_charges",
        "maintenance_deposit", "possession_charges", "token_amount", "ocr_amount",
        "sdr_amount", "cash_component", "loan_amount", "sanction_amount",
        "disbursement_amount", "expected_disbursement_amount", "interest_rate",
        "loan_tenure_months", "pre_emi_amount", "emi_amount", "carpet_area",
      ].forEach(k => { if (safeBooking[k] !== undefined) safeBooking[k] = trimNum(safeBooking[k]); });

      // custom_charges comes back from the shared SELECT as a JSON array of
      // {charge_name, amount, remarks}. Restore each row individually (§5) rather
      // than a single total — three saved charges must reopen as three editable rows.
      const rawCharges = safeBooking.custom_charges;
      const parsedCharges = typeof rawCharges === "string"
        ? (() => { try { return JSON.parse(rawCharges); } catch { return null; } })()
        : rawCharges;
      const custom_charges = Array.isArray(parsedCharges)
        ? parsedCharges.map((c: any) => ({
          charge_name: String(c?.charge_name ?? ""),
          amount: trimNum(c?.amount ?? ""),
          remarks: String(c?.remarks ?? ""),
        }))
        : initialForm.custom_charges;

      const hydrated = {
        ...initialForm,
        ...safeBooking,
        custom_charges,
        joint_applicants: typeof safeBooking.joint_applicants === 'string' ? JSON.parse(safeBooking.joint_applicants) : (safeBooking.joint_applicants || initialForm.joint_applicants),
        payment_details: typeof safeBooking.payment_details === 'string' ? JSON.parse(safeBooking.payment_details) : (safeBooking.payment_details || initialForm.payment_details),
        // A booking saved before stamp_duty_rate / registration_fee_rate existed
        // has NULL in those columns, and the spread above would put that NULL
        // straight into the form — the rate input renders blank and the amount
        // derives at nothing. resolve* turns absent back into the statutory
        // default while leaving a genuinely stored 0 alone.
        stamp_duty_rate: String(resolveStampDutyRate(safeBooking.stamp_duty_rate)),
        registration_fee_rate: String(resolveRegistrationFeeRate(safeBooking.registration_fee_rate)),
      };
      setForm(hydrated);

      // Freeze the derived-figures effect at exactly these drivers. Until the
      // operator changes agreement value or one of the three rates, the persisted
      // stamp duty / registration fee / GST amount must not be recomputed over — see §10.
      derivedBaselineRef.current = {
        av: String(hydrated.agreement_value ?? ""),
        rate: String(hydrated.gst_rate ?? ""),
        sdRate: String(hydrated.stamp_duty_rate ?? ""),
        regRate: String(hydrated.registration_fee_rate ?? ""),
      };
      restoredDraftRef.current = false;
    } else if (stored) {
      let restored = true;
      try { setForm(JSON.parse(stored)); } catch { setForm(defaultForm(lead)); restored = false; }
      restoredDraftRef.current = restored;
    } else {
      setForm(defaultForm(lead));
      derivedBaselineRef.current = null;
      restoredDraftRef.current = false;
    }
    setStep(1); setErrors({}); setTermsScrolled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lead?.id, resolvingBooking, effBooking?.id, effEdit]);

  // Save draft on form change.
  //
  // CREATE MODE ONLY. The draft exists to protect unsaved work on a NEW booking.
  // Writing it in edit mode put a full copy of a saved booking into
  // sessionStorage under the same per-lead key, which a later create-mode open
  // would then restore — resurrecting stale figures into what should be a blank
  // form. The database is the source of truth for a saved booking; a draft is not.
  useEffect(() => {
    if (!isOpen || !lead?.id || effEdit) return;
    sessionStorage.setItem(`booking_draft_${lead.id}`, JSON.stringify(form));
  }, [form, isOpen, lead?.id, effEdit]);

  // Auto-fill value in words
  useEffect(() => {
    if (form.consideration_value) {
      const words = numberToWords(form.consideration_value.replace(/[₹,]/g, ""));
      if (words) setForm(f => ({ ...f, consideration_value_words: words }));
    }
  }, [form.consideration_value]);

  // Auto-compute GST / Stamp Duty from agreement value.
  // These are "Est." fields — always kept in sync so they never drift.
  //
  // Registration fee is deliberately NOT in here any more. It is now typed in
  // directly, so deriving it from agreement value would overwrite the operator's
  // figure on every keystroke in Agreement Value — the exact silent-overwrite
  // this effect's own freeze logic below was written to prevent.
  useEffect(() => {
    const av = toNumber(form.agreement_value);
    const rate = resolveGstRate(form.gst_rate);
    const gst = String(calcGstAmount(av, rate));
    const stamp = String(calcStampDuty(av, resolveStampDutyRate(form.stamp_duty_rate)));

    // ── Do not recompute over persisted figures on load (§10, §14) ────────────
    //
    // This effect used to run unconditionally, including on the pass triggered by
    // hydrating a saved booking. So opening an existing booking replaced its
    // stored stamp duty and registration fee with the Maharashtra auto-estimate,
    // and saving then wrote that estimate back over the real numbers — a silent
    // overwrite of figures somebody had entered deliberately.
    //
    // The baseline is set at hydration. While the drivers still match it, the
    // operator has not changed anything, so persisted values are left alone and
    // only genuinely EMPTY derived fields are filled in. The moment agreement
    // value or a rate actually changes, the baseline stops matching and the
    // figures derive normally again.
    //
    // Frozen is evaluated PER FIGURE, not once for both. Each amount has its
    // own rate driver now, and a shared flag would mean nudging the stamp duty
    // rate also unfroze — and so silently recomputed — the persisted GST amount.
    // Agreement value is a driver of both, so it unfreezes both.
    const baseline = derivedBaselineRef.current;
    const avFrozen = !!baseline && baseline.av === String(form.agreement_value ?? "");
    const gstFrozen = avFrozen && baseline!.rate === String(form.gst_rate ?? "");
    const stampFrozen = avFrozen && baseline!.sdRate === String(form.stamp_duty_rate ?? "");

    setForm(f => {
      const blank = (v: any) => String(v ?? "").trim() === "";
      const nextGst = gstFrozen && !blank(f.gst_amount) ? f.gst_amount : gst;
      const nextStamp = stampFrozen && !blank(f.stamp_duty_amount) ? f.stamp_duty_amount : stamp;
      return f.gst_amount === nextGst && f.stamp_duty_amount === nextStamp
        ? f
        : { ...f, gst_amount: nextGst, stamp_duty_amount: nextStamp };
    });
  }, [form.agreement_value, form.gst_rate, form.stamp_duty_rate]);

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
    // Any write through `set` counts as the booking form owning that field from
    // now on — a later prefill pass must not overwrite it.
    touchedRef.current.add(key as string);
    setLoanPrefilled(p => (p[key as string] ? { ...p, [key as string]: false } : p));
    setForm(f => ({ ...f, [key]: val }));
    setErrors(e => { const ne = { ...e }; delete ne[key]; return ne; });
  }, []);

  // ── Unit selection plumbing (Phase 1) ───────────────────────────────────────
  // The seven form keys that describe the flat. Kept as one list so applying a
  // picked unit, clearing it, and the read-only rendering below can never drift
  // apart on which fields the picker owns.
  // apartment_name is not here: it is retired from both the booking form and
  // inventory, so the picker neither reads nor writes it.
  const UNIT_KEYS = ["project_name", "tower", "wing",
    "property_type", "floor_number", "flat_number", "carpet_area"] as const;

  // Copy the chosen row's values in VERBATIM. That exactness is the whole point:
  // syncBookingUnit() re-matches this text against inventory_units by string key,
  // so anything reformatted here would fail to match and silently fork a new unit.
  const applyUnit = useCallback((u: PickableUnit) => {
    setSelectedUnit(u);
    setManualUnitEntry(false);
    setPickerOpen(false);
    setForm(f => ({
      ...f,
      project_name: u.project_name || "",
      tower: u.tower || "",
      wing: u.wing || "",
      property_type: u.unit_type || "",
      floor_number: String(u.floor ?? ""),
      carpet_area: u.carpet_area_sqft == null || String(u.carpet_area_sqft).trim() === ""
        ? "" : String(Number(u.carpet_area_sqft)),
      flat_number: u.flat_no || "",
    }));
    UNIT_KEYS.forEach(k => touchedRef.current.add(k));
    setErrors(e => {
      const ne = { ...e };
      UNIT_KEYS.forEach(k => delete ne[k as keyof BookingFormData]);
      return ne;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detach the booking from its inventory row and blank the fields, so the next
  // choice starts clean rather than leaving half of a previous flat behind.
  const clearUnit = useCallback(() => {
    setSelectedUnit(null);
    setForm(f => {
      const next = { ...f };
      UNIT_KEYS.forEach(k => { (next as any)[k] = ""; });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile an already-saved booking back to its inventory row on open, so
  // editing one shows the linked unit instead of an empty picker. A booking whose
  // flat is not in inventory (pre-inventory stock, or a phantom created by the old
  // free-text path) legitimately has no match — that drops to manual entry rather
  // than nagging the operator to re-pick something that does not exist.
  const unitResolvedRef = useRef(false);
  useEffect(() => { if (!isOpen) unitResolvedRef.current = false; }, [isOpen]);
  useEffect(() => {
    if (!isOpen || unitResolvedRef.current) return;
    const flat = String(form.flat_number || "").trim();
    if (!flat) return;
    unitResolvedRef.current = true;

    const norm = (v: any) => String(v ?? "").trim().toLowerCase();
    const floorOf = (v: any) => {
      const s = String(v ?? "").trim().toLowerCase();
      if (s === "g" || s === "gf" || s === "grd" || s.startsWith("ground")) return 0;
      const m = s.match(/-?\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    };

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inventory?limit=500&search=${encodeURIComponent(flat)}`, { credentials: "include" });
        const json = await res.json();
        if (cancelled || !json?.success) return;
        // Same five-part key the server matches on (lib/inventorySync.ts).
        const match = (json.data as PickableUnit[]).find(u =>
          norm(u.flat_no) === norm(form.flat_number) &&
          norm(u.project_name) === norm(form.project_name) &&
          norm(u.tower) === norm(form.tower) &&
          norm(u.wing) === norm(form.wing) &&
          u.floor === floorOf(form.floor_number)
        );
        if (match) setSelectedUnit(match);
        else setManualUnitEntry(true);
      } catch {
        // Inventory unreachable — fall back to the fields the booking already
        // has rather than blocking an edit on a lookup that is only cosmetic.
        if (!cancelled) setManualUnitEntry(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, form.flat_number]);

  // Carries Agreement Value / GST Rate / Token Amount over from the Loan & Deal
  // form's Section-8 draft (walkin_enquiries.loan_tracking_info) — the same
  // source defaultForm() reads, refetched so the modal reflects edits made after
  // the parent screen last loaded this lead.
  //
  // `force` is the return-from-loan-editor path: the operator just changed these
  // numbers deliberately, so untouched fields are refreshed rather than only
  // filled. In edit mode a saved booking's agreement value is a registered
  // figure, never an estimate, so there force still only fills blanks.
  const applyLoanPrefill = useCallback(async (opts?: { force?: boolean }) => {
    if (!lead?.id) return;
    const force = !!opts?.force;
    try {
      const res = await fetch(`/api/walkin_enquiries/${lead.id}`);
      const json = await res.json().catch(() => ({}));
      if (!json?.success) return;
      const draft = parseLoanTrackingDraft(json.data);

      const incoming: Partial<Record<typeof PREFILL_KEYS[number], string>> = {};
      if (String(draft.agreement_value_estimate ?? "").trim() !== "") incoming.agreement_value = String(draft.agreement_value_estimate);
      if (String(draft.gst_rate ?? "").trim() !== "") incoming.gst_rate = String(resolveGstRate(draft.gst_rate));
      if (String(draft.token_amount ?? "").trim() !== "") incoming.token_amount = String(draft.token_amount);
      if (String(draft.stamp_duty_rate ?? "").trim() !== "") incoming.stamp_duty_rate = String(resolveStampDutyRate(draft.stamp_duty_rate));
      if (String(draft.registration_fee_rate ?? "").trim() !== "") incoming.registration_fee_rate = String(resolveRegistrationFeeRate(draft.registration_fee_rate));
      if (Object.keys(incoming).length === 0) return;

      // A Set, not an array: the updater below can be invoked more than once for a
      // single update (React StrictMode), and re-applying the same keys must not
      // change the outcome.
      const applied = new Set<string>();
      setForm(f => {
        const nextForm = { ...f };
        PREFILL_KEYS.forEach(k => {
          if (incoming[k] === undefined) return;
          if (touchedRef.current.has(k)) return;
          const current = String(f[k] ?? "").trim();
          if (k === "gst_rate" || k === "stamp_duty_rate" || k === "registration_fee_rate") {
            // Never blank — defaultForm always resolves a rate — so "is it empty"
            // can't gate it. Untouched means the form still holds a default the
            // operator never chose, which the loan form's rate should replace.
            if (current === incoming[k]) return;
          } else if (current !== "" && !(force && !effEdit)) {
            return;
          }
          nextForm[k] = incoming[k] as string;
          applied.add(k);
        });
        return applied.size ? nextForm : f;
      });
      if (applied.size) {
        setLoanPrefilled(p => {
          const next = { ...p };
          applied.forEach(k => { next[k] = true; });
          return next;
        });
      }
    } catch { /* prefill is a convenience; failure must never block the form */ }
  }, [lead?.id, effEdit]);

  // effEdit, not isEditMode: a saved booking's own figures outrank the loan
  // form's pre-booking estimates, and a reopened lead reaches here with
  // isEditMode=false. Without this the estimate would overwrite the agreed value.
  useEffect(() => {
    if (!isOpen || !lead?.id || effEdit || resolvingBooking) return;
    if (restoredDraftRef.current) return;
    applyLoanPrefill();
  }, [isOpen, lead?.id, effEdit, resolvingBooking, applyLoanPrefill]);

  const openLoanEditor = useCallback(async () => {
    setShowLoanEditor(true);
    setLoanEditorLoading(true);
    try {
      const res = await fetch(`/api/loan?lead_id=${lead?.id}&latest=1`);
      const json = await res.json().catch(() => ({}));
      const rows = json?.success ? (json.data || json.updates || []) : [];
      setLoanEditorUpdate(Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null);
    } catch { setLoanEditorUpdate(null); }
    finally { setLoanEditorLoading(false); }
  }, [lead?.id]);

  const prefillHint = (key: string) =>
    loanPrefilled[key] ? (
      <p className={`text-[10px] mt-1 ${textMuted}`}>Prefilled from Loan Form — you can edit</p>
    ) : null;

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
      // Only send a commission intent for CP-sourced bookings that have a partner
      // on the lead; otherwise the server records nothing.
      formData.append(
        "cp_commission_mode",
        form.booking_source === "Channel Partner" && cpId ? form.cp_commission_mode : "none"
      );
      formData.append("cp_commission_amount", form.cp_commission_amount);
      formData.append("cp_commission_reason", form.cp_commission_reason);
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
      formData.append("stamp_duty_rate", form.stamp_duty_rate);
      formData.append("registration_fee_rate", form.registration_fee_rate);
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

      // effEdit/effBooking, not the props: a reopened lead reaches this form with
      // isEditMode=false but a real booking behind it, and POSTing there is what
      // created duplicate bookings.
      const res = await fetch(effEdit && effBooking?.id ? `/api/booking-applications/${effBooking.id}` : "/api/booking-applications", {
        method: effEdit && effBooking?.id ? "PUT" : "POST",
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
    // Every direct child of AnimatePresence needs its own stable key — it tracks
    // children by key to run exit animations, and keyless siblings all collapse to
    // the same empty key. Four overlays can be mounted at once (form, unit picker,
    // tranche override, loan editor), so each is named explicitly.
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="booking-form"
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
            className={`w-full max-w-3xl max-h-[92vh] flex flex-col rounded-4xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#0D0D12] border-[#2A2A35]" : "bg-white border-[#9CA3AF]"}`}
          >
            {/* ── Header ── */}
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
              <div>
                {confirmedBooking ? (
                  <h2 className={`text-lg font-bold ${textMain}`}>Booking Confirmed</h2>
                ) : (
                  <>
                    <h2 className={`text-lg font-bold ${textMain}`}>
                      {effEdit ? "Edit Booking Application" : "Booking Application Form"}
                    </h2>
                    <p className={`text-xs mt-0.5 ${textMuted}`}>
                      Lead #{lead?.sr_no || lead?.id} — {lead?.name}
                      {/* Says out loud which record is being changed, so a reopened
                          lead can never look like it is starting a fresh booking. */}
                      {effEdit && effBooking?.booking_number && (
                        <span className="ml-1">· editing {effBooking.booking_number}</span>
                      )}
                    </p>
                  </>
                )}
              </div>
              <button onClick={handleClose} className={`p-2 rounded-xl transition-colors cursor-pointer ${isDark ? "text-[#888899] hover:bg-[#1C1C2A] hover:text-white" : "text-[#6B7280] hover:bg-[#F1F5F9]"}`}>
                <FaTimes />
              </button>
            </div>

            {/* ── Booking lookup gate ──
                The form must not render defaults while we are still finding out
                whether this lead already has a booking. Showing an empty form for
                a moment invites the operator to start typing into fields that are
                about to be replaced by hydrated values. */}
            {(resolvingBooking || resolveError) && !confirmedBooking ? (
              <div className={`flex-1 flex items-center justify-center p-10 ${bg}`}>
                {resolveError ? (
                  <div className="text-center max-w-sm">
                    <p className="text-red-500 text-sm font-semibold mb-1">{resolveError}</p>
                    <p className={`text-xs ${textMuted}`}>
                      The form stays closed rather than risk creating a second booking for this lead.
                    </p>
                  </div>
                ) : (
                  <p className={`text-sm italic ${textMuted}`}>Checking for an existing booking…</p>
                )}
              </div>
            ) : confirmedBooking ? (
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

                            {/* ── Unit selection (Phase 1) ──
                                Picking a real inventory row instead of typing the flat is what
                                keeps booking_applications and inventory_units in step: the server
                                re-matches these fields by exact string key, so typed text could
                                silently fork a duplicate unit. */}
                            {!manualUnitEntry && (
                              <div className={`mb-4 rounded-xl border p-4 ${selectedUnit
                                ? (isDark ? "border-emerald-500/40 bg-emerald-500/5" : "border-emerald-500/40 bg-emerald-50")
                                : (isDark ? "border-[#2A2A35] bg-[#14141B]" : "border-[#9CA3AF] bg-[#F8FAFC]")}`}>
                                {selectedUnit ? (
                                  <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div className="min-w-0">
                                      <p className={`text-[10px] font-bold uppercase tracking-wider ${textMuted}`}>Linked inventory unit</p>
                                      <p className={`text-sm font-bold truncate ${textMain}`}>{unitLabel(selectedUnit)}</p>
                                      <p className={`text-[11px] truncate ${textMuted}`}>
                                        {selectedUnit.project_name}
                                        {selectedUnit.unit_type ? ` · ${selectedUnit.unit_type}` : ""}
                                        {form.carpet_area ? ` · ${form.carpet_area} sq.ft.` : ""}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <button type="button" onClick={() => setPickerOpen(true)}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#00AEEF] text-white">
                                        Change Unit
                                      </button>
                                      <button type="button" onClick={clearUnit}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${isDark ? "border-[#2A2A35] text-[#888899]" : "border-[#9CA3AF] text-[#475569]"}`}>
                                        Clear
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-4 flex-wrap">
                                    <div>
                                      <p className={`text-sm font-bold ${textMain}`}>No unit selected</p>
                                      <p className={`text-[11px] ${textMuted}`}>Choose the flat from inventory so it is reserved against this booking.</p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <button type="button" onClick={() => setPickerOpen(true)}
                                        className="px-4 py-2 rounded-lg text-xs font-bold bg-[#00AEEF] text-white">
                                        Select Unit
                                      </button>
                                      <button type="button" onClick={() => setManualUnitEntry(true)}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold border ${isDark ? "border-[#2A2A35] text-[#888899]" : "border-[#9CA3AF] text-[#475569]"}`}>
                                        Enter manually
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {manualUnitEntry && (
                              <div className={`mb-4 rounded-xl border p-3 flex items-center justify-between gap-4 flex-wrap ${isDark ? "border-amber-500/40 bg-amber-500/5" : "border-amber-500/40 bg-amber-50"}`}>
                                <p className={`text-[11px] ${textMuted}`}>
                                  <span className="font-bold text-amber-500">Manual entry.</span>{" "}
                                  This flat will be matched to inventory by name — a mismatch creates a new unit rather than reserving an existing one.
                                </p>
                                <button type="button" onClick={() => { setManualUnitEntry(false); setPickerOpen(true); }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#00AEEF] text-white flex-shrink-0">
                                  Pick from inventory
                                </button>
                              </div>
                            )}

                            {/* The fields themselves are unchanged in shape and still what gets
                                submitted — they are just locked while a real unit is linked, so
                                the text cannot drift away from the row it has to match. */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                              {[
                                // Temporarily hidden — to be re-enabled later
                                // { key: "apartment_name", label: "Apartment Name", placeholder: "Bhoomi Heights" },
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
                                    readOnly={!!selectedUnit}
                                    className={`${inputCls} ${errors[key as keyof BookingFormData] ? "!border-red-500" : ""} ${selectedUnit ? "opacity-70 cursor-not-allowed" : ""}`}
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
                                    readOnly={!!selectedUnit}
                                    className={`${inputCls} ${errors[key as keyof BookingFormData] ? "!border-red-500" : ""} ${selectedUnit ? "opacity-70 cursor-not-allowed" : ""}`}
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
                          {/* ── FOE: critical issues on this booking ──
                              Compact by design: the full explanation lives on the
                              Loan Overview, and repeating four banners here would
                              bury the form. */}
                          {foeCriticals.length > 0 && (
                            <button
                              type="button"
                              onClick={onClose}
                              className="w-full text-left rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              ⚠️ Financial issues detected on this booking. View Loan Overview for details.
                            </button>
                          )}
                          {foe.error && (
                            <p className={`text-[10px] ${textMuted}`}>
                              Could not load financial status. OCR limits not enforced.
                            </p>
                          )}

                          {/* ── Section 1: Booking & Agreement ── */}
                          <div>
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <p className={sectionTitle}><FaMoneyBillWave className="inline mr-2" />Booking &amp; Agreement</p>
                              {/* Agreement Value, GST and Token all originate in the Loan & Deal
                                  form. Editing them at source without losing this form is the
                                  point — the overlay keeps the booking form mounted. */}
                              <button
                                type="button"
                                onClick={openLoanEditor}
                                className={`text-[11px] font-bold underline underline-offset-2 mb-2 ${accent}`}
                              >
                                Edit Loan Details
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Booking Date</label>
                                <input type="date" value={form.booking_date} onChange={e => set("booking_date", e.target.value)} className={`${inputCls} ${errors.booking_date ? "!border-red-500" : ""}`} />
                                {errors.booking_date && <p className={errCls}>{errors.booking_date}</p>}
                              </div>
                              <div>
                                <label className={labelCls}>Agreement Value <span className="font-normal opacity-70">(editable)</span></label>
                                <IndianCurrencyInput value={form.agreement_value} onChange={val => set("agreement_value", val)} placeholder="50,00,000" className={`${inputCls} ${errors.agreement_value ? "!border-red-500" : ""}`} />
                                {errors.agreement_value && <p className={errCls}>{errors.agreement_value}</p>}
                                {prefillHint("agreement_value")}
                              </div>
                              <div>
                                <label className={labelCls}>Booking Amount</label>
                                <IndianCurrencyInput value={form.booking_amount} onChange={val => set("booking_amount", val)} placeholder="1,00,000" className={`${inputCls} ${errors.booking_amount ? "!border-red-500" : ""}`} disabled={ocrLocked} />
                                {errors.booking_amount && <p className={errCls}>{errors.booking_amount}</p>}
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Token Amount <span className="font-normal opacity-70">(part of Booking Amount)</span></label>
                                <IndianCurrencyInput value={form.token_amount} onChange={val => set("token_amount", val)} placeholder="50,000" className={inputCls} disabled={ocrLocked} />
                                {prefillHint("token_amount")}
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
                              // Percentage-driven row: preset buttons + free numeric entry + the
                              // live derived amount. Factored out because Stamp Duty and
                              // Registration Fee are the same control with different presets —
                              // GST keeps its inline markup above since it also carries the
                              // rate-error affordances.
                              const RateRow = ({
                                label, presets, presetTitle, rate, onRate, ariaLabel, placeholder,
                                step = 0.5, value, prefilled,
                              }: {
                                label: string;
                                presets: readonly number[];
                                presetTitle: (p: number) => string;
                                rate: string;
                                onRate: (v: string) => void;
                                ariaLabel: string;
                                placeholder: string;
                                step?: number;
                                value: number;
                                prefilled?: boolean;
                              }) => (
                                <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b ${divider}`}>
                                  <span className={`text-xs ${textMuted} flex items-center gap-2 flex-wrap`}>
                                    {label}
                                    <span className="flex gap-1">
                                      {presets.map(p => {
                                        const active = parseRatePercent(rate) === p;
                                        return (
                                          <button
                                            key={p}
                                            type="button"
                                            onClick={() => onRate(String(p))}
                                            title={presetTitle(p)}
                                            className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${active
                                              ? "bg-[#9E217B] border-[#9E217B] text-white"
                                              : `${textMuted} ${isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]"} hover:border-[#9E217B]/50`
                                              }`}
                                          >
                                            {p}%
                                          </button>
                                        );
                                      })}
                                    </span>
                                    <span className="relative">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        min={0}
                                        max={100}
                                        step={step}
                                        value={rate}
                                        onChange={e => onRate(e.target.value)}
                                        placeholder={placeholder}
                                        aria-label={ariaLabel}
                                        className={`w-16 rounded-md pl-1.5 pr-4 py-0.5 text-xs outline-none border ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white" : "bg-white border-[#9CA3AF] text-[#1A1A1A]"}`}
                                      />
                                      <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${textMuted}`}>%</span>
                                    </span>
                                    {prefilled && (
                                      <span className={`text-[10px] ${textMuted}`}>Prefilled from Loan Form — you can edit</span>
                                    )}
                                  </span>
                                  <span className={`text-sm font-semibold ${textMain}`}>{formatINR(value)}</span>
                                </div>
                              );
                              return (
                                <div className={`rounded-xl border overflow-hidden ${isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]"}`}>
                                  {/* Agreement Value drives GST, stamp duty, registration fee, total
                                      cost and own contribution — every figure below recomputes from
                                      form.agreement_value on each render, so editing here is live. */}
                                  <div className={`flex items-center justify-between px-4 py-2 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted}`}>Agreement Value <span className="opacity-60">(editable)</span></span>
                                    <IndianCurrencyInput value={form.agreement_value} onChange={val => set("agreement_value", val)} placeholder="50,00,000" className={`${inputCls} text-xs py-1.5 w-40 text-right`} />
                                  </div>
                                  <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted} flex items-center gap-2 flex-wrap`}>
                                      + GST
                                      {/* Same control as the Loan form's Section 8: preset buttons for
                                          the statutory rates plus free numeric entry, so 1% / 18% and
                                          decimals are expressible. Stored as a bare number ("5"). */}
                                      <span className="flex gap-1">
                                        {GST_RATE_PRESETS.map(p => {
                                          const active = parseGstRate(form.gst_rate) === p;
                                          return (
                                            <button
                                              key={p}
                                              type="button"
                                              onClick={() => set("gst_rate", String(p))}
                                              title={p === 0 ? "No GST" : p === 5 ? "5% (no ITC)" : "12% (with ITC)"}
                                              className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${active
                                                ? "bg-[#9E217B] border-[#9E217B] text-white"
                                                : `${textMuted} ${isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]"} hover:border-[#9E217B]/50`
                                                }`}
                                            >
                                              {p}%
                                            </button>
                                          );
                                        })}
                                      </span>
                                      <span className="relative">
                                        <input
                                          type="number"
                                          inputMode="decimal"
                                          min={0}
                                          max={100}
                                          step={0.5}
                                          value={form.gst_rate}
                                          onChange={e => set("gst_rate", e.target.value)}
                                          placeholder="5"
                                          aria-label="GST rate percentage"
                                          className={`w-16 rounded-md pl-1.5 pr-4 py-0.5 text-xs outline-none border ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white" : "bg-white border-[#9CA3AF] text-[#1A1A1A]"}`}
                                        />
                                        <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none ${textMuted}`}>%</span>
                                      </span>
                                      {loanPrefilled.gst_rate && (
                                        <span className={`text-[10px] ${textMuted}`}>Prefilled from Loan Form — you can edit</span>
                                      )}
                                    </span>
                                    <span className={`text-sm font-semibold ${textMain}`}>{formatINR(cost.gstAmount)}</span>
                                  </div>
                                  {/* Stamp Duty and Registration Fee use the same control as GST
                                      above: preset buttons for the rates actually used, plus free
                                      numeric entry for anything else. The rate is what's stored;
                                      the rupee figure is derived and updates as you type. */}
                                  <RateRow
                                    label="+ Stamp Duty"
                                    presets={STAMP_DUTY_RATE_PRESETS}
                                    presetTitle={p => p === 4 ? "4% — female sole/co-owner concession" : p === 5 ? "5% — standard Maharashtra urban" : "6% — Mumbai / metro (incl. 1% metro cess)"}
                                    rate={form.stamp_duty_rate}
                                    onRate={v => set("stamp_duty_rate", v)}
                                    ariaLabel="Stamp duty rate percentage"
                                    placeholder="5"
                                    value={cost.stampDuty}
                                    prefilled={!!loanPrefilled.stamp_duty_rate}
                                  />
                                  {/* Registration Fee is typed in directly, exactly like
                                      Legal Charges and Custom Charges below — no preset
                                      percentages, no derivation from agreement value and
                                      no ₹30,000 cap. Whatever is entered here is what
                                      lands in Total Cost and what gets saved; an empty
                                      box is ₹0. */}
                                  <div className={`flex items-center justify-between px-4 py-2 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted}`}>+ Registration Fee</span>
                                    <IndianCurrencyInput value={form.registration_fee_amount} onChange={val => set("registration_fee_amount", val)} placeholder="0" className={`${inputCls} text-xs py-1.5 w-40 text-right`} />
                                  </div>
                                  <div className={`flex items-center justify-between px-4 py-2 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted}`}>+ Legal Charges</span>
                                    <IndianCurrencyInput value={form.legal_charges} onChange={val => set("legal_charges", val)} placeholder="0" className={`${inputCls} text-xs py-1.5 w-40 text-right`} />
                                  </div>
                                  <div className={`flex items-center justify-between px-4 py-2 border-b ${divider}`}>
                                    <span className={`text-xs ${textMuted}`}>+ Maintenance Deposit</span>
                                    <IndianCurrencyInput value={form.maintenance_deposit} onChange={val => set("maintenance_deposit", val)} placeholder="0" className={`${inputCls} text-xs py-1.5 w-40 text-right`} />
                                  </div>
                                  {/* Custom charges are stored as a LIST of named items
                                      ({charge_name, amount, remarks}); the itemised editor further
                                      down this same step maintains it, and the API persists it to
                                      booking_custom_charges. This row therefore edits THAT array
                                      rather than introducing a second field: with no items, typing
                                      here creates one; with exactly one, it edits that one in place.
                                      Nothing new is stored and the itemised editor keeps working.

                                      Two or more named items cannot be represented by a single box —
                                      there is no answer to which one it would write to — so the row
                                      falls back to the read-only total and points at the editor,
                                      which is the only place that can express them. */}
                                  {form.custom_charges.length <= 1 ? (
                                    <div className={`flex items-center justify-between px-4 py-2 border-b ${divider}`}>
                                      <span className={`text-xs ${textMuted}`}>+ Custom Charges</span>
                                      <IndianCurrencyInput
                                        value={form.custom_charges[0]?.amount ?? ""}
                                        onChange={val => {
                                          const existing = form.custom_charges[0];
                                          // Clearing the box removes the item rather than leaving a
                                          // ₹0 line behind, so the itemised list stays clean.
                                          if (toStorageValue(val).trim() === "") { set("custom_charges", []); return; }
                                          set("custom_charges", [{
                                            charge_name: existing?.charge_name || "Custom Charges",
                                            amount: val,
                                            remarks: existing?.remarks || "",
                                          }]);
                                        }}
                                        placeholder="0"
                                        className={`${inputCls} text-xs py-1.5 w-40 text-right`}
                                      />
                                    </div>
                                  ) : (
                                    <Row
                                      label="+ Custom Charges"
                                      value={cost.customChargesTotal}
                                      hint={`(${form.custom_charges.length} items below)`}
                                    />
                                  )}
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
                            {/* ── FOE gate on OCR entry ──
                                Locked means the agreement is already fully funded,
                                so more customer money cannot be allocated to it.
                                The amounts stay VISIBLE and merely read-only: the
                                operator still needs to see what was collected. */}
                            {foe.loading ? (
                              <div className="rounded-xl border border-gray-500/20 p-4 mb-4 animate-pulse">
                                <div className={`h-3 w-48 rounded mb-2 ${isDark ? "bg-gray-700/50" : "bg-gray-200"}`} />
                                <div className={`h-3 w-32 rounded ${isDark ? "bg-gray-700/50" : "bg-gray-200"}`} />
                              </div>
                            ) : ocrLocked ? (
                              <div className={`rounded-xl border p-4 mb-4 ${isDark ? "border-[#2A2A35] bg-[#14141B]" : "border-[#E5E7EB] bg-[#F8FAFC]"}`}>
                                <p className={`text-xs font-bold flex items-center gap-2 mb-1 ${textMain}`}>🔒 OCR Entry Locked</p>
                                <p className={`text-[11px] ${textMuted}`}>Agreement fully funded by loan disbursement.</p>
                                <p className={`text-[11px] ${textMuted}`}>
                                  Max allocatable to agreement: <b className={textMain}>{formatINR(foe.obligation?.maxOCRAllocatable ?? 0)}</b>
                                </p>
                                <div className="flex items-center justify-between gap-2 mt-2">
                                  <span className={`text-[11px] ${textMuted}`}>To adjust, contact admin.</span>
                                  {/* Admins get the live override; everyone else keeps the
                                      inert button pointing at their admin. The role check is
                                      repeated server-side — this only decides the label. */}
                                  {canOverride(user?.role) ? (
                                    <button
                                      type="button"
                                      onClick={() => setShowTrancheOverride(true)}
                                      className="text-[10px] font-bold px-2 py-1 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                                    >
                                      Admin Override ↗
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled
                                      title="Contact your admin to approve this adjustment"
                                      className={`text-[10px] font-bold px-2 py-1 rounded-lg border cursor-not-allowed opacity-60 ${isDark ? "border-[#2A2A35] text-[#888899]" : "border-[#9CA3AF] text-[#6B7280]"}`}
                                    >
                                      Request Adjustment ↗
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : null}

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div>
                                <label className={labelCls}>Additional Own Payment <span className="font-normal opacity-70">(installments beyond token/booking)</span></label>
                                <IndianCurrencyInput value={form.ocr_amount} onChange={val => set("ocr_amount", val)} placeholder="0" className={inputCls} disabled={ocrLocked} />
                                {!ocrLocked && (foe.obligation?.maxOCRAllocatable ?? 0) > 0 && (
                                  <p className={`text-[10px] mt-1 ${textMuted}`}>
                                    {formatINR(foe.obligation!.maxOCRAllocatable)} remaining allocatable to agreement
                                  </p>
                                )}
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
                          {/* <div className={`border-t pt-6 ${divider}`}>
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
                                    <IndianCurrencyInput value={form.cash_component} onChange={val => set("cash_component", val)} placeholder="If applicable" className={inputCls} disabled={ocrLocked} />
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
                          </div> */}

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
                                {/* <div className={`border-t pt-4 mt-2 ${divider}`}>
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
                                </div> */}

                                {/* EMI Details */}
                                {/* <div className={`border-t pt-4 mt-2 ${divider}`}>
                                  <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${accent}`}>EMI Details</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                      <label className={labelCls}>Interest Rate (%)</label>
                                      <input type="number" step="0.01" value={form.interest_rate} onChange={e => set("interest_rate", e.target.value)} placeholder="8.5" className={inputCls} />
                                    </div>
                                    Temporarily hidden — to be re-enabled later
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
                                </div> */}
                              </div>
                            )}
                          </div>

                          {/* Custom Charges */}
                          <div className={`border-t pt-6 ${divider}`}>
                            <div className="flex items-center justify-between mb-4">
                              <div>
                                <p className={sectionTitle} style={{ marginBottom: 0 }}>Custom Charges</p>
                                <p className={`text-xs ${textMuted} mt-1`}>
                                  Same figure as the Custom Charges row in the breakdown above. Add
                                  more than one to name and itemise them.
                                </p>
                              </div>
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
                                <div onClick={() => {
                                  set("booking_source", src);
                                  // Selecting Channel Partner turns the calculation on by
                                  // default (the initial value is derived from the lead, which
                                  // may not have been CP-sourced). Switching to Direct stops
                                  // anything being recorded.
                                  setForm(f => ({
                                    ...f,
                                    cp_commission_mode: src === "Channel Partner"
                                      ? (f.cp_commission_mode === "none" ? "auto" : f.cp_commission_mode)
                                      : "none",
                                  }));
                                }} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${form.booking_source === src ? (isDark ? "border-[#9E217B] bg-[#9E217B]" : "border-[#00AEEF] bg-[#00AEEF]") : (isDark ? "border-[#2A2A35]" : "border-[#9CA3AF]")}`}>
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

                              {/* ── CP commission ──────────────────────────────
                                  Recorded against the partner when this booking
                                  saves, and visible immediately under Channel
                                  Partners in the admin panel. */}
                              {/* <div className={`rounded-xl p-4 border ${isDark ? "bg-[#9E217B]/5 border-[#9E217B]/25" : "bg-[#9E217B]/5 border-[#9E217B]/20"}`}>
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                  <div>
                                    <p className={`text-xs font-bold ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>Channel Partner Commission</p>
                                    {cpMaster && (
                                      <p className={`text-[10px] mt-0.5 ${textMuted}`}>
                                        From this lead: <strong className={textMain}>{cpMaster.name}</strong>
                                        {cpMaster.phone ? ` · ${cpMaster.phone}` : ""}
                                        {cpMaster.default_commission_rate !== null
                                          ? ` · ${cpMaster.default_commission_rate}%`
                                          : " · no rate set"}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-4">
                                
                                    <label className={`flex items-center gap-2 cursor-pointer text-[11px] ${textMuted}`}>
                                      <input
                                        type="checkbox"
                                        checked={form.cp_commission_mode !== "none"}
                                        onChange={e => set("cp_commission_mode", e.target.checked ? "auto" : "none")}
                                        className="cursor-pointer"
                                      />
                                      Record commission
                                    </label>
                                    {form.cp_commission_mode !== "none" && (
                                      <label className={`flex items-center gap-2 cursor-pointer text-[11px] ${textMuted}`}>
                                        <input
                                          type="checkbox"
                                          checked={form.cp_commission_mode === "manual"}
                                          onChange={e => set("cp_commission_mode", e.target.checked ? "manual" : "auto")}
                                          className="cursor-pointer"
                                        />
                                        Enter manually
                                      </label>
                                    )}
                                  </div>
                                </div>

                                {!cpId && (
                                  <p className={`text-[11px] ${textMuted}`}>
                                    This lead has no channel partner on record, so no commission can be recorded.
                                    Set the CP on the lead first.
                                  </p>
                                )}

                                {cpId && form.cp_commission_mode !== "manual" && (
                                  <div>
                                    <label className={labelCls}>Commission (auto-calculated)</label>
                                    <input
                                      readOnly
                                      value={cpPreview ? formatCurrencyDecimal(cpPreview.gross) : ""}
                                      placeholder={cpPreviewError ? "—" : "Enter agreement value above"}
                                      className={`${inputCls} cursor-not-allowed opacity-90`}
                                    />
                                    <p className={`text-[10px] mt-1 ${textMuted}`}>
                                      {cpPreview
                                        ? `${formatCurrencyDecimal(cpPreview.agreementValue)} × ${cpPreview.commissionRatePercent}% (this partner's configured rate)`
                                        : "Calculated from the agreement value and the partner's configured rate."}
                                    </p>
                                  </div>
                                )}

                                {cpId && form.cp_commission_mode === "manual" && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                      <label className={labelCls}>Commission Amount</label>
                                      <input
                                        value={form.cp_commission_amount}
                                        onChange={e => set("cp_commission_amount", e.target.value)}
                                        placeholder="e.g. 150000"
                                        className={inputCls}
                                      />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Reason</label>
                                      <input
                                        value={form.cp_commission_reason}
                                        onChange={e => set("cp_commission_reason", e.target.value)}
                                        placeholder="Why it differs from the standard rate"
                                        className={inputCls}
                                      />
                                    </div>
                                  </div>
                                )}

                                {cpPreviewError && (
                                  <p className="text-[11px] mt-2 text-amber-500">{cpPreviewError}</p>
                                )}


                                {cpId && cpPreviewCode === "CP_RATE_NOT_SET" && (
                                  canSetRate ? (
                                    <div className={`mt-3 pt-3 border-t ${divider}`}>
                                      <label className={labelCls}>Set commission rate for {cpMaster?.name || "this partner"} (%)</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          value={rateInput}
                                          onChange={e => { setRateInput(e.target.value); setRateError(null); }}
                                          placeholder="e.g. 2 or 1.75"
                                          className={`${inputCls} flex-1`}
                                        />
                                        <button
                                          type="button"
                                          disabled={rateSaving || !rateInput.trim()}
                                          onClick={saveCpRate}
                                          className={`px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap ${isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white" : "bg-[#9E217B] hover:bg-[#7a1960] text-white"} ${rateSaving || !rateInput.trim() ? "opacity-50 cursor-not-allowed" : ""}`}
                                        >
                                          {rateSaving ? "Saving..." : "Save rate"}
                                        </button>
                                      </div>
                                      {rateError
                                        ? <p className="text-[10px] mt-1 text-red-500">{rateError}</p>
                                        : <p className={`text-[10px] mt-1 ${textMuted}`}>
                                            Saved against the partner, so it applies to their future bookings too.
                                            Or tick &ldquo;Enter manually&rdquo; to just type an amount for this booking.
                                          </p>}
                                    </div>
                                  ) : (
                                    <p className={`text-[11px] mt-2 ${textMuted}`}>
                                      Tick &ldquo;Enter manually&rdquo; to record an amount for this booking, or ask an
                                      admin to set this partner&apos;s rate under Channel Partners.
                                    </p>
                                  )
                                )}

                                {cpId && form.cp_commission_mode === "none" && (
                                  <p className={`text-[11px] mt-2 ${textMuted}`}>
                                    Shown for reference only — this commission will <strong>not</strong> be recorded
                                    against the partner. You can add it later from Channel Partners.
                                  </p>
                                )}

                                {cpPreview && (
                                  <div className={`mt-3 pt-3 border-t text-[11px] space-y-1 ${divider}`}>
                                    <div className="flex justify-between">
                                      <span className={textMuted}>Gross commission</span>
                                      <span className={`font-bold ${textMain}`}>{formatCurrencyDecimal(cpPreview.gross)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className={textMuted}>TDS ({cpPreview.tdsPercent}%)</span>
                                      <span className={textMain}>{formatCurrencyDecimal(cpPreview.tdsAmount)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className={textMuted}>Net payable</span>
                                      <span className={`font-bold ${textMain}`}>{formatCurrencyDecimal(cpPreview.netPayable)}</span>
                                    </div>
                                    {cpPreview.crossed && (
                                      <p className="text-[10px] pt-1 text-amber-500">
                                        This partner is over the ₹20,000 FY threshold, so {cpPreview.tdsPercent}% TDS applies.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div> */}
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
                            // Apartment Name row temporarily hidden — to be re-enabled later
                            { title: "Unit Details", rows: [["Project Name", form.project_name], ["Tower", form.tower], ["Wing", form.wing], ["Type", form.property_type], ["Floor", form.floor_number], ["Flat No.", form.flat_number], ["Carpet Area", `${form.carpet_area} sq.ft.`], ["Consideration Value", form.consideration_value], ["Parking", form.parking_details], ["Witness", form.witness_name]] },
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
                                  // Temporarily hidden — to be re-enabled later
                                  // ["Tenure", form.loan_tenure_months ? `${form.loan_tenure_months} months` : ""],
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

      {/* Inventory unit picker for Step 2, layered above this modal. */}
      {pickerOpen && (
        <UnitPicker
          key="unit-picker"
          isDark={isDark}
          selectedUnitId={selectedUnit?.id ?? null}
          currentBookingId={effBooking?.id ?? null}
          onSelect={applyUnit}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Admin override for the disbursement gate, layered above this modal. */}
      {showTrancheOverride && effBooking?.id && foe.obligation && (
        <TrancheOverrideModal
          key="tranche-override"
          bookingId={effBooking.id}
          obligation={foe.obligation}
          isDark={isDark}
          t={buildTheme(isDark)}
          onClose={() => setShowTrancheOverride(false)}
          onSuccess={() => { setShowTrancheOverride(false); foe.refetch(); }}
        />
      )}

      {/* ── Loan & Deal editor, layered over the booking form ──────────────────
          Rendered above this modal (z-210 vs 200) rather than replacing it, so
          the booking form keeps its state — the whole point of editing loan
          details from here instead of cancelling out to the lead screen. */}
      {showLoanEditor && (
        <div
          key="loan-editor"
          className="fixed inset-0 z-[210] flex items-start justify-center p-4 overflow-y-auto bg-black/70"
          style={{ backdropFilter: "blur(6px)" }}
        >
          <div className="w-full max-w-3xl my-6">
            {loanEditorLoading ? (
              <div className={`rounded-xl border p-6 text-sm ${isDark ? "bg-[#121218] border-[#2A2A35] text-[#888899]" : "bg-white border-[#E5E7EB] text-[#6B7280]"}`}>
                Loading loan details…
              </div>
            ) : (
              <LoanDealForm
                lead={lead}
                booking={effBooking || null}
                loanUpdate={loanEditorUpdate}
                user={user}
                isDark={isDark}
                t={buildTheme(isDark)}
                onCancel={() => setShowLoanEditor(false)}
                onSuccess={() => {
                  setShowLoanEditor(false);
                  // The operator just set these figures deliberately — refresh the
                  // untouched ones here rather than leaving the booking form on
                  // values they have since replaced.
                  applyLoanPrefill({ force: true });
                }}
              />
            )}
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}