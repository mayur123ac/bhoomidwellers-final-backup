// @vitest-environment node
//
// src/lib/import/__tests__/schema-constraints.test.ts
//
// Schema-level regression tests for database constraints that the import
// engine depends on.
//
// WHY THIS FILE EXISTS
// ─────────────────────
// On 2026-08-31 a real import failed silently: all 5 valid rows received
// COMMIT_ERROR "there is no unique or exclusion constraint matching the ON
// CONFLICT specification". The migration 2026-08-26_tenant_scope_external_ref
// .sql had been written and committed to the repo on 2026-08-26 but was never
// applied to the Neon production database. The code was correct; the schema
// was stale. No existing test caught the mismatch because all import tests
// mock the DB client.
//
// These tests connect to the REAL database (DATABASE_URL) and query pg_indexes
// directly. They will fail if a required migration was not applied, giving an
// immediate signal before any import run silently wastes data.
//
// SKIP BEHAVIOUR
// ──────────────
// All tests in this file are skipped when DATABASE_URL is not set (e.g. pure
// unit-test CI environments that don't provision Postgres). When DATABASE_URL
// IS set (local dev, integration CI) the tests must pass.

import { describe, it, expect, afterAll } from "vitest";
import { Pool } from "pg";

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: Pool | undefined;
if (DB_URL) {
  pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
}

afterAll(async () => {
  if (pool) await pool.end();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function getIndex(tableName: string, indexName: string) {
  if (!pool) return null;
  const res = await pool.query<{
    indexname: string;
    indexdef: string;
    indisunique: boolean;
  }>(
    `SELECT
       pg_indexes.indexname,
       pg_indexes.indexdef,
       i.indisunique
     FROM pg_indexes
     JOIN pg_class c ON c.relname = pg_indexes.indexname
     JOIN pg_index i ON i.indexrelid = c.oid
     WHERE pg_indexes.tablename = $1
       AND pg_indexes.indexname = $2`,
    [tableName, indexName]
  );
  return res.rows[0] ?? null;
}

// ── walkin_enquiries ──────────────────────────────────────────────────────────

describeIfDb("walkin_enquiries schema constraints", () => {
  // ── Migration: 2026-08-26_tenant_scope_external_ref.sql ───────────────────
  //
  // The import engine (engine.ts:719) and bulkInsertLeads.ts (line 85) both use:
  //   ON CONFLICT (organization_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
  //
  // That clause requires a UNIQUE partial index on (organization_id, external_ref).
  // Without it PostgreSQL throws "there is no unique or exclusion constraint
  // matching the ON CONFLICT specification" on every walkin_enquiries INSERT,
  // causing every import row to fail with COMMIT_ERROR.

  it("ux_enquiry_org_external_ref exists — required by ON CONFLICT in engine.ts", async () => {
    const idx = await getIndex("walkin_enquiries", "ux_enquiry_org_external_ref");
    expect(
      idx,
      "Index ux_enquiry_org_external_ref is missing.\n" +
      "Apply migration: scripts/migrations/2026-08-26_tenant_scope_external_ref.sql"
    ).not.toBeNull();
  });

  it("ux_enquiry_org_external_ref is a UNIQUE index", async () => {
    const idx = await getIndex("walkin_enquiries", "ux_enquiry_org_external_ref");
    expect(
      idx?.indisunique,
      "Index ux_enquiry_org_external_ref must be UNIQUE for ON CONFLICT to work.\n" +
      "Re-create it with: CREATE UNIQUE INDEX ux_enquiry_org_external_ref ..."
    ).toBe(true);
  });

  it("ux_enquiry_org_external_ref covers organization_id and external_ref", async () => {
    const idx = await getIndex("walkin_enquiries", "ux_enquiry_org_external_ref");
    expect(idx?.indexdef).toContain("organization_id");
    expect(idx?.indexdef).toContain("external_ref");
  });

  it("ux_enquiry_org_external_ref is a partial index WHERE external_ref IS NOT NULL", async () => {
    const idx = await getIndex("walkin_enquiries", "ux_enquiry_org_external_ref");
    expect(
      idx?.indexdef,
      "Index must be a partial index with WHERE (external_ref IS NOT NULL) " +
      "so that NULL external_ref rows are not subject to the uniqueness constraint"
    ).toContain("external_ref IS NOT NULL");
  });

  it("old global-unique ux_enquiry_external_ref has been dropped", async () => {
    // The old single-column index enforced GLOBAL uniqueness across all orgs.
    // Two orgs using the same Form No would incorrectly conflict.
    // The migration drops it; if it still exists, the tenant-scoped index is missing.
    const old = await getIndex("walkin_enquiries", "ux_enquiry_external_ref");
    expect(
      old,
      "Old global-unique index ux_enquiry_external_ref still exists.\n" +
      "Apply migration: scripts/migrations/2026-08-26_tenant_scope_external_ref.sql\n" +
      "Run: DROP INDEX ux_enquiry_external_ref;"
    ).toBeNull();
  });

  // ── Functional verification ───────────────────────────────────────────────
  //
  // Beyond structural checks, verify the index actually enables the ON CONFLICT
  // clause to work. Uses a transaction that is always rolled back so no test
  // data leaks into production.

  it("ON CONFLICT (organization_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING works in practice", async () => {
    if (!pool) return;

    // Fetch two distinct real org IDs so the FK constraint on organization_id is satisfied.
    // The entire test runs in a transaction that is always rolled back — no data leaks.
    const orgsRes = await pool.query<{ id: string }>(
      "SELECT id FROM organizations ORDER BY created_at LIMIT 2"
    );
    const ORG_A = orgsRes.rows[0]?.id;
    const ORG_B = orgsRes.rows[1]?.id;
    if (!ORG_A) {
      // No organisations in the DB — skip gracefully rather than fail misleadingly.
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const TEST_REF = "SCHEMA_CONSTRAINT_TEST_REF_DO_NOT_RETAIN";

      const insertSql = `
        INSERT INTO walkin_enquiries (
          name, phone, source, budget, loan_planned, assigned_to,
          status, is_global_shared, auto_date_enabled,
          external_ref, organization_id
        ) VALUES (
          'Schema Test Lead', '9999000099', 'Direct Walk-in',
          'Pending', 'Pending', 'Test',
          'Assigned', false, false,
          $1, $2
        )
        ON CONFLICT (organization_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
        RETURNING id
      `;

      // First insert → should succeed (returns id)
      const r1 = await client.query(insertSql, [TEST_REF, ORG_A]);
      expect(r1.rows).toHaveLength(1);
      expect(r1.rows[0].id).toBeTypeOf("number");

      // Second insert → same org + same ext ref → ON CONFLICT, returns 0 rows
      const r2 = await client.query(insertSql, [TEST_REF, ORG_A]);
      expect(r2.rows).toHaveLength(0);

      // Third insert → different org + same ext ref → new row (multi-tenant isolation)
      if (ORG_B) {
        const r3 = await client.query(insertSql, [TEST_REF, ORG_B]);
        expect(r3.rows).toHaveLength(1);
      }
    } finally {
      await client.query("ROLLBACK"); // never pollutes production
      client.release();
    }
  });
});
