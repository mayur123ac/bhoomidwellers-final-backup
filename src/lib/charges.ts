// charges.ts — "what rate applies" for the two statutory charges that sit
// alongside GST: Stamp Duty and Registration Fee.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The 5% and 1% used to be baked into the bodies of autoStampDuty() /
// autoRegistrationFee() in BookingFormModal. There was no rate field at all, so
// the operator could only override the final rupee figure — a booking at the
// female-co-owner 4% rate, or a Mumbai 6% one, was expressible only as a number
// with no record of the percentage it came from, and reopening it showed no rate.
//
// This mirrors gst.ts exactly: the rate is the stored thing, the amount is
// derived. parseGstRate is reused as the shared percentage parser — it is not
// GST-specific in behaviour, it is "parse a 0-100 percentage, distinguishing
// absent from zero" — so all three charges agree on what a rate string means.

import { parseGstRate } from "./gst";

/** Applied only when no rate has been chosen at all. Maharashtra urban standard. */
export const DEFAULT_STAMP_DUTY_RATE = 5;

/** Applied only when no rate has been chosen at all. */
export const DEFAULT_REGISTRATION_FEE_RATE = 1;

/**
 * Quick-pick stamp duty rates. Not a whitelist — any rate is valid.
 * 4% = female sole/co-owner concession, 5% = standard Maharashtra urban,
 * 6% = Mumbai / metro (includes the 1% metro cess).
 */
export const STAMP_DUTY_RATE_PRESETS = [4, 5, 6] as const;

/** Quick-pick registration fee rates. 1% capped at ₹30,000 is the norm. */
export const REGISTRATION_FEE_RATE_PRESETS = [0.5, 1] as const;

/** Statutory ceiling on the registration fee. Stamp duty has no equivalent cap. */
export const REGISTRATION_FEE_CAP = 30000;

/** Shared percentage parser: null for absent/invalid, a number (including 0) otherwise. */
export const parseRatePercent = parseGstRate;

/** The stamp duty rate to calculate with. Falls back only when none was supplied. */
export function resolveStampDutyRate(value: unknown, fallback: number = DEFAULT_STAMP_DUTY_RATE): number {
  const parsed = parseRatePercent(value);
  return parsed === null ? fallback : parsed;
}

/** The registration fee rate to calculate with. Falls back only when none was supplied. */
export function resolveRegistrationFeeRate(value: unknown, fallback: number = DEFAULT_REGISTRATION_FEE_RATE): number {
  const parsed = parseRatePercent(value);
  return parsed === null ? fallback : parsed;
}

/** Stamp duty payable on an agreement value. Rounded to the rupee. No cap. */
export function calcStampDuty(agreementValue: number, ratePercent: number): number {
  if (!Number.isFinite(agreementValue) || !Number.isFinite(ratePercent)) return 0;
  return Math.round((agreementValue * ratePercent) / 100);
}

/**
 * Registration fee payable on an agreement value, capped at ₹30,000.
 *
 * The cap belongs here and nowhere else — it is the one behavioural difference
 * from stamp duty, and duplicating it in the UI is how the two drift apart.
 */
export function calcRegistrationFee(agreementValue: number, ratePercent: number): number {
  if (!Number.isFinite(agreementValue) || !Number.isFinite(ratePercent)) return 0;
  return Math.min(Math.round((agreementValue * ratePercent) / 100), REGISTRATION_FEE_CAP);
}

/** True when the cap is what decided the figure — drives the amber "Capped" badge. */
export function isRegistrationFeeCapped(agreementValue: number, ratePercent: number): boolean {
  if (!Number.isFinite(agreementValue) || !Number.isFinite(ratePercent)) return false;
  return Math.round((agreementValue * ratePercent) / 100) > REGISTRATION_FEE_CAP;
}
