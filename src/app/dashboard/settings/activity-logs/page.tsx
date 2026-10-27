"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  T,
  TextInput,
  api,
  useToast,
} from "@/components/Settings/ui";
import SharedColumnFilterDropdown, {
  useColumnFilters,
  type FilterableColumn,
} from "@/components/ColumnFilterDropdown";
import { FaFilter, FaSortAlphaDown, FaSortAlphaUp } from "react-icons/fa";

/** Action groups the filter offers, mapped to the substring the API matches on. */
const ACTION_FILTERS: { label: string; value: string }[] = [
  { label: "All actions", value: "" },
  { label: "Login", value: "login" },
  { label: "Profile updates", value: "profile" },
  { label: "Password & security", value: "password" },
  { label: "Email changes", value: "email" },
  { label: "Preferences", value: "preferences" },
  { label: "Employee management", value: "employee" },
  { label: "Workspace changes", value: "workspace" },
  { label: "Sessions", value: "session" },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

export default function ActivityLogsPage() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [filters, setFilters] = useState({
    from: isoDaysAgo(30), // spec default: last 30 days
    to: new Date().toISOString().slice(0, 10),
    action: "",
    userId: "",
    page: 1,
  });

  const queryString = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        from: filters.from,
        // The `to` date is inclusive of the whole day; without the end-of-day
        // time, events later today are filtered out of "up to today".
        to: `${filters.to}T23:59:59`,
        page: String(filters.page),
        ...extra,
      });
      if (filters.action) params.set("action", filters.action);
      if (filters.userId) params.set("userId", filters.userId);
      return params.toString();
    },
    [filters]
  );

  const load = useCallback(() => {
    setLoading(true);
    api<any>(`/api/settings/activity-logs?${queryString()}`)
      .then(setData)
      .catch((err) => toast("error", err.message))
      .finally(() => setLoading(false));
  }, [queryString, toast]);

  useEffect(load, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/settings/activity-logs?${queryString({ format: "csv" })}`);
      if (!response.ok) throw new Error("Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `activity-logs-${filters.from}-to-${filters.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast("success", "Logs exported.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setExporting(false);
    }
  };

  const setFilter = (patch: Partial<typeof filters>) =>
    // Any filter change resets to page 1 — staying on page 7 of a result set
    // that now has two pages shows an empty table.
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  /* ── Excel-style column filter / sort ── */
  const {
    colFilters, colSort, openFilterCol, setOpenFilterCol,
    applyFilter, applySort, clearAllFilters, filterRows, sortRows,
  } = useColumnFilters();

  const logFilterCols: FilterableColumn[] = useMemo(() => [
    { key: "timestamp", label: "Timestamp", type: "date" },
    { key: "user", label: "User" },
    { key: "action", label: "Action" },
    { key: "details", label: "Details" },
    { key: "ip", label: "IP Address" },
    { key: "device", label: "Device" },
  ], []);

  const getLogDisplayValue = useCallback((row: any, colKey: string): string => {
    switch (colKey) {
      case "timestamp":
        return row.timestamp
          ? new Date(row.timestamp).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : "";
      case "user": return row.actor ?? "";
      case "action": return row.action ?? "";
      case "details": return row.details ?? "";
      case "ip": return row.ipAddress ?? "";
      case "device": return row.device ?? "";
      default: return "";
    }
  }, []);

  const rawRows: any[] = data?.rows ?? [];

  const filteredRows = useMemo(() => {
    let result = filterRows(rawRows, getLogDisplayValue);
    result = sortRows(result, getLogDisplayValue);
    return result;
  }, [rawRows, filterRows, sortRows, getLogDisplayValue]);

  return (
    <>
      <PageHeader
        title="Activity Logs"
        subtitle="Sign-ins, settings changes and CRM activity."
        action={
          <Button variant="secondary" onClick={exportCsv} loading={exporting}>
            Export CSV
          </Button>
        }
      />

      <Card>
        <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From" htmlFor="from">
            <TextInput
              id="from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilter({ from: e.target.value })}
            />
          </Field>
          <Field label="To" htmlFor="to">
            <TextInput
              id="to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilter({ to: e.target.value })}
            />
          </Field>
          <Field label="Action type" htmlFor="action">
            <Select
              id="action"
              value={filters.action}
              onChange={(e) => setFilter({ action: e.target.value })}
            >
              {ACTION_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          {data?.canFilterByUser && (
            <Field label="User" htmlFor="user">
              <Select
                id="user"
                value={filters.userId}
                onChange={(e) => setFilter({ userId: e.target.value })}
              >
                <option value="">Me</option>
                <option value="all">Everyone</option>
                {data.users?.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <Card>
        {loading ? (
          <Skeleton rows={6} />
        ) : !data || rawRows.length === 0 ? (
          <EmptyState
            title="No activity in this range"
            description="Try widening the date range or clearing the action filter."
          />
        ) : (
          <>
            {/* Wide table scrolls inside its own container so the page body
                never scrolls sideways on a phone. */}
            {(Object.values(colFilters).some(v => v != null) || colSort) && (
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => clearAllFilters()}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-red-500 hover:bg-gray-50 transition-colors"
                >
                  Clear column filters
                </button>
                <span className="text-xs" style={{ color: T.muted }}>
                  {filteredRows.length} of {rawRows.length} shown
                </span>
              </div>
            )}
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="text-left">
                    {logFilterCols.map((fc) => {
                      const isFiltered = colFilters[fc.key] != null;
                      const isSorted = colSort?.key === fc.key;
                      const isActive = isFiltered || isSorted;
                      return (
                        <th
                          key={fc.key}
                          className="border-b py-3 pr-4 crm-caption relative"
                          style={{ borderColor: T.border, color: T.muted, fontWeight: 600 }}
                        >
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setOpenFilterCol(prev => prev === fc.key ? null : fc.key); }}
                            className={`group flex items-center gap-1.5 whitespace-nowrap transition-colors ${isActive ? "text-[#007AFF]" : "hover:text-slate-700"
                              }`}
                            title={`Filter / Sort by ${fc.label}`}
                          >
                            {fc.label}
                            <span
                              className={`inline-flex items-center justify-center w-4 h-4 rounded transition-colors ${isActive ? "bg-[#007AFF]/10 text-[#007AFF]" : "text-slate-300 group-hover:text-slate-500"
                                }`}
                            >
                              {isSorted ? (
                                colSort?.direction === "asc" ? <FaSortAlphaDown className="w-2.5 h-2.5" /> : <FaSortAlphaUp className="w-2.5 h-2.5" />
                              ) : (
                                <FaFilter className="w-2 h-2 cursor-pointer" />
                              )}
                            </span>
                            {isFiltered && <span className="w-1.5 h-1.5 rounded-full bg-[#007AFF] inline-block" />}
                          </button>
                          {openFilterCol === fc.key && (
                            <SharedColumnFilterDropdown
                              column={fc}
                              data={rawRows.map(r => ({ [fc.key]: getLogDisplayValue(r, fc.key) }))}
                              activeFilter={colFilters[fc.key] ?? null}
                              activeSort={colSort?.key === fc.key ? colSort : null}
                              onApply={vals => applyFilter(fc.key, vals)}
                              onSort={dir => applySort(fc.key, dir)}
                              onClose={() => setOpenFilterCol(null)}
                              isDark={false}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row: any) => (
                    <tr key={row.id} className="st-hover-surface transition-colors">
                      <td className="border-b py-3.5 pr-4 whitespace-nowrap crm-secondary" style={{ borderColor: T.border, color: T.muted }}>
                        {new Date(row.timestamp).toLocaleString(undefined, {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="border-b py-3.5 pr-4 crm-body font-medium" style={{ borderColor: T.border, color: T.text }}>
                        {row.actor ?? "\u2014"}
                      </td>
                      <td className="border-b py-3.5 pr-4" style={{ borderColor: T.border }}>
                        <StatusBadge
                          status={
                            row.action?.includes("failed")
                              ? "danger"
                              : row.source === "audit"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {row.action}
                        </StatusBadge>
                      </td>
                      <td className="border-b py-3.5 pr-4 crm-body" style={{ borderColor: T.border, color: T.text }}>
                        <span className="line-clamp-2 block max-w-md">{row.details ?? "\u2014"}</span>
                      </td>
                      <td className="border-b py-3.5 pr-4 crm-secondary" style={{ borderColor: T.border, color: T.muted }}>
                        {row.ipAddress ?? "\u2014"}
                      </td>
                      <td className="border-b py-3.5 pr-4 crm-secondary" style={{ borderColor: T.border, color: T.muted }}>
                        <span className="line-clamp-1 block max-w-[200px]">{row.device ?? "\u2014"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="crm-caption" style={{ color: T.muted, fontWeight: 400 }}>
                Page {data.page} of {data.totalPages} \u00B7 {data.total} entries
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setFilter({ page: filters.page - 1 })}
                  disabled={filters.page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setFilter({ page: filters.page + 1 })}
                  disabled={filters.page >= data.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
