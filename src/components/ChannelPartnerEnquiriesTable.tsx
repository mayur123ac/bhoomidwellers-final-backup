"use client";
// ChannelPartnerEnquiriesTable.tsx — the single CP-enquiry table for all three panels.
//
//   Receptionist  "Channel Partner Enquiries"    — all rows, view only
//   Sourcing Mgr  "Assigned Channel Partners"    — own rows only (forced server-side)
//   Admin         "Channel Partner Management"   — all rows, filter + reassign
//
// Deliberately one component rather than three copies: the column set is 20 wide and
// would drift immediately. Panels differ only by the `canReassign` / `showFilter`
// props and the heading — the row scoping is NOT done here, it is forced in
// /api/cp-enquiries, so a Sourcing Manager never receives another manager's rows in
// the first place.
//
// Column naming note: the spec's flat list mixed partner-owned and client-owned
// fields under bare labels ("Phone Number", "City", "Email"). Since both
// walkin_enquiries and channel_partners now carry city/pin_code/phone/email, every
// header here is prefixed CP / Client so a row can never be misread.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaSearch, FaTimes, FaUserTie, FaExchangeAlt, FaHandshake } from "react-icons/fa";
import SearchableSelect, { SelectOption } from "./SearchableSelect";
import { normalizeRole } from "@/lib/cpRbac";

interface Props {
  user: { name: string; role: string; _id?: string };
  isDark: boolean;
  t: any;
  title?: string;
  subtitle?: string;
}

const dash = (t: any) => <span className={t.textFaint}>—</span>;

const fmtDate = (raw: any, withTime = false) => {
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  } catch { return null; }
};

/** Partner-master value first, falling back to what reception typed on the enquiry.
 *  A CP enquiry whose cp_name never resolved to a partner row still shows a name. */
const cpField = (row: any, masterKey: string, enquiryKey?: string) =>
  row[masterKey] || (enquiryKey ? row[enquiryKey] : null) || null;

const employeeCode = (id: any, username?: any) =>
  username || (id ? `#${id}` : null);

export default function ChannelPartnerEnquiriesTable({ user, isDark, t, title, subtitle }: Props) {
  const role = normalizeRole(user?.role);
  const isAdmin = role === "admin";
  // Reassignment is Admin-only: reception assigns once at creation and cannot change
  // it afterwards, and a Sourcing Manager cannot move work off their own desk.
  // Filtering by Sourcing Manager, unlike reassigning, is read-only and safe for
  // Receptionist too — they can already see every row, filtering just narrows it.
  const canReassign = isAdmin;
  const showFilter = isAdmin || role === "receptionist";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [smFilter, setSmFilter] = useState("");
  const [managers, setManagers] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [assignmentHistory, setAssignmentHistory] = useState<any[]>([]);
  const [assignmentHistoryLoading, setAssignmentHistoryLoading] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<any>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (showFilter && smFilter) p.set("sourcing_manager_id", smFilter);
      const res = await fetch(`/api/cp-enquiries?${p.toString()}`);
      const json = await res.json();
      if (json.success) setRows(json.data || []);
    } catch { /* non-blocking */ } finally { setLoading(false); }
  }, [showFilter, smFilter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Only the roles that can filter or reassign need the manager list.
  useEffect(() => {
    if (!showFilter && !canReassign) return;
    fetch("/api/users/sourcing-manager")
      .then(r => r.json())
      .then(j => { if (j.success) setManagers(j.data || []); })
      .catch(() => { });
  }, [showFilter, canReassign]);

  const managerOptions: SelectOption[] = useMemo(
    () => managers.map(m => ({
      value: String(m.id),
      label: m.name,
      sublabel: `ID ${m.id}${m.username ? ` · ${m.username}` : ""}${m.phone ? ` · ${m.phone}` : ""}`,
      keywords: `${m.username || ""} ${m.phone || ""} ${m.email || ""}`,
    })),
    [managers]
  );

  // Client-side search: the CP subset is a small slice of total leads, so filtering
  // in place beats a round trip per keystroke.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter(r =>
      [
        r.id, r.sr_no, r.client_name, r.partner_name, r.cp_name,
        r.partner_company, r.cp_company, r.owner_contact_person,
        r.gst_number, r.rera_registration_no, r.preferred_location,
        r.sourcing_manager_name, r.status, r.budget, r.configuration,
      ].some(v => String(v ?? "").toLowerCase().includes(q)) ||
      (digits.length >= 3 && [r.client_phone, r.alt_phone, r.partner_phone, r.cp_phone]
        .some(v => String(v ?? "").replace(/\D/g, "").includes(digits)))
    );
  }, [rows, search]);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 5000); };

  const submitReassign = async () => {
    if (!reassignTarget) return;
    setReassignBusy(true);
    setReassignError(null);
    try {
      const res = await fetch(`/api/cp-enquiries/${reassignTarget.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcing_manager_id: reassignTo === "" ? null : Number(reassignTo) }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setReassignError(json.message || "Reassign failed."); return; }
      setReassignTarget(null);
      flash(json.message);
      fetchRows();
    } catch (e: any) {
      setReassignError(e.message || "Network error.");
    } finally {
      setReassignBusy(false);
    }
  };

  const columns = [
    "Lead No.", "Created", "CP Name", "CP Company", "CP Phone",
    "Office Address", "Owner / Contact", "GST", "RERA", "CP City", "CP Pin",
    "Client Name", "Client Phone", "Alt Phone", "Client Email",
    "Preferred Location", "Budget", "Requirement", "Sourcing Manager", "Status",
    ...(canReassign ? [""] : []),
  ];

  const inputCls = `rounded-lg px-2.5 py-1.5 text-xs outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`;
  const cell = `px-3 py-3 whitespace-nowrap ${t.textMuted}`;

  const requirementOf = (r: any) => {
    const parts = [r.configuration, r.purpose]
      .map(v => (v && v !== "N/A" && v !== "Pending" ? String(v) : null))
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-1">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 px-2 pt-2">
        <div className="flex items-center gap-2">
          <FaHandshake className={t.accentText} />
          <div>
            <h2 className={`text-base font-bold ${t.text}`}>{title || "Channel Partner Enquiries"}</h2>
            {subtitle && <p className={`text-[11px] ${t.textFaint}`}>{subtitle}</p>}
          </div>
          <span className={`text-xs ${t.textFaint}`}>({rows.length})</span>
        </div>

        <div className="flex items-center gap-2">
          {showFilter && (
            <select value={smFilter} onChange={e => setSmFilter(e.target.value)}
              className={`${inputCls} cursor-pointer`}>
              <option value="">All Sourcing Managers</option>
              <option value="unassigned">Unassigned</option>
              {managers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
          )}
          <div className="relative">
            <FaSearch className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] ${t.textFaint}`} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search CP, client, phone…" className={`${inputCls} pl-7 w-56`} />
          </div>
        </div>
      </div>

      {notice && (
        <div className={`mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] ${
          isDark ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-400"
                 : "bg-emerald-50 border border-emerald-200 text-emerald-700"}`}>
          {notice}
        </div>
      )}

      {/* Read-only roles are told so explicitly, rather than just finding no buttons. */}
      {!canReassign && (
        <div className={`mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] ${
          isDark ? "bg-[#14141B] border border-[#2A2A35] text-[#888899]"
                 : "bg-slate-50 border border-slate-200 text-slate-600"}`}>
          {role === "sourcing manager"
            ? "Showing only the channel partners assigned to you. View only — contact an Admin to change an assignment."
            : "View only. The assigned Sourcing Manager is set at enquiry creation and can only be changed by an Admin."}
        </div>
      )}

      {/* ── Table ── */}
      <div className={`flex-1 overflow-auto mx-2 rounded-xl ${t.card}`}>
        <table className="w-full text-left border-collapse">
          <thead className={`sticky top-0 z-10 ${t.tableHead || (isDark ? "bg-[#1a1a1a]" : "bg-slate-50")}`}>
            <tr className={`text-[10px] uppercase ${t.textMuted}`}>
              {columns.map((h, i) => (
                <th key={`${h}-${i}`} className="px-3 py-3 whitespace-nowrap font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={columns.length} className={`px-4 py-10 text-center text-xs ${t.textFaint}`}>Loading…</td></tr>
            )}

            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <FaUserTie className={`mx-auto mb-3 text-2xl ${t.textFaint}`} />
                  <p className={`text-sm font-bold mb-1 ${t.text}`}>
                    {search ? "No enquiries match your search"
                      : role === "sourcing manager" ? "Nothing assigned to you yet"
                      : smFilter ? "No enquiries for this filter"
                      : "No Channel Partner enquiries yet"}
                  </p>
                  <p className={`text-xs ${t.textMuted}`}>
                    {search ? "Try a different name, phone or GST."
                      : role === "sourcing manager" ? "Enquiries appear here once a Receptionist assigns a Channel Partner to you."
                      : "They appear here when a Receptionist logs an enquiry with source “Channel Partner”."}
                  </p>
                </td>
              </tr>
            )}

            {!loading && visible.map(r => (
              <tr key={r.id} onClick={() => setDetail(r)}
                className={`text-xs cursor-pointer ${t.tableRow} ${isDark ? "border-b border-[#222]" : "border-b border-slate-100"}`}>
                <td className={`px-3 py-3 font-bold whitespace-nowrap ${t.text}`}>
                  #{String(r.sr_no || r.id).padStart(3, "0")}
                </td>
                <td className={cell}>{fmtDate(r.created_at) || dash(t)}</td>
                <td className={`px-3 py-3 font-semibold whitespace-nowrap ${t.text}`}>
                  {cpField(r, "partner_name", "cp_name") || dash(t)}
                </td>
                <td className={cell}>{cpField(r, "partner_company", "cp_company") || dash(t)}</td>
                <td className={cell}>{cpField(r, "partner_phone", "cp_phone") || dash(t)}</td>
                <td className={`px-3 py-3 ${t.textMuted}`}>
                  {r.office_address
                    ? <span className="block max-w-[180px] truncate" title={r.office_address}>{r.office_address}</span>
                    : dash(t)}
                </td>
                <td className={cell}>{r.owner_contact_person || dash(t)}</td>
                <td className={cell}>{r.gst_number || dash(t)}</td>
                <td className={cell}>{r.rera_registration_no || dash(t)}</td>
                <td className={cell}>{r.partner_city || dash(t)}</td>
                <td className={cell}>{r.partner_pin_code || dash(t)}</td>
                <td className={`px-3 py-3 font-semibold whitespace-nowrap ${t.text}`}>{r.client_name || dash(t)}</td>
                <td className={cell}>{r.client_phone || dash(t)}</td>
                <td className={cell}>{r.alt_phone || dash(t)}</td>
                <td className={cell}>{r.email && r.email !== "N/A" ? r.email : dash(t)}</td>
                <td className={cell}>{r.preferred_location || dash(t)}</td>
                <td className={cell}>{r.budget && r.budget !== "Pending" ? r.budget : dash(t)}</td>
                <td className={cell}>{requirementOf(r) || dash(t)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {r.sourcing_manager_name ? (
                    <span className={`font-semibold ${t.text}`}>{r.sourcing_manager_name}</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500">
                      Unassigned
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${t.statusAssigned}`}>
                    {r.status || "Assigned"}
                  </span>
                </td>
                {canReassign && (
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button
                      // Row click opens the detail drawer; this must not trigger it too.
                      onClick={e => {
                        e.stopPropagation();
                        setReassignError(null);
                        setReassignTo(r.sourcing_manager_id ? String(r.sourcing_manager_id) : "");
                        setReassignTarget(r);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                        r.sourcing_manager_id ? `${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}` : t.btnPrimary
                      }`}
                    >
                      <FaExchangeAlt className="inline text-[9px] mr-1" />
                      {r.sourcing_manager_id ? "Reassign" : "Assign"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Detail drawer: full context incl. Assignment Details (Part 6) ── */}
      <AnimatePresence>
        {detail && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setDetail(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className={`w-full max-w-3xl max-h-[88vh] overflow-y-auto custom-scrollbar rounded-2xl p-6 ${t.modalCard || t.card}`}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className={`text-lg font-bold ${t.text}`}>
                    Enquiry #{String(detail.sr_no || detail.id).padStart(3, "0")} — {detail.client_name}
                  </h2>
                  <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>
                    Channel Partner enquiry · created {fmtDate(detail.created_at, true) || "—"}
                  </p>
                </div>
                <button onClick={() => setDetail(null)} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}>
                  <FaTimes />
                </button>
              </div>

              {[
                {
                  heading: "Assignment Details",
                  highlight: true,
                  fields: [
                    ["Assigned Sourcing Manager", detail.sourcing_manager_name],
                    ["Employee ID", detail.sourcing_manager_id ? `#${detail.sourcing_manager_id}` : null],
                    ["Username", detail.sourcing_manager_username],
                    ["Phone Number", detail.sourcing_manager_phone],
                    ["Email", detail.sourcing_manager_email],
                    ["Assigned Date", fmtDate(detail.sourcing_manager_assigned_at, true)],
                    ["Assigned By", detail.sourcing_manager_assigned_by],
                  ],
                },
                {
                  heading: "Channel Partner Information",
                  fields: [
                    ["CP Name", cpField(detail, "partner_name", "cp_name")],
                    ["Company Name", cpField(detail, "partner_company", "cp_company")],
                    ["Phone Number", cpField(detail, "partner_phone", "cp_phone")],
                    ["Owner / Contact Person", detail.owner_contact_person],
                    ["GST Number", detail.gst_number],
                    ["RERA Number", detail.rera_registration_no],
                    ["Office Address", detail.office_address],
                    ["CP City", detail.partner_city],
                    ["CP Pin Code", detail.partner_pin_code],
                  ],
                },
                {
                  heading: "Client Information",
                  fields: [
                    ["Client Name", detail.client_name],
                    ["Client Phone", detail.client_phone],
                    ["Alternate Phone", detail.alt_phone],
                    ["Email", detail.email !== "N/A" ? detail.email : null],
                    ["Residential Address", detail.address !== "N/A" ? detail.address : null],
                    ["Client City", detail.client_city],
                    ["Client Pin Code", detail.client_pin_code],
                    ["Occupation", detail.occupation !== "N/A" ? detail.occupation : null],
                    ["Organization", detail.organization !== "N/A" ? detail.organization : null],
                  ],
                },
                {
                  heading: "Property Requirement",
                  fields: [
                    ["Preferred Location", detail.preferred_location],
                    ["Budget", detail.budget !== "Pending" ? detail.budget : null],
                    ["Configuration", detail.configuration !== "N/A" ? detail.configuration : null],
                    ["Purpose", detail.purpose !== "N/A" ? detail.purpose : null],
                    ["Loan Planned", detail.loan_planned !== "Pending" ? detail.loan_planned : null],
                    ["Current Status", detail.status],
                    ["Assigned To (Sales)", detail.assigned_to],
                    ["Logged By", detail.assigned_receptionist],
                  ],
                },
              ].map(section => (
                <div
                  key={section.heading}
                  className={`mb-5 rounded-xl p-4 border ${
                    section.highlight
                      ? isDark ? "bg-[#9E217B]/10 border-[#9E217B]/30" : "bg-[#9E217B]/5 border-[#9E217B]/25"
                      : `${t.modalBlock}`
                  }`}
                  style={section.highlight ? {} : t.modalBlockGl}
                >
                  <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${section.highlight ? t.accentText : t.sectionTitle}`}>
                    {section.heading}
                  </p>
                  {/* Read-only throughout — no role edits an enquiry from this drawer. */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {section.fields.map(([label, value]) => (
                      <div key={String(label)}>
                        <p className={`text-[10px] font-medium mb-0.5 ${t.textFaint}`}>{label}</p>
                        <p className={`text-xs font-semibold break-words ${t.text}`}>
                          {value ? String(value) : <span className={t.textFaint}>N/A</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Reassign (Admin only) ── */}
      <AnimatePresence>
        {reassignTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !reassignBusy && setReassignTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl p-6 ${t.modalCard || t.card}`}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className={`text-base font-bold ${t.text}`}>Assign Sourcing Manager</h3>
                <button onClick={() => !reassignBusy && setReassignTarget(null)} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}>
                  <FaTimes />
                </button>
              </div>

              <p className={`text-xs mb-4 ${t.textMuted}`}>
                Enquiry #{String(reassignTarget.sr_no || reassignTarget.id).padStart(3, "0")} ·{" "}
                <span className={`font-bold ${t.text}`}>
                  {cpField(reassignTarget, "partner_name", "cp_name") || "Unnamed partner"}
                </span>
                {reassignTarget.sourcing_manager_name && ` · currently ${reassignTarget.sourcing_manager_name}`}
              </p>

              <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Sourcing Manager</label>
              <SearchableSelect
                value={reassignTo}
                onChange={setReassignTo}
                options={managerOptions}
                isDark={isDark}
                t={t}
                placeholder="Select a Sourcing Manager…"
                emptyMessage="No active Sourcing Managers — create one in Add Employee"
                ariaLabel="Sourcing Manager"
              />
              <button onClick={() => setReassignTo("")}
                className={`mt-2 text-[10px] underline cursor-pointer ${t.textFaint}`}>
                Clear assignment instead
              </button>

              {reassignError && (
                <div className="mt-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                  {reassignError}
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button onClick={() => setReassignTarget(null)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted}`}>
                  Cancel
                </button>
                <button onClick={submitReassign} disabled={reassignBusy}
                  className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary} ${reassignBusy ? "opacity-50 cursor-not-allowed" : ""}`}>
                  {reassignBusy ? "Saving…" : reassignTo === "" ? "Clear Assignment" : "Save Assignment"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
