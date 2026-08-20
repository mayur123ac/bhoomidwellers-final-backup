"use client";
// AssignedChannelPartnersView.tsx — the Channel Partners a Sourcing Manager owns.
//
// Distinct from ChannelPartnerEnquiriesTable, which lists CP *enquiries* (one row
// per client walk-in). This lists CP *records* (one row per partner), the unit the
// Sourcing Manager actually manages, and opens each one's full history.
//
// Scope note: the list is filtered by `assigned_to_me`, not restricted by it.
// /api/channel-partners applies no per-manager scoping — assignment here organizes
// ownership, it does not isolate data, and a Sourcing Manager can still browse the
// whole registry from the "Channel Partners" tab exactly as before.
//
// The detail drawer reads /api/channel-partners/[id]/overview. There are no
// partner-level notes or follow-up tables in this CRM: all three live on the lead,
// so visit history / follow-ups / notes are reached through the partner's
// enquiries. The drawer says so rather than showing empty sections that look broken.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaSearch, FaTimes, FaUserTie, FaHandshake, FaMapMarkerAlt, FaPhone,
  FaClipboardList, FaRegCommentDots, FaWalking, FaFileSignature, FaPlus,
} from "react-icons/fa";

interface Props {
  isDark: boolean;
  t: any;
  title?: string;
  subtitle?: string;
  /** Opens the office-visit registration form. Omit to hide the button. */
  onNewEntry?: () => void;
  /** Bumped by the parent after a save, to force a refetch. */
  refreshKey?: number;
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

/** Values the enquiry form writes as placeholders rather than leaving null. */
const real = (v: any) => (v && v !== "N/A" && v !== "Pending" ? v : null);

// The signed-in user is never passed in: "assigned to me" is resolved server-side
// from the session cookie, so this component cannot be pointed at another manager.
export default function AssignedChannelPartnersView({
  isDark, t, title, subtitle, onNewEntry, refreshKey = 0,
}: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Defaults to most-leads-first, not alphabetical: the question this table exists
  // to answer is which partners are actually delivering.
  const [sortBy, setSortBy] = useState<"leads" | "bookings" | "name" | "recent">("leads");

  const [detailFor, setDetailFor] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"profile" | "enquiries" | "visits" | "followups" | "bookings">("profile");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/channel-partners?assigned_to_me=true");
      const json = await res.json();
      if (res.ok && json.success) setRows(json.data || []);
      else setLoadError(json.message || `Request failed (${res.status}).`);
    } catch (e: any) {
      setLoadError(e?.message || "Network error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows, refreshKey]);

  // Fetch the full history whenever a partner is opened. Kept keyed on the id so
  // reopening the same partner after an edit elsewhere re-reads rather than
  // showing a stale drawer.
  useEffect(() => {
    if (!detailFor) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setDetailTab("profile");
    (async () => {
      try {
        const res = await fetch(`/api/channel-partners/${detailFor.id}/overview`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json.success) setDetail(json.data);
        else setDetailError(json.message || `Request failed (${res.status}).`);
      } catch (e: any) {
        if (!cancelled) setDetailError(e?.message || "Network error.");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [detailFor]);

  // Client-side: one manager's partner list is tens of rows, so filtering in
  // place beats a round trip per keystroke.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const filtered = !q ? rows : rows.filter(r =>
      [r.name, r.company_name, r.owner_contact_person, r.gst_number,
      r.rera_registration_no, r.city, r.pin_code, r.office_address]
        .some(v => String(v ?? "").toLowerCase().includes(q)) ||
      (digits.length >= 3 && String(r.phone ?? "").replace(/\D/g, "").includes(digits))
    );

    const byName = (a: any, b: any) => String(a.name || "").localeCompare(String(b.name || ""));
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        // Ties broken by name so the order is stable between refreshes rather than
        // shuffling whenever two partners sit on the same count.
        case "leads":
          return (Number(b.lead_count || 0) - Number(a.lead_count || 0)) || byName(a, b);
        case "bookings":
          return (Number(b.booking_count || 0) - Number(a.booking_count || 0)) || byName(a, b);
        case "recent":
          return new Date(b.assigned_sourcing_manager_at || b.created_at || 0).getTime()
            - new Date(a.assigned_sourcing_manager_at || a.created_at || 0).getTime();
        default:
          return byName(a, b);
      }
    });
  }, [rows, search, sortBy]);

  const profileComplete = (p: any) =>
    !!(p.office_address && p.gst_number && p.rera_registration_no && p.owner_contact_person);

  // Portfolio totals, computed from the unfiltered list so the headline numbers
  // don't change as the operator types in the search box.
  const totals = useMemo(() => {
    const leads = rows.reduce((n, r) => n + Number(r.lead_count || 0), 0);
    const bookings = rows.reduce((n, r) => n + Number(r.booking_count || 0), 0);
    const producing = rows.filter(r => Number(r.lead_count || 0) > 0).length;
    const top = [...rows].sort((a, b) => Number(b.lead_count || 0) - Number(a.lead_count || 0))[0];
    return {
      leads, bookings, producing,
      // Only a partner who has actually brought something counts as "top" — with
      // every partner on zero, naming one would be meaningless.
      top: top && Number(top.lead_count || 0) > 0 ? top : null,
    };
  }, [rows]);

  const columns = [
    "CP Name", "Company", "Owner / Contact", "Phone", "City", "Pin",
    "RERA", "GST", "Leads", "Bookings", "Profile", "Status", "Assigned On",
  ];
  const inputCls = `rounded-xl px-3 py-2 text-xs outline-none transition-all w-[170px] sm:w-56 max-w-full ${isDark
    ? "bg-[#1C1C1E] text-white placeholder-gray-500 border border-[#38383A] focus:bg-[#2C2C2E] focus:border-[#9E217B] focus:ring-2 focus:ring-[#9E217B]/10"
    : "bg-white text-gray-900 placeholder-gray-400 border border-gray-200 focus:bg-white focus:border-[#9E217B] focus:ring-2 focus:ring-[#9E217B]/10"
    }`;
  const cell = `px-3 py-3 whitespace-nowrap ${t.textMuted}`;

  const detailTabs = [
    { id: "profile", label: "Profile", icon: <FaUserTie /> },
    { id: "enquiries", label: `Walk-in Visits${detail ? ` (${detail.counts.enquiries})` : ""}`, icon: <FaWalking /> },
    { id: "visits", label: `Site Visits${detail ? ` (${detail.counts.siteVisits})` : ""}`, icon: <FaMapMarkerAlt /> },
    { id: "followups", label: `Follow-ups${detail ? ` (${detail.counts.followUps})` : ""}`, icon: <FaRegCommentDots /> },
    { id: "bookings", label: `Bookings${detail ? ` (${detail.counts.bookings})` : ""}`, icon: <FaFileSignature /> },
  ] as const;

  const fieldBlock = (heading: string, fields: [string, any][], highlight = false) => (
    <div
      key={heading}
      className={`mb-4 rounded-2xl p-4 transition-colors ${highlight
        ? isDark
          ? "bg-[#9E217B]/20 border border-[#9E217B]/30"
          : "bg-[#9E217B]/10 border border-[#9E217B]/20"
        : isDark
          ? "bg-white/5 border border-white/5"
          : "bg-black/5 border border-transparent"
        }`}
      style={highlight ? {} : t.modalBlockGl}
    >
      <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${highlight ? t.accentText : t.sectionTitle}`}>
        {heading}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {fields.map(([label, value]) => (
          <div key={label}>
            <p className={`text-[10px] font-medium mb-0.5 ${t.textFaint}`}>{label}</p>
            <p className={`text-xs font-semibold break-words ${t.text}`}>
              {value ? String(value) : <span className={t.textFaint}>N/A</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  const emptyActivity = (what: string, why: string) => (
    <div className={`rounded-xl p-8 text-center border ${t.modalBlock}`} style={t.modalBlockGl}>
      <FaClipboardList className={`mx-auto mb-3 text-2xl ${t.textFaint}`} />
      <p className={`text-sm font-bold mb-1 ${t.text}`}>{what}</p>
      <p className={`text-xs ${t.textMuted}`}>{why}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden p-1">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 px-2 pt-2">
        <div className="flex items-center gap-2">
          <FaHandshake className={t.accentText} />
          <div>
            <h2 className={`text-base font-bold ${t.text}`}>{title || "My Channel Partners"}</h2>
            {subtitle && <p className={`text-[11px] ${t.textFaint}`}>{subtitle}</p>}
          </div>
          <span className={`text-xs ${t.textFaint}`}>({rows.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className={`${inputCls} cursor-pointer`} aria-label="Sort partners">
            <option value="leads">Most leads brought</option>
            <option value="bookings">Most bookings</option>
            <option value="recent">Recently assigned</option>
            <option value="name">Name (A–Z)</option>
          </select>
          <div className="relative">
            <FaSearch className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] ${t.textFaint}`} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name, company, phone…" className={`${inputCls} pl-7 w-56`} />
          </div>
          <button onClick={fetchRows} className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}`}>
            ↻ Refresh
          </button>
          {onNewEntry && (
            <button onClick={onNewEntry}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary}`}>
              <FaPlus className="text-[10px]" /> New Entry
            </button>
          )}
        </div>
      </div>

      {/* ── Portfolio summary ──
          What this manager's partners have actually produced, so the answer to
          "who is bringing us business" is on screen before any scrolling. */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mx-2 mb-3">
          {[
            { label: "Partners", value: rows.length, hint: `${totals.producing} have brought leads` },
            { label: "Leads Brought", value: totals.leads, hint: "across all your partners" },
            { label: "Bookings", value: totals.bookings, hint: "sourced by your partners" },
            {
              label: "Top Partner",
              value: totals.top ? Number(totals.top.lead_count) : "—",
              hint: totals.top ? totals.top.name : "no leads yet",
            },
          ].map(card => (
            <div
              key={card.label}
              className={`rounded-2xl px-4 py-3 shadow-sm transition-all ${isDark
                ? "bg-[#1C1C1E] border border-white/5 shadow-black/50"
                : "bg-white border border-black/5 shadow-gray-200/50"
                }`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${t.textMuted}`}>{card.label}</p>
              <p className={`text-xl font-black leading-tight ${t.text}`}>{card.value}</p>
              <p className={`text-[10px] truncate ${t.textFaint}`} title={String(card.hint)}>{card.hint}</p>
            </div>
          ))}
        </div>
      )}

      {loadError && (
        <div className="mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] bg-red-500/10 border border-red-500/30 text-red-500">
          Couldn&apos;t load your channel partners ({loadError}).{" "}
          <button onClick={fetchRows} className="underline cursor-pointer font-bold">Retry</button>
        </div>
      )}

      <div className={`mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] ${isDark ? "bg-[#14141B] border border-[#2A2A35] text-[#888899]"
        : "bg-slate-50 border border-slate-200 text-slate-600"}`}>
        Channel Partners assigned to you, and the leads each has brought in. Click any row
        for their full profile, walk-in visits, site visits, follow-ups and bookings.
        A partner is matched by phone number, so every enquiry logged against a partner
        registered to you lands here automatically.
      </div>

      {/* ── Table ── */}
      <div className={`flex-1 overflow-auto mx-2 rounded-3xl ${t.card}`}>
        <table className="w-full text-left border-collapse">
          <thead className={`sticky top-0 z-10 backdrop-blur-xl ${isDark
            ? "bg-[#000000]/70 border-b border-white/10"
            : "bg-white/70 border-b border-black/5"
            }`}>
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
                    {search ? "No partners match your search" : "No channel partners assigned to you yet"}
                  </p>
                  <p className={`text-xs ${t.textMuted}`}>
                    {search
                      ? "Try a different name, company or phone number."
                      : "Partners appear here once a Receptionist assigns one to you — either on a Channel Partner enquiry or when registering an office visit."}
                  </p>
                </td>
              </tr>
            )}

            {!loading && visible.map(p => (
              <tr key={p.id} onClick={() => setDetailFor(p)}
                className={`text-xs cursor-pointer ${t.tableRow} ${isDark ? "border-b border-[#222]" : "border-b border-slate-100"}`}>
                <td className={`px-3 py-3 font-bold whitespace-nowrap ${t.text}`}>{p.name}</td>
                <td className={cell}>{p.company_name || dash(t)}</td>
                <td className={cell}>{p.owner_contact_person || dash(t)}</td>
                <td className={cell}>{p.phone || dash(t)}</td>
                <td className={cell}>{p.city || dash(t)}</td>
                <td className={cell}>{p.pin_code || dash(t)}</td>
                <td className={cell}>{p.rera_registration_no || dash(t)}</td>
                <td className={cell}>{p.gst_number || dash(t)}</td>
                {/* The count this table is sorted and judged on — a partner who has
                    delivered reads differently from one who has only registered. */}
                <td className="px-3 py-3 whitespace-nowrap">
                  {Number(p.lead_count || 0) > 0 ? (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${isDark ? "bg-[#9E217B]/20 text-[#d946a8]" : "bg-[#9E217B]/10 text-[#9E217B]"}`}>
                      {p.lead_count}
                    </span>
                  ) : (
                    <span className={t.textFaint}>0</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={Number(p.booking_count || 0) > 0 ? `font-bold ${t.text}` : t.textFaint}>
                    {p.booking_count ?? 0}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {profileComplete(p) ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500">Complete</span>
                  ) : (
                    // The gap is this role's actual work queue: partners created
                    // automatically from lead intake have only a name and phone.
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500">Incomplete</span>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wide ${p.status === "active"
                    ? isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-500/10 text-emerald-700"
                    : isDark ? "bg-gray-500/20 text-gray-400" : "bg-gray-500/10 text-gray-700"
                    }`}>
                    {p.status === "active" ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className={cell}>{fmtDate(p.assigned_sourcing_manager_at) || dash(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Detail drawer ── */}
      <AnimatePresence>
        {detailFor && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
            onClick={() => setDetailFor(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className={`w-full max-w-4xl max-h-[88vh] overflow-y-auto custom-scrollbar rounded-[2rem] p-6 shadow-2xl ${isDark
                ? "bg-[#1C1C1E]/85 backdrop-blur-3xl border border-white/10"
                : "bg-white/85 backdrop-blur-3xl border border-black/5"
                }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className={`text-lg font-bold ${t.text}`}>{detailFor.name}</h2>
                  <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>
                    {detailFor.company_name || "No company on file"}
                    {detailFor.phone ? ` · +91 ${detailFor.phone}` : ""}
                    {` · assigned to you${detailFor.assigned_sourcing_manager_at ? ` on ${fmtDate(detailFor.assigned_sourcing_manager_at)}` : ""}`}
                  </p>
                </div>
                <button onClick={() => setDetailFor(null)} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}>
                  <FaTimes />
                </button>
              </div>

              {detailLoading && (
                <p className={`text-xs py-10 text-center ${t.textFaint}`}>Loading full history…</p>
              )}

              {detailError && (
                <div className="rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                  {detailError}
                </div>
              )}

              {detail && (
                <>
                  {/* ── Tabs ── */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {detailTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setDetailTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${detailTab === tab.id ? t.btnPrimary : `${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}`
                          }`}
                      >
                        <span className="text-[9px]">{tab.icon}</span> {tab.label}
                      </button>
                    ))}
                  </div>

                  {detailTab === "profile" && (
                    <>
                      {fieldBlock("Assignment", [
                        ["Assigned Sourcing Manager", detail.partner.assigned_sourcing_manager_name],
                        ["Employee ID", detail.partner.assigned_sourcing_manager_id ? `#${detail.partner.assigned_sourcing_manager_id}` : null],
                        ["Username", detail.partner.assigned_sourcing_manager_username],
                        ["Assigned On", fmtDate(detail.partner.assigned_sourcing_manager_at, true)],
                        ["Assigned By", detail.partner.assigned_sourcing_manager_by],
                        ["Partner Status", detail.partner.status === "active" ? "Active" : "Inactive"],
                      ], true)}

                      {fieldBlock("Business Profile", [
                        ["CP Name", detail.partner.name],
                        ["Company Name", detail.partner.company_name],
                        ["Owner / Contact Person", detail.partner.owner_contact_person],
                        ["RERA Number", detail.partner.rera_registration_no],
                        ["GST Number", detail.partner.gst_number],
                        ["PAN Number", detail.partner.pan_number],
                      ])}

                      {fieldBlock("Contact & Office", [
                        ["Phone Number", detail.partner.phone],
                        ["Email", detail.partner.email],
                        ["Office Address", detail.partner.office_address],
                        ["City", detail.partner.city],
                        ["Pin Code", detail.partner.pin_code],
                      ])}

                      {/* The registration row IS the office-visit record — there is
                          no separate visits table for partners themselves. */}
                      {fieldBlock("Registration", [
                        ["Registered By", detail.partner.created_by || "Auto (lead intake)"],
                        ["Registered On", fmtDate(detail.partner.created_at, true)],
                        ["Last Updated By", detail.partner.updated_by],
                        ["Last Updated On", fmtDate(detail.partner.updated_at, true)],
                        ["Total Walk-in Visits", detail.counts.enquiries],
                        ["Total Bookings", detail.counts.bookings],
                      ])}
                    </>
                  )}

                  {detailTab === "enquiries" && (
                    detail.enquiries.length === 0
                      ? emptyActivity("No walk-in visits yet", "Client enquiries this partner brings in will be listed here.")
                      : (
                        <div className="space-y-3">
                          {detail.enquiries.map((e: any) => (
                            <div key={e.id} className={`rounded-xl p-4 border ${t.modalBlock}`} style={t.modalBlockGl}>
                              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                                <div>
                                  <p className={`text-sm font-bold ${t.text}`}>
                                    #{String(e.sr_no || e.id).padStart(3, "0")} · {e.client_name}
                                  </p>
                                  <p className={`text-[11px] ${t.textMuted}`}>
                                    <FaPhone className="inline text-[8px] mr-1" />
                                    {e.client_phone || "no phone"}
                                    {real(e.email) ? ` · ${e.email}` : ""}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${t.statusAssigned}`}>
                                    {e.status || "Assigned"}
                                  </span>
                                  <p className={`text-[10px] mt-1 ${t.textFaint}`}>{fmtDate(e.created_at)}</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {([
                                  ["Preferred Location", e.preferred_location],
                                  ["Budget", real(e.budget)],
                                  ["Configuration", real(e.configuration)],
                                  ["Purpose", real(e.purpose)],
                                  ["City", e.city],
                                  ["Pin Code", e.pin_code],
                                  ["Sales Owner", e.assigned_to],
                                  ["Logged By", e.assigned_receptionist],
                                ] as [string, any][]).map(([label, value]) => (
                                  <div key={label}>
                                    <p className={`text-[10px] ${t.textFaint}`}>{label}</p>
                                    <p className={`text-[11px] font-semibold ${t.text}`}>
                                      {value ? String(value) : <span className={t.textFaint}>N/A</span>}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {detail.truncated.enquiries && (
                            <p className={`text-[10px] text-center ${t.textFaint}`}>Showing the 100 most recent.</p>
                          )}
                        </div>
                      )
                  )}

                  {detailTab === "visits" && (
                    detail.siteVisits.length === 0
                      ? emptyActivity("No site visits recorded", "Site visits are logged against this partner's client leads; none have been scheduled yet.")
                      : (
                        <div className="space-y-3">
                          {detail.siteVisits.map((v: any) => (
                            <div key={v.id} className={`rounded-xl p-4 border ${t.modalBlock}`} style={t.modalBlockGl}>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className={`text-sm font-bold ${t.text}`}>{v.client_name}</p>
                                  <p className={`text-[11px] ${t.textMuted}`}>
                                    Visit {fmtDate(v.visit_date, true) || "date not set"}
                                    {v.created_by ? ` · logged by ${v.created_by}` : ""}
                                    {v.role ? ` (${v.role})` : ""}
                                  </p>
                                </div>
                                {v.status && (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t.textMuted} ${isDark ? "bg-[#222]" : "bg-slate-100"}`}>
                                    {v.status}
                                  </span>
                                )}
                              </div>
                              {v.notes && (
                                <p className={`text-[11px] mt-2 pt-2 border-t ${t.tableBorder} ${t.text}`}>{v.notes}</p>
                              )}
                            </div>
                          ))}
                          {detail.truncated.siteVisits && (
                            <p className={`text-[10px] text-center ${t.textFaint}`}>Showing the 100 most recent.</p>
                          )}
                        </div>
                      )
                  )}

                  {detailTab === "followups" && (
                    detail.followUps.length === 0
                      ? emptyActivity("No follow-ups or notes yet", "Notes recorded on this partner's client leads appear here.")
                      : (
                        <div className="space-y-3">
                          {detail.followUps.map((f: any) => (
                            <div key={f.id} className={`rounded-xl p-4 border ${t.modalBlock}`} style={t.modalBlockGl}>
                              <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                                <p className={`text-sm font-bold ${t.text}`}>{f.client_name}</p>
                                <p className={`text-[10px] ${t.textFaint}`}>
                                  {f.created_by_name ? `${f.created_by_name} · ` : ""}{fmtDate(f.created_at, true)}
                                </p>
                              </div>
                              {f.message && <p className={`text-[11px] ${t.text}`}>{f.message}</p>}
                              {(f.followup_date || f.site_visit_date) && (
                                <p className={`text-[10px] mt-2 ${t.textMuted}`}>
                                  {f.followup_date ? `Next follow-up: ${f.followup_date}` : ""}
                                  {f.followup_date && f.site_visit_date ? " · " : ""}
                                  {f.site_visit_date ? `Site visit: ${f.site_visit_date}` : ""}
                                </p>
                              )}
                            </div>
                          ))}
                          {detail.truncated.followUps && (
                            <p className={`text-[10px] text-center ${t.textFaint}`}>Showing the 100 most recent.</p>
                          )}
                        </div>
                      )
                  )}

                  {detailTab === "bookings" && (
                    detail.bookings.length === 0
                      ? emptyActivity("No bookings yet", "Bookings attributed to this partner will be listed here.")
                      : (
                        <div className="space-y-2">
                          {detail.bookings.map((b: any) => (
                            <div key={b.id} className={`rounded-xl px-4 py-3 border flex items-center justify-between ${t.modalBlock}`} style={t.modalBlockGl}>
                              <p className={`text-xs font-bold ${t.text}`}>{b.booking_number || `Booking #${b.id}`}</p>
                              <p className={`text-[10px] ${t.textFaint}`}>{fmtDate(b.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      )
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
