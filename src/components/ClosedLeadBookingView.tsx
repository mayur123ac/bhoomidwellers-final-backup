"use client";
import React, { useState, useEffect } from "react";
import {
  FaFileInvoice, FaMoneyBillWave, FaFolderOpen, FaHistory, FaIdCard,
  FaCheckCircle, FaPrint, FaDownload, FaEdit, FaChevronDown, FaChevronRight,
  FaMapMarkerAlt, FaUpload, FaSpinner, FaCalendarAlt
} from "react-icons/fa";
import { formatCurrencyDisplay } from "@/lib/currency";
import BookingApplicationView from "./BookingApplicationView";
import BookingFormModal from "./BookingFormModal";
import CancellationModal from "./CancellationModal";

interface ClosedLeadBookingViewProps {
  currentUser?: any;
  onRefetch?: () => void;
  booking: any;
  lead: any;
  userRole: string; // "receptionist" | "sales" | "site_head" | "admin"
  isDark?: boolean;
  onEdit?: () => void;
  onApprove?: () => void;
  onCancel?: () => void;
}

export default function ClosedLeadBookingView({
  booking, lead, userRole, isDark = false, onEdit, onApprove, currentUser, onRefetch
}: ClosedLeadBookingViewProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "payments" | "documents" | "timeline" | "crm">("summary");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editCancelOpen, setEditCancelOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [crmOpen, setCrmOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [extendedDetails, setExtendedDetails] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);

  React.useEffect(() => {
    if (booking?.id) {
      fetch(`/api/booking-details/${booking.id}`)
        .then(res => res.json())
        .then(json => {
          if (json.success) setExtendedDetails(json.data);
        })
        .catch(console.error);
    }
  }, [booking?.id]);

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

  const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>, docType: string) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("document_type", docType);
      formData.append("uploaded_by", userRole); // using userRole or pass real name if available

      const res = await fetch(`/api/booking-documents/${booking.id}`, { method: "POST", body: formData });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to upload document");

      // Refresh extended details
      const detailRes = await fetch(`/api/booking-details/${booking.id}`);
      const detailJson = await detailRes.json();
      if (detailJson.success) setExtendedDetails(detailJson.data);
      
    } catch (err: any) {
      alert(`Upload Failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

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

    const fetchedDocs = extendedDetails?.documents || [];
    const findDoc = (type: string) => fetchedDocs.find((d: any) => d.document_type === type);

    const baseDocs: any[] = [
      { name: "Booking Application Form", type: "PDF", isBase: true, status: "Generated", url: null },
      { name: "Primary Applicant PAN Card", type: "Image/PDF", isBase: true, status: booking?.primary_pan_url ? "Available" : "Pending", url: booking?.primary_pan_url },
      { name: "Primary Applicant Aadhaar (Front)", type: "Image/PDF", isBase: true, status: booking?.primary_aadhaar_front_url ? "Available" : "Pending", url: booking?.primary_aadhaar_front_url },
      ...(booking?.primary_aadhaar_back_url ? [{ name: "Primary Applicant Aadhaar (Back)", type: "Image/PDF", isBase: true, status: "Available", url: booking.primary_aadhaar_back_url }] : []),
      ...parsedJointApplicants.flatMap((ja, i) => [
        { name: `Joint Applicant ${i+1} PAN Card`, type: "Image/PDF", isBase: true, status: ja.pan_url ? "Available" : "Pending", url: ja.pan_url },
        { name: `Joint Applicant ${i+1} Aadhaar (Front)`, type: "Image/PDF", isBase: true, status: ja.aadhaar_front_url ? "Available" : "Pending", url: ja.aadhaar_front_url },
        ...(ja.aadhaar_back_url ? [{ name: `Joint Applicant ${i+1} Aadhaar (Back)`, type: "Image/PDF", isBase: true, status: "Available", url: ja.aadhaar_back_url }] : [])
      ]),
    ];

    const extendedDocTypes = ["Payment Receipts", "OCR Receipt", "SDR Receipt", "Loan Sanction Letter", "Agreement Copy", "Registration Copy", "Other Documents"];
    const extDocs = extendedDocTypes.map(name => {
      const dbDoc = findDoc(name);
      return {
        name,
        type: "Any",
        isBase: false,
        status: dbDoc ? "Available" : "Pending",
        url: dbDoc ? `/api/documents/proxy?key=${encodeURIComponent(dbDoc.object_key)}` : null,
        dbDoc
      };
    });

    const docs = [...baseDocs, ...extDocs];

    return (
      <div className={`rounded-2xl border p-5 ${bgCard} animate-fadeIn`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className={`text-lg font-bold ${accent}`}>Document Repository</h3>
          {isUploading && <span className="flex items-center gap-2 text-xs text-[#00AEEF]"><FaSpinner className="animate-spin" /> Uploading...</span>}
        </div>
        <div className="grid gap-3">
          {docs.map((doc, i) => (
            <div key={i} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border gap-4 ${isDark ? "border-[#2A2A35] bg-[#14141B]" : "border-[#E5E7EB] bg-[#F8FAFC]"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0 ${isDark ? "bg-[#2A2A35] text-[#888899]" : "bg-white border text-gray-400"}`}>
                  <FaFolderOpen />
                </div>
                <div>
                  <p className={`font-bold text-sm ${textMain}`}>{doc.name}</p>
                  <p className={`text-xs ${textMuted}`}>
                    {doc.type} • {doc.status}
                    {doc.dbDoc?.uploaded_at && ` • Uploaded: ${formatDate(doc.dbDoc.uploaded_at)}`}
                  </p>
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
                    {!doc.url && doc.name === "Booking Application Form" ? (
                      <button 
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${isDark ? "bg-[#9E217B] text-white hover:bg-[#7a1960]" : "bg-[#9E217B] text-white hover:bg-[#7a1960]"}`} 
                        onClick={handleDownloadPdf}
                        disabled={isGeneratingPdf}
                      >
                        {isGeneratingPdf ? "Generating..." : "Download"}
                      </button>
                    ) : doc.url ? (
                      <button 
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${isDark ? "bg-[#9E217B] text-white hover:bg-[#7a1960]" : "bg-[#9E217B] text-white hover:bg-[#7a1960]"}`} 
                        onClick={() => window.open(doc.url as string, "_blank")}
                      >
                        Download
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {!doc.isBase && (
                      <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors bg-[#9E217B] text-white hover:bg-[#7a1960]`}>
                        <FaUpload className="text-[10px]" /> Upload
                        <input type="file" className="hidden" onChange={e => handleUploadDocument(e, doc.name)} />
                      </label>
                    )}
                    {doc.isBase && (
                      <button className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-not-allowed ${isDark ? "border-[#2A2A35] text-[#555]" : "border-[#E5E7EB] text-gray-300"}`} disabled>Unavailable</button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const calculateDays = (start: string, end: string) => {
    if (!start || !end) return null;
    const d1 = new Date(start).getTime();
    const d2 = new Date(end).getTime();
    return Math.max(0, Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)));
  };

  const fetchHistory = async () => {
    if (!booking?.id) return;
    setIsHistoryLoading(true);
    try {
      const res = await fetch(`/api/booking-applications/${booking.id}/history`);
      const json = await res.json();
      if (json.success) setHistory(json.data);
    } catch (e) {
      console.error("Failed to load history", e);
    }
    setIsHistoryLoading(false);
  };

  useEffect(() => {
    if (activeTab === "timeline") {
      fetchHistory();
    }
  }, [activeTab, booking?.id]);

  const renderTimeline = () => {
    return (
      <div className="space-y-6">
        <h3 className={`text-lg font-bold mb-4 ${isDark ? "text-white" : "text-gray-800"}`}>Timeline & Audit Log</h3>
        {isHistoryLoading ? (
          <p className="text-sm text-gray-500">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500">No modification history found.</p>
        ) : (
          <div className="space-y-4">
            {history.map((entry, idx) => (
              <div key={idx} className={`p-4 rounded-xl border ${isDark ? "bg-[#222] border-white/10" : "bg-gray-50 border-gray-200"}`}>
                <div className="flex items-center justify-between mb-3 border-b pb-2 border-white/10">
                  <div>
                    <span className="font-bold text-sm block">{entry.updated_by}</span>
                    <span className="text-xs text-gray-500 capitalize">{entry.user_role}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold block">{new Date(entry.created_at).toLocaleDateString()}</span>
                    <span className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {Object.keys(entry.changed_fields).map(field => {
                    const changes = entry.changed_fields[field];
                    return (
                      <div key={field} className="grid grid-cols-[120px_1fr] text-sm items-start gap-2">
                        <span className="font-medium text-gray-500 capitalize truncate">{field.replace(/_/g, " ")}:</span>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                          <span className={`px-2 py-0.5 rounded text-xs line-through ${isDark ? "bg-red-900/30 text-red-400" : "bg-red-100 text-red-600"}`}>
                            {typeof changes.old_value === 'object' ? "Updated" : (changes.old_value || "None")}
                          </span>
                          <span className="text-gray-400 hidden sm:inline">→</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${isDark ? "bg-green-900/30 text-green-400" : "bg-green-100 text-green-700"}`}>
                            {typeof changes.new_value === 'object' ? "Updated" : (changes.new_value || "None")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
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
          <>
          <BookingApplicationView
            booking={booking}
            lead={lead}
            isDark={isDark}
            userRole={userRole}
            currentUser={currentUser}
            onEdit={() => setIsEditModalOpen(true)}
            onApprove={onApprove}
            onCancel={() => setCancelOpen(true)}
            onEditCancellation={() => setEditCancelOpen(true)}
          />
          {isEditModalOpen && (
            <BookingFormModal
              isOpen={isEditModalOpen}
              onClose={() => setIsEditModalOpen(false)}
              lead={lead}
              user={currentUser}
              isDark={isDark}
              existingBooking={booking}
              isEditMode={true}
              onSuccess={() => {
                setIsEditModalOpen(false);
                if (onRefetch) onRefetch();
              }}
            />
          )}
          <CancellationModal
            isOpen={cancelOpen} mode="cancel" booking={booking} user={currentUser} isDark={isDark}
            onClose={() => setCancelOpen(false)}
            onDone={() => { setCancelOpen(false); if (onRefetch) onRefetch(); }}
          />
          <CancellationModal
            isOpen={editCancelOpen} mode="edit" booking={booking} user={currentUser} isDark={isDark}
            onClose={() => setEditCancelOpen(false)}
            onDone={() => { setEditCancelOpen(false); if (onRefetch) onRefetch(); }}
          />
          </>
        )}
        {activeTab === "payments" && renderPayments()}
        {activeTab === "documents" && renderDocuments()}
        {activeTab === "timeline" && renderTimeline()}
        {activeTab === "crm" && renderCrmDetails()}
      </div>
    </div>
  );
}
