"use client";
// SMAssistantDock.tsx — the Sales Manager's private AI dock.
//
// Wears the Admin AI Analyst's chrome exactly: same floating launcher, same panel
// shell, same PANEL_CSS, same light/dark tokens. Both are imported from
// AdminAssistantDock rather than copied, so they cannot drift apart the first
// time either is restyled.
//
// What differs is the SCOPE, not the skin. This one talks to /api/sm-ai-chat,
// which filters every query to the signed-in manager in SQL — it knows that
// manager's whole book and nothing else. No org revenue, no other managers'
// leads, no commissions, no inventory pricing.
//
// LEAD LINKS. The model emits `[#226 Rahul Thorat](lead:226)` and renderRich()
// turns that into a button wired to onOpenLead(226). Markdown links to
// /sales-manager/leads/226 were specified originally, but that route does not
// exist — there are no dynamic routes under /dashboard at all — and no markdown
// renderer is installed, so such a link would render as literal text pointing at
// a 404.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Send, Trash2, X, Plus } from "lucide-react";
import AssistantLauncher from "./AdminAssistantLauncher";
import { BotMark, PANEL_CSS } from "./AdminAssistantDock";

const CHAT_ENDPOINT = "/api/sm-ai-chat";
const ACCENT = "#9E217B";

const PANEL_EXPAND_MS = 280;
const PANEL_COLLAPSE_MS = 220;

type Turn = { role: "user" | "assistant"; content: string };

interface Props {
  lead: any | null;
  isDark: boolean;
  t?: any;
  isOpen: boolean;
  onToggle: () => void;
  onOpenLead?: (leadId: number) => void;
}

const STARTERS = [
  { label: "What's my work today?", icon: "◷" },
  { label: "Which leads have gone cold?", icon: "!" },
  { label: "Who should I call next?", icon: "☎" },
  { label: "How are my site visits this month?", icon: "⌂" },
  { label: "Give me a read on my pipeline", icon: "≡" },
];

function renderRich(
  text: string,
  onOpenLead: ((id: number) => void) | undefined,
  isDark: boolean,
): React.ReactNode[] {
  const re = /\[([^\]\n]{1,80})\]\(lead:(\d+)\)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, label, id] = m;
    out.push(
      <button
        key={`lead-${id}-${k++}`}
        type="button"
        onClick={() => onOpenLead?.(Number(id))}
        disabled={!onOpenLead}
        className={`inline font-semibold underline underline-offset-2 rounded px-0.5 transition-colors ${onOpenLead ? "cursor-pointer" : "cursor-default"
          } ${isDark ? "text-[#F0B9DE] hover:text-white" : "text-[#9E217B] hover:text-[#6B1553]"}`}
      >
        {label}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

type AnimPhase = "idle" | "docking" | "expanding" | "collapsing";

export default function SMAssistantDock({ lead, isDark, isOpen, onToggle, onOpenLead }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("idle");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const phaseGuard = useRef(false);

  const leadNo = lead ? (lead.sr_no ?? lead.id) : null;
  const leadName = lead?.name ?? "";

  const panelVisible = isOpen || animPhase === "collapsing";

  useEffect(() => {
    if (panelVisible) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [panelVisible, turns, busy, error]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "24px";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [draft, panelVisible]);

  const submit = useCallback(async (forcedQuery?: string) => {
    const q = (forcedQuery || draft).trim();
    if (!q || busy) return;

    setDraft("");
    setError("");
    const history = turns.slice(-8);
    setTurns(prev => [...prev, { role: "user", content: q }]);
    setBusy(true);

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: q, history, currentLeadId: lead?.id ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.response || "Assistant failed");
      setTurns(prev => [...prev, { role: "assistant", content: data.response }]);
    } catch (e: any) {
      setError(e.message || "Failed to reach assistant");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [draft, busy, turns, lead?.id]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const copyTurn = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      window.setTimeout(() => setCopied(c => (c === i ? null : c)), 1400);
    } catch { /* noop */ }
  };

  // ── Phase transitions ──────────────────────────────────────────
  const handleLauncherClick = useCallback(() => {
    if (phaseGuard.current) return;
    phaseGuard.current = true;
    setAnimPhase("docking");
  }, []);

  const handleDockComplete = useCallback(() => {
    setAnimPhase("expanding");
    onToggle(); // sets isOpen = true
    setTimeout(() => {
      setAnimPhase("idle");
      phaseGuard.current = false;
      requestAnimationFrame(() => inputRef.current?.focus());
    }, PANEL_EXPAND_MS + 30);
  }, [onToggle]);

  const handleClose = useCallback(() => {
    setAnimPhase("collapsing");
    setTimeout(() => {
      onToggle(); // sets isOpen = false
      setAnimPhase("idle");
      phaseGuard.current = false;
    }, PANEL_COLLAPSE_MS + 30);
  }, [onToggle]);

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

  const panelStyle: React.CSSProperties = {
    height: "min(640px, calc(100vh - 96px))",
  };
  if (typeof window !== "undefined" && window.innerWidth >= 640) {
    panelStyle.right = 16;
    panelStyle.bottom = 16;
  }

  const panelPhaseClass =
    animPhase === "expanding" ? "bdai-panel-expanding" :
    animPhase === "collapsing" ? "bdai-panel-collapsing" : "";

  // Show launcher: when not open (including during docking which is before open),
  // or during expanding (fading out under the panel)
  const showLauncher = !isOpen || animPhase === "expanding";

  return (
    <>
      <style>{PANEL_CSS}</style>

      {/* ── Launcher ── */}
      {showLauncher && (
        <AssistantLauncher
          isDark={isDark}
          onOpen={handleLauncherClick}
          docking={animPhase === "docking"}
          onDockComplete={handleDockComplete}
          fading={animPhase === "expanding"}
          title="Sales AI"
          subtitle="Your leads, privately"
          storageNamespace="smai"
          hint={lead ? `Ask about ${leadName}` : "What's my work today?"}
        />
      )}

      {/* ── Chat panel ── */}
      {panelVisible && (
        <div
          role="dialog"
          aria-label="Sales AI"
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
                <div className="truncate text-[14px] font-semibold tracking-tight">Sales AI</div>
                <div className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${muted}`}>
                  <span className="bdai-live h-[6px] w-[6px] shrink-0 rounded-full" />
                  Scoped to your leads only
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
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
                aria-label="Close Sales AI"
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
                <div className="bdai-greet text-[21px] leading-tight">Hi, I&apos;m Sales AI</div>
                <div className={`text-[21px] leading-tight ${muted}`}>What should we look at?</div>
                <p className={`mt-3 text-[12.5px] leading-relaxed ${muted}`}>
                  Get real-time insights into your assigned leads, including upcoming follow-ups,
                  inactive prospects, and recommended contacts.
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

            {turns.map((turn, i) => {
              const isUser = turn.role === "user";
              return (
                <div key={i} className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${isUser ? "bdai-user text-white" : `border ${bubbleAi}`
                      }`}
                  >
                    {isUser ? turn.content : renderRich(turn.content, onOpenLead, isDark)}
                  </div>
                  {!isUser && (
                    <button
                      onClick={() => copyTurn(i, turn.content)}
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
                  <span className={`text-[13px] ${muted}`}>Reading your leads</span>
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
                placeholder="Ask about your leads"
                aria-label="Ask Sales AI"
                rows={1}
                autoFocus
                className={`w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none ${isDark ? "placeholder-[#7A6675]" : "placeholder-[#A8909F]"
                  }`}
                style={{ maxHeight: 132 }}
              />
              <div className="mt-1.5 flex items-center gap-1">
                <span className={`flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] ${muted}`}>
                  <Plus size={13} className="shrink-0" />
                  <span className="truncate">
                    {lead ? `Viewing #${leadNo} ${leadName}` : "No lead selected"}
                  </span>
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => submit()}
                  disabled={!draft.trim() || busy}
                  aria-label="Send message"
                  className={`bdai-send grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all ${draft.trim() && !busy ? "bdai-send-on text-white" : isDark ? "bg-[#2A1F29] text-[#6B5666]" : "bg-[#9E217B]/10 text-[#B896AE]"
                    }`}
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
            <div className={`mt-2 text-center text-[10.5px] ${muted}`}>
              Enter sends · Shift + Enter for a new line · Answers come from your own leads
            </div>
          </div>
        </div>
      )}
    </>
  );
}
