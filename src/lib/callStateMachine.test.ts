import { describe, it, expect } from "vitest";

// Mirrors the server-side state transition logic from PATCH /api/call-sessions/[id].
// These are pure-logic unit tests — they don't hit the database.

const LOCKED_STATES = new Set(["recording_attached", "completed"]);

const ALLOWED_STATUSES = new Set([
  "initiated", "calling", "completed", "cancelled", "missed",
  "recording_pending", "recording_detected", "recording_attached",
  "recording_unavailable", "upload_failed",
]);

function canTransition(currentStatus: string, requestedStatus: string): { allowed: boolean; reason?: string } {
  if (!ALLOWED_STATUSES.has(requestedStatus)) {
    return { allowed: false, reason: "invalid_status" };
  }
  if (LOCKED_STATES.has(currentStatus)) {
    return { allowed: false, reason: "locked" };
  }
  if (currentStatus === "recording_unavailable" && requestedStatus !== "recording_attached") {
    return { allowed: false, reason: "locked" };
  }
  return { allowed: true };
}

describe("Call session state machine", () => {
  describe("locked states prevent overwrite", () => {
    it("recording_attached rejects all transitions", () => {
      expect(canTransition("recording_attached", "missed").allowed).toBe(false);
      expect(canTransition("recording_attached", "calling").allowed).toBe(false);
      expect(canTransition("recording_attached", "cancelled").allowed).toBe(false);
    });

    it("completed rejects all transitions", () => {
      expect(canTransition("completed", "initiated").allowed).toBe(false);
      expect(canTransition("completed", "missed").allowed).toBe(false);
    });
  });

  describe("recording_unavailable is semi-locked", () => {
    it("rejects backward transitions", () => {
      expect(canTransition("recording_unavailable", "calling").allowed).toBe(false);
      expect(canTransition("recording_unavailable", "missed").allowed).toBe(false);
    });

    it("allows recording_attached (upload succeeded late)", () => {
      expect(canTransition("recording_unavailable", "recording_attached").allowed).toBe(true);
    });
  });

  describe("normal forward transitions", () => {
    it("initiated -> calling", () => {
      expect(canTransition("initiated", "calling").allowed).toBe(true);
    });

    it("calling -> missed", () => {
      expect(canTransition("calling", "missed").allowed).toBe(true);
    });

    it("calling -> recording_pending", () => {
      expect(canTransition("calling", "recording_pending").allowed).toBe(true);
    });

    it("recording_pending -> recording_detected", () => {
      expect(canTransition("recording_pending", "recording_detected").allowed).toBe(true);
    });

    it("recording_detected -> upload_failed", () => {
      expect(canTransition("recording_detected", "upload_failed").allowed).toBe(true);
    });

    it("upload_failed -> recording_attached", () => {
      expect(canTransition("upload_failed", "recording_attached").allowed).toBe(true);
    });
  });

  describe("invalid statuses rejected", () => {
    it("rejects unknown status values", () => {
      expect(canTransition("initiated", "bogus").allowed).toBe(false);
      expect(canTransition("initiated", "bogus").reason).toBe("invalid_status");
    });
  });

  describe("duplicate event idempotency", () => {
    it("same state -> same state is allowed (idempotent)", () => {
      expect(canTransition("calling", "calling").allowed).toBe(true);
      expect(canTransition("missed", "missed").allowed).toBe(true);
    });
  });

  describe("late event scenarios", () => {
    it("late 'calling' cannot overwrite 'recording_attached'", () => {
      expect(canTransition("recording_attached", "calling").allowed).toBe(false);
    });

    it("late 'missed' cannot overwrite 'recording_attached'", () => {
      expect(canTransition("recording_attached", "missed").allowed).toBe(false);
    });

    it("late 'calling' cannot overwrite 'completed'", () => {
      expect(canTransition("completed", "calling").allowed).toBe(false);
    });
  });
});
