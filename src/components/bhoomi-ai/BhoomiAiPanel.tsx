"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Send, Plus, AlertCircle, RefreshCw, Sparkles,
  ChevronRight, AlignLeft, BarChart3, Users, Building
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
    if (endRef.current) {
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
    <main className={`flex h-full flex-col overflow-hidden relative font-sans antialiased ${isDark ? "bg-[#000000]" : "bg-[#F5F5F7]"}`}>

      {/* ── Background Glow (Subtle, Premium) ── */}
      {empty && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-40 z-0">
          <div className="w-[600px] h-[600px] rounded-full blur-[120px]" style={{
            background: isDark
              ? "radial-gradient(circle, rgba(10,132,255,0.15) 0%, rgba(191,90,242,0.05) 50%, transparent 70%)"
              : "radial-gradient(circle, rgba(0,122,255,0.1) 0%, rgba(175,82,222,0.05) 50%, transparent 70%)"
          }} />
        </div>
      )}

      {/* ── Header ── */}
      <header className={`flex-shrink-0 flex items-center justify-between px-6 py-4 z-20 border-b backdrop-blur-2xl ${isDark ? "bg-[#1C1C1E]/80 border-white/10" : "bg-white/80 border-black/5"}`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shadow-sm ${isDark ? "bg-white/10 text-white" : "bg-black/5 text-[#1D1D1F]"}`}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h1 className={`text-[15px] font-semibold tracking-tight leading-tight ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>Bhoomi AI</h1>
            <p className={`text-[11px] font-medium tracking-wide ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>Intelligent CRM Analyst</p>
          </div>
        </div>

        <button
          onClick={newChat}
          disabled={empty && !error}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${isDark
              ? "bg-[#2C2C2E] hover:bg-[#3A3A3C] text-white border border-white/5"
              : "bg-white hover:bg-black/5 text-[#1D1D1F] border border-black/10 shadow-sm"
            }`}
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
      </header>

      {/* ── Scrollable Conversation Area ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar relative z-10 scroll-smooth">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-8 pb-40">

          {empty ? (
            <AIEmptyState isDark={isDark} userName={user?.name} onSuggest={ask} disabled={blocked} />
          ) : (
            <div className="flex flex-col space-y-8">
              <AnimatePresence initial={false}>
                {turns.map((turn, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
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
          )}
        </div>
      </div>

      {/* ── Floating Composer ── */}
      <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none">
        {/* Subtle gradient fade to hide text going under the composer */}
        <div className={`h-12 w-full bg-gradient-to-t to-transparent ${isDark ? "from-[#000000]" : "from-[#F5F5F7]"}`} />
        <div className={`p-4 sm:p-6 pb-6 sm:pb-8 pointer-events-auto backdrop-blur-xl ${isDark ? "bg-[#000000]/80" : "bg-[#F5F5F7]/80"}`}>
          <div className="mx-auto w-full max-w-3xl">
            <AIComposer
              isDark={isDark}
              busy={busy}
              disabled={blocked}
              onSend={ask}
            />
          </div>
        </div>
      </div>

    </main>
  );
}

// ============================================================================
// SUB-COMPONENTS (Inline for drop-in replacement)
// ============================================================================

function AIEmptyState({ isDark, userName, onSuggest, disabled }: { isDark: boolean, userName: string, onSuggest: (q: string) => void, disabled: boolean }) {
  const firstName = userName?.split(" ")[0] || "there";

  const suggestions = [
    { icon: <BarChart3 className="w-4 h-4" />, title: "Pipeline Overview", prompt: "Give me a summary of our entire lead pipeline right now." },
    { icon: <Users className="w-4 h-4" />, title: "Follow-up Queue", prompt: "Which leads have had no contact in the last 3 days?" },
    { icon: <Building className="w-4 h-4" />, title: "Inventory Insights", prompt: "Which projects have the highest demand this month?" },
    { icon: <AlignLeft className="w-4 h-4" />, title: "Draft a Message", prompt: "Draft a polite WhatsApp message to a lead who hasn't replied." },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="flex flex-col items-center justify-center pt-8 sm:pt-16 text-center">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-sm ${isDark ? "bg-[#1C1C1E] text-white border border-white/10" : "bg-white text-[#1D1D1F] border border-black/5"}`}>
        <Bot className="w-8 h-8" strokeWidth={1.5} />
      </div>
      <h2 className={`text-2xl sm:text-3xl font-semibold tracking-tight mb-2 ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
        Good morning, {firstName}
      </h2>
      <p className={`text-sm sm:text-base font-medium mb-12 max-w-md ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
        I'm your AI business analyst. Ask me anything about your CRM data, leads, or performance.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-2xl">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            onClick={() => onSuggest(s.prompt)}
            disabled={disabled}
            className={`flex items-center gap-3 p-4 rounded-[1.25rem] text-left transition-all active:scale-95 border disabled:opacity-50 disabled:cursor-not-allowed ${isDark
                ? "bg-[#1C1C1E] border-white/5 hover:bg-[#2C2C2E] text-white"
                : "bg-white border-black/5 hover:shadow-md text-[#1D1D1F]"
              }`}
          >
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isDark ? "bg-white/10" : "bg-black/5"}`}>
              {s.icon}
            </div>
            <span className="text-sm font-medium tracking-tight">{s.title}</span>
            <ChevronRight className={`w-4 h-4 ml-auto opacity-50 ${isDark ? "text-white" : "text-black"}`} />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

function UserBubble({ content, isDark }: { content: string, isDark: boolean }) {
  return (
    <div className={`max-w-[85%] sm:max-w-[75%] px-5 py-3.5 rounded-[1.5rem] rounded-tr-[4px] shadow-sm text-[15px] leading-relaxed font-medium ${isDark
        ? "bg-[#0A84FF] text-white"
        : "bg-[#007AFF] text-white"
      }`}>
      {content}
    </div>
  );
}

function AIBubble({ content, isDark, isLatest, onRegenerate, canRegenerate }: { content: string, isDark: boolean, isLatest: boolean, onRegenerate: () => void, canRegenerate: boolean }) {
  return (
    <div className="flex items-start gap-4 max-w-[95%] sm:max-w-[85%]">
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-1 border shadow-sm ${isDark ? "bg-[#1C1C1E] border-white/10 text-white" : "bg-white border-black/5 text-[#1D1D1F]"
        }`}>
        <Sparkles className="w-4 h-4" />
      </div>
      <div className="flex flex-col gap-2 min-w-0">
        <div className={`text-[15px] leading-relaxed font-medium whitespace-pre-wrap break-words ${isDark ? "text-gray-200" : "text-[#1D1D1F]"}`}>
          {/* Note: In a full app, you'd run 'content' through a React Markdown parser here. 
              Using whitespace-pre-wrap maintains formatting without complex dependencies. */}
          {content}
        </div>

        {isLatest && canRegenerate && (
          <button
            onClick={onRegenerate}
            className={`mt-2 flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${isDark
                ? "bg-[#1C1C1E] hover:bg-[#2C2C2E] text-[#98989D] hover:text-white border border-white/5"
                : "bg-white hover:bg-black/5 text-[#86868B] hover:text-black border border-black/10 shadow-sm"
              }`}
          >
            <RefreshCw className="w-3 h-3" />
            Regenerate response
          </button>
        )}
      </div>
    </div>
  );
}

function AIProcessingState({ isDark }: { isDark: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center border shadow-sm ${isDark ? "bg-[#1C1C1E] border-white/10 text-[#0A84FF]" : "bg-white border-black/5 text-[#007AFF]"
        }`}>
        <Sparkles className="w-4 h-4 animate-pulse" />
      </div>
      <div className={`text-[13px] font-medium tracking-wide animate-pulse ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
        Analyzing data...
      </div>
    </div>
  );
}

function AIComposer({ isDark, busy, disabled, onSend }: { isDark: boolean, busy: boolean, disabled: boolean, onSend: (text: string) => void }) {
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
    <div className={`relative flex items-end p-2 rounded-[2rem] border transition-all duration-300 shadow-sm focus-within:shadow-md ${isDark
        ? "bg-[#1C1C1E] border-white/10 focus-within:border-white/20"
        : "bg-white border-black/10 focus-within:border-black/20"
      }`}>
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
        className={`flex-1 max-h-[200px] min-h-[44px] py-3.5 px-4 bg-transparent outline-none resize-none text-[15px] leading-relaxed font-medium custom-scrollbar disabled:opacity-50 ${isDark ? "text-white placeholder:text-[#636366]" : "text-[#1D1D1F] placeholder:text-[#A1A1A6]"
          }`}
        rows={1}
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim() || busy || disabled}
        className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer m-0.5 disabled:cursor-not-allowed ${input.trim() && !busy && !disabled
            ? (isDark ? "bg-[#0A84FF] text-white shadow-md active:scale-95" : "bg-[#007AFF] text-white shadow-md active:scale-95")
            : (isDark ? "bg-white/5 text-[#636366]" : "bg-black/5 text-[#A1A1A6]")
          }`}
      >
        <Send className="w-4 h-4 ml-[-2px]" />
      </button>
    </div>
  );
}