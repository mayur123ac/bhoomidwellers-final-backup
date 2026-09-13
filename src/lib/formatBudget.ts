// lib/formatBudget.ts
// Shared budget formatting utility used by all CRM panels.

const UNIT_REGEX = /^([\d\s\-,.]+)\s*(lakh|crore|thousand)\b/i;

/**
 * Formats a budget value and optional unit into a human-readable string.
 *
 * Examples:
 *   formatBudget("40", "lakh")       → "₹40 Lakh"
 *   formatBudget("2", "crore")       → "₹2 Crore"
 *   formatBudget("500", "thousand")  → "₹500 Thousand"
 *   formatBudget("40 Lakh", null)    → "₹40 Lakh"  (legacy baked-in unit)
 *   formatBudget("Not Disclosed", null) → "Not Disclosed"
 *   formatBudget(null, null)         → ""
 */
export function formatBudget(
  budget: string | null | undefined,
  unit: string | null | undefined
): string {
  const b = String(budget ?? "").trim();

  // Empty / null
  if (!b) return "";

  // Short-circuit sentinel values
  if (b === "Not Disclosed" || b === "Pending" || b === "N/A") return b;

  // Canonical path: unit column is set
  if (unit) {
    const u = unit.trim().toLowerCase();
    const label =
      u === "lakh" ? "Lakh" : u === "crore" ? "Crore" : u === "thousand" ? "Thousand" : null;
    return label ? `₹${b} ${label}` : `₹${b}`;
  }

  // Legacy path: unit baked into the budget string (e.g. "40 Lakh", "40LAKH", "35-40 Lakh")
  const match = b.match(UNIT_REGEX);
  if (match) {
    const amount = match[1].trim();
    const rawUnit = match[2].toLowerCase();
    const label =
      rawUnit === "lakh" ? "Lakh" : rawUnit === "crore" ? "Crore" : "Thousand";
    return `₹${amount} ${label}`;
  }

  // Unknown raw value — show with ₹ prefix
  return `₹${b}`;
}

/**
 * Splits a raw budget string (which may have an inline unit) into a
 * canonical { value, unit } pair for storage.
 *
 * Examples:
 *   parseBudgetString("40 Lakh")   → { value: "40", unit: "lakh" }
 *   parseBudgetString("2 Crore")   → { value: "2",  unit: "crore" }
 *   parseBudgetString("40")        → { value: "40", unit: null }
 *   parseBudgetString("Not Disclosed") → { value: "Not Disclosed", unit: null }
 */
export function parseBudgetString(raw: string | null | undefined): {
  value: string;
  unit: string | null;
} {
  const b = String(raw ?? "").trim();
  if (!b) return { value: "", unit: null };

  const match = b.match(UNIT_REGEX);
  if (match) {
    return { value: match[1].trim(), unit: match[2].toLowerCase() };
  }

  return { value: b, unit: null };
}
