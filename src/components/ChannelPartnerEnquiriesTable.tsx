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
import React, { useCallback, useDeferredValue, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaSearch, FaTimes, FaUserTie, FaExchangeAlt, FaHandshake } from "react-icons/fa";
import SearchableSelect, { SelectOption } from "./SearchableSelect";
import { normalizeRole } from "@/lib/cpRbac";
import { useCpResource, invalidateCpCache } from "@/lib/hooks/useCpResource";
import { CpTableSkeletonRows, CpHeaderSkeleton } from "./cp/CpSkeletons";

interface Props {
  user: { name: string; role: string; _id?: string };
  isDark: boolean;
  t: any;
  title?: string;
  subtitle?: string;
  /**
   * Prepend a positional "Sr. No." column (1, 2, 3 …).
   *
   * Distinct from "Lead No.", which is the lead's own permanent number: this one
   * counts the rows currently on screen, so it renumbers from 1 when the list is
   * searched or filtered. Off by default — the Receptionist and Admin panels
   * already carry twenty columns and scroll horizontally.
   */
  showSerial?: boolean;
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

/**
 * An enquiry row as /api/cp-enquiries returns it, and the host page's theme
 * token bag. Both are untyped bags in this file already — the aliases exist so
 * the new prop signatures below name what they take instead of repeating `any`
 * eight more times.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type EnquiryRowData = Record<string, any>;
type ThemeTokens = Props["t"];

/** Stable empty arrays — a `[]` literal would be a new identity every render. */
const NO_ROWS: EnquiryRowData[] = [];

/**
 * Roughly how wide each column's content usually is, in px, used only to size
 * the loading bars. Keeping them near the real values is what stops the columns
 * resizing under the operator when the rows arrive.
 */
const COLUMN_BAR_WIDTHS: Record<string, number> = {
  "Sr. No.": 28, "Lead No.": 44, Created: 78, "CP Name": 104, "CP Company": 112,
  "CP Phone": 84, "Office Address": 150, "Owner / Contact": 96, GST: 108, RERA: 96,
  "CP City": 62, "CP Pin": 48, "Client Name": 104, "Client Phone": 84, "Alt Phone": 84,
  "Client Email": 128, "Preferred Location": 108, Budget: 70, Requirement: 96,
  "Sourcing Manager": 96, Status: 62,
};

const requirementOf = (r: EnquiryRowData) => {
  const parts = [r.configuration, r.purpose]
    .map(v => (v && v !== "N/A" && v !== "Pending" ? String(v) : null))
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

/**
 * One enquiry row.
 *
 * Split out and memoised because the panel's own state changes constantly for
 * reasons that have nothing to do with any row: the search box, the "saved"
 * notice, the detail drawer, the reassign dialog. Each of those used to
 * re-render all 210 rows and their ~4,400 cells. `row` identities come straight
 * from the fetched array, so they only change when the data actually does.
 */
const EnquiryRow = React.memo(function EnquiryRow({
  row: r, serial, isDark, t, canReassign, onOpen, onReassign,
}: {
  row: EnquiryRowData;
  /** Position on screen, or null when the Sr. No. column is off. */
  serial: number | null;
  isDark: boolean;
  t: ThemeTokens;
  canReassign: boolean;
  onOpen: (row: EnquiryRowData) => void;
  onReassign: (row: EnquiryRowData) => void;
}) {
  const cell = `px-3 py-3 whitespace-nowrap ${t.textMuted}`;
  return (
    <tr onClick={() => onOpen(r)}
      className={`text-xs cursor-pointer transition-colors ${t.tableRow} ${isDark ? "border-b border-white/5 hover:bg-white/5" : "border-b border-black/5 hover:bg-black/5"}`}>
      {/* Position on screen, not an identifier — muted so it doesn't
          compete with the lead number sitting next to it. */}
      {serial !== null && (
        <td className={`px-3 py-3 whitespace-nowrap ${t.textMuted}`}>{serial}</td>
      )}
      <td className={`px-3 py-3 font-semibold whitespace-nowrap ${t.text}`}>
        #{String(r.sr_no || r.id).padStart(3, "0")}
      </td>
      <td className={cell}>{fmtDate(r.created_at) || dash(t)}</td>
      <td className={`px-3 py-3 font-medium whitespace-nowrap ${t.text}`}>
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
      <td className={`px-3 py-3 font-medium whitespace-nowrap ${t.text}`}>{r.client_name || dash(t)}</td>
      <td className={cell}>{r.client_phone || dash(t)}</td>
      <td className={cell}>{r.alt_phone || dash(t)}</td>
      <td className={cell}>{r.email && r.email !== "N/A" ? r.email : dash(t)}</td>
      <td className={cell}>{r.preferred_location || dash(t)}</td>
      <td className={cell}>{r.budget && r.budget !== "Pending" ? r.budget : dash(t)}</td>
      <td className={cell}>{requirementOf(r) || dash(t)}</td>
      <td className="px-3 py-3 whitespace-nowrap">
        {r.sourcing_manager_name ? (
          <>
            <span className={`font-medium ${t.text}`}>{r.sourcing_manager_name}</span>
            {/* Inherited from the partner rather than set on this enquiry.
                Worth marking: it means reassigning the partner moves this
                lead too, which a per-enquiry assignment would not. */}
            {r.sourcing_manager_inherited && (
              <span className={`block text-[9px] mt-0.5 ${t.textFaint}`}>via partner</span>
            )}
          </>
        ) : (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-500">
            Unassigned
          </span>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${t.statusAssigned}`}>
          {r.status || "Assigned"}
        </span>
      </td>
      {canReassign && (
        <td className="px-3 py-3 text-right whitespace-nowrap">
          <button
            // Row click opens the detail drawer; this must not trigger it too.
            onClick={e => { e.stopPropagation(); onReassign(r); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors ${r.effective_sourcing_manager_id
              ? isDark ? "text-white hover:bg-white/10" : "text-black hover:bg-black/5"
              : t.btnPrimary
              }`}
          >
            <FaExchangeAlt className="inline text-[9px] mr-1" />
            {r.effective_sourcing_manager_id ? "Reassign" : "Assign"}
          </button>
        </td>
      )}
    </tr>
  );
});

function ChannelPartnerEnquiriesTable({
  user, isDark, t, title, subtitle, showSerial = false,
}: Props) {
  const role = normalizeRole(user?.role);
  const isAdmin = role === "admin";
  // Reassignment is Admin-only: reception assigns once at creation and cannot change
  // it afterwards, and a Sourcing Manager cannot move work off their own desk.
  // Filtering by Sourcing Manager, unlike reassigning, is read-only and safe for
  // Receptionist too — they can already see every row, filtering just narrows it.
  const canReassign = isAdmin;
  const showFilter = isAdmin || role === "receptionist";

  const [search, setSearch] = useState("");
  const [smFilter, setSmFilter] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [assignmentHistory, setAssignmentHistory] = useState<any[]>([]);
  const [assignmentHistoryLoading, setAssignmentHistoryLoading] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<any>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The same URL the panel has always requested — the query string is built
  // identically, so the server sees no change. What is different is that the
  // answer is remembered: leaving CP Management and coming back now paints the
  // previous rows on the first frame and revalidates behind them, instead of
  // dropping to a "Loading" row for another full round trip.
  const rowsUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (showFilter && smFilter) p.set("sourcing_manager_id", smFilter);
    return `/api/cp-enquiries?${p.toString()}`;
  }, [showFilter, smFilter]);

  const {
    data: rows, loading, error: rowsError, refetch: refetchRows,
  } = useCpResource<EnquiryRowData[]>(rowsUrl, { initial: NO_ROWS });

  // Only the roles that can filter or reassign need the manager list.
  const { data: managers } = useCpResource<EnquiryRowData[]>(
    showFilter || canReassign ? "/api/users/sourcing-manager" : null,
    { initial: NO_ROWS }
  );

  // Reassigning changes who owns a row, so every cached CP list is stale after
  // one — including the other filters' lists and the partner registry, which
  // shows the same ownership.
  const fetchRows = useCallback(() => {
    invalidateCpCache("/api/cp-enquiries");
    invalidateCpCache("/api/channel-partners");
    refetchRows();
  }, [refetchRows]);

  const managerOptions: SelectOption[] = useMemo(
    () => managers.map(m => ({
      value: String(m.id),
      label: m.name,
      sublabel: `ID ${m.id}${m.username ? ` · ${m.username}` : ""}${m.phone ? ` · ${m.phone}` : ""}`,
      keywords: `${m.username || ""} ${m.phone || ""} ${m.email || ""}`,
    })),
    [managers]
  );
  const counts = useMemo(() => {
    let closing = 0;
    let active = 0;
    let lost = 0;
    for (const r of rows) {
      const isClosing = r.status === "Closing" || r.status === "Closed" || !!r.closingDate;
      const isLost = !!r.is_lost_lead;
      if (isLost) lost++;
      else if (isClosing) closing++;
      else active++;
    }
    return { closing, active, lost, total: rows.length };
  }, [rows]);
  // Client-side search: the CP subset is a small slice of total leads, so filtering
  // in place beats a round trip per keystroke.
  //
  // Deferred, though: at 210 rows × 21 columns a keystroke re-filtered the list
  // and re-rendered ~4,400 cells synchronously before the character appeared in
  // the box. React now paints the input immediately and re-filters at a lower
  // priority, so typing stays responsive and the caret never lags.
  const deferredSearch = useDeferredValue(search);
  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
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
  }, [rows, deferredSearch]);

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

  const columns = useMemo(() => [
    ...(showSerial ? ["Sr. No."] : []),
    "Lead No.", "Created", "CP Name", "CP Company", "CP Phone",
    "Office Address", "Owner / Contact", "GST", "RERA", "CP City", "CP Pin",
    "Client Name", "Client Phone", "Alt Phone", "Client Email",
    "Preferred Location", "Budget", "Requirement", "Sourcing Manager", "Status",
    ...(canReassign ? [""] : []),
  ], [showSerial, canReassign]);

  const skeletonWidths = useMemo(
    () => columns.map(c => COLUMN_BAR_WIDTHS[c] ?? 64),
    [columns]
  );

  // APPLE UI: Softer rounded inputs with translucent fills
  const inputCls = `rounded-xl px-3 py-2 text-xs outline-none transition-all ${isDark
    ? "bg-[#1C1C1E] text-white placeholder-gray-500 focus:bg-[#2C2C2E] border border-white/5"
    : "bg-black/5 text-black placeholder-gray-500 focus:bg-black/10 border border-black/5"
    }`;

  // Stable identities, so EnquiryRow's memo actually holds. Passed down instead
  // of an inline arrow per row, which would be a new function on every render
  // and defeat the memo for all 210 rows at once.
  const openDetail = useCallback((r: EnquiryRowData) => setDetail(r), []);
  const openReassign = useCallback((r: EnquiryRowData) => {
    setReassignError(null);
    // Pre-filled with the effective owner, so reassigning a lead that inherited
    // its manager starts from who actually holds it.
    setReassignTo(r.effective_sourcing_manager_id ? String(r.effective_sourcing_manager_id) : "");
    setReassignTarget(r);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden p-2">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 mb-3 px-2 pt-2">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <FaHandshake className={`hidden sm:inline-block ${t.accentText}`} />
          <div>
            <h2 className={`text-sm sm:text-base font-bold tracking-tight ${t.text}`}>{title || "Channel Partner Enquiries"}</h2>
            {subtitle && <p className={`text-[10px] sm:text-[11px] ${t.textFaint}`}>{subtitle}</p>}
          </div>
          {/* Counts are meaningless until the rows are in. Showing "(0) · 0
            Closing · 0 Active" and then correcting it a third of a second
            later reads as data changing, so the chips hold their size and
            wait instead. */}
          {loading ? (
            <CpHeaderSkeleton isDark={isDark} chips={3} />
          ) : (
            <>
              <span className={`text-[10px] sm:text-xs ${t.textFaint}`}>({rows.length})</span>

              <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-semibold tracking-wide ${isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-500/10 text-amber-700"}`}>
                {counts.closing} Closing
              </span>

              <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-semibold tracking-wide ${isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-500/10 text-emerald-700"}`}>
                {counts.active} Active
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
          {showFilter && (
            <select value={smFilter} onChange={e => setSmFilter(e.target.value)}
              className={`${inputCls} cursor-pointer flex-1 sm:flex-none text-[10px] sm:text-xs py-1.5 sm:py-2`}>
              <option value="">All Sourcing Managers</option>
              <option value="unassigned">Unassigned</option>
              {managers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
          )}
          <div className="relative flex-1 sm:flex-none">
            <FaSearch className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] ${t.textFaint}`} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search CP, client, phone…" className={`${inputCls} pl-8 w-full sm:w-56 text-[10px] sm:text-xs py-1.5 sm:py-2`} />
          </div>
        </div>
      </div>

      {notice && (
        <div className={`mx-2 mb-3 rounded-2xl px-4 py-3 text-[11px] transition-all ${isDark ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-400"
          : "bg-emerald-50 border border-emerald-200/50 text-emerald-700"}`}>
          {notice}
        </div>
      )}

      {/* Read-only roles are told so explicitly, rather than just finding no buttons. */}
      {!canReassign && (
        <div className={`mx-2 mb-3 rounded-2xl px-4 py-3 text-[11px] transition-all ${isDark ? "bg-white/5 border border-white/5 text-[#888899]"
          : "bg-black/5 border border-transparent text-slate-600"}`}>
          {role === "sourcing manager"
            ? "Showing only the channel partners assigned to you. View only — contact an Admin to change an assignment."
            : "View only. The assigned Sourcing Manager is set at enquiry creation and can only be changed by an Admin."}
        </div>
      )}

      {/* ── Table ── */}
      <div className={`flex-1 overflow-auto mx-2 rounded-3xl ${t.card}`}>
        <table className="w-full text-left border-collapse">
          {/* APPLE UI: Frosted glass sticky header */}
          <thead className={`sticky top-0 z-10 backdrop-blur-xl ${isDark ? "bg-[#000000]/70 border-b border-white/10" : "bg-white/70 border-b border-black/5"}`}>
            <tr className={`text-[10px] uppercase tracking-wider ${t.textMuted}`}>
              {columns.map((h, i) => (
                <th key={`${h}-${i}`} className="px-3 py-3 whitespace-nowrap font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Loading, empty and failed are three different answers and each
                gets its own. The skeleton is only for the first — and only when
                there is nothing cached to show, which is what `loading` means
                here (see useCpResource). */}
            {loading && (
              <CpTableSkeletonRows
                isDark={isDark}
                columns={columns.length}
                rows={10}
                widths={skeletonWidths}
              />
            )}

            {!loading && rows.length === 0 && rowsError && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <FaTimes className="mx-auto mb-3 text-2xl text-red-500" />
                  <p className={`text-sm font-semibold tracking-tight mb-1 ${t.text}`}>
                    Could not load Channel Partner enquiries
                  </p>
                  <p className={`text-xs mb-4 ${t.textMuted}`}>{rowsError}</p>
                  <button
                    onClick={fetchRows}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer ${t.btnPrimary}`}
                  >
                    Try again
                  </button>
                </td>
              </tr>
            )}

            {!loading && !(rows.length === 0 && rowsError) && visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <FaUserTie className={`mx-auto mb-3 text-2xl ${t.textFaint}`} />
                  <p className={`text-sm font-semibold tracking-tight mb-1 ${t.text}`}>
                    {search ? "No enquiries match your search"
                      : role === "sourcing manager" ? "Nothing assigned to you yet"
                        : smFilter ? "No enquiries for this filter"
                          : "No Channel Partner enquiries yet"}
                  </p>
                  <p className={`text-xs ${t.textMuted}`}>
                    {search ? "Try a different name, phone or GST."
                      : role === "sourcing manager"
                        ? "An enquiry appears here when it is routed to you, or when it comes from a Channel Partner assigned to you. If a partner of yours has brought leads but nothing shows, ask an Admin to confirm the partner is assigned to you."
                        : smFilter && smFilter !== "unassigned"
                          ? "This manager has no enquiries — neither routed to them directly, nor from a Channel Partner assigned to them. An Admin assigns partners in Channel Partner Management."
                          : "They appear here when a Receptionist logs an enquiry with source “Channel Partner”."}
                  </p>
                </td>
              </tr>
            )}

            {!loading && visible.map((r, i) => (
              <EnquiryRow
                key={r.id}
                row={r}
                serial={showSerial ? i + 1 : null}
                isDark={isDark}
                t={t}
                canReassign={canReassign}
                onOpen={openDetail}
                onReassign={openReassign}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Detail drawer: full context incl. Assignment Details (Part 6) ── */}
      <AnimatePresence>
        {detail && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
            onClick={() => setDetail(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className={`w-full max-w-3xl max-h-[88vh] overflow-y-auto custom-scrollbar rounded-[2rem] p-6 shadow-2xl ${isDark ? "bg-[#1C1C1E]/85 border-white/10 backdrop-blur-3xl" : "bg-white/85 border-black/5 backdrop-blur-3xl"
                }`}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className={`text-lg font-bold tracking-tight ${t.text}`}>
                    Enquiry #{String(detail.sr_no || detail.id).padStart(3, "0")} — {detail.client_name}
                  </h2>
                  <p className={`text-[11px] mt-0.5 ${t.textMuted}`}>
                    Channel Partner enquiry · created {fmtDate(detail.created_at, true) || "—"}
                  </p>
                </div>
                <button onClick={() => setDetail(null)} className={`p-1.5 rounded-full cursor-pointer transition-colors ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"} ${t.textMuted}`}>
                  <FaTimes />
                </button>
              </div>

              {[
                {
                  heading: "Assignment Details",
                  highlight: true,
                  fields: [
                    ["Assigned Sourcing Manager", detail.sourcing_manager_name],
                    ["Employee ID", detail.effective_sourcing_manager_id ? `#${detail.effective_sourcing_manager_id}` : null],
                    ["Username", detail.sourcing_manager_username],
                    ["Phone Number", detail.sourcing_manager_phone],
                    ["Email", detail.sourcing_manager_email],
                    // An inherited assignment has no enquiry-level date or actor —
                    // the partner's are the ones that apply, and saying which is
                    // which explains why reassigning the partner moves this lead.
                    [
                      "Assigned Via",
                      detail.sourcing_manager_name
                        ? (detail.sourcing_manager_inherited
                          ? "Channel Partner ownership"
                          : "Set on this enquiry")
                        : null,
                    ],
                    [
                      "Assigned Date",
                      fmtDate(detail.sourcing_manager_inherited
                        ? detail.partner_assigned_at
                        : detail.sourcing_manager_assigned_at, true),
                    ],
                    [
                      "Assigned By",
                      detail.sourcing_manager_inherited
                        ? detail.partner_assigned_by
                        : detail.sourcing_manager_assigned_by,
                    ],
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
                  className={`mb-5 rounded-2xl p-4 transition-colors ${section.highlight
                    ? isDark ? "bg-[#9E217B]/20 border border-[#9E217B]/30" : "bg-[#9E217B]/10 border border-[#9E217B]/20"
                    : isDark ? "bg-white/5 border border-white/5" : "bg-black/5 border border-transparent"
                    }`}
                >
                  <p className={`text-[11px] font-bold uppercase tracking-wider mb-3 ${section.highlight ? t.accentText : t.textMuted}`}>
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
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
            onClick={() => !reassignBusy && setReassignTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className={`w-full max-w-md rounded-[2rem] p-6 shadow-2xl ${isDark ? "bg-[#1C1C1E]/85 border-white/10 backdrop-blur-3xl" : "bg-white/85 border-black/5 backdrop-blur-3xl"
                }`}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className={`text-base font-bold tracking-tight ${t.text}`}>Assign Sourcing Manager</h3>
                <button onClick={() => !reassignBusy && setReassignTarget(null)} className={`p-1.5 rounded-full cursor-pointer transition-colors ${isDark ? "hover:bg-white/10" : "hover:bg-black/5"} ${t.textMuted}`}>
                  <FaTimes />
                </button>
              </div>

              <p className={`text-xs mb-4 leading-relaxed ${t.textMuted}`}>
                Enquiry #{String(reassignTarget.sr_no || reassignTarget.id).padStart(3, "0")} ·{" "}
                <span className={`font-semibold ${t.text}`}>
                  {cpField(reassignTarget, "partner_name", "cp_name") || "Unnamed partner"}
                </span>
                {reassignTarget.sourcing_manager_name && ` · currently ${reassignTarget.sourcing_manager_name}`}
              </p>

              <label className={`block text-[11px] uppercase tracking-wider mb-1.5 font-bold ${t.textMuted}`}>Sourcing Manager</label>
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
                className={`mt-2 text-[10px] underline cursor-pointer transition-opacity hover:opacity-70 ${t.textFaint}`}>
                Clear assignment instead
              </button>

              {/* Assigning an inherited lead pins it, which is a one-way change worth
                  stating: it stops following the partner from here on. */}
              {reassignTarget.sourcing_manager_inherited && (
                <div className={`mt-3 p-3 rounded-xl text-[10px] leading-relaxed ${isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-700"}`}>
                  This enquiry currently follows its Channel Partner&apos;s owner. Setting a
                  manager here pins it to this enquiry only — it will no longer move when the
                  partner is reassigned.
                </div>
              )}

              {reassignError && (
                <div className="mt-4 rounded-xl px-4 py-3 text-xs bg-red-500/10 border border-red-500/25 text-red-500">
                  {reassignError}
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button onClick={() => setReassignTarget(null)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${isDark ? "hover:bg-white/5 text-white" : "hover:bg-black/5 text-black"}`}>
                  Cancel
                </button>
                <button onClick={submitReassign} disabled={reassignBusy}
                  className={`px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-opacity ${t.btnPrimary} ${reassignBusy ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"}`}>
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
/**
 * Memoised at the boundary.
 *
 * Both hosts re-render for reasons this table has no stake in — the admin
 * dashboard re-polls all leads every 30 s and re-renders on sidebar hover, and
 * the sourcing dashboard re-renders on every header interaction. With the
 * theme object now memoised in both, the props here are stable across those,
 * so the table sits still instead of rebuilding its whole body.
 */
export default React.memo(ChannelPartnerEnquiriesTable);
