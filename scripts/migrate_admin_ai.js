// migrate_admin_ai.js — tables for the Admin AI copilot.
//
// Three tables, no duplication of CRM data: conversations and messages exist so
// follow-up questions ("which manager generated the most?") can resolve against
// earlier turns, and the audit log exists so every AI request is attributable.
//
// Deliberately NOT stored: the retrieved CRM context sent to the model. It is a
// copy of rows that already live in their own tables, it would be the single
// richest target in the database, and the audit trail only needs to say WHICH
// modules were touched, not replay their contents.
//
// Run:  node scripts/migrate_admin_ai.js
require("@next/env").loadEnvConfig(process.cwd());
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Admin AI migration — starting");

    // pg_trgm backs the knowledge search over follow-up text and notes. Chosen
    // over pgvector because the `vector` extension is not available on this
    // server, and at this corpus size trigram ranking is both faster and free.
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    console.log("  ✓ pg_trgm extension");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id           SERIAL PRIMARY KEY,
        user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    console.log("  ✓ ai_conversations");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id              SERIAL PRIMARY KEY,
        conversation_id INT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content         TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    console.log("  ✓ ai_messages");

    // organization_id is carried even though this deployment is single-tenant
    // (one row in organization_settings): an audit row that cannot name its
    // tenant is useless the day a second one exists, and backfilling audit
    // history later is not possible.
    await client.query(`
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
      )`);
    console.log("  ✓ ai_audit_logs");

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
                          ON ai_conversations(user_id, updated_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
                          ON ai_messages(conversation_id, created_at ASC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_audit_user_time
                          ON ai_audit_logs(user_id, created_at DESC)`);
    // Rate limiting counts a user's recent requests; without this it is a scan.
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_audit_time
                          ON ai_audit_logs(created_at DESC)`);
    console.log("  ✓ indexes");

    // Trigram indexes for the knowledge-search tool. Only on the text columns it
    // actually ranks over, so writes elsewhere are unaffected.
    await client.query(`CREATE INDEX IF NOT EXISTS idx_follow_ups_message_trgm
                          ON follow_ups USING gin (message gin_trgm_ops)`);
    console.log("  ✓ follow_ups trigram index");

    await client.query("COMMIT");
    console.log("Admin AI migration — done");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Admin AI migration FAILED, rolled back:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
