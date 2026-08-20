"use client";

// Platform activity. Phase 1 builds the *structure* only — no new tables, per
// the brief.
//
// It is a timeline rather than a table because that is what an audit feed is
// read as: newest first, grouped by day, scanned for the one entry that looks
// wrong. The severity dot is the only colour on the screen, so a warning is
// findable without reading every row.

import { useMemo, useState } from "react";
import type { SuperAdminTheme } from "./theme";
import type { ActivityEntry } from "./mockData";
import { Panel, SearchField, Segmented, EmptyState } from "./ui";

const LEVELS = ["all", "info", "notice", "warning"];

const dayKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export default function ActivityView({ t, activity }: { t: SuperAdminTheme; activity: ActivityEntry[] }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("all");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return activity.filter(a => {
      if (level !== "all" && a.severity !== level) return false;
      if (!needle) return true;
      return `${a.action} ${a.actor} ${a.detail} ${a.organization ?? ""}`.toLowerCase().includes(needle);
    });
  }, [activity, q, level]);

  // Grouped by day so the timeline has anchors rather than 200 undifferentiated rows.
  const groups = useMemo(() => {
    const m = new Map<string, ActivityEntry[]>();
    for (const a of rows) {
      const k = dayKey(a.at);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return Array.from(m.entries());
  }, [rows]);

  const dot = (s: ActivityEntry["severity"]) =>
    s === "warning" ? t.warning : s === "notice" ? t.info : t.textMuted;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <SearchField t={t} value={q} onChange={setQ} placeholder="Search action, actor or organization" />
        <Segmented t={t} options={LEVELS} value={level} onChange={setLevel} />
      </div>

      {groups.length === 0 ? (
        <Panel t={t}><EmptyState t={t} title="No activity matches" sub="Try a different search or severity." /></Panel>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, entries]) => (
            <section key={day}>
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] mb-2 px-1" style={{ color: t.textMuted }}>
                {day}
              </p>
              <Panel t={t}>
                {entries.map((a, i) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 px-4 py-3.5"
                    style={{ borderTop: i === 0 ? "none" : `1px solid ${t.border}` }}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0 mt-[6px]" style={{ background: dot(a.severity) }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[13px] font-medium" style={{ color: t.text }}>{a.action}</span>
                        <span className="text-[12px]" style={{ color: t.textMuted }}>{a.detail}</span>
                      </div>
                      <p className="text-[11px] mt-1" style={{ color: t.textMuted }}>
                        {a.actor} · {a.actorRole} · {a.organization ?? "Platform"}
                      </p>
                    </div>
                    <span className="text-[11px] flex-shrink-0 tabular-nums" style={{ color: t.textMuted }}>
                      {clock(a.at)}
                    </span>
                  </div>
                ))}
              </Panel>
            </section>
          ))}
        </div>
      )}

      <p className="text-[11px] px-1 leading-relaxed" style={{ color: t.textMuted }}>
        Structure only in Phase 1. The feed is not yet backed by a data source — Phase 3
        decides whether the existing audit tables can serve it before any new table is considered.
      </p>
    </div>
  );
}
