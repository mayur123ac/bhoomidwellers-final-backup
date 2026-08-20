"use client";

// Platform-wide user visibility. Read-only: the brief allows editing only where
// existing APIs already support it, and no platform-level user API exists yet.
//
// Note what is deliberately absent — there is no password column and no way to
// reveal one. The tenant employee screens have historically leaked credentials,
// and a platform-level list is the last place that should be repeated.

import { useMemo, useState } from "react";
import type { SuperAdminTheme } from "./theme";
import type { PlatformUser } from "./mockData";
import { Panel, SearchField, Segmented, StatusPill, EmptyState, fmtDate } from "./ui";

export default function UsersView({ t, users }: { t: SuperAdminTheme; users: PlatformUser[] }) {
  const [q, setQ] = useState("");
  const [org, setOrg] = useState("all");

  const orgOptions = useMemo(
    () => ["all", ...Array.from(new Set(users.map(u => u.organization)))],
    [users]
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter(u => {
      if (org !== "all" && u.organization !== org) return false;
      if (!needle) return true;
      return `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(needle);
    });
  }, [users, q, org]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <SearchField t={t} value={q} onChange={setQ} placeholder="Search name, email or role" />
        <div className="flex items-center gap-3 min-w-0">
          {/* Organization names are long; the segmented control scrolls rather
              than wrapping the toolbar onto three lines. */}
          <div className="min-w-0 max-w-full overflow-hidden">
            <Segmented
              t={t}
              options={orgOptions.map(o => (o === "all" ? "all" : o.split(" ")[0]))}
              value={org === "all" ? "all" : org.split(" ")[0]}
              onChange={v => setOrg(v === "all" ? "all" : orgOptions.find(o => o.split(" ")[0] === v) ?? "all")}
            />
          </div>
          <span className="hidden sm:block text-[12px] whitespace-nowrap tabular-nums" style={{ color: t.textMuted }}>
            {rows.length} of {users.length}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel t={t}><EmptyState t={t} title="No users match" sub="Try a different search or organization." /></Panel>
      ) : (
        <>
          <Panel t={t} className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ background: t.raised }}>
                    {["Name", "Email", "Role", "Organization", "Status", "Created"].map(h => (
                      <th
                        key={h}
                        className="text-left text-[11px] font-medium uppercase tracking-[0.06em] px-4 py-2.5"
                        style={{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u, i) => (
                    <tr key={u.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${t.border}` }}>
                      <td className="px-4 py-3 text-[13px] font-medium" style={{ color: t.text }}>{u.name}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>{u.email}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.text }}>{u.role}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>{u.organization}</td>
                      <td className="px-4 py-3"><StatusPill status={u.status} t={t} /></td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>{fmtDate(u.createdOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="lg:hidden space-y-2.5">
            {rows.map(u => (
              <div
                key={u.id}
                className="rounded-2xl px-4 py-3.5"
                style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium truncate" style={{ color: t.text }}>{u.name}</p>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: t.textMuted }}>{u.email}</p>
                  </div>
                  <StatusPill status={u.status} t={t} />
                </div>
                <div className="flex items-center justify-between mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${t.border}` }}>
                  <span className="text-[11px]" style={{ color: t.text }}>{u.role}</span>
                  <span className="text-[11px] truncate ml-3" style={{ color: t.textMuted }}>{u.organization}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
