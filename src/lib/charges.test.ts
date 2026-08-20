import { describe, it, expect } from "vitest";
import {
  resolveStampDutyRate, resolveRegistrationFeeRate,
  calcStampDuty, calcRegistrationFee, isRegistrationFeeCapped,
  REGISTRATION_FEE_CAP,
} from "./charges";

describe("resolveStampDutyRate / resolveRegistrationFeeRate", () => {
  it("falls back to the statutory default only when the rate is absent", () => {
    expect(resolveStampDutyRate("")).toBe(5);
    expect(resolveStampDutyRate(null)).toBe(5);
    expect(resolveStampDutyRate(undefined)).toBe(5);
    expect(resolveStampDutyRate("abc")).toBe(5);
    expect(resolveRegistrationFeeRate("")).toBe(1);
  });

  it("keeps an explicit zero rather than treating it as unset", () => {
    expect(resolveStampDutyRate("0")).toBe(0);
    expect(resolveStampDutyRate(0)).toBe(0);
    expect(resolveRegistrationFeeRate("0")).toBe(0);
  });

  it("accepts the concessional and metro rates, decimals included", () => {
    expect(resolveStampDutyRate("4")).toBe(4);
    expect(resolveStampDutyRate("6")).toBe(6);
    expect(resolveStampDutyRate("5.5%")).toBe(5.5);
    expect(resolveRegistrationFeeRate("0.5")).toBe(0.5);
  });
});

describe("calcStampDuty", () => {
  it("is agreement value × rate, rounded to the rupee, with no cap", () => {
    expect(calcStampDuty(5_000_000, 5)).toBe(250_000);
    expect(calcStampDuty(5_000_000, 4)).toBe(200_000);
    expect(calcStampDuty(5_000_000, 6)).toBe(300_000);
    // Well past the registration cap — stamp duty must not be clamped.
    expect(calcStampDuty(100_000_000, 5)).toBe(5_000_000);
  });

  it("yields zero at a zero rate and on junk input", () => {
    expect(calcStampDuty(5_000_000, 0)).toBe(0);
    expect(calcStampDuty(NaN, 5)).toBe(0);
  });
});

describe("calcRegistrationFee", () => {
  it("applies the ₹30,000 ceiling", () => {
    // 1% of 50L is 50,000 — above the cap.
    expect(calcRegistrationFee(5_000_000, 1)).toBe(REGISTRATION_FEE_CAP);
    // 1% of 20L is 20,000 — under the cap, so uncapped.
    expect(calcRegistrationFee(2_000_000, 1)).toBe(20_000);
    expect(calcRegistrationFee(5_000_000, 0.5)).toBe(25_000);
  });

  it("reports whether the cap is what decided the figure", () => {
    expect(isRegistrationFeeCapped(5_000_000, 1)).toBe(true);
    expect(isRegistrationFeeCapped(2_000_000, 1)).toBe(false);
    expect(isRegistrationFeeCapped(0, 1)).toBe(false);
  });
});
