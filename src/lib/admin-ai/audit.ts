// admin-ai/audit.ts — one row per AI request, and the rate limiter that reads it.
//
// Audit and rate limiting share a table on purpose: the limiter's question
// ("how many requests has this user made in the last minute?") is answered by
// the rows the audit trail already writes, so there is no second store to keep
// consistent and no in-memory counter that resets on redeploy or diverges
// between serverless instances.
//
// What is NOT recorded: the retrieved CRM context and the model's intermediate
// reasoning. The context is a verbatim copy of rows that already live in their
// own tables — duplicating it into a log would create the single richest target
// in the database, growing without bound and outside every existing access
// control. The log records which modules were touched, which is what an
// investigation actually needs.

import { query } from "@/lib/db";
import type { AiScope } from "./rbac";

/**
 * `tool_error` is deliberately distinct from `ok` and from `error`.
 *
 * A request where retrieval failed but the model still produced prose looks
 * successful to the user and returns HTTP 200 — that is exactly how five broken
 * tools went unnoticed. Giving it its own status makes the failure countable:
 *
 *   SELECT status, count(*) FROM ai_audit_logs
 *    WHERE created_at > now() - interval '1 day' GROUP BY 1;
 *
 * Anything above zero in `tool_error` means the assistant is answering business
 * questions without the data it claimed to use.
 */
export type AiRequestStatus = "ok" | "tool_error" | "error" | "refused" | "rate_limited";

export interface AiAuditEntry {
  scope: Pick<AiScope, "userId" | "userName" | "role" | "organizationId">;
  conversationId: number | null;
  question: string;
  toolsCalled: Array<{ name: string; ms?: number; rows?: number }>;
  modulesAccessed: string[];
  model: string | null;
  status: AiRequestStatus;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  error?: string | null;
}

/** Questions are truncated: a pasted wall of text is not worth unbounded storage. */
const MAX_QUESTION_CHARS = 2000;
const MAX_ERROR_CHARS = 500;

/**
 * Write one audit row. Never throws — a failure to log must not fail the user's
 * request, but it is surfaced on the server console so a broken audit trail is
 * noticed rather than silently tolerated.
 */
export async function recordAiRequest(entry: AiAuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_audit_logs
         (user_id, user_name, user_role, organization_id, conversation_id,
          question, tools_called, modules_accessed, model, status,
          latency_ms, prompt_tokens, completion_tokens, total_tokens, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],$9,$10,$11,$12,$13,$14,$15)`,
      [
        entry.scope.userId,
        entry.scope.userName,
        entry.scope.role,
        entry.scope.organizationId,
        entry.conversationId,
        entry.question.slice(0, MAX_QUESTION_CHARS),
        JSON.stringify(entry.toolsCalled ?? []),
        entry.modulesAccessed ?? [],
        entry.model,
        entry.status,
        Math.round(entry.latencyMs),
        entry.promptTokens ?? null,
        entry.completionTokens ?? null,
        entry.totalTokens ?? null,
        entry.error ? entry.error.slice(0, MAX_ERROR_CHARS) : null,
      ]
    );
  } catch (err: any) {
    console.error("[admin-ai] audit write failed:", err?.message);
  }
}

/**
 * Rate limit: requests per user per window.
 *
 * Per user rather than per IP — the assistant is behind authentication, so the
 * user id is both known and the thing worth limiting. An IP limit would throttle
 * a whole office sharing one address.
 *
 * Counts only rows that reached the model (`ok` / `error`), so a user who is
 * already being refused cannot lock themselves out further, and a burst of
 * rate-limited attempts does not extend its own penalty.
 */
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 15;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkAiRateLimit(userId: number): Promise<RateLimitResult> {
  try {
    const rows = await query<{ used: number; oldest: Date | null }>(
      `SELECT COUNT(*)::int AS used, MIN(created_at) AS oldest
         FROM ai_audit_logs
        WHERE user_id = $1
          AND status IN ('ok','error')
          AND created_at > now() - ($2 || ' seconds')::interval`,
      [userId, RATE_LIMIT_WINDOW_SECONDS]
    );

    const used = rows[0]?.used ?? 0;
    if (used < RATE_LIMIT_MAX_REQUESTS) {
      return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - used, retryAfterSeconds: 0 };
    }

    const oldest = rows[0]?.oldest ? new Date(rows[0].oldest).getTime() : Date.now();
    const retry = Math.max(
      1,
      Math.ceil((oldest + RATE_LIMIT_WINDOW_SECONDS * 1000 - Date.now()) / 1000)
    );
    return { allowed: false, remaining: 0, retryAfterSeconds: retry };
  } catch (err: any) {
    // Fail open, deliberately: the limiter protects cost and noise, not data.
    // A database hiccup should not take the assistant down for everyone.
    console.error("[admin-ai] rate limit check failed, allowing:", err?.message);
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS, retryAfterSeconds: 0 };
  }
}

export const AI_RATE_LIMIT = {
  windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
};
