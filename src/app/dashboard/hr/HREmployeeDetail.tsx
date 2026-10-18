"use client";

/**
 * HREmployeeDetail — Phase 2 employee detail view.
 * Sub-tabs: Profile, Leaves, Week-Off, Incentives, Attendance, Earnings.
 * Rendered when an employee is selected from the HR employee directory.
 */

import { useEffect, useState, useCallback } from "react";
import { LEAVE_TYPES, LEAVE_STATUSES, DAYS_OF_WEEK, INCENTIVE_STATUSES } from "@/lib/hr/constants";

// ── shared helpers ───────────────────────────────────────────────────────────
const fmt = (d: string | null) =>
  d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const money = (n: number | string | null) =>
  n != null ? Number(n).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }) : "—";
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

// ── types ────────────────────────────────────────────────────────────────────
interface Props { employeeId: number; employeeName: string; isDark: boolean; onBack: () => void; }

// ── sub-tab IDs ──────────────────────────────────────────────────────────────
const TABS = [
  { id: "profile", label: "Profile" },
  { id: "leaves", label: "Leaves" },
  { id: "weekoff", label: "Week-Off" },
  { id: "incentives", label: "Incentives" },
  { id: "attendance", label: "Attendance" },
  { id: "earnings", label: "Earnings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function HREmployeeDetail({ employeeId, employeeName, isDark, onBack }: Props) {
  const [tab, setTab] = useState<TabId>("profile");

  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textPri = isDark ? "text-white" : "text-[#1D1D1F]";
  const accent = isDark ? "text-emerald-400" : "text-emerald-600";
  const inputCls = `w-full rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`;
  const btnPrimary = "px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer";
  const btnSecondary = `px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D]" : "border-[#D1D1D6] text-[#86868B]"}`;

  return (
    <div className="space-y-5">
      {/* Back + Name */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D] hover:text-white" : "border-[#D1D1D6] text-[#86868B] hover:text-[#1D1D1F]"}`}>
          &larr; Back
        </button>
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${accent}`}>Employee Detail</p>
          <h2 className={`text-lg font-black ${textPri}`}>{employeeName}</h2>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer border ${tab === t.id
              ? isDark ? "bg-[#2C2C2E] border-[#38383A] text-emerald-400" : "bg-white border-[#E5E5EA] text-emerald-600 shadow-sm"
              : isDark ? "border-transparent text-[#98989D] hover:bg-[#2C2C2E]/50" : "border-transparent text-[#86868B] hover:bg-gray-100"
              }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "profile" && <ProfileTab employeeId={employeeId} isDark={isDark} card={card} textSec={textSec} textPri={textPri} inputCls={inputCls} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />}
      {tab === "leaves" && <LeavesTab employeeId={employeeId} isDark={isDark} card={card} textSec={textSec} textPri={textPri} inputCls={inputCls} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />}
      {tab === "weekoff" && <WeekOffTab employeeId={employeeId} isDark={isDark} card={card} textSec={textSec} textPri={textPri} inputCls={inputCls} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />}
      {tab === "incentives" && <IncentivesTab employeeId={employeeId} isDark={isDark} card={card} textSec={textSec} textPri={textPri} inputCls={inputCls} btnPrimary={btnPrimary} btnSecondary={btnSecondary} />}
      {tab === "attendance" && <AttendanceTab employeeId={employeeId} isDark={isDark} card={card} textSec={textSec} textPri={textPri} />}
      {tab === "earnings" && <EarningsTab employeeId={employeeId} isDark={isDark} card={card} textSec={textSec} textPri={textPri} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileTab({ employeeId, isDark, card, textSec, textPri, inputCls, btnPrimary, btnSecondary }: any) {
  const [profile, setProfile] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editJoining, setEditJoining] = useState(false);
  const [joiningDate, setJoiningDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadDate, setUploadDate] = useState("");

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setProfile(j.data.profile);
      setDocs(j.data.documents || []);
      setJoiningDate(j.data.profile.joiningDate ? j.data.profile.joiningDate.slice(0, 10) : "");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const saveJoiningDate = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joiningDate: joiningDate || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setSuccess("Joining date updated.");
      setEditJoining(false);
      fetchProfile();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleJoiningLetterUpload = async (file: File) => {
    setUploading(true); setError(null);
    try {
      // Upload the document
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentType", "joining_letter");
      const res = await fetch(`/api/hr/employees/${employeeId}/documents`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);

      // If a joining date was provided with the upload, update it too
      if (uploadDate) {
        await fetch(`/api/hr/employees/${employeeId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joiningDate: uploadDate }),
        });
      }

      setSuccess("Joining letter uploaded.");
      setShowUpload(false);
      setUploadDate("");
      fetchProfile();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); }
  };

  if (loading) return <div className={`rounded-2xl animate-pulse h-64 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />;

  if (!profile) return <div className={`text-sm ${textSec}`}>Employee not found.</div>;

  const Field = ({ label, value }: { label: string; value: any }) => (
    <div>
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${textSec}`}>{label}</p>
      <p className={`text-sm font-medium ${textPri}`}>{value || "—"}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {success && <div className="rounded-xl p-3 text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{success}</div>}
      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}

      {/* Profile card */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <Field label="Name" value={profile.name} />
          <Field label="Employee ID" value={profile.id} />
          <Field label="Email" value={profile.email} />
          <Field label="Role" value={profile.role} />
          <Field label="Designation" value={profile.designation} />
          <Field label="Department" value={profile.department} />
          <Field label="Employment Status" value={capitalize(profile.employmentStatus || "active")} />
          <Field label="Employment Type" value={capitalize(profile.employmentType || "full_time")} />
          <Field label="Date of Birth" value={fmt(profile.dateOfBirth)} />
          <Field label="Blood Group" value={profile.bloodGroup} />
          <Field label="Personal Phone" value={profile.personalPhone} />
          <Field label="Emergency Contact" value={profile.emergencyContactName ? `${profile.emergencyContactName} (${profile.emergencyContactPhone || "—"})` : null} />
          <Field label="Reporting Manager" value={profile.reportingManagerName} />
          <Field label="Active" value={profile.isActive ? "Yes" : "No"} />

          {/* Joining Date with edit */}
          <div>
            <div className="flex items-center gap-1.5">
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${textSec}`}>Joining Date</p>
              {!editJoining && (
                <button onClick={() => setEditJoining(true)} className={`text-[10px] ${isDark ? "text-emerald-400" : "text-emerald-600"} hover:underline cursor-pointer`} title="Edit joining date">
                  &#9998;
                </button>
              )}
            </div>
            {editJoining ? (
              <div className="flex items-center gap-2">
                <input type="date" className={`${inputCls} !w-auto`} value={joiningDate} onChange={e => setJoiningDate(e.target.value)} />
                <button onClick={saveJoiningDate} disabled={saving} className={`text-xs font-bold ${isDark ? "text-emerald-400" : "text-emerald-600"} cursor-pointer`}>
                  {saving ? "..." : "Save"}
                </button>
                <button onClick={() => setEditJoining(false)} className={`text-xs ${textSec} cursor-pointer`}>Cancel</button>
              </div>
            ) : (
              <p className={`text-sm font-medium ${textPri}`}>{fmt(profile.joiningDate)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Joining Letter Upload */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-sm font-bold ${textPri}`}>Joining Letter</h3>
          <button onClick={() => setShowUpload(!showUpload)} className={btnPrimary}>Upload Joining Letter</button>
        </div>
        {showUpload && (
          <div className="space-y-3 mt-3">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Joining Date (optional, updates profile)</label>
              <input type="date" className={inputCls} value={uploadDate} onChange={e => setUploadDate(e.target.value)} />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>File (PDF, JPG, PNG — max 5MB)</label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={e => { if (e.target.files?.[0]) handleJoiningLetterUpload(e.target.files[0]); }}
                disabled={uploading}
                className={`text-sm ${textSec}`} />
            </div>
            {uploading && <p className={`text-xs ${textSec}`}>Uploading...</p>}
          </div>
        )}
        {/* List existing joining letters from docs */}
        {docs.filter(d => d.document_type === "joining_letter").length > 0 ? (
          <div className="mt-3 space-y-2">
            {docs.filter(d => d.document_type === "joining_letter").map((d: any) => (
              <div key={d.id} className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                <span className={textPri}>{d.file_name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.verification_status === "verified" ? "bg-emerald-500/15 text-emerald-400" : d.verification_status === "rejected" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"}`}>
                  {capitalize(d.verification_status)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className={`text-xs mt-2 ${textSec}`}>No joining letter uploaded yet.</p>
        )}
      </div>

      {/* Documents summary */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <h3 className={`text-sm font-bold mb-3 ${textPri}`}>Documents ({docs.length})</h3>
        {docs.length === 0 ? (
          <p className={`text-xs ${textSec}`}>No documents uploaded.</p>
        ) : (
          <div className="space-y-2">
            {docs.map((d: any) => (
              <div key={d.id} className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                <div>
                  <span className={`font-medium ${textPri}`}>{capitalize(d.document_type)}</span>
                  <span className={` ml-2 ${textSec}`}>{d.file_name}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d.verification_status === "verified" ? "bg-emerald-500/15 text-emerald-400" : d.verification_status === "rejected" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"}`}>
                  {capitalize(d.verification_status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAVES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function LeavesTab({ employeeId, isDark, card, textSec, textPri, inputCls, btnPrimary, btnSecondary }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add leave form
  const [showAdd, setShowAdd] = useState(false);
  const [fType, setFType] = useState<string>("casual");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fDays, setFDays] = useState("");
  const [fReason, setFReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Allocation edit
  const [showAlloc, setShowAlloc] = useState(false);
  const [allocations, setAllocations] = useState<{ leaveType: string; allocated: number }[]>([]);
  const [allocSaving, setAllocSaving] = useState(false);

  // Correction
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [corrReason, setCorrReason] = useState("");
  const [corrStatus, setCorrStatus] = useState("");
  const [corrSaving, setCorrSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/leaves?year=${year}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setData(j.data);
      // Pre-fill allocation form
      const allocs = LEAVE_TYPES.map(lt => {
        const existing = (j.data.allocations || []).find((a: any) => a.leave_type === lt);
        return { leaveType: lt, allocated: existing ? Number(existing.allocated) : 0 };
      });
      setAllocations(allocs);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [employeeId, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddLeave = async () => {
    if (!fStart || !fEnd || !fDays) { setError("Start date, end date, and days are required."); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/leaves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveType: fType, startDate: fStart, endDate: fEnd, days: Number(fDays), reason: fReason }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setSuccess("Leave record added.");
      setShowAdd(false);
      setFType("casual"); setFStart(""); setFEnd(""); setFDays(""); setFReason("");
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const handleSaveAllocations = async () => {
    setAllocSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/leaves/allocations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, allocations }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setSuccess("Allocations updated.");
      setShowAlloc(false);
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setAllocSaving(false); }
  };

  const handleCorrection = async (leaveId: number) => {
    if (!corrReason.trim()) { setError("Correction reason is required."); return; }
    setCorrSaving(true); setError(null);
    try {
      const body: any = { correctionReason: corrReason };
      if (corrStatus) body.status = corrStatus;
      const res = await fetch(`/api/hr/employees/${employeeId}/leaves/${leaveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setSuccess("Leave record corrected.");
      setCorrecting(null);
      setCorrReason(""); setCorrStatus("");
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setCorrSaving(false); }
  };

  if (loading) return <div className={`rounded-2xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />;

  const allocs = data?.allocations || [];
  const records = data?.records || [];

  return (
    <div className="space-y-5">
      {success && <div className="rounded-xl p-3 text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{success}</div>}
      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className={`rounded-xl px-3 py-2 text-xs font-medium border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => setShowAlloc(!showAlloc)} className={btnSecondary}>Set Allocations</button>
        <button onClick={() => setShowAdd(!showAdd)} className={btnPrimary}>+ Add Leave Record</button>
      </div>

      {/* Allocation edit */}
      {showAlloc && (
        <div className={`rounded-2xl p-5 space-y-4 ${card}`}>
          <h3 className={`text-sm font-bold ${textPri}`}>Leave Allocations — {year}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {allocations.map((a, i) => (
              <div key={a.leaveType}>
                <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>{capitalize(a.leaveType)}</label>
                <input type="number" min={0} className={inputCls} value={a.allocated}
                  onChange={e => {
                    const next = [...allocations];
                    next[i] = { ...next[i], allocated: Math.max(0, Number(e.target.value) || 0) };
                    setAllocations(next);
                  }} />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleSaveAllocations} disabled={allocSaving} className={btnPrimary}>{allocSaving ? "Saving..." : "Save Allocations"}</button>
            <button onClick={() => setShowAlloc(false)} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {/* Allocation summary */}
      {allocs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {allocs.map((a: any) => (
            <div key={a.leave_type} className={`rounded-2xl p-4 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>{capitalize(a.leave_type)}</p>
              <p className={`text-xl font-black ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>{a.remaining ?? (Number(a.allocated) - Number(a.used))}</p>
              <p className={`text-[10px] ${textSec}`}>{a.allocated} allocated, {a.used} used</p>
            </div>
          ))}
        </div>
      )}
      {allocs.length === 0 && (
        <div className={`rounded-2xl p-6 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>No leave allocations configured for {year}. Use "Set Allocations" to configure.</p>
        </div>
      )}

      {/* Add leave form */}
      {showAdd && (
        <div className={`rounded-2xl p-5 space-y-4 ${card}`}>
          <h3 className={`text-sm font-bold ${textPri}`}>Add Leave Record</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Leave Type</label>
              <select className={inputCls} value={fType} onChange={e => setFType(e.target.value)}>
                {LEAVE_TYPES.map(t => <option key={t} value={t}>{capitalize(t)}</option>)}
              </select>
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Start Date</label>
              <input type="date" className={inputCls} value={fStart} onChange={e => setFStart(e.target.value)} />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>End Date</label>
              <input type="date" className={inputCls} value={fEnd} onChange={e => setFEnd(e.target.value)} />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Days</label>
              <input type="number" min={1} className={inputCls} value={fDays} onChange={e => setFDays(e.target.value)} placeholder="e.g. 2" />
            </div>
            <div className="md:col-span-2">
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Reason (optional)</label>
              <input className={inputCls} value={fReason} onChange={e => setFReason(e.target.value)} placeholder="e.g. Family function" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddLeave} disabled={submitting} className={btnPrimary}>{submitting ? "Adding..." : "Add Leave"}</button>
            <button onClick={() => setShowAdd(false)} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {/* Leave records table */}
      {records.length > 0 ? (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Type</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Dates</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Days</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Reason</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r: any, i: number) => (
                  <tr key={r.id} className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                    <td className={`px-4 py-3 font-medium ${textPri}`}>{capitalize(r.leave_type)}</td>
                    <td className={`px-4 py-3 text-xs font-mono ${textSec}`}>{fmt(r.start_date)} — {fmt(r.end_date)}</td>
                    <td className={`px-4 py-3 ${textPri}`}>{r.days}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === "approved" ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-500/15 text-gray-400"}`}>
                        {capitalize(r.status)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-xs ${textSec}`}>{r.reason || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {correcting === r.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <select className={`${inputCls} !w-auto text-xs`} value={corrStatus} onChange={e => setCorrStatus(e.target.value)}>
                            <option value="">No status change</option>
                            {LEAVE_STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
                          </select>
                          <input className={`${inputCls} !w-32 text-xs`} placeholder="Reason" value={corrReason} onChange={e => setCorrReason(e.target.value)} />
                          <button onClick={() => handleCorrection(r.id)} disabled={corrSaving} className="text-[10px] font-bold text-emerald-400 cursor-pointer">{corrSaving ? "..." : "Save"}</button>
                          <button onClick={() => { setCorrecting(null); setCorrReason(""); setCorrStatus(""); }} className={`text-[10px] ${textSec} cursor-pointer`}>X</button>
                        </div>
                      ) : (
                        <button onClick={() => setCorrecting(r.id)} className="text-[10px] font-bold text-blue-400 hover:text-blue-300 cursor-pointer">Correct</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`rounded-2xl p-6 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>No leave records for {year}.</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEK-OFF TAB
// ═══════════════════════════════════════════════════════════════════════════════
function WeekOffTab({ employeeId, isDark, card, textSec, textPri, inputCls, btnPrimary, btnSecondary }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/week-off`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setData(j.data);
      setSelectedDays(j.data.activeDays || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleDay = (d: number) => {
    setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/week-off`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: selectedDays, effectiveFrom }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setSuccess(j.message || "Week-off updated.");
      setEditing(false);
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className={`rounded-2xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />;

  return (
    <div className="space-y-5">
      {success && <div className="rounded-xl p-3 text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{success}</div>}
      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}

      {/* Current config */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-sm font-bold ${textPri}`}>Weekly Off Schedule</h3>
          <button onClick={() => setEditing(!editing)} className={btnPrimary}>{editing ? "Cancel" : "Configure"}</button>
        </div>

        {!data?.configured && !editing ? (
          <div className={`rounded-xl p-6 text-center border border-dashed ${isDark ? "border-[#38383A]" : "border-[#D1D1D6]"}`}>
            <p className={`text-sm ${textSec}`}>Not configured. No weekly-off days assigned.</p>
          </div>
        ) : !editing ? (
          <div className="flex flex-wrap gap-2">
            {DAYS_OF_WEEK.map((name, i) => {
              const isOff = data?.activeDays?.includes(i);
              return (
                <div key={i} className={`px-4 py-2.5 rounded-xl text-xs font-bold border ${isOff
                  ? "bg-emerald-600/15 border-emerald-500/30 text-emerald-400"
                  : isDark ? "bg-[#2C2C2E] border-[#38383A] text-[#58585A]" : "bg-[#F5F5F7] border-[#E5E5EA] text-[#C7C7CC]"
                  }`}>
                  {name} {isOff ? "(Off)" : ""}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Effective dates */}
        {!editing && data?.active?.length > 0 && (
          <p className={`text-[10px] mt-3 ${textSec}`}>
            Effective from: {fmt(data.active[0]?.effective_from)}
          </p>
        )}

        {/* Edit mode */}
        {editing && (
          <div className="space-y-4 mt-3">
            <p className={`text-xs ${textSec}`}>Select days that are weekly off for this employee:</p>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((name, i) => {
                const isSelected = selectedDays.includes(i);
                return (
                  <button key={i} onClick={() => toggleDay(i)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${isSelected
                      ? "bg-emerald-600 border-emerald-600 text-white"
                      : isDark ? "bg-[#2C2C2E] border-[#38383A] text-[#98989D] hover:border-emerald-500/50" : "bg-white border-[#D1D1D6] text-[#86868B] hover:border-emerald-400"
                      }`}>
                    {name}
                  </button>
                );
              })}
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Effective From</label>
              <input type="date" className={`${inputCls} !w-auto`} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save Configuration"}</button>
              <button onClick={() => { setEditing(false); setSelectedDays(data?.activeDays || []); }} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* History */}
      {data?.history?.length > 0 && (
        <div className={`rounded-2xl p-5 ${card}`}>
          <h3 className={`text-sm font-bold mb-3 ${textPri}`}>Previous Schedules</h3>
          <div className="space-y-2">
            {data.history.map((h: any) => (
              <div key={h.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-xs ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                <span className={`font-medium ${textPri}`}>{DAYS_OF_WEEK[h.day_of_week]}</span>
                <span className={textSec}>{fmt(h.effective_from)} — {fmt(h.effective_to)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INCENTIVES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function IncentivesTab({ employeeId, isDark, card, textSec, textPri, inputCls, btnPrimary, btnSecondary }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  // Form
  const [fAmount, setFAmount] = useState("");
  const [fCategory, setFCategory] = useState("incentive");
  const [fDesc, setFDesc] = useState("");
  const [fDate, setFDate] = useState("");
  const [fPeriod, setFPeriod] = useState("");

  // Action state
  const [actionId, setActionId] = useState<number | null>(null);
  const [actionType, setActionType] = useState<string>("");
  const [actionReason, setActionReason] = useState("");
  const [actionAmount, setActionAmount] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/hr/employees/${employeeId}/incentives?${params}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setData(j.data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [employeeId, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = async () => {
    if (!fAmount || Number(fAmount) <= 0) { setError("Amount must be greater than 0."); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/incentives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(fAmount),
          category: fCategory || "incentive",
          description: fDesc,
          earningDate: fDate || undefined,
          earningPeriod: fPeriod || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setSuccess("Incentive entry created.");
      setShowAdd(false);
      setFAmount(""); setFCategory("incentive"); setFDesc(""); setFDate(""); setFPeriod("");
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const handleAction = async (incId: number) => {
    if ((actionType === "reverse" || actionType === "adjust") && !actionReason.trim()) {
      setError("Reason is required."); return;
    }
    if (actionType === "adjust" && (!actionAmount || Number(actionAmount) <= 0)) {
      setError("New amount must be greater than 0."); return;
    }
    setActionSubmitting(true); setError(null);
    try {
      const body: any = { action: actionType, reason: actionReason };
      if (actionType === "adjust") body.amount = Number(actionAmount);
      const res = await fetch(`/api/hr/employees/${employeeId}/incentives/${incId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setSuccess(j.message || "Action completed.");
      setActionId(null); setActionType(""); setActionReason(""); setActionAmount("");
      fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setActionSubmitting(false); }
  };

  if (loading) return <div className={`rounded-2xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />;

  const incentives = data?.incentives || [];
  const summary = data?.summary || {};

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-emerald-500/15 text-emerald-400";
    if (s === "pending") return "bg-amber-500/15 text-amber-400";
    if (s === "paid") return "bg-blue-500/15 text-blue-400";
    if (s === "reversed") return "bg-red-500/15 text-red-400";
    return "bg-gray-500/15 text-gray-400";
  };

  return (
    <div className="space-y-5">
      {success && <div className="rounded-xl p-3 text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{success}</div>}
      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>Pending</p>
          <p className="text-xl font-black text-amber-400">{money(summary.total_pending)}</p>
        </div>
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>Approved</p>
          <p className="text-xl font-black text-emerald-400">{money(summary.total_approved)}</p>
        </div>
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>Paid</p>
          <p className="text-xl font-black text-blue-400">{money(summary.total_paid)}</p>
          <p className={`text-[9px] mt-0.5 ${textSec}`}>Verified payment record required</p>
        </div>
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>Total Entries</p>
          <p className={`text-xl font-black ${textPri}`}>{summary.total_entries ?? 0}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className={`rounded-xl px-3 py-2 text-xs font-medium border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`}>
          <option value="">All statuses</option>
          {INCENTIVE_STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
        <button onClick={() => setShowAdd(!showAdd)} className={btnPrimary}>+ Add Incentive</button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className={`rounded-2xl p-5 space-y-4 ${card}`}>
          <h3 className={`text-sm font-bold ${textPri}`}>New Incentive Entry</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Amount</label>
              <input type="number" min={1} className={inputCls} value={fAmount} onChange={e => setFAmount(e.target.value)} placeholder="e.g. 5000" />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Category</label>
              <input className={inputCls} value={fCategory} onChange={e => setFCategory(e.target.value)} placeholder="e.g. incentive" />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Earning Date</label>
              <input type="date" className={inputCls} value={fDate} onChange={e => setFDate(e.target.value)} />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Earning Period</label>
              <input className={inputCls} value={fPeriod} onChange={e => setFPeriod(e.target.value)} placeholder="e.g. Oct 2026" />
            </div>
            <div className="md:col-span-2">
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${textSec}`}>Description</label>
              <input className={inputCls} value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="e.g. Q3 performance bonus" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={submitting} className={btnPrimary}>{submitting ? "Creating..." : "Create Incentive"}</button>
            <button onClick={() => setShowAdd(false)} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {/* Incentives table */}
      {incentives.length > 0 ? (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Amount</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Category</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Description</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Date</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Booking</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {incentives.map((inc: any, i: number) => (
                  <tr key={inc.id} className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                    <td className={`px-4 py-3 font-bold ${textPri}`}>{money(inc.amount)}</td>
                    <td className={`px-4 py-3 text-xs ${textSec}`}>{inc.category || "—"}</td>
                    <td className={`px-4 py-3 text-xs ${textSec} max-w-[200px] truncate`}>{inc.description || "—"}</td>
                    <td className={`px-4 py-3 text-xs font-mono ${textSec}`}>{fmt(inc.earning_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(inc.status)}`}>{capitalize(inc.status)}</span>
                    </td>
                    <td className={`px-4 py-3 text-xs ${textSec}`}>{inc.booking_number || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {actionId === inc.id ? (
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">
                          <select className={`${inputCls} !w-auto text-xs`} value={actionType} onChange={e => setActionType(e.target.value)}>
                            <option value="">Action...</option>
                            {inc.status === "pending" && <option value="approve">Approve</option>}
                            {inc.status !== "reversed" && inc.status !== "paid" && <option value="reverse">Reverse</option>}
                            {inc.status !== "reversed" && inc.status !== "paid" && <option value="adjust">Adjust</option>}
                          </select>
                          {actionType === "adjust" && (
                            <input type="number" min={1} className={`${inputCls} !w-24 text-xs`} value={actionAmount} onChange={e => setActionAmount(e.target.value)} placeholder="Amount" />
                          )}
                          {(actionType === "reverse" || actionType === "adjust") && (
                            <input className={`${inputCls} !w-32 text-xs`} value={actionReason} onChange={e => setActionReason(e.target.value)} placeholder="Reason" />
                          )}
                          <button onClick={() => handleAction(inc.id)} disabled={actionSubmitting || !actionType}
                            className="text-[10px] font-bold text-emerald-400 cursor-pointer disabled:opacity-50">{actionSubmitting ? "..." : "Go"}</button>
                          <button onClick={() => { setActionId(null); setActionType(""); setActionReason(""); setActionAmount(""); }}
                            className={`text-[10px] ${textSec} cursor-pointer`}>X</button>
                        </div>
                      ) : (
                        inc.status !== "reversed" && inc.status !== "paid" ? (
                          <button onClick={() => setActionId(inc.id)} className="text-[10px] font-bold text-blue-400 hover:text-blue-300 cursor-pointer">Actions</button>
                        ) : inc.reversal_reason ? (
                          <span className={`text-[10px] ${textSec}`} title={inc.reversal_reason}>Reversed</span>
                        ) : null
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`rounded-2xl p-6 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>No incentive entries found.</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ═══════════════════════════════════════════════════════════════════════════════
function AttendanceTab({ employeeId, isDark, card, textSec, textPri }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const inputCls = `rounded-xl px-3 py-2 text-xs font-medium border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`;

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/attendance?from=${from}&to=${to}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setData(j.data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [employeeId, from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      Present: "bg-emerald-500/15 text-emerald-400",
      Absent: "bg-red-500/15 text-red-400",
      Holiday: "bg-blue-500/15 text-blue-400",
      "Week Off": "bg-purple-500/15 text-purple-400",
    };
    // Leave types
    if (s.toLowerCase().includes("casual") || s.toLowerCase().includes("sick") || s.toLowerCase().includes("earned") || s.toLowerCase().includes("unpaid")) {
      return "bg-amber-500/15 text-amber-400";
    }
    return colors[s] || "bg-gray-500/15 text-gray-400";
  };

  if (loading) return <div className={`rounded-2xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />;

  const days = data?.days || [];
  const presentCount = days.filter((d: any) => d.effectiveStatus?.toLowerCase() === "present").length;
  const absentCount = days.filter((d: any) => d.effectiveStatus?.toLowerCase() === "absent").length;
  const leaveCount = days.filter((d: any) => d.isLeave).length;
  const holidayCount = days.filter((d: any) => d.isHoliday).length;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} />
        <span className={textSec}>to</span>
        <input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} />
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>Present</p>
          <p className="text-xl font-black text-emerald-400">{presentCount}</p>
        </div>
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>Absent</p>
          <p className="text-xl font-black text-red-400">{absentCount}</p>
        </div>
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>On Leave</p>
          <p className="text-xl font-black text-amber-400">{leaveCount}</p>
        </div>
        <div className={`rounded-2xl p-4 ${card}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${textSec}`}>Holidays</p>
          <p className="text-xl font-black text-blue-400">{holidayCount}</p>
        </div>
      </div>

      {/* Shift info */}
      {data?.shift && (
        <p className={`text-xs ${textSec}`}>Shift: {data.shift.start || "Not set"} {data.shift.flexible ? "(Flexible)" : ""}</p>
      )}

      {/* Days table */}
      {days.length > 0 ? (
        <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Date</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Day</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Indicators</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">First Login</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Last Logout</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Duration</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Late</th>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Location</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d: any, i: number) => {
                  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                  const hrs = d.workingTrackSeconds ? (d.workingTrackSeconds / 3600).toFixed(1) + "h" : "—";
                  const locText = d.location?.available ? (d.location.name || `${d.location.latitude?.toFixed(4)}, ${d.location.longitude?.toFixed(4)}`) : "Location unavailable";
                  return (
                    <tr key={d.date} className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${i % 2 === 0 ? isDark ? "bg-[#0A0A0A]" : "bg-white" : isDark ? "bg-[#111]" : "bg-[#FAFAFA]"}`}>
                      <td className={`px-4 py-3 text-xs font-mono ${textPri}`}>{fmt(d.date)}</td>
                      <td className={`px-4 py-3 text-xs ${textSec}`}>{dayNames[d.dayOfWeek] ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadge(d.effectiveStatus)}`}>{d.effectiveStatus}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {d.isHoliday && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-400" title={d.holidayName}>H</span>}
                          {d.isLeave && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400" title={d.leaveType}>L</span>}
                          {d.isWeekOff && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/10 text-purple-400">WO</span>}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-xs font-mono ${textSec}`}>{d.loginTime ? new Date(d.loginTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}</td>
                      <td className={`px-4 py-3 text-xs font-mono ${textSec}`}>{d.logoutTime ? new Date(d.logoutTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}</td>
                      <td className={`px-4 py-3 text-xs font-mono ${textSec}`}>{hrs}</td>
                      <td className="px-4 py-3">
                        {d.lateMinutes > 0 ? (
                          <span className="text-[10px] font-bold text-red-400">{d.lateMinutes}m late</span>
                        ) : d.loginTime ? (
                          <span className={`text-[10px] ${textSec}`}>On time</span>
                        ) : <span className={`text-[10px] ${textSec}`}>—</span>}
                      </td>
                      <td className={`px-4 py-3 text-xs ${d.location?.available ? textPri : textSec} max-w-[150px] truncate`} title={locText}>{locText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`rounded-2xl p-6 text-center border border-dashed ${isDark ? "border-[#38383A] bg-[#1C1C1E]" : "border-[#D1D1D6] bg-white"}`}>
          <p className={`text-sm ${textSec}`}>No attendance data for the selected period.</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EARNINGS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function EarningsTab({ employeeId, isDark, card, textSec, textPri }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  // Salary form state
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [salBase, setSalBase] = useState("");
  const [salEffective, setSalEffective] = useState(new Date().toISOString().slice(0, 10));
  const [salReason, setSalReason] = useState("");
  const [salSaving, setSalSaving] = useState(false);

  const inputCls = `w-full rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`;
  const btnPrimary = `px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${isDark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`;
  const btnSecondary = `px-4 py-2 rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#D1D1D6] text-[#86868B] hover:border-[#AEAEB2]"}`;

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/earnings?year=${year}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setData(j.data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [employeeId, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveSalary = async () => {
    const base = Number(salBase);
    if (!base || base <= 0) { setError("Base salary must be a positive number."); return; }
    if (!salEffective) { setError("Effective date is required."); return; }
    setSalSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/salary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseSalary: base, effectiveFrom: salEffective, revisionReason: salReason.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
      setSuccess(j.message || "Salary revision saved.");
      setShowSalaryForm(false);
      setSalBase(""); setSalReason("");
      fetchData();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) { setError(e.message); }
    finally { setSalSaving(false); }
  };

  if (loading) return <div className={`rounded-2xl animate-pulse h-48 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />;

  const salary = data?.salary;
  const incentives = data?.incentives;
  const leave = data?.leave || [];
  const attendance = data?.attendance;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl p-3 text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}
      {success && <div className="rounded-xl p-3 text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{success}</div>}

      <div className="flex items-center gap-2">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className={`rounded-xl px-3 py-2 text-xs font-medium border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Salary section */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <div className="flex items-center justify-between mb-1">
          <h3 className={`text-sm font-bold ${textPri}`}>Salary Rate</h3>
          <button
            onClick={() => setShowSalaryForm(!showSalaryForm)}
            className={`text-[10px] px-3 py-1 rounded-lg font-semibold cursor-pointer ${isDark ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
          >
            {salary?.currentMonthlyBase != null ? "Revise Salary" : "Set Salary"}
          </button>
        </div>
        <p className={`text-[10px] mb-4 ${textSec}`}>{salary?.note || "Configured rates, not verified payment records."}</p>

        {/* Salary form */}
        {showSalaryForm && (
          <div className={`rounded-xl p-4 mb-4 space-y-3 ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
            <p className={`text-xs font-bold ${textPri}`}>{salary?.currentMonthlyBase != null ? "Salary Revision" : "Initial Salary Configuration"}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${textSec}`}>Monthly Base Salary (INR)</label>
                <input type="number" value={salBase} onChange={e => setSalBase(e.target.value)} placeholder="e.g. 50000" min={1} className={inputCls} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${textSec}`}>Effective From</label>
                <input type="date" value={salEffective} onChange={e => setSalEffective(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={`text-[10px] font-semibold block mb-1 ${textSec}`}>Reason (optional)</label>
              <input value={salReason} onChange={e => setSalReason(e.target.value)} placeholder="e.g. Annual increment, Promotion" className={inputCls} />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveSalary} disabled={salSaving} className={btnPrimary}>
                {salSaving ? "Saving..." : "Save"}
              </button>
              <button onClick={() => { setShowSalaryForm(false); setError(null); }} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        )}

        {salary?.currentMonthlyBase != null ? (
          <div>
            <p className={`text-2xl font-black ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>{money(salary.currentMonthlyBase)}<span className={`text-xs font-normal ml-1 ${textSec}`}>/month (rate)</span></p>
          </div>
        ) : (
          <p className={`text-sm ${textSec}`}>No salary rate configured. Click &quot;Set Salary&quot; above.</p>
        )}
        {salary?.rateHistory?.length > 0 && (
          <div className="mt-4">
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${textSec}`}>Rate History</p>
            <div className="space-y-1.5">
              {salary.rateHistory.map((r: any, i: number) => (
                <div key={i} className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                  <span className={`font-bold ${textPri}`}>{money(r.baseSalary)}/mo</span>
                  <span className={textSec}>{fmt(r.effectiveFrom)} — {r.effectiveTo ? fmt(r.effectiveTo) : "Current"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Incentives summary */}
      <div className={`rounded-2xl p-5 ${card}`}>
        <h3 className={`text-sm font-bold mb-1 ${textPri}`}>Incentive Totals ({year})</h3>
        <p className={`text-[10px] mb-4 ${textSec}`}>{incentives?.note || "'Paid' requires a verified payment record."}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className={`text-[10px] font-bold uppercase ${textSec}`}>Pending</p>
            <p className="font-bold text-amber-400">{money(incentives?.totalPending)}</p>
          </div>
          <div>
            <p className={`text-[10px] font-bold uppercase ${textSec}`}>Approved</p>
            <p className="font-bold text-emerald-400">{money(incentives?.totalApproved)}</p>
          </div>
          <div>
            <p className={`text-[10px] font-bold uppercase ${textSec}`}>Paid</p>
            <p className="font-bold text-blue-400">{money(incentives?.totalPaid)}</p>
          </div>
          <div>
            <p className={`text-[10px] font-bold uppercase ${textSec}`}>Total Earned</p>
            <p className={`font-bold ${textPri}`}>{money(incentives?.totalEarned)}</p>
          </div>
        </div>
      </div>

      {/* Leave balance */}
      {leave.length > 0 && (
        <div className={`rounded-2xl p-5 ${card}`}>
          <h3 className={`text-sm font-bold mb-3 ${textPri}`}>Leave Balance ({year})</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {leave.map((l: any) => (
              <div key={l.leaveType}>
                <p className={`text-[10px] font-bold uppercase ${textSec}`}>{capitalize(l.leaveType)}</p>
                <p className={`font-bold ${textPri}`}>{l.remaining} <span className={`text-[10px] font-normal ${textSec}`}>of {l.allocated}</span></p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attendance summary */}
      {attendance && (
        <div className={`rounded-2xl p-5 ${card}`}>
          <h3 className={`text-sm font-bold mb-3 ${textPri}`}>Attendance Summary ({year})</h3>
          {attendance.note && (
            <p className={`text-[10px] mb-3 px-2 py-1.5 rounded-lg ${isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-600"}`}>{attendance.note}</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Present Days</p>
              <p className="font-bold text-emerald-400">{attendance.presentDays}</p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Absent Days</p>
              <p className="font-bold text-red-400">{attendance.absentDays}</p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Holidays</p>
              <p className="font-bold text-blue-400">{attendance.holidayDays ?? 0}</p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Approved Leave</p>
              <p className="font-bold text-amber-400">{attendance.approvedLeaveDays ?? 0}</p>
            </div>
          </div>
          <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"}`}>
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Expected Working Days</p>
              <p className={`font-bold ${textPri}`}>{attendance.expectedWorkingDays ?? "—"}</p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Week-Off Days</p>
              <p className={`font-bold ${textPri}`}>{attendance.weekOffDays ?? 0}</p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Calendar Days</p>
              <p className={`font-bold ${textPri}`}>{attendance.totalCalendarDays ?? "—"}</p>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase ${textSec}`}>Raw Records</p>
              <p className={`font-bold ${textSec}`}>{attendance.totalRecords}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
