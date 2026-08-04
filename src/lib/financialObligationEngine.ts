/* ══════════════════════════════════════════════════════════════════════════
   financialObligationEngine.ts — the Financial Obligation Engine (FOE).

   SINGLE SOURCE OF DERIVED FINANCIAL TRUTH for a booking. Given a snapshot of
   what has been agreed, sanctioned, disbursed and collected, this module says
   what is funded, what may still be accepted, and what contradicts what.

   ── Why this exists ─────────────────────────────────────────────────────────
   The same questions were being answered independently in at least three
   places, with three different formulas:

     • computeCostBreakdown() in components/BookingFormModal.tsx — client-side,
       per-form, knows nothing about disbursements.
     • booking_total_cost_view (SQL) — required_own_contribution is
       `agreement + gst − sanction`, and total_loan_disbursed comes from
       financial_ledger where received_from = 'Bank'.
     • LoanDealForm.tsx — disbursed is summed from disbursement_tranches whose
       status is Completed/Received.

   Live consequence (BK-2026-08-03-00021): a ₹70,00,000 loan was fully disbursed
   against a ₹70,00,000 agreement, and the booking screen still showed
   "OCR Required ₹2,80,000" with the OCR fields open — and took ₹11,60,000.
   No component could state that the agreement was already fully funded, so
   nothing gated on it.

   ── What this module is ─────────────────────────────────────────────────────
   Pure. No DB access, no Next.js imports, no I/O, no clock, no randomness. The
   same snapshot always yields the same obligation, which is what makes it
   usable from an API validator, a read endpoint, a React component and an audit
   script without any of them disagreeing.

   The only import is ./gst, itself a pure module, so that "what GST rate
   applies" keeps exactly one definition (see the header of gst.ts for why a
   0% rate cannot be expressed with `||`).

   ── What this module is NOT ─────────────────────────────────────────────────
   It does not decide where `disbursedAmount` comes from. Two sources exist in
   this codebase (disbursement_tranches vs the ledger) and they can disagree;
   picking one is the job of whoever builds the snapshot. FOE reports on the
   numbers it is handed.

   ── Units ───────────────────────────────────────────────────────────────────
   RUPEES, as plain numbers — matching every money column in the schema
   (all `numeric`, all rupees) and every existing read (`Number(x) || 0`).
   There is no paise representation anywhere in this system; do not introduce
   one here.
   ══════════════════════════════════════════════════════════════════════════ */

import { calcGstAmount } from "./gst";

// ─── Status vocabularies ─────────────────────────────────────────────────────

/** Stages that can take money and can therefore be sealed off. */
export type FundingStatus = "Pending" | "Partial" | "Paid" | "Overpaid" | "Locked";

/**
 * Additional charges never gate on agreement funding (core rule 6), so their
 * status can never be "Locked" — the type says so rather than a comment.
 */
export type ChargeStatus = "Pending" | "Partial" | "Paid" | "Locked";

export type OverallStatus = "Pending" | "Partial" | "Paid" | "Overpaid" | "Mismatch";

export type ValidationSeverity = "warning" | "error" | "critical";

export interface FinancialValidationError {
  /** Stable machine key. Callers must branch on this, never on `message`. */
  code: string;
  severity: ValidationSeverity;
  message: string;
}

/**
 * Every code this engine can emit. Exported so API routes, UI banners and the
 * audit script share one vocabulary instead of re-typing string literals.
 */
export const FOE_CODES = {
  OCR_EXCEEDS_ALLOCATABLE: "OCR_EXCEEDS_ALLOCATABLE",
  LOAN_EXCEEDS_CEILING: "LOAN_EXCEEDS_CEILING",
  DISBURSED_EXCEEDS_SANCTION: "DISBURSED_EXCEEDS_SANCTION",
  AGREEMENT_OVERFUNDED: "AGREEMENT_OVERFUNDED",
  TOTAL_OVERPAID: "TOTAL_OVERPAID",
  AGREEMENT_VALUE_MISSING: "AGREEMENT_VALUE_MISSING",
  CONSIDERATION_MISMATCH: "CONSIDERATION_MISMATCH",
  REGISTRATION_FEE_ABOVE_CAP: "REGISTRATION_FEE_ABOVE_CAP",
} as const;

// ─── Input ───────────────────────────────────────────────────────────────────

export interface FinancialSnapshot {
  // ── Core values ──
  agreementValue: number;
  /** Informational only. A mismatch with agreementValue raises a warning. */
  considerationValue?: number;

  // ── Customer payments ──
  tokenPaid: number;
  bookingAmountPaid: number;
  additionalOCRPaid: number;

  // ── Loan ──
  sanctionedAmount: number;
  /** Actual disbursements only. Never the sanctioned figure. */
  disbursedAmount: number;

  // ── Additional charges (separate from the agreement) ──
  gstPercent: number;
  stampDutyAmount: number;
  registrationFee: number;
  legalCharges: number;
  maintenanceDeposit: number;
  customCharges: number;
  cashComponent: number;
  /**
   * Included so totalCustomerLiability agrees with the existing
   * booking_total_cost_view.total_cost_to_customer, which counts possession
   * charges. Omitting it would make FOE a fourth disagreeing opinion.
   */
  possessionCharges?: number;

  // ── Paid-to-date per charge ──
  // Without these the charge statuses cannot be derived at all: an amount alone
  // cannot distinguish Pending from Paid. All optional — a caller that does not
  // know yet gets "Pending", which is the safe reading of "no evidence of payment".
  gstPaid?: number;
  stampDutyPaid?: number;
  registrationFeePaid?: number;
  legalPaid?: number;
  maintenancePaid?: number;

  // ── Org settings ──
  /** Token is a pivot: never deducted from the loan ceiling. Business rule, not a bug. */
  tokenIsPivot?: boolean;
  registrationFeeCap?: number;
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface FinancialObligation {
  // Agreement funding
  agreementFunded: number;
  agreementRemaining: number;
  agreementFullyFunded: boolean;

  // Loan constraints
  maxAllowedLoan: number;
  loanHeadroom: number;
  loanOverLimit: boolean;

  // OCR constraints
  maxOCRAllocatable: number;
  totalOCRPaid: number;
  ocrOverLimit: boolean;

  // Additional charges
  gstAmount: number;
  totalAdditionalCharges: number;
  totalCustomerLiability: number;

  // Outstanding
  totalPaid: number;
  totalRemaining: number;

  // Derived stage statuses — never set by hand anywhere
  agreementFundingStatus: FundingStatus;
  ocrStatus: FundingStatus;
  gstStatus: ChargeStatus;
  stampDutyStatus: ChargeStatus;
  registrationStatus: ChargeStatus;
  overallStatus: OverallStatus;

  // UI / API gates
  canAcceptMoreOCR: boolean;
  canAcceptMoreLoanSanction: boolean;
  canAddDisbursementTranche: boolean;
  requiresAdminOverride: string[];

  validationErrors: FinancialValidationError[];

  // Echoed inputs. API validators report the offending figures back to the
  // client alongside the limits, and should not have to carry the snapshot too.
  agreementValue: number;
  sanctionedAmount: number;
  disbursedAmount: number;
}

// ─── Numeric hygiene ─────────────────────────────────────────────────────────

/**
 * Money read off a `numeric` column arrives as a string, and a missing join
 * arrives as null. Anything non-finite or negative is treated as absent rather
 * than propagated: one NaN in a snapshot would otherwise turn every derived
 * figure — and every gate that reads them — into NaN/false silently.
 *
 * Negatives are floored at 0 because this engine models gross positions;
 * refunds are netted by whoever builds the snapshot.
 */
function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed < 0 ? 0 : parsed;
}

/**
 * Rupee-scale tolerance. Agreement values run to eight figures and the inputs
 * are floats, so `7000000.0000001 - 7000000 > 0` is true while being false in
 * every sense that matters. Half a rupee is below the smallest amount this
 * system records and above any plausible accumulated drift.
 */
const EPSILON = 0.5;

const isZero = (a: number) => Math.abs(a) < EPSILON;
/** Meaningfully greater — not merely greater by floating-point noise. */
const gt = (a: number, b: number) => a - b > EPSILON;
/** Greater or equal within tolerance: "paid to the rupee" counts as paid. */
const gte = (a: number, b: number) => a - b > -EPSILON;

// ─── Status helpers ──────────────────────────────────────────────────────────

/**
 * Charge status from amount vs paid. A zero charge is "Paid" because nothing is
 * owed — reporting Pending for a charge that does not exist would light up
 * every booking with no legal fee. Overpayment collapses to Paid: ChargeStatus
 * has no Overpaid, and an over-collected charge surfaces through TOTAL_OVERPAID.
 */
function chargeStatus(amount: number, paid: number): ChargeStatus {
  if (isZero(amount)) return "Paid";
  if (isZero(paid)) return "Pending";
  return gte(paid, amount) ? "Paid" : "Partial";
}

// ─── The engine ──────────────────────────────────────────────────────────────

export function computeFinancialObligation(snapshot: FinancialSnapshot): FinancialObligation {
  const agreementValue = num(snapshot.agreementValue);
  const tokenPaid = num(snapshot.tokenPaid);
  const bookingAmountPaid = num(snapshot.bookingAmountPaid);
  const additionalOCRPaid = num(snapshot.additionalOCRPaid);
  const sanctionedAmount = num(snapshot.sanctionedAmount);
  const disbursedAmount = num(snapshot.disbursedAmount);
  const cashComponent = num(snapshot.cashComponent);

  const tokenIsPivot = snapshot.tokenIsPivot !== false; // default true
  const registrationFeeCap = snapshot.registrationFeeCap === undefined
    ? 30000
    : num(snapshot.registrationFeeCap);

  // ── Rule 1: qualifying customer contribution ──
  // Token is deliberately excluded: it is a pivot, the earnest money that opens
  // the deal, and must never shrink the loan ceiling. Cash component is excluded
  // too — it sits outside the agreement value by definition, so letting it buy
  // down the ceiling would treat off-agreement money as agreement funding.
  const qualifyingCustomerContribution =
    bookingAmountPaid + additionalOCRPaid + (tokenIsPivot ? 0 : tokenPaid);

  // ── Rule 2: loan ceiling ──
  // Not clamped at 0. A negative ceiling means the customer has already
  // contributed more than the agreement is worth, which is real information and
  // makes rules 3 and 9 read correctly rather than silently permitting more loan.
  const maxAllowedLoan = agreementValue - qualifyingCustomerContribution;
  const loanHeadroom = maxAllowedLoan - sanctionedAmount;
  const loanOverLimit = gt(sanctionedAmount, maxAllowedLoan); // rule 3

  // ── Rules 4 & 5: OCR ceiling once the bank has paid ──
  const maxOCRAllocatable = Math.max(0, agreementValue - disbursedAmount);
  const totalOCRPaid = tokenPaid + bookingAmountPaid + additionalOCRPaid;
  // `+ tokenPaid` is the pivot allowance: the token may always be held, even
  // when the agreement is fully covered by the loan. This is deliberately
  // asymmetric with canAcceptMoreOCR below, which compares the same total
  // against the bare allocatable figure — the token can be *kept* but does not
  // buy room to accept *more*. Do not "fix" one to match the other.
  const ocrOverLimit = gt(totalOCRPaid, maxOCRAllocatable + tokenPaid);

  // ── Rule 7: agreement funding ──
  const agreementFunded = disbursedAmount + qualifyingCustomerContribution;
  const agreementRemaining = agreementValue - agreementFunded;
  const agreementFullyFunded = !gt(agreementRemaining, 0);

  // ── Rules 8 & 9 plus the sanction gate ──
  const canAcceptMoreOCR = !agreementFullyFunded || gt(maxOCRAllocatable, totalOCRPaid);
  // `!loanOverLimit` is an addition to rule 9 as originally briefed. Rule 9 compares
  // only *disbursed* against sanction and ceiling, which left a loan sanctioned
  // above its ceiling still able to disburse up to that ceiling. A sanction that
  // breaches the ceiling is a defect to correct before more bank money moves, so
  // the whole tranche path is closed until it is resolved.
  //
  // It lives here rather than in the API route on purpose: this flag is what both
  // the route (Phase 2) and the Add Tranche button (Phase 4) read. Gating in the
  // route alone would leave the button enabled and the request refused — the exact
  // class of contradiction this engine exists to remove.
  const canAddDisbursementTranche =
    !loanOverLimit && gt(sanctionedAmount, disbursedAmount) && gt(maxAllowedLoan, disbursedAmount);
  const canAcceptMoreLoanSanction = !loanOverLimit && gt(maxAllowedLoan, sanctionedAmount);

  // ── Rule 6: additional charges, always separate and never locked ──
  const gstAmount = calcGstAmount(agreementValue, num(snapshot.gstPercent));
  const stampDutyAmount = num(snapshot.stampDutyAmount);
  const rawRegistrationFee = num(snapshot.registrationFee);
  // The cap is applied to what is owed, not silently dropped: a fee entered
  // above the cap is a data-entry issue worth flagging (warning below).
  const registrationFee = Math.min(rawRegistrationFee, registrationFeeCap);
  const legalCharges = num(snapshot.legalCharges);
  const maintenanceDeposit = num(snapshot.maintenanceDeposit);
  const customCharges = num(snapshot.customCharges);
  const possessionCharges = num(snapshot.possessionCharges);

  const totalAdditionalCharges =
    gstAmount + stampDutyAmount + registrationFee + legalCharges +
    maintenanceDeposit + possessionCharges + customCharges;

  const totalCustomerLiability = agreementValue + totalAdditionalCharges;

  // Cash counts as money received even though it never bought loan headroom.
  const totalPaid = disbursedAmount + tokenPaid + bookingAmountPaid + additionalOCRPaid + cashComponent;
  const totalRemaining = totalCustomerLiability - totalPaid;

  // ── Statuses ──
  let agreementFundingStatus: FundingStatus;
  if (agreementFullyFunded && !canAcceptMoreOCR) agreementFundingStatus = "Locked";
  else if (gt(agreementFunded, agreementValue)) agreementFundingStatus = "Overpaid";
  else if (!isZero(agreementValue) && gte(agreementFunded, agreementValue)) agreementFundingStatus = "Paid";
  else if (isZero(agreementFunded)) agreementFundingStatus = "Pending";
  else agreementFundingStatus = "Partial";

  let ocrStatus: FundingStatus;
  // Locked outranks Overpaid: the actionable fact for a UI is that the field is
  // sealed. The overage is still reported through ocrOverLimit and its critical
  // validation error.
  if (!canAcceptMoreOCR) ocrStatus = "Locked";
  else if (ocrOverLimit) ocrStatus = "Overpaid";
  else if (isZero(totalOCRPaid)) ocrStatus = "Pending";
  else if (gte(totalOCRPaid, maxOCRAllocatable)) ocrStatus = "Paid";
  else ocrStatus = "Partial";

  const gstStatus = chargeStatus(gstAmount, num(snapshot.gstPaid));
  const stampDutyStatus = chargeStatus(stampDutyAmount, num(snapshot.stampDutyPaid));
  const registrationStatus = chargeStatus(registrationFee, num(snapshot.registrationFeePaid));

  // ── Validation ──
  const validationErrors: FinancialValidationError[] = [];
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  if (ocrOverLimit) {
    validationErrors.push({
      code: FOE_CODES.OCR_EXCEEDS_ALLOCATABLE,
      severity: "critical",
      message: `OCR collected ${fmt(totalOCRPaid)} exceeds the ${fmt(maxOCRAllocatable)} still allocatable to the agreement after ${fmt(disbursedAmount)} of loan disbursement (token ${fmt(tokenPaid)} allowed as pivot).`,
    });
  }
  if (loanOverLimit) {
    validationErrors.push({
      code: FOE_CODES.LOAN_EXCEEDS_CEILING,
      severity: "critical",
      message: `Sanctioned loan ${fmt(sanctionedAmount)} exceeds the ceiling of ${fmt(maxAllowedLoan)} (agreement ${fmt(agreementValue)} less qualifying customer contribution ${fmt(qualifyingCustomerContribution)}).`,
    });
  }
  if (gt(disbursedAmount, sanctionedAmount)) {
    validationErrors.push({
      code: FOE_CODES.DISBURSED_EXCEEDS_SANCTION,
      severity: "critical",
      message: `Disbursed ${fmt(disbursedAmount)} exceeds the sanctioned ${fmt(sanctionedAmount)}.`,
    });
  }
  if (gt(agreementFunded, agreementValue)) {
    validationErrors.push({
      code: FOE_CODES.AGREEMENT_OVERFUNDED,
      severity: "error",
      message: `Agreement funded ${fmt(agreementFunded)} against a value of ${fmt(agreementValue)} — over by ${fmt(agreementFunded - agreementValue)}.`,
    });
  }
  if (gt(totalPaid, totalCustomerLiability)) {
    validationErrors.push({
      code: FOE_CODES.TOTAL_OVERPAID,
      severity: "error",
      message: `Total received ${fmt(totalPaid)} exceeds total customer liability ${fmt(totalCustomerLiability)} — over by ${fmt(totalPaid - totalCustomerLiability)}.`,
    });
  }
  if (isZero(agreementValue)) {
    validationErrors.push({
      code: FOE_CODES.AGREEMENT_VALUE_MISSING,
      severity: "error",
      message: "Agreement value is missing or zero — every ceiling and funding ratio derived here is meaningless until it is set.",
    });
  }
  if (snapshot.considerationValue !== undefined && !isZero(num(snapshot.considerationValue) - agreementValue)) {
    validationErrors.push({
      code: FOE_CODES.CONSIDERATION_MISMATCH,
      severity: "warning",
      message: `Consideration value ${fmt(num(snapshot.considerationValue))} differs from agreement value ${fmt(agreementValue)}.`,
    });
  }
  if (gt(rawRegistrationFee, registrationFeeCap)) {
    validationErrors.push({
      code: FOE_CODES.REGISTRATION_FEE_ABOVE_CAP,
      severity: "warning",
      message: `Registration fee ${fmt(rawRegistrationFee)} is above the ${fmt(registrationFeeCap)} cap; ${fmt(registrationFee)} has been used in all totals.`,
    });
  }

  const requiresAdminOverride = validationErrors
    .filter(e => e.severity === "critical" || e.severity === "error")
    .map(e => e.code);

  let overallStatus: OverallStatus;
  if (validationErrors.some(e => e.severity === "critical")) overallStatus = "Mismatch";
  else if (gt(totalPaid, totalCustomerLiability)) overallStatus = "Overpaid";
  else if (!isZero(totalCustomerLiability) && gte(totalPaid, totalCustomerLiability)) overallStatus = "Paid";
  else if (isZero(totalPaid)) overallStatus = "Pending";
  else overallStatus = "Partial";

  return {
    agreementFunded,
    agreementRemaining,
    agreementFullyFunded,

    maxAllowedLoan,
    loanHeadroom,
    loanOverLimit,

    maxOCRAllocatable,
    totalOCRPaid,
    ocrOverLimit,

    gstAmount,
    totalAdditionalCharges,
    totalCustomerLiability,

    totalPaid,
    totalRemaining,

    agreementFundingStatus,
    ocrStatus,
    gstStatus,
    stampDutyStatus,
    registrationStatus,
    overallStatus,

    canAcceptMoreOCR,
    canAcceptMoreLoanSanction,
    canAddDisbursementTranche,
    requiresAdminOverride,

    validationErrors,

    agreementValue,
    sanctionedAmount,
    disbursedAmount,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   TEST CASES — expected input/output.

   There is no test runner in this project (no jest/vitest, no `test` script),
   so these are executable-by-hand specifications. Every figure below was
   derived from the rules above, not copied from a run.

   ── 1. Normal: OCR partial, loan partial ──────────────────────────────────
   IN  { agreementValue: 7000000, tokenPaid: 100000, bookingAmountPaid: 500000,
         additionalOCRPaid: 200000, sanctionedAmount: 5500000,
         disbursedAmount: 2000000, gstPercent: 5, stampDutyAmount: 350000,
         registrationFee: 30000, legalCharges: 25000, maintenanceDeposit: 35000,
         customCharges: 0, cashComponent: 0 }
   OUT   qualifying contribution     700000   (token excluded — pivot)
         maxAllowedLoan             6300000
         loanHeadroom                800000   loanOverLimit         false
         agreementFunded            2700000   agreementRemaining  4300000
         agreementFullyFunded         false
         maxOCRAllocatable          5000000   totalOCRPaid         800000
         ocrOverLimit                 false
         gstAmount                   350000   totalAdditionalCharges 790000
         totalCustomerLiability     7790000
         totalPaid                  2800000   totalRemaining      4990000
         agreementFundingStatus   'Partial'   ocrStatus           'Partial'
         gstStatus                'Pending'   overallStatus       'Partial'
         canAcceptMoreOCR              true   canAddDisbursementTranche true
         canAcceptMoreLoanSanction     true   validationErrors          []

   ── 2. Loan fully funds the agreement → OCR locked ────────────────────────
   The live BK-2026-08-03-00021 position.
   IN  { agreementValue: 7000000, tokenPaid: 10000, bookingAmountPaid: 700000,
         additionalOCRPaid: 450000, sanctionedAmount: 7000000,
         disbursedAmount: 7000000, gstPercent: 4, stampDutyAmount: 350000,
         registrationFee: 30000, legalCharges: 25000, maintenanceDeposit: 35000,
         customCharges: 0, cashComponent: 0 }
   OUT   maxAllowedLoan             5850000   loanOverLimit          true
         loanHeadroom              -1150000
         agreementFunded            8150000   agreementRemaining -1150000
         agreementFullyFunded          true
         maxOCRAllocatable                0   totalOCRPaid        1160000
         ocrOverLimit                  true
         gstAmount                   280000   totalAdditionalCharges 720000
         totalCustomerLiability     7720000
         totalPaid                  8160000   totalRemaining      -440000
         agreementFundingStatus    'Locked'   ocrStatus            'Locked'
         gstStatus                'Pending'   overallStatus      'Mismatch'
         canAcceptMoreOCR             false   canAddDisbursementTranche false
         canAcceptMoreLoanSanction    false
         validationErrors: OCR_EXCEEDS_ALLOCATABLE (critical),
                           LOAN_EXCEEDS_CEILING (critical),
                           AGREEMENT_OVERFUNDED (error),
                           TOTAL_OVERPAID (error)
   NOTE  totalAdditionalCharges is 720000, not the 920000 shown in the original
         Phase 4 mock-up: 280000 + 350000 + 30000 + 25000 + 35000 = 720000, so
         liability is 7720000 rather than 7920000.

   ── 3. OCR paid first → loan ceiling auto-reduced ─────────────────────────
   IN  { agreementValue: 7000000, tokenPaid: 0, bookingAmountPaid: 500000,
         additionalOCRPaid: 2000000, sanctionedAmount: 5000000,
         disbursedAmount: 0, gstPercent: 5, stampDutyAmount: 0,
         registrationFee: 0, legalCharges: 0, maintenanceDeposit: 0,
         customCharges: 0, cashComponent: 0 }
   OUT   qualifying contribution    2500000
         maxAllowedLoan             4500000   loanOverLimit          true
         loanHeadroom               -500000   (sanction 5000000 > ceiling)
         agreementFunded            2500000   agreementFullyFunded  false
         maxOCRAllocatable          7000000   totalOCRPaid        2500000
         ocrOverLimit                 false   canAcceptMoreOCR       true
         canAcceptMoreLoanSanction    false
         canAddDisbursementTranche    false   ← the sanction breaches its ceiling,
                                                so the tranche path is closed
                                                until that is corrected, even
                                                though 4500000 of room remains
                                                below the ceiling.
         overallStatus           'Mismatch'
         validationErrors: LOAN_EXCEEDS_CEILING (critical)

   ── 4. Token as pivot — ceiling not reduced by the token ──────────────────
   IN  { agreementValue: 7000000, tokenPaid: 100000, bookingAmountPaid: 0,
         additionalOCRPaid: 1000000, sanctionedAmount: 0, disbursedAmount: 0,
         gstPercent: 5, ...zero charges }
   OUT   maxAllowedLoan             6000000   ← 7000000 − 1000000, token ignored
   AND with the same input plus { tokenIsPivot: false }:
   OUT   maxAllowedLoan             5900000   ← token now deducted
         The 100000 difference is the whole point of the pivot rule.

   ── 5. Charges stay open when the agreement is fully funded ───────────────
   IN  { agreementValue: 5000000, tokenPaid: 0, bookingAmountPaid: 0,
         additionalOCRPaid: 0, sanctionedAmount: 5000000,
         disbursedAmount: 5000000, gstPercent: 5, gstPaid: 100000,
         stampDutyAmount: 250000, registrationFee: 30000, legalCharges: 0,
         maintenanceDeposit: 0, customCharges: 0, cashComponent: 0 }
   OUT   agreementFullyFunded          true   agreementFundingStatus 'Locked'
         maxOCRAllocatable                0   ocrStatus            'Locked'
         canAcceptMoreOCR             false   canAddDisbursementTranche false
         gstAmount                   250000   gstStatus           'Partial' ←
         stampDutyStatus          'Pending' ←  charges remain open and payable
         registrationStatus       'Pending' ←  though the agreement is sealed
         totalAdditionalCharges      530000   totalCustomerLiability 5530000
         totalPaid                  5000000   totalRemaining        530000
         overallStatus            'Partial'   validationErrors          []
   ══════════════════════════════════════════════════════════════════════════ */
