"use client";

// Platform dashboard. Four counts, then the two lists that answer "what changed
// recently" — deliberately nothing else. A platform operator opening this screen
// wants to know the estate is healthy and what moved; charts of lead funnels
// belong to the tenant dashboards, not here.

import type { SuperAdminTheme } from "./theme";
import type { SuperAdminData } from "./mockData";
import type { PlatformMetrics } from "./usePlatformData";
import { Panel, SectionHead, StatTile, StatusPill, fmtDate, fmtRelative, EmptyState } from "./ui";

export default function DashboardView({
  t, data, metrics, onOpenOrg,
}: {
  t: SuperAdminTheme;
  data: SuperAdminData;
  /** Counted in SQL across the whole estate, so the tiles stay correct even
   *  when the loaded lists are capped. Falls back to deriving from the arrays
   *  only if the metrics call returned nothing. */
  metrics: PlatformMetrics | null;
  onOpenOrg: (id: string) => void;
}) {
  const orgs = data.orgs;
  const totalOrgs = metrics?.organizations ?? orgs.length;
  const activeOrgs = metrics?.active_organizations ?? orgs.filter(o => o.status === "active").length;
  const totalUsers = metrics?.users ?? orgs.reduce((n, o) => n + o.users, 0);
  const activeUsers = metrics?.active_users ?? data.users.filter(u => u.status === "active").length;

  const recentOrgs = [...orgs]
    .sort((a, b) => +new Date(b.createdOn) - +new Date(a.createdOn))
    .slice(0, 4);
  const recentActivity = data.activity.slice(0, 5);

  return (
    <div className="space-y-8">
      <section>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatTile t={t} label="Organizations" value={totalOrgs} />
          <StatTile t={t} label="Active" value={activeOrgs} hint={`${totalOrgs - activeOrgs} not active`} />
          <StatTile t={t} label="Total Users" value={totalUsers} />
          <StatTile t={t} label="Active Users" value={activeUsers} hint={`of ${totalUsers} total`} />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section>
          <SectionHead t={t} title="Recent Organizations" sub="Newest tenants on the platform" />
          <Panel t={t}>
            {recentOrgs.length === 0 ? (
              <EmptyState t={t} title="No organizations yet" />
            ) : recentOrgs.map((o, i) => (
              <button
                key={o.id}
                onClick={() => onOpenOrg(o.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                style={{ borderTop: i === 0 ? "none" : `1px solid ${t.border}` }}
                onMouseEnter={e => { e.currentTarget.style.background = t.hover; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <span
                  className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-[12px] font-semibold"
                  style={{ background: t.raised, color: t.textMuted }}
                >
                  {o.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium truncate" style={{ color: t.text }}>{o.name}</span>
                  <span className="block text-[11px] mt-0.5" style={{ color: t.textMuted }}>
                    {o.users} {o.users === 1 ? "user" : "users"} · added {fmtDate(o.createdOn)}
                  </span>
                </span>
                <StatusPill status={o.status} t={t} />
              </button>
            ))}
          </Panel>
        </section>

        <section>
          <SectionHead t={t} title="Recent Platform Activity" sub="Across all organizations" />
          <Panel t={t}>
            {recentActivity.length === 0 ? (
              <EmptyState t={t} title="Nothing recorded yet" />
            ) : recentActivity.map((a, i) => (
              <div
                key={a.id}
                className="flex items-start gap-3 px-4 py-3"
                style={{ borderTop: i === 0 ? "none" : `1px solid ${t.border}` }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[7px]"
                  style={{ background: a.severity === "warning" ? t.warning : a.severity === "notice" ? t.info : t.textMuted }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate" style={{ color: t.text }}>{a.action}</p>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: t.textMuted }}>
                    {a.actor} · {a.organization ?? "Platform"}
                  </p>
                </div>
                <span className="text-[11px] flex-shrink-0 whitespace-nowrap" style={{ color: t.textMuted }}>
                  {fmtRelative(a.at)}
                </span>
              </div>
            ))}
          </Panel>
        </section>
      </div>
    </div>
  );
}
