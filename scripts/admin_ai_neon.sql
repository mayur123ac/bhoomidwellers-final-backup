-- admin_ai_neon.sql — run this on Neon (pgAdmin / SQL editor) before deploying.
--
-- Same DDL as scripts/migrate_admin_ai.js, which has already been applied to the
-- local database. Provided as plain SQL because the deploy pattern here is manual
-- DDL rather than a migration runner.
--
-- Idempotent: every statement is IF NOT EXISTS, so re-running is safe.
--
-- ORDER MATTERS on production:
--   1. set SESSION_SECRET in the environment   ← without it, login returns 503
--   2. run this file
--   3. deploy
-- Reversing 1 and 3 takes the whole CRM down for every user, not just the AI.

BEGIN;

-- Backs searchKnowledgeBase. pgvector is not used: the `vector` extension is
-- unavailable on the local server, and at this corpus size trigram ranking is
-- faster and costs nothing per query. Neon does offer pgvector if you later want
-- embeddings — only lib/admin-ai/services.ts#searchKnowledgeBase would change.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- status values: 'ok' | 'tool_error' | 'error' | 'refused' | 'rate_limited'.
-- 'tool_error' means the model answered but retrieval failed underneath — see
-- the monitoring query at the bottom of this file.
CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id                SERIAL PRIMARY KEY,
  user_id           INT REFERENCES users(id) ON DELETE SET NULL,
  user_name         TEXT,
  user_role         TEXT,
  organization_id   INT,
  conversation_id   INT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  question          TEXT NOT NULL,
  tools_called      JSONB NOT NULL DEFAULT '[]'::jsonb,
  modules_accessed  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  model             TEXT,
  status            TEXT NOT NULL,
  latency_ms        INT,
  prompt_tokens     INT,
  completion_tokens INT,
  total_tokens      INT,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_user_time
  ON ai_audit_logs(user_id, created_at DESC);
-- The rate limiter counts recent rows per user; without this it is a scan.
CREATE INDEX IF NOT EXISTS idx_ai_audit_time
  ON ai_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_follow_ups_message_trgm
  ON follow_ups USING gin (message gin_trgm_ops);

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect 3 rows.
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'ai_%'
 ORDER BY table_name;

-- Expect one row naming pg_trgm.
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';

-- ── Monitoring: run this periodically ──────────────────────────────────────
-- Any non-zero tool_error count means the assistant is answering business
-- questions while its retrieval is failing underneath — the exact condition
-- that hid five broken tools. Investigate with the second query.
--
-- SELECT status, count(*) FROM ai_audit_logs
--  WHERE created_at > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC;
--
-- SELECT created_at, question, tools_called
--   FROM ai_audit_logs WHERE status = 'tool_error'
--  ORDER BY created_at DESC LIMIT 20;
