"use client";

import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Mic,
  ArrowUp,
  Square,
  Copy,
  Check,
  ListChecks,
  IndianRupee,
  UserPlus,
  FileText,
} from "lucide-react";
import { CRMContextManager } from "@/lib/admin-ai/contextManager";

const CHAT_ENDPOINT = "/api/admin/ai/chat";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: any[];
}

interface Props {
  isDark: boolean;
  t: any;
  user: any;
}

let turnIdCounter = 0;
const makeId = () => `turn-${Date.now()}-${turnIdCounter++}`;

const SUGGESTIONS: { icon: any; label: string; prompt: string }[] = [
  {
    icon: ListChecks,
    label: "Today's follow-ups",
    prompt: "What are today's pending follow-ups across all leads?",
  },
  {
    icon: IndianRupee,
    label: "Pending disbursements",
    prompt: "Show me all bookings with pending loan disbursements.",
  },
  {
    icon: UserPlus,
    label: "New leads this week",
    prompt: "Summarize the new leads that came in this week.",
  },
  {
    icon: FileText,
    label: "Draft a status report",
    prompt: "Draft a short status report of this week's sales activity.",
  },
];

// ============================================================================
// MAIN PANEL COMPONENT
// ============================================================================
export default function BhoomiAiPanel({ isDark, t, user }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const lastQuery = useRef<string | null>(null);

  const firstName = user?.name?.split(" ")[0] || "there";

  // ── Backend Config Check ──
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
        if (!ok && j?.message) setError(j.message);
      })
      .catch(() => mounted.current && setConfigured(false));
  }, []);

  // ── Auto Scroll ──
  useEffect(() => {
    if (endRef.current && turns.length > 0) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns, busy]);

  // ── Core AI Interaction Logic ──
  // mode "regenerate" drops the last user+assistant pair before re-asking.
  // mode "retry" drops a dangling user turn that never got a response (error case).
  const ask = useCallback(
    async (question: string, opts?: { mode?: "regenerate" | "retry" }) => {
      if (busy || !question.trim()) return;
      setError("");
      setBusy(true);
      lastQuery.current = question;

      let base: Turn[] = [];
      setTurns((prev) => {
        let trimmed = prev;
        if (opts?.mode === "regenerate") {
          trimmed = prev.slice(0, -2);
        } else if (opts?.mode === "retry") {
          trimmed =
            prev[prev.length - 1]?.role === "user" ? prev.slice(0, -1) : prev;
        }
        base = trimmed;
        return [...trimmed, { id: makeId(), role: "user", content: question }];
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
          throw new Error(
            data?.response || `The assistant could not answer (${res.status}).`
          );
        }
        if (!mounted.current) return;

        setTurns((prev) => [
          ...prev,
          {
            id: makeId(),
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
      }
    },
    [busy]
  );

  const retry = useCallback(() => {
    if (!lastQuery.current || busy) return;
    setError("");
    ask(lastQuery.current, { mode: "retry" });
  }, [ask, busy]);

  const regenerate = useCallback(() => {
    if (!lastQuery.current || busy) return;
    ask(lastQuery.current, { mode: "regenerate" });
  }, [ask, busy]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setError("");
    setBusy(false);
    lastQuery.current = null;
  }, []);

  const blocked = configured === false;
  const empty = turns.length === 0 && !busy;

  // ── UI / UX Rendering ──
  return (
    <main
      className={`flex flex-col h-full w-full relative overflow-hidden font-sans antialiased transition-colors duration-500 ${isDark ? "bg-gradient-to-l from-[#4B4A62CC] to-[#0b1a3a]" : "bg-gradient-to-l from-[#f0f4f9] to-[#dce7f7]"
        }`}
    >
      {/* ── True Edge-to-Edge Ambient Glows ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div
          animate={{
            scale: [1, 1.15, 1],
            opacity: isDark ? [0.15, 0.25, 0.15] : [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute -top-[30%] -left-[20%] w-[150vw] h-[100vh] rounded-full blur-[140px] mix-blend-screen ${isDark ? "bg-[#4285f4]" : "bg-[#93c5fd]"
            }`}
        />
        <motion.div
          animate={{
            scale: [1.15, 0.95, 1.15],
            opacity: isDark ? [0.1, 0.2, 0.1] : [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute -bottom-[30%] -right-[20%] w-[150vw] h-[100vh] rounded-full blur-[140px] mix-blend-screen ${isDark ? "bg-[#9b51e0]" : "bg-[#c4b5fd]"
            }`}
        />
      </div>

      {/* ── Header ── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 z-20 relative transition-colors duration-500">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center">
            <Sparkles
              className={`w-4 h-4 sm:w-5 sm:h-5 ${isDark ? "text-[#a8c7fa]" : "text-[#0b57d0]"
                }`}
            />
          </div>
          <h1
            className={`text-sm sm:text-base font-medium tracking-tight ${isDark ? "text-white" : "text-[#1f1f1f]"
              }`}
          >
            Bhoomi AI
          </h1>
        </div>

        <button
          onClick={newChat}
          disabled={empty && !error}
          aria-label="Start a new chat"
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[12px] sm:text-[13px] font-medium transition-all active:scale-95 disabled:opacity-0 disabled:pointer-events-none ${isDark
            ? "bg-[#1e1f20] hover:bg-[#2a2b2f] text-[#e3e3e3]"
            : "bg-white hover:bg-gray-50 text-[#1f1f1f] shadow-sm"
            }`}
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="hidden sm:inline">New Chat</span>
          <span className="inline sm:hidden">New</span>
        </button>
      </header>

      {/* ── Main Layout Container ── */}
      <div className="flex-1 flex flex-col relative z-10 w-full max-w-4xl mx-auto h-full min-h-0">
        {/* Top Spacer for exact centering when empty */}
        {empty && <motion.div layout className="flex-[0.7]" />}

        {/* ── Chat History ── */}
        <AnimatePresence>
          {!empty && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth px-4 sm:px-6 pt-4 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            >
              <div className="flex flex-col space-y-6 sm:space-y-8">
                {turns.map((turn, i) => (
                  <motion.div
                    key={turn.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"
                      }`}
                  >
                    {turn.role === "user" ? (
                      <UserBubble content={turn.content} isDark={isDark} />
                    ) : (
                      <AIBubble
                        content={turn.content}
                        sources={turn.sources}
                        isDark={isDark}
                        isLatest={i === turns.length - 1}
                        onRegenerate={regenerate}
                        canRegenerate={i === turns.length - 1 && !busy}
                      />
                    )}
                  </motion.div>
                ))}

                {busy && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-start"
                  >
                    <AIProcessingState isDark={isDark} />
                  </motion.div>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`flex items-start gap-2.5 sm:gap-3 p-3 sm:p-4 rounded-2xl border ${isDark
                      ? "bg-[#FF3B30]/10 border-[#FF3B30]/20 text-[#FF453A]"
                      : "bg-red-50 border-red-200 text-red-600"
                      }`}
                  >
                    <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[13px] sm:text-sm font-medium leading-relaxed">
                        {error}
                      </p>
                      {lastQuery.current && !blocked && (
                        <button
                          onClick={retry}
                          disabled={busy}
                          className={`mt-2.5 sm:mt-3 px-3 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${isDark
                            ? "bg-[#FF3B30]/20 hover:bg-[#FF3B30]/30 text-white"
                            : "bg-red-100 hover:bg-red-200 text-red-700"
                            }`}
                        >
                          Try Again
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}

                <div ref={endRef} className="h-2 sm:h-4" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Composer & Greeting Block ── */}
        <motion.div
          layout
          className={`w-full flex flex-col shrink-0 ${empty
            ? "items-center px-4 sm:px-6"
            : "px-4 sm:px-6 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-6 pt-2"
            }`}
        >
          {/* Greeting + suggestions: only visible when empty */}
          <AnimatePresence>
            {empty && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="w-full flex flex-col items-center"
              >
                <h1
                  className={`text-3xl sm:text-4xl md:text-5xl font-medium tracking-tight mb-6 sm:mb-8 text-center ${isDark
                    ? "text-transparent bg-clip-text bg-gradient-to-r from-[#e3e3e3] to-[#888888]"
                    : "text-transparent bg-clip-text bg-gradient-to-r from-gray-800 to-gray-500"
                    }`}
                >
                  What's next, {firstName}?
                </h1>

                {!blocked && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full max-w-xl mb-6 sm:mb-8">
                    {SUGGESTIONS.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => ask(s.prompt)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-left text-[13px] sm:text-[14px] font-medium transition-all active:scale-[0.98] ${isDark
                          ? "bg-[#1e1f20] hover:bg-[#2a2b2f] text-[#e3e3e3]"
                          : "bg-white hover:bg-gray-50 text-[#1f1f1f] shadow-sm"
                          }`}
                      >
                        <s.icon
                          className={`w-4 h-4 flex-shrink-0 ${isDark ? "text-[#a8c7fa]" : "text-[#0b57d0]"
                            }`}
                        />
                        <span className="truncate">{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {blocked && (
            <div
              className={`w-full max-w-3xl mb-3 flex items-start gap-2.5 px-4 py-3 rounded-2xl border text-[13px] ${isDark
                ? "bg-[#FF3B30]/10 border-[#FF3B30]/20 text-[#FF453A]"
                : "bg-red-50 border-red-200 text-red-600"
                }`}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                {error ||
                  "The AI assistant isn't configured yet. Contact your administrator to enable it."}
              </p>
            </div>
          )}

          {/* Composer Box */}
          <motion.div layout className="w-full max-w-3xl">
            <GeminiComposer
              isDark={isDark}
              busy={busy}
              disabled={blocked}
              onSend={ask}
              onStop={stop}
            />
          </motion.div>
        </motion.div>

        {/* Bottom Spacer for exact centering when empty */}
        {empty && <motion.div layout className="flex-[1.3]" />}
      </div>
    </main>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function UserBubble({ content, isDark }: { content: string; isDark: boolean }) {
  return (
    <div
      className={`max-w-[90%] sm:max-w-[75%] px-5 py-3.5 rounded-[1.5rem] rounded-tr-[4px] shadow-sm text-[10px] leading-relaxed font-medium whitespace-pre-wrap break-words ${isDark ? "bg-[#1e1f20] text-[#e3e3e3]" : "bg-[#e9eef6] text-[#1f1f1f]"
        }`}
    >
      {content}
    </div>
  );
}

function AIBubble({
  content,
  sources,
  isDark,
  isLatest,
  onRegenerate,
  canRegenerate,
}: {
  content: string;
  sources?: any[];
  isDark: boolean;
  isLatest: boolean;
  onRegenerate: () => void;
  canRegenerate: boolean;
}) {
  const rendered = useMemo(() => renderMarkdownLite(content, isDark), [content, isDark]);

  return (
    <div className="flex items-start gap-3 sm:gap-4 w-full">
      <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-1">
        <Sparkles
          className={`w-4 h-4 sm:w-5 sm:h-5 ${isDark ? "text-[#a8c7fa]" : "text-[#0b57d0]"
            }`}
        />
      </div>
      <div className="flex flex-col gap-2 min-w-0 w-full pt-1 sm:pt-1.5">
        <div
          className={`text-[10px] leading-relaxed font-medium break-words bg-[#1E1F20] p-2 max-w-[90%] sm:max-w-[75%] px-5 py-3.5 rounded-[1.5rem] rounded-tl-[4px] shadow-sm leading-relaxed font-medium whitespace-pre-wrap break-words bg-[#1e1f20] text-[#e3e3e3] ${isDark ? "text-[#e3e3e3]" : "text-[#1f1f1f]"
            }`}
        >
          {content ? rendered : <span className="opacity-50 italic">No response.</span>}
        </div>

        <SourcesRow sources={sources} isDark={isDark} />

        <div className="flex items-center gap-1 -ml-3">
          {content && <CopyButton text={content} isDark={isDark} />}
          {isLatest && canRegenerate && (
            <button
              onClick={onRegenerate}
              aria-label="Regenerate response"
              className={`flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-full text-[11px] sm:text-[12px] font-medium transition-colors ${isDark
                ? "hover:bg-[#1e1f20] text-[#a8c7fa]"
                : "hover:bg-gray-100 text-[#0b57d0]"
                }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text, isDark }: { text: string; isDark: boolean }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — fail silently, nothing to recover.
    }
  };

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? "Copied to clipboard" : "Copy response"}
      className={`flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-full text-[11px] sm:text-[12px] font-medium transition-colors ${isDark ? "hover:bg-[#1e1f20] text-[#a8c7fa]" : "hover:bg-gray-100 text-[#0b57d0]"
        }`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SourcesRow({ sources, isDark }: { sources?: any[]; isDark: boolean }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s, idx) => {
        const label =
          (typeof s === "string" && s) ||
          s?.title ||
          s?.name ||
          s?.label ||
          `Source ${idx + 1}`;
        const href = typeof s === "object" ? s?.url || s?.link : undefined;
        const Wrapper: any = href ? "a" : "span";
        return (
          <Wrapper
            key={idx}
            {...(href ? { href, target: "_blank", rel: "noopener noreferrer" } : {})}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${isDark
              ? "border-white/10 bg-white/5 text-[#a8c7fa] hover:bg-white/10"
              : "border-black/5 bg-black/[0.03] text-[#0b57d0] hover:bg-black/[0.06]"
              }`}
          >
            {label}
          </Wrapper>
        );
      })}
    </div>
  );
}

function AIProcessingState({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4 w-full">
      <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full flex-shrink-0 flex items-center justify-center">
        <Sparkles
          className={`w-4 h-4 sm:w-5 sm:h-5 animate-pulse ${isDark ? "text-[#a8c7fa]" : "text-[#0b57d0]"
            }`}
        />
      </div>
      <span className={`shimmer-text text-[15px] font-medium ${isDark ? "shimmer-dark" : "shimmer-light"}`}>
        Thinking&hellip;
      </span>
      <style jsx>{`
        .shimmer-text {
          background-size: 200% 100%;
          background-repeat: no-repeat;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: bhoomi-shimmer 1.6s linear infinite;
        }
        .shimmer-dark {
          background-image: linear-gradient(90deg, #5f6368 25%, #e3e3e3 50%, #5f6368 75%);
        }
        .shimmer-light {
          background-image: linear-gradient(90deg, #9aa0a6 25%, #1f1f1f 50%, #9aa0a6 75%);
        }
        @keyframes bhoomi-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}

function GeminiComposer({
  isDark,
  busy,
  disabled,
  onSend,
  onStop,
}: {
  isDark: boolean;
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim() || busy || disabled) return;
    onSend(input);
    setInput("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
    });
  };

  return (
    <div
      className={`relative flex items-end p-1.5 sm:p-2 rounded-[2rem] sm:rounded-[2.5rem] transition-colors duration-300 ${isDark ? "bg-[#1e1f20]" : "bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)]"
        }`}
    >
      {/* ── Attachment Button (Plus) ── */}
      <button
        disabled={disabled || busy}
        title="Attachments coming soon"
        aria-label="Add attachment"
        className={`flex-shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer m-0.5 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "hover:bg-[#2a2b2f] text-[#e3e3e3]" : "hover:bg-gray-100 text-[#444746]"
          }`}
      >
        <Plus className="w-5 h-5 sm:w-6 sm:h-6" />
      </button>

      {/* ── Auto-expanding Textarea ── */}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        disabled={disabled || busy}
        placeholder={disabled ? "AI is unavailable" : "Ask Bhoomi AI..."}
        aria-label="Message Bhoomi AI"
        className={`flex-1 max-h-[150px] min-h-[44px] py-3.5 sm:py-3.5 px-2 sm:px-3 bg-transparent outline-none resize-none text-[16px] leading-relaxed [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] disabled:opacity-50 ${isDark ? "text-white placeholder:text-[#a8c7fa]/50" : "text-[#1f1f1f] placeholder:text-[#444746]/70"
          }`}
        rows={1}
      />

      {/* ── Trailing Actions (Mic / Stop / Send) ── */}
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 m-0.5 pr-1">
        {!input.trim() && !busy && (
          <button
            disabled={disabled}
            title="Voice input coming soon"
            aria-label="Voice input"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "hover:bg-[#2a2b2f] text-[#e3e3e3]" : "hover:bg-gray-100 text-[#444746]"
              }`}
          >
            <Mic className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {busy ? (
          <button
            onClick={onStop}
            aria-label="Stop generating"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all cursor-pointer ${isDark ? "bg-[#a8c7fa] text-[#041e49] shadow-md" : "bg-[#0b57d0] text-white shadow-md"
              }`}
          >
            <Square className="w-4 h-4" fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || disabled}
            aria-label="Send message"
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:cursor-not-allowed ${input.trim() && !disabled
              ? isDark
                ? "bg-[#a8c7fa] text-[#041e49] shadow-md"
                : "bg-[#0b57d0] text-white shadow-md"
              : isDark
                ? "bg-[#2a2b2f] text-[#e3e3e3]/30"
                : "bg-gray-100 text-[#444746]/30"
              }`}
          >
            <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// LIGHTWEIGHT MARKDOWN RENDERER
// Supports: **bold**, `inline code`, ```code blocks```, "- " / "* " bullet
// lists, "1. " numbered lists, and paragraphs with single-line breaks.
// No HTML injection — everything is built as React elements.
// ============================================================================

function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-b-${i}`}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          className="px-1.5 py-0.5 rounded-md text-[13px] font-mono bg-black/10 dark:bg-white/10"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdownLite(content: string, isDark: boolean): React.ReactNode[] {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;
  let paraBuffer: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (paraBuffer.length) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="mb-2 last:mb-0">
          {paraBuffer.map((ln, idx) => (
            <Fragment key={idx}>
              {idx > 0 && <br />}
              {parseInline(ln, `p${blocks.length}-${idx}`)}
            </Fragment>
          ))}
        </p>
      );
      paraBuffer = [];
    }
  };

  const flushList = () => {
    if (listBuffer) {
      const items = listBuffer.items;
      const isOrdered = listBuffer.type === "ol";
      blocks.push(
        isOrdered ? (
          <ol key={`l-${blocks.length}`} className="mb-2 last:mb-0 list-decimal pl-5 space-y-1">
            {items.map((it, idx) => (
              <li key={idx}>{parseInline(it, `li${blocks.length}-${idx}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={`l-${blocks.length}`} className="mb-2 last:mb-0 list-disc pl-5 space-y-1">
            {items.map((it, idx) => (
              <li key={idx}>{parseInline(it, `li${blocks.length}-${idx}`)}</li>
            ))}
          </ul>
        )
      );
      listBuffer = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      flushPara();
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className={`mb-2 last:mb-0 overflow-x-auto rounded-xl p-3 text-[13px] font-mono ${isDark ? "bg-black/40 text-[#e3e3e3]" : "bg-gray-100 text-[#1f1f1f]"
            }`}
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const bulletMatch = /^\s*[-*]\s+(.*)/.exec(line);
    const numberMatch = /^\s*\d+\.\s+(.*)/.exec(line);

    if (bulletMatch) {
      flushPara();
      if (!listBuffer || listBuffer.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [] };
      }
      listBuffer.items.push(bulletMatch[1]);
    } else if (numberMatch) {
      flushPara();
      if (!listBuffer || listBuffer.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [] };
      }
      listBuffer.items.push(numberMatch[1]);
    } else if (line.trim() === "") {
      flushList();
      flushPara();
    } else {
      flushList();
      paraBuffer.push(line);
    }
    i++;
  }
  flushList();
  flushPara();
  return blocks;
}