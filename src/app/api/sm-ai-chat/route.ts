// app/api/sm-ai-chat/route.ts
// Private, portfolio-scoped AI assistant for a Sales Manager.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SCOPING GUARANTEE
//
// The system prompt tells the model "you only know about your own leads". That is
// a instruction, not a boundary — a prompt cannot stop a model repeating data it
// was handed, and a determined user can talk it into trying. So the real control
// is upstream: every query below is filtered to this manager, and the digest
// physically cannot contain another manager's leads, org revenue, commissions or
// inventory pricing. The prompt is the manners; the SQL is the wall.
//
// The manager's identity comes from the signed session and is then re-read from
// `users` by id. Nothing about who you are is taken from the request body.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO CORRECTIONS TO THE ORIGINAL SPEC, forced by the actual schema:
//
//  1. `WHERE assigned_to = {{SM_ID}}` matches nothing.
//     walkin_enquiries.assigned_to holds the manager's NAME, not their id
//     ("Dimple Dubey" -> 118 leads). Scoping is therefore by name, resolved from
//     the session's user id. Verified: 0 leads reference a name with no user row.
//
//  2. There is no follow-up due-date to read.
//     `followup_date` exists on both walkin_enquiries and follow_ups and is
//     EMPTY on all 232 leads / 312 follow-ups. "Due today" is therefore built
//     from what IS recorded — site visits scheduled for today (site_visits.
//     visit_date, 42 rows) — and the digest says plainly that no due-date field
//     is populated, so the model reports that instead of inventing a list.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";
import { askOpenAI, LlmError, MAX_QUESTION_CHARS, type ChatTurn } from "../ai-assistant/llm";

export const dynamic = "force-dynamic";

const normRole = (r: unknown) => String(r ?? "").trim().toLowerCase().replace(/_/g, " ");
const SM_ROLES = ["sales manager", "senior sales manager"];

/** The one refusal string the spec fixes verbatim. */
const OUT_OF_SCOPE = "That's outside what I can access for you.";

/**
 * Format a budget for the digest.
 *
 * budget/sales_budget is FREE TEXT in this CRM — real values include "35lakh",
 * "65Lakh" and "not disclossed". Stripping non-digits and formatting turned
 * "35lakh" into "₹35", which is not a rounding error but a wrong number the
 * assistant would then quote to the manager. So only a value that is purely
 * numeric gets formatted; anything else is passed through exactly as recorded.
 */
const INR = (v: any) => {
  const raw = String(v ?? "").trim();
  if (raw === "") return "not recorded";
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw;   // "35lakh" stays "35lakh"
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return raw;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
};

const val = (v: any) => {
  const s = String(v ?? "").trim();
  return s === "" || s.toLowerCase() === "n/a" ? "not recorded" : s;
};

interface SmDigest { text: string; counts: Record<string, number>; }

/**
 * Everything the assistant is allowed to know, and nothing else.
 * Every statement here is filtered by `smName`.
 */
async function buildSmDigest(smName: string, currentLeadId: number | null): Promise<SmDigest> {
  // assigned_to is matched on NAME, so the organization filter below is what
  // actually separates two builders' managers who happen to share a name.
  // It is added per query rather than folded into `scope`, because the
  // placeholder index differs between these statements.
  const scope = `LOWER(TRIM(w.assigned_to)) = LOWER(TRIM($1))`;
  const chatOrgId = await getOrganizationId();

  const [totals] = await query<any>(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE COALESCE(w.is_lost_lead,false) = false)::int active,
            COUNT(*) FILTER (WHERE w.is_lost_lead)::int lost,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(w.status,'')) IN ('closing','closed'))::int closing
       FROM walkin_enquiries w WHERE ${scope} AND w.organization_id = $2`, [smName, chatOrgId]);

  // Staleness from the last actual follow-up, not last_activity_at — that column
  // is touched by any edit, so it would report "contacted" for a typo fix.
  const stale = await query<any>(
    `SELECT w.id, w.sr_no, w.name, w.phone, w.status,
            EXTRACT(DAY FROM NOW() - lastf.last_at)::int AS days_since
       FROM walkin_enquiries w
       LEFT JOIN (SELECT lead_id, MAX(created_at) last_at FROM follow_ups
                   WHERE organization_id = $2 GROUP BY lead_id) lastf
              ON lastf.lead_id = w.id
      WHERE ${scope} AND COALESCE(w.is_lost_lead,false) = false
        AND w.organization_id = $2
        AND (lastf.last_at IS NULL OR lastf.last_at < NOW() - INTERVAL '7 days')
      ORDER BY lastf.last_at ASC NULLS FIRST LIMIT 25`, [smName, chatOrgId]);

  // "Due today" = site visits actually scheduled for today. See the header note.
  const dueToday = await query<any>(
    `SELECT w.id, w.sr_no, w.name, w.phone, w.status, sv.visit_date, sv.status AS visit_status
       FROM site_visits sv JOIN walkin_enquiries w
         ON w.id = sv.lead_id AND w.organization_id = sv.organization_id
      WHERE ${scope} AND sv.visit_date::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        AND sv.organization_id = $2
      ORDER BY sv.visit_date ASC LIMIT 25`, [smName, chatOrgId]);

  const [sv] = await query<any>(
    `SELECT COUNT(*) FILTER (WHERE LOWER(COALESCE(sv.status,'')) = 'completed')::int done,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(sv.status,'')) <> 'completed')::int pending
       FROM site_visits sv JOIN walkin_enquiries w
         ON w.id = sv.lead_id AND w.organization_id = sv.organization_id
      WHERE ${scope}
        AND sv.organization_id = $2
        AND DATE_TRUNC('month', sv.visit_date) = DATE_TRUNC('month', NOW())`, [smName, chatOrgId]);

  let current: any = null;
  if (currentLeadId) {
    // Scoped too — asking about someone else's lead by id must not leak it.
    const rows = await query<any>(
      `SELECT w.* FROM walkin_enquiries w WHERE ${scope} AND w.id = $2 AND w.organization_id = $3 LIMIT 1`,
      [smName, currentLeadId, chatOrgId]);
    current = rows[0] ?? null;
  }

  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full" });
  const o: string[] = [];
  o.push(`Manager: ${smName} | Today: ${today}`);
  o.push(`Total leads: ${totals.total} | Active: ${totals.active} | Lost: ${totals.lost} | Closing/Closed: ${totals.closing}`);
  o.push("");

  o.push(`SITE VISITS SCHEDULED TODAY (${dueToday.length}):`);
  if (!dueToday.length) o.push("  none");
  dueToday.forEach(l => o.push(
    `  - lead_no ${val(l.sr_no ?? l.id)} | ${val(l.name)} | ${val(l.phone)} | status ${val(l.status)} ` +
    `| visit ${new Date(l.visit_date).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} ` +
    `(${val(l.visit_status)}) | link lead:${l.id}`));
  o.push("");
  o.push("NOTE ON FOLLOW-UP DUE DATES: no follow-up due-date is recorded anywhere in");
  o.push("this CRM (the field exists but is empty on every lead). If asked what is due");
  o.push("today, use the site visits above and the overdue list below, and say that");
  o.push("follow-up due dates are not being captured. Never invent a due list.");
  o.push("");

  o.push(`OVERDUE — no contact in 7+ days (${stale.length} shown, oldest first):`);
  if (!stale.length) o.push("  none");
  stale.forEach(l => o.push(
    `  - lead_no ${val(l.sr_no ?? l.id)} | ${val(l.name)} | ${val(l.phone)} | status ${val(l.status)} ` +
    `| ${l.days_since == null ? "never contacted" : `${l.days_since} days since last note`} | link lead:${l.id}`));
  o.push("");

  o.push(`SITE VISITS THIS MONTH — done: ${sv.done}, pending: ${sv.pending}`);
  o.push("");

  if (current) {
    o.push("CURRENT LEAD IN VIEW — answer about THIS lead unless asked otherwise:");
    o.push(`  lead_no ${val(current.sr_no ?? current.id)} | ${val(current.name)} | ${val(current.phone)} ` +
      `| Budget ${INR(current.sales_budget ?? current.budget)} ` +
      `| Property Type ${val(current.property_type ?? current.configuration)} ` +
      `| Status ${val(current.status)} | Interest ${val(current.lead_interest_status)} ` +
      `| Address ${val(current.address)} | link lead:${current.id}`);
  } else {
    o.push("CURRENT LEAD IN VIEW: none selected.");
  }

  return {
    text: o.join("\n"),
    counts: {
      total: totals.total, active: totals.active, lost: totals.lost,
      due_today: dueToday.length, stale: stale.length,
      sv_done: sv.done, sv_pending: sv.pending,
    },
  };
}

function systemPrompt(smName: string): string {
  return `You are a private AI sales assistant for ${smName} at Bhoomi Dwellers.

STRICT DATA RULES — never break these:
- You only know about leads assigned to ${smName}. The DATA BLOCK you are given
  contains those leads and nothing else; it is the whole of your knowledge.
- You have ZERO knowledge of: organisation revenue, financial transactions,
  booking payment amounts, channel-partner commissions, other managers' leads,
  inventory pricing, or any admin-level data. None of it is in your DATA BLOCK.
- If asked anything outside that scope, reply with exactly this and nothing else:
  "${OUT_OF_SCOPE}"
- Never claim a total, count or figure that is not in the DATA BLOCK.

RESPONSE RULES:
- When you mention a lead, ALWAYS render it as a link using the lead_no and the
  link token from the DATA BLOCK, in this exact form:
      [#226 Rahul Thorat](lead:226)
  The target is "lead:" followed by the id in that lead's "link lead:<id>" field.
  Never invent a URL and never use any other link format.
- Indian formatting: ₹, lakhs and crores.
- Never fabricate. If a detail is missing say "I don't have that detail."
- Be concise and action-oriented. Prefer a short list over a paragraph.
- For "today's work": list the site visits scheduled today first, then the overdue
  leads, each as a link, and state that follow-up due dates are not recorded.`;
}

export async function POST(req: Request) {
  const started = Date.now();
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  const orgId = await getOrganizationId();

  const role = normRole(gate.session.role);
  // Identity from the session, then re-read from the database. The body never
  // decides whose leads are in scope.
  let smName = "";
  try {
    const rows = await query<any>(`SELECT name, role FROM users WHERE id = $1 LIMIT 1`, [gate.userId]);
    smName = String(rows[0]?.name ?? gate.session.name ?? "").trim();
  } catch {
    smName = String(gate.session.name ?? "").trim();
  }

  if (!SM_ROLES.includes(role)) {
    // Not an error — the assistant simply has nothing it is allowed to tell them.
    return NextResponse.json({ response: OUT_OF_SCOPE }, { status: 200 });
  }
  if (!smName) {
    return NextResponse.json(
      { response: "I could not identify your account, so I cannot scope anything to you safely." },
      { status: 200 },
    );
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body handled below */ }
  const question = String(body.query ?? "").trim();
  const history: ChatTurn[] = Array.isArray(body.history) ? body.history : [];
  const currentLeadId = Number(body.currentLeadId) > 0 ? Number(body.currentLeadId) : null;

  if (!question) return NextResponse.json({ response: "Ask me something about your leads." });
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({
      response: `That question is a bit long — keep it under ${MAX_QUESTION_CHARS} characters and I'll take another look.`,
    });
  }

  let digest: SmDigest;
  try {
    digest = await buildSmDigest(smName, currentLeadId);
  } catch (e: any) {
    console.error("[sm-ai-chat] digest failed:", e?.message || e);
    return NextResponse.json(
      { response: "I could not read your leads just now. Try again in a moment." },
      { status: 200 },
    );
  }

  // Usage accounting. Never allowed to break the reply — a failed audit write is
  // logged and swallowed.
  const audit = async (status: string, usage: any, error?: string) => {
    try {
      await query(
        `INSERT INTO ai_audit_logs
           (user_id, user_name, user_role, organization_id, question, tools_called, modules_accessed,
            model, status, latency_ms, prompt_tokens, completion_tokens, total_tokens, error)
         VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          gate.userId, smName, gate.session.role, orgId, question.slice(0, 2000),
          ["sm_ai_chat"], "gpt", status, Date.now() - started,
          usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null,
          usage?.total_tokens ?? null, error ? String(error).slice(0, 1000) : null,
        ],
      );
    } catch (e: any) { console.error("[sm-ai-chat] audit write failed:", e?.message || e); }
  };

  try {
    const { answer, usage } = await askOpenAI(question, digest.text, history, systemPrompt(smName));
    await audit("ok", usage);
    return NextResponse.json({ response: answer, scope: digest.counts });
  } catch (e: any) {
    const le = e instanceof LlmError ? e : null;
    await audit("error", null, e?.message);
    return NextResponse.json(
      { response: le?.userMessage || "The assistant is unavailable right now. Please try again." },
      { status: le?.status || 502 },
    );
  }
}
