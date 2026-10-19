"use client";

import { useEffect, useState, useCallback } from "react";
import {
  IoSettingsOutline,
  IoAddOutline,
  IoTrashOutline,
  IoCreateOutline,
  IoCheckmarkCircle,
  IoCloseCircle,
  IoInformationCircleOutline,
} from "react-icons/io5";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GlobalConfig {
  defaultBrokerageRate: number;
  defaultBrokerageMethod: "percentage" | "fixed";
  calculationBasis: "agreement_value" | "booking_amount" | "ocr_amount" | "disbursement_amount";
}

interface ProjectConfig {
  id: number;
  projectName: string;
  brokerageRate: number;
  brokerageMethod: "percentage" | "fixed";
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

interface BookingBrokerage {
  id: number;
  bookingId: number;
  bookingNumber: string;
  agreementValue: number;
  brokerageMethod: string;
  brokerageRate: number;
  brokerageAmount: number;
  source: string;
  status: string;
  receivedAmount: number;
  receivedDate: string | null;
  createdBy: string;
  bookingDate: string;
  employeeName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, isDark, children }: {
  title: string; subtitle?: string; isDark: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA] shadow-sm"}`}>
      <div className={`px-5 py-4 border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
        <h3 className={`text-sm font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>{title}</h3>
        {subtitle && <p className={`text-[11px] mt-0.5 ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatusPill({ status, isDark }: { status: string; isDark: boolean }) {
  const styles: Record<string, string> = {
    expected: isDark ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "bg-blue-100 text-blue-700 border-blue-200",
    received: isDark ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-emerald-100 text-emerald-700 border-emerald-200",
    partially_received: isDark ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-amber-100 text-amber-700 border-amber-200",
    pending: isDark ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" : "bg-yellow-100 text-yellow-700 border-yellow-200",
    reversed: isDark ? "bg-red-500/15 text-red-400 border-red-500/30" : "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${styles[status] || styles.expected}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function SourceBadge({ source, isDark }: { source: string; isDark: boolean }) {
  const labels: Record<string, string> = {
    global_default: "Global Default",
    project_override: "Project Override",
    manual_override: "Manual Override",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${isDark ? "bg-[#2C2C2E] text-[#98989D]" : "bg-[#F2F2F7] text-[#86868B]"}`}>
      {labels[source] || source}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function HRBrokerageConfig({ isDark }: { isDark: boolean }) {
  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const textAccent = isDark ? "text-emerald-400" : "text-emerald-600";
  const inputCls = `w-full px-3 py-2 rounded-xl text-sm border outline-none transition-colors ${
    isDark ? "bg-[#2C2C2E] border-[#38383A] text-white focus:border-emerald-500" : "bg-white border-[#E5E5EA] text-[#1D1D1F] focus:border-emerald-500"
  }`;
  const btnPrimary = `px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all ${
    isDark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"
  }`;
  const btnSecondary = `px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all border ${
    isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#E5E5EA] text-[#86868B] hover:border-[#D1D1D6]"
  }`;

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [global, setGlobal] = useState<GlobalConfig>({ defaultBrokerageRate: 0, defaultBrokerageMethod: "percentage", calculationBasis: "agreement_value" });
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [bookings, setBookings] = useState<BookingBrokerage[]>([]);
  const [bookingsPage, setBookingsPage] = useState(1);
  const [bookingsTotal, setBookingsTotal] = useState(0);

  // New project form
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [newProject, setNewProject] = useState({ projectName: "", brokerageRate: "", brokerageMethod: "percentage" as const, notes: "" });

  // Edit booking modal
  const [editingBooking, setEditingBooking] = useState<BookingBrokerage | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editMethod, setEditMethod] = useState<"percentage" | "fixed">("percentage");
  const [editStatus, setEditStatus] = useState("");
  const [editReceived, setEditReceived] = useState("");

  // Confirm dialog for global change
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [pendingGlobal, setPendingGlobal] = useState<GlobalConfig | null>(null);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/brokerage-config");
      const j = await res.json();
      if (j.success) {
        setGlobal(j.data.global);
        setProjects(j.data.projects);
      } else {
        setError(j.message || j.error || "Failed to load configuration");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBookings = useCallback(async (page = 1) => {
    try {
      const res = await fetch(`/api/hr/booking-brokerage?page=${page}&limit=10`);
      const j = await res.json();
      if (j.success) {
        setBookings(j.data.records);
        setBookingsTotal(j.data.pagination.total);
        setBookingsPage(page);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchConfig(); fetchBookings(); }, [fetchConfig, fetchBookings]);

  // Clear messages after 4s
  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 4000); return () => clearTimeout(t); }
  }, [success]);

  // Save global config
  const saveGlobal = async (cfg: GlobalConfig) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/brokerage-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "global", defaultBrokerageRate: cfg.defaultBrokerageRate, defaultBrokerageMethod: cfg.defaultBrokerageMethod, calculationBasis: cfg.calculationBasis }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message);
      setGlobal(cfg);
      setSuccess("Global brokerage rate updated. Existing bookings are unchanged.");
      setConfirmGlobal(false);
      setPendingGlobal(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Save project config
  const saveProject = async () => {
    if (!newProject.projectName.trim() || !newProject.brokerageRate) return;
    setSaving(true);
    try {
      const res = await fetch("/api/hr/brokerage-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "project",
          projectName: newProject.projectName.trim(),
          brokerageRate: Number(newProject.brokerageRate),
          brokerageMethod: newProject.brokerageMethod,
          notes: newProject.notes || null,
        }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message);
      setSuccess("Project brokerage configuration saved.");
      setShowProjectForm(false);
      setNewProject({ projectName: "", brokerageRate: "", brokerageMethod: "percentage", notes: "" });
      fetchConfig();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete project config
  const deleteProject = async (id: number) => {
    try {
      const res = await fetch(`/api/hr/brokerage-config?projectId=${id}`, { method: "DELETE" });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message);
      setSuccess("Project override removed.");
      fetchConfig();
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Update booking brokerage
  const updateBookingBrokerage = async () => {
    if (!editingBooking) return;
    setSaving(true);
    try {
      const body: any = {};
      if (editRate) body.brokerageRate = Number(editRate);
      if (editMethod) body.brokerageMethod = editMethod;
      if (editStatus) body.status = editStatus;
      if (editReceived) body.receivedAmount = Number(editReceived);

      const res = await fetch(`/api/hr/booking-brokerage/${editingBooking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || j.message);
      setSuccess("Booking brokerage updated.");
      setEditingBooking(null);
      fetchBookings(bookingsPage);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${textAccent}`}>Configuration</p>
          <h2 className={`text-xl font-black ${textPrimary}`}>Brokerage Settings</h2>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className={`rounded-2xl h-32 animate-pulse ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${textAccent}`}>Configuration</p>
        <h2 className={`text-xl font-black ${textPrimary}`}>Brokerage Settings</h2>
        <p className={`text-sm mt-0.5 ${textSecondary}`}>
          Configure default brokerage rates and manage booking-specific overrides
        </p>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium flex items-center gap-2">
          <IoCloseCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium flex items-center gap-2">
          <IoCheckmarkCircle size={16} /> {success}
        </div>
      )}

      {/* ─── Global Default ─── */}
      <SectionCard
        title="Default Brokerage Rate"
        subtitle="Applies to new bookings unless overridden by a project or manual setting"
        isDark={isDark}
      >
        <div className="flex flex-col sm:flex-row gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>
              Calculation Basis
            </label>
            <select
              value={global.calculationBasis}
              onChange={(e) => setGlobal({ ...global, calculationBasis: e.target.value as any })}
              className={inputCls}
            >
              <option value="agreement_value">Agreement Value</option>
              <option value="booking_amount">Booking Amount</option>
              <option value="ocr_amount">OCR Received</option>
              <option value="disbursement_amount">Loan Disbursement</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>
              Calculation Method
            </label>
            <select
              value={global.defaultBrokerageMethod}
              onChange={(e) => setGlobal({ ...global, defaultBrokerageMethod: e.target.value as any })}
              className={inputCls}
            >
              <option value="percentage">Percentage of {({ agreement_value: "Agreement Value", booking_amount: "Booking Amount", ocr_amount: "OCR Received", disbursement_amount: "Loan Disbursement" })[global.calculationBasis]}</option>
              <option value="fixed">Fixed Amount per Booking</option>
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className={`text-xs font-medium mb-1.5 block ${textSecondary}`}>
              {global.defaultBrokerageMethod === "percentage" ? "Rate (%)" : "Fixed Amount (INR)"}
            </label>
            <input
              type="number"
              step={global.defaultBrokerageMethod === "percentage" ? "0.01" : "1"}
              min="0"
              max={global.defaultBrokerageMethod === "percentage" ? "100" : undefined}
              value={global.defaultBrokerageRate}
              onChange={(e) => setGlobal({ ...global, defaultBrokerageRate: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <button
            onClick={() => {
              if (global.defaultBrokerageRate < 0) { setError("Rate cannot be negative"); return; }
              if (global.defaultBrokerageMethod === "percentage" && global.defaultBrokerageRate > 100) { setError("Percentage cannot exceed 100%"); return; }
              setPendingGlobal(global);
              setConfirmGlobal(true);
            }}
            className={btnPrimary}
          >
            Save Default
          </button>
        </div>

        <div className={`mt-4 rounded-xl p-3 flex items-start gap-2 text-xs ${isDark ? "bg-[#2C2C2E] text-[#98989D]" : "bg-[#F2F2F7] text-[#86868B]"}`}>
          <IoInformationCircleOutline size={16} className="flex-shrink-0 mt-0.5" />
          <span>Changing the default rate only affects future bookings. Existing booking brokerage amounts remain unchanged. Booking-specific overrides always take precedence.</span>
        </div>
      </SectionCard>

      {/* Confirm Global Change Dialog */}
      {confirmGlobal && pendingGlobal && (
        <div className={`rounded-2xl border p-5 ${isDark ? "bg-amber-500/5 border-amber-500/20" : "bg-amber-50 border-amber-200"}`}>
          <p className={`text-sm font-semibold mb-2 ${textPrimary}`}>Confirm Default Rate Change</p>
          <p className={`text-xs mb-4 ${textSecondary}`}>
            New default: {pendingGlobal.defaultBrokerageMethod === "percentage"
              ? `${pendingGlobal.defaultBrokerageRate}% of ${({ agreement_value: "agreement value", booking_amount: "booking amount", ocr_amount: "OCR received", disbursement_amount: "loan disbursement" } as Record<string, string>)[pendingGlobal.calculationBasis]}`
              : `₹${pendingGlobal.defaultBrokerageRate.toLocaleString("en-IN")} fixed per booking`
            }. This will not change existing bookings.
          </p>
          <div className="flex gap-2">
            <button onClick={() => saveGlobal(pendingGlobal)} disabled={saving} className={btnPrimary}>
              {saving ? "Saving..." : "Confirm Change"}
            </button>
            <button onClick={() => { setConfirmGlobal(false); setPendingGlobal(null); }} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── Project Overrides ─── */}
      <SectionCard
        title="Project-Specific Overrides"
        subtitle="Override the default rate for specific projects. Takes precedence over the global default."
        isDark={isDark}
      >
        {projects.length > 0 && (
          <div className="space-y-2 mb-4">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl ${isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]"}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${textPrimary}`}>{p.projectName}</p>
                  <p className={`text-[11px] ${textSecondary}`}>
                    {p.brokerageMethod === "percentage" ? `${p.brokerageRate}%` : fmtCurrency(p.brokerageRate)}
                    {p.notes && ` — ${p.notes}`}
                  </p>
                </div>
                <button
                  onClick={() => deleteProject(p.id)}
                  className="p-2 rounded-lg cursor-pointer text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Remove override"
                >
                  <IoTrashOutline size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showProjectForm ? (
          <div className={`rounded-xl p-4 space-y-3 border ${isDark ? "border-[#38383A] bg-[#0A0A0A]" : "border-[#E5E5EA] bg-[#FAFAFA]"}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Project Name</label>
                <input
                  value={newProject.projectName}
                  onChange={(e) => setNewProject({ ...newProject, projectName: e.target.value })}
                  placeholder="e.g., Skyline Towers"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Method</label>
                <select
                  value={newProject.brokerageMethod}
                  onChange={(e) => setNewProject({ ...newProject, brokerageMethod: e.target.value as any })}
                  className={inputCls}
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed Amount</option>
                </select>
              </div>
              <div>
                <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>
                  {newProject.brokerageMethod === "percentage" ? "Rate (%)" : "Amount (INR)"}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newProject.brokerageRate}
                  onChange={(e) => setNewProject({ ...newProject, brokerageRate: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Notes</label>
                <input
                  value={newProject.notes}
                  onChange={(e) => setNewProject({ ...newProject, notes: e.target.value })}
                  placeholder="Optional"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveProject} disabled={saving} className={btnPrimary}>
                {saving ? "Saving..." : "Save Project Override"}
              </button>
              <button onClick={() => setShowProjectForm(false)} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowProjectForm(true)} className={`flex items-center gap-2 ${btnSecondary}`}>
            <IoAddOutline size={16} /> Add Project Override
          </button>
        )}
      </SectionCard>

      {/* ─── Booking Brokerage Records ─── */}
      <SectionCard
        title="Booking Brokerage Records"
        subtitle="Individual booking brokerage amounts and payment tracking"
        isDark={isDark}
      >
        {bookings.length === 0 ? (
          <p className={`text-sm ${textSecondary}`}>No brokerage records yet. Records are created when bookings are assigned brokerage rates.</p>
        ) : (
          <>
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? "text-[#98989D]" : "text-[#86868B]"}>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-2">Booking</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2">Agreement</th>
                    <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2">Rate</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2">Brokerage</th>
                    <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2">Source</th>
                    <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2">Status</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-2">Received</th>
                    <th className="text-center text-[10px] font-bold uppercase tracking-wider px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b, i) => (
                    <tr
                      key={b.id}
                      className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${
                        i % 2 === 0 ? isDark ? "bg-transparent" : "bg-white" : isDark ? "bg-[#111]/50" : "bg-[#FAFAFA]"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <p className={`text-xs font-semibold ${textPrimary}`}>{b.bookingNumber || `#${b.bookingId}`}</p>
                        <p className={`text-[10px] ${textSecondary}`}>{b.employeeName}</p>
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs ${textSecondary}`}>{fmtCurrency(b.agreementValue)}</td>
                      <td className={`px-4 py-2.5 text-center text-xs font-medium ${textPrimary}`}>
                        {b.brokerageMethod === "percentage" ? `${b.brokerageRate}%` : fmtCurrency(b.brokerageRate)}
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs font-semibold ${textAccent}`}>{fmtCurrency(b.brokerageAmount)}</td>
                      <td className="px-4 py-2.5 text-center"><SourceBadge source={b.source} isDark={isDark} /></td>
                      <td className="px-4 py-2.5 text-center"><StatusPill status={b.status} isDark={isDark} /></td>
                      <td className={`px-4 py-2.5 text-right text-xs ${textSecondary}`}>{fmtCurrency(b.receivedAmount)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => {
                            setEditingBooking(b);
                            setEditRate(String(b.brokerageRate));
                            setEditMethod(b.brokerageMethod as any);
                            setEditStatus(b.status);
                            setEditReceived(String(b.receivedAmount));
                          }}
                          className="p-1.5 rounded-lg cursor-pointer text-blue-400 hover:bg-blue-500/10 transition-colors"
                          title="Edit brokerage"
                        >
                          <IoCreateOutline size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {bookingsTotal > 10 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  disabled={bookingsPage <= 1}
                  onClick={() => fetchBookings(bookingsPage - 1)}
                  className={`${btnSecondary} ${bookingsPage <= 1 ? "opacity-40 cursor-default" : ""}`}
                >
                  Previous
                </button>
                <span className={`text-xs ${textSecondary}`}>
                  Page {bookingsPage} of {Math.ceil(bookingsTotal / 10)}
                </span>
                <button
                  disabled={bookingsPage >= Math.ceil(bookingsTotal / 10)}
                  onClick={() => fetchBookings(bookingsPage + 1)}
                  className={`${btnSecondary} ${bookingsPage >= Math.ceil(bookingsTotal / 10) ? "opacity-40 cursor-default" : ""}`}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* ─── Edit Booking Brokerage Modal ─── */}
      {editingBooking && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditingBooking(null)} />
          <div className={`relative w-full max-w-md rounded-2xl p-6 border ${isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA]"}`}>
            <h3 className={`text-base font-semibold mb-1 ${textPrimary}`}>Edit Booking Brokerage</h3>
            <p className={`text-xs mb-4 ${textSecondary}`}>
              {editingBooking.bookingNumber || `Booking #${editingBooking.bookingId}`} — Agreement: {fmtCurrency(editingBooking.agreementValue)}
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Method</label>
                  <select value={editMethod} onChange={(e) => setEditMethod(e.target.value as any)} className={inputCls}>
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>
                <div>
                  <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>
                    {editMethod === "percentage" ? "Rate (%)" : "Amount (INR)"}
                  </label>
                  <input type="number" step="0.01" min="0" value={editRate} onChange={(e) => setEditRate(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Status</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className={inputCls}>
                    <option value="expected">Expected</option>
                    <option value="pending">Pending</option>
                    <option value="partially_received">Partially Received</option>
                    <option value="received">Received</option>
                    <option value="reversed">Reversed</option>
                  </select>
                </div>
                <div>
                  <label className={`text-xs font-medium mb-1 block ${textSecondary}`}>Received Amount</label>
                  <input type="number" step="1" min="0" value={editReceived} onChange={(e) => setEditReceived(e.target.value)} className={inputCls} />
                </div>
              </div>

              {editRate && (
                <div className={`rounded-xl p-3 text-xs ${isDark ? "bg-[#2C2C2E] text-[#98989D]" : "bg-[#F2F2F7] text-[#86868B]"}`}>
                  Calculated brokerage:{" "}
                  <strong className={textPrimary}>
                    {editMethod === "percentage"
                      ? fmtCurrency(editingBooking.agreementValue * Number(editRate) / 100)
                      : fmtCurrency(Number(editRate))}
                  </strong>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={updateBookingBrokerage} disabled={saving} className={btnPrimary}>
                {saving ? "Saving..." : "Update Brokerage"}
              </button>
              <button onClick={() => setEditingBooking(null)} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
