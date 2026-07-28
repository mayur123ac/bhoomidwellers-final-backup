"use client";

/* ══════════════════════════════════════════════════════════════════════════
   ReceiptComposition.tsx

   Breaks "Revenue Received" down into the individual receipts that produced
   it — token, booking amount, OCR, cash component, loan disbursement — plus
   the government charges collected alongside (SDR / GST / statutory), which
   are NOT developer revenue.

   Reads `record.receipt_lines`, emitted by enrichRevenueRecord(). Clicking a
   line opens a `receipt:<key>` slice; clicking its unconfirmed figure opens
   `receipt_unconfirmed:<key>`.
   ══════════════════════════════════════════════════════════════════════════ */

import React, { useMemo } from "react";
import {
    AlertTriangle,
    Banknote,
    FileSpreadsheet,
    FileText,
    IndianRupee,
    Landmark,
    Layers3,
    Wallet,
} from "lucide-react";
import { formatRevenueAmount } from "@/lib/revenueCalculations";

/* ─────────────── line catalogue (display order) ─────────────── */

const RECEIPT_LINES = [
    { key: "token_amount", label: "Token / Earnest", Icon: Wallet, tone: "cyan", government: false },
    { key: "booking_amount", label: "Booking Amount", Icon: IndianRupee, tone: "magenta", government: false },
    { key: "ocr_amount", label: "OCR (Own Contribution)", Icon: FileText, tone: "emerald", government: false },
    { key: "cash_component", label: "Cash Component", Icon: Banknote, tone: "amber", government: false },
    { key: "disbursement_amount", label: "Loan Disbursement", Icon: Landmark, tone: "violet", government: false },
    { key: "sdr_amount", label: "SDR — Stamp Duty + Reg.", Icon: FileSpreadsheet, tone: "slate", government: true },
    { key: "gst_amount", label: "GST", Icon: FileSpreadsheet, tone: "slate", government: true },
    { key: "other_government_charges", label: "Other Statutory", Icon: FileSpreadsheet, tone: "slate", government: true },
] as const;

/* ─────────────── local style helpers (kept standalone) ─────────────── */

function cardTone(tone: string, isDark: boolean) {
    const tones: Record<string, string> = {
        magenta: isDark ? "border-[#9E217B]/40 bg-[#9E217B]/10" : "border-[#9E217B]/25 bg-[#9E217B]/5",
        cyan: isDark ? "border-cyan-500/30 bg-cyan-500/10" : "border-cyan-200 bg-cyan-50/70",
        emerald: isDark ? "border-emerald-500/30 bg-emerald-500/10" : "border-emerald-200 bg-emerald-50/70",
        amber: isDark ? "border-amber-500/30 bg-amber-500/10" : "border-amber-200 bg-amber-50/70",
        rose: isDark ? "border-rose-500/30 bg-rose-500/10" : "border-rose-200 bg-rose-50/70",
        violet: isDark ? "border-violet-500/30 bg-violet-500/10" : "border-violet-200 bg-violet-50/70",
        slate: isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-white",
    };
    return tones[tone] || tones.slate;
}

function pill(isDark: boolean, tone: "success" | "warning" | "danger" | "info" | "muted") {
    const tones = {
        success: isDark ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200",
        warning: isDark ? "bg-amber-500/10 text-amber-300 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200",
        danger: isDark ? "bg-rose-500/10 text-rose-300 border-rose-500/30" : "bg-rose-50 text-rose-700 border-rose-200",
        info: isDark ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" : "bg-cyan-50 text-cyan-700 border-cyan-200",
        muted: isDark ? "bg-white/5 text-gray-300 border-white/10" : "bg-slate-50 text-slate-600 border-slate-200",
    };
    return tones[tone];
}

/* ─────────────── helpers exported for the parent view ─────────────── */

/** Confirmed amount of one receipt line on one booking. */
export function receiptLineAmount(record: any, key: string): number {
    const line = (record?.receipt_lines || []).find((l: any) => l.key === key);
    return line?.received && !line?.suppressed ? Number(line.amount) || 0 : 0;
}

/** Amount recorded on that line but NOT yet confirmed as received. */
export function receiptLineUnconfirmed(record: any, key: string): number {
    const line = (record?.receipt_lines || []).find((l: any) => l.key === key);
    return line && !line.received && !line.suppressed ? Number(line.amount) || 0 : 0;
}

/** Receipt date for that line, if any. */
export function receiptLineDate(record: any, key: string): string | null {
    const line = (record?.receipt_lines || []).find((l: any) => l.key === key);
    return line?.receivedOn || null;
}

/** Human label for a receipt key — used in table headers. */
export function receiptLineLabel(key: string): string {
    return RECEIPT_LINES.find((line) => line.key === key)?.label || key;
}

/* ═══════════════════════════ component ═══════════════════════════ */

type Props = {
    records: any[];
    theme: any;
    isDark: boolean;
    openSlice: (key: string, label: string) => void;
};

export default function ReceiptComposition({ records, theme, isDark, openSlice }: Props) {
    const aggregates = useMemo(() => {
        return RECEIPT_LINES.map((meta) => {
            let received = 0;
            let receivedCount = 0;
            let unconfirmed = 0;
            let unconfirmedCount = 0;
            let suppressed = 0;
            let suppressedCount = 0;
            let suppressedReason: string | undefined;

            for (const record of records) {
                const line = (record.receipt_lines || []).find((l: any) => l.key === meta.key);
                if (!line) continue;
                const amount = Number(line.amount) || 0;
                if (amount <= 0) continue;

                if (line.suppressed) {
                    suppressed += amount;
                    suppressedCount += 1;
                    suppressedReason = suppressedReason || line.suppressedReason;
                } else if (line.received) {
                    received += amount;
                    receivedCount += 1;
                } else {
                    unconfirmed += amount;
                    unconfirmedCount += 1;
                }
            }

            return {
                ...meta,
                received,
                receivedCount,
                unconfirmed,
                unconfirmedCount,
                suppressed,
                suppressedCount,
                suppressedReason,
            };
        });
    }, [records]);

    const developerLines = aggregates.filter((line) => !line.government);
    const governmentLines = aggregates.filter((line) => line.government);

    const developerTotal = developerLines.reduce((sum, line) => sum + line.received, 0);
    const governmentTotal = governmentLines.reduce((sum, line) => sum + line.received, 0);
    const unconfirmedTotal = developerLines.reduce((sum, line) => sum + line.unconfirmed, 0);
    const suppressedTotal = developerLines.reduce((sum, line) => sum + line.suppressed, 0);

    const renderLine = (line: (typeof aggregates)[number]) => {
        const { Icon } = line;
        const share = developerTotal > 0 && !line.government ? Math.round((line.received / developerTotal) * 100) : 0;
        const isEmpty = line.received === 0 && line.unconfirmed === 0 && line.suppressed === 0;

        return (
            <div
                key={line.key}
                className={`rounded-xl border p-3 flex flex-col gap-2 ${cardTone(line.tone, isDark)} ${isEmpty ? "opacity-45" : ""}`}
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-3.5 h-3.5 text-[#9E217B] flex-shrink-0" />
                        <p className={`text-[11px] font-bold leading-tight ${theme.textMuted}`}>{line.label}</p>
                    </div>
                    {line.government && (
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border flex-shrink-0 ${pill(isDark, "muted")}`}>
                            GOVT
                        </span>
                    )}
                </div>

                <button
                    type="button"
                    disabled={line.receivedCount === 0}
                    onClick={() => openSlice(`receipt:${line.key}`, `${line.label} — received`)}
                    className={`text-left disabled:cursor-default ${line.receivedCount > 0 ? "hover:opacity-75 transition-opacity" : ""}`}
                >
                    <p className={`text-lg font-black tabular-nums leading-tight ${theme.text}`}>
                        {formatRevenueAmount(line.received)}
                    </p>
                    <p className={`text-[10px] mt-0.5 ${theme.textMuted}`}>
                        {line.receivedCount === 0
                            ? "no receipts yet"
                            : `${line.receivedCount} booking${line.receivedCount === 1 ? "" : "s"}${!line.government && developerTotal > 0 ? ` · ${share}% of revenue` : ""
                            }`}
                    </p>
                </button>

                {!line.government && developerTotal > 0 && (
                    <div className={`h-1 rounded-full overflow-hidden ${isDark ? "bg-white/10" : "bg-slate-200"}`}>
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-[#9E217B] to-cyan-400 transition-all"
                            style={{ width: `${share}%` }}
                        />
                    </div>
                )}

                {line.unconfirmed > 0 && (
                    <button
                        type="button"
                        onClick={() => openSlice(`receipt_unconfirmed:${line.key}`, `${line.label} — awaiting receipt date`)}
                        className={`text-left rounded-md border px-2 py-1 text-[10px] font-bold inline-flex items-center gap-1.5 ${pill(isDark, "warning")}`}
                        title="Recorded on the booking but no receipt date or confirming status — excluded from revenue"
                    >
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        {formatRevenueAmount(line.unconfirmed)} unconfirmed
                        <span className="opacity-70">({line.unconfirmedCount})</span>
                    </button>
                )}

                {line.suppressed > 0 && (
                    <p
                        className={`text-[9px] leading-snug ${theme.textMuted}`}
                        title={line.suppressedReason}
                    >
                        {formatRevenueAmount(line.suppressed)} excluded to avoid double-counting
                    </p>
                )}
            </div>
        );
    };

    return (
        <section className={`rounded-2xl border p-5 ${theme.tableWrap}`} style={theme.tableGlass}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <Layers3 className="w-5 h-5 text-[#9E217B]" />
                    <h2 className={`text-sm font-black uppercase tracking-wide ${theme.text}`}>Receipt Composition</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${pill(isDark, "success")}`}>
                        Developer revenue {formatRevenueAmount(developerTotal)}
                    </span>
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${pill(isDark, "muted")}`}>
                        Government {formatRevenueAmount(governmentTotal)}
                    </span>
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${pill(isDark, "info")}`}>
                        Gross {formatRevenueAmount(developerTotal + governmentTotal)}
                    </span>
                    {unconfirmedTotal > 0 && (
                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${pill(isDark, "warning")}`}>
                            {formatRevenueAmount(unconfirmedTotal)} unconfirmed
                        </span>
                    )}
                </div>
            </div>

            <p className={`text-[11px] mb-3 ${theme.textMuted}`}>
                Cash basis — a line counts only once a receipt date or confirming status exists. Click any amount to see
                the bookings behind it.
            </p>

            {/* Developer revenue lines */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                {developerLines.map(renderLine)}
            </div>

            {/* Government pass-through */}
            <div className={`mt-4 pt-4 border-t ${isDark ? "border-white/10" : "border-slate-200"}`}>
                <p className={`text-[10px] font-black uppercase tracking-wide mb-2.5 ${theme.textMuted}`}>
                    Collected for government — not developer revenue
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{governmentLines.map(renderLine)}</div>
            </div>

            {suppressedTotal > 0 && (
                <p className={`text-[10px] mt-3 ${theme.textMuted}`}>
                    {formatRevenueAmount(suppressedTotal)} excluded by the double-count guards in
                    <code className="mx-1">revenueCalculations.ts</code>
                    (OCR_INCLUDES_BOOKING_AMOUNT / BOOKING_AMOUNT_INCLUDES_TOKEN).
                </p>
            )}
        </section>
    );
}