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

/**
 * For NUMERIC(x,2) values that arrive from the DB as strings with decimals
 * ("15000.00", "246.91") — commission amounts, TDS, net payable.
 *
 * formatCurrencyDisplay CANNOT be used for these: cleanCurrencyValue strips the
 * decimal point along with every other non-digit, so "15000.00" becomes 1500000
 * and renders as ₹15,00,000 — a 100x overstatement. That is correct for the
 * whole-rupee fields it was written for, hence a separate function rather than a
 * change to the shared one.
 *
 * Parses the string rather than going via Number() so paise are exact: money
 * must never round-trip through binary floating point.
 *
 * "15000.00" -> "₹15,000"   "246.91" -> "₹246.91"   "0.00" -> "₹0"
 */
export function formatCurrencyDecimal(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    const s = String(value).replace(/[₹,\s]/g, "").trim();
    if (!s) return "—";

    const m = s.match(/^(-?)(\d+)(?:\.(\d*))?$/);
    if (!m) return "—";

    const [, sign, whole, fracRaw = ""] = m;
    const frac = (fracRaw + "00").slice(0, 2);
    const wholeFmt = formatIndianNumber(whole) || "0";
    // Drop a trailing ".00" so whole-rupee amounts stay readable.
    const body = frac === "00" ? wholeFmt : `${wholeFmt}.${frac}`;
    return `${sign}₹${body}`;
}

/** For sending to the API / DB: always a clean numeric string, never commas or ₹. */
export function toStorageValue(value: string | number | null | undefined): string {
    return cleanCurrencyValue(value);
}