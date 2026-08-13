"use client";

// components/bhoomi-ai/BhoomiAiPanel.tsx — the Bhoomi AI tab.
//
// Layout: a fixed page header, one scrolling conversation column, and a sticky
// composer. Only the middle scrolls, so the header stays put and the composer
// never moves while the thread grows.
//
// The API contract is untouched — POST { query, history, frontendContext } to
// /api/admin/ai/chat, GET for capability. Everything below the fetch calls is
// presentation. The route owns identity, RBAC, rate limiting, tool calling and
// the audit trail, and this file makes no decision that belongs to it.

import { useCallback, useEffect, useRef, useState } from "react";
import { FaPlus } from "react-icons/fa6";
import { FaExclamationTriangle, FaTimes } from "react-icons/fa";
import { CRMContextManager } from "@/lib/admin-ai/contextManager";
import BhoomiAiIcon, { AI_ICON_CSS } from "./BhoomiAiIcon";
import ChatComposer, { type ComposerHandle } from "./ChatComposer";
import ChatWelcome from "./ChatWelcome";
import { AssistantMessage, ThinkingIndicator, UserMessage, type Turn } from "./ChatMessage";
import { aiTheme, CANVAS } from "./theme";

const CHAT_ENDPOINT = "/api/admin/ai/chat";

interface Props {
  isDark: boolean;
  /** The employees-page theme object; used only for its scrollbar class. */
  t: any;
  user: any;
}

export default function BhoomiAiPanel({ isDark, t: pageTheme, user }: Props) {
  const t = aiTheme(isDark);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  // The question that produced the newest answer, so Retry can re-ask it.
  const lastQuery = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    fetch(CHAT_ENDPOINT, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!mounted.current) return;
        setConfigured(ok ? Boolean(j?.configured) : false);
        // A 403 here is the RBAC answer, and for a Site Head it is the entire
        // explanation — show it rather than a generic "unavailable".
        if (!ok && j?.message) setError(j.message);
      })
      .catch(() => mounted.current && setConfigured(false));
  }, []);

  // Follow the newest turn. `block: "end"` on a sentinel keeps the composer in
  // place instead of scrolling it out of view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: turns.length > 1 ? "smooth" : "auto", block: "end" });
  }, [turns, busy]);

  const ask = useCallback(
    async (question: string, opts?: { replaceLast?: boolean }) => {
      if (busy) return;
      setError("");
      setBusy(true);
      lastQuery.current = question;

      // History is the turns BEFORE this question — the route takes the question
      // separately as `query`, so including it here makes the model see it twice.
      // On a regenerate, the previous answer and its question are dropped first.
      let base: Turn[] = [];
      setTurns((prev) => {
        const trimmed = opts?.replaceLast ? prev.slice(0, -2) : prev;
        base = trimmed;
        return [...trimmed, { role: "user", content: question }];
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: question,
            history: base.map(({ role, content }) => ({ role, content })),
            frontendContext: CRMContextManager.get(),
          }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          // Every failure path of this route answers with a readable `response`:
          // rate limits name the wait, a missing key names the env var.
          throw new Error(data?.response || `The assistant could not answer (${res.status}).`);
        }
        if (!mounted.current) return;

        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data?.response ?? "",
            sources: Array.isArray(data?.sources) ? data.sources : [],
          },
        ]);
      } catch (e: any) {
        if (e?.name === "AbortError" || !mounted.current) return;
        setError(e?.message || "Could not reach the assistant.");
      } finally {
        if (mounted.current) setBusy(false);
        abortRef.current = null;
        composerRef.current?.focus();
      }
    },
    [busy]
  );

  const retry = useCallback(() => {
    const q = lastQuery.current;
    if (!q || busy) return;
    // The failed attempt left a user turn with no answer; drop it and re-ask.
    setTurns((prev) => (prev[prev.length - 1]?.role === "user" ? prev.slice(0, -1) : prev));
    setError("");
    setTimeout(() => ask(q), 0);
  }, [ask, busy]);

  const regenerate = useCallback(() => {
    const q = lastQuery.current;
    if (q && !busy) ask(q, { replaceLast: true });
  }, [ask, busy]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setError("");
    setBusy(false);
    lastQuery.current = null;
    composerRef.current?.focus();
  }, []);

  const blocked = configured === false;
  const empty = turns.length === 0 && !busy;
  const lastIndex = turns.length - 1;

  return (
    /* ── The AI workspace boundary ──────────────────────────────────────────
       The dark canvas starts HERE and nowhere above it. Everything outside
       this element — the Admin header, the rail, the logo, Mark Attendance,
       the notification badges — keeps the Bhoomi magenta/blue/white identity
       and is not touched by this file or by theme.ts.

       `.bhoomi-ai-workspace` is the scope for the few CSS rules the surface
       needs (the mark's keyframes, the composer's placeholder colour). There
       is no global rule anywhere: a `body { background: #131314 }` would take
       the whole CRM down with it. */
    <main
      className="bhoomi-ai-workspace flex h-full flex-1 flex-col overflow-hidden"
      style={{ background: CANVAS, color: t.text }}
    >
      {/* ── Page header ── the New Chat home, so it no longer competes with the
          composer for attention. Not a navbar: the Admin header is right above. */}
      <div
        className="flex flex-shrink-0 items-center justify-between gap-4 border-b px-6 py-3.5"
        style={{ borderColor: t.borderSoft }}
      >
        <div className="flex min-w-0 items-center gap-2.5 leading-tight">
          {/* The same mark as the rail item and the greeting — one Bhoomi AI
              symbol, used everywhere it identifies the assistant. */}
          <BhoomiAiIcon size={26} />
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold tracking-tight" style={{ color: t.text }}>
              Bhoomi AI
            </h1>
            <p className="text-[11.5px]" style={{ color: t.textFaint }}>
              AI Business Analyst for your CRM
            </p>
          </div>
        </div>

        <button
          onClick={newChat}
          disabled={empty && !error}
          className="flex flex-shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: t.border, color: t.accent, background: t.surfaceRaised }}
          aria-label="Start a new chat"
        >
          <FaPlus className="text-[9px]" /> New Chat
        </button>
      </div>

      {/* ── Conversation ── the only scroller on the page. */}
      <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto ${pageTheme?.scroll ?? ""}`}>
        <div className="mx-auto w-full max-w-[960px] px-5 pb-6 pt-6 sm:px-8">
          {empty ? (
            <ChatWelcome
              t={t}
              isDark={isDark}
              disabled={blocked}
              onPick={(p) => ask(p)}
            />
          ) : (
            <div className="flex flex-col">
              {turns.map((turn, i) => (
                <div
                  key={i}
                  // 26px inside a turn, 44px between turns — the exchange reads
                  // as a pair rather than four evenly spaced blocks.
                  style={{ marginTop: i === 0 ? 0 : turn.role === "user" ? 44 : 26 }}
                >
                  {turn.role === "user" ? (
                    <UserMessage content={turn.content} />
                  ) : (
                    <AssistantMessage
                      turn={turn}
                      t={t}
                      isDark={isDark}
                      onRegenerate={regenerate}
                      canRegenerate={i === lastIndex && !busy}
                    />
                  )}
                </div>
              ))}

              {busy && (
                <div style={{ marginTop: 26 }}>
                  <ThinkingIndicator t={t} />
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              className="mt-6 flex items-start gap-3 rounded-xl border px-4 py-3"
              style={{
                borderColor: isDark ? "rgba(248,113,113,0.32)" : "rgba(239,68,68,0.30)",
                background: isDark ? "rgba(248,113,113,0.07)" : "rgba(239,68,68,0.05)",
              }}
              role="alert"
            >
              <FaExclamationTriangle className="mt-0.5 flex-shrink-0 text-[13px]" style={{ color: "#ef4444" }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-relaxed" style={{ color: t.text }}>
                  {error}
                </p>
                {/* Retry only when there is a question to re-send. A blocked or
                    unconfigured assistant has nothing to retry. */}
                {lastQuery.current && !blocked && (
                  <button
                    onClick={retry}
                    disabled={busy}
                    className="mt-2 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-50"
                    style={{ borderColor: t.border, color: t.accent }}
                  >
                    Try again
                  </button>
                )}
              </div>
              <button
                onClick={() => setError("")}
                aria-label="Dismiss error"
                className="flex-shrink-0 opacity-60 transition-opacity hover:opacity-100"
                style={{ color: t.textMuted }}
              >
                <FaTimes className="text-[12px]" />
              </button>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {/* ── Composer ── sticky, with a fade so text scrolls out under it. */}
      <div className="relative flex-shrink-0">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 left-0 right-0 h-8"
          style={{ background: t.fade }}
        />
        <div
          className="mx-auto w-full max-w-[960px] px-5 pb-4 pt-1 sm:px-8"
          style={{ background: CANVAS }}
        >
          <ChatComposer
            ref={composerRef}
            t={t}
            isDark={isDark}
            busy={busy}
            disabled={blocked}
            placeholder={
              blocked
                ? "Bhoomi AI is unavailable on this server"
                : "Ask Bhoomi AI about your leads, revenue, bookings or team…"
            }
            onSend={(text) => ask(text)}
          />
        </div>
      </div>

      {/* Workspace-scoped CSS. Every selector below is either a `bdai-` class
          or nested under `.bhoomi-ai-workspace`, so nothing here can reach the
          CRM shell around it. */}
      <style>{`
        @keyframes bdai-dot{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-3px);opacity:1}}
        ${AI_ICON_CSS}
        .bhoomi-ai-workspace .bdai-input::placeholder{color:${t.textMuted};opacity:1}
        .bhoomi-ai-workspace .bdai-send-busy{animation:bdai-sweep 2.2s ease-in-out infinite}
        .bhoomi-ai-workspace .bdai-send:hover:not(:disabled){filter:brightness(1.12)}
        .bhoomi-ai-workspace .bdai-send:focus-visible{box-shadow:0 0 0 3px rgba(255,255,255,0.16)}
        /* The canvas fades in when the workspace mounts — the AI surface
           activating inside a CRM shell that does not move. */
        .bhoomi-ai-workspace{animation:bdai-canvas-in 260ms ease-out both}
        @keyframes bdai-canvas-in{from{opacity:0}to{opacity:1}}
        @media (prefers-reduced-motion:reduce){.bhoomi-ai-workspace{animation:none}}
      `}</style>
    </main>
  );
}
