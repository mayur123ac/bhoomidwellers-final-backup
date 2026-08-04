"use client";

/* ══════════════════════════════════════════════════════════════════════════
   EnquiryOverviewSection.tsx
   Redesigned "Enquiry Overview" for the Bhoomi Dwellers CRM admin dashboard.

   Replaces the whole `perfMode === "overall"` JSX block in the parent.
   Usage in parent:

     {perfMode === "overall" ? (
       <EnquiryOverviewSection
         allLeads={allLeads}
         filteredOverviewLeads={filteredOverviewLeads}
         isLoading={isLoading}
         theme={theme}
         isDark={isDark}
         isAdmin={isAdmin}
         siteHeads={siteHeads}
         lostLeadFilter={lostLeadFilter}
         setLostLeadFilter={setLostLeadFilter}
         showLostLeads={showLostLeads}
         setShowLostLeads={setShowLostLeads}
         duplicateIds={duplicateIds}
         dupGroupByLeadId={dupGroupByLeadId}
         showDuplicatesOnly={showDuplicatesOnly}
         setShowDuplicatesOnly={setShowDuplicatesOnly}
         overviewSearch={overviewSearch}
         setOverviewSearch={setOverviewSearch}
         overviewSearchColumn={overviewSearchColumn}
         setOverviewSearchColumn={setOverviewSearchColumn}
         selectMode={selectMode}
         setSelectMode={setSelectMode}
         exitSelectMode={exitSelectMode}
         selectedIds={selectedIds}
         setSelectedIds={setSelectedIds}
         toggleSelectOne={toggleSelectOne}
         onOpenBulkDelete={() => { setBulkDeleteError(null); setBulkDeleteOpen(true); }}
         onToast={setToastMsg}
         onDeleteLead={(lead) => { setDeleteError(null); setDeleteConfirmLead(lead); }}
         onReassign={(lead) => { setReassignLead(lead); setReassignTarget(""); setReassignNote(""); setIsReassignModalOpen(true); }}
         onNavigateToSales={onNavigateToSales}
         refetch={refetch}
         formatDate={formatDate}
         downloadCSV={downloadCSV}
         formatLeadForExport={formatLeadForExport}
         DashboardAnalytics={DashboardAnalytics}
         UploadLeadSheet={UploadLeadSheet}
         InterestBadge={InterestBadge}
       />
     ) : ...}

   The parent's infinite-scroll machinery (`visibleCount`, `loadMoreRef`,
   `loadLessRef` and their IntersectionObservers) is no longer used — this
   component paginates instead. Those can be deleted from the parent.
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState, useRef } from "react";

function DraggableTableContainer({ children, className, isDark }: { children: React.ReactNode, className?: string, isDark: boolean }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const onMouseDown = (e: React.MouseEvent) => {
        if (!scrollRef.current) return;
        setIsDragging(true);
        setStartX(e.pageX - scrollRef.current.offsetLeft);
        setScrollLeft(scrollRef.current.scrollLeft);
    };
    const onMouseLeave = () => setIsDragging(false);
    const onMouseUp = () => setIsDragging(false);
    const onMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !scrollRef.current) return;
        e.preventDefault();
        const x = e.pageX - scrollRef.current.offsetLeft;
        const walk = (x - startX) * 1.5;
        scrollRef.current.scrollLeft = scrollLeft - walk;
    };
    return (
        <div className={`relative ${className || ""}`}>
            <div
                ref={scrollRef}
                onMouseDown={onMouseDown}
                onMouseLeave={onMouseLeave}
                onMouseUp={onMouseUp}
                onMouseMove={onMouseMove}
                className={`overflow-auto custom-scrollbar draggable-table-scroll ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"} pb-2`}
                style={{ maxHeight: "calc(120vh - 250px)" }}
            >
                <style>{`
          .draggable-table-scroll::-webkit-scrollbar {
            height: 10px !important;
          }
          .draggable-table-scroll::-webkit-scrollbar-thumb {
            border-radius: 10px;
          }
        `}</style>
                {children}
            </div>
        </div>
    );
}

import {
    FaChartPie,
    FaTable,
    FaDownload,
    FaCheckCircle,
    FaTrashAlt,
    FaExchangeAlt,
    FaEye,
    FaSyncAlt,
} from "react-icons/fa";
import {
    Checkbox,
    ToggleSwitch,
    StatusChip,
    ContactCell,
    ActionMenu,
    SearchBar,
    ToolbarButton,
    ColumnSelector,
    SortIcon,
    SkeletonRows,
    EmptyState,
    Pagination,
    isBlank,
    type MenuItem,
} from "./Tableui";

/* ───────────────── types ───────────────── */

type Lead = Record<string, any>;
type Align = "left" | "right" | "center";

type Ctx = {
    theme: any;
    isDark: boolean;
    isAdmin: boolean;
    siteHeads?: any[];
    formatDate: (d: any) => string;
    onReassign: (lead: Lead) => void;
    onDeleteLead: (lead: Lead) => void;
    onNavigateToSales?: (lead: Lead) => void;
    InterestBadge: any;
};

type Column = {
    key: string;
    label: string;
    align?: Align;
    minWidth: string;
    locked?: boolean;
    defaultHidden?: boolean;
    sortValue?: (l: Lead) => string | number;
    render: (l: Lead, ctx: Ctx) => React.ReactNode;
};

export type EnquiryOverviewSectionProps = {
    allLeads: Lead[];
    filteredOverviewLeads: Lead[];
    isLoading: boolean;

    theme: any;
    isDark: boolean;
    isAdmin: boolean;
    siteHeads?: any[];

    lostLeadFilter: string;
    setLostLeadFilter: (v: any) => void;
    showLostLeads: boolean;
    setShowLostLeads: (v: boolean) => void;

    duplicateIds: Set<number>;
    dupGroupByLeadId: Map<number, number[]>;
    showDuplicatesOnly: boolean;
    setShowDuplicatesOnly: (v: boolean) => void;

    overviewSearch: string;
    setOverviewSearch: (v: string) => void;
    overviewSearchColumn: string;
    setOverviewSearchColumn: (v: string) => void;

    selectMode: boolean;
    setSelectMode: (v: boolean) => void;
    exitSelectMode: () => void;
    selectedIds: Set<number>;
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
    toggleSelectOne: (id: number) => void;

    onOpenBulkDelete: () => void;
    onToast: (msg: string | null) => void;
    onDeleteLead: (lead: Lead) => void;
    onReassign: (lead: Lead) => void;
    onNavigateToSales?: (lead: Lead) => void;
    refetch: () => void;

    formatDate: (d: any) => string;
    downloadCSV: (rows: any[], filename: string) => void;
    formatLeadForExport: (l: Lead) => any;

    DashboardAnalytics: any;
    UploadLeadSheet: any;
    InterestBadge: any;
};

/* ───────────────── helpers ───────────────── */



const txt = (v: any, fallback = "—") => (isBlank(v) ? fallback : String(v));

const propTypeOf = (l: Lead) => {
    const a = l.propType;
    if (!isBlank(a)) return String(a);
    const b = l.configuration;
    if (!isBlank(b)) return String(b);
    return "Pending";
};

const isClosedOut = (l: Lead) =>
    l.status === "Closing" || l.status === "Closed" || !!l.closingDate;

const assignedInfo = (l: Lead, siteHeads?: any[]) => {
    const name = l.assigned_receptionist || l.assigned_to || "";
    let role = "Unassigned";
    if (l.assigned_receptionist) role = "Receptionist";
    else if (siteHeads?.some((sh: any) => sh.name === l.assigned_to)) role = "Site Head";
    else if (l.assigned_to) role = "Sales Manager";
    return { name, role };
};
const COLS_STORAGE_KEY = "bd:overview:hiddenCols:v2";

/* ───────────────── column definitions ─────────────────
   Order follows the redesign spec; every column that existed before is
   still here, just hideable via the Columns selector.
   ────────────────────────────────────────────────────── */

const COLUMNS: Column[] = [
    {
        key: "lead_no",
        label: "Lead No.",
        minWidth: "min-w-[76px]",
        locked: true,
        sortValue: (l) => Number(l.sr_no || l.id) || 0,
        render: (l, { isDark }) => (
            <span className={`font-bold ${isDark ? "text-[#d946a8]" : "text-[#9E217B]"}`}>
                #{l.sr_no || l.id}
            </span>
        ),
    },
    {
        key: "name",
        label: "Name",
        minWidth: "min-w-[190px]",
        locked: true,
        sortValue: (l) => String(l.name || "").toLowerCase(),
        render: (l, { isDark, theme, onNavigateToSales }) => (
            <span
                className={`font-bold text-[13px] leading-tight transition-colors ${theme.text} ${onNavigateToSales
                    ? isDark
                        ? "hover:text-[#d946a8] cursor-pointer"
                        : "hover:text-[#9E217B] cursor-pointer"
                    : ""
                    }`}
                title={onNavigateToSales ? `Open lead detail for ${l.name}` : undefined}
                onClick={(e) => {
                    if (!onNavigateToSales) return;
                    e.stopPropagation();
                    onNavigateToSales(l);
                }}
            >
                {l.name}
            </span>
        ),
    },
    {
        key: "contact",
        label: "Contact",
        minWidth: "min-w-[180px]",
        sortValue: (l) => String(l.phone || ""),
        render: (l, { isDark }) => (
            <ContactCell phone={l.phone} email={l.email} isDark={isDark} />
        ),
    },
    {
        key: "prop_type",
        label: "Property Type",
        minWidth: "min-w-[110px]",
        sortValue: (l) => propTypeOf(l).toLowerCase(),
        render: (l, { theme }) => (
            <span className={`text-xs ${theme.textMuted}`}>{propTypeOf(l)}</span>
        ),
    },
    {
        key: "budget",
        label: "Budget",
        align: "right",
        minWidth: "min-w-[100px]",
        sortValue: (l) => {
            const raw = String(l.salesBudget || l.budget || "");
            const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
            if (isNaN(n)) return -1;
            return /cr/i.test(raw) ? n * 100 : n; // normalise Cr → Lakh
        },
        render: (l, { isDark }) => {
            const v = l.salesBudget || l.budget;
            return isBlank(v) ? (
                <span className="text-xs italic opacity-35">—</span>
            ) : (
                <span
                    className={`font-semibold text-[13px] tabular-nums ${isDark ? "text-emerald-400" : "text-emerald-600"
                        }`}
                >
                    {v}
                </span>
            );
        },
    },
    {
        key: "source",
        label: "Source",
        minWidth: "min-w-[110px]",
        sortValue: (l) => String(l.source || "").toLowerCase(),
        render: (l, { theme }) => (
            <span className={`text-xs ${theme.textMuted}`}>{txt(l.source)}</span>
        ),
    },
    {
        key: "cp_name",
        label: "CP Name",
        minWidth: "min-w-[130px]",
        sortValue: (l) => String(l.cpName || l.cp_name || "").toLowerCase(),
        render: (l, { theme }) => (
            <span className={`text-xs ${theme.textMuted}`}>{txt(l.cpName || l.cp_name)}</span>
        ),
    },
    {
        key: "cp_company",
        label: "CP Company",
        minWidth: "min-w-[120px]",
        sortValue: (l) => String(l.cpCompany || l.cp_company || "").toLowerCase(),
        render: (l, { theme }) => (
            <span className={`text-xs ${theme.textMuted}`}>{txt(l.cpCompany || l.cp_company)}</span>
        ),
    },
    {
        key: "cp_phone",
        label: "CP Phone",
        minWidth: "min-w-[115px]",
        sortValue: (l) => String(l.cpPhone || l.cp_phone || ""),
        render: (l, { theme }) => {
            const v = l.cpPhone || l.cp_phone;
            if (isBlank(v)) return <span className="text-xs italic opacity-35">—</span>;
            return (
                <a
                    href={`tel:${String(v).replace(/[^0-9+]/g, "")}`}
                    onClick={(e) => e.stopPropagation()}
                    className={`font-mono text-xs hover:underline ${theme.textMuted}`}
                >
                    {v}
                </a>
            );
        },
    },
    {
        key: "status",
        label: "Status",
        align: "center",
        minWidth: "min-w-[130px]",
        sortValue: (l) => String(l.status || "Assigned").toLowerCase(),
        render: (l, { isDark }) => <StatusChip status={l.status || "Assigned"} isDark={isDark} />,
    },
    {
        key: "lost_status",
        label: "Lost Status",
        align: "center",
        minWidth: "min-w-[110px]",
        sortValue: (l) => (l.is_lost_lead ? 1 : 0),
        render: (l, { isDark }) => (
            <StatusChip status={l.is_lost_lead ? "Lost Lead" : "Active"} isDark={isDark} size="sm" />
        ),
    },
    {
        key: "interest",
        label: "Interest",
        align: "center",
        minWidth: "min-w-[115px]",
        sortValue: (l) => String(l.leadInterestStatus || "").toLowerCase(),
        render: (l, { isDark, InterestBadge }) =>
            l.leadInterestStatus && l.leadInterestStatus !== "Pending" ? (
                <InterestBadge status={l.leadInterestStatus} size="sm" isDark={isDark} />
            ) : (
                <span className="text-xs italic opacity-35">—</span>
            ),
    },
    {
        key: "site_visit",
        label: "Site Visit",
        minWidth: "min-w-[105px]",
        sortValue: (l) => (l.mongoVisitDate ? new Date(l.mongoVisitDate).getTime() : 0),
        render: (l, { formatDate }) =>
            l.mongoVisitDate ? (
                <span className="text-orange-500 font-semibold text-xs whitespace-nowrap">
                    {formatDate(l.mongoVisitDate).split(",")[0]}
                </span>
            ) : (
                <span className="text-xs italic opacity-35">Pending</span>
            ),
    },
    {
        key: "created_at",
        label: "Created On",
        minWidth: "min-w-[115px]",
        sortValue: (l) => (l.created_at ? new Date(l.created_at).getTime() : 0),
        render: (l, { theme, formatDate }) =>
            l.created_at ? (
                <span className={`text-xs whitespace-nowrap ${theme.textFaint}`}>
                    {formatDate(l.created_at)}
                </span>
            ) : (
                <span className="text-xs italic opacity-35">—</span>
            ),
    },
    {
        key: "backdated",
        label: "Backdated Entry",
        minWidth: "min-w-[120px]",
        sortValue: (l) =>
            l.auto_date_enabled === false && l.enquiry_date
                ? new Date(l.enquiry_date).getTime()
                : 0,
        render: (l, { isDark, formatDate }) =>
            l.auto_date_enabled === false && l.enquiry_date ? (
                <span
                    className={`inline-flex items-center px-2 py-[3px] rounded-md text-[10px] font-bold border whitespace-nowrap ${isDark
                        ? "bg-amber-500/10 text-amber-300 border-amber-500/25"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                    title="Enquiry date taken from source, not the day it was entered"
                >
                    {formatDate(l.enquiry_date).split(",")[0]}
                </span>
            ) : (
                <span className="text-xs italic opacity-30">—</span>
            ),
    },
    {
        key: "assigned_to",
        label: "Assigned To",
        minWidth: "min-w-[150px]",
        sortValue: (l) => String(l.assigned_receptionist || l.assigned_to || "").toLowerCase(),
        render: (l, { theme, isDark, siteHeads }) => {
            const { name, role } = assignedInfo(l, siteHeads);
            if (!name) return <span className="text-xs italic opacity-35">—</span>;
            return (
                <div className="flex flex-col gap-[3px]">
                    <span className={`font-semibold text-xs ${theme.text}`}>{name}</span>
                    <span
                        className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded border w-fit ${isDark
                            ? "bg-white/[0.04] border-white/10 text-gray-400"
                            : "bg-gray-50 border-gray-200 text-gray-500"
                            }`}
                    >
                        {role}
                    </span>
                </div>
            );
        },
    },
    {
        key: "reassign",
        label: "Reassign",
        align: "center",
        minWidth: "min-w-[115px]",
        defaultHidden: true, // available inside the ⋮ actions menu
        render: (l, { isDark, onReassign }) =>
            isClosedOut(l) ? (
                <StatusChip status="Closed" isDark={isDark} size="sm" />
            ) : (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onReassign(l);
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all duration-200 hover:-translate-y-[1px] ${isDark
                        ? "bg-orange-600/90 hover:bg-orange-500 text-white"
                        : "bg-orange-100 hover:bg-orange-200 text-orange-700"
                        }`}
                >
                    <FaExchangeAlt className="text-[9px]" /> Reassign
                </button>
            ),
    },
    {
        key: "actions",
        label: "Actions",
        align: "center",
        minWidth: "min-w-[64px]",
        locked: true,
        render: (l, ctx) => {
            const items: MenuItem[] = [];
            if (ctx.onNavigateToSales)
                items.push({
                    label: "View lead",
                    icon: <FaEye className="text-[10px]" />,
                    onClick: () => ctx.onNavigateToSales!(l),
                });
            items.push({
                label: "Reassign",
                icon: <FaExchangeAlt className="text-[10px]" />,
                onClick: () => ctx.onReassign(l),
                disabled: isClosedOut(l),
                disabledReason: "This lead is already marked closed",
            });
            if (ctx.isAdmin) {
                items.push({ label: "", icon: null, divider: true });
                items.push({
                    label: "Delete lead",
                    icon: <FaTrashAlt className="text-[10px]" />,
                    onClick: () => ctx.onDeleteLead(l),
                    danger: true,
                });
            }
            return <ActionMenu items={items} isDark={ctx.isDark} />;
        },
    },
];

/* ══════════════════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════════════════ */

export default function EnquiryOverviewSection(props: EnquiryOverviewSectionProps) {
    const {
        allLeads,
        filteredOverviewLeads,
        isLoading,
        theme,
        isDark,
        isAdmin,
        siteHeads,
        lostLeadFilter,
        setLostLeadFilter,
        showLostLeads,
        setShowLostLeads,
        duplicateIds,
        dupGroupByLeadId,
        showDuplicatesOnly,
        setShowDuplicatesOnly,
        overviewSearch,
        setOverviewSearch,
        overviewSearchColumn,
        setOverviewSearchColumn,
        selectMode,
        setSelectMode,
        exitSelectMode,
        selectedIds,
        setSelectedIds,
        toggleSelectOne,
        onOpenBulkDelete,
        onToast,
        onDeleteLead,
        onReassign,
        onNavigateToSales,
        refetch,
        formatDate,
        downloadCSV,
        formatLeadForExport,
        DashboardAnalytics,
        UploadLeadSheet,
        InterestBadge,
    } = props;

    /* ── column visibility (persisted) ── */
    const [hiddenCols, setHiddenCols] = useState<Set<string>>(
        () => new Set(COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key))
    );

    useEffect(() => {
        try {
            const saved = localStorage.getItem(COLS_STORAGE_KEY);
            if (saved) setHiddenCols(new Set(JSON.parse(saved)));
        } catch {
            /* ignore */
        }
    }, []);

    const persistCols = (next: Set<string>) => {
        setHiddenCols(next);
        try {
            localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...next]));
        } catch {
            /* ignore */
        }
    };

    const visibleColumns = useMemo(
        () => COLUMNS.filter((c) => c.locked || !hiddenCols.has(c.key)),
        [hiddenCols]
    );

    /* ── sorting ── */
    const [sortKey, setSortKey] = useState<string | null>("lead_no");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    const toggleSort = (key: string) => {
        const col = COLUMNS.find((c) => c.key === key);
        if (!col?.sortValue) return;
        if (sortKey !== key) {
            setSortKey(key);
            // numbers and dates are most useful highest-first; text A→Z
            const numericFirst = ["lead_no", "budget", "created_at", "backdated", "site_visit"];
            setSortDir(numericFirst.includes(key) ? "desc" : "asc");
        } else {
            setSortDir(sortDir === "asc" ? "desc" : "asc");
        }
    };

    const sortedLeads = useMemo(() => {
        if (!sortKey) return filteredOverviewLeads;
        const col = COLUMNS.find((c) => c.key === sortKey);
        if (!col?.sortValue) return filteredOverviewLeads;
        const dir = sortDir === "asc" ? 1 : -1;
        return [...filteredOverviewLeads].sort((a, b) => {
            const va = col.sortValue!(a);
            const vb = col.sortValue!(b);
            if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
    }, [filteredOverviewLeads, sortKey, sortDir]);

    /* ── pagination ── */
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    useEffect(() => {
        setPage(1);
    }, [overviewSearch, overviewSearchColumn, lostLeadFilter, showLostLeads, showDuplicatesOnly, rowsPerPage]);

    const pageCount = Math.max(1, Math.ceil(sortedLeads.length / rowsPerPage));
    useEffect(() => {
        if (page > pageCount) setPage(pageCount);
    }, [page, pageCount]);

    const pageRows = useMemo(
        () => sortedLeads.slice((page - 1) * rowsPerPage, page * rowsPerPage),
        [sortedLeads, page, rowsPerPage]
    );

    /* id → sr_no, for the "duplicate phone — also on Lead #N" tooltip.
       Built once per allLeads change instead of scanning allLeads inside the row
       loop for every duplicate on the page. */
    const srNoById = useMemo(() => {
        const m = new Map<number, number | string>();
        for (const l of allLeads as Lead[]) m.set(Number(l.id), l.sr_no);
        return m;
    }, [allLeads]);

    /* ── selection helpers (page-scoped select-all) ── */
    const pageIds = pageRows.map((l) => Number(l.id));
    const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    const somePageSelected = pageIds.some((id) => selectedIds.has(id));

    const toggleSelectPage = (checked: boolean) =>
        setSelectedIds((prev) => {
            const next = new Set(prev);
            pageIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
            return next;
        });

    const hasFilters =
        !!overviewSearch ||
        lostLeadFilter !== "all" ||
        showDuplicatesOnly ||
        !showLostLeads;

    const clearFilters = () => {
        setOverviewSearch("");
        setOverviewSearchColumn("all");
        setLostLeadFilter("all");
        setShowLostLeads(true);
        setShowDuplicatesOnly(false);
    };

    /* Memoised because this object is handed to every cell renderer. Rebuilt
       fresh on each render it changes identity every time, which defeats
       memoisation in anything downstream that receives it — including on every
       keystroke in the search box, since overviewSearch lives in the parent.
       `theme` is already useMemo'd by the caller (dashboard/page.tsx:578), so
       this genuinely stays stable rather than only appearing to. */
    const ctx: Ctx = useMemo(
        () => ({
            theme,
            isDark,
            isAdmin,
            siteHeads,
            formatDate,
            onReassign,
            onDeleteLead,
            onNavigateToSales,
            InterestBadge,
        }),
        [
            theme,
            isDark,
            isAdmin,
            siteHeads,
            formatDate,
            onReassign,
            onDeleteLead,
            onNavigateToSales,
            InterestBadge,
        ]
    );

    const colSpan = visibleColumns.length + (selectMode ? 1 : 0);

    /* ══════════════════════════ render ══════════════════════════ */
    return (
        <div className="animate-fadeIn space-y-4">
            {/* ── Analytics ── */}
            {allLeads.length > 0 && (
                <div>
                    <div className="flex items-center gap-3 mb-4">
                        <FaChartPie className="text-[#00AEEF]" />
                        <h3 className={`font-bold text-sm uppercase tracking-wider ${theme.text}`}>
                            Overall Lead Analytics
                        </h3>
                        <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${theme.settingsBg} ${theme.textMuted}`}
                        >
                            {allLeads.length.toLocaleString("en-IN")} leads
                        </span>
                    </div>
                    <DashboardAnalytics leads={allLeads} theme={theme} isDark={isDark} />
                </div>
            )}

            {/* ── Keyframe styles (stable — never inside a conditional) ── */}
            <style>{`@keyframes barIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>

            {/* ── Table card ── */}
            <div className={`${theme.tableWrap} rounded-3xl overflow-hidden`} style={theme.tableGlass}>
                {/* ═══ Toolbar row 1: title + search + actions ═══ */}
                <div
                    className={`px-5 pt-4 pb-3 flex flex-wrap items-center gap-3 ${theme.tableHead}`}
                >
                    {/* left */}
                    <div className="flex items-center gap-2.5 shrink-0">
                        <FaTable className="text-[#00AEEF] text-sm" />
                        <h3 className={`font-bold text-[15px] tracking-tight ${theme.text}`}>
                            Enquiry Overview
                        </h3>
                        <span
                            className={`text-[10px] font-bold px-2 py-1 rounded-md tabular-nums ${theme.btnClosingBadge}`}
                            title={
                                sortedLeads.length !== allLeads.length
                                    ? `${sortedLeads.length} of ${allLeads.length} leads match the current filters`
                                    : undefined
                            }
                        >
                            {sortedLeads.length.toLocaleString("en-IN")}
                            {sortedLeads.length !== allLeads.length && (
                                <span className="opacity-50"> / {allLeads.length.toLocaleString("en-IN")}</span>
                            )}
                        </span>
                    </div>

                    {/* center */}
                    <SearchBar value={overviewSearch} onChange={setOverviewSearch} isDark={isDark} />

                    {/* right */}
                    <div className="flex items-center gap-2 flex-wrap ml-auto">
                        <ColumnSelector
                            columns={COLUMNS.map((c) => ({ key: c.key, label: c.label, locked: c.locked }))}
                            hidden={hiddenCols}
                            onToggle={(key) => {
                                const next = new Set(hiddenCols);
                                next.has(key) ? next.delete(key) : next.add(key);
                                persistCols(next);
                            }}
                            onReset={() =>
                                persistCols(new Set(COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key)))
                            }
                            isDark={isDark}
                        />

                        <UploadLeadSheet mode="assign" isDark={isDark} onImported={refetch} />

                        <ToolbarButton
                            onClick={() =>
                                downloadCSV(allLeads.map(formatLeadForExport), "Overall_Enquiries.csv")
                            }
                            icon={<FaDownload className="text-[11px]" />}
                            isDark={isDark}
                            title="Download all leads as CSV"
                        >
                            Export
                        </ToolbarButton>

                        {isAdmin && (
                            <ToolbarButton
                                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                                icon={<FaCheckCircle className="text-[11px]" />}
                                isDark={isDark}
                                active={selectMode}
                                title="Select multiple leads"
                            >
                                {selectMode ? "Cancel" : "Select"}
                            </ToolbarButton>
                        )}

                        <ToolbarButton
                            onClick={refetch}
                            icon={<FaSyncAlt className="text-[11px]" />}
                            isDark={isDark}
                            title="Refresh leads"
                        />
                    </div>
                </div>

                {/* ═══ Toolbar row 2: filters ═══ */}
                <div
                    className={`px-5 pb-3.5 pt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b ${isDark ? "border-white/[0.06]" : "border-indigo-300"
                        }`}
                >
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">
                        Filters
                    </span>

                    <select
                        value={lostLeadFilter}
                        onChange={(e) => setLostLeadFilter(e.target.value as any)}
                        className={`h-8 px-2.5 rounded-lg text-xs font-bold outline-none border cursor-pointer transition-colors ${theme.select}`}
                    >
                        <option value="all">All leads</option>
                        <option value="active">Active only</option>
                        <option value="lost">Lost only</option>
                    </select>

                    <select
                        value={overviewSearchColumn}
                        onChange={(e) => setOverviewSearchColumn(e.target.value)}
                        className={`h-8 px-2.5 rounded-lg text-xs font-bold outline-none border cursor-pointer transition-colors ${theme.select}`}
                        title="Restrict search to one column"
                    >
                        <option value="all">Search: all columns</option>
                        <option value="lead_no">Lead No.</option>
                        <option value="name">Name</option>
                        <option value="prop_type">Property Type</option>
                        <option value="budget">Budget</option>
                        <option value="source">Source</option>
                        <option value="cp_name">CP Name</option>
                        <option value="cp_company">CP Company</option>
                        <option value="cp_phone">CP Phone</option>
                        <option value="status">Status</option>
                        <option value="interest">Interest</option>
                        <option value="site_visit">Site Visit</option>
                        <option value="assigned_to">Assigned To</option>
                    </select>

                    <div className={`w-px h-5 ${isDark ? "bg-white/10" : "bg-gray-200"}`} />

                    <ToggleSwitch
                        checked={showLostLeads}
                        onChange={setShowLostLeads}
                        label="Show lost"
                        disabled={lostLeadFilter !== "all"}
                        title={
                            lostLeadFilter !== "all"
                                ? "Controlled by the All leads filter"
                                : "Include lost leads in the table"
                        }
                        isDark={isDark}
                    />

                    <ToggleSwitch
                        checked={showDuplicatesOnly}
                        onChange={setShowDuplicatesOnly}
                        label="Duplicates only"
                        count={duplicateIds.size}
                        accent="#f59e0b"
                        disabled={duplicateIds.size === 0}
                        title={
                            duplicateIds.size > 0
                                ? `${duplicateIds.size} leads share a phone number with another lead`
                                : "No duplicate phone numbers found"
                        }
                        isDark={isDark}
                    />

                    {hasFilters && (
                        <button
                            onClick={clearFilters}
                            className="ml-auto text-[11px] font-bold text-[#00AEEF] hover:underline"
                        >
                            Clear filters
                        </button>
                    )}
                </div>

                {/* ═══ Bulk action bar ═══ */}
                {selectMode && selectedIds.size > 0 && (
                    <div
                        className={`flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 border-b animate-[barIn_180ms_ease-out] ${isDark ? "bg-red-950/25 border-red-900/40" : "bg-red-50 border-red-100"
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <span
                                className={`text-xs font-black tabular-nums ${isDark ? "text-red-200" : "text-red-700"
                                    }`}
                            >
                                {selectedIds.size} selected
                            </span>
                            {selectedIds.size > 100 && (
                                <span className="text-[11px] font-semibold text-red-400">
                                    Maximum 100 per delete
                                </span>
                            )}
                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className={`text-[11px] font-bold hover:underline ${isDark ? "text-red-300/70" : "text-red-600/70"
                                    }`}
                            >
                                Clear selection
                            </button>
                        </div>
                        <ToolbarButton
                            onClick={() => {
                                if (selectedIds.size > 100) {
                                    onToast("Maximum 100 leads per bulk delete");
                                    setTimeout(() => onToast(null), 3000);
                                    return;
                                }
                                onOpenBulkDelete();
                            }}
                            icon={<FaTrashAlt className="text-[11px]" />}
                            isDark={isDark}
                            tone="danger"
                        >
                            Delete selected
                        </ToolbarButton>
                    </div>
                )}

                {/* ═══ Table ═══ */}
                <DraggableTableContainer isDark={isDark}>
                    <table className="w-full text-left text-sm border-separate border-spacing-0">
                        {/* No backdrop-filter here, deliberately.
                            theme.tableHead is bg-[#1A1A28] / bg-[#F1F5F9] — fully
                            opaque, no alpha. A blur behind an opaque layer is
                            invisible, but the compositor still has to snapshot and
                            gaussian-blur the region behind this sticky header on
                            every scroll frame before painting the solid box over
                            it. That was the source of the scroll frame drops.
                            If tableHead is ever made translucent, reinstate it. */}
                        <thead
                            className={`sticky top-0 z-20 ${theme.tableHead} ${theme.textHeader}`}
                        >
                            <tr>
                                {selectMode && (
                                    <th
                                        className={`w-[46px] px-4 py-3 border-b ${isDark ? "border-white/[0.08]" : "border-indigo-500"
                                            }`}
                                    >
                                        <Checkbox
                                            checked={allPageSelected}
                                            indeterminate={somePageSelected && !allPageSelected}
                                            onChange={toggleSelectPage}
                                            title="Select every lead on this page"
                                        />
                                    </th>
                                )}
                                {visibleColumns.map((col) => {
                                    const sortable = !!col.sortValue;
                                    const dir = sortKey === col.key ? sortDir : null;
                                    return (
                                        <th
                                            key={col.key}
                                            onClick={() => sortable && toggleSort(col.key)}
                                            title={sortable ? `Sort by ${col.label}` : undefined}
                                            className={`
                        group px-3 py-3 whitespace-nowrap border-b
                        text-[10px] font-bold uppercase tracking-[0.09em]
                        ${col.minWidth}
                        ${isDark ? "border-white/[0.08]" : "border-gray-300"}
                        ${sortable ? "cursor-pointer select-none" : ""}
                        ${sortable
                                                    ? isDark
                                                        ? "hover:text-white transition-colors"
                                                        : "hover:text-gray-900 transition-colors"
                                                    : ""
                                                }
                        ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                      `}
                                        >
                                            <span
                                                className={`inline-flex items-center gap-1.5 ${col.align === "right"
                                                    ? "flex-row-reverse"
                                                    : col.align === "center"
                                                        ? "justify-center"
                                                        : ""
                                                    }`}
                                            >
                                                {col.label}
                                                {sortable && <SortIcon dir={dir} />}
                                            </span>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>

                        <tbody>
                            {isLoading ? (
                                <SkeletonRows rows={8} cols={colSpan} isDark={isDark} />
                            ) : pageRows.length === 0 ? (
                                <tr>
                                    <td colSpan={colSpan}>
                                        <EmptyState onReset={clearFilters} hasFilters={hasFilters} isDark={isDark} />
                                    </td>
                                </tr>
                            ) : (
                                pageRows.map((lead, rowIdx) => {
                                    const id = Number(lead.id);
                                    const isDuplicate = duplicateIds.has(id);
                                    const isSelected = selectedIds.has(id);

                                    // srNoById, not allLeads.find(). The find was a
                                    // linear scan of every lead, run once per
                                    // duplicate per rendered row — O(rows × dups ×
                                    // leads). Harmless at 200 leads, quadratic at
                                    // 10,000. The Map is built once per render below.
                                    const dupOthers = isDuplicate
                                        ? (dupGroupByLeadId.get(id) || [])
                                            .filter((x) => x !== id)
                                            .map((x) => `#${srNoById.get(x) || x}`)
                                        : [];

                                    const rowTitle = isDuplicate
                                        ? `Duplicate phone — also on Lead ${dupOthers.join(", ")}`
                                        : undefined;

                                    const zebra =
                                        rowIdx % 2 === 1
                                            ? isDark
                                                ? "bg-white/[0.015]"
                                                : "bg-gray-100/60"
                                            : "";

                                    return (
                                        <tr
                                            key={lead.id}
                                            title={rowTitle}
                                            onClick={() =>
                                                selectMode ? toggleSelectOne(id) : onNavigateToSales?.(lead)
                                            }
                                            className={`
                        group cursor-pointer transition-colors duration-200
                        ${zebra}
                        ${isSelected
                                                    ? isDark
                                                        ? "bg-[#9E217B]/[0.14]"
                                                        : "bg-[#9E217B]/[0.06]"
                                                    : isDark
                                                        ? "hover:bg-white/[0.045]"
                                                        : "hover:bg-[#9E217B]/[0.035]"
                                                }
                      `}
                                            style={lead.is_lost_lead ? { opacity: 0.55 } : undefined}
                                        >
                                            {selectMode && (
                                                <td
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={`px-4 py-3.5 border-b ${isDark ? "border-white/[0.045]" : "border-gray-300"
                                                        }`}
                                                >
                                                    <Checkbox checked={isSelected} onChange={() => toggleSelectOne(id)} />
                                                </td>
                                            )}

                                            {visibleColumns.map((col, colIdx) => (
                                                <td
                                                    key={col.key}
                                                    className={`
                            px-3 py-3.5 whitespace-nowrap border-b
                            ${isDark ? "border-white/[0.045]" : "border-indigo-300"}
                            ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"}
                            ${colIdx === 0 && isDuplicate
                                                            ? "relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-amber-500"
                                                            : ""
                                                        }
                          `}
                                                >
                                                    {col.render(lead, ctx)}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </DraggableTableContainer>

                {/* ═══ Pagination ═══ */}
                {!isLoading && sortedLeads.length > 0 && (
                    <Pagination
                        page={page}
                        rowsPerPage={rowsPerPage}
                        total={sortedLeads.length}
                        onPageChange={setPage}
                        onRowsPerPageChange={setRowsPerPage}
                        isDark={isDark}
                    />
                )}
            </div>
        </div>
    );
}