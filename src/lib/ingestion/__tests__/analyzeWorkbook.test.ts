// Tests for analyzeWorkbook: value normalization and Indian numeric amount parsing.
import { describe, it, expect } from "vitest";
import { normalizeValue, parseNumericAmount } from "../analyzeWorkbook";

// ── normalizeValue ─────────────────────────────────────────────────────────

describe("normalizeValue", () => {
  it("normalizes status values", () => {
    expect(normalizeValue("status", "ASSIGNED")).toBe("Assigned");
    expect(normalizeValue("status", "assigned")).toBe("Assigned");
    expect(normalizeValue("status", "NEW")).toBe("New");
    expect(normalizeValue("status", "ROUTED")).toBe("Routed");
  });

  it("normalizes source values", () => {
    expect(normalizeValue("source", "DIRECT WALK-IN")).toBe("Direct Walk-in");
    expect(normalizeValue("source", "walk in")).toBe("Direct Walk-in");
    expect(normalizeValue("source", "WALKIN")).toBe("Direct Walk-in");
    expect(normalizeValue("source", "CP")).toBe("Channel Partner");
    expect(normalizeValue("source", "cp")).toBe("Channel Partner");
    expect(normalizeValue("source", "CHANNEL PARTNER")).toBe("Channel Partner");
  });

  it("normalizes loan_planned values", () => {
    expect(normalizeValue("loan_planned", "YES")).toBe("Yes");
    expect(normalizeValue("loan_planned", "yes")).toBe("Yes");
    expect(normalizeValue("loan_planned", "NO")).toBe("No");
    expect(normalizeValue("loan_planned", "Y")).toBe("Yes");
    expect(normalizeValue("loan_planned", "N")).toBe("No");
    expect(normalizeValue("loan_planned", "PENDING")).toBe("Pending");
  });

  it("returns original value when no normalization applies", () => {
    expect(normalizeValue("status", "CustomStatus")).toBe("CustomStatus");
    expect(normalizeValue("unknown_field", "anything")).toBe("anything");
  });
});

// ── parseNumericAmount ─────────────────────────────────────────────────────

describe("parseNumericAmount", () => {
  it("parses plain numbers", () => {
    expect(parseNumericAmount("5000000")).toBe(5000000);
    expect(parseNumericAmount("123")).toBe(123);
  });

  it("strips commas (Western format)", () => {
    expect(parseNumericAmount("5,000,000")).toBe(5000000);
  });

  it("strips commas (Indian format)", () => {
    expect(parseNumericAmount("50,00,000")).toBe(5000000);
  });

  it("handles currency symbols", () => {
    expect(parseNumericAmount("₹50,00,000")).toBe(5000000);
    expect(parseNumericAmount("$5,000")).toBe(5000);
  });

  it("parses Lakh notation", () => {
    expect(parseNumericAmount("50L")).toBe(5000000);
    expect(parseNumericAmount("50 Lakh")).toBe(5000000);
    expect(parseNumericAmount("50 Lakhs")).toBe(5000000);
    expect(parseNumericAmount("1.5 Lakh")).toBe(150000);
  });

  it("parses Crore notation", () => {
    expect(parseNumericAmount("5Cr")).toBe(50000000);
    expect(parseNumericAmount("5 Crore")).toBe(50000000);
    expect(parseNumericAmount("5 Crores")).toBe(50000000);
    expect(parseNumericAmount("1.2 Crore")).toBe(12000000);
  });

  it("returns null for empty/invalid input", () => {
    expect(parseNumericAmount("")).toBeNull();
    expect(parseNumericAmount("   ")).toBeNull();
    expect(parseNumericAmount("not a number")).toBeNull();
  });

  it("returns null for null/undefined-like input", () => {
    expect(parseNumericAmount(null as any)).toBeNull();
    expect(parseNumericAmount(undefined as any)).toBeNull();
  });
});
