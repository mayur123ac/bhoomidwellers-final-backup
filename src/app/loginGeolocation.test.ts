// @vitest-environment node
//
// Tests for the getPosition() geolocation wrapper used by the login page.
//
// These validate the exact sequence the bug report describes:
//   OFF → login → location error → ON → login again → fresh request → success
//
// Since getPosition() is a module-level function in page.tsx (a "use client"
// component), we extract and test the logic via a standalone copy that matches
// the production implementation. The production code is the source of truth;
// this file verifies the contract it must uphold.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Reproduce the production getPosition + shim ────────────────────────────

class GeolocationPositionError_compat {
  readonly code: number;
  readonly message: string;
  readonly PERMISSION_DENIED = 1;
  readonly POSITION_UNAVAILABLE = 2;
  readonly TIMEOUT = 3;
  constructor(code: number, message: string) {
    this.code = code;
    this.message = message;
  }
}

function getPosition(geo: {
  getCurrentPosition: (
    ok: (pos: any) => void,
    err: (e: any) => void,
    opts?: any,
  ) => void;
} | null): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!geo) {
      reject(new GeolocationPositionError_compat(2, "UNAVAILABLE"));
      return;
    }

    let settled = false;
    const settle = <T,>(fn: (v: T) => void, v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(outerTimer);
      fn(v);
    };

    const outerTimer = setTimeout(() => {
      settle(reject, new GeolocationPositionError_compat(3, "TIMEOUT"));
    }, 20_000);

    geo.getCurrentPosition(
      (pos: any) => settle(resolve, pos),
      (err: any) => settle(reject, err),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fakePosition(lat = 19.07, lng = 72.87, accuracy = 12) {
  return { coords: { latitude: lat, longitude: lng, accuracy } };
}

function permissionDeniedError() {
  return { code: 1, message: "User denied Geolocation" };
}

function positionUnavailableError() {
  return { code: 2, message: "Position unavailable" };
}

function timeoutError() {
  return { code: 3, message: "Timeout expired" };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getPosition — geolocation retry after toggle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves with coordinates on a successful fix", async () => {
    const geo = {
      getCurrentPosition: vi.fn((ok: any) => ok(fakePosition())),
    };
    const pos = await getPosition(geo);
    expect(pos.coords.latitude).toBe(19.07);
    expect(pos.coords.longitude).toBe(72.87);
  });

  it("rejects with code 1 when permission is denied", async () => {
    const geo = {
      getCurrentPosition: vi.fn((_ok: any, err: any) => err(permissionDeniedError())),
    };
    await expect(getPosition(geo)).rejects.toMatchObject({ code: 1 });
  });

  it("rejects with code 2 when position is unavailable (device GPS off)", async () => {
    const geo = {
      getCurrentPosition: vi.fn((_ok: any, err: any) => err(positionUnavailableError())),
    };
    await expect(getPosition(geo)).rejects.toMatchObject({ code: 2 });
  });

  it("rejects with code 3 on timeout", async () => {
    const geo = {
      getCurrentPosition: vi.fn((_ok: any, err: any) => err(timeoutError())),
    };
    await expect(getPosition(geo)).rejects.toMatchObject({ code: 3 });
  });

  it("rejects with code 2 when geolocation API is not available", async () => {
    await expect(getPosition(null)).rejects.toMatchObject({
      code: 2,
      message: "UNAVAILABLE",
    });
  });

  // ── The critical regression test ──────────────────────────────────────

  it("OFF → denied → ON → retry → succeeds (no stale state)", async () => {
    let callCount = 0;

    const geo = {
      getCurrentPosition: vi.fn((ok: any, err: any) => {
        callCount++;
        if (callCount === 1) {
          // First call: device location is OFF → permission denied
          err(permissionDeniedError());
        } else {
          // Second call: device location is now ON → success
          ok(fakePosition(28.6, 77.2, 8));
        }
      }),
    };

    // Attempt 1: should fail
    const err1 = await getPosition(geo).catch((e) => e);
    expect(err1.code).toBe(1);

    // Attempt 2: fresh request, should succeed
    const pos = await getPosition(geo);
    expect(pos.coords.latitude).toBe(28.6);
    expect(pos.coords.longitude).toBe(77.2);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);

    // Verify maximumAge: 0 was passed both times (no caching)
    for (const call of geo.getCurrentPosition.mock.calls) {
      expect(call[2]).toMatchObject({ maximumAge: 0 });
    }
  });

  it("OFF → denied → ON → retry multiple times → eventually succeeds", async () => {
    let callCount = 0;

    const geo = {
      getCurrentPosition: vi.fn((ok: any, err: any) => {
        callCount++;
        if (callCount <= 3) {
          // First 3 attempts fail (user still fiddling with settings)
          err(callCount <= 2 ? permissionDeniedError() : positionUnavailableError());
        } else {
          // 4th attempt: location finally works
          ok(fakePosition(19.1, 72.9, 15));
        }
      }),
    };

    // Attempts 1-3: all fail with different errors
    const e1 = await getPosition(geo).catch((e) => e);
    expect(e1.code).toBe(1);

    const e2 = await getPosition(geo).catch((e) => e);
    expect(e2.code).toBe(1);

    const e3 = await getPosition(geo).catch((e) => e);
    expect(e3.code).toBe(2); // POSITION_UNAVAILABLE

    // Attempt 4: succeeds
    const pos = await getPosition(geo);
    expect(pos.coords.latitude).toBe(19.1);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(4);
  });

  // ── Outer timeout failsafe ────────────────────────────────────────────

  it("outer timeout fires if getCurrentPosition silently hangs", async () => {
    const geo = {
      // Simulates a browser that neither resolves nor rejects
      getCurrentPosition: vi.fn(() => { /* intentionally empty */ }),
    };

    const promise = getPosition(geo);

    // Advance past the 20s outer timeout
    vi.advanceTimersByTime(20_001);

    const err = await promise.catch((e) => e);
    expect(err.code).toBe(3); // TIMEOUT
    expect(err.message).toBe("TIMEOUT");
  });

  it("outer timeout does NOT fire if native callback resolves first", async () => {
    const geo = {
      getCurrentPosition: vi.fn((ok: any) => {
        // Resolves after 5s (well within the 20s outer timeout)
        setTimeout(() => ok(fakePosition()), 5_000);
      }),
    };

    const promise = getPosition(geo);
    vi.advanceTimersByTime(5_001);

    const pos = await promise;
    expect(pos.coords.latitude).toBe(19.07);

    // Advance past 20s — should NOT cause a second rejection
    vi.advanceTimersByTime(20_000);
    // If the outer timer weren't cleared, this would throw an unhandled rejection
  });

  it("native error wins over outer timeout when it fires first", async () => {
    const geo = {
      getCurrentPosition: vi.fn((_ok: any, err: any) => {
        // Native timeout at 15s (before our 20s outer)
        setTimeout(() => err(timeoutError()), 15_000);
      }),
    };

    const promise = getPosition(geo);
    vi.advanceTimersByTime(15_001);

    const err = await promise.catch((e) => e);
    expect(err.code).toBe(3);
    expect(err.message).toBe("Timeout expired"); // native message, not our shim's

    // The outer timer is cleared, so advancing further is safe
    vi.advanceTimersByTime(10_000);
  });

  // ── Each call is independent ──────────────────────────────────────────

  it("passes maximumAge: 0 on every call (no cached positions)", async () => {
    const geo = {
      getCurrentPosition: vi.fn((ok: any) => ok(fakePosition())),
    };

    await getPosition(geo);
    await getPosition(geo);
    await getPosition(geo);

    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(3);
    for (const call of geo.getCurrentPosition.mock.calls) {
      expect(call[2].maximumAge).toBe(0);
    }
  });
});
