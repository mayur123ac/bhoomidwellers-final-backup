"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaCalendarAlt, FaChevronLeft, FaChevronRight, FaSearch,
  FaFilter, FaTimes, FaPlus, FaEdit, FaTrash, FaCheck,
  FaBan, FaRedo, FaDownload, FaEye, FaUser, FaPhone,
  FaBuilding, FaClock, FaMapMarkerAlt, FaExclamationTriangle,
  FaCheckCircle, FaTimesCircle, FaSyncAlt, FaCalendarCheck,
  FaUsers, FaClipboardList,
} from "react-icons/fa";
// ─── Types ─────────────────────────────────────────────────────────────────
interface SiteVisit {
  id: number;
  lead_id: number;
  visit_date: string;
  created_by: string;
  role: string;
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  notes: string | null;
  lead_name?: string;
  lead_phone?: string;
  project_name?: string;
  lead_status?: string;
  created_at?: string;
  updated_at?: string;
}
interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  visits: SiteVisit[];
}
// ─── Status Config ─────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  scheduled: { label: "Upcoming", color: "#9E217B", bg: "rgba(158,33,123,0.15)", text: "#d946a8", border: "rgba(158,33,123,0.4)", icon: FaClock },
  completed: { label: "Completed", color: "#22c55e", bg: "rgba(34,197,94,0.15)", text: "#4ade80", border: "rgba(34,197,94,0.4)", icon: FaCheckCircle },
  cancelled: { label: "Cancelled", color: "#ef4444", bg: "rgba(239,68,68,0.15)", text: "#f87171", border: "rgba(239,68,68,0.4)", icon: FaTimesCircle },
  rescheduled: { label: "Rescheduled", color: "#f97316", bg: "rgba(249,115,22,0.15)", text: "#fb923c", border: "rgba(249,115,22,0.4)", icon: FaSyncAlt },
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// ─── Calendar grid tokens (light-mode visibility fix) ──────────────────────
// Centralized so the whole calendar (header row + day grid + week view)
// shares one consistent, clearly visible grid-line / surface treatment.
const GRID_LINE_LIGHT = "#CBD5E1";       // slate-300 — visible grout/border color
const GRID_LINE_DARK = "rgba(255,255,255,0.08)";
const GRID_HEADER_BG_LIGHT = "#F1F5F9";  // slate-100 — distinguishes header strip from cells
const GRID_HEADER_BG_DARK = "#1a1a1a";
const GRID_CELL_BG_LIGHT = "#ffffff";    // cells are bright white "tiles" against the grout
const GRID_CELL_BG_DARK = "#151515";
// ─── Helpers ───────────────────────────────────────────────────────────────
function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}
function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch { return ""; }
}
function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}
function downloadCSV(data: any[], filename: string) {
  if (!data || data.length === 0) { alert("No data to export."); return; }
  const headers = Object.keys(data[0]);
  const csvRows = data.map(row => headers.map(k => JSON.stringify(row[k] ?? "")).join(","));
  const csvString = [headers.join(","), ...csvRows].join("\r\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
// ─── Stat Card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, color, bg, icon: Icon, isDark }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 flex items-center gap-4 flex-shrink-0"
      style={{
        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.9)",
        border: `1px solid ${color}40`,
        boxShadow: isDark ? `0 4px 20px ${color}20` : `0 4px 20px rgba(0,0,0,0.06), 0 0 0 1px ${color}20`,
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
        <Icon style={{ color, fontSize: 20 }} />
      </div>
      <div>
        <p className="text-2xl font-black" style={{ color }}>{value}</p>
        <p className="text-xs font-semibold mt-0.5" style={{ color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)" }}>{label}</p>
      </div>
    </motion.div>
  );
}
// ─── Event Pill ────────────────────────────────────────────────────────────
function EventPill({ visit, onClick }: { visit: SiteVisit; onClick: () => void }) {
  const cfg = STATUS_CONFIG[visit.status] || STATUS_CONFIG.scheduled;
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded-md px-2 py-1 text-[10px] font-semibold cursor-pointer truncate transition-all duration-150 hover:brightness-125 hover:scale-[1.02]"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
      title={`${visit.lead_name || `Lead #${visit.lead_id}`} — ${formatTime(visit.visit_date)}`}
    >
      {formatTime(visit.visit_date)} · {visit.lead_name || `Lead #${visit.lead_id}`}
    </div>
  );
}
// ─── Form Modal ────────────────────────────────────────────────────────────
function VisitFormModal({
  open, onClose, onSave, existingVisit, allLeads, adminUser, isDark, theme
}: {
  open: boolean; onClose: () => void; onSave: () => void;
  existingVisit?: SiteVisit | null; allLeads: any[]; adminUser: any; isDark: boolean; theme: any;
}) {
  const [leadId, setLeadId] = useState<string>("");
  const [visitDate, setVisitDate] = useState("");
  const [visitNotes, setVisitNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadSearch, setLeadSearch] = useState("");
  const filteredLeads = useMemo(() => {
    if (!leadSearch) return allLeads.slice(0, 50);
    const q = leadSearch.toLowerCase();
    return allLeads.filter(l =>
      l.name?.toLowerCase().includes(q) || String(l.id).includes(q) || l.phone?.includes(q)
    ).slice(0, 50);
  }, [leadSearch, allLeads]);
  useEffect(() => {
    if (existingVisit) {
      setLeadId(String(existingVisit.lead_id));
      const localDT = new Date(existingVisit.visit_date);
      const offset = localDT.getTimezoneOffset() * 60000;
      const localISO = new Date(localDT.getTime() - offset).toISOString().slice(0, 16);
      setVisitDate(localISO);
      setVisitNotes(existingVisit.notes || "");
    } else {
      setLeadId(""); setVisitDate(""); setVisitNotes(""); setLeadSearch("");
    }
    setError(null);
  }, [existingVisit, open]);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId || !visitDate) { setError("Lead and Visit Date are required."); return; }
    setIsSaving(true); setError(null);
    try {
      const method = existingVisit ? "PATCH" : "POST";
      const body = existingVisit
        ? { id: existingVisit.id, visit_date: new Date(visitDate).toISOString(), notes: visitNotes, status: "rescheduled" }
        : { lead_id: Number(leadId), visit_date: new Date(visitDate).toISOString(), created_by: adminUser?.name || "Admin", role: adminUser?.role || "admin", notes: visitNotes };
      const res = await fetch("/api/site-visits", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.success) { setError(json.message || "Failed to save visit."); return; }
      await fetch("/api/followups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: String(leadId),
          salesManagerName: adminUser?.name || "Admin",
          createdBy: "admin",
          message: `📅 ${existingVisit ? "Site Visit Rescheduled" : "Site Visit Scheduled"} by Admin:\n• Date: ${new Date(visitDate).toLocaleString("en-IN")}\n• Notes: ${visitNotes || "N/A"}`,
          siteVisitDate: new Date(visitDate).toISOString(),
        }),
      });
      onSave(); onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };
  const inputClass = `w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors duration-200 ${isDark ? "bg-[#222] border border-[#333] text-white focus:border-[#9E217B]" : "bg-white border border-indigo-200 text-[#1A1A1A] focus:border-[#9E217B]"}`;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0, y: 20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{
              background: isDark ? "#1a1a1a" : "#fff",
              border: isDark ? "1px solid #2a2a2a" : "1px solid #E5E7EB",
              boxShadow: "0 24px 80px rgba(0,0,0,0.3)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: isDark ? "1px solid #2a2a2a" : "1px solid #E5E7EB", background: isDark ? "#151515" : "#F8FAFC" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(158,33,123,0.15)" }}>
                  <FaCalendarAlt style={{ color: "#d946a8" }} />
                </div>
                <div>
                  <h2 className="font-bold text-sm" style={{ color: isDark ? "#fff" : "#1A1A1A" }}>{existingVisit ? "Reschedule Visit" : "New Site Visit"}</h2>
                  <p className="text-xs" style={{ color: isDark ? "rgba(255,255,255,0.4)" : "#6B7280" }}>Admin scheduling</p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors" style={{ color: isDark ? "#666" : "#9CA3AF" }}>
                <FaTimes />
              </button>
            </div>
            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {!existingVisit && (
                <div>
                  <label className="text-xs font-semibold mb-2 block" style={{ color: isDark ? "rgba(255,255,255,0.6)" : "#6B7280" }}>Search Lead *</label>
                  <input className={inputClass} placeholder="Search by name, ID or phone..." value={leadSearch} onChange={e => setLeadSearch(e.target.value)} />
                  {leadSearch && (
                    <div className="mt-1 rounded-xl border overflow-hidden max-h-40 overflow-y-auto" style={{ background: isDark ? "#222" : "#fff", borderColor: isDark ? "#333" : "#E5E7EB" }}>
                      {filteredLeads.length === 0 ? (
                        <p className="p-3 text-xs text-center" style={{ color: isDark ? "#666" : "#9CA3AF" }}>No leads found</p>
                      ) : filteredLeads.map(l => (
                        <div key={l.id} onClick={() => { setLeadId(String(l.id)); setLeadSearch(`${l.name} (#${l.id})`); }}
                          className="px-4 py-2.5 text-xs cursor-pointer transition-colors"
                          style={{ borderBottom: isDark ? "1px solid #2a2a2a" : "1px solid #F3F4F6", color: isDark ? "#ccc" : "#374151" }}
                          onMouseEnter={e => (e.currentTarget.style.background = isDark ? "#2a2a2a" : "#F9FAFB")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                          <span className="font-semibold" style={{ color: isDark ? "#d946a8" : "#9E217B" }}>#{l.id}</span> — {l.name} · {l.phone}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs font-semibold mb-2 block" style={{ color: isDark ? "rgba(255,255,255,0.6)" : "#6B7280" }}>Visit Date & Time *</label>
                <input type="datetime-local" className={inputClass} value={visitDate} onChange={e => setVisitDate(e.target.value)} required />
              </div>
              <div>
                <label className="text-xs font-semibold mb-2 block" style={{ color: isDark ? "rgba(255,255,255,0.6)" : "#6B7280" }}>Remarks / Notes</label>
                <textarea
                  className={`${inputClass} resize-none`}
                  rows={3} placeholder="Add notes (optional)..."
                  value={visitNotes} onChange={e => setVisitNotes(e.target.value)}
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
                  <FaExclamationTriangle style={{ color: "#f87171", flexShrink: 0 }} />
                  <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                  style={{ background: isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6", color: isDark ? "#aaa" : "#6B7280" }}>
                  Cancel
                </button>
                <button type="submit" disabled={isSaving} className="flex-1 py-3 rounded-xl text-sm font-semibold cursor-pointer transition-all"
                  style={{ background: "linear-gradient(135deg, #9E217B, #d946a8)", color: "#fff", opacity: isSaving ? 0.7 : 1 }}>
                  {isSaving ? "Saving..." : existingVisit ? "Reschedule" : "Schedule Visit"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
// ─── Detail Drawer ──────────────────────────────────────────────────────────
function DetailDrawer({
  visit, allLeads, open, onClose, onEdit, onDelete, onStatusChange, isDark, theme, adminUser
}: {
  visit: SiteVisit | null; allLeads: any[]; open: boolean; onClose: () => void;
  onEdit: () => void; onDelete: () => void;
  onStatusChange: (status: string) => void;
  isDark: boolean; theme: any; adminUser: any;
}) {
  const lead = useMemo(() => visit ? allLeads.find(l => l.id === visit.lead_id) : null, [visit, allLeads]);
  const cfg = visit ? (STATUS_CONFIG[visit.status] || STATUS_CONFIG.scheduled) : STATUS_CONFIG.scheduled;
  return (
    <AnimatePresence>
      {open && visit && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100]" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
          <motion.div
            initial={{ x: "100%", opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: "100%", opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed right-0 top-0 h-screen z-[110] flex flex-col overflow-hidden"
            style={{
              width: "min(420px, 100vw)",
              background: isDark ? "#151515" : "#fff",
              borderLeft: isDark ? "1px solid #2a2a2a" : "1px solid #E5E7EB",
              boxShadow: "-8px 0 40px rgba(0,0,0,0.2)",
            }}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-6 py-5 flex-shrink-0"
              style={{ borderBottom: isDark ? "1px solid #2a2a2a" : "1px solid #E5E7EB", background: isDark ? "#1a1a1a" : "#F8FAFC" }}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}>
                    {cfg.label}
                  </span>
                </div>
                <h2 className="font-bold text-base" style={{ color: isDark ? "#fff" : "#1A1A1A" }}>
                  {lead?.name || `Lead #${visit.lead_id}`}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: isDark ? "rgba(255,255,255,0.4)" : "#9CA3AF" }}>
                  {formatDateTime(visit.visit_date)}
                </p>
              </div>
              <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-colors"
                style={{ background: isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6", color: isDark ? "#aaa" : "#6B7280" }}>
                <FaTimes />
              </button>
            </div>
            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ scrollbarWidth: "thin" }}>
              {/* Visit Info */}
              <Section title="Visit Details" isDark={isDark}>
                <InfoRow icon={FaCalendarAlt} label="Visit Date" value={formatDateTime(visit.visit_date)} isDark={isDark} />
                <InfoRow icon={FaClock} label="Visit Time" value={formatTime(visit.visit_date)} isDark={isDark} />
                <InfoRow icon={FaUser} label="Scheduled By" value={visit.created_by} isDark={isDark} />
                <InfoRow icon={FaUsers} label="Role" value={visit.role} isDark={isDark} />
                {visit.notes && <InfoRow icon={FaClipboardList} label="Remarks" value={visit.notes} isDark={isDark} />}
              </Section>
              {/* Lead Info */}
              <Section title="Lead Information" isDark={isDark}>
                <InfoRow icon={FaUser} label="Lead Name" value={lead?.name || `#${visit.lead_id}`} isDark={isDark} />
                <InfoRow icon={FaPhone} label="Phone" value={lead?.phone || "N/A"} isDark={isDark} />
                <InfoRow icon={FaBuilding} label="Project" value={lead?.project || lead?.preferredLocation || "N/A"} isDark={isDark} />
                <InfoRow icon={FaMapMarkerAlt} label="Lead Status" value={lead?.status || "N/A"} isDark={isDark} />
                <InfoRow icon={FaCalendarCheck} label="Created At" value={visit.created_at ? formatDateTime(visit.created_at) : "N/A"} isDark={isDark} />
              </Section>
              {/* Status Change */}
              {visit.status !== "completed" && visit.status !== "cancelled" && (
                <Section title="Update Status" isDark={isDark}>
                  <div className="flex flex-wrap gap-2">
                    <ActionBtn label="Mark Completed" icon={FaCheck} color="#22c55e" onClick={() => onStatusChange("completed")} />
                    <ActionBtn label="Mark Cancelled" icon={FaBan} color="#ef4444" onClick={() => onStatusChange("cancelled")} />
                    {visit.status === "scheduled" && (
                      <ActionBtn label="Reschedule" icon={FaRedo} color="#f97316" onClick={onEdit} />
                    )}
                  </div>
                </Section>
              )}
            </div>
            {/* Drawer Footer */}
            <div className="flex gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: isDark ? "1px solid #2a2a2a" : "1px solid #E5E7EB" }}>
              <button onClick={onEdit} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all hover:brightness-110"
                style={{ background: "rgba(158,33,123,0.12)", color: "#d946a8", border: "1px solid rgba(158,33,123,0.3)" }}>
                <FaEdit /> Edit
              </button>
              <button onClick={onDelete} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all hover:brightness-110"
                style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>
                <FaTrash /> Delete
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
function Section({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "#d946a8" }}>{title}</h3>
      <div className="rounded-xl p-4 space-y-3" style={{ background: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", border: isDark ? "1px solid #2a2a2a" : "1px solid #E5E7EB" }}>
        {children}
      </div>
    </div>
  );
}
function InfoRow({ icon: Icon, label, value, isDark }: { icon: any; label: string; value: string; isDark: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "rgba(158,33,123,0.1)" }}>
        <Icon style={{ color: "#d946a8", fontSize: 11 }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: isDark ? "rgba(255,255,255,0.35)" : "#9CA3AF" }}>{label}</p>
        <p className="text-xs font-semibold mt-0.5 break-words" style={{ color: isDark ? "rgba(255,255,255,0.85)" : "#374151" }}>{value || "—"}</p>
      </div>
    </div>
  );
}
function ActionBtn({ label, icon: Icon, color, onClick }: { label: string; icon: any; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all hover:brightness-110"
      style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}>
      <Icon style={{ fontSize: 11 }} /> {label}
    </button>
  );
}
// ─── Confirm Dialog ─────────────────────────────────────────────────────────
function ConfirmDialog({ open, message, onConfirm, onCancel, isDark }: any) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            className="rounded-2xl p-6 w-full max-w-sm"
            style={{ background: isDark ? "#1a1a1a" : "#fff", border: isDark ? "1px solid #2a2a2a" : "1px solid #E5E7EB", boxShadow: "0 24px 80px rgba(0,0,0,0.3)" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.15)" }}>
                <FaExclamationTriangle style={{ color: "#f87171" }} />
              </div>
              <div>
                <h3 className="font-bold text-sm" style={{ color: isDark ? "#fff" : "#1A1A1A" }}>Confirm Action</h3>
                <p className="text-xs mt-0.5" style={{ color: isDark ? "rgba(255,255,255,0.4)" : "#6B7280" }}>{message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
                style={{ background: isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6", color: isDark ? "#aaa" : "#6B7280" }}>Cancel</button>
              <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
                style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)", color: "#fff" }}>Confirm</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
// ─── Main Component ─────────────────────────────────────────────────────────
export default function SiteVisitOverview({
  allLeads, receptionists, managers, siteHeads, adminUser, theme, isDark
}: {
  allLeads: any[]; receptionists: any[]; managers: any[]; siteHeads: any[];
  adminUser: any; theme: any; isDark: boolean;
}) {
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [calView, setCalView] = useState<"month" | "week" | "day">("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedVisit, setSelectedVisit] = useState<SiteVisit | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingVisit, setEditingVisit] = useState<SiteVisit | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");
  const [confirmAction, setConfirmAction] = useState<() => void>(() => { });
  const [showFilters, setShowFilters] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  // Filters
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterLeadStatus, setFilterLeadStatus] = useState("");
  const [searchLead, setSearchLead] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };
  // ── Fetch all visits ─────────────────────────────────────────────────────
  const fetchAllVisits = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/site-visits/all");
      const json = await res.json();
      if (json.success) {
        // Scope visits to only the leads passed in via `allLeads`.
        // Admin passes the full lead set (no behavior change).
        // Sales Manager / Site Head pass their own leads only, so this
        // naturally restricts the calendar to "my site visits" only.
        const ownLeadIds = new Set(allLeads.map((l: any) => l.id));
        const scopedVisits = (json.data || []).filter((v: SiteVisit) => ownLeadIds.has(v.lead_id));
        setVisits(scopedVisits);
      } else {
        // Fallback: fetch per-lead visits from existing leads data
        const leadsWithVisits = allLeads.filter(l => l.mongoVisitDate);
        const syntheticVisits: SiteVisit[] = leadsWithVisits.map(l => ({
          id: l.id,
          lead_id: l.id,
          visit_date: l.mongoVisitDate,
          created_by: l.assigned_to || l.assigned_receptionist || "Unknown",
          role: siteHeads.some((sh: any) => sh.name === l.assigned_to) ? "Site Head"
            : receptionists.some((r: any) => r.name === l.assigned_receptionist) ? "Receptionist" : "Sales Manager",
          status: "scheduled",
          notes: null,
          lead_name: l.name,
          lead_phone: l.phone,
        }));
        setVisits(syntheticVisits);
      }
    } catch {
      // Fallback from allLeads
      const leadsWithVisits = allLeads.filter(l => l.mongoVisitDate);
      const syntheticVisits: SiteVisit[] = leadsWithVisits.map(l => ({
        id: l.id,
        lead_id: l.id,
        visit_date: l.mongoVisitDate,
        created_by: l.assigned_to || l.assigned_receptionist || "Unknown",
        role: siteHeads.some((sh: any) => sh.name === l.assigned_to) ? "Site Head"
          : receptionists.some((r: any) => r.name === l.assigned_receptionist) ? "Receptionist" : "Sales Manager",
        status: "scheduled",
        notes: null,
        lead_name: l.name,
        lead_phone: l.phone,
      }));
      setVisits(syntheticVisits);
    } finally {
      setIsLoading(false);
    }
  }, [allLeads, siteHeads, receptionists]);
  useEffect(() => { fetchAllVisits(); }, [fetchAllVisits]);
  // ── Enrich visits with lead info ─────────────────────────────────────────
  const enrichedVisits = useMemo(() => {
    return visits.map(v => {
      const lead = allLeads.find(l => l.id === v.lead_id);
      return {
        ...v,
        lead_name: v.lead_name || lead?.name || `Lead #${v.lead_id}`,
        lead_phone: v.lead_phone || lead?.phone || "",
        project_name: lead?.preferredLocation || lead?.project || "",
        lead_status: lead?.status || "",
      };
    });
  }, [visits, allLeads]);
  // ── Available filter options ─────────────────────────────────────────────
  const allEmployees = useMemo(() => {
    const names = new Set<string>();
    enrichedVisits.forEach(v => { if (v.created_by) names.add(v.created_by); });
    return Array.from(names).sort();
  }, [enrichedVisits]);
  const allProjects = useMemo(() => {
    const names = new Set<string>();
    allLeads.forEach(l => { if (l.preferredLocation) names.add(l.preferredLocation); });
    return Array.from(names).filter(Boolean).sort();
  }, [allLeads]);
  // ── Filtered visits ─────────────────────────────────────────────────────
  const filteredVisits = useMemo(() => {
    return enrichedVisits.filter(v => {
      const lead = allLeads.find(l => l.id === v.lead_id);
      if (filterEmployee && v.created_by !== filterEmployee) return false;
      if (filterRole && v.role !== filterRole) return false;
      if (filterStatus && v.status !== filterStatus) return false;
      if (filterProject && (v.project_name || "") !== filterProject) return false;
      if (filterLeadStatus && (lead?.status || "") !== filterLeadStatus) return false;
      if (searchLead) {
        const q = searchLead.toLowerCase();
        if (!v.lead_name?.toLowerCase().includes(q) && !String(v.lead_id).includes(q)) return false;
      }
      if (searchPhone && !v.lead_phone?.includes(searchPhone)) return false;
      return true;
    });
  }, [enrichedVisits, filterEmployee, filterRole, filterStatus, filterProject, filterLeadStatus, searchLead, searchPhone, allLeads]);
  const hasFilters = filterEmployee || filterRole || filterStatus || filterProject || filterLeadStatus || searchLead || searchPhone;
  // ── Stats ──────────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const stats = useMemo(() => {
    const total = filteredVisits.length;
    const todayVisits = filteredVisits.filter(v => {
      const d = new Date(v.visit_date); d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    });
    const upcoming = filteredVisits.filter(v => v.status === "scheduled" && new Date(v.visit_date) >= new Date());
    const completed = filteredVisits.filter(v => v.status === "completed");
    const cancelled = filteredVisits.filter(v => v.status === "cancelled");
    const rescheduled = filteredVisits.filter(v => v.status === "rescheduled");
    const empToday = new Set(todayVisits.map(v => v.created_by)).size;
    return { total, todayUpcoming: upcoming.filter(v => { const d = new Date(v.visit_date); d.setHours(0, 0, 0, 0); return d.getTime() === today.getTime(); }).length, completed: completed.length, cancelled: cancelled.length, rescheduled: rescheduled.length, empToday };
  }, [filteredVisits]);
  // ── Calendar Helpers ─────────────────────────────────────────────────────
  const getVisitsForDate = useCallback((date: Date) => {
    return filteredVisits.filter(v => {
      const vd = new Date(v.visit_date); vd.setHours(0, 0, 0, 0);
      const dd = new Date(date); dd.setHours(0, 0, 0, 0);
      return vd.getTime() === dd.getTime();
    });
  }, [filteredVisits]);
  // ── Month View Calendar Days ──────────────────────────────────────────
  const calendarDays = useMemo((): CalendarDay[] => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const todayObj = new Date(); todayObj.setHours(0, 0, 0, 0);

    const days: CalendarDay[] = [];
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      d.setHours(0, 0, 0, 0);
      days.push({ date: d, isCurrentMonth: false, isToday: false, visits: getVisitsForDate(d) });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dt = new Date(year, month, d); dt.setHours(0, 0, 0, 0);
      days.push({ date: dt, isCurrentMonth: true, isToday: dt.getTime() === todayObj.getTime(), visits: getVisitsForDate(dt) });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i); d.setHours(0, 0, 0, 0);
      days.push({ date: d, isCurrentMonth: false, isToday: false, visits: getVisitsForDate(d) });
    }
    return days;
  }, [currentDate, getVisitsForDate]);
  // ── Week View ─────────────────────────────────────────────────────────
  const weekDays = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - d.getDay());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(d); day.setDate(d.getDate() + i);
      days.push({ date: day, visits: getVisitsForDate(day) });
    }
    return days;
  }, [currentDate, getVisitsForDate]);
  // ── Navigation ────────────────────────────────────────────────────────
  const navigate = (dir: 1 | -1) => {
    const d = new Date(currentDate);
    if (calView === "month") d.setMonth(d.getMonth() + dir);
    else if (calView === "week") d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };
  const viewTitle = useMemo(() => {
    if (calView === "month") return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (calView === "week") {
      const start = new Date(currentDate); start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(end.getDate() + 6);
      return `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
    }
    return currentDate.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }, [currentDate, calView]);
  // ── Actions ──────────────────────────────────────────────────────────
  const handleStatusChange = async (visitId: number, status: string) => {
    try {
      const res = await fetch("/api/site-visits", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: visitId, status }) });
      const json = await res.json();
      if (!json.success) { showToast("❌ " + json.message, "error"); return; }
      showToast(`✅ Visit marked as ${status}`);
      setShowDrawer(false);
      fetchAllVisits();
    } catch { showToast("❌ Update failed.", "error"); }
  };
  const handleDelete = async (visitId: number) => {
    setConfirmMsg("This will permanently delete the site visit. This action cannot be undone.");
    setConfirmAction(() => async () => {
      try {
        const res = await fetch(`/api/site-visits?id=${visitId}`, { method: "DELETE" });
        const json = await res.json();
        if (!json.success) { showToast("❌ " + (json.message || "Delete failed."), "error"); return; }
        showToast("✅ Visit deleted.");
        setShowDrawer(false); setShowConfirm(false);
        fetchAllVisits();
      } catch { showToast("❌ Delete failed.", "error"); setShowConfirm(false); }
    });
    setShowConfirm(true);
  };
  // ── Export ────────────────────────────────────────────────────────────
  const handleExport = () => {
    const data = filteredVisits.map(v => ({
      "Visit ID": v.id,
      "Lead ID": v.lead_id,
      "Lead Name": v.lead_name || "",
      "Lead Phone": v.lead_phone || "",
      "Project": v.project_name || "",
      "Lead Status": v.lead_status || "",
      "Visit Date": formatDateTime(v.visit_date),
      "Scheduled By": v.created_by,
      "Employee Role": v.role,
      "Status": STATUS_CONFIG[v.status]?.label || v.status,
      "Notes": v.notes || "",
    }));
    downloadCSV(data, `site-visits-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  const inputClass = `rounded-xl px-3 py-2 text-xs outline-none transition-colors ${isDark ? "bg-[#222] border border-[#333] text-white" : "bg-white border border-indigo-200 text-[#1A1A1A]"}`;
  const selectClass = `${inputClass} cursor-pointer`;
  // ── Calendar grid surface helpers (light-mode visibility fix) ───────────
  const gridLineColor = isDark ? GRID_LINE_DARK : GRID_LINE_LIGHT;
  const gridHeaderBg = isDark ? GRID_HEADER_BG_DARK : GRID_HEADER_BG_LIGHT;
  const gridCellBg = isDark ? GRID_CELL_BG_DARK : GRID_CELL_BG_LIGHT;
  const gridHeaderText = isDark ? "rgba(255,255,255,0.35)" : "#64748B";
  const todayCellBg = isDark ? "rgba(158,33,123,0.12)" : "rgba(158,33,123,0.06)";
  const todayCellBgHover = isDark ? "rgba(158,33,123,0.18)" : "rgba(158,33,123,0.1)";
  const cellHoverBg = isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC";
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[500] px-5 py-3 rounded-xl shadow-2xl text-sm font-bold text-white"
            style={{ background: toast.type === "success" ? "linear-gradient(135deg,#22c55e,#16a34a)" : "linear-gradient(135deg,#ef4444,#dc2626)" }}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog open={showConfirm} message={confirmMsg} onConfirm={confirmAction} onCancel={() => setShowConfirm(false)} isDark={isDark} />
      <VisitFormModal
        open={showForm} onClose={() => { setShowForm(false); setEditingVisit(null); }}
        onSave={() => { fetchAllVisits(); showToast("✅ Site visit saved!"); }}
        existingVisit={editingVisit} allLeads={allLeads} adminUser={adminUser} isDark={isDark} theme={theme}
      />
      <DetailDrawer
        visit={selectedVisit} allLeads={allLeads} open={showDrawer}
        onClose={() => { setShowDrawer(false); setSelectedVisit(null); }}
        onEdit={() => { setEditingVisit(selectedVisit); setShowForm(true); }}
        onDelete={() => selectedVisit && handleDelete(selectedVisit.id)}
        onStatusChange={(status) => selectedVisit && handleStatusChange(selectedVisit.id, status)}
        isDark={isDark} theme={theme} adminUser={adminUser}
      />
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,rgba(158,33,123,0.2),rgba(217,70,168,0.1))", border: "1px solid rgba(158,33,123,0.3)" }}>
                  <FaCalendarAlt style={{ color: "#d946a8", fontSize: 18 }} />
                </div>
                <h1 className="text-xl font-black" style={{ color: isDark ? "#fff" : "#1A1A1A" }}>Site Visit Overview</h1>
              </div>
              <p className="text-sm ml-1" style={{ color: isDark ? "rgba(255,255,255,0.4)" : "#6B7280" }}>View and manage all scheduled site visits across the organization.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all hover:brightness-110"
                style={{ background: "rgba(0,174,239,0.12)", color: "#00AEEF", border: "1px solid rgba(0,174,239,0.3)" }}>
                <FaDownload /> Export CSV
              </button>
              <button onClick={() => { setEditingVisit(null); setShowForm(true); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-all hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #9E217B, #d946a8)", color: "#fff", boxShadow: "0 4px 16px rgba(158,33,123,0.3)" }}>
                <FaPlus /> Add Site Visit
              </button>
            </div>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total Visits" value={stats.total} color="#9E217B" bg="rgba(158,33,123,0.15)" icon={FaCalendarAlt} isDark={isDark} />
            <StatCard label="Today's Upcoming" value={stats.todayUpcoming} color="#d946a8" bg="rgba(217,70,168,0.15)" icon={FaClock} isDark={isDark} />
            <StatCard label="Completed" value={stats.completed} color="#22c55e" bg="rgba(34,197,94,0.15)" icon={FaCheckCircle} isDark={isDark} />
            <StatCard label="Rescheduled" value={stats.rescheduled} color="#f97316" bg="rgba(249,115,22,0.15)" icon={FaSyncAlt} isDark={isDark} />
            <StatCard label="Cancelled" value={stats.cancelled} color="#ef4444" bg="rgba(239,68,68,0.15)" icon={FaTimesCircle} isDark={isDark} />
            <StatCard label="Employees Today" value={stats.empToday} color="#00AEEF" bg="rgba(0,174,239,0.15)" icon={FaUsers} isDark={isDark} />
          </div>
          {/* Calendar Controls */}
          <div className="rounded-2xl overflow-hidden" style={{ background: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.9)", border: isDark ? "1px solid rgba(158,33,123,0.15)" : `1px solid ${GRID_LINE_LIGHT}`, boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.3)" : "0 8px 32px rgba(0,0,0,0.06)", backdropFilter: "blur(12px)" }}>
            {/* Calendar Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: isDark ? "1px solid rgba(255,255,255,0.06)" : `1px solid ${GRID_LINE_LIGHT}` }}>
              <div className="flex items-center gap-3">
                <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all hover:brightness-110"
                  style={{ background: "rgba(158,33,123,0.12)", color: "#d946a8", border: "1px solid rgba(158,33,123,0.3)" }}>
                  Today
                </button>
                <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
                  style={{ background: isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6", color: isDark ? "#aaa" : "#6B7280" }}>
                  <FaChevronLeft style={{ fontSize: 11 }} />
                </button>
                <button onClick={() => navigate(1)} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
                  style={{ background: isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6", color: isDark ? "#aaa" : "#6B7280" }}>
                  <FaChevronRight style={{ fontSize: 11 }} />
                </button>
                <h2 className="font-bold text-sm" style={{ color: isDark ? "#fff" : "#1A1A1A" }}>{viewTitle}</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: isDark ? "#555" : "#9CA3AF", fontSize: 11 }} />
                  <input
                    className={`pl-8 pr-3 py-2 rounded-xl text-xs outline-none w-36 transition-colors ${isDark ? "bg-[#222] border border-[#333] text-white" : "bg-white border border-indigo-200 text-[#1A1A1A]"}`}
                    placeholder="Search lead..."
                    value={searchLead} onChange={e => setSearchLead(e.target.value)}
                  />
                </div>
                {/* Filter Button */}
                <button onClick={() => setShowFilters(f => !f)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all"
                  style={{
                    background: showFilters || hasFilters ? "rgba(158,33,123,0.15)" : isDark ? "rgba(255,255,255,0.06)" : "#F3F4F6",
                    color: showFilters || hasFilters ? "#d946a8" : isDark ? "#aaa" : "#6B7280",
                    border: showFilters || hasFilters ? "1px solid rgba(158,33,123,0.35)" : isDark ? "1px solid #333" : "1px solid #E5E7EB",
                  }}>
                  <FaFilter style={{ fontSize: 10 }} /> Filter {hasFilters ? "●" : ""}
                </button>
                {/* View Toggle */}
                <div className="flex rounded-xl overflow-hidden" style={{ border: isDark ? "1px solid #333" : "1px solid #E5E7EB" }}>
                  {(["month", "week", "day"] as const).map(v => (
                    <button key={v} onClick={() => setCalView(v)}
                      className="px-3 py-2 text-xs font-semibold capitalize cursor-pointer transition-all"
                      style={{
                        background: calView === v ? "linear-gradient(135deg, #9E217B, #d946a8)" : isDark ? "rgba(255,255,255,0.04)" : "#fff",
                        color: calView === v ? "#fff" : isDark ? "#aaa" : "#6B7280",
                      }}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* Filters Panel */}
            <AnimatePresence>
              {showFilters && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden" style={{ borderBottom: isDark ? "1px solid rgba(255,255,255,0.06)" : `1px solid ${GRID_LINE_LIGHT}` }}>
                  <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    <select className={selectClass} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
                      <option value="">All Employees</option>
                      {allEmployees.map(e => <option key={e}>{e}</option>)}
                    </select>
                    <select className={selectClass} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                      <option value="">All Roles</option>
                      {["Sales Manager", "Receptionist", "Site Head", "admin"].map(r => <option key={r}>{r}</option>)}
                    </select>
                    <select className={selectClass} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                      <option value="">All Statuses</option>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <select className={selectClass} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
                      <option value="">All Projects</option>
                      {allProjects.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <select className={selectClass} value={filterLeadStatus} onChange={e => setFilterLeadStatus(e.target.value)}>
                      <option value="">Lead Status</option>
                      {["Assigned", "Contacted", "Interested", "Visit Scheduled", "Closing", "Lost"].map(s => <option key={s}>{s}</option>)}
                    </select>
                    <input className={inputClass} placeholder="Phone..." value={searchPhone} onChange={e => setSearchPhone(e.target.value)} />
                    <button onClick={() => { setFilterEmployee(""); setFilterRole(""); setFilterStatus(""); setFilterProject(""); setFilterLeadStatus(""); setSearchLead(""); setSearchPhone(""); }}
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all"
                      style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>
                      <FaTimes style={{ fontSize: 10 }} /> Clear
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {/* Calendar Body */}
            <AnimatePresence mode="wait">
              <motion.div key={`${calView}-${currentDate.toISOString()}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                {/* ── Month View ── */}
                {calView === "month" && (
                  <div>
                    {/* Day headers — separated from the body by a clear border and a distinct
                        background, with thin "grout" lines between each day name */}
                    <div
                      className="grid grid-cols-7 gap-px"
                      style={{ background: gridLineColor, borderBottom: `1px solid ${gridLineColor}` }}
                    >
                      {DAYS.map(d => (
                        <div key={d} className="py-3 text-center text-[11px] font-bold uppercase tracking-wider"
                          style={{ color: gridHeaderText, background: gridHeaderBg }}>
                          {d}
                        </div>
                      ))}
                    </div>
                    {/* Day cells — rendered as bright tiles separated by a visible 1px grout
                        line (the grid container's own background shows through the gaps),
                        which reads far more clearly than a faint border in light mode */}
                    <div className="grid grid-cols-7 gap-px" style={{ background: gridLineColor }}>
                      {calendarDays.map((day, idx) => (
                        <div key={idx}
                          className="min-h-[120px] p-2 relative transition-colors duration-150 cursor-pointer"
                          style={{
                            background: day.isToday ? todayCellBg : gridCellBg,
                            boxShadow: isDark ? "none" : "inset 0 1px 0 rgba(255,255,255,0.8)",
                          }}
                          onClick={() => { setCurrentDate(day.date); setCalView("day"); }}
                          onMouseEnter={e => e.currentTarget.style.background = day.isToday ? todayCellBgHover : cellHoverBg}
                          onMouseLeave={e => e.currentTarget.style.background = day.isToday ? todayCellBg : gridCellBg}
                        >
                          <span
                            className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1.5 ${day.isToday ? "text-white" : ""}`}
                            style={{
                              color: day.isToday ? "#fff" : day.isCurrentMonth ? isDark ? "rgba(255,255,255,0.8)" : "#374151" : isDark ? "rgba(255,255,255,0.2)" : "#D1D5DB",
                              background: day.isToday ? "linear-gradient(135deg,#9E217B,#d946a8)" : "transparent",
                            }}
                          >{day.date.getDate()}</span>
                          <div className="space-y-1">
                            {day.visits.slice(0, 3).map(v => (
                              <EventPill key={v.id} visit={v} onClick={() => { setSelectedVisit(v); setShowDrawer(true); }} />
                            ))}
                            {day.visits.length > 3 && (
                              <div className="text-[10px] font-bold px-2" style={{ color: isDark ? "rgba(217,70,168,0.8)" : "#9E217B" }}>+{day.visits.length - 3} more</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* ── Week View ── */}
                {calView === "week" && (
                  <div>
                    <div
                      className="grid grid-cols-7 gap-px"
                      style={{ background: gridLineColor, borderBottom: `1px solid ${gridLineColor}` }}
                    >
                      {weekDays.map(({ date }) => {
                        const isToday = new Date(date).setHours(0, 0, 0, 0) === new Date().setHours(0, 0, 0, 0);
                        return (
                          <div key={date.toISOString()} className="py-3 px-2 text-center" style={{ background: gridHeaderBg }}>
                            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: gridHeaderText }}>
                              {DAYS[date.getDay()]}
                            </p>
                            <p className={`text-lg font-black mt-0.5 w-9 h-9 mx-auto flex items-center justify-center rounded-full ${isToday ? "text-white" : ""}`}
                              style={{
                                color: isToday ? "#fff" : isDark ? "#fff" : "#1A1A1A",
                                background: isToday ? "linear-gradient(135deg,#9E217B,#d946a8)" : "transparent",
                              }}>
                              {date.getDate()}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-7 gap-px" style={{ background: gridLineColor }}>
                      {weekDays.map(({ date, visits: dayVisits }) => (
                        <div key={date.toISOString()} className="p-2 min-h-[300px] space-y-1.5"
                          style={{ background: gridCellBg, boxShadow: isDark ? "none" : "inset 0 1px 0 rgba(255,255,255,0.8)" }}>
                          {dayVisits.length === 0 ? (
                            <p className="text-[10px] text-center mt-8" style={{ color: isDark ? "rgba(255,255,255,0.15)" : "#D1D5DB" }}>—</p>
                          ) : dayVisits.map(v => (
                            <EventPill key={v.id} visit={v} onClick={() => { setSelectedVisit(v); setShowDrawer(true); }} />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* ── Day View ── */}
                {calView === "day" && (() => {
                  const dayVisits = getVisitsForDate(currentDate).sort((a, b) => new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime());
                  return (
                    <div className="p-6 min-h-[300px]">
                      {dayVisits.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(158,33,123,0.1)" }}>
                            <FaCalendarAlt style={{ color: "#d946a8", fontSize: 28 }} />
                          </div>
                          <h3 className="font-bold text-base" style={{ color: isDark ? "#fff" : "#1A1A1A" }}>No Site Visits</h3>
                          <p className="text-xs text-center max-w-xs" style={{ color: isDark ? "rgba(255,255,255,0.35)" : "#9CA3AF" }}>
                            No site visits scheduled for this day. Create a site visit or wait for employees to schedule visits.
                          </p>
                          <button onClick={() => { setEditingVisit(null); setShowForm(true); }} className="mt-2 px-5 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
                            style={{ background: "linear-gradient(135deg, #9E217B, #d946a8)", color: "#fff" }}>
                            <FaPlus className="inline mr-2" /> Schedule Visit
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {dayVisits.map(v => {
                            const cfg = STATUS_CONFIG[v.status] || STATUS_CONFIG.scheduled;
                            const lead = allLeads.find(l => l.id === v.lead_id);
                            return (
                              <motion.div key={v.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                                className="flex gap-4 p-4 rounded-2xl cursor-pointer transition-all hover:scale-[1.01]"
                                style={{ background: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", border: `1px solid ${cfg.border}`, boxShadow: `0 4px 16px ${cfg.color}15` }}
                                onClick={() => { setSelectedVisit(v); setShowDrawer(true); }}>
                                <div className="flex flex-col items-center gap-1 flex-shrink-0 w-16 text-center">
                                  <span className="text-lg font-black" style={{ color: cfg.text }}>{formatTime(v.visit_date)}</span>
                                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.text }}>{cfg.label}</span>
                                </div>
                                <div className="w-px self-stretch" style={{ background: cfg.border }} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <h4 className="font-bold text-sm" style={{ color: isDark ? "#fff" : "#1A1A1A" }}>{v.lead_name || `Lead #${v.lead_id}`}</h4>
                                      <p className="text-xs mt-0.5" style={{ color: isDark ? "rgba(255,255,255,0.4)" : "#6B7280" }}>{v.lead_phone || lead?.phone || "—"}</p>
                                    </div>
                                    <FaEye style={{ color: isDark ? "#555" : "#D1D5DB", flexShrink: 0, marginTop: 2 }} />
                                  </div>
                                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                                    <span className="text-[10px] font-semibold flex items-center gap-1" style={{ color: isDark ? "rgba(255,255,255,0.5)" : "#9CA3AF" }}>
                                      <FaUser style={{ fontSize: 9 }} /> {v.created_by}
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(158,33,123,0.12)", color: "#d946a8" }}>{v.role}</span>
                                    {v.notes && <span className="text-[10px]" style={{ color: isDark ? "rgba(255,255,255,0.35)" : "#9CA3AF" }}>📝 {v.notes}</span>}
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </motion.div>
            </AnimatePresence>
            {/* Legend */}
            <div className="flex items-center gap-5 px-6 py-4 flex-wrap" style={{ borderTop: isDark ? "1px solid rgba(255,255,255,0.05)" : `1px solid ${GRID_LINE_LIGHT}` }}>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <div key={key} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: cfg.color }} />
                  <span className="text-xs font-semibold" style={{ color: isDark ? "rgba(255,255,255,0.5)" : "#6B7280" }}>{cfg.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}