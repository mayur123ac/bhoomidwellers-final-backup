"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Trash2, X, TerminalSquare } from "lucide-react";
import { CRMContextManager } from "@/lib/admin-ai/contextManager";

const CHAT_ENDPOINT = "/api/admin/ai/chat";
const ACCENT = "#9E217B";

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
    theme: any;
    isDark: boolean;
};

const STARTERS = [
    "How much OCR was collected this month?",
    "Which sales manager has the highest agreement value?",
    "Show bookings awaiting registration",
    "What is the balance receivable?"
];

export default function AdminAssistantDock({ theme, isDark }: Props) {
    const [open, setOpen] = useState(false);
    const [turns, setTurns] = useState<Turn[]>([]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [showDebug, setShowDebug] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [open, turns, busy, error]);

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
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full px-5 py-3 shadow-lg transition-transform hover:scale-105 active:scale-95"
                style={{ backgroundColor: ACCENT, color: "white" }}
            >
                <Sparkles size={18} />
                <span className="font-medium tracking-tight">Admin AI</span>
            </button>
        );
    }

    return (
        <div
            className={`fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl shadow-2xl transition-all w-96 max-w-[calc(100vw-32px)] sm:w-[420px] ${
                isDark ? "bg-[#121212] border border-[#2a2a2a]" : "bg-white border border-indigo-200"
            }`}
            style={{ height: "min(600px, calc(100vh - 48px))" }}
        >
            {/* HEADER */}
            <div
                className={`flex shrink-0 items-center justify-between rounded-t-2xl p-4 ${
                    isDark ? "bg-[#1a1a1a] border-b border-[#2a2a2a]" : "bg-indigo-50 border-b border-indigo-100"
                }`}
            >
                <div className="flex items-center gap-2">
                    <Sparkles size={18} color={ACCENT} />
                    <div>
                        <div className={`font-semibold tracking-tight ${isDark ? "text-white" : "text-indigo-950"}`}>
                            Admin AI Analyst
                        </div>
                        <div className={`text-xs ${isDark ? "text-neutral-400" : "text-indigo-600/70"}`}>
                            Database connected · Live queries
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        title="Toggle Developer Debug Mode"
                        className={`rounded p-1.5 transition-colors ${
                            isDark ? (showDebug ? "bg-[#333] text-white" : "text-neutral-400 hover:bg-[#333] hover:text-white") 
                            : (showDebug ? "bg-indigo-100 text-indigo-900" : "text-indigo-400 hover:bg-indigo-100 hover:text-indigo-900")
                        }`}
                    >
                        <TerminalSquare size={16} />
                    </button>
                    <button
                        onClick={() => { setTurns([]); setError(""); }}
                        title="Clear history"
                        className={`rounded p-1.5 transition-colors ${
                            isDark ? "text-neutral-400 hover:bg-[#333] hover:text-white" : "text-indigo-400 hover:bg-indigo-100 hover:text-indigo-900"
                        }`}
                    >
                        <Trash2 size={16} />
                    </button>
                    <button
                        onClick={() => setOpen(false)}
                        className={`rounded p-1.5 transition-colors ${
                            isDark ? "text-neutral-400 hover:bg-[#333] hover:text-white" : "text-indigo-400 hover:bg-indigo-100 hover:text-indigo-900"
                        }`}
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* SCROLL VIEW */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {turns.length === 0 && (
                    <div className="my-auto text-center space-y-4">
                        <div
                            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full opacity-50"
                            style={{ backgroundColor: ACCENT, color: "white" }}
                        >
                            <Sparkles size={24} />
                        </div>
                        <p className={`text-sm ${isDark ? "text-neutral-400" : "text-neutral-500"}`}>
                            Ask me to analyze live CRM data, generate revenue summaries, or check registration status.
                        </p>
                        <div className="flex flex-col gap-2">
                            {STARTERS.map((s, i) => (
                                <button
                                    key={i}
                                    onClick={() => submit(s)}
                                    className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                                        isDark
                                            ? "border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#444] text-neutral-300"
                                            : "border-indigo-100 bg-white hover:border-indigo-300 hover:bg-indigo-50 text-indigo-900"
                                    }`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {turns.map((t, i) => {
                    const isUser = t.role === "user";
                    return (
                        <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                            <div
                                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ${
                                    isUser
                                        ? "text-white"
                                        : isDark
                                        ? "bg-[#1a1a1a] border border-[#2a2a2a] text-neutral-200"
                                        : "bg-white border border-indigo-100 text-neutral-800"
                                }`}
                                style={isUser ? { backgroundColor: ACCENT } : {}}
                            >
                                {t.content}
                            </div>
                        </div>
                    );
                })}

                {busy && (
                    <div className="flex justify-start">
                        <div
                            className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 shadow-sm ${
                                isDark ? "bg-[#1a1a1a] border border-[#2a2a2a]" : "bg-white border border-indigo-100"
                            }`}
                        >
                            <Loader2 size={16} className="animate-spin" color={ACCENT} />
                            <span className={`text-sm ${isDark ? "text-neutral-400" : "text-neutral-500"}`}>
                                Querying database...
                            </span>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="mx-auto mt-2 rounded bg-red-500/10 px-3 py-2 text-sm font-medium text-red-500">
                        {error}
                    </div>
                )}

                <div ref={endRef} />
            </div>

            {/* DEBUG PANEL */}
            {showDebug && (
                <div className={`shrink-0 border-t p-3 text-[10px] overflow-y-auto max-h-32 ${isDark ? "border-[#2a2a2a] bg-[#1a1a1a] text-neutral-400" : "border-indigo-100 bg-indigo-50 text-indigo-800 font-mono"}`}>
                    <div className="font-bold mb-1">Context Inspector (Dev Mode)</div>
                    <div><strong>Module:</strong> {CRMContextManager.get()?.module || "None"}</div>
                    <div><strong>Filters:</strong> {JSON.stringify(CRMContextManager.get()?.filters || {})}</div>
                    <div><strong>Rows sent:</strong> {CRMContextManager.get()?.rows?.length || 0} / {CRMContextManager.get()?.totalRows || 0}</div>
                    <div><strong>Selected Row:</strong> {CRMContextManager.get()?.selectedRow ? "Yes" : "No"}</div>
                </div>
            )}

            {/* INPUT FIELD */}
            <div
                className={`shrink-0 border-t p-3 ${
                    isDark ? "border-[#2a2a2a] bg-[#121212]" : "border-indigo-100 bg-indigo-50/50"
                }`}
            >
                <div
                    className={`relative flex items-end rounded-xl border shadow-inner transition-colors focus-within:ring-2 focus-within:ring-offset-0 ${
                        isDark
                            ? "border-[#333] bg-[#0a0a0f] focus-within:border-transparent focus-within:ring-[#9E217B]/50"
                            : "border-indigo-200 bg-white focus-within:border-transparent focus-within:ring-indigo-300"
                    }`}
                >
                    <textarea
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Ask about revenue, loans, or sales..."
                        className="max-h-32 min-h-[44px] w-full resize-none bg-transparent py-3 pl-4 pr-12 text-sm text-inherit placeholder-neutral-400 focus:outline-none"
                        rows={1}
                        autoFocus
                    />
                    <button
                        onClick={() => submit()}
                        disabled={!draft.trim() || busy}
                        className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:opacity-30"
                        style={{ color: draft.trim() ? ACCENT : "currentColor" }}
                    >
                        <Send size={18} />
                    </button>
                </div>
                <div className={`mt-2 text-center text-[10px] ${isDark ? "text-neutral-500" : "text-neutral-400"}`}>
                    Enter sends · Shift + Enter for a new line. Answers directly from DB.
                </div>
            </div>
        </div>
    );
}
