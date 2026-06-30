"use client";
// BookingApplicationView.tsx — Read-only view of a submitted booking
import React, { useRef } from "react";
import {
  FaUser, FaBuilding, FaHandshake, FaFileAlt, FaCheck, FaMoneyBillWave,
  FaPrint, FaDownload, FaEdit, FaCheckCircle, FaTimesCircle, FaIdCard,
  FaMapMarkerAlt, FaPhone, FaEnvelope
} from "react-icons/fa";

interface BookingApplicationViewProps {
  booking: any;
  lead: any;
  isDark?: boolean;
  userRole: string;
  onEdit?: () => void;
  onApprove?: () => void;
  onCancel?: () => void;
}

export default function BookingApplicationView({
  booking, lead, isDark = false, userRole, onEdit, onApprove, onCancel,
}: BookingApplicationViewProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const textMain = isDark ? "text-white" : "text-[#1A1A1A]";
  const textMuted = isDark ? "text-[#888899]" : "text-[#6B7280]";
  const accent = isDark ? "text-[#d4006e]" : "text-[#9E217B]";
  const cardBg = isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]";
  const divider = isDark ? "border-[#2A2A35]" : "border-[#F1F5F9]";
  const sectionTitle = `text-xs font-bold uppercase tracking-wider mb-3 ${accent}`;
  const fieldLabel = `text-[10px] font-semibold mb-0.5 ${textMuted}`;
  const fieldVal = `text-sm font-semibold ${textMain}`;

  const safeVal = (v: any) => (!v || v === "N/A" || v === "null" || v === "undefined") ? "—" : String(v);

  // Parse payment details
  let payments: any[] = [];
  try { payments = typeof booking.payment_details === "string" ? JSON.parse(booking.payment_details) : (booking.payment_details || []); } catch { payments = []; }

  const totalAmount = payments.reduce((sum: number, r: any) => sum + (parseFloat(String(r.amount).replace(/,/g, "")) || 0), 0);

  const formatDate = (d: string) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
  };

  const [isGeneratingPdf, setIsGeneratingPdf] = React.useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    try {
      setIsGeneratingPdf(true);

      const res = await fetch("/api/generate-booking-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking, lead }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "PDF generation failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${booking?.booking_number || "Booking_Form"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error(error);
      alert(`PDF generation failed: ${error.message || "Please try again later."}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const bookingStatus = booking.booking_status || "Pending";
  const statusColor = bookingStatus === "Approved" ? (isDark ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-green-700 border-green-300 bg-green-50")
    : bookingStatus === "Cancelled" ? (isDark ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-red-700 border-red-300 bg-red-50")
    : (isDark ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" : "text-amber-700 border-amber-300 bg-amber-50");

  return (
    <div className="space-y-5" ref={printRef}>
      {/* ── Booking Info Card ── */}
      <div className={`rounded-2xl border p-5 ${isDark ? "bg-gradient-to-r from-[#9E217B]/10 to-[#0A0A0F] border-[#9E217B]/30" : "bg-gradient-to-r from-[#EBF5FB] to-[#F0E5F5] border-[#00AEEF]/30"}`}>
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <p className={`text-xs font-semibold ${textMuted}`}>Booking Number</p>
            <p className={`text-2xl font-black ${accent}`}>{safeVal(booking.booking_number)}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${statusColor}`}>{bookingStatus}</span>

            {/* Role-based action buttons */}
            {(userRole === "admin" || (userRole === "sales" && bookingStatus !== "Approved")) && onEdit && (
              <button onClick={onEdit} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${isDark ? "bg-[#9E217B] hover:bg-[#7a1960] text-white" : "bg-[#00AEEF] hover:bg-[#0088bb] text-white"}`}>
                <FaEdit className="text-[10px]" /> Edit
              </button>
            )}
            {userRole === "admin" && bookingStatus === "Pending" && onApprove && (
              <button onClick={onApprove} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer bg-green-600 hover:bg-green-500 text-white transition-colors">
                <FaCheckCircle className="text-[10px]" /> Approve
              </button>
            )}
            {userRole === "admin" && bookingStatus !== "Cancelled" && onCancel && (
              <button onClick={onCancel} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors">
                <FaTimesCircle className="text-[10px]" /> Cancel
              </button>
            )}
            <button onClick={handlePrint} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer border transition-colors ${isDark ? "border-[#2A2A35] text-[#888899] hover:border-[#9E217B] hover:text-[#d4006e]" : "border-[#9CA3AF] text-[#6B7280] hover:border-[#9E217B] hover:text-[#9E217B]"}`}>
              <FaPrint className="text-[10px]" /> Print
            </button>
            <button onClick={handleDownloadPdf} disabled={isGeneratingPdf} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer border transition-colors ${isDark ? "border-[#2A2A35] text-[#888899] hover:border-[#9E217B] hover:text-[#d4006e]" : "border-[#9CA3AF] text-[#6B7280] hover:border-[#9E217B] hover:text-[#9E217B]"}`}>
              {isGeneratingPdf ? <span className="animate-pulse">Generating...</span> : <><FaDownload className="text-[10px]" /> Download PDF</>}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {[
            { label: "Lead No.", val: `#${booking.lead_id}` },
            { label: "Application Date", val: formatDate(booking.application_date) },
            { label: "Flat / Unit", val: `${safeVal(booking.flat_number)}, Floor ${safeVal(booking.floor_number)}` },
            { label: "Booking Amount", val: booking.consideration_value ? `₹${booking.consideration_value}` : "—" },
            { label: "Sales Manager", val: safeVal(booking.lead_assigned_to || lead?.assigned_to) },
            { label: "Property Type", val: safeVal(booking.property_type) },
            { label: "Created By", val: `${safeVal(booking.created_by)} (${safeVal(booking.created_role)})` },
            { label: "Booking Source", val: safeVal(booking.booking_source) },
          ].map(({ label, val }) => (
            <div key={label}>
              <p className={fieldLabel}>{label}</p>
              <p className={fieldVal}>{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── CRM / Enquiry Information ── */}
      <div className={`rounded-2xl border p-5 ${cardBg}`}>
        <p className={sectionTitle}><FaIdCard className="inline mr-1.5" />CRM Enquiry Information</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          {[
            { label: "Lead Number", val: `#${booking.lead_id} (Sr. ${safeVal(booking.lead_sr_no)})` },
            { label: "Lead Created", val: formatDate(booking.lead_created_at) },
            { label: "Customer Name", val: safeVal(booking.lead_name) },
            { label: "Phone", val: safeVal(booking.lead_phone) },
            { label: "Alt Phone", val: safeVal(booking.lead_alt_phone) },
            { label: "Email", val: safeVal(booking.lead_email) },
            { label: "Address", val: safeVal(booking.lead_address) },
            { label: "Budget", val: safeVal(booking.lead_budget) },
            { label: "Configuration", val: safeVal(booking.lead_configuration) },
            { label: "Purpose", val: safeVal(booking.lead_purpose) },
            { label: "Lead Source", val: safeVal(booking.lead_source) },
            { label: "Sales Manager", val: safeVal(booking.lead_assigned_to) },
            { label: "Receptionist", val: safeVal(booking.lead_receptionist) },
            { label: "Site Head", val: safeVal(booking.lead_site_head) },
            { label: "Enquiry Date", val: formatDate(booking.lead_enquiry_date) },
          ].map(({ label, val }) => (
            <div key={label}>
              <p className={fieldLabel}>{label}</p>
              <p className={fieldVal}>{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 📄 Primary Applicant */}
      <div className={`rounded-2xl border p-5 ${cardBg}`}>
        <p className={sectionTitle}><FaUser className="inline mr-1.5" />Primary Applicant</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Full Name", val: booking.primary_name },
            { label: "Email ID", val: booking.primary_email },
            { label: "Mobile", val: booking.primary_mobile },
            { label: "PAN Number", val: booking.primary_pan },
            { label: "Aadhaar Number", val: booking.primary_aadhaar },
            { label: "Occupation", val: booking.primary_occupation },
            { label: "Nationality", val: booking.primary_nationality },
          ].map(({ label, val }) => (
            <div key={label}><p className={fieldLabel}>{label}</p><p className={fieldVal}>{safeVal(val)}</p></div>
          ))}
        </div>

        {/* Joint Applicants */}
        {(() => {
          let jointApplicants: any[] = [];
          if (booking.joint_applicants) {
            try {
              jointApplicants = typeof booking.joint_applicants === 'string' 
                ? JSON.parse(booking.joint_applicants) 
                : booking.joint_applicants;
            } catch (e) { }
          }
          if (jointApplicants.length === 0 && booking.joint_name) {
             // Legacy fallback
             jointApplicants = [{
               name: booking.joint_name, email: booking.joint_email, mobile: booking.joint_mobile,
               pan: booking.joint_pan, occupation: booking.joint_occupation, nationality: booking.joint_nationality
             }];
          }

          return jointApplicants.map((ja, idx) => (
            <div key={idx} className={`mt-4 pt-4 border-t ${divider}`}>
              <p className={`${sectionTitle} mt-0`}>Joint Applicant {idx + 1}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "Full Name", val: ja.name },
                  { label: "Email ID", val: ja.email },
                  { label: "Mobile", val: ja.mobile },
                  { label: "PAN Number", val: ja.pan },
                  { label: "Aadhaar Number", val: ja.aadhaar },
                  { label: "Occupation", val: ja.occupation },
                  { label: "Nationality", val: ja.nationality },
                ].map(({ label, val }) => (
                  <div key={label}><p className={fieldLabel}>{label}</p><p className={fieldVal}>{safeVal(val)}</p></div>
                ))}
              </div>
            </div>
          ));
        })()}

        {/* Residence */}
        <div className={`mt-4 pt-4 border-t ${divider}`}>
          <p className={`${sectionTitle} mt-0`}><FaMapMarkerAlt className="inline mr-1.5" />Residential Address</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2"><p className={fieldLabel}>Address</p><p className={fieldVal}>{safeVal(booking.address)}</p></div>
            {[{ label: "PIN Code", val: booking.pin }, { label: "State", val: booking.state }, { label: "Country", val: booking.country }].map(({ label, val }) => (
              <div key={label}><p className={fieldLabel}>{label}</p><p className={fieldVal}>{safeVal(val)}</p></div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Unit Details ── */}
      <div className={`rounded-2xl border p-5 ${cardBg}`}>
        <p className={sectionTitle}><FaBuilding className="inline mr-1.5" />Unit Details</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: "Property Type", val: booking.property_type },
            { label: "Floor Number", val: booking.floor_number },
            { label: "Flat Number", val: booking.flat_number },
            { label: "Carpet Area", val: booking.carpet_area ? `${booking.carpet_area} sq.ft.` : "—" },
            { label: "Consideration Value", val: booking.consideration_value ? `₹${booking.consideration_value}` : "—" },
            { label: "Value In Words", val: booking.consideration_value_words },
            { label: "Parking", val: booking.parking_details },
          ].map(({ label, val }) => (
            <div key={label} className={label === "Value In Words" ? "col-span-2" : ""}><p className={fieldLabel}>{label}</p><p className={fieldVal}>{safeVal(val)}</p></div>
          ))}
        </div>

        {/* Unit Summary Table */}
        <div className={`rounded-xl border overflow-hidden ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
          <table className="w-full text-sm">
            <tbody>
              {[
                { label: "Type of Unit", val: booking.property_type },
                { label: "Floor No", val: booking.floor_number },
                { label: "Flat No", val: booking.flat_number },
                { label: "Area in sq.ft.", val: booking.carpet_area },
                { label: "Cost of Unit", val: booking.unit_cost || booking.consideration_value },
                { label: "S.D.R", val: booking.sdr },
                { label: "GST", val: booking.gst },
              ].map(({ label, val }, i) => (
                <tr key={label} className={`border-t ${i === 0 ? "border-transparent" : (isDark ? "border-[#2A2A35]" : "border-[#F1F5F9]")}`}>
                  <td className={`px-4 py-2 text-xs font-bold w-1/2 ${isDark ? "bg-[#1A1A28]" : "bg-[#F8FAFC]"} ${textMuted}`}>{label}</td>
                  <td className={`px-4 py-2 text-sm font-semibold ${textMain}`}>{safeVal(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Payments ── */}
      {payments.length > 0 && (
        <div className={`rounded-2xl border p-5 ${cardBg}`}>
          <p className={sectionTitle}><FaMoneyBillWave className="inline mr-1.5" />Payment Details</p>
          <div className={`rounded-xl border overflow-hidden ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1A1A28]" : "bg-[#F8FAFC]"}>
                  <th className={`text-left px-4 py-2 text-xs font-bold w-8 ${textMuted}`}>Sr.</th>
                  <th className={`text-left px-4 py-2 text-xs font-bold ${textMuted}`}>Date</th>
                  <th className={`text-left px-4 py-2 text-xs font-bold ${textMuted}`}>Transaction Detail</th>
                  <th className={`text-right px-4 py-2 text-xs font-bold ${textMuted}`}>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((row: any, i: number) => (
                  <tr key={i} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#F1F5F9]"}`}>
                    <td className={`px-4 py-2 text-xs ${textMuted}`}>{i + 1}.</td>
                    <td className={`px-4 py-2 text-xs ${textMain}`}>{row.date}</td>
                    <td className={`px-4 py-2 text-xs ${textMain}`}>{row.transaction_type}</td>
                    <td className={`px-4 py-2 text-xs text-right font-bold ${textMain}`}>₹{row.amount}</td>
                  </tr>
                ))}
                {totalAmount > 0 && (
                  <tr className={`border-t ${isDark ? "border-[#9E217B]/30 bg-[#9E217B]/10" : "border-[#9E217B]/20 bg-[#9E217B]/5"}`}>
                    <td colSpan={3} className={`px-4 py-2 text-xs font-bold text-right ${accent}`}>Total</td>
                    <td className={`px-4 py-2 text-xs font-bold text-right ${accent}`}>₹{totalAmount.toLocaleString("en-IN")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Booking Source ── */}
      <div className={`rounded-2xl border p-5 ${cardBg}`}>
        <p className={sectionTitle}><FaHandshake className="inline mr-1.5" />Booking Source</p>
        <div className="grid grid-cols-2 gap-3">
          <div><p className={fieldLabel}>Source Type</p><p className={fieldVal}>{safeVal(booking.booking_source)}</p></div>
          {booking.booking_source === "Direct" && booking.direct_source && (
            <div><p className={fieldLabel}>Specified Source</p><p className={fieldVal}>{safeVal(booking.direct_source)}</p></div>
          )}
          {booking.booking_source === "Channel Partner" && (
            <>
              <div><p className={fieldLabel}>Partner Name</p><p className={fieldVal}>{safeVal(booking.channel_partner_name)}</p></div>
              <div><p className={fieldLabel}>Contact Number</p><p className={fieldVal}>{safeVal(booking.channel_partner_contact)}</p></div>
            </>
          )}
        </div>
      </div>

      {/* ── Witness ── */}
      {(booking.witness_name || booking.witness_aadhaar) && (
        <div className={`rounded-2xl border p-5 ${cardBg}`}>
          <p className={sectionTitle}>Witness Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div><p className={fieldLabel}>Witness Name</p><p className={fieldVal}>{safeVal(booking.witness_name)}</p></div>
            <div><p className={fieldLabel}>Aadhaar Number</p><p className={fieldVal}>{safeVal(booking.witness_aadhaar)}</p></div>
          </div>
        </div>
      )}

      {/* ── Declaration ── */}
      <div className={`rounded-2xl border p-5 ${cardBg}`}>
        <p className={sectionTitle}><FaFileAlt className="inline mr-1.5" />Declaration Status</p>
        <div className="space-y-2">
          {[
            { label: "All information accurate and true", val: booking.declaration_accepted },
            { label: "Terms & Conditions accepted", val: booking.terms_accepted },
            { label: "Irrevocable consent given", val: booking.consent_accepted },
          ].map(({ label, val }) => (
            <div key={label} className="flex items-center gap-2.5">
              <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${val ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
                {val ? "✓" : "✗"}
              </div>
              <span className={`text-sm ${textMain}`}>{label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <p className={fieldLabel}>Application Date</p>
          <p className={fieldVal}>{formatDate(booking.application_date)}</p>
        </div>

        {/* Signature */}
        {booking.signature_data && (
          <div className="mt-4">
            <p className={fieldLabel}>Signature of Primary Applicant</p>
            <div className={`mt-2 rounded-xl border p-3 inline-block ${isDark ? "border-[#2A2A35] bg-[#14141B]" : "border-[#E5E7EB] bg-[#FAFAFA]"}`}>
              <img src={booking.signature_data} alt="Signature" className="max-h-20 max-w-xs" />
            </div>
          </div>
        )}
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body > * { display: none !important; }
          .booking-print-area { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
