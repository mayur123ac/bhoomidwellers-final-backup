"use client";
// BookingFormModal.tsx — Multi-step Booking Application Form
import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaTimes, FaChevronRight, FaChevronLeft, FaUser, FaHome, FaBuilding,
  FaMoneyBillWave, FaHandshake, FaFileAlt, FaCheck, FaPlus, FaTrash,
  FaPen, FaUpload, FaCheckCircle, FaPrint, FaDownload,
} from "react-icons/fa";

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
  property_type: string; floor_number: string; flat_number: string;
  carpet_area: string; consideration_value: string; consideration_value_words: string;
  parking_details: string; payment_details: PaymentRow[];
  witness_name: string; witness_aadhaar: string;
  // Step 3 — Source
  booking_source: "Direct" | "Channel Partner";
  direct_source: string; channel_partner_name: string; channel_partner_contact: string;
  // Step 4 — Declaration
  declaration_accepted: boolean; terms_accepted: boolean; consent_accepted: boolean;
  signature_data: string; application_date: string;
}

interface BookingFormModalProps {
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
  { id: 3, label: "Booking Source", icon: <FaHandshake /> },
  { id: 4, label: "Declaration", icon: <FaFileAlt /> },
  { id: 5, label: "Review", icon: <FaCheckCircle /> },
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

function defaultForm(lead: any): BookingFormData {
  const today = new Date().toISOString().split("T")[0];
  return {
    primary_name: lead?.name || "", primary_email: lead?.email !== "N/A" ? (lead?.email || "") : "",
    primary_mobile: lead?.phone || "", primary_pan: "", primary_aadhaar: "", primary_occupation: lead?.occupation !== "N/A" ? (lead?.occupation || "") : "",
    primary_nationality: "Indian",
    primary_pan_file: null, primary_aadhaar_front_file: null, primary_aadhaar_back_file: null,
    joint_applicants: [],
    address: lead?.address !== "N/A" ? (lead?.address || "") : "", pin: "", state: "", country: "India",
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
    declaration_accepted: false, terms_accepted: false, consent_accepted: false,
    signature_data: "", application_date: today,
  };
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function BookingFormModal({ isOpen, onClose, lead, user, isDark = false, onSuccess }: BookingFormModalProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BookingFormData>(() => defaultForm(lead));
  const [errors, setErrors] = useState<Partial<Record<keyof BookingFormData, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsScrolled, setTermsScrolled] = useState(false);
  const [sigMode, setSigMode] = useState<"draw" | "upload">("draw");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const termsRef = useRef<HTMLDivElement>(null);

  // Load draft from sessionStorage
  useEffect(() => {
    if (!isOpen || !lead?.id) return;
    const key = `booking_draft_${lead.id}`;
    const stored = sessionStorage.getItem(key);
    if (stored) {
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
    if (s === 4) {
      if (!form.declaration_accepted) e.declaration_accepted = "Required";
      if (!form.terms_accepted) e.terms_accepted = "Required";
      if (!form.consent_accepted) e.consent_accepted = "Required";
      if (!form.signature_data) e.signature_data = "Signature is required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const nextStep = () => { if (validate(step)) setStep(s => Math.min(s + 1, 5)); };
  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  // ── Submit ──
  const handleSubmit = async () => {
    if (!validate(4)) { setStep(4); return; }
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      
      // Basic fields
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
      
      // Assuming these properties exist on the form or are derived
      formData.append("unit_cost", (form as any).unit_cost || "");
      formData.append("sdr", (form as any).sdr || "");
      formData.append("gst", (form as any).gst || "");
      
      formData.append("declaration_accepted", form.declaration_accepted ? 'true' : 'false');
      formData.append("terms_accepted", form.terms_accepted ? 'true' : 'false');
      formData.append("consent_accepted", form.consent_accepted ? 'true' : 'false');
      
      formData.append("signature_data", form.signature_data);
      formData.append("application_date", form.application_date);
      
      formData.append("created_by", user.name);
      formData.append("created_role", user.role);

      // JSON fields
      formData.append("payment_details", JSON.stringify(form.payment_details));
      formData.append("joint_applicants", JSON.stringify(form.joint_applicants.map(ja => ({
        name: ja.name, email: ja.email, mobile: ja.mobile,
        pan: ja.pan?.toUpperCase(), aadhaar: ja.aadhaar, occupation: ja.occupation, nationality: ja.nationality
      }))));

      // Files
      if (form.primary_pan_file) formData.append("primary_pan_file", form.primary_pan_file);
      if (form.primary_aadhaar_front_file) formData.append("primary_aadhaar_front_file", form.primary_aadhaar_front_file);
      if (form.primary_aadhaar_back_file) formData.append("primary_aadhaar_back_file", form.primary_aadhaar_back_file);
      
      form.joint_applicants.forEach((ja, i) => {
        if (ja.pan_file) formData.append(`joint_${i}_pan_file`, ja.pan_file);
        if (ja.aadhaar_front_file) formData.append(`joint_${i}_aadhaar_front_file`, ja.aadhaar_front_file);
        if (ja.aadhaar_back_file) formData.append(`joint_${i}_aadhaar_back_file`, ja.aadhaar_back_file);
      });

      const res = await fetch("/api/booking-applications", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to save booking");
      const booking = json.data;

      // 2. Update lead status to Closing
      await fetch(`/api/walkin_enquiries/${lead.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: lead.name, status: "Closing" }),
      });

      // 3. Add timeline entry
      await fetch("/api/followups", {
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
      });

      // 4. Clear draft
      if (lead?.id) sessionStorage.removeItem(`booking_draft_${lead.id}`);
      onSuccess(booking);
      onClose();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

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
                <h2 className={`text-lg font-bold ${textMain}`}>Booking Application Form</h2>
                <p className={`text-xs mt-0.5 ${textMuted}`}>Lead #{lead?.id} — {lead?.name}</p>
              </div>
              <button onClick={onClose} className={`p-2 rounded-xl transition-colors cursor-pointer ${isDark ? "text-[#888899] hover:bg-[#1C1C2A] hover:text-white" : "text-[#6B7280] hover:bg-[#F1F5F9]"}`}>
                <FaTimes />
              </button>
            </div>

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
                              <input value={(form as any)[key]} onChange={e => set(key as keyof BookingFormData, e.target.value as any)} placeholder={placeholder} className={`${inputCls} ${errors[key as keyof BookingFormData] ? "!border-red-500" : ""}`} />
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
                                        const arr = [...form.joint_applicants];
                                        (arr[idx] as any)[f.k] = e.target.value;
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
                            { key: "property_type", label: "Type", placeholder: "2 BHK" },
                            { key: "floor_number", label: "Floor", placeholder: "12" },
                            { key: "flat_number", label: "Flat No.", placeholder: "A-1201" },
                            { key: "carpet_area", label: "Carpet Area (sq.ft.)", placeholder: "1050" },
                          ].map(({ key, label, placeholder }) => (
                            <div key={key}>
                              <label className={labelCls}>{label}</label>
                              <input value={(form as any)[key]} onChange={e => set(key as keyof BookingFormData, e.target.value as any)} placeholder={placeholder} className={`${inputCls} ${errors[key as keyof BookingFormData] ? "!border-red-500" : ""}`} />
                              {errors[key as keyof BookingFormData] && <p className={errCls}>{errors[key as keyof BookingFormData]}</p>}
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={labelCls}>Consideration Value (₹)</label>
                            <input value={form.consideration_value} onChange={e => set("consideration_value", e.target.value.replace(/[^0-9,]/g, ""))} placeholder="e.g. 52,00,000" className={`${inputCls} ${errors.consideration_value ? "!border-red-500" : ""}`} />
                            {errors.consideration_value && <p className={errCls}>{errors.consideration_value}</p>}
                          </div>
                          <div>
                            <label className={labelCls}>Value In Words</label>
                            <input value={form.consideration_value_words} onChange={e => set("consideration_value_words", e.target.value)} placeholder="Auto-generated" className={inputCls} />
                          </div>
                        </div>
                        <div className="mt-4">
                          <label className={labelCls}>Parking Details</label>
                          <input value={form.parking_details} onChange={e => set("parking_details", e.target.value)} placeholder="e.g. 1 covered parking" className={inputCls} />
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
                                  <td className="px-2 py-1.5"><input value={row.amount} onChange={e => updatePayment(i, "amount", e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" className={`${inputCls} text-xs py-1.5`} /></td>
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

                  {/* ══════════ STEP 3: Booking Source ══════════ */}
                  {step === 3 && (
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
                    </div>
                  )}

                  {/* ══════════ STEP 4: Declaration ══════════ */}
                  {step === 4 && (
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

                  {/* ══════════ STEP 5: Review & Submit ══════════ */}
                  {step === 5 && (
                    <div className="space-y-5">
                      <p className={sectionTitle}><FaCheckCircle className="inline mr-2" />Review & Confirm</p>

                      {/* Booking Info Card */}
                      <div className={`rounded-2xl border p-5 ${isDark ? "bg-[#121218] border-[#9E217B]/30 bg-gradient-to-r from-[#9E217B]/10 to-[#0A0A0F]" : "bg-gradient-to-r from-[#EBF5FB] to-[#F0E5F5] border-[#00AEEF]/30"}`}>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                          {[
                            { label: "Lead No.", val: `#${lead?.id}` },
                            { label: "Applicant", val: form.primary_name },
                            { label: "Mobile", val: form.primary_mobile },
                            { label: "Property", val: `${form.property_type}, Flat ${form.flat_number}` },
                            { label: "Floor", val: form.floor_number },
                            { label: "Carpet Area", val: form.carpet_area ? `${form.carpet_area} sq.ft.` : "-" },
                            { label: "Booking Amount", val: form.consideration_value ? `₹${form.consideration_value}` : "-" },
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
                        { title: "Unit Details", rows: [["Type", form.property_type], ["Floor", form.floor_number], ["Flat No.", form.flat_number], ["Carpet Area", `${form.carpet_area} sq.ft.`], ["Consideration Value", form.consideration_value], ["Parking", form.parking_details], ["Witness", form.witness_name]] },
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

              <span className={`text-xs font-semibold ${textMuted}`}>Step {step} of 5</span>

              {step < 5 ? (
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
