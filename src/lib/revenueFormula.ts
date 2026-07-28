/* ══════════════════════════════════════════════════════════════════════════
   revenueFormula.ts — the configurable Revenue Received engine.

   SINGLE SOURCE OF TRUTH. Every KPI, chart, table, drill-down total and export
   must call calculateRevenueReceived / sumRevenueReceived rather than summing
   receipt lines itself. If you find yourself writing
   `token + booking + ocr + ...` anywhere, that is the bug this file exists to
   prevent.

   ── Adding a new receipt component (maintenance, club house, parking, GST
      adjustment, penalty, refund, broker commission …) ──────────────────────
   1. Emit a receipt line for it from buildReceiptLines() in revenueCalculations.ts
      (key, label, amount, received, isGovernment, suppressed).
   2. Add one entry to REVENUE_COMPONENTS below, using that same key.
   Nothing else changes: the modal, subtitle, KPIs, charts, drill-downs and
   exports are all generated from this registry.

   ── Cash basis ──────────────────────────────────────────────────────────────
   A component only contributes when its receipt line is confirmed received and
   is not suppressed. Ticking a component never turns unconfirmed money into
   revenue; it only decides whether confirmed money is counted.
   ══════════════════════════════════════════════════════════════════════════ */

import { parseRevenueAmount } from "./revenueCalculations";

export type RevenueConfig = Record<string, boolean>;

export type RevenueComponent = {
  /** Must match the receipt line key emitted by buildReceiptLines(). */
  key: string;
  /** Shown in the configuration modal. */
  label: string;
  /** Shown in the KPI subtitle, where space is tight. */
  shortLabel: string;
  /** One-line explanation shown under the checkbox. */
  hint?: string;
};

/**
 * The registry. This is the only list that needs editing to add a component.
 * Order here is the order shown in the modal and in the generated subtitle.
 */
export const REVENUE_COMPONENTS: RevenueComponent[] = [
  { key: "token_amount", label: "Token", shortLabel: "Token", hint: "Earnest money taken at booking" },
  { key: "booking_amount", label: "Booking Amount", shortLabel: "Booking", hint: "Deposit taken to confirm the booking" },
  { key: "ocr_amount", label: "OCR (Own Contribution)", shortLabel: "OCR", hint: "Customer's own contribution instalments" },
  { key: "cash_component", label: "Cash Component", shortLabel: "Cash", hint: "Cash portion recorded against the booking" },
  { key: "disbursement_amount", label: "Loan Disbursement", shortLabel: "Disbursement", hint: "Amount actually disbursed by the bank" },
];

/** All components on — the documented default. */
export const DEFAULT_REVENUE_CONFIG: RevenueConfig = Object.fromEntries(
  REVENUE_COMPONENTS.map((c) => [c.key, true])
);

export const REVENUE_CONFIG_STORAGE_KEY = "bhoomi_revenue_received_components";

/**
 * Reconcile a stored config with the current registry.
 *
 * Matters when a component is added later: an admin's saved config predates the
 * new key, and a bare lookup would read `undefined` and silently drop it. New
 * components default to ON, so behaviour matches a fresh install rather than
 * quietly excluding money.
 */
export function normalizeRevenueConfig(stored: unknown): RevenueConfig {
  const base: RevenueConfig = { ...DEFAULT_REVENUE_CONFIG };
  if (!stored || typeof stored !== "object") return base;
  for (const component of REVENUE_COMPONENTS) {
    const value = (stored as any)[component.key];
    if (typeof value === "boolean") base[component.key] = value;
  }
  return base;
}

export function isRevenueComponentEnabled(config: RevenueConfig | undefined, key: string): boolean {
  if (!config) return DEFAULT_REVENUE_CONFIG[key] ?? false;
  return config[key] !== false;
}

/** The receipt line for `key` on this booking, if the API returned one. */
function findLine(record: any, key: string) {
  return (record?.receipt_lines || []).find((line: any) => line.key === key);
}

/**
 * Confirmed amount a single component contributes on a single booking.
 * Returns 0 when unconfirmed, suppressed, or missing — never null.
 */
export function componentAmount(record: any, key: string): number {
  const line = findLine(record, key);
  if (!line || !line.received || line.suppressed) return 0;
  return parseRevenueAmount(line.amount);
}

/**
 * A component is suppressed when another line already contains it — e.g. token
 * folded into the booking amount (BOOKING_AMOUNT_INCLUDES_TOKEN). Surfaced in
 * the modal so an admin who ticks it and sees no change knows why, rather than
 * concluding the toggle is broken.
 */
export function isComponentSuppressed(records: any[], key: string): boolean {
  let sawLine = false;
  for (const record of records || []) {
    const line = findLine(record, key);
    if (!line || parseRevenueAmount(line.amount) <= 0) continue;
    sawLine = true;
    if (!line.suppressed) return false;
  }
  return sawLine;
}

/** THE formula. Everything else in the app defers to this. */
export function calculateRevenueReceived(record: any, config: RevenueConfig = DEFAULT_REVENUE_CONFIG): number {
  return REVENUE_COMPONENTS.reduce(
    (total, component) =>
      isRevenueComponentEnabled(config, component.key)
        ? total + componentAmount(record, component.key)
        : total,
    0
  );
}

export function sumRevenueReceived(records: any[], config: RevenueConfig = DEFAULT_REVENUE_CONFIG): number {
  return (records || []).reduce((total, record) => total + calculateRevenueReceived(record, config), 0);
}

/**
 * Agreement value minus what the configured formula counts as received.
 * Floored at 0 — an overpaid booking is a data-quality signal reported
 * separately, not a negative receivable.
 */
export function calculateBalanceReceivable(record: any, config: RevenueConfig = DEFAULT_REVENUE_CONFIG): number {
  const agreement = parseRevenueAmount(record?.agreement_value_number ?? record?.agreement_value);
  return Math.max(0, agreement - calculateRevenueReceived(record, config));
}

export function sumBalanceReceivable(records: any[], config: RevenueConfig = DEFAULT_REVENUE_CONFIG): number {
  return (records || []).reduce((total, record) => total + calculateBalanceReceivable(record, config), 0);
}

export function sumAgreementValue(records: any[]): number {
  return (records || []).reduce(
    (total, record) => total + parseRevenueAmount(record?.agreement_value_number ?? record?.agreement_value),
    0
  );
}

/** Received ÷ agreement value, as a whole percentage. 0 when there is nothing to collect. */
export function calculateCollectionEfficiency(records: any[], config: RevenueConfig = DEFAULT_REVENUE_CONFIG): number {
  const agreement = sumAgreementValue(records);
  if (agreement <= 0) return 0;
  return Math.round((sumRevenueReceived(records, config) / agreement) * 100);
}

/** Government charges are pass-through and never configurable — not our money. */
export function sumGovernmentCharges(records: any[]): number {
  return (records || []).reduce(
    (total, record) => total + parseRevenueAmount(record?.government_charges_received),
    0
  );
}

/** Configured revenue + government charges collected. */
export function sumGrossCollection(records: any[], config: RevenueConfig = DEFAULT_REVENUE_CONFIG): number {
  return sumRevenueReceived(records, config) + sumGovernmentCharges(records);
}

/** "Booking + OCR + Cash" — generated, never hardcoded. */
export function describeRevenueConfig(config: RevenueConfig = DEFAULT_REVENUE_CONFIG): string {
  const enabled = REVENUE_COMPONENTS.filter((c) => isRevenueComponentEnabled(config, c.key));
  if (enabled.length === 0) return "No revenue components selected";
  return enabled.map((c) => c.shortLabel).join(" + ");
}

export function isDefaultRevenueConfig(config: RevenueConfig): boolean {
  return REVENUE_COMPONENTS.every(
    (c) => isRevenueComponentEnabled(config, c.key) === (DEFAULT_REVENUE_CONFIG[c.key] !== false)
  );
}
