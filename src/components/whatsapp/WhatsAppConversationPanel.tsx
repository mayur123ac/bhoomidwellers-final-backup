// components/whatsapp/WhatsAppConversationPanel.tsx
//
// The embedded conversation panel that replaces the "Open WhatsApp" modal.
//
// ── Layout (spec §11) ───────────────────────────────────────────────────────
//   left    conversation list, with unread badges
//   centre  the thread
//   right   lead details and follow-up context
//
// Below `lg` the side columns collapse and the list becomes a back-navigable
// step, because three columns on a phone gives each about 120px.
//
// ── Theme ───────────────────────────────────────────────────────────────────
// Every colour comes from buildTheme() in lib/crmTheme.ts — the same tokens the
// Receptionist and Sourcing panels use. Nothing here introduces a new palette;
// the magenta is theme.btnSecondary/sectionTitle, and outbound bubbles use the
// accent rather than WhatsApp's own green, because this is a CRM panel and not a
// WhatsApp skin.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWhatsAppSync } from "@/lib/hooks/useWhatsAppSync";

// ── types ──────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: number;
  leadId: number | null;
  leadName: string | null;
  leadPhone: string | null;
  customerPhone: string;
  customerProfileName: string | null;
  matchState: "matched" | "unmatched" | "ambiguous";
  candidateLeadIds: number[];
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  assignedTo: string | null;
  leadStatus: string | null;
  followUpDate: string | null;
  leadIsLost: boolean;
  window: { open: boolean; expiresAt: string | null };
}

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderName: string | null;
  senderRole: string | null;
  messageType: string;
  messageText: string | null;
  templateName: string | null;
  status: "sending" | "sent" | "delivered" | "read" | "failed" | "received";
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

interface Props {
  theme: any;
  isDark: boolean;
  /** Open straight into this lead's thread. */
  initialLeadId?: number | null;
  onClose: () => void;
}

// ── helpers ────────────────────────────────────────────────────────────────

const timeOf = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

const displayName = (c: ConversationSummary) =>
  c.leadName || c.customerProfileName || c.customerPhone;

/**
 * Delivery ticks.
 *
 * One tick sent, two delivered, two blue read — the convention every WhatsApp
 * user already reads without being taught. 'sending' gets a clock rather than a
 * tick, because a tick would claim something that has not happened yet.
 */
function StatusTick({ status, isDark }: { status: string; isDark: boolean }) {
  if (status === "sending") {
    return <span className="opacity-60" title="Sending…">🕐</span>;
  }
  if (status === "failed") {
    return <span className="text-red-500" title="Failed to send">⚠</span>;
  }

  const read = status === "read";
  const double = status === "delivered" || read;
  const colour = read ? (isDark ? "#4FC3F7" : "#0288D1") : "currentColor";

  return (
    <span
      className={read ? "" : "opacity-70"}
      style={{ color: colour }}
      title={status.charAt(0).toUpperCase() + status.slice(1)}
    >
      <svg viewBox="0 0 18 12" width="16" height="11" fill="none" aria-hidden="true">
        <path
          d={double ? "M1 6.5L4.2 9.7L9.6 2.5" : "M3 6.5L6.2 9.7L11.6 2.5"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {double && (
          <path
            d="M7.4 6.5L10.6 9.7L16 2.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span className="sr-only">{status}</span>
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════

export default function WhatsAppConversationPanel({
  theme,
  isDark,
  initialLeadId,
  onClose,
}: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [detail, setDetail] = useState<any>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "needs_review">("all");
  const [connected, setConnected] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  // ── data ─────────────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filter !== "all") qs.set("filter", filter);
    if (search.trim()) qs.set("q", search.trim());
    try {
      const res = await fetch(`/api/whatsapp/conversations?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) setConversations(json.data);
    } finally {
      setLoadingList(false);
    }
  }, [filter, search]);

  const loadThread = useCallback(async (id: number) => {
    setLoadingThread(true);
    try {
      const res = await fetch(`/api/whatsapp/conversations/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setDetail(json.data);
        setMessages(json.data.messages);
      }
    } finally {
      setLoadingThread(false);
    }
  }, []);

  // Clearing the badge is a side effect of reading, so it is fired here rather
  // than from a button. Idempotent server-side, so a remount costs nothing.
  const markRead = useCallback(async (id: number) => {
    await fetch(`/api/whatsapp/conversations/${id}/read`, { method: "POST" });
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
    );
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Opening from a lead: create the thread if the customer has never written.
  useEffect(() => {
    if (!initialLeadId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/whatsapp/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: initialLeadId }),
      });
      const json = await res.json();
      if (cancelled) return;
      if (json.success) {
        setActiveId(json.data.id);
        setMobileView("thread");
      } else {
        setBanner(json.message ?? "Could not open this conversation.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialLeadId]);

  useEffect(() => {
    if (activeId == null) return;
    loadThread(activeId);
    markRead(activeId);
  }, [activeId, loadThread, markRead]);

  // Pin to the bottom on new messages, the way a chat is expected to behave.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ── realtime (spec §7) ───────────────────────────────────────────────────

  useWhatsAppSync({
    onConnectionChange: setConnected,

    onMessage: (e) => {
      // Update the open thread.
      if (e.conversationId === activeIdRef.current) {
        setMessages((prev) => {
          // The sender's own echo of an optimistic send arrives here too.
          if (prev.some((m) => String(m.id) === String(e.message.id))) return prev;
          return [...prev, normalizeMessage(e.message)];
        });
        // Reading it as it arrives is what "no refresh" means; the badge must
        // not appear on a thread the employee is looking at.
        markRead(e.conversationId);
      }

      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === e.conversationId);
        const inbound = e.message?.direction === "inbound";
        if (idx === -1) {
          // A thread that was not in the list — a new customer, or one that has
          // just become visible. Refetch rather than invent a row.
          loadList();
          return prev;
        }
        const updated: ConversationSummary = {
          ...prev[idx],
          lastMessagePreview:
            e.message?.message_text ?? e.message?.messageText ?? prev[idx].lastMessagePreview,
          lastMessageAt: e.message?.created_at ?? e.message?.createdAt ?? new Date().toISOString(),
          lastMessageDirection: inbound ? "inbound" : "outbound",
          unreadCount:
            e.conversationId === activeIdRef.current ? 0 : (e.unreadCount ?? prev[idx].unreadCount),
        };
        // Newest first, matching the server's ORDER BY.
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    },

    onStatus: (e) => {
      if (e.conversationId !== activeIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id) === String(e.messageId)
            ? {
                ...m,
                status: e.status as ConversationMessage["status"],
                deliveredAt: e.deliveredAt ?? m.deliveredAt,
                readAt: e.readAt ?? m.readAt,
                errorCode: e.errorCode ?? m.errorCode,
                errorMessage: e.errorMessage ?? m.errorMessage,
              }
            : m
        )
      );
    },

    onConversation: (e) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === e.conversationId
            ? {
                ...c,
                unreadCount: e.unreadCount,
                matchState: (e.matchState as any) ?? c.matchState,
                // Omitted fields mean "unchanged" — a mark-read event carries no
                // new message, and writing null here would blank the preview.
                lastMessagePreview:
                  e.lastMessagePreview !== undefined
                    ? e.lastMessagePreview
                    : c.lastMessagePreview,
                lastMessageAt:
                  e.lastMessageAt !== undefined ? e.lastMessageAt : c.lastMessageAt,
              }
            : c
        )
      );
    },
  });

  // ── sending (spec §12) ───────────────────────────────────────────────────

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || activeId == null) return;

    setSending(true);
    setBanner(null);

    // Idempotency key: a double-click or a retry over a flaky connection reuses
    // it, and the server returns the original message rather than sending twice.
    const clientToken =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const res = await fetch(`/api/whatsapp/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, clientToken }),
      });
      const json = await res.json();

      // The route returns the message row on failure too, so a failed send is a
      // visible, retryable bubble rather than a lost draft.
      if (json.data) {
        setMessages((prev) => {
          if (prev.some((m) => String(m.id) === String(json.data.id))) return prev;
          return [...prev, normalizeMessage(json.data)];
        });
        setDraft("");
      }

      if (!json.success) {
        setBanner(json.message ?? "Message could not be sent.");
        // The window may have closed since the thread was loaded.
        if (json.window) setDetail((d: any) => (d ? { ...d, window: json.window } : d));
      }
    } catch {
      setBanner("Network error — the message was not sent. Check your connection and retry.");
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  }, [draft, sending, activeId]);

  const retry = useCallback(async (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, status: "sending" } : m))
    );
    const res = await fetch(`/api/whatsapp/messages/${messageId}/retry`, { method: "POST" });
    const json = await res.json();
    if (json.data) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? normalizeMessage(json.data) : m))
      );
    }
    if (!json.success) setBanner(json.message ?? "Retry failed.");
  }, []);

  const associate = useCallback(
    async (leadId: number) => {
      if (activeId == null) return;
      const res = await fetch(`/api/whatsapp/conversations/${activeId}/associate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const json = await res.json();
      if (json.success) {
        await loadThread(activeId);
        await loadList();
      } else {
        setBanner(json.message ?? "Could not link this conversation.");
      }
    },
    [activeId, loadThread, loadList]
  );

  /** Enter sends, Shift+Enter makes a new line (spec §2). */
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── derived ──────────────────────────────────────────────────────────────

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  const totalUnread = useMemo(
    () => conversations.reduce((n, c) => n + c.unreadCount, 0),
    [conversations]
  );

  const windowOpen = detail?.window?.open ?? false;
  const canType = activeId != null && windowOpen;

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-4">
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-none border sm:h-[92vh] sm:max-w-[1400px] sm:rounded-2xl ${theme.modalCard}`}
        style={theme.modalGlass}
      >
        {/* ── header ───────────────────────────────────────────────────── */}
        <div
          className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 ${theme.modalHeader} ${theme.tableBorder}`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${theme.logoBg}`}>
              <WhatsAppGlyph />
            </div>
            <div className="min-w-0">
              <h2 className={`truncate text-base font-semibold ${theme.text}`}>
                WhatsApp Conversations
              </h2>
              <p className={`truncate text-xs ${theme.textMuted}`}>
                {totalUnread > 0 ? `${totalUnread} unread` : "All caught up"}
                <span className="mx-1.5">·</span>
                <span
                  className={connected ? "text-emerald-500" : "text-amber-500"}
                  title={
                    connected
                      ? "Live — new messages appear automatically"
                      : "Reconnecting… messages will appear once the connection returns"
                  }
                >
                  {connected ? "● Live" : "● Reconnecting"}
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className={`rounded-lg px-2.5 py-1 text-xl leading-none ${theme.textMuted} hover:${theme.text}`}
          >
            ✕
          </button>
        </div>

        {banner && (
          <div className="shrink-0 border-b border-amber-400/40 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-start justify-between gap-3">
              <span>{banner}</span>
              <button onClick={() => setBanner(null)} className="shrink-0 opacity-60 hover:opacity-100">
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── three panes ──────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1">
          {/* LEFT — list */}
          <aside
            className={`${mobileView === "list" ? "flex" : "hidden"} w-full shrink-0 flex-col border-r lg:flex lg:w-[320px] ${theme.tableBorder} ${theme.modalInner}`}
          >
            <div className={`shrink-0 space-y-2 border-b p-3 ${theme.tableBorder}`}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or number"
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${theme.modalInput} ${theme.text} ${theme.inputFocus}`}
              />
              <div className="flex gap-1.5">
                {(["all", "unread", "needs_review"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      filter === f ? theme.btnSecondary : `${theme.textMuted} hover:${theme.text}`
                    }`}
                  >
                    {f === "all" ? "All" : f === "unread" ? "Unread" : "Needs review"}
                  </button>
                ))}
              </div>
            </div>

            <div className={`min-h-0 flex-1 overflow-y-auto ${theme.scroll}`}>
              {loadingList ? (
                <p className={`p-4 text-sm ${theme.textMuted}`}>Loading…</p>
              ) : conversations.length === 0 ? (
                <p className={`p-4 text-sm ${theme.textMuted}`}>
                  {filter === "needs_review"
                    ? "No conversations are waiting to be linked."
                    : filter === "unread"
                      ? "No unread conversations."
                      : "No WhatsApp conversations yet."}
                </p>
              ) : (
                conversations.map((c) => {
                  const isActive = c.id === activeId;
                  const unread = c.unreadCount > 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setActiveId(c.id);
                        setMobileView("thread");
                      }}
                      className={`w-full border-b px-3 py-3 text-left transition-colors ${theme.tableBorder} ${
                        isActive ? theme.navActive : theme.tableRow
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`truncate text-sm ${unread ? "font-bold" : "font-medium"} ${theme.text}`}
                        >
                          {displayName(c)}
                        </span>
                        <span className={`shrink-0 text-[11px] ${theme.textFaint}`}>
                          {relativeTime(c.lastMessageAt)}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-xs ${unread ? `font-semibold ${theme.text}` : theme.textMuted}`}
                        >
                          {c.lastMessageDirection === "outbound" && (
                            <span className={theme.textFaint}>You: </span>
                          )}
                          {c.lastMessagePreview ?? "No messages yet"}
                        </span>
                        {unread && (
                          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#9E217B] px-1.5 text-[11px] font-bold text-white">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>

                      {c.matchState !== "matched" && (
                        <span className="mt-1.5 inline-block rounded border border-amber-400/50 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          {c.matchState === "ambiguous"
                            ? `${c.candidateLeadIds?.length ?? 0} matching leads`
                            : "Unlinked"}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* CENTRE — thread */}
          <section
            className={`${mobileView === "thread" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex ${theme.chatArea}`}
          >
            {activeId == null ? (
              <div className={`flex flex-1 items-center justify-center p-8 text-center text-sm ${theme.textMuted}`}>
                Select a conversation to view its history.
              </div>
            ) : (
              <>
                <div
                  className={`flex shrink-0 items-center gap-3 border-b px-4 py-2.5 ${theme.tableBorder} ${theme.modalHeader}`}
                >
                  <button
                    onClick={() => setMobileView("list")}
                    className={`lg:hidden ${theme.textMuted}`}
                    aria-label="Back to list"
                  >
                    ←
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${theme.text}`}>
                      {detail?.leadName || detail?.customerProfileName || detail?.customerPhone}
                      {detail?.leadId && (
                        <span className={`ml-2 text-xs font-normal ${theme.textFaint}`}>
                          Lead #{detail.leadId}
                        </span>
                      )}
                    </p>
                    <p className={`truncate text-xs ${theme.textMuted}`}>{detail?.customerPhone}</p>
                  </div>
                </div>

                <div ref={scrollRef} className={`min-h-0 flex-1 space-y-1 overflow-y-auto p-4 ${theme.scroll}`}>
                  {loadingThread ? (
                    <p className={`text-sm ${theme.textMuted}`}>Loading conversation…</p>
                  ) : messages.length === 0 ? (
                    <p className={`py-8 text-center text-sm ${theme.textMuted}`}>
                      No messages yet. Start the conversation below.
                    </p>
                  ) : (
                    messages.map((m, i) => {
                      const prev = messages[i - 1];
                      const newDay =
                        !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                      return (
                        <div key={m.id}>
                          {newDay && (
                            <div className="my-3 flex justify-center">
                              <span
                                className={`rounded-full px-3 py-0.5 text-[11px] ${theme.settingsBg} ${theme.textMuted}`}
                              >
                                {dayLabel(m.createdAt)}
                              </span>
                            </div>
                          )}
                          <MessageBubble
                            message={m}
                            theme={theme}
                            isDark={isDark}
                            onRetry={() => retry(m.id)}
                          />
                        </div>
                      );
                    })
                  )}
                </div>

                {/* composer */}
                <div className={`shrink-0 border-t p-3 ${theme.tableBorder} ${theme.modalHeader}`}>
                  {!windowOpen && (
                    <div
                      className={`mb-2 rounded-lg border px-3 py-2 text-xs ${theme.settingsBg} ${theme.textMuted}`}
                    >
                      <strong className={theme.text}>The 24-hour reply window is closed.</strong>{" "}
                      WhatsApp only allows free-form messages within 24 hours of the customer&apos;s
                      last message. Send an approved template to reach them.
                      {detail?.matchState !== "matched" && " Link this conversation to a lead first."}
                    </div>
                  )}

                  <div className={`flex items-end gap-2 rounded-xl p-2 ${theme.chatInput}`}>
                    <textarea
                      ref={composerRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onComposerKeyDown}
                      disabled={!canType || sending}
                      rows={1}
                      maxLength={4096}
                      placeholder={
                        canType ? "Type your message…  (Enter to send, Shift+Enter for a new line)"
                          : "Replies are only possible inside the 24-hour window"
                      }
                      className={`max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none disabled:opacity-50 ${theme.text}`}
                      style={{ fieldSizing: "content" } as any}
                    />
                    <button
                      onClick={send}
                      disabled={!canType || sending || !draft.trim()}
                      className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${theme.btnSecondary}`}
                    >
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* RIGHT — lead details */}
          <aside
            className={`hidden w-[300px] shrink-0 flex-col overflow-y-auto border-l xl:flex ${theme.tableBorder} ${theme.modalInner} ${theme.scroll}`}
          >
            {detail ? (
              <div className="space-y-4 p-4">
                <div>
                  <h3 className={`mb-2 text-xs font-bold uppercase tracking-wide ${theme.sectionTitle}`}>
                    Contact
                  </h3>
                  <dl className="space-y-1.5 text-sm">
                    <Row theme={theme} label="Name" value={detail.leadName || detail.customerProfileName || "—"} />
                    <Row theme={theme} label="WhatsApp" value={detail.customerPhone} />
                    {detail.leadPhone && detail.leadPhone !== detail.customerPhone && (
                      <Row theme={theme} label="Lead phone" value={detail.leadPhone} />
                    )}
                  </dl>
                </div>

                {detail.leadId ? (
                  <div>
                    <h3 className={`mb-2 text-xs font-bold uppercase tracking-wide ${theme.sectionTitle}`}>
                      Lead
                    </h3>
                    <dl className="space-y-1.5 text-sm">
                      <Row theme={theme} label="Lead ID" value={`#${detail.leadId}`} />
                      <Row theme={theme} label="Assigned to" value={detail.assignedTo || "Unassigned"} />
                      {active?.leadStatus && <Row theme={theme} label="Status" value={active.leadStatus} />}
                      {active?.followUpDate && (
                        <Row theme={theme} label="Follow-up" value={active.followUpDate} />
                      )}
                    </dl>
                  </div>
                ) : (
                  <div>
                    <h3 className={`mb-2 text-xs font-bold uppercase tracking-wide ${theme.sectionTitle}`}>
                      Not linked to a lead
                    </h3>
                    <p className={`mb-3 text-xs ${theme.textMuted}`}>
                      {detail.matchState === "ambiguous"
                        ? "More than one lead has this number, so it has not been linked automatically. Choose the right one."
                        : "No lead has this number."}
                    </p>

                    {detail.canAssociate ? (
                      detail.candidates?.length > 0 ? (
                        <ul className="space-y-2">
                          {detail.candidates.map((c: any) => (
                            <li key={c.id} className={`rounded-lg border p-2.5 ${theme.modalBlock}`}>
                              <p className={`text-sm font-medium ${theme.text}`}>
                                {c.name}
                                {c.isLost && (
                                  <span className="ml-1.5 text-[10px] text-red-500">LOST</span>
                                )}
                              </p>
                              <p className={`text-xs ${theme.textMuted}`}>
                                #{c.id} · {c.assignedTo || "Unassigned"} · {c.status}
                              </p>
                              <button
                                onClick={() => associate(c.id)}
                                className={`mt-2 w-full rounded-md px-2 py-1 text-xs font-medium ${theme.btnPrimary}`}
                              >
                                Link to this lead
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={`text-xs ${theme.textMuted}`}>
                          No candidate leads. Create the lead first, then reopen this conversation —
                          it will link itself automatically.
                        </p>
                      )
                    ) : (
                      <p className={`text-xs ${theme.textMuted}`}>
                        An admin or site head can link this conversation to a lead.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <h3 className={`mb-2 text-xs font-bold uppercase tracking-wide ${theme.sectionTitle}`}>
                    Reply window
                  </h3>
                  <p className={`text-xs ${theme.textMuted}`}>
                    {detail.window?.open ? (
                      <>
                        Open until{" "}
                        <span className={theme.text}>
                          {new Date(detail.window.expiresAt).toLocaleString([], {
                            day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                          })}
                        </span>
                      </>
                    ) : (
                      "Closed — an approved template is required."
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <p className={`p-4 text-sm ${theme.textMuted}`}>No conversation selected.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────

function Row({ theme, label, value }: { theme: any; label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className={`shrink-0 text-xs ${theme.textFaint}`}>{label}</dt>
      <dd className={`truncate text-right text-xs ${theme.text}`}>{value}</dd>
    </div>
  );
}

function MessageBubble({
  message: m,
  theme,
  isDark,
  onRetry,
}: {
  message: ConversationMessage;
  theme: any;
  isDark: boolean;
  onRetry: () => void;
}) {
  const outbound = m.direction === "outbound";
  const failed = m.status === "failed";

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"} py-0.5`}>
      <div className={`max-w-[78%] min-w-[100px] ${outbound ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-3 py-2 ${
            outbound
              ? failed
                ? "border border-red-400/50 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100"
                : isDark
                  ? "bg-[#9E217B] text-white"
                  : "bg-[#00AEEF] text-white"
              : theme.chatBubbleAi
          } ${outbound ? "rounded-br-md" : "rounded-bl-md"}`}
        >
          {outbound && m.senderName && (
            <p className="mb-0.5 text-[11px] font-semibold opacity-80">
              {m.senderName}
              {m.senderRole ? ` · ${m.senderRole}` : ""}
            </p>
          )}

          {m.templateName && (
            <p className="mb-1 text-[10px] uppercase tracking-wide opacity-70">
              Template · {m.templateName}
            </p>
          )}

          {/* whitespace-pre-wrap preserves the line breaks Shift+Enter creates. */}
          <p className="whitespace-pre-wrap break-words text-sm">
            {m.messageText ?? <span className="italic opacity-70">[{m.messageType}]</span>}
          </p>

          <div
            className={`mt-1 flex items-center gap-1.5 text-[11px] ${
              outbound && !failed ? "justify-end opacity-90" : theme.textFaint
            }`}
          >
            <span>{timeOf(m.createdAt)}</span>
            {outbound && <StatusTick status={m.status} isDark={isDark} />}
          </div>
        </div>

        {failed && (
          <div className="mt-1 flex items-center justify-end gap-2">
            <span className="text-[11px] text-red-500" title={m.errorMessage ?? ""}>
              {m.errorMessage
                ? m.errorMessage.length > 60
                  ? m.errorMessage.slice(0, 57) + "…"
                  : m.errorMessage
                : "Not delivered"}
            </span>
            <button
              onClick={onRetry}
              className="rounded border border-red-400/50 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Server rows arrive snake_case over SSE and camelCase from the REST routes. */
function normalizeMessage(raw: any): ConversationMessage {
  return {
    id: String(raw.id),
    direction: raw.direction,
    senderName: raw.senderName ?? raw.sender_name ?? null,
    senderRole: raw.senderRole ?? raw.sender_role ?? null,
    messageType: raw.messageType ?? raw.message_type ?? "text",
    messageText: raw.messageText ?? raw.message_text ?? null,
    templateName: raw.templateName ?? raw.template_name ?? null,
    status: raw.status,
    errorCode: raw.errorCode ?? raw.error_code ?? null,
    errorMessage: raw.errorMessage ?? raw.error_message ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    sentAt: raw.sentAt ?? raw.sent_at ?? null,
    deliveredAt: raw.deliveredAt ?? raw.delivered_at ?? null,
    readAt: raw.readAt ?? raw.read_at ?? null,
  };
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
