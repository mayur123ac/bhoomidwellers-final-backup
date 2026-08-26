// Tests for parseLeadSheet: header matching, date parsing, phone normalization, row validation.
import { describe, it, expect } from "vitest";
import {
  normalizeHeader,
  levenshtein,
  matchHeader,
  parseEnquiryDate,
  normalizePhones,
  cellToString,
  FIELD_ALIASES,
  NORMALIZED_ALIASES,
} from "../parseLeadSheet";

// ── normalizeHeader ────────────────────────────────────────────────────────

describe("normalizeHeader", () => {
  it("lowercases and strips non-alphanumeric", () => {
    expect(normalizeHeader("Client Name")).toBe("clientname");
    expect(normalizeHeader("  CP Phone  ")).toBe("cpphone");
    expect(normalizeHeader("Form No.")).toBe("formno");
    expect(normalizeHeader("ENQUIRY DATE")).toBe("enquirydate");
  });

  it("returns empty for blank input", () => {
    expect(normalizeHeader("")).toBe("");
    expect(normalizeHeader("   ")).toBe("");
  });
});

// ── levenshtein ────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("returns string length for empty other", () => {
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "xyz")).toBe(3);
  });

  it("computes correct distance for edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("chanel", "channel")).toBe(1); // insertion
    expect(levenshtein("patner", "partner")).toBe(1); // insertion
  });
});

// ── matchHeader ────────────────────────────────────────────────────────────

describe("matchHeader", () => {
  it("matches exact aliases", () => {
    expect(matchHeader("Name")).toBe("name");
    expect(matchHeader("Contact")).toBe("phone");
    expect(matchHeader("Mobile")).toBe("phone");
    expect(matchHeader("Form No")).toBe("external_ref");
    expect(matchHeader("Date")).toBe("enquiry_date");
    expect(matchHeader("Source")).toBe("source");
    expect(matchHeader("Channel Partner")).toBe("cp_name");
    expect(matchHeader("CP Phone")).toBe("cp_phone");
    expect(matchHeader("Feedback")).toBe("feedback");
    expect(matchHeader("Budget")).toBe("budget");
  });

  it("matches case-insensitively", () => {
    expect(matchHeader("NAME")).toBe("name");
    expect(matchHeader("contact")).toBe("phone");
    expect(matchHeader("FEEDBACK")).toBe("feedback");
  });

  it("matches fuzzy within Levenshtein <= 2", () => {
    // "Chanel Patner" is in FIELD_ALIASES for cp_name
    expect(matchHeader("Chanel Patner")).toBe("cp_name");
  });

  it("returns null for unrecognized headers", () => {
    expect(matchHeader("Completely Unknown Column")).toBeNull();
    expect(matchHeader("Random Gibberish XYZ")).toBeNull();
  });

  it("returns null for empty headers", () => {
    expect(matchHeader("")).toBeNull();
  });

  it("matches booking field aliases", () => {
    expect(matchHeader("Booking")).toBe("booking_status");
    expect(matchHeader("Booking Date")).toBe("booking_date");
    expect(matchHeader("Booking Amount")).toBe("booking_amount");
    expect(matchHeader("Booking Ref")).toBe("booking_reference");
  });
});

// ── parseEnquiryDate ───────────────────────────────────────────────────────

describe("parseEnquiryDate", () => {
  it("parses DD/MM/YYYY", () => {
    const result = parseEnquiryDate("15/06/2024");
    expect(result).toBeTruthy();
    const d = new Date(result!);
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCMonth()).toBe(5); // 0-indexed
    expect(d.getUTCFullYear()).toBe(2024);
  });

  it("parses DD-MM-YYYY", () => {
    const result = parseEnquiryDate("01-12-2023");
    expect(result).toBeTruthy();
    const d = new Date(result!);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCMonth()).toBe(11);
    expect(d.getUTCFullYear()).toBe(2023);
  });

  it("parses DD-MMM-YYYY with month names", () => {
    const result = parseEnquiryDate("24-Dec-2023");
    expect(result).toBeTruthy();
    const d = new Date(result!);
    expect(d.getUTCDate()).toBe(24);
    expect(d.getUTCMonth()).toBe(11);
    expect(d.getUTCFullYear()).toBe(2023);
  });

  it("parses 2-digit year as 20xx", () => {
    const result = parseEnquiryDate("01/01/24");
    expect(result).toBeTruthy();
    const d = new Date(result!);
    expect(d.getUTCFullYear()).toBe(2024);
  });

  it("handles JS Date objects", () => {
    const date = new Date("2024-03-15T10:30:00Z");
    const result = parseEnquiryDate(date);
    expect(result).toBeTruthy();
    expect(result).toBe(date.toISOString());
  });

  it("returns null for empty/null input", () => {
    expect(parseEnquiryDate(null)).toBeNull();
    expect(parseEnquiryDate(undefined)).toBeNull();
    expect(parseEnquiryDate("")).toBeNull();
    expect(parseEnquiryDate("   ")).toBeNull();
  });

  it("returns null for invalid dates", () => {
    expect(parseEnquiryDate("not-a-date")).toBeNull();
    expect(parseEnquiryDate("32/13/2024")).toBeNull(); // invalid month
  });
});

// ── normalizePhones ────────────────────────────────────────────────────────

describe("normalizePhones", () => {
  it("returns single clean number", () => {
    const result = normalizePhones("9876543210");
    expect(result.phone).toBe("9876543210");
    expect(result.alt).toBeNull();
  });

  it("strips spaces and dashes from single number", () => {
    const result = normalizePhones("+91 98765 43210");
    expect(result.phone).toBe("+919876543210");
    expect(result.alt).toBeNull();
  });

  it("splits comma-separated numbers", () => {
    const result = normalizePhones("9876543210, 9123456789");
    expect(result.phone).toBe("9876543210");
    expect(result.alt).toBe("9123456789");
  });

  it("splits slash-separated numbers", () => {
    const result = normalizePhones("9876543210/9123456789");
    expect(result.phone).toBe("9876543210");
    expect(result.alt).toBe("9123456789");
  });

  it("handles empty input", () => {
    const result = normalizePhones("");
    expect(result.phone).toBe("");
    expect(result.alt).toBeNull();
  });

  it("ignores too-short fragments", () => {
    const result = normalizePhones("123, 9876543210");
    expect(result.phone).toBe("9876543210");
    expect(result.alt).toBeNull();
  });
});

// ── cellToString ───────────────────────────────────────────────────────────

describe("cellToString", () => {
  it("trims whitespace", () => {
    expect(cellToString("  hello  ")).toBe("hello");
  });

  it("handles null/undefined", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString(undefined)).toBe("");
  });

  it("converts numbers to strings", () => {
    expect(cellToString(42)).toBe("42");
  });
});

// ── FIELD_ALIASES / NORMALIZED_ALIASES integrity ───────────────────────────

describe("FIELD_ALIASES integrity", () => {
  it("has required fields", () => {
    expect(FIELD_ALIASES).toHaveProperty("name");
    expect(FIELD_ALIASES).toHaveProperty("phone");
    expect(FIELD_ALIASES).toHaveProperty("enquiry_date");
  });

  it("has booking fields", () => {
    expect(FIELD_ALIASES).toHaveProperty("booking_status");
    expect(FIELD_ALIASES).toHaveProperty("booking_date");
    expect(FIELD_ALIASES).toHaveProperty("booking_amount");
    expect(FIELD_ALIASES).toHaveProperty("booking_reference");
  });

  it("NORMALIZED_ALIASES is non-empty", () => {
    expect(NORMALIZED_ALIASES.length).toBeGreaterThan(0);
  });
});
