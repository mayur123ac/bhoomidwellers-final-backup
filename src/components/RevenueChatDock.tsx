"use client";

/* ══════════════════════════════════════════════════════════════════════════
   RevenueChatDock.tsx — Bhoomi Dwellers CRM

   Ask-anything dock for the Revenue Intelligence panel. Docked bottom-right,
   collapsed to a pill until opened.

   It posts the rows currently filtered on screen to /api/revenue-chat, which
   computes every total in TypeScript before the model sees them. So the answers
   always agree with the table beside it — narrow the filters and the assistant's
   idea of "total" narrows with them. That's stated in the UI, because a figure
   that silently means something different from the screen is worse than no
   figure at all.
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Sparkles, Trash2, X } from "lucide-react";

const CHAT_ENDPOINT = "/api/revenue-chat";
const ACCENT = "#9E217B";

/** Structurally satisfied by the Row type in RevenueIntelligenceView — pass `filtered` straight in. */
export type ChatRow = {
    customerName?: string;
    customerNote?: string;
    bookingNumber?: string;
    flatNo?: string;
    agreementValue?: number;
    ocrReceived?: number;
    ownContributionRequired?: number;
    disbursement?: number;
    balance?: number;
    salesManager?: string;
    bankerDetails?: string;
    statusText?: string;
};

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
    rows: ChatRow[];
    /** Human description of the active filters, e.g. "Neha · in process". */
    filterLabel?: string;
    theme: any;
    isDark: boolean;
};

const STARTERS = [
    "What's still to collect, and from whom?",
    "Which bookings have no OCR received yet?",
    "Break the collection down by sales manager",
    "Who is short on their own contribution?",
];

export default function RevenueChatDock({ rows, filterLabel, theme, isDark }: Props) {
    const [open, setOpen] = useState(false);
    const [turns, setTurns] = useState<Turn[]>([]);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [turns, busy]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && open) setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    /* Only the fields the route reads are sent — no need to ship raw API records. */
    const payloadRows = useMemo(
        () =>
            rows.map((r) => ({
                customerName: r.customerName,
                customerNote: r.customerNote,
                bookingNumber: r.bookingNumber,
                flatNo: r.flatNo,
                agreementValue: r.agreementValue,
                ocrReceived: r.ocrReceived,
                ownContributionRequired: r.ownContributionRequired,
                disbursement: r.disbursement,
                balance: r.balance,
                salesManager: r.salesManager,
                bankerDetails: r.bankerDetails,
                statusText: r.statusText,
            })),
        [rows]
    );

    const ask = useCallback(
        async (question: string) => {
            const clean = question.trim();
            if (!clean || busy) return;
            if (!payloadRows.length) {
                setError("There are no bookings in the current view to answer from.");
                return;
            }

            setError("");
            setDraft("");
            const historyBefore = turns;
            setTurns((prev) => [...prev, { role: "user", content: clean }]);
            setBusy(true);

            try {
                const res = await fetch(CHAT_ENDPOINT, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        question: clean,
                        history: historyBefore,
                        rows: payloadRows,
                        filter_label: filterLabel || "",
                    }),
                });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.message || "The assistant could not answer.");
                setTurns((prev) => [...prev, { role: "assistant", content: json.data.answer }]);
            } catch (err: any) {
                setError(err.message || "The assistant could not answer.");
                // The question stays in the thread so it can be retried without retyping.
            } finally {
                setBusy(false);
                inputRef.current?.focus();
            }
        },
        [busy, payloadRows, filterLabel, turns]
    );

    /* ── collapsed ── */
    // if (!open) {
    //     return (
    //         <button
    //             onClick={() => setOpen(true)}
    //             className="fixed bottom-6 right-6 z-40 h-11 pl-3.5 pr-4 rounded-full text-white text-xs font-black inline-flex items-center gap-2 shadow-lg transition-transform hover:-translate-y-0.5"
    //             style={{ background: ACCENT }}
    //             aria-label="Ask about this data"
    //         >
    //             <MessageCircle className="w-4 h-4" />
    //             Ask about this data
    //         </button>
    //     );
    // }

    // const bubbleBase = "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap";

    // return (
    //     <div
    //         className={`fixed bottom-6 right-6 z-40 w-[min(420px,calc(100vw-3rem))] max-h-[min(620px,calc(100vh-6rem))] flex flex-col rounded-2xl border overflow-hidden shadow-2xl ${isDark ? "border-white/10 bg-[#0d0d12]" : "border-slate-200 bg-white"
    //             }`}
    //         role="dialog"
    //         aria-label="Revenue assistant"
    //     >
    //         {/* header */}
    //         <header className={`px-4 py-3 border-b flex items-start justify-between gap-3 ${theme.tableBorder}`}>
    //             <div className="min-w-0">
    //                 <h2 className={`text-sm font-black inline-flex items-center gap-1.5 ${theme.text}`}>
    //                     <Sparkles className="w-3.5 h-3.5" style={{ color: ACCENT }} />
    //                     Revenue assistant
    //                 </h2>
    //                 <p className={`text-[10px] mt-0.5 truncate ${theme.textMuted}`}>
    //                     Reading {rows.length} booking{rows.length === 1 ? "" : "s"}
    //                     {filterLabel ? ` · ${filterLabel}` : " · no filters"}
    //                 </p>
    //             </div>
    //             <div className="flex items-center gap-1 flex-shrink-0">
    //                 {turns.length > 0 && (
    //                     <button
    //                         onClick={() => {
    //                             setTurns([]);
    //                             setError("");
    //                         }}
    //                         className={`p-1.5 rounded-lg ${isDark ? "hover:bg-white/10 text-gray-400" : "hover:bg-slate-100 text-slate-400"}`}
    //                         aria-label="Clear conversation"
    //                         title="Clear conversation"
    //                     >
    //                         <Trash2 className="w-3.5 h-3.5" />
    //                     </button>
    //                 )}
    //                 <button
    //                     onClick={() => setOpen(false)}
    //                     className={`p-1.5 rounded-lg ${isDark ? "hover:bg-white/10 text-gray-300" : "hover:bg-slate-100 text-slate-500"}`}
    //                     aria-label="Close"
    //                 >
    //                     <X className="w-4 h-4" />
    //                 </button>
    //             </div>
    //         </header>

    //         {/* thread */}
    //         <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
    //             {turns.length === 0 ? (
    //                 <div className="space-y-3">
    //                     <p className={`text-[12px] leading-relaxed ${theme.textMuted}`}>
    //                         Ask about the bookings currently on screen. Every total is computed from the table itself, so the answers
    //                         match what you can see — change the filters and the answers follow.
    //                     </p>
    //                     <div className="space-y-1.5">
    //                         {STARTERS.map((s) => (
    //                             <button
    //                                 key={s}
    //                                 onClick={() => ask(s)}
    //                                 className={`w-full text-left text-[12px] px-3 py-2 rounded-xl border transition-colors ${isDark
    //                                     ? "border-white/10 text-gray-200 hover:bg-white/[0.06]"
    //                                     : "border-slate-200 text-slate-700 hover:bg-slate-50"
    //                                     }`}
    //                             >
    //                                 {s}
    //                             </button>
    //                         ))}
    //                     </div>
    //                 </div>
    //             ) : (
    //                 turns.map((turn, i) => (
    //                     <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
    //                         <div
    //                             className={
    //                                 turn.role === "user"
    //                                     ? `${bubbleBase} text-white`
    //                                     : `${bubbleBase} border ${isDark ? "border-white/10 bg-white/[0.04] text-gray-100" : "border-slate-200 bg-slate-50 text-slate-800"
    //                                     }`
    //                             }
    //                             style={turn.role === "user" ? { background: ACCENT } : undefined}
    //                         >
    //                             {turn.content}
    //                         </div>
    //                     </div>
    //                 ))
    //             )}

    //             {busy && (
    //                 <div className="flex justify-start">
    //                     <div
    //                         className={`rounded-2xl px-3.5 py-2.5 border inline-flex items-center gap-2 text-[12px] ${isDark ? "border-white/10 bg-white/[0.04] text-gray-300" : "border-slate-200 bg-slate-50 text-slate-500"
    //                             }`}
    //                     >
    //                         <Loader2 className="w-3.5 h-3.5 animate-spin" />
    //                         Reading the table…
    //                     </div>
    //                 </div>
    //             )}

    //             {error && <p className="text-[11px] font-semibold text-rose-500">{error}</p>}
    //         </div>

    //         {/* composer */}
    //         <div className={`px-3 py-3 border-t ${theme.tableBorder}`}>
    //             <div className="flex items-end gap-2">
    //                 <textarea
    //                     ref={inputRef}
    //                     value={draft}
    //                     onChange={(e) => setDraft(e.target.value)}
    //                     onKeyDown={(e) => {
    //                         if (e.key === "Enter" && !e.shiftKey) {
    //                             e.preventDefault();
    //                             ask(draft);
    //                         }
    //                     }}
    //                     rows={1}
    //                     placeholder="How much is still to collect from Neha's bookings?"
    //                     className={`flex-1 resize-none rounded-xl px-3 py-2 text-[13px] leading-relaxed outline-none border max-h-28 ${isDark ? "border-white/10 bg-white/[0.04] text-gray-100" : "border-slate-200 bg-white text-slate-800"
    //                         }`}
    //                 />
    //                 <button
    //                     onClick={() => ask(draft)}
    //                     disabled={!draft.trim() || busy}
    //                     className="h-9 w-9 rounded-xl inline-flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
    //                     style={{ background: ACCENT }}
    //                     aria-label="Send"
    //                 >
    //                     <Send className="w-3.5 h-3.5" />
    //                 </button>
    //             </div>
    //             <p className={`text-[10px] mt-1.5 ${theme.textMuted}`}>
    //                 Enter sends · Shift + Enter for a new line. Figures come from this table only — check the ledger before
    //                 quoting anything externally.
    //             </p>
    //         </div>
    //     </div>
    // );
}