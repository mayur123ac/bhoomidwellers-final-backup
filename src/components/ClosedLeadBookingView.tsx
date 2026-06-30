"use client";
import React, { useState } from "react";
import {
  FaFileInvoice, FaMoneyBillWave, FaFolderOpen, FaHistory, FaIdCard,
  FaCheckCircle, FaPrint, FaDownload, FaEdit, FaChevronDown, FaChevronRight,
  FaMapMarkerAlt
} from "react-icons/fa";
import BookingApplicationView from "./BookingApplicationView";

interface ClosedLeadBookingViewProps {
  booking: any;
  lead: any;
  userRole: string; // "receptionist" | "sales" | "site_head" | "admin"
  isDark?: boolean;
  onEdit?: () => void;
  onApprove?: () => void;
  onCancel?: () => void;
}

export default function ClosedLeadBookingView({
  booking, lead, userRole, isDark = false, onEdit, onApprove, onCancel
}: ClosedLeadBookingViewProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "payments" | "documents" | "timeline" | "crm">("summary");
  const [crmOpen, setCrmOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const textMain = isDark ? "text-white" : "text-[#1A1A1A]";
  const textMuted = isDark ? "text-[#888899]" : "text-[#6B7280]";
  const bgCard = isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#E5E7EB]";
  const accent = isDark ? "text-[#d4006e]" : "text-[#9E217B]";

  const safeVal = (v: any) => (!v || v === "N/A" || v === "null" || v === "undefined") ? "—" : String(v);

  const handleDownloadPdf = async () => {
    try {
      setIsGeneratingPdf(true);

      // Generate PDF on-demand — no longer stored in R2 at save time
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


  const formatDate = (d: string) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
  };

  let payments: any[] = [];
  try { payments = typeof booking.payment_details === "string" ? JSON.parse(booking.payment_details) : (booking.payment_details || []); } catch { payments = []; }
  
  const parseAmount = (val: any) => {
    if (!val) return 0;
    let str = String(val).toLowerCase().replace(/[₹\s,]/g, "");
    if (str.includes("lakh")) return (parseFloat(str) || 0) * 100000;
    if (str.includes("cr")) return (parseFloat(str) || 0) * 10000000;
    return parseFloat(str) || 0;
  };
  
  const totalAmount = payments.reduce((sum: number, r: any) => sum + parseAmount(r.amount), 0);

  const renderTabs = () => {
    const tabs = [
      { id: "summary", label: "Booking Summary", icon: <FaFileInvoice /> },
      { id: "payments", label: "Payment History", icon: <FaMoneyBillWave /> },
      { id: "documents", label: "Documents", icon: <FaFolderOpen /> },
      { id: "timeline", label: "Timeline", icon: <FaHistory /> },
      { id: "crm", label: "CRM Details", icon: <FaIdCard /> },
    ];

    return (
      <div className={`flex flex-wrap gap-2 mb-6 border p-1.5 rounded-xl ${isDark ? "bg-[#14141B] border-[#2A2A35]" : "bg-[#F8FAFC] border-[#E5E7EB]"}`}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center justify-center gap-2 flex-1 py-2.5 px-3 text-xs md:text-sm font-bold rounded-lg transition-all cursor-pointer ${isActive ? (isDark ? "bg-[#9E217B] text-white shadow-md" : "bg-[#9E217B] text-white shadow-md") : `${textMuted} hover:bg-black/5 dark:hover:bg-white/5 hover:text-current`}`}
            >
              {tab.icon} <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderPayments = () => (
    <div className={`rounded-2xl border p-5 ${bgCard} animate-fadeIn`}>
      <h3 className={`text-lg font-bold mb-4 ${accent}`}>Payment Schedule & History</h3>
      {payments.length === 0 ? (
        <div className={`p-8 text-center rounded-xl border ${isDark ? "border-[#2A2A35] bg-[#1A1A28]" : "border-[#E5E7EB] bg-[#F8FAFC]"}`}>
          <p className={textMuted}>No payments recorded.</p>
        </div>
      ) : (
        <div className={`rounded-xl border overflow-hidden ${isDark ? "border-[#2A2A35]" : "border-[#E5E7EB]"}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={isDark ? "bg-[#1A1A28]" : "bg-[#F8FAFC]"}>
                <th className={`text-left px-4 py-3 text-xs font-bold ${textMuted}`}>Date</th>
                <th className={`text-left px-4 py-3 text-xs font-bold ${textMuted}`}>Transaction Detail</th>
                <th className={`text-right px-4 py-3 text-xs font-bold ${textMuted}`}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((row: any, i: number) => (
                <tr key={i} className={`border-t ${isDark ? "border-[#2A2A35]" : "border-[#F1F5F9]"}`}>
                  <td className={`px-4 py-3 text-sm ${textMain}`}>{row.date}</td>
                  <td className={`px-4 py-3 text-sm ${textMain}`}>{row.transaction_type}</td>
                  <td className={`px-4 py-3 text-right text-sm font-bold ${textMain}`}>₹{parseAmount(row.amount).toLocaleString("en-IN")}</td>
                </tr>
              ))}
              {totalAmount > 0 && (
                <tr className={`border-t ${isDark ? "border-[#9E217B]/30 bg-[#9E217B]/10" : "border-[#9E217B]/20 bg-[#9E217B]/5"}`}>
                  <td colSpan={2} className={`px-4 py-4 text-sm font-black text-right ${accent}`}>Total Amount Received</td>
                  <td className={`px-4 py-4 text-base font-black text-right ${accent}`}>₹{totalAmount.toLocaleString("en-IN")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderDocuments = () => {
    let parsedJointApplicants: any[] = [];
    if (booking?.joint_applicants) {
      try {
        parsedJointApplicants = typeof booking.joint_applicants === 'string' 
          ? JSON.parse(booking.joint_applicants) 
          : booking.joint_applicants;
      } catch (e) {
        parsedJointApplicants = [];
      }
    }

    const docs = [
      { name: "Booking Application Form", type: "PDF", status: "Generated", url: null },
      { name: "Primary Applicant PAN Card", type: "Image/PDF", status: booking?.primary_pan_url ? "Available" : "Pending", url: booking?.primary_pan_url },
      { name: "Primary Applicant Aadhaar (Front)", type: "Image/PDF", status: booking?.primary_aadhaar_front_url ? "Available" : "Pending", url: booking?.primary_aadhaar_front_url },
      ...(booking?.primary_aadhaar_back_url ? [{ name: "Primary Applicant Aadhaar (Back)", type: "Image/PDF", status: "Available", url: booking.primary_aadhaar_back_url }] : []),
      ...parsedJointApplicants.flatMap((ja, i) => [
        { name: `Joint Applicant ${i+1} PAN Card`, type: "Image/PDF", status: ja.pan_url ? "Available" : "Pending", url: ja.pan_url },
        { name: `Joint Applicant ${i+1} Aadhaar (Front)`, type: "Image/PDF", status: ja.aadhaar_front_url ? "Available" : "Pending", url: ja.aadhaar_front_url },
        ...(ja.aadhaar_back_url ? [{ name: `Joint Applicant ${i+1} Aadhaar (Back)`, type: "Image/PDF", status: "Available", url: ja.aadhaar_back_url }] : [])
      ]),
      { name: "Payment Receipts", type: "PDF", status: "Generated", url: null },
      { name: "Allotment Letter", type: "PDF", status: "Pending", url: null },
      { name: "Agreement to Sale", type: "PDF", status: "Pending", url: null },
    ];
    return (
      <div className={`rounded-2xl border p-5 ${bgCard} animate-fadeIn`}>
        <h3 className={`text-lg font-bold mb-4 ${accent}`}>Document Repository</h3>
        <div className="grid gap-3">
          {docs.map((doc, i) => (
            <div key={i} className={`flex items-center justify-between p-4 rounded-xl border ${isDark ? "border-[#2A2A35] bg-[#14141B]" : "border-[#E5E7EB] bg-[#F8FAFC]"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${isDark ? "bg-[#2A2A35] text-[#888899]" : "bg-white border text-gray-400"}`}>
                  <FaFolderOpen />
                </div>
                <div>
                  <p className={`font-bold text-sm ${textMain}`}>{doc.name}</p>
                  <p className={`text-xs ${textMuted}`}>{doc.type} • {doc.status}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {doc.status !== "Pending" ? (
                  <>
                    <button 
                      onClick={() => {
                        if (doc.url) window.open(doc.url, "_blank");
                        else if (doc.name === "Booking Application Form") handleDownloadPdf();
                        else if (doc.name === "Payment Receipts") window.print();
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${isDark ? "border-[#9E217B]/50 text-[#9E217B] hover:bg-[#9E217B]/10" : "border-[#9E217B]/30 text-[#9E217B] hover:bg-[#9E217B]/10"}`}
                    >
                      View
                    </button>
                    <button 
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${isDark ? "bg-[#9E217B] text-white hover:bg-[#7a1960]" : "bg-[#9E217B] text-white hover:bg-[#7a1960]"}`} 
                      onClick={handleDownloadPdf}
                      disabled={isGeneratingPdf}
                    >
                      {isGeneratingPdf && doc.name === "Booking Application Form" ? "Generating..." : "Download"}
                    </button>
                  </>
                ) : (
                  <button className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-not-allowed ${isDark ? "border-[#2A2A35] text-[#555]" : "border-[#E5E7EB] text-gray-300"}`} disabled>Unavailable</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    const steps = [
      { title: "Lead Created", date: lead?.created_at ? formatDate(lead.created_at) : "—", done: true },
      { title: "Assigned to Sales", date: lead?.assigned_to ? "Completed" : "—", done: !!lead?.assigned_to },
      { title: "Site Visit Conducted", date: lead?.mongoVisitDate ? formatDate(lead.mongoVisitDate) : "—", done: !!lead?.mongoVisitDate },
      { title: "Lead Interested", date: lead?.leadInterestStatus ? "Completed" : "—", done: lead?.leadInterestStatus === "Interested" || lead?.leadInterestStatus === "Highly Interested" || true },
      { title: "Booking Form Submitted", date: booking?.application_date ? formatDate(booking.application_date) : "—", done: !!booking },
      { title: "Booking Confirmed", date: booking?.booking_status === "Approved" ? "Approved" : "Pending", done: booking?.booking_status === "Approved" },
      { title: "Lead Closed", date: booking?.booking_status === "Approved" ? "Completed" : "Pending", done: booking?.booking_status === "Approved" },
    ];

    return (
      <div className={`rounded-2xl border p-5 ${bgCard} animate-fadeIn`}>
        <h3 className={`text-lg font-bold mb-6 ${accent}`}>Booking Pipeline</h3>
        <div className="relative pl-6 border-l-2 border-[#9E217B]/20 space-y-6">
          {steps.map((s, i) => (
            <div key={i} className="relative">
              <div className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 ${isDark ? "bg-[#121218]" : "bg-white"} ${s.done ? "border-[#9E217B] bg-[#9E217B]" : isDark ? "border-[#2A2A35]" : "border-gray-300"}`} />
              <p className={`font-bold text-sm ${s.done ? textMain : textMuted}`}>{s.title}</p>
              <p className={`text-xs mt-0.5 ${textMuted}`}>{s.date}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCrmDetails = () => (
    <div className={`rounded-2xl border p-5 ${bgCard} animate-fadeIn`}>
      <div className="flex items-center justify-between cursor-pointer mb-2" onClick={() => setCrmOpen(!crmOpen)}>
        <h3 className={`text-lg font-bold flex items-center gap-2 ${accent}`}><FaIdCard /> Original CRM Lead Information</h3>
        <button className={`p-2 rounded-full ${isDark ? "bg-[#2A2A35] text-white" : "bg-gray-100 text-gray-600"}`}>
          {crmOpen ? <FaChevronDown /> : <FaChevronRight />}
        </button>
      </div>
      
      {crmOpen && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-4 animate-fadeIn">
          {[
            { label: "Lead Source", val: safeVal(lead?.source) },
            { label: "Original Budget", val: safeVal(lead?.budget) },
            { label: "Original Configuration", val: safeVal(lead?.configuration) },
            { label: "Original Purpose", val: safeVal(lead?.purpose) },
            { label: "Backdated Entry", val: lead?.auto_date_enabled === false && lead?.enquiry_date ? formatDate(lead.enquiry_date) : "Null" },
            { label: "Date Created", val: lead?.created_at ? formatDate(lead.created_at) : "—" },
            { label: "Receptionist", val: safeVal(lead?.receptionist) },
            { label: "Site Head", val: safeVal(lead?.site_head) },
            { label: "Sales Manager", val: safeVal(lead?.assigned_to) },
            { label: "Phone", val: safeVal(lead?.phone) },
            { label: "Alt Phone", val: safeVal(lead?.altPhone) },
            { label: "Email", val: safeVal(lead?.email) },
          ].map((f, i) => (
            <div key={i}>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${textMuted}`}>{f.label}</p>
              <p className={`text-sm font-semibold ${textMain}`}>{f.val}</p>
            </div>
          ))}
        </div>
      )}
      {!crmOpen && <p className={`text-xs ${textMuted}`}>Click to expand original enquiry details.</p>}
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-transparent animate-fadeIn">
      {renderTabs()}
      
      <div className="flex-1 overflow-y-auto custom-scrollbar pb-10">
        {activeTab === "summary" && (
          <BookingApplicationView
            booking={booking}
            lead={lead}
            isDark={isDark}
            userRole={userRole}
            onEdit={onEdit}
            onApprove={onApprove}
            onCancel={onCancel}
          />
        )}
        {activeTab === "payments" && renderPayments()}
        {activeTab === "documents" && renderDocuments()}
        {activeTab === "timeline" && renderTimeline()}
        {activeTab === "crm" && renderCrmDetails()}
      </div>
    </div>
  );
}
