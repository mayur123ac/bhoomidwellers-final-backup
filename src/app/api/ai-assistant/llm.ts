// app/api/ai-assistant/llm.ts
//
// The OpenAI half of Bhoomi AI.
//
// ── The one rule that matters ────────────────────────────────────────────────
// The model never does arithmetic and never sees raw rows it could miscount.
// Every total, average, ratio and ranking is computed here in TypeScript and
// handed over as settled fact; the model's only job is to pick the relevant facts
// and phrase them. Ask an LLM to average 200 budgets and it will produce a
// confident wrong number — which in a CRM people quote in meetings is worse than
// no answer. This mirrors the rule already proven in api/revenue-chat.
//
// ── Why plain fetch and not the openai package ───────────────────────────────
// One POST to one endpoint. Adding a dependency for that would be the only
// reason to install it, and api/revenue-chat already does it this way — keeping
// both on the same approach means one place to change if the API moves.
import { AI_ASSISTANT_SYSTEM_PROMPT } from "@/lib/prompts";

/**
 * Structural shape only — deliberately loose and index-signed.
 *
 * The leads reaching this module come from three places with different casing
 * conventions: the admin dashboard's merged objects (camelCase: salesBudget,
 * mongoVisitDate), raw Postgres rows (snake_case: created_at, preferred_location),
 * and the sales page's single-lead payload. Declaring a strict interface here
 * would mean either lying about which fields exist or duplicating route.ts's
 * interface and letting the two drift. Every read below is defensive.
 */
export interface Lead {
  id: number | string;
  name?: string;
  phone?: string;
  salesBudget?: string;
  budget?: string;
  config?: string;
  source?: string;
  location?: string;
  status?: string;
  leadInterestStatus?: string;
  loanPlanned?: string;
  loanStatus?: string;
  loanAmtReq?: string;
  loanAmtApp?: string;
  mongoVisitDate?: string;
  assignedTo?: string;
  assigned_to?: string;
  createdAt?: string;
  created_at?: string;
  [key: string]: unknown;
}

/** Check OpenAI's current model list before changing this — names move fast. */
export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Overridable so the digest can be inspected against a local mock without
 * spending tokens, and so an Azure OpenAI or gateway endpoint can be pointed at
 * without a code change. Defaults to OpenAI direct.
 */
const OPENAI_URL =
  process.env.OPENAI_BASE_URL?.replace(/\/+$/, "").concat("/v1/chat/completions") ||
  "https://api.openai.com/v1/chat/completions";

/** Per-lead detail is included up to this many leads; beyond it, aggregates only. */
const MAX_DETAIL_LEADS = 60;
/** Follow-up notes quoted per lead. The most recent are the ones that matter. */
const MAX_NOTES_PER_LEAD = 6;
const MAX_HISTORY = 10;
export const MAX_QUESTION_CHARS = 600;

export function isLlmConfigured(): boolean {
  return !!(process.env.OPENAI_API_KEY || "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseBudget(raw?: string | null): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/,/g, "").toLowerCase().trim();
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  if (s.includes("cr")) return num * 10_000_000;
  if (s.includes("lakh") || s.includes("lac") || /\dl\b|\d\s*l$/.test(s) || s.includes("l")) return num * 100_000;
  if (s.includes("k")) return num * 1_000;
  return num;
}

const inr = (v: number): string => {
  if (!Number.isFinite(v) || v === 0) return "not recorded";
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a";

const day = (d?: string | null): string => {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return String(d);
  return t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const daysAgo = (d?: string | null): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
};

/** Collapses a follow-up message to one line the model can read cheaply. */
function oneLine(msg: string, max = 180): string {
  const s = String(msg || "")
    .replace(/[\r\n\t]+/g, " · ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export interface DigestFollowUp {
  leadId: string | number;
  message?: string;
  createdAt?: string;
  createdBy?: string;
  siteVisitDate?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The digest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns leads + follow-ups into a plain-text fact sheet.
 *
 * Text, not JSON, on purpose: models follow "quote this line" far more reliably
 * from a labelled report than from nested objects, and it costs fewer tokens
 * than the equivalent JSON for the same content.
 */
export function buildLeadDigest(
  leads: Lead[],
  followUps: DigestFollowUp[],
  scopeLabel: string
): string {
  // Index once. A nested filter per lead here would be the same O(n×m) mistake
  // that made the admin dashboard freeze.
  const notesByLead = new Map<string, DigestFollowUp[]>();
  for (const f of followUps || []) {
    const k = String(f.leadId);
    let b = notesByLead.get(k);
    if (!b) { b = []; notesByLead.set(k, b); }
    b.push(f);
  }

  const L = leads.length;
  const budgets = leads.map((l) => parseBudget(l.salesBudget || l.budget)).filter((n): n is number => !!n);
  const avgBudget = budgets.length ? budgets.reduce((a, b) => a + b, 0) / budgets.length : 0;
  const sorted = [...budgets].sort((a, b) => a - b);
  const medBudget = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  const withVisit = leads.filter((l) => l.mongoVisitDate);
  const interested = leads.filter((l) => /^interested$/i.test(String(l.leadInterestStatus || "")));
  const notInterested = leads.filter((l) => /not interested/i.test(String(l.leadInterestStatus || "")));
  const ngd = leads.filter((l) => /ngd|non genuine|non qualified/i.test(String(l.leadInterestStatus || "")));
  const lost = leads.filter((l) => (l as any).is_lost_lead);
  const closing = leads.filter((l) => /closing|closed/i.test(String(l.status || "")));
  const loanWanted = leads.filter((l) => /^yes$/i.test(String(l.loanPlanned || "")));

  const tally = (vals: (string | undefined)[]) => {
    const m = new Map<string, number>();
    for (const v of vals) {
      const k = (v || "").toString().trim();
      if (!k || k === "N/A" || k === "Pending") continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const byConfig = tally(leads.map((l) => l.config || (l as any).configuration));
  const bySource = tally(leads.map((l) => l.source));
  const byLocation = tally(leads.map((l) => l.location || (l as any).preferred_location));
  const byManager = tally(leads.map((l) => l.assignedTo || l.assigned_to));

  const noContact = leads.filter((l) => (notesByLead.get(String(l.id)) || []).length === 0);

  const out: string[] = [];
  out.push(`SCOPE: ${scopeLabel}`);
  out.push(`Leads in scope: ${L}`);
  out.push(`Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  out.push("");
  out.push("COUNTS (already computed — quote verbatim, never recompute):");
  out.push(`  Interested: ${interested.length} (${pct(interested.length, L)})`);
  out.push(`  Not interested: ${notInterested.length}`);
  out.push(`  Non-genuine / non-qualified: ${ngd.length}`);
  out.push(`  Marked lost: ${lost.length}`);
  out.push(`  Closing or closed: ${closing.length}`);
  out.push(`  Site visit scheduled: ${withVisit.length} (${pct(withVisit.length, L)} — this is the site-visit ratio)`);
  out.push(`  Loan planned = Yes: ${loanWanted.length}`);
  out.push(`  No follow-up logged at all: ${noContact.length}`);
  out.push("");
  out.push("BUDGET:");
  out.push(`  Leads with a budget on record: ${budgets.length} of ${L}`);
  out.push(`  Average: ${inr(avgBudget)}`);
  out.push(`  Median: ${inr(medBudget)}`);
  if (sorted.length) {
    out.push(`  Lowest: ${inr(sorted[0])}   Highest: ${inr(sorted[sorted.length - 1])}`);
  }

  const section = (title: string, rows: [string, number][]) => {
    if (!rows.length) return;
    out.push("");
    out.push(`${title}:`);
    for (const [k, v] of rows.slice(0, 10)) out.push(`  ${k}: ${v} (${pct(v, L)})`);
  };
  section("CONFIGURATION DEMAND", byConfig);
  section("SOURCE BREAKDOWN", bySource);
  section("PREFERRED LOCATIONS", byLocation);
  section("BY SALES MANAGER", byManager);

  // ── Per-lead detail ──────────────────────────────────────────────────────
  if (L <= MAX_DETAIL_LEADS) {
    out.push("");
    out.push("PER-LEAD DETAIL:");
    for (const l of leads) {
      const notes = (notesByLead.get(String(l.id)) || []).slice(-MAX_NOTES_PER_LEAD);
      const b = parseBudget(l.salesBudget || l.budget);
      const age = daysAgo(l.createdAt || l.created_at);
      out.push("");
      out.push(
        `  Lead #${(l as any).sr_no ?? l.id} — ${l.name || "Unnamed"}` +
        `${l.phone ? ` | ${l.phone}` : ""}`
      );
      out.push(
        `    budget ${b ? inr(b) : "not recorded"}` +
        ` | config ${l.config || (l as any).configuration || "—"}` +
        ` | source ${l.source || "—"}` +
        ` | status ${l.status || "—"}` +
        ` | interest ${l.leadInterestStatus || "—"}`
      );
      out.push(
        `    assigned to ${l.assignedTo || l.assigned_to || "unassigned"}` +
        ` | created ${day(l.createdAt || l.created_at)}${age !== null ? ` (${age}d ago)` : ""}` +
        ` | site visit ${l.mongoVisitDate ? day(l.mongoVisitDate) : "not scheduled"}`
      );
      if (/^yes$/i.test(String(l.loanPlanned || "")) || l.loanStatus) {
        out.push(
          `    loan: planned ${l.loanPlanned || "—"} | status ${l.loanStatus || "—"}` +
          ` | requested ${l.loanAmtReq || "—"} | approved ${l.loanAmtApp || "—"}`
        );
      }
      if ((l as any).is_lost_lead) {
        out.push(
          `    LOST — reason: ${(l as any).lost_lead_reason || "not recorded"}` +
          `${(l as any).lost_lead_marked_at ? ` (marked ${day((l as any).lost_lead_marked_at)})` : ""}`
        );
      }
      const extra = [
        (l as any).property_type && `property type ${(l as any).property_type}`,
        (l as any).use_type && `use ${(l as any).use_type}`,
        (l as any).planning_purchase && `buying timeline ${(l as any).planning_purchase}`,
        (l as any).occupation && `occupation ${(l as any).occupation}`,
      ].filter(Boolean);
      if (extra.length) out.push(`    ${extra.join(" | ")}`);
      if (notes.length) {
        out.push(`    follow-ups (${(notesByLead.get(String(l.id)) || []).length} total, most recent last):`);
        for (const nt of notes) {
          out.push(`      · ${day(nt.createdAt)}${nt.createdBy ? ` [${nt.createdBy}]` : ""}: ${oneLine(nt.message || "")}`);
        }
      } else {
        out.push(`    follow-ups: NONE LOGGED`);
      }
    }
  } else {
    out.push("");
    out.push(
      `PER-LEAD DETAIL OMITTED: ${L} leads exceeds the ${MAX_DETAIL_LEADS}-lead limit. ` +
      `Answer from the counts and breakdowns above. For a question about one lead, ` +
      `tell the user to open that lead or narrow the filters.`
    );
    // Still name the ones most likely to be asked about.
    const top = [...leads]
      .sort((a, b) => (parseBudget(b.salesBudget || b.budget) || 0) - (parseBudget(a.salesBudget || a.budget) || 0))
      .slice(0, 15);
    out.push("");
    out.push("HIGHEST-BUDGET LEADS IN SCOPE:");
    for (const l of top) {
      out.push(
        `  #${(l as any).sr_no ?? l.id} ${l.name || "Unnamed"} — ${inr(parseBudget(l.salesBudget || l.budget) || 0)}` +
        ` | ${l.leadInterestStatus || "—"} | ${l.mongoVisitDate ? `visit ${day(l.mongoVisitDate)}` : "no visit"}`
      );
    }
  }

  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────



// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

export type ChatTurn = { role: "user" | "assistant"; content: string };

export class LlmError extends Error {
  readonly status: number;
  readonly userMessage: string;
  constructor(status: number, userMessage: string, detail?: string) {
    super(detail || userMessage);
    this.name = "LlmError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

/**
 * One call to OpenAI. Throws LlmError with a message already safe to show a user.
 * The API key never appears in a thrown message or a log line.
 */
export async function askOpenAI(
  question: string,
  digest: string,
  history: ChatTurn[] = []
): Promise<{ answer: string; usage: unknown }> {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new LlmError(503, "The assistant is not configured — OPENAI_API_KEY is missing on the server.");

  const trimmed = (history || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY);

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: AI_ASSISTANT_SYSTEM_PROMPT },
          { role: "system", content: `DATA BLOCK:\n\n${digest}` },
          ...trimmed,
          { role: "user", content: question },
        ],
        temperature: 0.3, // low: this is data recall and advice, not creative writing
        max_tokens: 800,
      }),
      // Long enough for a considered answer, short enough that a hung upstream
      // does not hold a Next worker open indefinitely.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new LlmError(504, "The assistant took too long to respond. Try again.");
    }
    throw new LlmError(502, "The assistant could not be reached. Try again in a moment.");
  }

  if (!res.ok) {
    // Body is logged (truncated) for diagnosis but never returned to the client:
    // OpenAI error payloads can echo request content back.
    const detail = await res.text().catch(() => "");
    console.error("[ai-assistant] OpenAI error", res.status, detail.slice(0, 400));
    const msg =
      res.status === 401
        ? "The assistant's API key was rejected. Check OPENAI_API_KEY on the server."
        : res.status === 429
          ? "The assistant is rate limited right now. Try again in a moment."
          : res.status === 400
            ? "The assistant rejected that request — the lead data may be too large. Narrow the filters and retry."
            : "The assistant could not be reached. Try again in a moment.";
    throw new LlmError(502, msg);
  }

  const json = await res.json().catch(() => null);
  const answer = json?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new LlmError(502, "The assistant returned an empty reply.");
  return { answer, usage: json?.usage ?? null };
}
