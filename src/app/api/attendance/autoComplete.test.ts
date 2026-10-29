// @vitest-environment node
//
// Auto-Complete Attendance Tests
//
// Tests the auto-complete logic (midnight, end-of-day, org-scoped, and
// scheduled evaluator modes) without a real database.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock db.query ───────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const { autoCompleteAttendance, evaluateScheduledCompletions } = await import(
  "./auto-complete/route"
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockDateQuery(
  targetDate = "2026-10-26",
  completionBoundary = "2026-10-27T00:00:00+05:30",
  isFuture = false,
  isPremature = false,
) {
  mockQuery.mockResolvedValueOnce([
    { target_date: targetDate, completion_boundary: completionBoundary, is_future: isFuture, is_premature: isPremature },
  ]);
}

function mockBegin() { mockQuery.mockResolvedValueOnce([]); }
function mockPeriodsUpdate(count: number) {
  mockQuery.mockResolvedValueOnce(Array.from({ length: count }, (_, i) => ({ id: i + 1 })));
}
function mockRecordsUpdate(count: number) {
  mockQuery.mockResolvedValueOnce(Array.from({ length: count }, (_, i) => ({ id: i + 1 })));
}
function mockCommit() { mockQuery.mockResolvedValueOnce([]); }
function mockSkippedCount(count: number) {
  mockQuery.mockResolvedValueOnce([{ count: String(count) }]);
}

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

beforeEach(() => { mockQuery.mockReset(); });

describe("autoCompleteAttendance — midnight mode (default)", () => {
  it("completes active records at the correct midnight IST boundary", async () => {
    mockHappyPath({ targetDate: "2026-10-26", completionBoundary: "2026-10-26T18:30:00.000Z", periods: 1, records: 2, skipped: 3 });
    const report = await autoCompleteAttendance("2026-10-26");
    expect(report.targetDate).toBe("2026-10-26");
    expect(report.completed).toBe(2);
    expect(report.periodsCompleted).toBe(1);
    expect(report.skipped).toBe(3);
    expect(report.failed).toBe(0);
  });

  it("leaves already-completed records unchanged", async () => {
    mockHappyPath({ skipped: 5 });
    const report = await autoCompleteAttendance("2026-10-26");
    expect(report.completed).toBe(0);
    expect(report.skipped).toBe(5);
  });

  it("does nothing when no attendance records exist", async () => {
    mockHappyPath();
    const report = await autoCompleteAttendance("2026-10-26");
    expect(report.completed).toBe(0);
    expect(report.periodsCompleted).toBe(0);
  });

  it("does not affect records from other dates", async () => {
    mockHappyPath();
    await autoCompleteAttendance("2026-10-26");
    for (const idx of [2, 3, 5]) {
      const params = mockQuery.mock.calls[idx][1] as string[];
      expect(params[0]).toBe("2026-10-26");
    }
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
    expect(report.errors[0]).toContain("connection reset");
    const rollbackCall = mockQuery.mock.calls.find((c) => c[0] === "ROLLBACK");
    expect(rollbackCall).toBeTruthy();
  });

  it("defaults to yesterday IST when no date is provided", async () => {
    mockHappyPath({ targetDate: "2026-10-26" });
    const report = await autoCompleteAttendance();
    expect(mockQuery.mock.calls[0][1]).toEqual([null, null]);
    expect(report.targetDate).toBe("2026-10-26");
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
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T18:28:00.000Z" });
    await autoCompleteAttendance(undefined, EOD_OPTS);
    expect(mockQuery.mock.calls[0][1]).toEqual([null, "23:58:00"]);
  });

  it("completes today's open records at 23:58 IST", async () => {
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T18:28:00.000Z", periods: 2, records: 3, skipped: 1 });
    const report = await autoCompleteAttendance(undefined, EOD_OPTS);
    expect(report.targetDate).toBe("2026-10-29");
    expect(report.completionBoundary).toBe("2026-10-29T18:28:00.000Z");
    expect(report.completed).toBe(3);
    expect(report.periodsCompleted).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(0);
  });

  it("allows today's date in end-of-day mode", async () => {
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T18:28:00.000Z", records: 1 });
    const report = await autoCompleteAttendance("2026-10-29", EOD_OPTS);
    expect(report.failed).toBe(0);
    expect(report.completed).toBe(1);
  });

  it("rejects tomorrow's date in end-of-day mode", async () => {
    mockDateQuery("2026-10-30", "2026-10-30T18:28:00.000Z", true);
    const report = await autoCompleteAttendance("2026-10-30", EOD_OPTS);
    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("future");
  });

  it("does not overwrite a manual checkout done before 23:58", async () => {
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T18:28:00.000Z", records: 0, skipped: 1 });
    const report = await autoCompleteAttendance(undefined, EOD_OPTS);
    expect(report.completed).toBe(0);
    expect(report.skipped).toBe(1);
  });
});

describe("autoCompleteAttendance — org-scoped mode", () => {
  const ORG_ID = "d4dafc54-2e57-4804-885d-0790e69e0ad0";

  it("passes organizationId as $3 to the SQL queries", async () => {
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T14:30:00.000Z", records: 1 });
    await autoCompleteAttendance("2026-10-29", { completionTimeIst: "20:00:00", organizationId: ORG_ID });

    // Periods query (call 2): params = [date, boundary, orgId]
    expect(mockQuery.mock.calls[2][1][2]).toBe(ORG_ID);
    // Records query (call 3): params = [date, boundary, orgId]
    expect(mockQuery.mock.calls[3][1][2]).toBe(ORG_ID);
    // Skipped query (call 5): params = [date, orgId]
    expect(mockQuery.mock.calls[5][1][1]).toBe(ORG_ID);
  });

  it("passes null orgId when organizationId is omitted", async () => {
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T18:28:00.000Z" });
    await autoCompleteAttendance("2026-10-29", { completionTimeIst: "23:58:00" });

    // $3 should be null
    expect(mockQuery.mock.calls[2][1][2]).toBeNull();
    expect(mockQuery.mock.calls[3][1][2]).toBeNull();
    expect(mockQuery.mock.calls[5][1][1]).toBeNull();
  });

  it("completes only the specified org's records", async () => {
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T14:30:00.000Z", records: 2, periods: 1 });
    const report = await autoCompleteAttendance("2026-10-29", { completionTimeIst: "20:00:00", organizationId: ORG_ID });
    expect(report.completed).toBe(2);
    expect(report.periodsCompleted).toBe(1);
    expect(report.failed).toBe(0);
  });
});

describe("evaluateScheduledCompletions", () => {
  it("queries eligible flexible-mode orgs and processes each", async () => {
    // Step 1: eligible orgs query returns 2 orgs
    mockQuery.mockResolvedValueOnce([
      { organization_id: "org-a", shift_end: "20:00", today_ist: "2026-10-29" },
      { organization_id: "org-b", shift_end: "21:00", today_ist: "2026-10-29" },
    ]);

    // Org A: autoCompleteAttendance calls
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T14:30:00.000Z", records: 2 });
    // Org B: autoCompleteAttendance calls
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T15:30:00.000Z", records: 1 });

    const result = await evaluateScheduledCompletions();

    expect(result.orgsEvaluated).toBe(2);
    expect(result.orgsProcessed).toBe(2);
    expect(result.totalCompleted).toBe(3);
    expect(result.orgsFailed).toBe(0);
    expect(result.details).toHaveLength(2);
    expect(result.details[0].organizationId).toBe("org-a");
    expect(result.details[0].shiftEnd).toBe("20:00");
    expect(result.details[1].organizationId).toBe("org-b");
  });

  it("skips orgs with no open records", async () => {
    mockQuery.mockResolvedValueOnce([
      { organization_id: "org-a", shift_end: "20:00", today_ist: "2026-10-29" },
    ]);
    // All already completed
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T14:30:00.000Z", records: 0, skipped: 5 });

    const result = await evaluateScheduledCompletions();

    expect(result.orgsEvaluated).toBe(1);
    expect(result.orgsProcessed).toBe(0);
    expect(result.orgsSkipped).toBe(1);
    expect(result.totalCompleted).toBe(0);
  });

  it("handles per-org failures without stopping other orgs", async () => {
    mockQuery.mockResolvedValueOnce([
      { organization_id: "org-a", shift_end: "20:00", today_ist: "2026-10-29" },
      { organization_id: "org-b", shift_end: "21:00", today_ist: "2026-10-29" },
    ]);

    // Org A: date query succeeds, then transaction fails
    mockDateQuery("2026-10-29", "2026-10-29T14:30:00.000Z");
    mockBegin();
    mockQuery.mockRejectedValueOnce(new Error("org-a disk full"));
    mockQuery.mockResolvedValueOnce([]); // ROLLBACK

    // Org B: succeeds
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T15:30:00.000Z", records: 1 });

    const result = await evaluateScheduledCompletions();

    expect(result.orgsEvaluated).toBe(2);
    expect(result.orgsFailed).toBe(1);
    expect(result.orgsProcessed).toBe(1);
    expect(result.totalCompleted).toBe(1);
  });

  it("does nothing when no orgs have flexible mode enabled", async () => {
    mockQuery.mockResolvedValueOnce([]); // no eligible orgs

    const result = await evaluateScheduledCompletions();

    expect(result.orgsEvaluated).toBe(0);
    expect(result.orgsProcessed).toBe(0);
    expect(result.totalCompleted).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("normalizes shift_end HH:MM to HH:MM:SS", async () => {
    mockQuery.mockResolvedValueOnce([
      { organization_id: "org-x", shift_end: "20:00", today_ist: "2026-10-29" },
    ]);
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T14:30:00.000Z" });

    await evaluateScheduledCompletions();

    // The date query should receive "20:00:00" as $2
    const dateCall = mockQuery.mock.calls[1]; // call index 1 is the first autoComplete's date query
    expect(dateCall[1][1]).toBe("20:00:00");
  });
});

describe("autoCompleteAttendance — premature-completion safeguard", () => {
  it("refuses when current IST time is well before the cutoff (12:42 PM vs 21:00)", async () => {
    // is_premature = true: it's only 12:42 PM IST but cutoff is 9 PM
    mockDateQuery("2026-10-29", "2026-10-29T15:30:00.000Z", false, true);
    const report = await autoCompleteAttendance("2026-10-29", {
      completionTimeIst: "21:00:00",
      organizationId: "d4dafc54-2e57-4804-885d-0790e69e0ad0",
    });
    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("not been reached yet");
    expect(report.completed).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1); // only date query, no BEGIN
  });

  it("refuses when current IST time is 1 minute before cutoff (20:59 vs 21:00)", async () => {
    mockDateQuery("2026-10-29", "2026-10-29T15:30:00.000Z", false, true);
    const report = await autoCompleteAttendance("2026-10-29", {
      completionTimeIst: "21:00:00",
    });
    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("not been reached yet");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("completes records when cutoff time has been reached (21:00 vs 21:00)", async () => {
    // is_premature = false: cutoff reached
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T15:30:00.000Z", records: 2, periods: 1 });
    const report = await autoCompleteAttendance("2026-10-29", {
      completionTimeIst: "21:00:00",
      organizationId: "d4dafc54-2e57-4804-885d-0790e69e0ad0",
    });
    expect(report.failed).toBe(0);
    expect(report.completed).toBe(2);
    expect(report.periodsCompleted).toBe(1);
  });

  it("does not apply premature check to past dates", async () => {
    // Yesterday with completionTimeIst — is_premature should be false from SQL
    mockHappyPath({ targetDate: "2026-10-28", completionBoundary: "2026-10-28T15:30:00.000Z", records: 1 });
    const report = await autoCompleteAttendance("2026-10-28", {
      completionTimeIst: "21:00:00",
    });
    expect(report.failed).toBe(0);
    expect(report.completed).toBe(1);
  });

  it("does not apply premature check to midnight mode", async () => {
    // Midnight mode has no completionTimeIst, so is_premature is always false
    mockHappyPath({ targetDate: "2026-10-28", completionBoundary: "2026-10-29T00:00:00+05:30", records: 1 });
    const report = await autoCompleteAttendance("2026-10-28");
    expect(report.failed).toBe(0);
    expect(report.completed).toBe(1);
  });

  it("23:58 fallback is also blocked when premature", async () => {
    mockDateQuery("2026-10-29", "2026-10-29T18:28:00.000Z", false, true);
    const report = await autoCompleteAttendance(undefined, { completionTimeIst: "23:58:00" });
    expect(report.failed).toBe(1);
    expect(report.errors[0]).toContain("not been reached yet");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("idempotent — second run after completion finds nothing to complete", async () => {
    // First run: completes 2 records
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T15:30:00.000Z", records: 2, periods: 1, skipped: 3 });
    const first = await autoCompleteAttendance("2026-10-29", { completionTimeIst: "21:00:00" });
    expect(first.completed).toBe(2);

    // Second run: all already completed
    mockHappyPath({ targetDate: "2026-10-29", completionBoundary: "2026-10-29T15:30:00.000Z", records: 0, skipped: 5 });
    const second = await autoCompleteAttendance("2026-10-29", { completionTimeIst: "21:00:00" });
    expect(second.completed).toBe(0);
    expect(second.skipped).toBe(5);
  });
});

describe("auto-complete HTTP handler", () => {
  it("exports GET and POST handlers", async () => {
    const mod = await import("./auto-complete/route");
    expect(typeof mod.GET).toBe("function");
    expect(typeof mod.POST).toBe("function");
  });
});
