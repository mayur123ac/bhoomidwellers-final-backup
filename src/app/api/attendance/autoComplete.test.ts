// @vitest-environment node
//
// Auto-Complete Attendance Tests
//
// Tests the midnight auto-complete logic without a real database.
// The SQL queries are tested via mocked `query` calls.
//
// Note: these are unit tests that verify argument passing, call ordering,
// report shape, and guard logic. The actual SQL correctness (timezone
// conversions, date boundaries) requires integration tests against a
// real Postgres instance — those are out of scope here.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock db.query ───────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// Import after mock setup
const { autoCompleteAttendance } = await import("./auto-complete/route");

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set up the date-computation query response.
 * isFuture defaults to false (eligible past date).
 */
function mockDateQuery(
  targetDate = "2026-10-26",
  midnightBoundary = "2026-10-27T00:00:00+05:30",
  isFuture = false,
) {
  mockQuery.mockResolvedValueOnce([{
    target_date: targetDate,
    midnight_boundary: midnightBoundary,
    is_future: isFuture,
  }]);
}

/** Mock BEGIN — the transaction start. */
function mockBegin() {
  mockQuery.mockResolvedValueOnce([]);
}

/** Return N period IDs as if updated. */
function mockPeriodsUpdate(count: number) {
  mockQuery.mockResolvedValueOnce(Array.from({ length: count }, (_, i) => ({ id: i + 1 })));
}

/** Return N record IDs as if updated. */
function mockRecordsUpdate(count: number) {
  mockQuery.mockResolvedValueOnce(Array.from({ length: count }, (_, i) => ({ id: i + 1 })));
}

/** Mock COMMIT. */
function mockCommit() {
  mockQuery.mockResolvedValueOnce([]);
}

/** Return the skipped count. */
function mockSkippedCount(count: number) {
  mockQuery.mockResolvedValueOnce([{ count: String(count) }]);
}

/**
 * Standard happy-path mock sequence:
 * 1. date query → 2. BEGIN → 3. periods update → 4. records update → 5. COMMIT → 6. skipped count
 */
function mockHappyPath(opts: {
  targetDate?: string;
  midnightBoundary?: string;
  periods?: number;
  records?: number;
  skipped?: number;
} = {}) {
  mockDateQuery(opts.targetDate, opts.midnightBoundary);
  mockBegin();
  mockPeriodsUpdate(opts.periods ?? 0);
  mockRecordsUpdate(opts.records ?? 0);
  mockCommit();
  mockSkippedCount(opts.skipped ?? 0);
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

describe("autoCompleteAttendance", () => {
  it("completes active records at the correct midnight IST boundary", async () => {
    mockHappyPath({
      targetDate: "2026-10-26",
      midnightBoundary: "2026-10-26T18:30:00.000Z",
      periods: 1,
      records: 2,
      skipped: 3,
    });

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.targetDate).toBe("2026-10-26");
    expect(report.completed).toBe(2);
    expect(report.periodsCompleted).toBe(1);
    expect(report.skipped).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("calculates duration from submitted_at to midnight boundary", async () => {
    mockHappyPath({
      targetDate: "2026-10-26",
      midnightBoundary: "2026-10-26T18:30:00.000Z",
      records: 1,
    });

    const report = await autoCompleteAttendance("2026-10-26");

    // Call order: 0=date, 1=BEGIN, 2=periods, 3=records, 4=COMMIT, 5=skipped
    // Step 2 (records) SQL uses: EXTRACT(EPOCH FROM ($2::timestamptz - (submitted_at AT TIME ZONE 'UTC')))
    const recordsCall = mockQuery.mock.calls[3];
    expect(recordsCall[1]).toContain("2026-10-26");
    expect(recordsCall[1]).toContain("2026-10-26T18:30:00.000Z");
    expect(report.completed).toBe(1);
  });

  it("leaves already-completed records unchanged", async () => {
    mockHappyPath({ skipped: 5 });

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.completed).toBe(0);
    expect(report.skipped).toBe(5);
    expect(report.failed).toBe(0);
  });

  it("does nothing when no attendance records exist", async () => {
    mockHappyPath();

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.completed).toBe(0);
    expect(report.periodsCompleted).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.failed).toBe(0);
  });

  it("does not affect records from other dates", async () => {
    mockHappyPath();

    await autoCompleteAttendance("2026-10-26");

    // Call order: 0=date, 1=BEGIN, 2=periods, 3=records, 4=COMMIT, 5=skipped
    // Parameterised queries are at indices 2 (periods), 3 (records), 5 (skipped)
    for (const idx of [2, 3, 5]) {
      const params = mockQuery.mock.calls[idx][1] as string[];
      expect(params[0]).toBe("2026-10-26");
    }
  });

  it("finalizes multiple periods without double-counting", async () => {
    mockHappyPath({
      midnightBoundary: "2026-10-26T18:30:00.000Z",
      periods: 3,
      records: 2,
      skipped: 1,
    });

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.periodsCompleted).toBe(3);
    expect(report.completed).toBe(2);

    // Periods query (call index 2) uses WHERE ap.completed_at IS NULL
    const periodsSQL = mockQuery.mock.calls[2][0] as string;
    expect(periodsSQL).toContain("ap.completed_at IS NULL");
  });

  it("is idempotent — repeated execution produces no changes", async () => {
    // First run
    mockHappyPath({ periods: 1, records: 2, skipped: 3 });
    const first = await autoCompleteAttendance("2026-10-26");
    expect(first.completed).toBe(2);

    // Second run — everything already closed
    mockHappyPath({ skipped: 5 });
    const second = await autoCompleteAttendance("2026-10-26");
    expect(second.completed).toBe(0);
    expect(second.skipped).toBe(5);
  });

  it("reports errors and rolls back on database failure", async () => {
    mockDateQuery("2026-10-26");
    mockBegin();
    // Periods update throws
    mockQuery.mockRejectedValueOnce(new Error("connection reset"));
    // ROLLBACK after catch
    mockQuery.mockResolvedValueOnce([]);

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.failed).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("connection reset");

    // Verify ROLLBACK was issued
    const rollbackCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0] === "ROLLBACK"
    );
    expect(rollbackCall).toBeTruthy();
  });

  it("uses UTC+05:30 midnight when server is in UTC", async () => {
    mockHappyPath({
      targetDate: "2026-10-26",
      midnightBoundary: "2026-10-26T18:30:00.000Z",
      records: 1,
    });

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.midnightBoundary).toBe("2026-10-26T18:30:00.000Z");
    expect(report.completed).toBe(1);
  });

  it("defaults to yesterday IST when no date is provided", async () => {
    mockHappyPath({ targetDate: "2026-10-26" });

    const report = await autoCompleteAttendance(); // no date arg

    // First query receives [null] as parameter
    expect(mockQuery.mock.calls[0][1]).toEqual([null]);
    expect(report.targetDate).toBe("2026-10-26");
  });

  it("rejects future dates (today IST or later)", async () => {
    mockDateQuery("2026-10-27", "2026-10-28T00:00:00+05:30", true);

    const report = await autoCompleteAttendance("2026-10-27");

    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("today or in the future");
    expect(report.completed).toBe(0);
    // No BEGIN/UPDATE/COMMIT calls — only the date query
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects today's date (not yet elapsed in IST)", async () => {
    mockDateQuery("2026-10-26", "2026-10-27T00:00:00+05:30", true);

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("today or in the future");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("wraps period + record updates in a transaction", async () => {
    mockHappyPath({ periods: 1, records: 1 });

    await autoCompleteAttendance("2026-10-26");

    // Call order: 0=date, 1=BEGIN, 2=periods, 3=records, 4=COMMIT, 5=skipped
    expect(mockQuery.mock.calls[1][0]).toBe("BEGIN");
    expect(mockQuery.mock.calls[4][0]).toBe("COMMIT");
  });
});

describe("auto-complete HTTP handler", () => {
  it("exports GET and POST handlers", async () => {
    const mod = await import("./auto-complete/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });
});
