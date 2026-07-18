"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import * as XLSX from "xlsx";
import { clearCrmSession, getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useCallerSync } from "@/lib/hooks/useCallerSync";
import {
  FaThLarge, FaClipboardList, FaTimesCircle, FaUpload, FaFileExcel,
  FaPhoneAlt, FaEnvelope, FaMoneyBillWave, FaMapMarkerAlt, FaBullseye,
  FaCheckCircle, FaTimes, FaSave, FaPaperPlane, FaCalendarAlt,
  FaSearch, FaUser, FaAngleLeft, FaCog, FaLock,
  FaEye, FaWhatsapp, FaChartBar, FaUserTie, FaExclamationTriangle,
  FaDownload, FaCommentAlt, FaEdit, FaCheck, FaUndo, FaHeart,
  FaDatabase,
  FaTrash,
} from "react-icons/fa";
import { MdOutlinePhoneInTalk } from "react-icons/md";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type LeadSource = string;
interface RawLead {
  id: string; dbId?: number;
  name: string; phone: string; email?: string;
  source?: LeadSource; budget?: string; location?: string;
  feedback?: string; channelPartner?: string; assignManager?: string;
  srNo?: string; formNo?: string; date?: string;
  // DB-level public fields (shared across callers)
  dbStatus?: string;
  dbInterest?: string;
  dbSavedBy?: string;   // who owns/saved this lead
  [key: string]: any;
}
interface SavedLead extends RawLead {
  savedAt: string; followUps: FollowUp[];
  status: "saved" | "interested" | "not_interested";
  interestStatus?: "Interested" | "Not Interested" | "Maybe";
  siteVisitDate?: string;
}
interface FollowUp { id: string; message: string; createdAt: string; createdBy: string; }
type SidebarSection = "dashboard" | "forms" | "interested" | "not_interested";
type DBState = "idle" | "saving" | "saved" | "error";

// ─────────────────────────────────────────────
// TEMPLATE EXPORT
// ─────────────────────────────────────────────
const exportTemplate = () => {
  const headers = ["Sr No.", "Form No.", "Date", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback"];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads Template");
  XLSX.writeFile(wb, "leads_template.xlsx");
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const formatDate = (ds?: string) => {
  if (!ds) return "—";
  try { return new Date(ds).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ds; }
};
const maskPhone = (phone?: string) => {
  if (!phone) return "N/A";
  const c = String(phone).replace(/\D/g, "");
  return c.length <= 5 ? c : `${c.slice(0, 2)}*****${c.slice(-3)}`;
};
const SOURCE_COLORS: Record<string, string> = {
  Website: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  Facebook: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
  Instagram: "text-pink-400 bg-pink-500/10 border-pink-500/30",
  Referral: "text-green-400 bg-green-500/10 border-green-500/30",
  CP: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  Outdoor: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  Other: "text-gray-400 bg-gray-500/10 border-gray-500/30",
};
const sourceBadge = (src?: string) => {
  const cls = SOURCE_COLORS[src || "Other"] ?? SOURCE_COLORS["Other"];
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cls}`}>{src || "Unknown"}</span>;
};
const interestBadge = (status?: string) => {
  if (!status) return null;
  const map: Record<string, string> = {
    Interested: "text-green-400 bg-green-500/10 border-green-500/30",
    "Not Interested": "text-red-400 bg-red-500/10 border-red-500/30",
    Maybe: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
  };
  return <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${map[status] ?? "text-gray-400 bg-gray-500/10 border-gray-500/30"}`}>{status}</span>;
};

// ── Public interest cell — reads from DB fields, visible to ALL callers ──
function InterestCell({ lead }: { lead: RawLead }) {
  const status = lead.dbStatus || "new";
  const interest = lead.dbInterest || "";
  const savedBy = lead.dbSavedBy || "";

  if (status === "new" && !interest) {
    return <span className="text-[10px] text-gray-600 italic">Not saved</span>;
  }
  if (interest) {
    const map: Record<string, string> = {
      "Interested": "text-green-400 bg-green-500/10 border-green-500/30",
      "Not Interested": "text-red-400 bg-red-500/10 border-red-500/30",
      "Maybe": "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    };
    const dot: Record<string, string> = {
      "Interested": "bg-green-400", "Not Interested": "bg-red-400", "Maybe": "bg-yellow-400"
    };
    return (
      <div className="flex flex-col gap-0.5">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${map[interest] ?? "text-gray-400 bg-gray-500/10 border-gray-500/30"}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot[interest] ?? ""}`} />
          {interest}
        </span>
        {savedBy && <span className="text-[9px] text-gray-600 pl-1">by {savedBy}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold text-gray-500 bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-0.5 rounded-full">Pending</span>
      {savedBy && <span className="text-[9px] text-gray-600 pl-1">by {savedBy}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────
async function apiUpdateLead(dbId: number | undefined, updates: Record<string, any>) {
  if (!dbId) return;
  await fetch(`/api/caller-leads/${dbId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  }).catch(() => { });
}
async function apiSaveFollowUp(dbId: number | undefined, message: string, createdBy: string) {
  if (!dbId) return;
  await fetch(`/api/caller-leads/${dbId}/follow-ups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, created_by: createdBy })
  }).catch(() => { });
}

// ─────────────────────────────────────────────
// TICKET POPUP
// ─────────────────────────────────────────────
function TicketPopup({ lead, onClose, onSave, alreadySaved, isLocked, lockedBy, onFeedbackChange, callerName }: {
  lead: RawLead;
  onClose: () => void;
  onSave: (lead: RawLead) => void;
  alreadySaved: boolean;
  isLocked: boolean;
  lockedBy: string;
  onFeedbackChange: (id: string, feedback: string) => void;
  callerName: string;
}) {
  const [feedback, setFeedback] = useState(lead.feedback || "");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-fadeIn" onClick={e => e.stopPropagation()}>

        {/* Locked overlay */}
        {isLocked && (
          <div className="absolute inset-0 bg-[#0a0a0a]/80 rounded-2xl z-10 flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
            <div className="w-14 h-14 bg-red-900/30 border border-red-500/30 rounded-full flex items-center justify-center">
              <FaLock className="text-red-400 text-xl" />
            </div>
            <p className="text-white font-bold text-lg">Lead Locked</p>
            <p className="text-gray-400 text-sm text-center px-4">
              This lead has been saved by <span className="text-purple-400 font-bold">{lockedBy}</span>.<br />
              You cannot access it.
            </p>
            <button onClick={onClose} className="mt-2 bg-[#222] hover:bg-[#333] border border-[#333] text-gray-300 font-semibold py-2 px-6 rounded-xl cursor-pointer text-sm">
              Close
            </button>
          </div>
        )}

        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] text-purple-400 font-bold uppercase tracking-wider mb-1">Lead Ticket</p>
            <h2 className="text-xl font-bold text-white">{lead.name}</h2>
            {lead.dbId && <p className="text-[10px] text-gray-600 mt-0.5 flex items-center gap-1"><FaDatabase className="text-[8px] text-green-500" />DB #{lead.dbId}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 cursor-pointer"><FaTimes /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="col-span-2 bg-[#222] rounded-xl p-3 border border-[#333]">
            <p className="text-[10px] text-gray-500 mb-1 flex items-center gap-1"><FaPhoneAlt className="text-[9px]" />Contact No.</p>
            <p className="text-white font-mono font-semibold">{lead.phone || "N/A"}</p>
          </div>
          {lead.email && <div className="col-span-2 bg-[#222] rounded-xl p-3 border border-[#333]"><p className="text-[10px] text-gray-500 mb-1">Email</p><p className="text-white font-semibold text-sm truncate">{lead.email}</p></div>}
          {lead.channelPartner && <div className="bg-[#222] rounded-xl p-3 border border-[#333]"><p className="text-[10px] text-gray-500 mb-1">Channel Partner</p><p className="text-white font-semibold text-sm">{lead.channelPartner}</p></div>}
          {lead.assignManager && <div className="bg-[#222] rounded-xl p-3 border border-[#333]"><p className="text-[10px] text-gray-500 mb-1">Assign Manager</p><p className="text-white font-semibold text-sm">{lead.assignManager}</p></div>}
          <div className="col-span-2 flex items-center justify-between bg-[#222] rounded-xl p-3 border border-[#333]">
            <div><p className="text-[10px] text-gray-500 mb-1">Source</p>{sourceBadge(lead.source)}</div>
            <div className="text-right"><p className="text-[10px] text-gray-500 mb-1">Lead ID</p><p className="text-purple-400 font-bold font-mono">#{lead.sr_no || lead.id}</p></div>
          </div>
          <div className="col-span-2 bg-[#222] rounded-xl p-3 border border-[#333]">
            <p className="text-[10px] text-gray-500 mb-2 flex items-center gap-1"><FaCommentAlt className="text-[9px]" />Feedback</p>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              onBlur={() => { if (feedback !== (lead.feedback || "")) onFeedbackChange(lead.id, feedback); }}
              placeholder="Add caller feedback..." rows={3}
              className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500 resize-none" />
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 bg-[#222] hover:bg-[#333] border border-[#333] text-gray-300 font-semibold py-2.5 rounded-xl cursor-pointer text-sm">Close</button>
          <button
            onClick={() => { if (feedback !== (lead.feedback || "")) onFeedbackChange(lead.id, feedback); onSave({ ...lead, feedback }); onClose(); }}
            disabled={alreadySaved}
            className={`flex-1 flex items-center justify-center gap-2 font-bold py-2.5 rounded-xl cursor-pointer text-sm shadow-lg ${alreadySaved ? "bg-green-800/30 border border-green-600/30 text-green-400 cursor-not-allowed" : "bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20"}`}>
            {alreadySaved ? <><FaCheckCircle />Saved</> : <><FaSave />Save to Forms</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DETAIL VIEW
// ─────────────────────────────────────────────
function LeadDetailView({ lead, onBack, onUpdateLead, callerName }: {
  lead: SavedLead; onBack: () => void; onUpdateLead: (updated: SavedLead) => void; callerName: string;
}) {
  const [noteInput, setNoteInput] = useState("");
  const [visitDate, setVisitDate] = useState(lead.siteVisitDate || "");
  const followUpEndRef = useRef<HTMLDivElement>(null);
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({
    name: lead.name, phone: lead.phone || "", email: lead.email || "",
    budget: lead.budget || "", location: lead.location || "",
    source: lead.source || "", channelPartner: lead.channelPartner || "",
    assignManager: lead.assignManager || ""
  });
  const [feedbackDraft, setFeedbackDraft] = useState(lead.feedback || "");
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  useEffect(() => {
    if (!editingInfo) setInfoDraft({
      name: lead.name, phone: lead.phone || "", email: lead.email || "",
      budget: lead.budget || "", location: lead.location || "",
      source: lead.source || "", channelPartner: lead.channelPartner || "",
      assignManager: lead.assignManager || ""
    });
    setFeedbackDraft(lead.feedback || "");
  }, [lead]);
  useEffect(() => { followUpEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lead.followUps]);

  const saveInfo = async () => {
    onUpdateLead({ ...lead, ...infoDraft });
    setEditingInfo(false);
    await apiUpdateLead(lead.dbId, {
      name: infoDraft.name, contact_no: infoDraft.phone, email: infoDraft.email,
      budget: infoDraft.budget, location: infoDraft.location, source: infoDraft.source,
      channel_partner: infoDraft.channelPartner, assign_manager: infoDraft.assignManager
    });
  };
  const saveFeedback = async () => {
    onUpdateLead({ ...lead, feedback: feedbackDraft });
    setFeedbackSaved(true);
    setTimeout(() => setFeedbackSaved(false), 2000);
    await apiUpdateLead(lead.dbId, { feedback: feedbackDraft });
  };
  const sendNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim()) return;
    const fu: FollowUp = { id: Date.now().toString(), message: noteInput, createdAt: new Date().toISOString(), createdBy: callerName };
    onUpdateLead({ ...lead, followUps: [...lead.followUps, fu] });
    const msg = noteInput.trim();
    setNoteInput("");
    await apiSaveFollowUp(lead.dbId, msg, callerName);
  };
  const setInterest = async (status: "Interested" | "Not Interested" | "Maybe") => {
    const dbStatus = status === "Not Interested" ? "not_interested" : "saved";
    onUpdateLead({ ...lead, interestStatus: status, status: dbStatus });
    await apiUpdateLead(lead.dbId, { interest_status: status, status: dbStatus });
  };
  const scheduleVisit = async () => {
    if (!visitDate) return;
    const fu: FollowUp = { id: Date.now().toString(), message: `📅 Site visit scheduled for ${formatDate(visitDate)}`, createdAt: new Date().toISOString(), createdBy: callerName };
    onUpdateLead({ ...lead, siteVisitDate: visitDate, followUps: [...lead.followUps, fu] });
    await apiUpdateLead(lead.dbId, { site_visit_date: visitDate });
    await apiSaveFollowUp(lead.dbId, fu.message, callerName);
  };

  const inputCls = "w-full bg-[#111] border border-[#2a2a2a] focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-white outline-none transition-colors";
  const viewFields = [
    { label: "Name", value: lead.name, icon: <FaUser className="text-[10px]" /> },
    { label: "Phone", value: lead.phone, icon: <FaPhoneAlt className="text-[10px]" />, mono: true },
    { label: "Email", value: lead.email, icon: <FaEnvelope className="text-[10px]" /> },
    { label: "Budget", value: lead.budget, icon: <FaMoneyBillWave className="text-[10px]" />, green: true },
    { label: "Location", value: lead.location, icon: <FaMapMarkerAlt className="text-[10px]" /> },
    { label: "Source", value: lead.source, icon: <FaBullseye className="text-[10px]" /> },
    { label: "Channel Partner", value: lead.channelPartner, icon: <FaUserTie className="text-[10px]" /> },
    { label: "Assign Manager", value: lead.assignManager, icon: <FaUser className="text-[10px]" /> },
  ];
  const editFields = [
    { label: "Name", key: "name" as const, icon: <FaUser className="text-[10px]" /> },
    { label: "Phone", key: "phone" as const, icon: <FaPhoneAlt className="text-[10px]" /> },
    { label: "Email", key: "email" as const, icon: <FaEnvelope className="text-[10px]" /> },
    { label: "Budget", key: "budget" as const, icon: <FaMoneyBillWave className="text-[10px]" /> },
    { label: "Location", key: "location" as const, icon: <FaMapMarkerAlt className="text-[10px]" /> },
    { label: "Source", key: "source" as const, icon: <FaBullseye className="text-[10px]" /> },
    { label: "Channel Partner", key: "channelPartner" as const, icon: <FaUserTie className="text-[10px]" /> },
    { label: "Assign Manager", key: "assignManager" as const, icon: <FaUser className="text-[10px]" /> },
  ] as { label: string; key: keyof typeof infoDraft; icon: React.ReactNode }[];

  return (
    <div className="animate-fadeIn flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-4 flex-shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 flex items-center justify-center bg-[#222] hover:bg-[#333] border border-[#444] rounded-lg text-gray-400 cursor-pointer"><FaAngleLeft /></button>
          <div>
            <h1 className="text-lg font-bold text-white">{lead.name}</h1>
            <p className="text-xs text-gray-500 flex items-center gap-2">
              Saved {formatDate(lead.savedAt)}
              {lead.dbId && <span className="flex items-center gap-1 text-green-600"><FaDatabase className="text-[8px]" />DB #{lead.dbId}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lead.interestStatus && interestBadge(lead.interestStatus)}
          {lead.interestStatus !== "Interested" && <button onClick={() => setInterest("Interested")} className="flex items-center gap-2 bg-green-600/10 hover:bg-green-600 border border-green-500/30 text-green-400 hover:text-white font-bold px-3 py-2 rounded-lg text-xs cursor-pointer transition-all"><FaCheckCircle />Interested</button>}
          {lead.interestStatus !== "Not Interested" && <button onClick={() => setInterest("Not Interested")} className="flex items-center gap-2 bg-red-600/10 hover:bg-red-600 border border-red-500/30 text-red-400 hover:text-white font-bold px-3 py-2 rounded-lg text-xs cursor-pointer transition-all"><FaTimes />Not Interested</button>}
          {lead.interestStatus !== "Maybe" && <button onClick={() => setInterest("Maybe")} className="flex items-center gap-2 bg-yellow-600/10 hover:bg-yellow-600 border border-yellow-500/30 text-yellow-400 hover:text-white font-bold px-3 py-2 rounded-lg text-xs cursor-pointer transition-all">Maybe</button>}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        <div className="w-full lg:w-[42%] flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-1">
          {/* Personal Info */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4 border-b border-[#2a2a2a] pb-2">
              <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider">Personal Information</h3>
              {!editingInfo
                ? <button onClick={() => setEditingInfo(true)} className="flex items-center gap-1.5 bg-[#222] hover:bg-purple-600/20 border border-[#333] hover:border-purple-500/50 text-gray-400 hover:text-purple-400 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all"><FaEdit className="text-[9px]" />Edit</button>
                : <div className="flex gap-2">
                  <button onClick={() => setEditingInfo(false)} className="flex items-center gap-1.5 bg-[#222] border border-[#333] text-gray-400 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"><FaTimes className="text-[9px]" />Cancel</button>
                  <button onClick={saveInfo} className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer shadow-lg shadow-purple-600/20"><FaCheck className="text-[9px]" />Save</button>
                </div>}
            </div>
            {!editingInfo
              ? <div className="space-y-3 text-sm">{viewFields.map(({ label, value, icon, mono, green }: any) => <div key={label} className="flex justify-between items-start"><p className="text-gray-500 text-xs flex items-center gap-1 pt-0.5">{icon}{label}</p><p className={`text-right font-semibold max-w-[55%] break-words text-sm ${green ? "text-green-400" : "text-white"} ${mono ? "font-mono" : ""}`}>{value || "N/A"}</p></div>)}</div>
              : <div className="space-y-3">{editFields.map(({ label, key, icon }) => <div key={key}><label className="text-[10px] text-gray-500 flex items-center gap-1 mb-1">{icon}{label}</label><input type="text" value={infoDraft[key]} onChange={e => setInfoDraft(prev => ({ ...prev, [key]: e.target.value }))} className={inputCls} /></div>)}</div>}
          </div>

          {/* Feedback */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3 border-b border-[#2a2a2a] pb-2">
              <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2"><FaCommentAlt className="text-[10px]" />Feedback</h3>
              <button onClick={saveFeedback} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${feedbackSaved ? "bg-green-600/20 border border-green-500/40 text-green-400" : "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20"}`}>
                {feedbackSaved ? <><FaCheck className="text-[9px]" />Saved!</> : <><FaSave className="text-[9px]" />Save</>}
              </button>
            </div>
            <textarea value={feedbackDraft} onChange={e => setFeedbackDraft(e.target.value)} placeholder="Enter feedback..." rows={4} className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-purple-500 resize-none" />
          </div>

          {/* Site Visit */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-5">
            <h3 className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-4 border-b border-[#2a2a2a] pb-2 flex items-center gap-2"><FaCalendarAlt />Site Visit</h3>
            {lead.siteVisitDate
              ? <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 text-center mb-4"><p className="text-xs text-orange-400 font-bold mb-1">Scheduled</p><p className="text-white font-bold">{formatDate(lead.siteVisitDate)}</p></div>
              : <p className="text-gray-600 text-sm text-center py-2">No visit scheduled</p>}
            <div className="mt-2 space-y-2">
              <label className="text-xs text-gray-500">Schedule / Reschedule</label>
              <input ref={dtInputRef} type="datetime-local" value={visitDate} onChange={e => setVisitDate(e.target.value)} onClick={() => dtInputRef.current?.showPicker?.()} className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-orange-500" />
              <button onClick={scheduleVisit} disabled={!visitDate} className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 rounded-lg text-sm cursor-pointer">Confirm Visit</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button className="bg-blue-600/10 border border-blue-500/30 hover:bg-blue-600 text-blue-400 hover:text-white flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer gap-1"><MdOutlinePhoneInTalk className="text-lg" /><span className="font-bold text-[10px]">Browser Call</span></button>
            <button className="bg-green-600/10 border border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer gap-1"><FaWhatsapp className="text-xl" /><span className="font-bold text-[10px]">WhatsApp</span></button>
          </div>
        </div>

        {/* Follow-up */}
        <div className="w-full lg:w-[58%] flex flex-col bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-[#2a2a2a] bg-[#151515] flex-shrink-0">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2"><FaClipboardList className="text-purple-400" />Follow-up Timeline</h3>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-5 bg-[#111]">
            <div className="flex justify-start">
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl rounded-tl-none p-4 max-w-[85%] shadow-md">
                <div className="flex justify-between items-center mb-2 gap-6"><span className="font-bold text-xs text-purple-400">System</span><span className="text-[10px] text-gray-500">{formatDate(lead.savedAt)}</span></div>
                <p className="text-sm text-gray-300 leading-relaxed">Lead saved to Forms. Begin follow-up process.</p>
              </div>
            </div>
            {lead.followUps.map(fup => (
              <div key={fup.id} className="flex justify-start">
                <div className="bg-[#2a2135] border border-[#4c1d95] rounded-2xl rounded-tl-none p-4 max-w-[85%] shadow-lg">
                  <div className="flex justify-between items-center mb-2 gap-6"><span className="font-bold text-xs text-white">{fup.createdBy}</span><span className="text-[10px] text-gray-400">{formatDate(fup.createdAt)}</span></div>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{fup.message}</p>
                </div>
              </div>
            ))}
            {lead.followUps.length === 0 && <div className="flex-1 flex flex-col items-center justify-center text-gray-700 py-10"><FaClipboardList className="text-3xl mb-3 opacity-30" /><p className="text-sm">No follow-ups yet. Add the first note below.</p></div>}
            <div ref={followUpEndRef} />
          </div>
          <form onSubmit={sendNote} className="p-4 bg-[#1a1a1a] border-t border-[#2a2a2a] flex gap-3 items-center flex-shrink-0">
            <input type="text" value={noteInput} onChange={e => setNoteInput(e.target.value)} placeholder="Add follow-up note..." className="flex-1 bg-[#111] border border-[#333] rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-purple-500" />
            <button type="submit" className="w-12 h-12 bg-purple-600 hover:bg-purple-500 text-white rounded-xl flex items-center justify-center cursor-pointer shadow-lg flex-shrink-0"><FaPaperPlane className="text-sm" /></button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DASHBOARD SECTION
// ─────────────────────────────────────────────
function DashboardSection({ rawLeads, savedLeads, callerName }: { rawLeads: RawLead[]; savedLeads: SavedLead[]; callerName: string }) {
  const interested = savedLeads.filter(l => l.interestStatus === "Interested").length;
  const notInterested = savedLeads.filter(l => l.interestStatus === "Not Interested").length;
  const visits = savedLeads.filter(l => l.siteVisitDate).length;
  const pending = savedLeads.filter(l => !l.interestStatus).length;
  const sourceMap = rawLeads.reduce<Record<string, number>>((acc, l) => { const s = l.source || "Unknown"; acc[s] = (acc[s] || 0) + 1; return acc; }, {});
  const stats = [
    { label: "Total Uploaded", value: rawLeads.length, color: "text-white", bg: "bg-purple-500/10 border-purple-500/20" },
    { label: "Saved to Forms", value: savedLeads.length, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
    { label: "Interested", value: interested, color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
    { label: "Not Interested", value: notInterested, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
    { label: "Visits Scheduled", value: visits, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
    { label: "Pending Review", value: pending, color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
  ];
  return (
    <div className="animate-fadeIn space-y-8">
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6 flex justify-between items-center">
        <div><h2 className="text-xl font-bold text-white">Welcome, {callerName.split(" ")[0]}!</h2><p className="text-sm text-gray-500 mt-1">Presales Caller Dashboard — manage your lead pipeline below.</p></div>
        <div className="w-12 h-12 bg-purple-600/20 border border-purple-500/30 rounded-xl flex items-center justify-center text-purple-400 text-xl font-bold">{callerName.charAt(0).toUpperCase()}</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats.map(s => <div key={s.label} className={`rounded-2xl p-5 border ${s.bg}`}><p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">{s.label}</p><p className={`text-3xl font-black ${s.color}`}>{s.value}</p></div>)}
      </div>
      {Object.keys(sourceMap).length > 0 && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl p-6">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2"><FaChartBar className="text-purple-400" />Lead Source Breakdown</h3>
          <div className="space-y-3">
            {Object.entries(sourceMap).sort((a, b) => b[1] - a[1]).map(([src, count]) => {
              const pct = rawLeads.length > 0 ? Math.round((count / rawLeads.length) * 100) : 0;
              return <div key={src}><div className="flex justify-between text-xs mb-1"><span className="text-gray-400 font-medium">{src}</span><span className="text-white font-bold">{count} ({pct}%)</span></div><div className="w-full h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} /></div></div>;
            })}
          </div>
        </div>
      )}
      {rawLeads.length === 0 && (
        <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-12 text-center text-gray-600">
          <FaFileExcel className="text-5xl mx-auto mb-4 opacity-20" />
          <p className="font-semibold mb-1">No leads uploaded yet</p>
          <p className="text-sm">Upload an Excel file from the top bar to get started.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// INTERESTED SECTION
// ─────────────────────────────────────────────
function InterestedSection({ leads, onOpenDetail }: { leads: SavedLead[]; onOpenDetail: (lead: SavedLead) => void }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => leads.filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()) || l.phone.includes(search) || (l.channelPartner || "").toLowerCase().includes(search.toLowerCase()) || (l.assignManager || "").toLowerCase().includes(search.toLowerCase())), [leads, search]);
  return (
    <div className="animate-fadeIn">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-xl font-bold text-white flex items-center gap-2"><FaHeart className="text-green-400" />Interested Leads</h2>
        <span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{leads.length} leads</span>
      </div>
      {leads.length === 0
        ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaHeart className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold mb-1">No interested leads yet</p><p className="text-sm">Mark a lead as Interested from their detail view.</p></div>
        : <>
          <div className="mb-4"><div className="relative max-w-sm"><FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" /><input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#222] rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:border-green-500 outline-none" /></div></div>
          <div className="bg-[#111111] rounded-2xl border border-[#222] overflow-hidden shadow-sm">
            <div className="p-4 border-b border-[#222] bg-[#151515] flex justify-between items-center">
              <h3 className="font-bold text-white flex items-center gap-2 text-sm"><FaHeart className="text-green-400 text-xs" />Interested Leads Table</h3>
              <span className="text-[10px] text-gray-500 bg-[#222] px-2 py-0.5 rounded border border-[#333]">{filtered.length} of {leads.length} shown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-400">
                <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500">
                  <tr>{["#", "Name", "Phone", "Email", "Budget", "Location", "Source", "Channel Partner", "Assign Manager", "Site Visit", "Feedback", "Saved On", "Action"].map(h => <th key={h} className={`px-4 py-3 border-b border-[#222] whitespace-nowrap ${h === "Action" ? "text-center" : ""}`}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {filtered.length === 0
                    ? <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-600">No leads match your search.</td></tr>
                    : filtered.map((lead, idx) => (
                      <tr key={lead.id} className="hover:bg-[#1a1a1a] transition-colors group">
                        <td className="px-4 py-3"><span className="font-mono text-green-400 font-bold text-xs">#{String(idx + 1).padStart(2, "0")}</span></td>
                        <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">{lead.name}</td>
                        <td className="px-4 py-3 font-mono text-sm">{lead.phone || "—"}</td>
                        <td className="px-4 py-3 max-w-[140px] truncate text-gray-300">{lead.email || "—"}</td>
                        <td className="px-4 py-3 text-green-400 font-semibold whitespace-nowrap">{lead.budget || "—"}</td>
                        <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.location || "—"}</td>
                        <td className="px-4 py-3">{sourceBadge(lead.source)}</td>
                        <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.channelPartner || "—"}</td>
                        <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{lead.assignManager || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{lead.siteVisitDate ? <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">{formatDate(lead.siteVisitDate).split(",")[0]}</span> : <span className="text-gray-600 text-xs">Not scheduled</span>}</td>
                        <td className="px-4 py-3 max-w-[160px]">{lead.feedback ? <span className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1 inline-block truncate max-w-[150px]" title={lead.feedback}>{lead.feedback}</span> : <span className="text-gray-600 text-xs">—</span>}</td>
                        <td className="px-4 py-3 text-[11px] text-gray-500 whitespace-nowrap">{formatDate(lead.savedAt).split(",")[0]}</td>
                        <td className="px-4 py-3 text-center"><button onClick={() => onOpenDetail(lead)} className="text-gray-500 hover:text-green-400 cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-green-500/10 border border-transparent hover:border-green-500/20 mx-auto"><FaEye className="text-[10px]" />Open</button></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function PresalesCallerPanel() {
  const router = useRouter();
  const [user, setUser] = useState({ name: "Caller", role: "Caller", email: "" });
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [section, setSection] = useState<SidebarSection>("dashboard");
  const [rawLeads, setRawLeads] = useState<RawLead[]>([]);
  const [savedLeads, setSavedLeads] = useState<SavedLead[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [ticketLead, setTicketLead] = useState<RawLead | null>(null);
  const [detailLead, setDetailLead] = useState<SavedLead | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dbState, setDbState] = useState<DBState>("idle");
  const [dbMessage, setDbMessage] = useState("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // ── Load user ──
  useEffect(() => {
    const cleanupBackGuard = installLoggedOutBackGuard(() => router.replace("/"));
    const storedUser = getStoredCrmUser();
    if (!storedUser) {
      router.replace("/");
    } else {
      queueMicrotask(() => setUser(storedUser));
    }
    return cleanupBackGuard;
  }, [router]);

  // ── Load from DB ──
  const loadFromDB = useCallback(async () => {
    try {
      const callerUser = getStoredCrmUser();
      if (!callerUser) {
        router.replace("/");
        return;
      }
      setDbState("saving"); setDbMessage("Loading your leads...");
      const res = await fetch("/api/caller-leads");
      if (!res.ok) { setDbState("idle"); setDbMessage(""); return; }
      const json = await res.json();
      const allLeads: any[] = json.leads || [];

      // Which leads this caller can SEE in dashboard (all unassigned + assigned to them)
      // const myLeads = allLeads.filter((l: any) => {
      //   const assignedTo = (l.assigned_to||"").toLowerCase().trim();
      //   const uploadedBy = (l.uploaded_by||"").toLowerCase().trim();
      //   const callerName = (callerUser.name||"").toLowerCase().trim();
      //   if (assignedTo===callerName || uploadedBy===callerName) return true;
      //   const isUnassigned    = !assignedTo || assignedTo==="admin" || assignedTo==="unknown";
      //   const uploadedByAdmin = !uploadedBy || uploadedBy==="admin" || uploadedBy==="unknown";
      //   return isUnassigned && uploadedByAdmin;
      // });
      const myLeads = allLeads;

      if (myLeads.length === 0) { setDbState("idle"); setDbMessage(""); return; }

      // Raw leads for dashboard — includes public DB fields
      const raw: RawLead[] = myLeads.map((l: any) => ({
        id: String(l.id).padStart(4, "0"),
        dbId: l.id,
        name: l.name,
        phone: l.contact_no || "",
        email: l.email || "",
        source: l.source || "",
        channelPartner: l.channel_partner || "",
        assignManager: l.assign_manager || "",
        feedback: l.feedback || "",
        srNo: l.sr_no || "",
        formNo: l.form_no || "",
        date: l.lead_date || "",
        budget: l.budget || "",
        location: l.location || "",
        // Public shared fields — visible to all callers in dashboard
        dbStatus: l.status || "new",
        dbInterest: l.interest_status || "",
        dbSavedBy: l.saved_by || "",
      }));
      setRawLeads(raw);

      // Private saved leads — ONLY for this caller
      const callerN = callerUser.name.toLowerCase().trim();
      const saved: SavedLead[] = myLeads
        .filter((l: any) => {
          const savedBy = (l.saved_by || "").toLowerCase().trim();
          const callerN = callerUser.name.toLowerCase().trim();
          const isSaved = l.status === "saved" || l.status === "not_interested" || !!l.interest_status;
          if (!isSaved) return false;

          // If saved_by is set — strict ownership
          if (savedBy && savedBy !== "admin" && savedBy !== "unknown") {
            return savedBy === callerN;
          }

          // No saved_by — legacy fallback, show to anyone who can see it
          // This handles leads saved before saved_by column existed
          return true;
        })
        .map((l: any) => ({
          id: String(l.id).padStart(4, "0"),
          dbId: l.id,
          name: l.name,
          phone: l.contact_no || "",
          email: l.email || "",
          source: l.source || "",
          channelPartner: l.channel_partner || "",
          assignManager: l.assign_manager || "",
          feedback: l.feedback || "",
          srNo: l.sr_no || "",
          formNo: l.form_no || "",
          date: l.lead_date || "",
          budget: l.budget || "",
          location: l.location || "",
          dbStatus: l.status || "new",
          dbInterest: l.interest_status || "",
          dbSavedBy: l.saved_by || "",
          savedAt: l.created_at,
          status: (l.status as any) || "saved",
          interestStatus: l.interest_status || undefined,
          siteVisitDate: l.site_visit_date || undefined,
          followUps: (l.follow_ups || []).map((f: any) => ({
            id: String(f.id), message: f.message,
            createdAt: f.created_at, createdBy: f.created_by_name || callerUser.name,
          })),
        }));
      setSavedLeads(saved);

      setDbState("saved"); setDbMessage(`✓ ${raw.length} leads loaded`);
      setTimeout(() => { setDbState("idle"); setDbMessage(""); }, 3000);
    } catch (err: any) {
      console.error("Load from DB failed:", err);
      setDbState("idle"); setDbMessage("");
    }
  }, [router]);

  useEffect(() => { loadFromDB(); }, [loadFromDB]);
  const deleteAllMyLeads = useCallback(async () => {
    try {
      setIsDeleting(true);
      // Get all dbIds for this caller's raw leads
      const dbIds = rawLeads.map(l => l.dbId).filter(Boolean);
      if (dbIds.length === 0) { setIsDeleting(false); setShowDeleteConfirm(false); return; }

      // Delete each lead from DB
      await Promise.all(
        dbIds.map(id =>
          fetch(`/api/caller-leads/${id}`, { method: "DELETE" }).catch(() => { })
        )
      );

      // Clear local state
      setRawLeads([]);
      setSavedLeads([]);
      setShowDeleteConfirm(false);
      setIsDeleting(false);
      setDbState("saved");
      setDbMessage("✓ All leads deleted");
      setTimeout(() => { setDbState("idle"); setDbMessage(""); }, 3000);
    } catch (err) {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [rawLeads]);
  // ── SSE real-time sync ──
  useCallerSync({
    onLeadsUploaded: () => loadFromDB(),
    onBatchDeleted: () => loadFromDB(),
    onLeadOwnershipChanged: () => loadFromDB(),
    onLeadUpdated: (e) => {
      // Update private saved leads
      setSavedLeads(prev => prev.map(l => l.dbId !== e.leadId ? l : {
        ...l,
        interestStatus: e.changes.interest_status ?? l.interestStatus,
        status: e.changes.status ?? l.status,
        feedback: e.changes.feedback ?? l.feedback,
        siteVisitDate: e.changes.site_visit_date ?? l.siteVisitDate,
      }));
      // Update public raw leads — real-time for ALL callers (Saved By, Interest, Status)
      setRawLeads(prev => prev.map(l => l.dbId !== e.leadId ? l : {
        ...l,
        feedback: e.changes.feedback ?? l.feedback,
        dbStatus: e.changes.status ?? l.dbStatus,
        dbInterest: e.changes.interest_status ?? l.dbInterest,
        dbSavedBy: e.changes.saved_by ?? l.dbSavedBy,
      }));
    },
    onLeadDeleted: (e) => {
      setRawLeads(prev => prev.filter(l => l.dbId !== e.leadId));
      setSavedLeads(prev => prev.filter(l => l.dbId !== e.leadId));
    },
    onFollowupAdded: (e) => {
      setSavedLeads(prev => prev.map(l => {
        if (l.dbId !== e.leadId) return l;
        const fu = { id: String(e.followUp.id), message: e.followUp.message, createdAt: e.followUp.created_at, createdBy: e.followUp.created_by_name || "Caller" };
        if (l.followUps.some(f => f.id === fu.id)) return l;
        return { ...l, followUps: [...l.followUps, fu] };
      }));
    },
  });

  // ── Excel parse + DB save ──
  const parseExcel = useCallback(async (file: File) => {
    setUploadError("");
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: false });
        if (json.length === 0) { setUploadError("The Excel file appears to be empty."); return; }
        const rawCols = Object.keys(json[0]);
        const findCol = (v: string[]) => rawCols.find(c => v.some(x => c.toLowerCase().trim().includes(x.toLowerCase()))) || "";
        const nameCol = findCol(["name", "customer", "client"]);
        const phoneCol = findCol(["contact no", "phone", "mobile", "contact", "number", "tel"]);
        const emailCol = findCol(["email", "mail"]);
        const sourceCol = findCol(["source", "platform", "channel", "medium"]);
        const partnerCol = findCol(["channel partner", "chanel partner", "chanel patner", "channel patner", "partner"]);
        const managerCol = findCol(["assign manager", "manager", "assigned"]);
        const feedbackCol = findCol(["feedback", "remarks", "comment"]);
        const srNoCol = findCol(["sr no", "srno", "s no", "sr."]);
        const formNoCol = findCol(["form no", "formno", "form number"]);
        const dateCol = findCol(["date"]);
        const leads: RawLead[] = json.map((row, i) => ({
          id: String(i + 1).padStart(4, "0"),
          name: String(row[nameCol] || row[rawCols[3]] || row[rawCols[0]] || `Lead ${i + 1}`),
          phone: String(row[phoneCol] || row[rawCols[4]] || ""),
          email: emailCol ? String(row[emailCol]) : "",
          source: sourceCol ? String(row[sourceCol]) : "",
          budget: "", location: "",
          channelPartner: partnerCol ? String(row[partnerCol]) : "",
          assignManager: managerCol ? String(row[managerCol]) : "",
          feedback: feedbackCol ? String(row[feedbackCol]) : "",
          srNo: srNoCol ? String(row[srNoCol]) : String(i + 1),
          formNo: formNoCol ? String(row[formNoCol]) : "",
          date: dateCol ? String(row[dateCol]) : "",
          ...row,
        }));
        setRawLeads(leads); setSection("dashboard");
        setDbState("saving"); setDbMessage(`Saving ${leads.length} leads…`);
        try {
          const payload = leads.map(l => ({
            sr_no: String(l.srNo ?? ""), form_no: String(l.formNo ?? ""), lead_date: String(l.date ?? ""),
            name: l.name, contact_no: String(l.phone ?? ""), source: String(l.source ?? ""),
            channel_partner: String(l.channelPartner ?? ""), assign_manager: String(l.assignManager ?? ""),
            feedback: String(l.feedback ?? ""),
          }));
          const res = await fetch("/api/caller-leads", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leads: payload, fileName: file.name, uploadedBy: user.name })
          });
          // ✅ safe parse
          let resData: any = {};
          try {
            const text = await res.text();
            if (text) resData = JSON.parse(text);
          } catch {
            setDbState("error");
            setDbMessage("DB error: empty response from server");
            return;
          }

          if (!res.ok) {
            setDbState("error");
            setDbMessage(`DB error: ${resData.error || res.status}`);
            return;
          }
          setRawLeads(prev => prev.map((l, i) => ({ ...l, dbId: resData.ids?.[i] })));
          setDbState("saved"); setDbMessage(`✓ ${leads.length} leads saved to DB`);
          await loadFromDB();
          setTimeout(() => { setDbState("idle"); setDbMessage(""); }, 5000);
        } catch (err: any) { setDbState("error"); setDbMessage(`DB error: ${err.message}`); }
      } catch { setUploadError("Failed to parse file. Please upload a valid .xlsx or .xls file."); }
    };
    reader.readAsArrayBuffer(file);
  }, [user.name]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) parseExcel(f); e.target.value = ""; };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) parseExcel(f); };

  // ── Lead ownership helpers ──
  const isLeadSavedByMe = (lead: RawLead) => {
    // Saved by this caller in local state
    if (savedLeads.some(l => l.id === lead.id)) return true;
    return false;
  };
  const isLeadLockedByOther = (lead: RawLead) => {
    // Lead is saved/owned by someone else
    const savedBy = (lead.dbSavedBy || "").toLowerCase().trim();
    const me = user.name.toLowerCase().trim();
    if (!savedBy || savedBy === "admin" || savedBy === "unknown") return false;
    return savedBy !== me && (lead.dbStatus === "saved" || lead.dbStatus === "not_interested" || !!lead.dbInterest);
  };
  const getLockedByName = (lead: RawLead) => lead.dbSavedBy || "";

  // ── Lead actions ──
  const saveLead = useCallback((lead: RawLead) => {
    setSavedLeads(prev => {
      if (prev.find(l => l.id === lead.id)) return prev;
      return [...prev, { ...lead, savedAt: new Date().toISOString(), followUps: [], status: "saved" }];
    });
    setRawLeads(prev => prev.map(l => l.id === lead.id ? { ...l, dbStatus: "saved", dbSavedBy: user.name } : l));
    if (lead.dbId) {
      fetch(`/api/caller-leads/${lead.dbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "saved", saved_by: user.name })
      })
        .then(() => loadFromDB()) // ← reload from DB after save to confirm persistence
        .catch(() => { });
    }
  }, [user.name, loadFromDB]);

  const isLeadSaved = (id: string) => savedLeads.some(l => l.id === id);

  const updateFeedback = useCallback((id: string, feedback: string) => {
    setRawLeads(prev => prev.map(l => l.id === id ? { ...l, feedback } : l));
    setSavedLeads(prev => prev.map(l => l.id === id ? { ...l, feedback } : l));
    const lead = rawLeads.find(l => l.id === id);
    apiUpdateLead(lead?.dbId, { feedback });
  }, [rawLeads]);

  const updateLead = useCallback((updated: SavedLead) => {
    setSavedLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    setRawLeads(prev => prev.map(l => l.id === updated.id ? {
      ...l,
      feedback: updated.feedback,
      source: updated.source,
      channelPartner: updated.channelPartner,
      assignManager: updated.assignManager,
      dbStatus: updated.status,
      dbInterest: updated.interestStatus || "",
    } : l));
    if (detailLead?.id === updated.id) setDetailLead(updated);
    if (updated.status === "not_interested" && detailLead?.id === updated.id) { setDetailLead(null); setSection("not_interested"); }
    if (updated.dbId) fetch(`/api/caller-leads/${updated.dbId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interest_status: updated.interestStatus ?? null,
        status: updated.status,
        feedback: updated.feedback ?? "",
        site_visit_date: updated.siteVisitDate ?? null,
        saved_by: user.name,  // always persist ownership
      })
    }).catch(() => { });
  }, [detailLead, user.name]);

  const revertLead = useCallback((id: string) => {
    setSavedLeads(prev => prev.map(l => l.id === id ? { ...l, status: "saved", interestStatus: undefined } : l));
    const lead = savedLeads.find(l => l.id === id);
    apiUpdateLead(lead?.dbId, { status: "saved", interest_status: null });
  }, [savedLeads]);

  const filteredRaw = useMemo(() => rawLeads.filter(l => {
    const matchSearch = !searchTerm || l.name.toLowerCase().includes(searchTerm.toLowerCase()) || l.phone.includes(searchTerm) || String(l.id).includes(searchTerm) || (l.channelPartner || "").toLowerCase().includes(searchTerm.toLowerCase()) || (l.assignManager || "").toLowerCase().includes(searchTerm.toLowerCase());
    return matchSearch && (sourceFilter === "All" || l.source === sourceFilter);
  }), [rawLeads, searchTerm, sourceFilter]);

  const uniqueSources = useMemo(() => ["All", ...Array.from(new Set(rawLeads.map(l => l.source || "Other")))], [rawLeads]);
  const formLeads = savedLeads.filter(l => l.status !== "not_interested");
  const interestedLeads = savedLeads.filter(l => l.interestStatus === "Interested");
  const notIntLeads = savedLeads.filter(l => l.status === "not_interested");
  const handleLogout = () => { clearCrmSession(); router.replace("/"); };

  const sidebarItems = [
    { id: "dashboard" as SidebarSection, icon: FaThLarge, label: "Dashboard", badge: null, activeColor: "text-purple-400 bg-purple-500/10", dotColor: "bg-purple-500" },
    { id: "forms" as SidebarSection, icon: FaClipboardList, label: "Forms", badge: formLeads.length, activeColor: "text-purple-400 bg-purple-500/10", dotColor: "bg-purple-500" },
    { id: "interested" as SidebarSection, icon: FaHeart, label: "Interested", badge: interestedLeads.length, activeColor: "text-green-400 bg-green-500/10", dotColor: "bg-green-500" },
    { id: "not_interested" as SidebarSection, icon: FaTimesCircle, label: "Not Interested", badge: notIntLeads.length, activeColor: "text-red-400 bg-red-500/10", dotColor: "bg-red-500" },
  ];

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-gray-200 font-sans overflow-hidden">
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center" onClick={() => !isDeleting && setShowDeleteConfirm(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative bg-[#1a1a1a] border border-red-500/30 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 animate-fadeIn" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 bg-red-900/30 border border-red-500/30 rounded-full flex items-center justify-center">
                <FaTrash className="text-red-400 text-2xl" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white mb-2">Delete All Leads?</h2>
                <p className="text-gray-400 text-sm">
                  This will permanently delete <span className="text-red-400 font-bold">{rawLeads.length} leads</span> and all their saved forms, follow-ups, and history from the database.
                </p>
                <p className="text-red-400 text-xs mt-2 font-bold">This action cannot be undone.</p>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1 bg-[#222] hover:bg-[#333] border border-[#333] text-gray-300 font-semibold py-2.5 rounded-xl cursor-pointer text-sm disabled:opacity-50">
                  Cancel
                </button>
                <button
                  onClick={deleteAllMyLeads}
                  disabled={isDeleting}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl cursor-pointer text-sm shadow-lg shadow-red-600/20">
                  {isDeleting
                    ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Deleting...</span></>
                    : <><FaTrash className="text-xs" />Delete All</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {ticketLead && (
        <TicketPopup
          lead={ticketLead}
          onClose={() => setTicketLead(null)}
          onSave={saveLead}
          alreadySaved={isLeadSaved(ticketLead.id)}
          isLocked={isLeadLockedByOther(ticketLead)}
          lockedBy={getLockedByName(ticketLead)}
          onFeedbackChange={updateFeedback}
          callerName={user.name}
        />
      )}

      {/* SIDEBAR */}
      <aside className="w-20 bg-[#111111] border-r border-[#222] flex flex-col items-center py-6 flex-shrink-0 z-40 shadow-sm">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl flex items-center justify-center text-xl font-bold text-white mb-10 shadow-lg cursor-pointer">B</div>
        <nav className="flex flex-col gap-2 w-full px-2 flex-1">
          {sidebarItems.map(({ id, icon: Icon, label, badge, activeColor, dotColor }) => (
            <div key={id} onClick={() => { setSection(id); setDetailLead(null); }} title={label}
              className={`relative flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer transition-colors ${section === id ? activeColor : "text-gray-500 hover:bg-[#1a1a1a] hover:text-gray-300"}`}>
              {section === id && <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 ${dotColor} rounded-r-full`} />}
              <Icon className="w-4 h-4" />
              {badge !== null && badge! > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-600 rounded-full text-[9px] font-black text-white flex items-center justify-center">{badge! > 9 ? "9+" : badge}</span>}
            </div>
          ))}
        </nav>
        <div className="px-2 w-full mt-auto"><div className="flex flex-col items-center justify-center py-3 rounded-xl cursor-pointer text-gray-500 hover:bg-[#1a1a1a] hover:text-gray-300"><FaCog className="w-5 h-5" /></div></div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* HEADER */}
        <header className="h-16 bg-[#111111]/80 backdrop-blur-md border-b border-[#222] flex items-center justify-between px-8 z-30 flex-shrink-0">
          <h1 className="text-white font-bold text-base tracking-wide flex items-center gap-2">
            Presales — Caller Panel
            <span className="bg-[#222] text-gray-400 px-2 py-0.5 rounded text-xs border border-[#333]">{section === "dashboard" ? "Overview" : section === "forms" ? "Forms" : section === "interested" ? "Interested" : "Not Interested"}</span>
          </h1>
          <div className="flex items-center gap-3">
            {dbState !== "idle" && <span className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border ${dbState === "saving" ? "text-blue-400 bg-blue-500/10 border-blue-500/20" : dbState === "saved" ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"}`}>{dbMessage}</span>}
            <button onClick={exportTemplate} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer border bg-[#1a1a1a] border-[#333] text-gray-300 hover:border-green-500/50 hover:text-green-400 transition-all"><FaDownload className="text-green-400" />Template</button>
            <div onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}>
              <button onClick={() => fileInputRef.current?.click()} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer border transition-all ${isDragging ? "bg-green-600 border-green-400 text-white" : "bg-[#1a1a1a] border-[#333] text-gray-300 hover:border-purple-500/50 hover:text-white"}`}>
                <FaFileExcel className="text-green-400" />{rawLeads.length > 0 ? `${rawLeads.length} Leads` : "Upload Excel"}<FaUpload className="text-xs" />
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="hidden" />
            </div>
            {uploadError && <span className="text-red-400 text-xs flex items-center gap-1"><FaExclamationTriangle />{uploadError}</span>}
            <div className="relative">
              <div onClick={() => setIsProfileOpen(!isProfileOpen)} className="w-9 h-9 rounded-full bg-purple-900/30 text-purple-400 border border-purple-500/50 flex items-center justify-center font-bold text-sm cursor-pointer hover:bg-purple-900/50">{user.name.charAt(0).toUpperCase()}</div>
              {isProfileOpen && (
                <div className="absolute top-12 right-0 w-56 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl p-4 z-50 animate-fadeIn">
                  <h3 className="text-white font-bold">{user.name}</h3>
                  <p className="text-gray-400 text-xs truncate mb-3">{user.email}</p>
                  <hr className="border-[#2a2a2a] mb-3" />
                  <p className="text-gray-400 text-sm flex justify-between">Role<span className="text-purple-400 font-bold capitalize">{user.role}</span></p>
                  <button onClick={handleLogout} className="w-full mt-4 bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900/30 py-2 rounded-lg font-semibold cursor-pointer text-sm">Logout</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* MAIN */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#0a0a0a] custom-scrollbar">

          {section === "dashboard" && <DashboardSection rawLeads={rawLeads} savedLeads={savedLeads} callerName={user.name} />}

          {section === "dashboard" && rawLeads.length > 0 && (
            <div className="mt-8 animate-fadeIn">
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative flex-1"><FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" /><input type="text" placeholder="Search by name, phone, ID, manager..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-[#1a1a1a] border border-[#222] rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:border-purple-500 outline-none" /></div>
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="bg-[#1a1a1a] border border-[#222] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500 cursor-pointer">{uniqueSources.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <span className="text-xs text-gray-500 self-center flex-shrink-0">{filteredRaw.length} of {rawLeads.length} leads</span>
              </div>
              <div className="bg-[#111111] rounded-2xl border border-[#222] overflow-hidden shadow-sm">
                <div className="p-4 border-b border-[#222] bg-[#151515] flex justify-between items-center">
                  <h3 className="font-bold text-white flex items-center gap-2 text-sm"><FaUpload className="text-purple-400" />Uploaded Leads</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 bg-[#222] px-2 py-0.5 rounded border border-[#333]">Click any row to open ticket</span>
                    {rawLeads.length > 0 && (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 hover:bg-red-900/40 cursor-pointer transition-all">
                        <FaTrash className="text-[9px]" /> Clear All Leads
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-gray-400">
                    <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500">
                      <tr>{["#", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback", "Lead Interest", "Saved By", "Status"].map(h => <th key={h} className={`px-4 py-3 border-b border-[#222] whitespace-nowrap ${h === "Status" ? "text-center" : ""}`}>{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {filteredRaw.length === 0
                        ? <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-600">No leads match your search.</td></tr>
                        : filteredRaw.map(lead => {
                          const savedByMe = isLeadSavedByMe(lead);
                          const lockedByOther = isLeadLockedByOther(lead);
                          const lockedBy = getLockedByName(lead);
                          return (
                            <tr
                              key={lead.id}
                              onClick={() => setTicketLead(lead)}
                              className={`transition-colors cursor-pointer group ${lockedByOther ? "bg-[#1a1010] hover:bg-[#1e1212] opacity-70" : "hover:bg-[#1a1a1a]"}`}>
                              <td className="px-4 py-3 font-mono text-purple-400 font-bold">#{lead.sr_no || lead.id}</td>
                              <td className="px-4 py-3 font-semibold whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  {lockedByOther && <FaLock className="text-red-500 text-[10px] flex-shrink-0" title={`Locked by ${lockedBy}`} />}
                                  <span className={lockedByOther ? "text-gray-500" : "text-white group-hover:text-purple-300"}>{lead.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono">{maskPhone(lead.phone)}</td>
                              <td className="px-4 py-3">{sourceBadge(lead.source)}</td>
                              <td className="px-4 py-3 text-gray-400 max-w-[130px] truncate">{lead.channelPartner || "—"}</td>
                              <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{lead.assignManager || "—"}</td>
                              <td className="px-4 py-3 max-w-[180px]">{lead.feedback ? <span className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-2 py-1 inline-block truncate max-w-[160px]" title={lead.feedback}>{lead.feedback}</span> : <span className="text-gray-600 text-xs italic">—</span>}</td>
                              <td className="px-4 py-3" onClick={e => e.stopPropagation()}><InterestCell lead={lead} /></td>
                              <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                {lead.dbSavedBy && lead.dbSavedBy !== "admin" && lead.dbSavedBy !== "unknown"
                                  ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 whitespace-nowrap border ${savedByMe ? "text-purple-300 bg-purple-500/10 border-purple-500/20" : "text-red-300 bg-red-500/10 border-red-500/20"}`}>
                                    {savedByMe ? <FaPhoneAlt className="text-[8px]" /> : <FaLock className="text-[8px]" />}
                                    {savedByMe ? `Caller · ${user.name}` : lead.dbSavedBy}
                                  </span>
                                  : <span className="text-gray-600 text-[10px] italic">Not saved yet</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {lockedByOther
                                  ? <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 justify-center"><FaLock className="text-[8px]" />Locked</span>
                                  : savedByMe
                                    ? <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/30 px-2 py-0.5 rounded-full">Saved</span>
                                    : <span className="text-[10px] font-bold text-gray-500 bg-[#222] border border-[#333] px-2 py-0.5 rounded-full">New</span>}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Forms */}
          {section === "forms" && !detailLead && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold text-white flex items-center gap-2"><FaClipboardList className="text-purple-400" />Saved Forms</h2><span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{formLeads.length} leads</span></div>
              {formLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaSave className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold mb-1">No saved leads yet</p><p className="text-sm">Save a lead from the Leads table to see it here.</p></div>
                : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {formLeads.map(lead => (
                    <div key={lead.id} onClick={() => setDetailLead(lead)} className="bg-[#1a1a1a] border border-[#2a2a2a] hover:border-purple-500/50 rounded-2xl p-5 cursor-pointer transition-all group">
                      <div className="flex justify-between items-start mb-4 pb-3 border-b border-[#2a2a2a]">
                        <div>
                          <p className="text-[10px] text-purple-400 font-bold mb-1">#{lead.sr_no || lead.id}{lead.dbId && <span className="ml-2 text-green-600 font-mono"><FaDatabase className="inline text-[8px]" />{lead.dbId}</span>}</p>
                          <h3 className="text-white font-bold group-hover:text-purple-300">{lead.name}</h3>
                        </div>
                        {lead.interestStatus ? interestBadge(lead.interestStatus) : <span className="text-[10px] font-bold text-gray-500 bg-[#222] border border-[#333] px-2 py-0.5 rounded-full">Pending</span>}
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-gray-400"><FaPhoneAlt className="text-[10px] flex-shrink-0" /><span className="font-mono">{maskPhone(lead.phone)}</span></div>
                        {lead.channelPartner && <div className="flex items-center gap-2 text-gray-400"><FaUserTie className="text-[10px] flex-shrink-0" /><span className="truncate">{lead.channelPartner}</span></div>}
                        {lead.feedback && <div className="flex items-center gap-2 text-yellow-400 text-xs"><FaCommentAlt className="text-[9px]" /><span className="truncate">{lead.feedback}</span></div>}
                        {lead.siteVisitDate && <div className="flex items-center gap-2 text-orange-400 text-xs"><FaCalendarAlt className="text-[9px]" /><span>{formatDate(lead.siteVisitDate).split(",")[0]}</span></div>}
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#2a2a2a] flex justify-between items-center">
                        <span className="text-[10px] text-gray-600">{formatDate(lead.savedAt).split(",")[0]}</span>
                        <div className="flex items-center gap-2">{sourceBadge(lead.source)}<span className="text-[10px] text-gray-500 group-hover:text-purple-400 font-bold">Open →</span></div>
                      </div>
                    </div>
                  ))}
                </div>}
            </div>
          )}
          {section === "forms" && detailLead && <LeadDetailView lead={detailLead} onBack={() => setDetailLead(null)} onUpdateLead={updateLead} callerName={user.name} />}
          {section === "interested" && !detailLead && <InterestedSection leads={interestedLeads} onOpenDetail={lead => setDetailLead(lead)} />}
          {section === "interested" && detailLead && <LeadDetailView lead={detailLead} onBack={() => setDetailLead(null)} onUpdateLead={updateLead} callerName={user.name} />}

          {/* Not Interested */}
          {section === "not_interested" && (
            <div className="animate-fadeIn">
              <div className="flex justify-between items-center mb-6"><h2 className="text-xl font-bold text-white flex items-center gap-2"><FaTimesCircle className="text-red-400" />Not Interested</h2><span className="text-xs text-gray-500 bg-[#1a1a1a] border border-[#222] px-3 py-1.5 rounded-full">{notIntLeads.length} leads</span></div>
              {notIntLeads.length === 0
                ? <div className="border-2 border-dashed border-[#2a2a2a] rounded-2xl p-16 text-center text-gray-600"><FaTimesCircle className="text-5xl mx-auto mb-4 opacity-20" /><p className="font-semibold mb-1">No rejected leads</p><p className="text-sm">Leads marked as Not Interested will appear here.</p></div>
                : <div className="bg-[#111111] rounded-2xl border border-[#222] overflow-hidden"><div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-gray-400">
                    <thead className="text-[11px] uppercase bg-[#1a1a1a] text-gray-500"><tr>{["#", "Name", "Contact No.", "Source", "Channel Partner", "Assign Manager", "Feedback", "Follow-ups", "Saved On", "Actions"].map(h => <th key={h} className={`px-5 py-3 border-b border-[#222] whitespace-nowrap ${h === "Actions" ? "text-center" : ""}`}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-[#1a1a1a]">
                      {notIntLeads.map(lead => (
                        <tr key={lead.id} className="hover:bg-[#1a1a1a] transition-colors group">
                          <td className="px-5 py-3 font-mono text-red-400 font-bold">#{lead.sr_no || lead.id}</td>
                          <td className="px-5 py-3 text-white font-semibold">{lead.name}</td>
                          <td className="px-5 py-3 font-mono">{maskPhone(lead.phone)}</td>
                          <td className="px-5 py-3">{sourceBadge(lead.source)}</td>
                          <td className="px-5 py-3 text-gray-400">{lead.channelPartner || "—"}</td>
                          <td className="px-5 py-3 text-gray-400">{lead.assignManager || "—"}</td>
                          <td className="px-5 py-3 max-w-[150px] truncate text-yellow-300 text-xs">{lead.feedback || "—"}</td>
                          <td className="px-5 py-3"><span className="text-[10px] bg-[#222] border border-[#333] px-2 py-0.5 rounded-full font-bold">{lead.followUps.length} notes</span></td>
                          <td className="px-5 py-3 text-[11px]">{formatDate(lead.savedAt).split(",")[0]}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2 justify-center">
                              <button onClick={() => { setDetailLead(lead); setSection("forms"); setSavedLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: "saved", interestStatus: undefined } : l)); }} className="text-gray-500 hover:text-purple-400 cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-purple-500/10 border border-transparent hover:border-purple-500/20"><FaEye className="text-[10px]" />View</button>
                              <button onClick={() => revertLead(lead.id)} className="text-gray-500 hover:text-green-400 cursor-pointer text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-green-500/10 border border-transparent hover:border-green-500/20"><FaUndo className="text-[10px]" />Revert</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></div>}
            </div>
          )}
        </main>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar{width:6px;height:6px}
        .custom-scrollbar::-webkit-scrollbar-track{background:transparent}
        .custom-scrollbar::-webkit-scrollbar-thumb{background:#3a3a3a;border-radius:10px}
        .custom-scrollbar::-webkit-scrollbar-thumb:hover{background:#555}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        .animate-fadeIn{animation:fadeIn 0.2s ease-out}
      `}} />
    </div>
  );
}
