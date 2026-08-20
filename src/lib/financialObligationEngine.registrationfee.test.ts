import { describe, it, expect } from "vitest";
import {
  computeFinancialObligation,
  FOE_CODES,
  type FinancialSnapshot,
} from "./financialObligationEngine";

/**
 * Registration fee is entered directly on the booking form rather than derived
 * from a percentage of agreement value, so the engine must carry the stored
 * amount through untouched. It used to default to a ₹30,000 ceiling, which meant
 * a deliberately entered ₹45,000 was charged as ₹30,000 in every total.
 */

/** Minimal snapshot: only the registration fee varies between cases. */
function snapshot(over: Partial<FinancialSnapshot> = {}): FinancialSnapshot {
  return {
    agreementValue: 4_200_000,
    tokenPaid: 0,
    bookingAmountPaid: 0,
    additionalOCRPaid: 0,
    sanctionedAmount: 0,
    disbursedAmount: 0,
    gstPercent: 0,
    stampDutyAmount: 0,
    registrationFee: 0,
    legalCharges: 0,
    maintenanceDeposit: 0,
    customCharges: 0,
    cashComponent: 0,
    ...over,
  };
}

describe("registration fee is no longer capped by default", () => {
  it("carries a fee above the old ₹30,000 ceiling into the totals in full", () => {
    const r = computeFinancialObligation(snapshot({ registrationFee: 45_000 }));
    expect(r.totalAdditionalCharges).toBe(45_000);
    expect(r.totalCustomerLiability).toBe(4_200_000 + 45_000);
  });

  it("raises no above-cap warning when no cap was asked for", () => {
    const r = computeFinancialObligation(snapshot({ registrationFee: 45_000 }));
    expect(r.validationErrors.map(e => e.code)).not.toContain(
      FOE_CODES.REGISTRATION_FEE_ABOVE_CAP
    );
  });

  it("treats the old cap value as an ordinary amount, not a ceiling", () => {
    const r = computeFinancialObligation(snapshot({ registrationFee: 30_000 }));
    expect(r.totalAdditionalCharges).toBe(30_000);
  });

  it("passes an arbitrary typed amount straight through", () => {
    const r = computeFinancialObligation(snapshot({ registrationFee: 15_500 }));
    expect(r.totalAdditionalCharges).toBe(15_500);
  });

  it("reads an empty/zero fee as ₹0 rather than deriving a percentage", () => {
    const r = computeFinancialObligation(snapshot({ registrationFee: 0 }));
    expect(r.totalAdditionalCharges).toBe(0);
    expect(r.totalCustomerLiability).toBe(4_200_000);
  });
});

describe("an explicitly supplied cap is still honoured", () => {
  it("clamps and warns when a caller opts in to a ceiling", () => {
    const r = computeFinancialObligation(
      snapshot({ registrationFee: 45_000, registrationFeeCap: 30_000 })
    );
    expect(r.totalAdditionalCharges).toBe(30_000);
    expect(r.validationErrors.map(e => e.code)).toContain(
      FOE_CODES.REGISTRATION_FEE_ABOVE_CAP
    );
  });
});
