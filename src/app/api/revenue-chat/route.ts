// app/api/revenue-chat/route.ts
// Natural-language Q&A over the revenue table.
//
// THE ONE RULE THAT MATTERS: the model never does arithmetic on money. Every
// total, average, count and ranking is computed here in TypeScript and handed to
// the model as settled fact. The model's only job is to pick the right facts and
// phrase them. Ask an LLM to add up 40 agreement values and it will produce a
// confident, wrong number — which in a CRM that people quote in meetings is worse
// than no answer at all.
//
// The client posts the rows currently on screen, so the bot's figures always
// agree with the table the user is looking at. Access control belongs on
// /api/revenue-intelligence (which decides what rows a role may see); this route
// only reasons over what was already visible.
import { buildServerDigest } from "@/lib/revenueDigest";
import { REVENUE_CHAT_SYSTEM_PROMPT } from "@/lib/prompts";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Check OpenAI's current model list before pinning this — names move fast.
const MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";


const MAX_ROWS = 250;        // beyond this the digest alone is sent, no per-row table
const MAX_HISTORY = 12;      // trailing turns kept, keeps cost flat over a long chat
const MAX_QUESTION_CHARS = 600;

type ChatRow = {
    srNo?: number | string;
    customerName?: string;
    customerNote?: string;
    bookingNumber?: string;
    agreementValue?: number;
    ocrReceived?: number;
    ownContributionRequired?: number;
    disbursement?: number;
    balance?: number;
    salesManager?: string;
    flatNo?: string;
    bankerDetails?: string;
    statusText?: string;
    statusTone?: string;
};

const n = (v: any) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};

const inr = (v: any) => `₹${Math.round(n(v)).toLocaleString("en-IN")}`;

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a");

/* ────────────────────── deterministic digest ──────────────────────
   Everything the model is allowed to state as a number is computed here. */

function buildDigest(rows: ChatRow[], filterLabel: string) {
    const av = rows.reduce((s, r) => s + n(r.agreementValue), 0);
    const ocr = rows.reduce((s, r) => s + n(r.ocrReceived), 0);
    const disb = rows.reduce((s, r) => s + n(r.disbursement), 0);
    const balance = rows.reduce((s, r) => s + n(r.balance), 0);
    const collected = ocr + disb;


    const byManager = new Map<string, { count: number; av: number; ocr: number; disb: number; balance: number }>();
    const byStatus = new Map<string, { count: number; av: number; balance: number }>();
    const byBanker = new Map<string, { count: number; av: number }>();

    for (const r of rows) {
        const m = r.salesManager || "Unassigned";
        const acc = byManager.get(m) || { count: 0, av: 0, ocr: 0, disb: 0, balance: 0 };
        acc.count += 1;
        acc.av += n(r.agreementValue);
        acc.ocr += n(r.ocrReceived);
        acc.disb += n(r.disbursement);
        acc.balance += n(r.balance);
        byManager.set(m, acc);

        const s = r.statusText || "Not started";
        const sAcc = byStatus.get(s) || { count: 0, av: 0, balance: 0 };
        sAcc.count += 1;
        sAcc.av += n(r.agreementValue);
        sAcc.balance += n(r.balance);
        byStatus.set(s, sAcc);

        const b = r.bankerDetails && r.bankerDetails !== "—" ? r.bankerDetails : "No banker recorded";
        const bAcc = byBanker.get(b) || { count: 0, av: 0 };
        bAcc.count += 1;
        bAcc.av += n(r.agreementValue);
        byBanker.set(b, bAcc);
    }

    const label = (r: ChatRow) => `${r.customerName || "Unnamed"} (${r.flatNo || "no flat"})`;

    const topBalances = [...rows]
        .sort((a, b) => n(b.balance) - n(a.balance))
        .filter((r) => n(r.balance) > 0)
        .slice(0, 8);

    const zeroOcr = rows.filter((r) => n(r.ocrReceived) === 0);
    const zeroDisb = rows.filter((r) => n(r.disbursement) === 0);
    const fullyCollected = rows.filter((r) => n(r.agreementValue) > 0 && n(r.balance) === 0);
    const ownShareShort = rows.filter(
        (r) => n(r.ownContributionRequired) > 0 && n(r.ocrReceived) < n(r.ownContributionRequired)
    );

    const lines: string[] = [];
    lines.push(`SCOPE: ${filterLabel || "all bookings in hand"}`);
    lines.push(`Bookings in scope: ${rows.length}`);
    lines.push("");
    lines.push("TOTALS (already summed — quote these verbatim, never recompute):");
    lines.push(`  Agreement value: ${inr(av)}`);
    lines.push(`  OCR received (buyer's own contribution): ${inr(ocr)}`);
    lines.push(`  Loan disbursed (completed tranches only): ${inr(disb)}`);
    lines.push(`  Collected to date (OCR + disbursed): ${inr(collected)} = ${pct(collected, av)} of agreement value`);
    lines.push(`  Balance receivable: ${inr(balance)}`);
    lines.push("");
    lines.push("BY SALES MANAGER:");
    for (const [m, v] of [...byManager.entries()].sort((a, b) => b[1].av - a[1].av)) {
        lines.push(
            `  ${m}: ${v.count} booking(s), AV ${inr(v.av)}, OCR ${inr(v.ocr)}, disbursed ${inr(v.disb)}, balance ${inr(v.balance)}`
        );
    }
    lines.push("");
    lines.push("BY STATUS:");
    for (const [s, v] of [...byStatus.entries()].sort((a, b) => b[1].count - a[1].count)) {
        lines.push(`  ${s}: ${v.count} booking(s), AV ${inr(v.av)}, balance ${inr(v.balance)}`);
    }
    lines.push("");
    lines.push("BY BANKER:");
    for (const [b, v] of [...byBanker.entries()].sort((a, b2) => b2[1].count - v0(a))) {
        lines.push(`  ${b}: ${v.count} booking(s), AV ${inr(v.av)}`);
    }
    lines.push("");
    lines.push("NOTABLE GROUPS:");
    lines.push(`  Largest balances outstanding: ${topBalances.map((r) => `${label(r)} ${inr(r.balance)}`).join("; ") || "none"}`);
    lines.push(`  No OCR received yet (${zeroOcr.length}): ${zeroOcr.slice(0, 12).map(label).join("; ") || "none"}`);
    lines.push(`  No disbursement yet (${zeroDisb.length}): ${zeroDisb.slice(0, 12).map(label).join("; ") || "none"}`);
    lines.push(`  Buyer's own share still short (${ownShareShort.length}): ${ownShareShort.slice(0, 12).map((r) => `${label(r)} short ${inr(n(r.ownContributionRequired) - n(r.ocrReceived))}`).join("; ") || "none"}`);
    lines.push(`  Fully collected (${fullyCollected.length}): ${fullyCollected.slice(0, 12).map(label).join("; ") || "none"}`);

    if (rows.length <= MAX_ROWS) {
        lines.push("");
        lines.push("PER-BOOKING TABLE (customer | flat | booking no | AV | OCR | disbursed | balance | manager | banker | status):");
        for (const r of rows) {
            lines.push(
                `  ${r.customerName || "Unnamed"}${r.customerNote ? ` [${r.customerNote}]` : ""} | ${r.flatNo || "—"} | ${r.bookingNumber || "—"
                } | ${inr(r.agreementValue)} | ${inr(r.ocrReceived)} | ${inr(r.disbursement)} | ${inr(r.balance)} | ${r.salesManager || "Unassigned"
                } | ${r.bankerDetails || "—"} | ${r.statusText || "Not started"}`
            );
        }
    } else {
        lines.push("");
        lines.push(
            `PER-BOOKING TABLE OMITTED: ${rows.length} rows exceeds the ${MAX_ROWS}-row limit. Answer from the totals and groups above, and tell the user to narrow the filters for questions about an individual booking.`
        );
    }

    return lines.join("\n");
}

// Tiny helper so the banker sort above stays readable.
function v0(entry: [string, { count: number }]) {
    return entry[1].count;
}



// ─── POST — answer a question about the visible rows ──────────────────────────
export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { success: false, message: "The assistant is not configured — OPENAI_API_KEY is missing on the server." },
                { status: 503 }
            );
        }

        const body = await req.json();
        const { question, history, rows, filter_label } = body as {
            question?: string;
            history?: Array<{ role: "user" | "assistant"; content: string }>;
            rows?: ChatRow[];
            filter_label?: string;
        };

        const clean = String(question || "").trim();
        if (!clean) {
            return NextResponse.json({ success: false, message: "question is required" }, { status: 400 });
        }
        if (clean.length > MAX_QUESTION_CHARS) {
            return NextResponse.json(
                { success: false, message: `Keep the question under ${MAX_QUESTION_CHARS} characters.` },
                { status: 400 }
            );
        }
        if (!Array.isArray(rows) || rows.length === 0) {
            return NextResponse.json(
                { success: false, message: "There are no bookings in the current view to answer from." },
                { status: 400 }
            );
        }


        const digest = buildDigest(rows, String(filter_label || ""));
        const serverDigest = await buildServerDigest();



        const trimmedHistory = (Array.isArray(history) ? history : [])
            .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .slice(-MAX_HISTORY);

        const messages = [
            { role: "system" as const, content: REVENUE_CHAT_SYSTEM_PROMPT },
            { role: "system" as const, content: `ORG-WIDE DATA (all bookings, ignores the user's filters):\n\n${serverDigest}` },
            { role: "system" as const, content: `FILTERED VIEW (what the user is looking at right now):\n\n${digest}` },
            ...trimmedHistory,
            { role: "user" as const, content: clean },
        ];

        const res = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages,
                temperature: 0.2,   // low: this is data recall, not composition
                max_tokens: 700,
            }),
        });

        if (!res.ok) {
            const detail = await res.text().catch(() => "");
            console.error("[POST /api/revenue-chat] OpenAI error", res.status, detail.slice(0, 500));
            const message =
                res.status === 401
                    ? "The assistant's API key was rejected. Check OPENAI_API_KEY on the server."
                    : res.status === 429
                        ? "The assistant is rate limited right now. Try again in a moment."
                        : "The assistant could not be reached. Try again in a moment.";
            return NextResponse.json({ success: false, message }, { status: 502 });
        }

        const json = await res.json();
        const answer = json?.choices?.[0]?.message?.content?.trim();
        if (!answer) {
            return NextResponse.json({ success: false, message: "The assistant returned an empty reply." }, { status: 502 });
        }

        return NextResponse.json(
            {
                success: true,
                data: {
                    answer,
                    rows_considered: rows.length,
                    model: MODEL,
                    usage: json?.usage ?? null,
                },
            },
            { status: 200 }
        );
    } catch (err: any) {
        console.error("[POST /api/revenue-chat]", err);
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
    }
}