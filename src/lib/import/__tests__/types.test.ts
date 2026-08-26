// Tests for import type definitions: state machine transitions.
import { describe, it, expect } from "vitest";
import { VALID_TRANSITIONS } from "../types";
import type { ImportStatus } from "../types";

describe("VALID_TRANSITIONS state machine", () => {
  it("covers all statuses", () => {
    const allStatuses: ImportStatus[] = [
      "uploaded", "parsing", "parsed", "ready_for_review",
      "committing", "completed", "failed", "cancelled",
      "rolling_back", "rolled_back",
    ];
    for (const s of allStatuses) {
      expect(VALID_TRANSITIONS).toHaveProperty(s);
    }
  });

  it("parsing can transition to ready_for_review or failed", () => {
    expect(VALID_TRANSITIONS.parsing).toContain("ready_for_review");
    expect(VALID_TRANSITIONS.parsing).toContain("failed");
    expect(VALID_TRANSITIONS.parsing).not.toContain("completed");
  });

  it("ready_for_review can transition to committing or cancelled", () => {
    expect(VALID_TRANSITIONS.ready_for_review).toContain("committing");
    expect(VALID_TRANSITIONS.ready_for_review).toContain("cancelled");
    expect(VALID_TRANSITIONS.ready_for_review).not.toContain("completed");
  });

  it("committing can transition to completed or failed", () => {
    expect(VALID_TRANSITIONS.committing).toContain("completed");
    expect(VALID_TRANSITIONS.committing).toContain("failed");
  });

  it("completed can only transition to rolling_back", () => {
    expect(VALID_TRANSITIONS.completed).toEqual(["rolling_back"]);
  });

  it("terminal states have no transitions", () => {
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
    expect(VALID_TRANSITIONS.rolled_back).toEqual([]);
  });

  it("rolling_back can transition to rolled_back or failed", () => {
    expect(VALID_TRANSITIONS.rolling_back).toContain("rolled_back");
    expect(VALID_TRANSITIONS.rolling_back).toContain("failed");
  });

  it("does not allow skipping states (no direct parsing -> completed)", () => {
    expect(VALID_TRANSITIONS.parsing).not.toContain("completed");
    expect(VALID_TRANSITIONS.parsing).not.toContain("committing");
    expect(VALID_TRANSITIONS.uploaded).not.toContain("completed");
  });

  it("does not allow reverse transitions", () => {
    expect(VALID_TRANSITIONS.completed).not.toContain("committing");
    expect(VALID_TRANSITIONS.ready_for_review).not.toContain("parsing");
    expect(VALID_TRANSITIONS.rolled_back).not.toContain("completed");
  });
});
