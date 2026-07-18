// lib/currency.ts — Shared Indian currency formatting utilities
// Single source of truth for every currency field across the app.

/** Strips ₹, commas, spaces, and any non-digit characters. Returns clean digits only. */
export function cleanCurrencyValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[₹,\s]/g, "").replace(/[^0-9]/g, "");
}

/** Formats a clean digit string into Indian numbering groups: 9000000 -> "90,00,000" */
export function formatIndianNumber(value: string | number | null | undefined): string {
    const clean = cleanCurrencyValue(value);
    if (!clean) return "";
    const lastThree = clean.slice(-3);
    const rest = clean.slice(0, -3);
    if (!rest) return lastThree;
    const formattedRest = rest.replace(/\B(?=(\d{2})+(?!\d)$)/g, ",");
    return `${formattedRest},${lastThree}`;
}

/** For read-only display: "9000000" -> "₹90,00,000". Returns "—" for empty/invalid. */
export function formatCurrencyDisplay(value: string | number | null | undefined): string {
    const clean = cleanCurrencyValue(value);
    if (!clean || clean === "0") return clean === "0" ? "₹0" : "—";
    return "₹" + formatIndianNumber(clean);
}

/** For sending to the API / DB: always a clean numeric string, never commas or ₹. */
export function toStorageValue(value: string | number | null | undefined): string {
    return cleanCurrencyValue(value);
}