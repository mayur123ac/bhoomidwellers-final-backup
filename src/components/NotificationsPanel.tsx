"use client";
// NotificationsPanel.tsx — the admin view of the WhatsApp notification module.
//
// Two audiences, one screen:
//
//   BEFORE go-live it answers "is this wired up?" — which env vars are missing,
//   which template names Meta must approve, and which Sourcing Managers have no
//   WhatsApp number on file. All of that is visible with no Meta account at all,
//   which is the whole point: the setup can be checked before a single message
//   is sent.
//
//   AFTER go-live it answers "did that alert arrive?" — status, delivery
//   timestamps, retry count and the last error, per notification.
//
// Reads GET /api/notifications, which is admin-gated server-side. This component
// renders what it is given and never decides who may see it.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaWhatsapp,
  FaCheck,
  FaCheckDouble,
  FaExclamationTriangle,
  FaClock,
  FaBan,
  FaSyncAlt,
  FaTimes,
  FaRedo,
} from "react-icons/fa";

interface Props {
  isDark: boolean;
  t: any;
}

type StatusKey =
  | "pending" | "sending" | "sent" | "delivered" | "read"
  | "failed" | "dead" | "skipped";

/** Visual language mirrors NotificationStatus in @/types/whatsapp.types. */
const STATUS_META: Record<
  StatusKey,
  { label: string; icon: any; color: string; bg: string; border: string; hint: string }
> = {
  pending: { label: "Queued", icon: FaClock, color: "#a1a1aa", bg: "rgba(161,161,170,0.12)", border: "rgba(161,161,170,0.30)", hint: "Waiting for its first attempt." },
  sending: { label: "Sending", icon: FaSyncAlt, color: "#38bdf8", bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.30)", hint: "Claimed by a worker right now." },
  sent: { label: "Sent", icon: FaCheck, color: "#38bdf8", bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.30)", hint: "Meta accepted it. Awaiting a delivery receipt." },
  delivered: { label: "Delivered", icon: FaCheckDouble, color: "#34d399", bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.30)", hint: "It reached the recipient's phone." },
  read: { label: "Read", icon: FaCheckDouble, color: "#22c55e", bg: "rgba(34,197,94,0.15)", border: "rgba(34,197,94,0.35)", hint: "The recipient opened it." },
  failed: { label: "Retrying", icon: FaExclamationTriangle, color: "#fb923c", bg: "rgba(251,146,60,0.12)", border: "rgba(251,146,60,0.30)", hint: "An attempt failed. Another is scheduled." },
  dead: { label: "Failed", icon: FaTimes, color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.30)", hint: "Gave up. No further attempts will be made." },
  skipped: { label: "Not sent", icon: FaBan, color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.30)", hint: "Never attempted — see the reason." },
};

/** Turns the machine code into something an operator can act on. */
const REASON_HELP: Record<string, string> = {
  CONFIG_MISSING: "WhatsApp credentials are not set in .env.local yet.",
  DISABLED: "Sending is switched off (WHATSAPP_ENABLED=false).",
  NO_ASSIGNEE: "This record has no Sourcing Manager assigned.",
  MISSING_RECIPIENT: "That manager has no WhatsApp number saved in Settings.",
  INVALID_PHONE: "The saved number is not a usable mobile number.",
  INVALID_TEMPLATE: "Meta rejected the template — check the name, language and parameter count.",
  AUTH_FAILED: "Meta rejected the access token.",
  RATE_LIMITED: "Meta is throttling sends.",
  NETWORK_TIMEOUT: "Meta did not respond in time.",
  NETWORK_ERROR: "Could not reach Meta at all.",
  META_DELIVERY_FAILED: "Meta could not deliver it to that number.",
  STALE_LOCK: "Reclaimed after the server restarted mid-send.",
};

const TYPE_LABEL: Record<string, string> = {
  cp_registration: "Partner registered",
  cp_lead_assigned: "Lead assigned",
  manual: "Manual send",
};

/** "30s → 2m → 10m" reads at a glance; "30s → 120s → 600s" does not. */
function humanDelay(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s % 60 === 0 && s < 3600) return `${s / 60}m`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.round(s / 3600)}h`;
}

function fmt(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export default function NotificationsPanel({ isDark, t }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (statusFilter) qs.set("status", statusFilter);
      if (typeFilter) qs.set("type", typeFilter);
      if (search.trim()) qs.set("q", search.trim());
      const res = await fetch(`/api/notifications?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || `HTTP ${res.status}`);
      setRows(json.data || []);
      setMeta(json.meta || null);
      setTotal(json.total || 0);
    } catch (e: any) {
      setError(e?.message || "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const runSweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch("/api/notifications/retry-sweep", { method: "POST" });
      await res.json();
      await load();
    } catch { /* the panel reload below is the feedback */ }
    finally { setSweeping(false); }
  };

  const cfg = meta?.configuration;
  const counts: Record<string, number> = meta?.counts || {};
  const missingWa: any[] = meta?.managers_missing_whatsapp || [];

  const cardCls = `rounded-2xl border ${isDark ? "bg-[#111118] border-[#26262F]" : "bg-white border-gray-200"}`;
  const labelCls = `text-[10px] font-bold uppercase tracking-[0.09em] ${t.textFaint}`;

  // Ordered so the queue reads left-to-right in lifecycle order.
  const countOrder: StatusKey[] = ["skipped", "pending", "failed", "sent", "delivered", "read", "dead"];

  const blockers = useMemo(() => {
    const out: { text: string; tone: "red" | "amber" }[] = [];
    if (!meta) return out;
    if (meta.table_present === false) {
      out.push({ text: "The notification_logs table does not exist. Run the migration in scripts/migrations/.", tone: "red" });
    }
    if (cfg && !cfg.configured) {
      out.push({ text: `Not configured — missing ${(cfg.missing || []).join(", ")} in .env.local.`, tone: "red" });
    }
    if (cfg?.configured && !cfg.enabled) {
      out.push({ text: "Sending is switched off (WHATSAPP_ENABLED=false).", tone: "amber" });
    }
    if (cfg?.signatureVerification === "disabled") {
      out.push({ text: "WHATSAPP_APP_SECRET is not set — webhook signatures are not verified, so delivery receipts can be forged.", tone: "amber" });
    }
    if (missingWa.length > 0) {
      out.push({
        text: `${missingWa.length} Sourcing Manager${missingWa.length > 1 ? "s have" : " has"} no WhatsApp number: ${missingWa.map((m) => m.name).join(", ")}. They cannot receive alerts.`,
        tone: "amber",
      });
    }
    return out;
  }, [meta, cfg, missingWa]);

  return (
    <main className={`flex-1 overflow-y-auto p-6 md:p-8 ${t.scroll} custom-scrollbar`}>
      <div className="max-w-[1400px] mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className={`text-xl font-black tracking-tight flex items-center gap-2.5 ${isDark ? "text-white" : "text-gray-900"}`}>
              <FaWhatsapp className="text-[#25D366]" /> WhatsApp Notifications
            </h2>
            <p className={`text-xs mt-1 ${t.textFaint}`}>
              Outbound alerts to Sourcing Managers. This is a send-only log — replies are not shown here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runSweep}
              disabled={sweeping || !cfg?.configured}
              title={!cfg?.configured ? "Configure WhatsApp first" : "Retry everything that is due now"}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${sweeping || !cfg?.configured
                  ? "opacity-40 cursor-not-allowed bg-gray-500 text-white"
                  : isDark ? "bg-[#9E217B] hover:bg-[#b8268f] text-white" : "bg-[#00AEEF] hover:bg-[#0099d4] text-white"
                }`}
            >
              <FaRedo className={sweeping ? "animate-spin" : ""} /> {sweeping ? "Running…" : "Run retries"}
            </button>
            <button
              onClick={load}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${t.btnSecondary}`}
            >
              <FaSyncAlt className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        {/* ── Blockers ───────────────────────────────────────────────── */}
        {blockers.length > 0 && (
          <div className="space-y-2">
            {blockers.map((b, i) => (
              <div
                key={i}
                className="rounded-xl px-4 py-3 text-xs font-medium flex items-start gap-2.5"
                style={{
                  background: b.tone === "red" ? "rgba(248,113,113,0.10)" : "rgba(251,146,60,0.10)",
                  border: `1px solid ${b.tone === "red" ? "rgba(248,113,113,0.30)" : "rgba(251,146,60,0.30)"}`,
                  color: b.tone === "red" ? "#f87171" : "#fb923c",
                }}
              >
                <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
                <span>{b.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Status counts ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {countOrder.map((k) => {
            const m = STATUS_META[k];
            const n = counts[k] ?? 0;
            const active = statusFilter === k;
            return (
              <button
                key={k}
                onClick={() => setStatusFilter(active ? "" : k)}
                title={m.hint}
                className={`${cardCls} p-3 text-left transition-all hover:-translate-y-0.5`}
                style={active ? { borderColor: m.border, background: m.bg } : undefined}
              >
                <div className="flex items-center gap-1.5">
                  <m.icon style={{ color: m.color }} className="text-[11px]" />
                  <span className={labelCls}>{m.label}</span>
                </div>
                <p className={`text-2xl font-black mt-1 ${isDark ? "text-white" : "text-gray-900"}`}>{n}</p>
              </button>
            );
          })}
        </div>

        {/* ── Setup / readiness ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${cardCls} p-5`}>
            <p className={`${labelCls} mb-3`}>Configuration</p>
            <div className="space-y-2 text-xs">
              <Row label="Status" value={
                cfg?.configured
                  ? <span className="text-emerald-400 font-bold">Configured</span>
                  : <span className="text-red-400 font-bold">Not configured</span>
              } t={t} />
              <Row label="API version" value={cfg?.apiVersion ?? "—"} t={t} />
              <Row label="Phone number ID" value={cfg?.phoneNumberId || "—"} t={t} />
              <Row label="Template language" value={cfg?.templateLanguage ?? "—"} t={t} />
              <Row label="Webhook signatures" value={
                cfg?.signatureVerification === "enforced"
                  ? <span className="text-emerald-400 font-bold">Enforced</span>
                  : <span className="text-orange-400 font-bold">Disabled</span>
              } t={t} />
              <Row label="Retry ladder" value={
                (cfg?.retryDelaysMs || []).map(humanDelay).join(" → ") || "—"
              } t={t} />
              <Row label="Due for retry now" value={String(meta?.due_now ?? 0)} t={t} />
            </div>
          </div>

          <div className={`${cardCls} p-5`}>
            <p className={`${labelCls} mb-3`}>Templates Meta must approve</p>
            <div className="space-y-2">
              {(meta?.templates || []).map((tpl: any) => (
                <div
                  key={tpl.key}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 ${isDark ? "bg-[#0d0d13]" : "bg-gray-50"}`}
                >
                  <div>
                    <p className={`text-xs font-bold ${isDark ? "text-gray-200" : "text-gray-800"}`}>{tpl.name}</p>
                    <p className={`text-[10px] ${t.textFaint}`}>{TYPE_LABEL[tpl.key] || tpl.key}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${isDark ? "bg-white/5 text-gray-400" : "bg-gray-200 text-gray-600"}`}>
                    {tpl.paramCount} params
                  </span>
                </div>
              ))}
            </div>
            <p className={`text-[10px] mt-3 leading-relaxed ${t.textFaint}`}>
              Category UTILITY, language {cfg?.templateLanguage ?? "en_US"}. The exact body text to submit is in
              <code className="mx-1 px-1 rounded bg-black/20">src/templates/channel-partner.template.ts</code>.
              Parameter order is frozen once Meta approves.
            </p>
          </div>
        </div>

        {/* ── Filters ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipient, number or subject…"
            className={`flex-1 min-w-[220px] rounded-lg px-3 py-2 text-xs outline-none border ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white" : "bg-white border-gray-300 text-gray-900"
              }`}
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={`rounded-lg px-3 py-2 text-xs outline-none border ${isDark ? "bg-[#14141B] border-[#2A2A35] text-white" : "bg-white border-gray-300 text-gray-900"
              }`}
          >
            <option value="">All events</option>
            <option value="cp_registration">Partner registered</option>
            <option value="cp_lead_assigned">Lead assigned</option>
            <option value="manual">Manual send</option>
          </select>
          {(statusFilter || typeFilter || search) && (
            <button onClick={() => { setStatusFilter(""); setTypeFilter(""); setSearch(""); }}
              className={`text-xs font-bold px-3 py-2 rounded-lg ${t.btnSecondary}`}>
              Clear
            </button>
          )}
          <span className={`text-[11px] ${t.textFaint}`}>{total} total</span>
        </div>

        {/* ── Table ──────────────────────────────────────────────────── */}
        <div className={`${cardCls} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead className={`${t.tableHead} ${t.textHeader}`}>
                <tr>
                  {["Status", "Event", "Recipient", "About", "Sent", "Delivered", "Read", "Tries"].map((h) => (
                    <th key={h} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-[0.09em] whitespace-nowrap border-b ${isDark ? "border-[#26262F]" : "border-gray-200"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className={`px-4 py-12 text-center text-xs ${t.textFaint}`}>Loading…</td></tr>
                ) : error ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-xs text-red-400">{error}</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={`px-4 py-12 text-center text-xs ${t.textFaint}`}>
                      No notifications yet. Register a Channel Partner with a Sourcing Manager assigned,
                      and a row will appear here — even before WhatsApp is configured.
                    </td>
                  </tr>
                ) : rows.map((r) => {
                  const m = STATUS_META[r.status as StatusKey] ?? STATUS_META.pending;
                  const isOpen = expanded === r.id;
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className={`cursor-pointer transition-colors ${t.tableRow} ${isDark ? "border-b border-[#1E1E27]" : "border-b border-gray-100"}`}
                      >
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap"
                            style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.color }}
                          >
                            <m.icon className="text-[9px]" /> {m.label}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                          {TYPE_LABEL[r.type] || r.type}
                        </td>
                        <td className="px-4 py-3">
                          <p className={`text-xs font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}>{r.receiver || "—"}</p>
                          <p className={`text-[10px] ${t.textFaint}`}>{r.receiver_phone || "no number"}</p>
                        </td>
                        <td className={`px-4 py-3 text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                          {r.subject_name || "—"}
                        </td>
                        <td className={`px-4 py-3 text-[11px] whitespace-nowrap ${t.textFaint}`}>{fmt(r.sent_at)}</td>
                        <td className={`px-4 py-3 text-[11px] whitespace-nowrap ${t.textFaint}`}>{fmt(r.delivered_at)}</td>
                        <td className={`px-4 py-3 text-[11px] whitespace-nowrap ${t.textFaint}`}>{fmt(r.read_at)}</td>
                        <td className={`px-4 py-3 text-[11px] ${t.textFaint}`}>
                          {r.retry_count}/{r.max_retries}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className={isDark ? "bg-[#0d0d13]" : "bg-gray-50"}>
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              <div className="space-y-1.5">
                                <Row label="Why" value={
                                  r.last_error_code
                                    ? (REASON_HELP[r.last_error_code] || r.last_error_code)
                                    : m.hint
                                } t={t} />
                                <Row label="Template" value={r.template_name || "—"} t={t} />
                                <Row label="Created" value={fmt(r.created_at)} t={t} />
                                {r.next_retry_at && <Row label="Next attempt" value={fmt(r.next_retry_at)} t={t} />}
                              </div>
                              <div className="space-y-1.5">
                                <Row label="Message ID" value={r.message_id || "—"} t={t} />
                                <Row label="Failed at" value={fmt(r.failed_at)} t={t} />
                                {r.last_error && (
                                  <div>
                                    <p className={labelCls}>Raw error</p>
                                    <p className={`mt-1 font-mono text-[10px] leading-relaxed break-all ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                                      {r.last_error}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className={`text-[10px] text-center pb-4 ${t.textFaint}`}>
          Rows appear here whether or not WhatsApp is configured. A “Not sent” row before go-live is expected —
          it records the recipient and the exact message that would have been sent.
        </p>
      </div>
    </main>
  );
}

function Row({ label, value, t }: { label: string; value: React.ReactNode; t: any }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className={`text-[11px] ${t.textFaint}`}>{label}</span>
      <span className={`text-[11px] font-semibold text-right ${t.text}`}>{value}</span>
    </div>
  );
}
