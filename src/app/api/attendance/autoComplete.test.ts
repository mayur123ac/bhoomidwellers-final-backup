// @vitest-environment node
//
// Auto-Complete Attendance Tests
//
// Tests the auto-complete logic (both midnight and end-of-day modes)
// without a real database. The SQL queries are tested via mocked `query` calls.
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
 * isFuture defaults to false (eligible date).
 */
function mockDateQuery(
  targetDate = "2026-10-26",
  completionBoundary = "2026-10-27T00:00:00+05:30",
  isFuture = false,
) {
  mockQuery.mockResolvedValueOnce([{
    target_date: targetDate,
    completion_boundary: completionBoundary,
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
 * 1. date query -> 2. BEGIN -> 3. periods update -> 4. records update -> 5. COMMIT -> 6. skipped count
 */
function mockHappyPath(opts: {
  targetDate?: string;
  completionBoundary?: string;
  periods?: number;
  records?: number;
  skipped?: number;
} = {}) {
  mockDateQuery(opts.targetDate, opts.completionBoundary);
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

describe("autoCompleteAttendance — midnight mode (default)", () => {
  it("completes active records at the correct midnight IST boundary", async () => {
    mockHappyPath({
      targetDate: "2026-10-26",
      completionBoundary: "2026-10-26T18:30:00.000Z",
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

  it("calculates duration from submitted_at to completion boundary", async () => {
    mockHappyPath({
      targetDate: "2026-10-26",
      completionBoundary: "2026-10-26T18:30:00.000Z",
      records: 1,
    });

    const report = await autoCompleteAttendance("2026-10-26");

    // Call order: 0=date, 1=BEGIN, 2=periods, 3=records, 4=COMMIT, 5=skipped
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

    for (const idx of [2, 3, 5]) {
      const params = mockQuery.mock.calls[idx][1] as string[];
      expect(params[0]).toBe("2026-10-26");
    }
  });

  it("finalizes multiple periods without double-counting", async () => {
    mockHappyPath({
      completionBoundary: "2026-10-26T18:30:00.000Z",
      periods: 3,
      records: 2,
      skipped: 1,
    });

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.periodsCompleted).toBe(3);
    expect(report.completed).toBe(2);

    const periodsSQL = mockQuery.mock.calls[2][0] as string;
    expect(periodsSQL).toContain("ap.completed_at IS NULL");
  });

  it("is idempotent — repeated execution produces no changes", async () => {
    mockHappyPath({ periods: 1, records: 2, skipped: 3 });
    const first = await autoCompleteAttendance("2026-10-26");
    expect(first.completed).toBe(2);

    mockHappyPath({ skipped: 5 });
    const second = await autoCompleteAttendance("2026-10-26");
    expect(second.completed).toBe(0);
    expect(second.skipped).toBe(5);
  });

  it("reports errors and rolls back on database failure", async () => {
    mockDateQuery("2026-10-26");
    mockBegin();
    mockQuery.mockRejectedValueOnce(new Error("connection reset"));
    mockQuery.mockResolvedValueOnce([]); // ROLLBACK

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.failed).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("connection reset");

    const rollbackCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0] === "ROLLBACK"
    );
    expect(rollbackCall).toBeTruthy();
  });

  it("uses UTC+05:30 midnight when server is in UTC", async () => {
    mockHappyPath({
      targetDate: "2026-10-26",
      completionBoundary: "2026-10-26T18:30:00.000Z",
      records: 1,
    });

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.completionBoundary).toBe("2026-10-26T18:30:00.000Z");
    expect(report.completed).toBe(1);
  });

  it("defaults to yesterday IST when no date is provided", async () => {
    mockHappyPath({ targetDate: "2026-10-26" });

    const report = await autoCompleteAttendance();

    expect(mockQuery.mock.calls[0][1]).toEqual([null, null]);
    expect(report.targetDate).toBe("2026-10-26");
  });

  it("rejects future dates (today IST or later)", async () => {
    mockDateQuery("2026-10-27", "2026-10-28T00:00:00+05:30", true);

    const report = await autoCompleteAttendance("2026-10-27");

    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("future");
    expect(report.completed).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects today's date in midnight mode", async () => {
    mockDateQuery("2026-10-26", "2026-10-27T00:00:00+05:30", true);

    const report = await autoCompleteAttendance("2026-10-26");

    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("future");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("wraps period + record updates in a transaction", async () => {
    mockHappyPath({ periods: 1, records: 1 });

    await autoCompleteAttendance("2026-10-26");

    expect(mockQuery.mock.calls[1][0]).toBe("BEGIN");
    expect(mockQuery.mock.calls[4][0]).toBe("COMMIT");
  });
});

describe("autoCompleteAttendance — end-of-day mode", () => {
  const EOD_OPTS = { completionTimeIst: "23:58:00" };

  it("passes completionTimeIst as $2 to the date query", async () => {
    mockHappyPath({
      targetDate: "2026-10-29",
      completionBoundary: "2026-10-29T18:28:00.000Z",
    });

    await autoCompleteAttendance(undefined, EOD_OPTS);

    // First query: $1=null (no date override), $2="23:58:00"
    expect(mockQuery.mock.calls[0][1]).toEqual([null, "23:58:00"]);
  });

  it("completes today's open records at 23:58 IST", async () => {
    mockHappyPath({
      targetDate: "2026-10-29",
      completionBoundary: "2026-10-29T18:28:00.000Z",
      periods: 2,
      records: 3,
      skipped: 1,
    });

    const report = await autoCompleteAttendance(undefined, EOD_OPTS);

    expect(report.targetDate).toBe("2026-10-29");
    expect(report.completionBoundary).toBe("2026-10-29T18:28:00.000Z");
    expect(report.completed).toBe(3);
    expect(report.periodsCompleted).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(0);
  });

  it("allows today's date in end-of-day mode", async () => {
    // is_future = false even though target is today
    mockHappyPath({
      targetDate: "2026-10-29",
      completionBoundary: "2026-10-29T18:28:00.000Z",
      records: 1,
    });

    const report = await autoCompleteAttendance("2026-10-29", EOD_OPTS);

    expect(report.failed).toBe(0);
    expect(report.completed).toBe(1);
  });

  it("rejects tomorrow's date in end-of-day mode", async () => {
    mockDateQuery("2026-10-30", "2026-10-30T18:28:00.000Z", true);

    const report = await autoCompleteAttendance("2026-10-30", EOD_OPTS);

    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("future");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("uses 23:58 IST as completion boundary, not midnight", async () => {
    mockHappyPath({
      targetDate: "2026-10-29",
      completionBoundary: "2026-10-29T18:28:00.000Z",
      records: 1,
    });

    const report = await autoCompleteAttendance("2026-10-29", EOD_OPTS);

    // 23:58 IST = 18:28 UTC
    expect(report.completionBoundary).toBe("2026-10-29T18:28:00.000Z");
  });

  it("is idempotent — second run finds nothing to complete", async () => {
    mockHappyPath({
      targetDate: "2026-10-29",
      completionBoundary: "2026-10-29T18:28:00.000Z",
      records: 2,
      skipped: 1,
    });
    const first = await autoCompleteAttendance(undefined, EOD_OPTS);
    expect(first.completed).toBe(2);

    mockHappyPath({
      targetDate: "2026-10-29",
      completionBoundary: "2026-10-29T18:28:00.000Z",
      skipped: 3,
    });
    const second = await autoCompleteAttendance(undefined, EOD_OPTS);
    expect(second.completed).toBe(0);
    expect(second.skipped).toBe(3);
  });

  it("does not overwrite a manual checkout done before 23:58", async () => {
    mockHappyPath({
      targetDate: "2026-10-29",
      completionBoundary: "2026-10-29T18:28:00.000Z",
      records: 0, // no open records — employee already checked out
      skipped: 1,
    });

    const report = await autoCompleteAttendance(undefined, EOD_OPTS);

    expect(report.completed).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("can also process a past date with end-of-day time", async () => {
    mockHappyPath({
      targetDate: "2026-10-27",
      completionBoundary: "2026-10-27T18:28:00.000Z",
      records: 1,
    });

    const report = await autoCompleteAttendance("2026-10-27", EOD_OPTS);

    expect(report.failed).toBe(0);
    expect(report.completed).toBe(1);
  });
});

describe("auto-complete HTTP handler", () => {
  it("exports GET and POST handlers", async () => {
    const mod = await import("./auto-complete/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });
});
