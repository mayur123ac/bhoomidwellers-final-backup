// src/lib/import/engine.savepoint.test.ts
//
// Integration-level test for per-row SAVEPOINT isolation in commitImport.
//
// Scenario
// ─────────
//   Row 1  "Direct Walk-in" lead — succeeds
//          SAVEPOINT sp1 → INSERT walkin_enquiries returns id →
//          RELEASE SAVEPOINT sp1
//
//   Row 2  "Direct Walk-in" lead — INSERT walkin_enquiries throws a real
//          Postgres unique-constraint error (code '23505'), simulating e.g.
//          a phone number that already exists in the database
//          SAVEPOINT sp2 → INSERT throws → ROLLBACK TO SAVEPOINT sp2 →
//          failure logged (UPDATE import_rows + INSERT import_errors)
//
//   Row 3  "Direct Walk-in" lead — succeeds
//          SAVEPOINT sp3 → INSERT walkin_enquiries returns id →
//          RELEASE SAVEPOINT sp3
//
// Verified properties
// ────────────────────
//   1. commitImport returns created=2, failed=1, skipped=0
//   2. A SAVEPOINT is set for every row
//   3. sp1 and sp3 are RELEASED (success); sp2 is rolled back, never released
//   4. No bare ROLLBACK is issued — the outer transaction remains open
//   5. Failure-logging queries (UPDATE import_rows + INSERT import_errors)
//      execute successfully AFTER the ROLLBACK TO SAVEPOINT sp2
//   6. Row 3's INSERT INTO walkin_enquiries runs after row 2's rollback,
//      proving the outer transaction is still healthy
//
// No real database is required. The PoolClient is mocked; the Postgres error
// is simulated by throwing an Error with { code: "23505" }.

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Module mocks (hoisted by Vitest before all imports) ───────────────────

vi.mock("@/lib/cpCommissionEngine", () => ({
  isChannelPartnerSource: vi.fn().mockReturnValue(false),
  resolveChannelPartnerId: vi.fn().mockResolvedValue(null),
}));

vi.mock("./dedup", () => ({
  runDedup: vi.fn().mockResolvedValue([]),
  getMergeFields: vi.fn().mockReturnValue({}),
}));

vi.mock("./createImportBooking", () => ({
  createImportBooking: vi.fn().mockResolvedValue({
    bookingId: 1,
    bookingNumber: "BK-2026-01-01-00001",
    flatAllocationStatus: "PENDING",
    warnings: [],
  }),
}));

// query  — used by getImportJob() outside the transaction
// transaction — wraps the entire commit; must call callback with mock client
// recalculateSrNos — called at end of loop; we stub it out
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  recalculateSrNos: vi.fn().mockResolvedValue(undefined),
}));

import { commitImport } from "./engine";
import { query as dbQuery, transaction } from "@/lib/db";

// ── Constants ─────────────────────────────────────────────────────────────

const JOB_ID = "test-job-savepoint-001";
const ORG_ID = "test-org-savepoint-001";
const COMMITTED_BY = "Test Committer";

// ── Test data factories ────────────────────────────────────────────────────

function makeJob() {
  return {
    id: JOB_ID,
    status: "ready_for_review",
    organization_id: ORG_ID,
    filename: "test.xlsx",
    assigned_to: COMMITTED_BY,
    overseeing_site_head: null,
    invalid_rows: 0,
  };
}

// Minimal staged row — no booking fields, no feedback, action = 'create'.
// Keeping normalized_data lean: only the fields commitImport actually reads.
function makeRow(id: string, rowNum: number, name: string) {
  return {
    id,
    import_job_id: JOB_ID,
    organization_id: ORG_ID,
    source_row_number: rowNum,
    source_sheet: "Sheet1",
    normalized_data: {
      name,
      phone: `9990000${rowNum.toString().padStart(3, "0")}`,
      alt_phone: null,
      external_ref: null,
      enquiry_date: "2026-01-15T00:00:00.000Z",
      source: "Direct Walk-in",
      cp_name: null,
      cp_phone: null,
      feedback: null,
      configuration: null,
      budget: null,
    },
    validation_status: "valid",
    proposed_action: "create",
    user_override_action: null,
    final_action: null,
    matched_record_id: null,
    target_record_id: null,
    pre_update_snapshot: null,
    warnings: [],
    errors: [],
  };
}

// ── Mock client factory ────────────────────────────────────────────────────

type QueryRecord = { sql: string; params: unknown[] };

function makeMockClient() {
  const queries: QueryRecord[] = [];
  let walkinInsertCount = 0;

  const client = {
    query: vi.fn().mockImplementation(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const norm = sql.replace(/\s+/g, " ").trimStart();

      // ── SAVEPOINT family ────────────────────────────────────────────────
      // Always succeed. In a real connection these alter the transaction
      // checkpoint — here we just record them for assertion.
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(norm)) {
        return { rows: [] };
      }

      // ── Advisory lock ────────────────────────────────────────────────────
      if (norm.includes("pg_advisory_xact_lock")) return { rows: [] };

      // ── Status transitions ───────────────────────────────────────────────
      // transitionStatus() checks rows.length > 0 and throws on empty.
      // Return the job id for any UPDATE import_jobs ... RETURNING id.
      if (norm.startsWith("UPDATE import_jobs") && /RETURNING\s+id/i.test(norm)) {
        return { rows: [{ id: JOB_ID }] };
      }

      // ── Staged rows fetch ─────────────────────────────────────────────────
      // Return the three test rows for the SELECT * FROM import_rows WHERE
      // validation_status = 'valid' query.
      if (
        norm.startsWith("SELECT") &&
        norm.includes("FROM import_rows") &&
        norm.includes("valid")
      ) {
        return {
          rows: [
            makeRow("row-1", 1, "Alice Sharma"),
            makeRow("row-2", 2, "Bob Patil"),
            makeRow("row-3", 3, "Charlie Desai"),
          ],
        };
      }

      // ── walkin_enquiries INSERT ───────────────────────────────────────────
      // Throw a real Postgres unique-constraint error on the SECOND call to
      // simulate a phone number collision. All other calls succeed.
      if (norm.startsWith("INSERT INTO walkin_enquiries")) {
        walkinInsertCount++;
        if (walkinInsertCount === 2) {
          throw Object.assign(
            new Error(
              `duplicate key value violates unique constraint "walkin_enquiries_phone_key"`
            ),
            { code: "23505", detail: `Key (phone)=(9990000002) already exists.` }
          );
        }
        return { rows: [{ id: 1000 + walkinInsertCount }] };
      }

      // ── Everything else ──────────────────────────────────────────────────
      // UPDATE import_rows, INSERT import_errors, UPDATE import_jobs (counts),
      // etc. All succeed with empty result.
      return { rows: [] };
    }),
    _queries: queries,
  };

  return client as unknown as import("pg").PoolClient & { _queries: QueryRecord[] };
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("commitImport — per-row SAVEPOINT isolation", () => {
  let mockClient: ReturnType<typeof makeMockClient>;
  let result: Awaited<ReturnType<typeof commitImport>>;
  let sqls: string[];

  beforeEach(async () => {
    mockClient = makeMockClient();

    // getImportJob() uses the module-level query(), not client.query()
    vi.mocked(dbQuery).mockResolvedValue([makeJob()] as any);

    // transaction() must call the callback with the mock client and return its result
    vi.mocked(transaction).mockImplementation(async (fn: any) => fn(mockClient));

    // Run the real commitImport with all its business logic intact.
    // The only substitution is the DB I/O layer.
    result = await commitImport(JOB_ID, ORG_ID, COMMITTED_BY);

    sqls = mockClient._queries.map((q) => q.sql.replace(/\s+/g, " ").trimStart());
  });

  // ── 1. Row counts ─────────────────────────────────────────────────────────

  it("returns created=2 failed=1 skipped=0 — all three rows accounted for", () => {
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
  });

  // ── 2. SAVEPOINT set for every row ────────────────────────────────────────

  it("sets a SAVEPOINT before processing each row", () => {
    expect(sqls).toContain("SAVEPOINT sp1");
    expect(sqls).toContain("SAVEPOINT sp2");
    expect(sqls).toContain("SAVEPOINT sp3");
  });

  // ── 3. RELEASE on success, ROLLBACK on failure, never mixed ──────────────

  it("releases SAVEPOINTs for rows 1 and 3 and rolls back only row 2", () => {
    // Successful rows: RELEASE
    expect(sqls).toContain("RELEASE SAVEPOINT sp1");
    expect(sqls).toContain("RELEASE SAVEPOINT sp3");

    // Failed row: ROLLBACK TO, never RELEASE
    expect(sqls).toContain("ROLLBACK TO SAVEPOINT sp2");
    expect(sqls).not.toContain("RELEASE SAVEPOINT sp2");
  });

  // ── 4. No bare ROLLBACK ───────────────────────────────────────────────────

  it("never issues a bare ROLLBACK — outer transaction stays open", () => {
    // A bare ROLLBACK would close the entire transaction and make it impossible
    // for row 3 or the final status-transition UPDATE to succeed.
    const bareRollbacks = sqls.filter((s) => s.trim() === "ROLLBACK");
    expect(bareRollbacks).toHaveLength(0);
  });

  // ── 5. Failure logging executes after the ROLLBACK TO SAVEPOINT ───────────

  it("logs row 2 failure only after rolling back its savepoint", () => {
    const rollback2Idx = sqls.indexOf("ROLLBACK TO SAVEPOINT sp2");
    expect(rollback2Idx, "ROLLBACK TO SAVEPOINT sp2 not found").toBeGreaterThan(-1);

    // UPDATE import_rows SET final_action = 'failed' comes after the rollback.
    // Before the SAVEPOINT fix, this query would fail with
    // "current transaction is aborted, commands ignored until end of
    // transaction block" because the transaction was still in the error state.
    const failedUpdateIdx = sqls.findIndex(
      (s, i) =>
        i > rollback2Idx &&
        s.includes("UPDATE import_rows") &&
        s.includes("final_action = 'failed'")
    );
    expect(
      failedUpdateIdx,
      "UPDATE import_rows final_action='failed' must come after ROLLBACK TO SAVEPOINT sp2"
    ).toBeGreaterThan(rollback2Idx);

    // INSERT into import_errors also executes after the rollback.
    const errorInsertIdx = sqls.findIndex(
      (s, i) => i > rollback2Idx && s.startsWith("INSERT INTO import_errors")
    );
    expect(
      errorInsertIdx,
      "INSERT INTO import_errors must come after ROLLBACK TO SAVEPOINT sp2"
    ).toBeGreaterThan(rollback2Idx);
  });

  // ── 6. Row 3 runs after row 2's rollback — outer transaction healthy ───────

  it("processes row 3 successfully after row 2 fails", () => {
    const rollback2Idx = sqls.indexOf("ROLLBACK TO SAVEPOINT sp2");
    const sp3Idx = sqls.indexOf("SAVEPOINT sp3");
    const release3Idx = sqls.indexOf("RELEASE SAVEPOINT sp3");

    // SAVEPOINT sp3 is set after row 2's rollback
    expect(sp3Idx, "SAVEPOINT sp3 must come after ROLLBACK TO SAVEPOINT sp2").toBeGreaterThan(
      rollback2Idx
    );

    // RELEASE SAVEPOINT sp3 confirms row 3 completed without error
    expect(release3Idx, "RELEASE SAVEPOINT sp3 must follow SAVEPOINT sp3").toBeGreaterThan(
      sp3Idx
    );

    // Row 3's walkin INSERT is sandwiched between sp3 and its release,
    // proving the connection accepted a new query after the row 2 rollback.
    const row3WalkinIdx = sqls.findIndex(
      (s, i) =>
        i > sp3Idx &&
        i < release3Idx &&
        s.startsWith("INSERT INTO walkin_enquiries")
    );
    expect(
      row3WalkinIdx,
      "INSERT INTO walkin_enquiries for row 3 must be between SAVEPOINT sp3 and RELEASE SAVEPOINT sp3"
    ).toBeGreaterThan(-1);
  });
});
