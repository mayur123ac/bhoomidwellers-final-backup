"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Plus, AlertCircle, RefreshCw, Sparkles,
  Mic, ArrowUp, X
} from "lucide-react";
import { CRMContextManager } from "@/lib/admin-ai/contextManager";

const CHAT_ENDPOINT = "/api/admin/ai/chat";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: any[];
  typing?: boolean;
}

interface Props {
  isDark: boolean;
  t: any;
  user: any;
}

// ============================================================================
// MAIN PANEL COMPONENT
// ============================================================================
export default function BhoomiAiPanel({ isDark, t, user }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
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
  const ask = useCallback(
    async (question: string, opts?: { replaceLast?: boolean }) => {
      if (busy) return;
      setError("");
      setBusy(true);
      lastQuery.current = question;

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
      }
    },
    [busy]
  );

  const retry = useCallback(() => {
    const q = lastQuery.current;
    if (!q || busy) return;
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
  }, []);

  const blocked = configured === false;
  const empty = turns.length === 0 && !busy;

  // ── UI / UX Rendering ──
  return (
    <main className={`flex h-full flex-col overflow-hidden relative font-sans antialiased transition-colors duration-500 ${isDark ? "bg-transparent" : "bg-transparent"}`}>

      {/* ── Animated Ambient Color Spread (The Gemini Glow) ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 flex items-center justify-center">
        {/* Primary Blue Aura */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: isDark ? [0.4, 0.7, 0.4] : [0.6, 0.9, 0.6],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute w-[80vw] h-[80vw] max-w-[900px] max-h-[900px] rounded-full blur-[100px] sm:blur-[160px] ${isDark ? "bg-[#1c4ed8]" : "bg-[#c2d7fa]"
            }`}
        />
        {/* Secondary Violet Aura */}
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: isDark ? [0.3, 0.6, 0.3] : [0.5, 0.8, 0.5],
            x: ["-5%", "5%", "-5%"],
            y: ["5%", "-5%", "5%"]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute w-[70vw] h-[70vw] max-w-[700px] max-h-[700px] rounded-full blur-[100px] sm:blur-[140px] ${isDark ? "bg-[#6b21a8]" : "bg-[#e2d4f5]"
            }`}
        />
      </div>

      {/* ── Header ── */}
      <header className={`flex-shrink-0 flex items-center justify-between px-6 py-4 z-20 relative transition-colors duration-500 ${isDark ? "border-white/10 bg-transparent/50" : "border-black/5 bg-transparent/50"}`}>
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 flex items-center justify-center">
            <Sparkles className={`w-5 h-5 ${isDark ? "text-[#a8c7fa]" : "text-[#0b57d0]"}`} />
          </div>
          <h1 className={`text-base font-medium tracking-tight ${isDark ? "text-white" : "text-[#1f1f1f]"}`}>
            Bhoomi AI
          </h1>
        </div>

        <button
          onClick={newChat}
          disabled={empty && !error}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium transition-all active:scale-95 disabled:opacity-0 disabled:pointer-events-none ${isDark
            ? "bg-[#282a2c] hover:bg-[#333537] text-[#e3e3e3]"
            : "bg-white hover:bg-gray-50 text-[#1f1f1f] shadow-sm"
            }`}
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </header>

      {/* ── Main Canvas (Flex layout handles smooth translation of composer) ── */}
      <div className="flex-1 min-h-0 flex flex-col relative z-10 px-4 sm:px-6 w-full max-w-4xl mx-auto">

        {/* Spacer to push content down when empty */}
        {empty && <div className="flex-1" />}

        {/* Scrollable Conversation Area (Hidden when empty) */}
        {!empty && (
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar scroll-smooth pt-4 pb-8">
            <div className="flex flex-col space-y-8">
              <AnimatePresence initial={false}>
                {turns.map((turn, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {turn.role === "user" ? (
                      <UserBubble content={turn.content} isDark={isDark} />
                    ) : (
                      <AIBubble
                        content={turn.content}
                        isDark={isDark}
                        isLatest={i === turns.length - 1}
                        onRegenerate={regenerate}
                        canRegenerate={i === turns.length - 1 && !busy}
                      />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {busy && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                  <AIProcessingState isDark={isDark} />
                </motion.div>
              )}

              {error && (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={`flex items-start gap-3 p-4 rounded-2xl border ${isDark ? "bg-[#FF3B30]/10 border-[#FF3B30]/20 text-[#FF453A]" : "bg-red-50 border-red-200 text-red-600"}`}>
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium leading-relaxed">{error}</p>
                    {lastQuery.current && !blocked && (
                      <button onClick={retry} disabled={busy} className={`mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${isDark ? "bg-[#FF3B30]/20 hover:bg-[#FF3B30]/30 text-white" : "bg-red-100 hover:bg-red-200 text-red-700"}`}>
                        Try Again
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              <div ref={endRef} className="h-4" />
            </div>
          </div>
        )}

        {/* ── Central / Bottom Interactive Block (Composer + Greeting) ── */}
        <motion.div
          layout
          className={`flex flex-col w-full shrink-0 ${empty ? "items-center" : "pb-6"}`}
        >
          {empty && (
            <motion.h1
              layout
              className={`text-4xl sm:text-5xl font-medium tracking-tight mb-8 sm:mb-10 text-center ${isDark
                ? "text-transparent bg-clip-text bg-gradient-to-r from-gray-200 to-gray-500"
                : "text-transparent bg-clip-text bg-gradient-to-r from-gray-800 to-gray-500"
                }`}
            >
              What's next, {firstName}?
            </motion.h1>
          )}

          <motion.div layout className="w-full">
            <GeminiComposer
              isDark={isDark}
              busy={busy}
              disabled={blocked}
              onSend={ask}
            />
          </motion.div>
        </motion.div>

        {/* Spacer to push content up when empty, ensuring vertical centering */}
        {empty && <div className="flex-1" />}

      </div>
    </main>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function UserBubble({ content, isDark }: { content: string, isDark: boolean }) {
  return (
    <div className={`max-w-[85%] sm:max-w-[75%] px-5 py-3.5 rounded-[1.5rem] rounded-tr-[4px] shadow-sm text-[15px] leading-relaxed font-medium ${isDark
      ? "bg-[#2a2b2f] text-[#e3e3e3]"
      : "bg-[#e9eef6] text-[#1f1f1f]"
      }`}>
      {content}
    </div>
  );
}

function AIBubble({ content, isDark, isLatest, onRegenerate, canRegenerate }: { content: string, isDark: boolean, isLatest: boolean, onRegenerate: () => void, canRegenerate: boolean }) {
  return (
    <div className="flex items-start gap-4 w-full">
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-1`}>
        <Sparkles className={`w-5 h-5 ${isDark ? "text-[#a8c7fa]" : "text-[#0b57d0]"}`} />
      </div>
      <div className="flex flex-col gap-2 min-w-0 w-full pt-1.5">
        <div className={`text-[15px] leading-relaxed whitespace-pre-wrap break-words ${isDark ? "text-[#e3e3e3]" : "text-[#1f1f1f]"}`}>
          {content}
        </div>

        {isLatest && canRegenerate && (
          <button
            onClick={onRegenerate}
            className={`mt-3 flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${isDark
              ? "hover:bg-[#282a2c] text-[#a8c7fa]"
              : "hover:bg-gray-100 text-[#0b57d0]"
              }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Regenerate response
          </button>
        )}
      </div>
    </div>
  );
}

function AIProcessingState({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center gap-4 w-full">
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center">
        <Sparkles className={`w-5 h-5 animate-pulse ${isDark ? "text-[#a8c7fa]" : "text-[#0b57d0]"}`} />
      </div>
      <div className="flex gap-1.5 pt-1">
        {[0, 200, 400].map((d, i) => (
          <span
            key={i}
            className={`block w-1.5 h-1.5 rounded-full animate-bounce ${isDark ? "bg-[#a8c7fa]" : "bg-[#0b57d0]"}`}
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function GeminiComposer({ isDark, busy, disabled, onSend }: { isDark: boolean, busy: boolean, disabled: boolean, onSend: (text: string) => void }) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim() || busy || disabled) return;
    onSend(input);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className={`relative flex items-end p-2 sm:p-2.5 rounded-[2.5rem] transition-colors duration-300 shadow-sm ${isDark
      ? "bg-[#1e1f20]"
      : "bg-white border border-[#d3e3fd]/60 shadow-[0_4px_24px_rgba(0,0,0,0.04)]"
      }`}>
      {/* ── Attachment Button (Plus) ── */}
      <button
        disabled={disabled || busy}
        className={`flex-shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer m-0.5 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "hover:bg-[#282a2c] text-[#e3e3e3]" : "hover:bg-gray-100 text-[#444746]"
          }`}
      >
        <Plus className="w-5 h-5" />
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
        placeholder={disabled ? "AI is currently unavailable" : "Ask Bhoomi AI..."}
        className={`flex-1 max-h-[200px] min-h-[44px] py-3.5 px-3 bg-transparent outline-none resize-none text-[15px] sm:text-[16px] leading-relaxed custom-scrollbar disabled:opacity-50 ${isDark ? "text-white placeholder:text-[#a8c7fa]/50" : "text-[#1f1f1f] placeholder:text-[#444746]/70"
          }`}
        rows={1}
      />

      {/* ── Trailing Actions (Mic & Send) ── */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 m-0.5">
        {!input.trim() && (
          <button
            disabled={disabled || busy}
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "hover:bg-[#282a2c] text-[#e3e3e3]" : "hover:bg-gray-100 text-[#444746]"
              }`}
          >
            <Mic className="w-5 h-5" />
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || busy || disabled}
          className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:cursor-not-allowed ${input.trim() && !busy && !disabled
            ? (isDark ? "bg-[#a8c7fa] text-[#041e49] shadow-md" : "bg-[#0b57d0] text-white shadow-md")
            : (isDark ? "bg-[#282a2c] text-[#e3e3e3]/30" : "bg-gray-100 text-[#444746]/30")
            }`}
        >
          <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}