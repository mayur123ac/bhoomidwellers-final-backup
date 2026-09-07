import { describe, it, expect, beforeEach } from "vitest";
import {
  savePendingSession,
  loadPendingSession,
  clearPendingSession,
  type PendingCallSession,
} from "./callSessionStore";

const STORAGE_KEY = "bd:pendingCallSession";

function makeSession(overrides?: Partial<PendingCallSession>): PendingCallSession {
  return {
    callSessionId: 42,
    phoneNumber: "9876543210",
    callStartedAt: Date.now(),
    leadId: 100,
    ...overrides,
  };
}

describe("callSessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads a pending session", () => {
    const s = makeSession();
    savePendingSession(s);
    const loaded = loadPendingSession();
    expect(loaded).toEqual(s);
  });

  it("returns null when nothing is stored", () => {
    expect(loadPendingSession()).toBeNull();
  });

  it("clearPendingSession removes the entry", () => {
    savePendingSession(makeSession());
    clearPendingSession();
    expect(loadPendingSession()).toBeNull();
  });

  it("discards sessions older than 1 hour", () => {
    const old = makeSession({ callStartedAt: Date.now() - 3_700_000 });
    savePendingSession(old);
    expect(loadPendingSession()).toBeNull();
    // Also cleans up storage
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps sessions within the 1-hour window", () => {
    const recent = makeSession({ callStartedAt: Date.now() - 1_800_000 }); // 30 min ago
    savePendingSession(recent);
    expect(loadPendingSession()).toEqual(recent);
  });

  it("handles corrupted JSON gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "not json at all");
    expect(loadPendingSession()).toBeNull();
  });
});
