"use client";

// components/superadmin/SystemUpdatesView.tsx — Super Admin → System Updates.
//
// The one screen from which CRM-wide announcements are written and published.
// Nothing here is tenant-scoped, because an announcement is not a tenant's: it
// is one canonical row (`crm_updates`) that every organization's users read.
//
// ── Two renderings, one dataset ─────────────────────────────────────────────
// A table from `lg` up and a stacked card list below it, matching Organizations
// and Users. This is not a table with columns hidden by CSS — on a tablet the
// eight columns the brief asks for would either overflow the panel or squeeze
// the action buttons off the end, and the brief is explicit that critical
// controls must not overflow horizontally. So narrow screens get cards where
// every action is a full-size target.
//
// ── Preview is the real renderer ────────────────────────────────────────────
// "View" does not show a summary; it renders the announcement through the SAME
// component the CRM modal uses (UpdatePreview → Markdown). What the operator
// sees before publishing is what users see after.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";
import { Panel, SearchField, Segmented, StatusPill, EmptyState, fmtDate } from "./ui";
import { ConfirmDialog } from "./dialogs";
import UpdateEditorModal, { type EditableUpdate } from "./UpdateEditorModal";
import UpdatePreviewModal from "./UpdatePreviewModal";

export interface AdminUpdate extends EditableUpdate {
  id: number;
  status: "draft" | "published";
  audienceType: string;
  createdBy: string | null;
  publishedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string | null;
  readCount: number;
}

const FILTERS = ["all", "published", "draft"];

/** The audience column shows a label, not the stored key. */
function audienceLabel(value: string): string {
  if (value === "all_users") return "All Users";
  if (value.startsWith("role:")) return value.slice(5).replace(/\b\w/g, c => c.toUpperCase());
  return value;
}

export default function SystemUpdatesView({ t }: { t: SuperAdminTheme }) {
  const [rows, setRows] = useState<AdminUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  const [editing, setEditing] = useState<AdminUpdate | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState<AdminUpdate | null>(null);
  const [confirming, setConfirming] = useState<{ row: AdminUpdate; next: "publish" | "unpublish" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/platform/updates");
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not load system updates.");
      setRows(json.data as AdminUpdate[]);
    } catch (e: any) {
      setError(e?.message || "Could not load system updates.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Success messages clear themselves; errors do not, because an error is
  // something the operator has to act on.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!needle) return true;
      return `${r.version} ${r.title} ${r.type ?? ""}`.toLowerCase().includes(needle);
    });
  }, [rows, q, filter]);

  async function applyStatus(row: AdminUpdate, next: "publish" | "unpublish") {
    setBusy(true);
    setActionError("");
    try {
      const res = await fetch(`/api/platform/updates/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not change the status.");
      setConfirming(null);
      setToast(json.message);
      // Refetch rather than patching the row locally: the server owns
      // published_at and published_by, and a locally-built row would be a guess.
      await load();
    } catch (e: any) {
      setActionError(e?.message || "Could not change the status.");
    } finally {
      setBusy(false);
    }
  }

  const typePill = (type: string | null) => (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ color: t.info, background: tint(t.info, 0.12) }}
    >
      {type || "Update"}
    </span>
  );

  const actionRow = (r: AdminUpdate, block = false) => (
    <div className={`flex items-center gap-1.5 ${block ? "flex-wrap" : "justify-end"}`}>
      <button
        onClick={() => setPreviewing(r)}
        className="px-2.5 py-1 rounded-lg text-[12px] font-medium"
        style={{ color: t.text, background: t.raised }}
      >
        View
      </button>
      <button
        onClick={() => setEditing(r)}
        className="px-2.5 py-1 rounded-lg text-[12px] font-medium"
        style={{ color: t.text, background: t.raised }}
      >
        Edit
      </button>
      {r.status === "published" ? (
        <button
          onClick={() => { setActionError(""); setConfirming({ row: r, next: "unpublish" }); }}
          className="px-2.5 py-1 rounded-lg text-[12px] font-medium"
          style={{ color: t.warning, background: tint(t.warning, 0.12) }}
        >
          Unpublish
        </button>
      ) : (
        <button
          onClick={() => { setActionError(""); setConfirming({ row: r, next: "publish" }); }}
          className="px-2.5 py-1 rounded-lg text-[12px] font-medium"
          style={{ color: t.accent, background: tint(t.accent, 0.12) }}
        >
          Publish
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <SearchField t={t} value={q} onChange={setQ} placeholder="Search version, title or type" />
        <div className="flex items-center gap-3">
          <Segmented t={t} options={FILTERS} value={filter} onChange={setFilter} />
          <span className="hidden lg:block text-[12px] whitespace-nowrap tabular-nums" style={{ color: t.textMuted }}>
            {filtered.length} of {rows.length}
          </span>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap flex-shrink-0 transition-opacity hover:opacity-90"
            style={{ background: t.accent, color: "#fff" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="hidden sm:inline">Create Update</span>
            <span className="sm:hidden">Create</span>
          </button>
        </div>
      </div>

      {toast && (
        <div
          className="rounded-2xl px-4 py-3 text-[13px]"
          style={{ color: t.positive, background: tint(t.positive, 0.1), border: `1px solid ${tint(t.positive, 0.28)}` }}
        >
          {toast}
        </div>
      )}

      {error ? (
        <Panel t={t}>
          <div className="px-5 py-8 text-center">
            <p className="text-[13px] font-medium" style={{ color: t.danger }}>{error}</p>
            <button
              onClick={load}
              className="mt-4 px-4 py-2 rounded-full text-[13px] font-medium"
              style={{ background: t.accent, color: "#fff" }}
            >
              Try again
            </button>
          </div>
        </Panel>
      ) : loading ? (
        <div className="h-64 rounded-2xl animate-pulse" style={{ background: t.surface }} />
      ) : filtered.length === 0 ? (
        <Panel t={t}>
          <EmptyState
            t={t}
            title={rows.length === 0 ? "No system updates yet" : "No updates match"}
            sub={
              rows.length === 0
                ? "Create one to announce a release across every organization."
                : "Try a different search or status filter."
            }
          />
        </Panel>
      ) : (
        <>
          {/* ── Table: lg and up ── */}
          <Panel t={t} className="hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ background: t.raised }}>
                    {["Version", "Title", "Type", "Status", "Audience", "Published", "Created By", ""].map((h, i) => (
                      <th
                        key={h || i}
                        className="text-left text-[11px] font-medium uppercase tracking-[0.06em] px-4 py-2.5"
                        style={{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${t.border}` }}>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-md whitespace-nowrap" style={{ color: t.text, background: t.raised }}>
                          {r.version}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[13px] font-medium" style={{ color: t.text }}>{r.title}</span>
                        {r.isImportant && (
                          <span className="ml-2 text-[10px] font-semibold" style={{ color: t.danger }}>IMPORTANT</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{typePill(r.type)}</td>
                      <td className="px-4 py-3"><StatusPill status={r.status} t={t} /></td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>{audienceLabel(r.audienceType)}</td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>
                        {r.status === "published" ? fmtDate(r.publishedAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-[12px]" style={{ color: t.textMuted }}>{r.createdBy ?? "—"}</td>
                      <td className="px-4 py-3">{actionRow(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Cards: below lg ── */}
          <div className="lg:hidden space-y-2.5">
            {filtered.map(r => (
              <div
                key={r.id}
                className="rounded-2xl px-4 py-3.5"
                style={{ background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-md" style={{ color: t.text, background: t.raised }}>
                        {r.version}
                      </span>
                      {typePill(r.type)}
                    </div>
                    <p className="text-[14px] font-medium mt-2 leading-snug" style={{ color: t.text }}>{r.title}</p>
                  </div>
                  <StatusPill status={r.status} t={t} />
                </div>
                <div className="flex items-center justify-between mt-2.5 pt-2.5 text-[11px]" style={{ borderTop: `1px solid ${t.border}`, color: t.textMuted }}>
                  <span>{audienceLabel(r.audienceType)}</span>
                  <span>{r.status === "published" ? fmtDate(r.publishedAt) : "Draft"}</span>
                </div>
                <div className="mt-3">{actionRow(r, true)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Create / edit ── */}
      <UpdateEditorModal
        open={creating || editing !== null}
        t={t}
        existing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={message => {
          setCreating(false);
          setEditing(null);
          setToast(message);
          load();
        }}
      />

      {/* ── Preview exactly as users will see it ── */}
      <UpdatePreviewModal
        open={previewing !== null}
        t={t}
        update={previewing}
        onClose={() => setPreviewing(null)}
      />

      {/* ── Publish / unpublish ── */}
      <ConfirmDialog
        open={confirming !== null}
        t={t}
        busy={busy}
        error={actionError}
        tone={confirming?.next === "publish" ? "primary" : "danger"}
        title={confirming?.next === "publish" ? "Publish this update?" : "Unpublish this update?"}
        confirmLabel={confirming?.next === "publish" ? "Publish Update" : "Unpublish"}
        onCancel={() => { if (!busy) { setConfirming(null); setActionError(""); } }}
        onConfirm={() => confirming && applyStatus(confirming.row, confirming.next)}
        body={
          confirming?.next === "publish" ? (
            <>
              <strong style={{ color: t.text }}>{confirming?.row.version} — {confirming?.row.title}</strong> will
              appear in System Updates for every CRM user, and will be unread until each of them opens it.
            </>
          ) : (
            <>
              <strong style={{ color: t.text }}>{confirming?.row.version} — {confirming?.row.title}</strong> will
              be removed from the live feed. The record, its publication date and everyone&apos;s read marks are
              kept, so you can publish it again later.
            </>
          )
        }
      />
    </div>
  );
}
