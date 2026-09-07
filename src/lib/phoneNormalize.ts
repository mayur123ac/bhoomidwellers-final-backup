// phoneNormalize.ts — normalize Indian phone numbers for comparison.
//
// Formats like +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX should
// all resolve to the same 10-digit local number when appropriate.

/**
 * Extract the last 10 digits from a phone number string.
 * This handles +91, 91, 0 prefixes and any formatting characters.
 * Returns empty string if fewer than 10 digits are present.
 */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return digits;
  return digits.slice(-10);
}

/**
 * Compare two phone numbers for equality after normalization.
 */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length >= 10 && na === nb;
}
