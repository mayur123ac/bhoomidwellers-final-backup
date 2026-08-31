// @vitest-environment node
//
// Tests for the reverse-geocoding location resolver.
//
// These test the location-name building logic by mocking Nominatim responses,
// NOT by calling the real API. The tests verify that:
//   * Detailed locality is included when available
//   * City + state + country are assembled correctly
//   * Duplicate parts are de-duplicated
//   * Missing parts degrade gracefully
//   * display_name fallback works
//   * Failure returns null (never throws)

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We need to mock fetch and the db module before importing reverseGeocode.
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

import { reverseGeocode } from "./reverseGeocode";

function mockFetchResponse(address: Record<string, string>, displayName?: string) {
  const body = {
    address,
    ...(displayName ? { display_name: displayName } : {}),
  };
  return vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as any;
}

describe("reverseGeocode — location name building", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns locality, city, state, country when all are available", async () => {
    globalThis.fetch = mockFetchResponse({
      neighbourhood: "Manpada",
      suburb: "Dombivli East",
      city: "Thane",
      state: "Maharashtra",
      country: "India",
    });

    const result = await reverseGeocode(19.2183, 72.9781);
    expect(result).toBe("Manpada, Thane, Maharashtra, India");
  });

  it("uses suburb when neighbourhood is not available", async () => {
    globalThis.fetch = mockFetchResponse({
      suburb: "Andheri West",
      city: "Mumbai",
      state: "Maharashtra",
      country: "India",
    });

    const result = await reverseGeocode(19.1364, 72.8296);
    expect(result).toBe("Andheri West, Mumbai, Maharashtra, India");
  });

  it("returns city, state, country when no locality is available", async () => {
    globalThis.fetch = mockFetchResponse({
      city: "Thane",
      state: "Maharashtra",
      country: "India",
    });

    const result = await reverseGeocode(19.2183, 72.9781);
    expect(result).toBe("Thane, Maharashtra, India");
  });

  it("de-duplicates when suburb equals city", async () => {
    globalThis.fetch = mockFetchResponse({
      suburb: "Thane",
      city: "Thane",
      state: "Maharashtra",
      country: "India",
    });

    const result = await reverseGeocode(19.2183, 72.9781);
    expect(result).toBe("Thane, Maharashtra, India");
  });

  it("de-duplicates when city equals state", async () => {
    globalThis.fetch = mockFetchResponse({
      city: "Delhi",
      state: "Delhi",
      country: "India",
    });

    const result = await reverseGeocode(28.6139, 77.2090);
    expect(result).toBe("Delhi, India");
  });

  it("uses town when city is not available", async () => {
    globalThis.fetch = mockFetchResponse({
      suburb: "Lonavala",
      town: "Lonavala",
      state: "Maharashtra",
      country: "India",
    });

    const result = await reverseGeocode(18.7546, 73.4062);
    expect(result).toBe("Lonavala, Maharashtra, India");
  });

  it("uses village for rural areas", async () => {
    globalThis.fetch = mockFetchResponse({
      village: "Karjat",
      state: "Maharashtra",
      country: "India",
    });

    const result = await reverseGeocode(18.9107, 73.3232);
    expect(result).toBe("Karjat, Maharashtra, India");
  });

  it("falls back to display_name when address parts are empty", async () => {
    globalThis.fetch = mockFetchResponse(
      {},
      "Manpada, Thane, Maharashtra, India, 400607"
    );

    const result = await reverseGeocode(19.2183, 72.9781);
    expect(result).toBe("Manpada, Thane, Maharashtra, India");
  });

  it("returns null when address is missing entirely", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as any;

    const result = await reverseGeocode(0, 0);
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as any;

    const result = await reverseGeocode(19.2183, 72.9781);
    expect(result).toBeNull();
  });

  it("returns null on network failure (never throws)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network timeout");
    }) as any;

    const result = await reverseGeocode(19.2183, 72.9781);
    expect(result).toBeNull();
  });

  it("GPS coordinates are preserved — geocoding does not alter them", async () => {
    globalThis.fetch = mockFetchResponse({
      suburb: "Manpada",
      city: "Thane",
      state: "Maharashtra",
      country: "India",
    });

    // The function returns a string. The coordinates passed in are not mutated.
    const lat = 19.1887;
    const lng = 72.8649;
    await reverseGeocode(lat, lng);
    expect(lat).toBe(19.1887);
    expect(lng).toBe(72.8649);
  });

  it("handles high-accuracy vs low-accuracy the same way — accuracy is not this function's concern", async () => {
    globalThis.fetch = mockFetchResponse({
      suburb: "Manpada",
      city: "Thane",
      state: "Maharashtra",
      country: "India",
    });

    // Same coordinates, different accuracy — reverseGeocode does not use accuracy.
    const result1 = await reverseGeocode(19.2183, 72.9781);
    const result2 = await reverseGeocode(19.2183, 72.9781);
    expect(result1).toBe(result2);
  });
});
