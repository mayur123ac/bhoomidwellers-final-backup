"use client";
// ChannelPartnerListView.tsx — CP Master Phase 3, permission-driven in Phase 4.
//
// One table serves four roles, differing only in what it renders:
//
//   Admin           full — commercial columns, commission drill-down, edit, delete
//   Sales Manager   full minus delete (unchanged from Phase 3)
//   Sourcing Manager profile columns only, plus "New Entry"
//   Site Head       profile columns only, read-only
//
// The "Needs Rate" tab is deliberately the loudest thing on the screen for the
// commercial roles. Partners auto-created from lead intake arrive with
// default_commission_rate NULL, and computeCPCommission refuses to accrue
// anything until a rate exists — so that queue is the live gap between "we have a
// partner" and "we can pay them", not a cosmetic filter. Roles without commercial
// visibility never see it: for them a missing rate is not actionable.
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaPlus, FaSearch, FaPen, FaTrash, FaExclamationTriangle, FaUserTie, FaTimes, FaUserCheck } from "react-icons/fa";
import ChannelPartnerFormModal, { ChannelPartner } from "./ChannelPartnerFormModal";
import ChannelPartnerDetailView from "./ChannelPartnerDetailView";
import SearchableSelect, { SelectOption } from "./SearchableSelect";
import { cpPermissionsFor, CpPermissions } from "@/lib/cpRbac";
import { useCpResource, invalidateCpCache } from "@/lib/hooks/useCpResource";
import { CpTableSkeletonRows } from "./cp/CpSkeletons";

interface Props {
  user: { name: string; role: string };
  isDark: boolean;
  t: any;
  /** Override the role-derived permissions. Omit to derive from user.role. */
  permissions?: Partial<CpPermissions>;
  /** Heading text — the Sourcing Manager panel calls this "Channel Partners". */
  title?: string;
}

type Tab = "all" | "needs_rate";

const dash = (t: any) => <span className={t.textFaint}>—</span>;

const fmtDate = (raw: any) => {
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return null; }
};

/** A Sourcing Manager as /api/users/sourcing-manager returns them. */
type SourcingManagerRow = {
  id: number; name: string; username?: string; phone?: string; email?: string;
};

/** Stable empty lists — a `[]` literal would be a new identity every render. */
const NO_PARTNERS: ChannelPartner[] = [];
const NO_MANAGERS: SourcingManagerRow[] = [];

/** Loading-bar widths per column, near the typical value so columns barely settle. */
const COLUMN_BAR_WIDTHS: Record<string, number> = {
  __select: 14, "CP Name": 104, Company: 112, "Owner / Contact": 96, Phone: 84,
  RERA: 96, GST: 108, "Office Address": 160, "Sourcing Manager": 96, Rate: 40,
  Leads: 24, Bookings: 24, Status: 56, "Registered By": 88, "Registered On": 78,
};

function ChannelPartnerListView({ user, isDark, t, permissions, title }: Props) {
  // Memoised: this is spread into a fresh object every render otherwise, and it
  // feeds `canSeeCommercials` into the fetch URL below.
  const perms: CpPermissions = useMemo(
    () => ({ ...cpPermissionsFor(user?.role), ...permissions }),
    [user?.role, permissions]
  );
  const { canCreate, canEdit, canDelete, canAssign, canSeeCommercials } = perms;

  const [tab, setTab] = useState<Tab>("all");
  const [statusFilter, setStatusFilter] = useState("");
  // "" = any, "unassigned", or a specific manager id. Server-side rather than a
  // client filter so the count in the heading reflects what was actually asked for.
  const [assignedFilter, setAssignedFilter] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelPartner | null>(null);
  // Drill-down. Kept separate from `editing`: clicking the row opens the
  // commission history, while the row's Edit button still opens field editing.
  const [selectedPartner, setSelectedPartner] = useState<ChannelPartner | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" | "error" } | null>(null);
  // Delete flow: confirm target, then any refusal the server came back with.
  const [deleteTarget, setDeleteTarget] = useState<ChannelPartner | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Ownership assignment ──
  // A registry that predates ownership arrives entirely unassigned, and until it
  // is divided up every Sourcing Manager's panel is empty. Multi-select rather
  // than a per-row dialog because that first division is the whole job: twenty
  // partners handed to two managers in two actions, not twenty.
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Only the roles that can assign need the manager list.
  const { data: managers } = useCpResource<SourcingManagerRow[]>(
    canAssign ? "/api/users/sourcing-manager" : null,
    { initial: NO_MANAGERS }
  );

  const managerOptions: SelectOption[] = useMemo(
    () => managers.map((m: any) => ({
      value: String(m.id),
      label: m.name,
      sublabel: `ID ${m.id}${m.username ? ` · ${m.username}` : ""}${m.phone ? ` · ${m.phone}` : ""}`,
      keywords: `${m.username || ""} ${m.phone || ""} ${m.email || ""}`,
    })),
    [managers]
  );

  const inputCls = `rounded-lg px-2.5 py-1.5 text-xs outline-none border ${t.inputInner} ${t.text} ${t.inputFocus}`;

  const flash = (text: string, tone: "ok" | "warn" | "error" = "ok") => {
    setNotice({ text, tone });
    setTimeout(() => setNotice(null), 6000);
  };

  // Same query string as before, so the server sees an identical request.
  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (canSeeCommercials && tab === "needs_rate") p.set("needs_rate", "true");
    if (statusFilter) p.set("status", statusFilter);
    if (assignedFilter) p.set("assigned_sourcing_manager_id", assignedFilter);
    return `/api/channel-partners?${p.toString()}`;
  }, [canSeeCommercials, tab, statusFilter, assignedFilter]);

  // PERF: the badge query used to be `await`ed AFTER the list resolved, inside
  // the same function — a strict waterfall, and both halves are full HTTP round
  // trips to Neon (measured at ~155 ms and ~160 ms). Every load, and every
  // change of tab, status or manager filter, therefore cost ~315 ms of serial
  // waiting for two independent reads. As two hooks they leave together, so the
  // cost is now the slower of the two rather than their sum. The badge is
  // skipped entirely for roles that never see the queue, exactly as before.
  const {
    data: partners, loading, error: listError, refetch: refetchList,
  } = useCpResource<ChannelPartner[]>(listUrl, { initial: NO_PARTNERS });

  const { data: needsRateRows, refetch: refetchNeedsRate } = useCpResource<ChannelPartner[]>(
    canSeeCommercials ? "/api/channel-partners?needs_rate=true" : null,
    { initial: NO_PARTNERS }
  );
  // The route returns `count: data.length`, so this is the same number the
  // badge showed before.
  const needsRateCount = needsRateRows.length;

  // A selection made under one filter must not survive into another, or an
  // "Assign" could sweep in rows the operator can no longer see.
  useEffect(() => { setSelectedIds([]); }, [tab, statusFilter, assignedFilter]);

  // Every write here — assign, delete, save — changes rows that any of the
  // cached partner lists could be holding, so they all go before refetching.
  const fetchPartners = useCallback(() => {
    invalidateCpCache("/api/channel-partners");
    refetchList();
    refetchNeedsRate();
  }, [refetchList, refetchNeedsRate]);

  // Search is client-side: the partner master is small (tens of rows), so a
  // round trip per keystroke would be slower than filtering in place. Deferred
  // so the character lands in the box before the table is rebuilt behind it.
  const deferredSearch = useDeferredValue(search);
  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.company_name || "").toLowerCase().includes(q) ||
      (p.owner_contact_person || "").toLowerCase().includes(q) ||
      (p.gst_number || "").toLowerCase().includes(q) ||
      (p.rera_registration_no || "").toLowerCase().includes(q) ||
      (p.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || " ")
    );
  }, [partners, deferredSearch]);

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (p: ChannelPartner) => { setEditing(p); setModalOpen(true); };

  // Selection is cleared whenever the underlying list changes, so a stale id from
  // a previous filter can never be swept into an assignment.
  const visibleIds = useMemo(() => visible.map(p => p.id), [visible]);
  // Was an O(visible × selected) scan re-run on every render — including every
  // keystroke in the search box and every tick of the host page's clock.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = useMemo(
    () => visibleIds.length > 0 && visibleIds.every(id => selectedSet.has(id)),
    [visibleIds, selectedSet]
  );
  const toggleAllVisible = () => {
    const visibleSet = new Set(visibleIds);
    setSelectedIds(allVisibleSelected
      ? selectedIds.filter(id => !visibleSet.has(id))
      : [...new Set([...selectedIds, ...visibleIds])]);
  };
  const toggleOne = useCallback((id: number) =>
    setSelectedIds(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]), []);

  const submitAssign = async () => {
    setAssignBusy(true);
    setAssignError(null);
    try {
      const res = await fetch("/api/channel-partners/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner_ids: selectedIds,
          assigned_sourcing_manager_id: assignTo === "" ? null : Number(assignTo),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setAssignError(json.message || "Assignment failed."); return; }
      setAssignOpen(false);
      setSelectedIds([]);
      setAssignTo("");
      flash(json.message);
      fetchPartners();
    } catch (e: any) {
      setAssignError(e.message || "Network error.");
    } finally {
      setAssignBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/channel-partners/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        // HAS_REFERENCES is the expected, common case — it stays on screen with
        // the reason rather than flashing past as a toast.
        setDeleteError(json.message || "Delete failed.");
        return;
      }
      setDeleteTarget(null);
      flash(json.message || "Partner deleted.");
      fetchPartners();
    } catch (e: any) {
      setDeleteError(e.message || "Network error.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const tabCls = (active: boolean) =>
    `px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${active ? t.btnPrimary : `${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}`
    }`;

  // Drill-down replaces the list entirely; onBack returns and refetches so a
  // commission recorded in the detail view is reflected in the list's counts.
  // Gated on commercial visibility — the detail view is commission history.
  if (selectedPartner && canSeeCommercials) {
    return (
      <ChannelPartnerDetailView
        partner={selectedPartner}
        onBack={() => { setSelectedPartner(null); fetchPartners(); }}
        user={user}
        isDark={isDark}
        t={t}
      />
    );
  }

  const columns = [
    ...(canAssign ? ["__select"] : []),
    "CP Name", "Company", "Owner / Contact", "Phone", "RERA", "GST", "Office Address",
    // Who owns the partner relationship. Shown to every role: an Admin needs it to
    // reassign, and a Sourcing Manager browsing the full registry needs to see
    // which partners are already someone else's before offering to take one on.
    "Sourcing Manager",
    // Lead and booking counts are activity, not commercial terms — "how many leads
    // has this partner brought us" is exactly what a Sourcing Manager is here to
    // watch. Only the negotiated rate stays behind the commercial gate.
    ...(canSeeCommercials ? ["Rate"] : []),
    "Leads", "Bookings",
    "Status", "Registered By", "Registered On",
    ...(canEdit || canDelete ? [""] : []),
  ];

  const skeletonWidths = columns.map(c => COLUMN_BAR_WIDTHS[c] ?? 64);
  const showActions = canEdit || canDelete;

  return (
    <div className="flex flex-col h-full overflow-hidden p-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-2 pt-2">
        <div className="flex items-center gap-2">
          <FaUserTie className={t.accentText} />
          <h2 className={`text-base font-bold ${t.text}`}>{title || "Channel Partners"}</h2>
          <span className={`text-xs ${t.textFaint}`}>({partners.length})</span>
        </div>
        {canCreate && (
          <button onClick={openAdd} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary}`}>
            <FaPlus className="text-[10px]" /> {canSeeCommercials ? "Add Partner" : "New Entry"}
          </button>
        )}
      </div>

      {notice && (
        <div className={`mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] ${notice.tone === "error"
          ? "bg-red-500/10 border border-red-500/30 text-red-500"
          : notice.tone === "warn"
            ? isDark ? "bg-amber-500/10 border border-amber-500/25 text-amber-400" : "bg-amber-50 border border-amber-200 text-amber-700"
            : isDark ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-400" : "bg-emerald-50 border border-emerald-200 text-emerald-700"
          }`}>
          {notice.text}
        </div>
      )}

      {/* ── Tabs + filters ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3 px-2">
        {canSeeCommercials && (
          <>
            <button className={tabCls(tab === "all")} onClick={() => setTab("all")}>All Partners</button>
            <button className={tabCls(tab === "needs_rate")} onClick={() => setTab("needs_rate")}>
              <span className="flex items-center gap-1.5">
                <FaExclamationTriangle className="text-[10px]" />
                Needs Rate
                {needsRateCount > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${tab === "needs_rate" ? "bg-white/25" : "bg-amber-500/20 text-amber-500"
                    }`}>
                    {needsRateCount}
                  </span>
                )}
              </span>
            </button>
          </>
        )}

        <div className="flex-1" />

        {/* Assignment filter — the Admin's entry point for "which partners has
            nobody been given?", which is the queue this whole feature turns on. */}
        {canAssign && (
          <select value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)}
            className={`${inputCls} cursor-pointer`} aria-label="Filter by Sourcing Manager">
            <option value="">All Sourcing Managers</option>
            <option value="unassigned">Unassigned only</option>
            {managers.map((m: any) => (
              <option key={m.id} value={String(m.id)}>{m.name}</option>
            ))}
          </select>
        )}

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} cursor-pointer`}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <div className="relative">
          <FaSearch className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] ${t.textFaint}`} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, GST" className={`${inputCls} pl-7 w-52`}
          />
        </div>
      </div>

      {/* Appears only with a selection, so the toolbar doesn't sit there empty. */}
      {canAssign && selectedIds.length > 0 && (
        <div className={`mx-2 mb-3 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-3 ${isDark ? "bg-[#9E217B]/10 border border-[#9E217B]/30" : "bg-[#9E217B]/5 border border-[#9E217B]/25"}`}>
          <p className={`text-[11px] font-bold ${t.accentText}`}>
            {selectedIds.length} partner{selectedIds.length === 1 ? "" : "s"} selected
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds([])}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${t.textMuted}`}>
              Clear
            </button>
            <button onClick={() => { setAssignError(null); setAssignTo(""); setAssignOpen(true); }}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${t.btnPrimary}`}>
              <FaUserCheck className="inline text-[10px] mr-1.5" />
              Assign Sourcing Manager
            </button>
          </div>
        </div>
      )}

      {/* The state that makes this feature necessary: partners exist, nobody owns
          them, so every Sourcing Manager panel is empty. Said once, with the fix. */}
      {canAssign && !loading && selectedIds.length === 0 && (() => {
        const unassigned = partners.filter(p => !p.assigned_sourcing_manager_id).length;
        if (unassigned === 0) return null;
        const showingUnassignedOnly = assignedFilter === "unassigned";
        return (
          <div className={`mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] ${isDark ? "bg-amber-500/10 border border-amber-500/25 text-amber-400"
            : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
            {unassigned} partner{unassigned === 1 ? " has" : "s have"} no Sourcing Manager — their leads
            won&apos;t appear on any Sourcing Manager&apos;s dashboard.{" "}
            {showingUnassignedOnly ? (
              <>Tick the rows and use <b>Assign Sourcing Manager</b> to divide them up.</>
            ) : (
              <button onClick={() => setAssignedFilter("unassigned")}
                className="underline font-bold cursor-pointer">
                Show unassigned only
              </button>
            )}
          </div>
        );
      })()}

      {/* Only shown on the queue itself, where it's a call to action rather than nagging. */}
      {canSeeCommercials && tab === "needs_rate" && needsRateCount > 0 && (
        <div className={`mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] ${isDark ? "bg-amber-500/10 border border-amber-500/25 text-amber-400" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
          These partners have no commission rate set. Commission can&apos;t be calculated for their bookings until one is added.
        </div>
      )}

      {/* ── Table ── */}
      <div className={`flex-1 overflow-auto mx-2 rounded-3xl ${t.card}`}>
        <table className="w-full text-left border-collapse">
          <thead className={`sticky top-0 z-10 ${t.tableHead || (isDark ? "bg-[#1a1a1a]" : "bg-slate-50")}`}>
            <tr className={`text-[11px] uppercase ${t.textMuted}`}>
              {columns.map((h, i) => (
                <th key={`${h}-${i}`} className="px-4 py-3 whitespace-nowrap font-bold">
                  {h === "__select" ? (
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      className="cursor-pointer accent-[#9E217B]"
                      aria-label="Select all visible partners"
                    />
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Loading / failed / empty are three distinct answers. Only the
                first gets a skeleton, and only while there is nothing cached to
                paint instead. */}
            {loading && (
              <CpTableSkeletonRows
                isDark={isDark}
                columns={columns.length}
                rows={8}
                widths={skeletonWidths}
                cellClass="px-4 py-3"
              />
            )}

            {!loading && partners.length === 0 && listError && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <FaTimes className="mx-auto mb-3 text-2xl text-red-500" />
                  <p className={`text-sm font-bold mb-1 ${t.text}`}>Could not load channel partners</p>
                  <p className={`text-xs mb-4 ${t.textMuted}`}>{listError}</p>
                  <button onClick={fetchPartners}
                    className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary}`}>
                    Try again
                  </button>
                </td>
              </tr>
            )}

            {!loading && !(partners.length === 0 && listError) && visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <FaUserTie className={`mx-auto mb-3 text-2xl ${t.textFaint}`} />
                  <p className={`text-sm font-bold mb-1 ${t.text}`}>
                    {search ? "No partners match your search"
                      : tab === "needs_rate" ? "Every partner has a rate set"
                        : "No channel partners yet"}
                  </p>
                  <p className={`text-xs ${t.textMuted}`}>
                    {search ? "Try a different name, phone number or GST."
                      : tab === "needs_rate" ? "Nothing is blocking commission calculation."
                        : "Partners are registered here, or created automatically from Channel Partner enquiries."}
                  </p>
                  {canCreate && !search && tab === "all" && (
                    <button onClick={openAdd} className={`mt-4 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary}`}>
                      Register the first partner
                    </button>
                  )}
                </td>
              </tr>
            )}

            {!loading && visible.map(p => {
              const noRate = p.default_commission_rate === null || p.default_commission_rate === undefined;
              const registeredOn = fmtDate(p.created_at);
              return (
                <tr
                  key={p.id}
                  // Row click drills into commission history — only meaningful for
                  // roles that can see it, so the row isn't clickable otherwise.
                  onClick={canSeeCommercials ? () => setSelectedPartner(p) : undefined}
                  className={`text-xs ${canSeeCommercials ? "cursor-pointer" : ""} ${t.tableRow} ${isDark ? "border-b border-[#222]" : ""} ${selectedSet.has(p.id) ? (isDark ? "bg-[#9E217B]/10" : "bg-[#9E217B]/5") : ""
                    }`}
                >
                  {canAssign && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(p.id)}
                        // Row click drills into commissions; ticking must not do that too.
                        onClick={e => e.stopPropagation()}
                        onChange={() => toggleOne(p.id)}
                        className="cursor-pointer accent-[#9E217B]"
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                  )}
                  <td className={`px-4 py-3 font-bold whitespace-nowrap ${t.text}`}>{p.name}</td>
                  <td className={`px-4 py-3 ${t.textMuted}`}>{p.company_name || dash(t)}</td>
                  <td className={`px-4 py-3 ${t.textMuted}`}>{p.owner_contact_person || dash(t)}</td>
                  <td className={`px-4 py-3 whitespace-nowrap ${t.textMuted}`}>{p.phone || dash(t)}</td>
                  <td className={`px-4 py-3 whitespace-nowrap ${t.textMuted}`}>{p.rera_registration_no || dash(t)}</td>
                  <td className={`px-4 py-3 whitespace-nowrap ${t.textMuted}`}>{p.gst_number || dash(t)}</td>
                  {/* Addresses are long; truncated with the full value on hover. */}
                  <td className={`px-4 py-3 ${t.textMuted}`}>
                    {p.office_address
                      ? <span className="block max-w-[200px] truncate" title={p.office_address}>{p.office_address}</span>
                      : dash(t)}
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap">
                    {p.assigned_sourcing_manager_name ? (
                      <span className={`font-semibold ${t.text}`}>
                        {p.assigned_sourcing_manager_name}
                        {/* A partner whose owner has since been deactivated is
                            effectively unowned — flagged rather than silently
                            reading as assigned. */}
                        {p.assigned_sourcing_manager_active === false && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 text-red-500">
                            inactive
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500">
                        Unassigned
                      </span>
                    )}
                  </td>

                  {canSeeCommercials && (
                    <td className="px-4 py-3">
                      {noRate ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500 whitespace-nowrap">
                          Not set
                        </span>
                      ) : (
                        <span className={`font-bold ${t.text}`}>{p.default_commission_rate}%</span>
                      )}
                    </td>
                  )}

                  {/* Emphasized when non-zero: a partner who has actually delivered
                      should stand out from the many who have registered and not yet. */}
                  <td className="px-4 py-3">
                    <span className={Number(p.lead_count || 0) > 0 ? `font-bold ${t.text}` : t.textFaint}>
                      {p.lead_count ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={Number(p.booking_count || 0) > 0 ? `font-bold ${t.text}` : t.textFaint}>
                      {p.booking_count ?? 0}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${p.status === "active"
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-gray-500/15 text-gray-500"
                      }`}>
                      {p.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {/* Legacy partners discovered from lead intake have no created_by —
                      "Auto (lead intake)" is more honest than a blank cell. */}
                  <td className={`px-4 py-3 whitespace-nowrap ${t.textMuted}`}>
                    {p.created_by || <span className={t.textFaint}>Auto (lead intake)</span>}
                  </td>
                  <td className={`px-4 py-3 whitespace-nowrap ${t.textMuted}`}>{registeredOn || dash(t)}</td>

                  {showActions && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {canEdit && (
                          <button
                            // Row click drills into commissions; this button must not
                            // trigger that as well.
                            onClick={e => { e.stopPropagation(); openEdit(p); }}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer whitespace-nowrap ${noRate && canSeeCommercials ? t.btnPrimary : `${t.textMuted} ${isDark ? "hover:bg-[#222]" : "hover:bg-slate-100"}`
                              }`}
                          >
                            {noRate && canSeeCommercials ? <>Set Rate</> : <><FaPen className="inline text-[9px] mr-1" /> Edit</>}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteError(null); setDeleteTarget(p); }}
                            title="Delete partner"
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/30"
                          >
                            <FaTrash className="text-[10px]" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ChannelPartnerFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={info => {
          // A merge means the phone matched an existing partner and their record
          // was topped up — worth saying out loud, since the operator asked to
          // create something and no new row appeared.
          if (info) flash(info.message, info.merged ? "warn" : "ok");
          fetchPartners();
        }}
        partner={editing}
        user={user}
        isDark={isDark}
        t={t}
        // Roles without commercial visibility get the office-visit profile form;
        // the full form's rate and bank fields would be stripped server-side anyway.
        variant={canSeeCommercials ? "full" : "office_visit"}
      />

      {/* ── Bulk assign ── */}
      <AnimatePresence>
        {assignOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[115] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !assignBusy && setAssignOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl p-6 ${t.modalCard || t.card}`}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className={`text-base font-bold ${t.text}`}>Assign Sourcing Manager</h3>
                <button onClick={() => !assignBusy && setAssignOpen(false)} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}>
                  <FaTimes />
                </button>
              </div>

              <p className={`text-xs mb-1 ${t.textMuted}`}>
                {selectedIds.length} partner{selectedIds.length === 1 ? "" : "s"} selected.
              </p>
              {/* Named while the list is short: "12 partners" is not something an
                  operator can check, but four names are. */}
              {selectedIds.length <= 6 && (
                <p className={`text-[11px] mb-4 ${t.textFaint}`}>
                  {partners.filter(p => selectedSet.has(p.id)).map(p => p.name).join(", ")}
                </p>
              )}

              <label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Sourcing Manager</label>
              <SearchableSelect
                value={assignTo}
                onChange={setAssignTo}
                options={managerOptions}
                isDark={isDark}
                t={t}
                placeholder="Select a Sourcing Manager…"
                emptyMessage="No active Sourcing Managers — create one in Add Employee"
                ariaLabel="Sourcing Manager"
              />
              <p className={`text-[10px] mt-2 ${t.textFaint}`}>
                Every lead these partners bring in — matched by phone number — will appear
                on the selected manager&apos;s dashboard.
              </p>
              <button onClick={() => setAssignTo("")}
                className={`mt-2 text-[10px] underline cursor-pointer ${t.textFaint}`}>
                Clear their assignment instead
              </button>

              {assignError && (
                <div className="mt-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                  {assignError}
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button onClick={() => setAssignOpen(false)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted}`}>
                  Cancel
                </button>
                <button onClick={submitAssign} disabled={assignBusy}
                  className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary} ${assignBusy ? "opacity-50 cursor-not-allowed" : ""}`}>
                  {assignBusy ? "Saving…" : assignTo === "" ? "Unassign" : "Assign"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete confirmation ── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !deleteBusy && setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
              onClick={e => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl p-6 ${t.modalCard || t.card}`}
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className={`text-base font-bold ${t.text}`}>Delete channel partner?</h3>
                <button onClick={() => !deleteBusy && setDeleteTarget(null)} className={`p-1.5 rounded-lg cursor-pointer ${t.textMuted}`}>
                  <FaTimes />
                </button>
              </div>

              <p className={`text-xs mb-2 ${t.textMuted}`}>
                <span className={`font-bold ${t.text}`}>{deleteTarget.name}</span>
                {deleteTarget.company_name ? ` · ${deleteTarget.company_name}` : ""}
              </p>
              <p className={`text-xs mb-4 ${t.textMuted}`}>
                This permanently removes the partner record. It is refused if any lead,
                booking or commission still references them.
              </p>

              {deleteError && (
                <div className="mb-4 rounded-lg px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.textMuted}`}
                >
                  Cancel
                </button>
                {/* Once refused for references, deleting again cannot succeed —
                    the button becomes "mark inactive instead" guidance. */}
                {!deleteError && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteBusy}
                    className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer bg-red-600 hover:bg-red-700 text-white ${deleteBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {deleteBusy ? "Deleting..." : "Delete"}
                  </button>
                )}
                {deleteError && canEdit && (
                  <button
                    onClick={() => { const p = deleteTarget; setDeleteTarget(null); openEdit(p); }}
                    className={`px-5 py-2 rounded-lg text-xs font-bold cursor-pointer ${t.btnPrimary}`}
                  >
                    Mark Inactive Instead
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Memoised at the boundary — see the note on ChannelPartnerEnquiriesTable. The
 * admin dashboard that hosts this re-renders on a 30 s lead poll, on sidebar
 * hover and on every notification toast, none of which change this table.
 */
export default React.memo(ChannelPartnerListView);
