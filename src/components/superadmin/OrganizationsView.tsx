"use client";

// The primary Super Admin workspace.
//
// Two renderings of the same rows: a table from `lg` up, and a stacked list
// below it. This is not a responsive table with hidden columns — a squeezed
// table on a phone is unreadable at any column count — so small screens get a
// list where each row is one tenant with the three facts that matter, and the
// rest lives in the detail sheet.

import { useMemo, useState } from "react";
import type { SuperAdminTheme } from "./theme";
import type { OrgRow } from "./mockData";
import {
  Panel, SearchField, Segmented, StatusPill, MonoId,
  PlaceholderAction, EmptyState, fmtDate, fmtRelative,
} from "./ui";

const FILTERS = ["all", "active", "inactive", "suspended"];

export default function OrganizationsView({
  t, orgs, onOpenOrg,
}: { t: SuperAdminTheme; orgs: OrgRow[]; onOpenOrg: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orgs.filter(o => {
      if (filter !== "all" && o.status !== filter) return false;
      if (!needle) return true;
      // Id is searchable too: support requests arrive quoting a UUID.
      return o.name.toLowerCase().includes(needle) || o.id.toLowerCase().includes(needle);
    });
  }, [orgs, q, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <SearchField t={t} value={q} onChange={setQ} placeholder="Search name or organization ID" />
        <div className="flex items-center gap-3">
          <Segmented t={t} options={FILTERS} value={filter} onChange={setFilter} />
          <span className="hidden sm:block text-[12px] whitespace-nowrap tabular-nums" style={{ color: t.textMuted }}>
            {rows.length} of {orgs.length}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel t={t}>
          <EmptyState t={t} title="No organizations match" sub="Try a different name, ID, or status filter." />
        </Panel>
      ) : (
        <>
          {/* ── Table: lg and up ── */}
          <Panel t={t} className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ background: t.raised }}>
                    {["Organization", "ID", "Status", "Users", "Created", "Last Activity", ""].map((h, i) => (
                      <th
                        key={h || i}
                        className={`text-[11px] font-medium uppercase tracking-[0.06em] px-4 py-2.5 ${i >= 3 && i <= 3 ? "text-right" : "text-left"}`}
                        style={{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => (
                    <tr
                      key={o.id}
                      onClick={() => onOpenOrg(o.id)}
                      className="cursor-pointer transition-colors"
                      style={{ borderTop: i === 0 ? "none" : `1px solid ${t.border}` }}
                      onMouseEnter={e => { e.currentTarget.style.background = t.hover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <td className="px-4 py-3">
                        <span className="text-[13px] font-medium" style={{ color: t.text }}>{o.name}</span>
                      </td>
                      <td className="px-4 py-3"><MonoId value={o.id} t={t} /></td>
                      <td className="px-4 py-3"><StatusPill status={o.status} t={t} /></td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-[13px] tabular-nums" style={{ color: t.text }}>{o.users}</span>
                        <span className="text-[11px] ml-1" style={{ color: t.textMuted }}>
                          ({o.admins} {o.admins === 1 ? "admin" : "admins"})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>{fmtDate(o.createdOn)}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>{fmtRelative(o.lastActivity)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                          <PlaceholderAction t={t} label="Suspend" />
                          <PlaceholderAction t={t} label="Manage" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── List: below lg ── */}
          <div className="lg:hidden space-y-2.5">
            {rows.map(o => (
              <button
                key={o.id}
                onClick={() => onOpenOrg(o.id)}
                className="w-full text-left rounded-2xl px-4 py-3.5 transition-colors"
                style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[14px] font-medium leading-snug" style={{ color: t.text }}>{o.name}</span>
                  <StatusPill status={o.status} t={t} />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <MonoId value={o.id} t={t} />
                  <span className="text-[11px]" style={{ color: t.textMuted }}>
                    {o.users} {o.users === 1 ? "user" : "users"}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${t.border}` }}>
                  <span className="text-[11px]" style={{ color: t.textMuted }}>Added {fmtDate(o.createdOn)}</span>
                  <span className="text-[11px]" style={{ color: t.textMuted }}>{fmtRelative(o.lastActivity)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
