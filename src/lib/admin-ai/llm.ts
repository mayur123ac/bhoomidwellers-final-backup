// admin-ai/llm.ts — the orchestrator: model call, tool loop, and the boundary
// the model is not allowed to cross.
//
// Changes from the original beyond plumbing:
//
// • The scope is passed to every tool handler and is NOT derived from anything
//   the model produced. The model chooses WHICH tool runs and with what filters;
//   it never chooses WHOSE data. That split is what stops "show me another
//   manager's leads" from working, no matter how the question is phrased.
//
// • The tool loop is bounded. The original ran exactly one round; an unbounded
//   loop is a way to burn tokens and wall-clock time on a single request.
//
// • Unknown tool names are refused rather than reported back as a soft error the
//   model can retry against.
//
// • The model id comes from OPENAI_MODEL. It was hardcoded to gpt-4o-mini while
//   the variable was already referenced elsewhere in the codebase.

import { adminAiTools } from "./tools";
import { adminToolRegistry } from "./services";
import type { AiScope } from "./rbac";
import { fenceUntrusted } from "./prompt";

const OPENAI_URL = `${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`;

/** Overridable per environment; the default is a current, tool-calling model. */
export const ADMIN_AI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const REQUEST_TIMEOUT_MS = 45_000;
/** Two rounds covers "call tools, then answer"; more is a runaway loop. */
const MAX_TOOL_ROUNDS = 3;
/** A tool result larger than this is truncated before it reaches the context. */
const MAX_TOOL_RESULT_CHARS = 12_000;

export class AdminLlmError extends Error {
  constructor(public status: number, public userMessage: string) {
    super(userMessage);
    this.name = "AdminLlmError";
  }
}

export function isAdminLlmConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * One tool invocation, recorded whether it worked or not.
 *
 * `ok` exists because the failure mode that hid the broken tools was a silent
 * catch: five handlers threw on every call for an unknown length of time, each
 * returned a polite string to the model, and nothing anywhere counted it. The
 * assistant kept answering — from nothing. A failure that reaches the model as
 * prose is invisible; a failure that lands in the audit table as `ok: false` is
 * a number someone can alert on.
 */
export interface AdminToolCall {
  name: string;
  ms: number;
  rows?: number;
  ok: boolean;
  error?: string;
}

export interface AdminAiResult {
  content: string;
  toolsCalled: AdminToolCall[];
  modulesAccessed: string[];
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function callOpenAi(body: unknown, signal?: AbortSignal): Promise<any> {
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new AdminLlmError(499, "Request cancelled.");
    if (e?.name === "TimeoutError") {
      throw new AdminLlmError(504, "The assistant took too long to respond. Try again.");
    }
    // Anything else is the endpoint being unreachable — a refused connection,
    // DNS failure or TLS error. Reporting that as a timeout sends whoever is
    // debugging it looking at latency instead of at OPENAI_BASE_URL, so the
    // cause and the URL actually being dialled are both named here.
    const cause = e?.cause?.code || e?.cause?.message || e?.message || "unknown";
    console.error(`[admin-ai] cannot reach ${OPENAI_URL}: ${cause}`);
    throw new AdminLlmError(
      502,
      `The AI endpoint is unreachable (${cause}). Check OPENAI_BASE_URL on the server.`
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[admin-ai] OpenAI error", res.status, detail.slice(0, 500));
    // 401/429 from the provider are operator problems, not user problems, so the
    // user-facing text stays generic while the console keeps the detail.
    throw new AdminLlmError(502, "The assistant encountered an error. Try again.");
  }

  return res.json();
}

/**
 * Run one question through the model, executing any tools it asks for.
 *
 * `scope` is the caller's authorization envelope. It is threaded to handlers
 * untouched; nothing in this function reads an identity out of `toolCall`.
 */
export async function askAdminAI(
  messages: any[],
  scope: AiScope,
  signal?: AbortSignal
): Promise<AdminAiResult> {
  if (!isAdminLlmConfigured()) {
    throw new AdminLlmError(503, "The AI is currently unavailable (missing API key).");
  }

  const toolsCalled: AdminAiResult["toolsCalled"] = [];
  const modulesAccessed = new Set<string>();
  const working = [...messages];
  let usage: AdminAiResult["usage"];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isFinalRound = round === MAX_TOOL_ROUNDS - 1;

    const data = await callOpenAi(
      {
        model: ADMIN_AI_MODEL,
        messages: working,
        // On the last permitted round the tools are withheld, forcing a prose
        // answer instead of another tool request that could never be served.
        ...(isFinalRound ? {} : { tools: adminAiTools, tool_choice: "auto" }),
        temperature: 0.1,
      },
      signal
    );

    usage = data.usage ?? usage;
    const message = data.choices?.[0]?.message;
    if (!message) throw new AdminLlmError(502, "The assistant returned an empty response.");

    if (!message.tool_calls?.length) {
      return {
        content: message.content ?? "",
        toolsCalled,
        modulesAccessed: [...modulesAccessed],
        model: ADMIN_AI_MODEL,
        usage,
      };
    }

    working.push(message);

    for (const toolCall of message.tool_calls) {
      const name = toolCall.function?.name;
      const entry = name ? adminToolRegistry[name] : undefined;
      const startedAt = Date.now();

      let payload: unknown;
      let rows: number | undefined;
      let ok = true;
      let failure: string | undefined;

      if (!entry) {
        // Not a soft error: naming a tool that does not exist means the model is
        // improvising, and telling it "not found" invites another guess.
        console.warn("[admin-ai] refused unknown tool:", name);
        payload = { error: "That tool does not exist. Answer from the tools you were given." };
        ok = false;
        failure = "unknown_tool";
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }
        try {
          const out = await entry.handler(args, scope);
          payload = out;
          rows = Array.isArray(out) ? out.length : undefined;
          modulesAccessed.add(entry.module);
        } catch (err: any) {
          // The model still gets a neutral string — it must not see raw SQL
          // errors — but the real cause is kept for the audit row so a broken
          // query is a queryable fact, not just a line in a log nobody reads.
          console.error(`[admin-ai] tool ${name} failed:`, err?.message);
          payload = { error: "That data could not be retrieved." };
          ok = false;
          failure = String(err?.message ?? "handler threw").slice(0, 200);
        }
      }

      toolsCalled.push({ name: name ?? "unknown", ms: Date.now() - startedAt, rows, ok, error: failure });

      // Tool output is database text: it can contain whatever a user typed into
      // a follow-up note, so it is fenced exactly like client input.
      const serialized = JSON.stringify(payload) ?? "null";
      const truncated =
        serialized.length > MAX_TOOL_RESULT_CHARS
          ? serialized.slice(0, MAX_TOOL_RESULT_CHARS) + '…","truncated":true}'
          : serialized;

      working.push({
        tool_call_id: toolCall.id,
        role: "tool",
        name,
        content: fenceUntrusted(`tool:${name}`, truncated),
      });
    }
  }

  throw new AdminLlmError(502, "The assistant could not settle on an answer. Try rephrasing.");
}
