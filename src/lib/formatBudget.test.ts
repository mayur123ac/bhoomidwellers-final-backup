// lib/formatBudget.test.ts
import { describe, it, expect } from "vitest";
import { formatBudget, parseBudgetString } from "./formatBudget";

describe("formatBudget", () => {
  // Canonical rows (unit column is set)
  it('formats "40" + "lakh"', () => expect(formatBudget("40", "lakh")).toBe("₹40 Lakh"));
  it('formats "2" + "crore"', () => expect(formatBudget("2", "crore")).toBe("₹2 Crore"));
  it('formats "500" + "thousand"', () => expect(formatBudget("500", "thousand")).toBe("₹500 Thousand"));
  it('formats a range "40-50" + "lakh"', () => expect(formatBudget("40-50", "lakh")).toBe("₹40-50 Lakh"));
  it('formats "00" + "lakh" unchanged', () => expect(formatBudget("00", "lakh")).toBe("₹00 Lakh"));

  // Sentinel values
  it("returns Not Disclosed unchanged", () =>
    expect(formatBudget("Not Disclosed", null)).toBe("Not Disclosed"));
  it("returns Pending unchanged", () =>
    expect(formatBudget("Pending", "lakh")).toBe("Pending"));
  it("returns N/A unchanged", () =>
    expect(formatBudget("N/A", null)).toBe("N/A"));

  // Empty / null
  it("returns empty string for null", () => expect(formatBudget(null, null)).toBe(""));
  it("returns empty string for empty string", () => expect(formatBudget("", null)).toBe(""));
  it("returns empty string for undefined", () => expect(formatBudget(undefined, undefined)).toBe(""));

  // Legacy baked-in unit (unit column is NULL)
  it('parses "40 Lakh" with null unit', () =>
    expect(formatBudget("40 Lakh", null)).toBe("₹40 Lakh"));
  it('parses "40LAKH" with null unit', () =>
    expect(formatBudget("40LAKH", null)).toBe("₹40 Lakh"));
  it('parses "40 lakh" lowercase with null unit', () =>
    expect(formatBudget("40 lakh", null)).toBe("₹40 Lakh"));
  it('parses "35-40 Lakh" range with null unit', () =>
    expect(formatBudget("35-40 Lakh", null)).toBe("₹35-40 Lakh"));
  it('parses "2 Crore" with null unit', () =>
    expect(formatBudget("2 Crore", null)).toBe("₹2 Crore"));
  it('parses "500 Thousand" with null unit', () =>
    expect(formatBudget("500 Thousand", null)).toBe("₹500 Thousand"));

  // Safety: must never produce "₹40 Lakh Lakh"
  it("does not double-append unit when unit column is set and value is clean", () =>
    expect(formatBudget("40", "lakh")).not.toContain("Lakh Lakh"));

  // Unknown raw value (no unit column, no recognizable inline unit)
  it("prefixes ₹ for unknown raw value", () =>
    expect(formatBudget("someRaw", null)).toBe("₹someRaw"));
});

describe("parseBudgetString", () => {
  it('splits "40 Lakh"', () =>
    expect(parseBudgetString("40 Lakh")).toEqual({ value: "40", unit: "lakh" }));
  it('splits "2 Crore"', () =>
    expect(parseBudgetString("2 Crore")).toEqual({ value: "2", unit: "crore" }));
  it('splits "500 Thousand"', () =>
    expect(parseBudgetString("500 Thousand")).toEqual({ value: "500", unit: "thousand" }));
  it('splits "35-40 Lakh"', () =>
    expect(parseBudgetString("35-40 Lakh")).toEqual({ value: "35-40", unit: "lakh" }));
  it('splits "40LAKH"', () =>
    expect(parseBudgetString("40LAKH")).toEqual({ value: "40", unit: "lakh" }));
  it("returns null unit for plain number", () =>
    expect(parseBudgetString("40")).toEqual({ value: "40", unit: null }));
  it("returns null unit for Not Disclosed", () =>
    expect(parseBudgetString("Not Disclosed")).toEqual({ value: "Not Disclosed", unit: null }));
  it("returns empty value for null input", () =>
    expect(parseBudgetString(null)).toEqual({ value: "", unit: null }));
});
