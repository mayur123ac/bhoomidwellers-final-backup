import { describe, it, expect } from "vitest";
import { normalizePhone, phonesMatch } from "./phoneNormalize";

describe("normalizePhone", () => {
  it("extracts last 10 digits from +91 format", () => {
    expect(normalizePhone("+919876543210")).toBe("9876543210");
  });

  it("extracts last 10 digits from 91 format (no plus)", () => {
    expect(normalizePhone("919876543210")).toBe("9876543210");
  });

  it("returns raw 10 digits as-is", () => {
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });

  it("handles 0-prefixed numbers", () => {
    expect(normalizePhone("09876543210")).toBe("9876543210");
  });

  it("strips formatting characters", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("(+91) 98765-43210")).toBe("9876543210");
  });

  it("returns empty string for too-short numbers", () => {
    expect(normalizePhone("12345")).toBe("12345");
  });

  it("handles null/undefined", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("phonesMatch", () => {
  it("matches identical numbers", () => {
    expect(phonesMatch("9876543210", "9876543210")).toBe(true);
  });

  it("matches +91 vs raw 10 digits", () => {
    expect(phonesMatch("+919876543210", "9876543210")).toBe(true);
  });

  it("matches 91 prefix vs +91 prefix", () => {
    expect(phonesMatch("919876543210", "+919876543210")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(phonesMatch("9876543210", "9876543211")).toBe(false);
  });

  it("does not match too-short numbers", () => {
    expect(phonesMatch("12345", "12345")).toBe(false);
  });

  it("handles nulls", () => {
    expect(phonesMatch(null, "9876543210")).toBe(false);
    expect(phonesMatch(null, null)).toBe(false);
  });
});
