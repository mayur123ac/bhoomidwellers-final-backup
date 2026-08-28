"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Send, Trash2, X, TerminalSquare, Plus } from "lucide-react";
import { CRMContextManager } from "@/lib/admin-ai/contextManager";
import AdminAssistantLauncher from "./AdminAssistantLauncher";

const CHAT_ENDPOINT = "/api/admin/ai/chat";
const ACCENT = "#9E217B";

const PANEL_EXPAND_MS = 280;
const PANEL_COLLAPSE_MS = 220;

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
    theme: any;
    isDark: boolean;
};

/**
 * Animation state machine:
 *   closed → docking → opening → open → closing → closed
 *
 * - closed:  launcher is visible & draggable
 * - docking: launcher flies to bottom-right safe area
 * - opening: launcher fading, panel expanding upward from dock position
 * - open:    panel fully interactive
 * - closing: panel collapsing, then back to closed
 */
type Phase = "closed" | "docking" | "opening" | "open" | "closing";

const STARTERS = [
    { label: "How much OCR was collected this month?", icon: "₹" },
    { label: "Which sales manager has the highest agreement value?", icon: "★" },
    { label: "Show bookings awaiting registration", icon: "◷" },
    { label: "What is the balance receivable?", icon: "≡" },
];

export function BotMark({ size = 26 }: { size?: number }) {
    return (
        <svg viewBox="0 0 44 44" width={size} height={size} style={{ color: "#F6D7EC" }} aria-hidden="true">
            <line x1="22" y1="9.6" x2="22" y2="14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity="0.8" />
            <circle cx="22" cy="6.6" r="4.8" fill="#F472C6" opacity="0.25" />
            <circle cx="22" cy="6.6" r="2.6" fill="#FBCFE8" />
            <rect x="4.4" y="21" width="3.2" height="8" rx="1.6" fill="currentColor" opacity="0.55" />
            <rect x="36.4" y="21" width="3.2" height="8" rx="1.6" fill="currentColor" opacity="0.55" />
            <rect x="8" y="13.4" width="28" height="24" rx="9" fill="currentColor" />
            <ellipse cx="16.8" cy="24.2" rx="2.6" ry="3.2" fill="#5B1046" />
            <ellipse cx="27.2" cy="24.2" rx="2.6" ry="3.2" fill="#5B1046" />
            <circle cx="17.7" cy="23.1" r="0.85" fill="#fff" opacity="0.9" />
            <circle cx="28.1" cy="23.1" r="0.85" fill="#fff" opacity="0.9" />
            <path d="M18.2 30.2 q3.8 3 7.6 0" fill="none" stroke="#5B1046" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
    );
}

export default function AdminAssistantDock({ theme, isDark }: Props) {
    const [phase, setPhase] = useState<Phase>("closed");
    const [turns, setTurns] = useState<Turn[]>([]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [showDebug, setShowDebug] = useState(false);
    const [copied, setCopied] = useState<number | null>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const phaseGuard = useRef(false); // prevents rapid double-clicks

    const panelVisible = phase === "opening" || phase === "open" || phase === "closing";

    useEffect(() => {
        if (panelVisible) endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [panelVisible, turns, busy, error]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = "24px";
        el.style.height = Math.min(el.scrollHeight, 132) + "px";
    }, [draft, panelVisible]);

    // ── Business logic (unchanged) ─────────────────────────────────
    const submit = useCallback(async (forcedQuery?: string) => {
        const q = (forcedQuery || draft).trim();
        if (!q || busy) return;
        setDraft("");
        setError("");
        setTurns((prev) => [...prev, { role: "user", content: q }]);
        setBusy(true);
        try {
            const frontendContext = CRMContextManager.get();
            const res = await fetch(CHAT_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: q, history: turns, frontendContext }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.response || "Assistant failed");
            setTurns((prev) => [...prev, { role: "assistant", content: data.response }]);
        } catch (e: any) {
            setError(e.message || "Failed to reach assistant");
        } finally {
            setBusy(false);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [draft, busy, turns]);

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    };

    const copyTurn = async (i: number, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(i);
            window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400);
        } catch { /* noop */ }
    };

    // ── Phase transitions ──────────────────────────────────────────
    const handleLauncherClick = useCallback(() => {
        if (phaseGuard.current) return;
        phaseGuard.current = true;
        setPhase("docking");
    }, []);

    const handleDockComplete = useCallback(() => {
        setPhase("opening");
        setTimeout(() => {
            setPhase("open");
            phaseGuard.current = false;
            requestAnimationFrame(() => inputRef.current?.focus());
        }, PANEL_EXPAND_MS + 30);
    }, []);

    const handleClose = useCallback(() => {
        if (phase !== "open" && phase !== "opening") return;
        setPhase("closing");
        setTimeout(() => {
            setPhase("closed");
            phaseGuard.current = false;
        }, PANEL_COLLAPSE_MS + 30);
    }, [phase]);

    // ── Render ─────────────────────────────────────────────────────
    const shell = isDark
        ? "bg-[#141014] border-[#3B2A39] text-[#EDE4EA]"
        : "bg-white border-[#9E217B]/35 text-[#2A1626]";
    const headBar = isDark ? "bg-[#1B141A] border-[#3B2A39]" : "bg-[#FDF6FB] border-[#9E217B]/25";
    const bubbleAi = isDark
        ? "bg-[#1F1720] border-[#3B2A39] text-[#E6DAE2]"
        : "bg-[#FBF4F9] border-[#9E217B]/22 text-[#3A2233]";
    const iconBtn = isDark
        ? "text-[#A895A3] hover:bg-[#2A1F29] hover:text-white"
        : "text-[#9E217B]/60 hover:bg-[#9E217B]/10 hover:text-[#9E217B]";
    const muted = isDark ? "text-[#A895A3]" : "text-[#7B6675]";

    // Panel always anchored at bottom. On desktop: bottom-right. On mobile: full-width bottom.
    const panelStyle: React.CSSProperties = {
        height: "min(640px, calc(100vh - 96px))",
    };
    if (typeof window !== "undefined" && window.innerWidth >= 640) {
        panelStyle.right = 16;
        panelStyle.bottom = 16;
    }

    // Determine transform-origin for panel expand animation
    // Panel grows from the dock position (bottom-right corner of the panel)
    const panelPhaseClass =
        phase === "opening" ? "bdai-panel-expanding" :
        phase === "closing" ? "bdai-panel-collapsing" : "";

    return (
        <>
            <style>{PANEL_CSS}</style>

            {/* ── Launcher (visible in closed & docking, fading in opening) ── */}
            {phase !== "open" && phase !== "closing" && (
                <AdminAssistantLauncher
                    isDark={isDark}
                    onOpen={handleLauncherClick}
                    docking={phase === "docking"}
                    onDockComplete={handleDockComplete}
                    fading={phase === "opening"}
                />
            )}

            {/* ── Chat panel (visible in opening, open, closing) ── */}
            {panelVisible && (
                <div
                    role="dialog"
                    aria-label="Admin AI Analyst"
                    onKeyDown={(e) => { if (e.key === "Escape") handleClose(); }}
                    className={`bdai-panel fixed z-[60] flex flex-col overflow-hidden rounded-[22px] border
                        inset-x-3 bottom-3 sm:inset-x-auto sm:w-[420px] ${panelPhaseClass} ${shell}`}
                    style={panelStyle}
                >
                    {/* ---------- HEADER ---------- */}
                    <div className={`flex shrink-0 items-center justify-between border-b px-3.5 py-3 ${headBar}`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                            <span className="bdai-tile grid h-9 w-9 shrink-0 place-items-center rounded-[13px]">
                                <BotMark />
                            </span>
                            <div className="min-w-0">
                                <div className="truncate text-[14px] font-semibold tracking-tight">Admin AI Analyst</div>
                                <div className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${muted}`}>
                                    <span className="bdai-live h-[6px] w-[6px] shrink-0 rounded-full" />
                                    Connected to your CRM database
                                </div>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                            <button
                                onClick={() => setShowDebug(!showDebug)}
                                title="Context inspector"
                                aria-label="Toggle context inspector"
                                aria-pressed={showDebug}
                                className={`rounded-lg p-1.5 transition-colors ${showDebug
                                    ? isDark ? "bg-[#3A2A38] text-white" : "bg-[#9E217B]/15 text-[#9E217B]"
                                    : iconBtn
                                    }`}
                            >
                                <TerminalSquare size={16} />
                            </button>
                            <button
                                onClick={() => { setTurns([]); setError(""); }}
                                title="Clear conversation"
                                aria-label="Clear conversation"
                                disabled={turns.length === 0}
                                className={`rounded-lg p-1.5 transition-colors disabled:opacity-30 ${iconBtn}`}
                            >
                                <Trash2 size={16} />
                            </button>
                            <button
                                onClick={handleClose}
                                title="Close"
                                aria-label="Close Admin AI"
                                className={`rounded-lg p-1.5 transition-colors ${iconBtn}`}
                            >
                                <X size={17} />
                            </button>
                        </div>
                    </div>

                    {/* ---------- THREAD ---------- */}
                    <div className="bdai-scroll flex flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-4" aria-live="polite">
                        {turns.length === 0 && !busy && (
                            <div className="my-auto">
                                <div className="bdai-greet text-[21px] leading-tight">Hi, I&apos;m Admin AI</div>
                                <div className={`text-[21px] leading-tight ${muted}`}>What should we look at?</div>
                                <p className={`mt-3 text-[12.5px] leading-relaxed ${muted}`}>
                                    I read live data from your CRM — bookings, collections, loans and sales activity.
                                </p>
                                <div className="mt-4 flex flex-col items-start gap-2">
                                    {STARTERS.map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => submit(s.label)}
                                            className={`bdai-chip flex w-full items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left text-[13px] transition-colors ${isDark
                                                ? "border-[#3B2A39] bg-[#1B141A] text-[#D9C9D4] hover:border-[#5C4058] hover:bg-[#241A22]"
                                                : "border-[#9E217B]/28 bg-[#FDF6FB] text-[#4A2C43] hover:border-[#9E217B]/50 hover:bg-[#9E217B]/[0.06]"
                                                }`}
                                        >
                                            <span
                                                className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[12px] font-semibold"
                                                style={{ backgroundColor: isDark ? "#3A1E33" : "#9E217B14", color: isDark ? "#F0B9DE" : ACCENT }}
                                            >
                                                {s.icon}
                                            </span>
                                            <span className="min-w-0 flex-1">{s.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {turns.map((t, i) => {
                            const isUser = t.role === "user";
                            return (
                                <div key={i} className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                                    <div
                                        className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isUser ? "bdai-user text-white" : `border ${bubbleAi}`
                                            }`}
                                    >
                                        {t.content}
                                    </div>
                                    {!isUser && (
                                        <button
                                            onClick={() => copyTurn(i, t.content)}
                                            aria-label="Copy answer"
                                            className={`mt-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${muted}`}
                                        >
                                            {copied === i ? <Check size={12} /> : <Copy size={12} />}
                                            {copied === i ? "Copied" : "Copy"}
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {busy && (
                            <div className="flex justify-start">
                                <div className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 ${bubbleAi}`}>
                                    <Loader2 size={15} className="animate-spin" color={ACCENT} />
                                    <span className={`text-[13px] ${muted}`}>Querying database</span>
                                    <span className="bdai-dots" aria-hidden="true"><i /><i /><i /></span>
                                </div>
                            </div>
                        )}

                        {error && (
                            <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-[12.5px] text-red-400">
                                <span className="flex-1">{error}</span>
                                <button onClick={() => setError("")} aria-label="Dismiss error" className="shrink-0 opacity-70 hover:opacity-100">
                                    <X size={14} />
                                </button>
                            </div>
                        )}

                        <div ref={endRef} />
                    </div>

                    {/* ---------- CONTEXT INSPECTOR ---------- */}
                    {showDebug && (
                        <div
                            className={`shrink-0 space-y-1 border-t px-3.5 py-2.5 font-mono text-[10.5px] leading-relaxed ${isDark ? "border-[#2E2130] bg-[#100C10] text-[#A895A3]" : "border-[#9E217B]/10 bg-[#FBF4F9] text-[#6B4C63]"
                                }`}
                        >
                            <div className="mb-1 font-semibold tracking-wide opacity-70">CONTEXT INSPECTOR</div>
                            <div>module &nbsp;{CRMContextManager.get()?.module || "none"}</div>
                            <div className="truncate">filters &nbsp;{JSON.stringify(CRMContextManager.get()?.filters || {})}</div>
                            <div>rows &nbsp;&nbsp;&nbsp;&nbsp;{CRMContextManager.get()?.rows?.length || 0} / {CRMContextManager.get()?.totalRows || 0}</div>
                            <div>selected {CRMContextManager.get()?.selectedRow ? "yes" : "no"}</div>
                        </div>
                    )}

                    {/* ---------- COMPOSER ---------- */}
                    <div className={`shrink-0 border-t px-3 pb-2.5 pt-3 ${isDark ? "border-[#3B2A39] bg-[#141014]" : "border-[#9E217B]/22 bg-white"}`}>
                        <div
                            className={`bdai-composer rounded-[18px] border px-3 pb-2 pt-2.5 transition-colors ${isDark ? "border-[#4A3548] bg-[#1B141A]" : "border-[#9E217B]/35 bg-[#FDF6FB]"
                                }`}
                        >
                            <textarea
                                ref={inputRef}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={handleKey}
                                placeholder="Ask about revenue, bookings or loans"
                                aria-label="Ask Admin AI"
                                rows={1}
                                autoFocus
                                className={`w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none ${isDark ? "placeholder-[#7A6675]" : "placeholder-[#A8909F]"
                                    }`}
                                style={{ maxHeight: 132 }}
                            />
                            <div className="mt-1.5 flex items-center gap-1">
                                <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${muted}`}>
                                    <Plus size={13} />
                                    {CRMContextManager.get()?.module
                                        ? `${CRMContextManager.get()?.rows?.length || 0} rows in view`
                                        : "No page context"}
                                </span>
                                <span className="flex-1" />
                                <button
                                    onClick={() => submit()}
                                    disabled={!draft.trim() || busy}
                                    aria-label="Send message"
                                    className={`bdai-send grid h-8 w-8 place-items-center rounded-full transition-all ${draft.trim() && !busy ? "bdai-send-on text-white" : isDark ? "bg-[#2A1F29] text-[#6B5666]" : "bg-[#9E217B]/10 text-[#B896AE]"
                                        }`}
                                >
                                    <Send size={15} />
                                </button>
                            </div>
                        </div>
                        <div className={`mt-2 text-center text-[10.5px] ${muted}`}>
                            Enter sends · Shift + Enter for a new line · Answers come from your database
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export const PANEL_CSS = `
/* ── Panel base ─────────────────────────────────────────────────── */
.bdai-panel{
  background-image: radial-gradient(120% 60% at 50% 0%, rgba(195,58,158,.055), transparent 55%);
  box-shadow:
    0 0 100px 1px rgba(158,33,123,.09),
    0 12px 32px -12px rgba(90,20,72,.22),
    0 0 48px -16px rgba(195,58,158,.20);
}

/* ── Expand: panel grows upward from bottom-right ── */
.bdai-panel-expanding{
  animation: bdai-dock-expand ${PANEL_EXPAND_MS}ms cubic-bezier(.22,.61,.36,1) both;
  transform-origin: bottom right;
}
/* ── Collapse: panel shrinks back down to bottom-right ── */
.bdai-panel-collapsing{
  animation: bdai-dock-collapse ${PANEL_COLLAPSE_MS}ms cubic-bezier(.55,.06,.68,.19) both;
  transform-origin: bottom right;
  pointer-events: none;
}

.bdai-tile{ background: linear-gradient(160deg,#2B0B26,#46113E); box-shadow: inset 0 0 0 1px rgba(255,255,255,.10); }
.bdai-greet{
  background: linear-gradient(92deg,#C33A9E,#8F4BD0);
  -webkit-background-clip:text; background-clip:text; color:transparent;
  font-weight:600; width:fit-content;
}
.bdai-user{ background: linear-gradient(118deg,#7C1A63,#A8228A 62%,#C33A9E); }
.bdai-send-on{ background: linear-gradient(118deg,#8A1D6D,#C33A9E); box-shadow: 0 4px 14px -6px rgba(195,58,158,.8); }
.bdai-send:not(:disabled):hover{ transform: translateY(-1px); }
.bdai-send:not(:disabled):active{ transform: scale(.94); }
.bdai-composer:focus-within{ border-color: rgba(195,58,158,.55) !important; box-shadow: 0 0 0 3px rgba(158,33,123,.14); }
.bdai-chip:active{ transform: scale(.99); }
.bdai-live{ background:#22C55E; box-shadow: 0 0 0 2px rgba(34,197,94,.22); }
.bdai-scroll::-webkit-scrollbar{ width:6px; }
.bdai-scroll::-webkit-scrollbar-thumb{ background: rgba(158,33,123,.28); border-radius:99px; }
.bdai-scroll::-webkit-scrollbar-track{ background: transparent; }
.bdai-dots{ display:inline-flex; gap:3px; }
.bdai-dots i{ width:4px; height:4px; border-radius:50%; background:#C33A9E; display:block; }

@media (prefers-reduced-motion: no-preference){
  .bdai-dots i{ animation: bdai-dot 1.1s ease-in-out infinite; }
  .bdai-dots i:nth-child(2){ animation-delay:.15s; }
  .bdai-dots i:nth-child(3){ animation-delay:.3s; }
}
@media (prefers-reduced-motion: reduce){
  .bdai-panel-expanding, .bdai-panel-collapsing{ animation:none; }
  .bdai-send:not(:disabled):hover{ transform:none; }
}

@keyframes bdai-dock-expand{
  0%  { opacity:0; transform: scale(.35) translateY(20px); }
  50% { opacity:1; }
  100%{ opacity:1; transform: scale(1) translateY(0); }
}
@keyframes bdai-dock-collapse{
  0%  { opacity:1; transform: scale(1) translateY(0); }
  100%{ opacity:0; transform: scale(.35) translateY(20px); }
}
@keyframes bdai-dot{
  0%,100%{ opacity:.25; transform: translateY(0); }
  40%    { opacity:1;   transform: translateY(-2px); }
}
`;
