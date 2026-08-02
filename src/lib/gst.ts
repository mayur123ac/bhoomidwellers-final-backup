// gst.ts — one definition of "what GST rate applies", shared by the Loan & Deal
// draft, the Booking Form, and the booking API.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The rate was resolved with `toNumber(form.gst_rate) || 5` in four separate
// places. `0` is falsy in JavaScript, so a deliberate "0% (no GST)" selection
// was silently replaced by the 5% default — and because only the *rate* was
// coerced, the record saved `gst_rate: '0'` alongside a `gst_amount` computed at
// 5%. The form showed 0%, the stored amount disagreed, and that amount feeds
// total cost and required own-contribution.
//
// `||` cannot express "use the default when absent" for a numeric field whose
// zero is meaningful. The distinction has to be explicit: missing/invalid is not
// the same value as zero.

/** Applied only when no rate has been chosen at all. */
export const DEFAULT_GST_RATE = 5;

/** The quick-pick rates offered in the UI. Not a whitelist — any rate is valid. */
export const GST_RATE_PRESETS = [0, 5, 12] as const;

/** Rates outside this range are treated as typos rather than intent. */
const MIN_GST_RATE = 0;
const MAX_GST_RATE = 100;

/**
 * Parse a GST rate, distinguishing "not set" from "set to zero".
 *
 * Returns null for null/undefined/empty/non-numeric/out-of-range input, and a
 * number — including 0 — for anything valid. Callers decide what a null means;
 * this function never invents a default.
 */
export function parseGstRate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw === "") return null;

  // Strip currency/percent noise but keep the decimal point and sign so "5.5%"
  // and " 12 " parse, while "abc" does not silently become 0.
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "-") return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MIN_GST_RATE || parsed > MAX_GST_RATE) return null;
  return parsed;
}

/**
 * The rate to calculate with: the parsed value when one was supplied, otherwise
 * the fallback. This is the direct replacement for `toNumber(x) || 5`.
 */
export function resolveGstRate(value: unknown, fallback: number = DEFAULT_GST_RATE): number {
  const parsed = parseGstRate(value);
  return parsed === null ? fallback : parsed;
}

/**
 * GST payable on an agreement value.
 *
 * Rounded to the rupee, matching the existing autoGstAmount behaviour so this
 * change does not move any figure other than the zero-rate case. A 0 rate
 * yields exactly 0 rather than the 5% the old code produced.
 */
export function calcGstAmount(agreementValue: number, rate: number): number {
  if (!Number.isFinite(agreementValue) || !Number.isFinite(rate)) return 0;
  return Math.round((agreementValue * rate) / 100);
}

/** Display helper: 5 → "5%", 5.5 → "5.5%", 0 → "0% (no GST)". */
export function formatGstRate(rate: number): string {
  if (rate === 0) return "0% (no GST)";
  return `${Number(rate.toFixed(2))}%`;
}
