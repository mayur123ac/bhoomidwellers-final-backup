/* ══════════════════════════════════════════════════════════════════════════
   Revenue analytics — Bhoomi Dwellers CRM

   REVENUE MODEL
   ─────────────
   Agreement Value  = developer's full entitlement for the unit
                    = customer own contribution + bank loan disbursement

   Developer Revenue Received  (CASH BASIS — confirmed receipts only)
                    = token + booking amount + OCR + cash component
                      + actual loan disbursement

   NOT developer revenue (collected on the government's behalf):
                      SDR (stamp duty + registration), GST, statutory charges

   Gross Collection = Developer Revenue + Government Charges
   Balance Receivable = Agreement Value − Developer Revenue Received

   THE CORE RULE: an amount counts as revenue only when there is evidence the
   money actually arrived — a receipt date, or a status that reads as completed.
   An agreed-but-unpaid ₹20L OCR is a receivable, not revenue.
   ══════════════════════════════════════════════════════════════════════════ */

export type RevenueStageId =
  | "booking"
  | "loan_applied"
  | "loan_sanctioned"
  | "ocr_completed"
  | "sdr_paid"
  | "registration"
  | "disbursement"
  | "completed";

export const REVENUE_STAGES: Array<{ id: RevenueStageId; label: string }> = [
  { id: "booking", label: "Booking" },
  { id: "loan_applied", label: "Loan Applied" },
  { id: "loan_sanctioned", label: "Loan Sanctioned" },
  { id: "ocr_completed", label: "OCR Completed" },
  { id: "sdr_paid", label: "SDR Paid" },
  { id: "registration", label: "Registration" },
  { id: "disbursement", label: "Disbursement" },
  { id: "completed", label: "Completed" },
];

/* ═══════════════════════ RECOGNITION CONFIG ═══════════════════════
   Two double-counting risks that depend on how your team fills the sheet.
   Both are currently unverifiable because `ocr_amount` and `token_amount`
   are empty on every booking. Revisit once real OCR data exists.
   ═════════════════════════════════════════════════════════════════ */

/**
 * TRUE  → `ocr_amount` is CUMULATIVE own contribution and already contains the
 *         booking amount. Booking amount is then NOT added separately.
 * FALSE → `ocr_amount` holds only instalments collected AFTER booking.
 *
 * Default FALSE. Justification: with OCR empty on all bookings, booking_amount
 * is the only confirmed receipt in the system — treating it as included in OCR
 * would report ₹0 revenue against ₹5,00,000 actually collected.
 */
export const OCR_INCLUDES_BOOKING_AMOUNT = false;

/**
 * TRUE  → `booking_amount` already contains `token_amount` (token adjusted into
 *         the booking amount, the usual Indian convention).
 * FALSE → token and booking amount are separate receipts.
 */
export const BOOKING_AMOUNT_INCLUDES_TOKEN = true;

/** Statuses that confirm receipt when no date column is populated. */
const RECEIPT_CONFIRMING_STATUSES = [
  "received",
  "paid",
  "disbursed",
  "completed",
  "complete",
  "credited",
  "cleared",
];

/* ═══════════════════════════ PRIMITIVES ═══════════════════════════ */

export function parseRevenueAmount(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatRevenueAmount(value: unknown): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(parseRevenueAmount(value));
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function toDateKey(value: unknown): string | null {
  const date = toDate(value);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value: unknown, days: number): Date | null {
  const date = toDate(value);
  if (!date) return null;
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function daysBetween(startValue: unknown, endValue: unknown): number | null {
  const start = toDate(startValue);
  const end = toDate(endValue);
  if (!start || !end) return null;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.round((endDay - startDay) / 86_400_000);
}

export function startOfWeek(value: Date): Date {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

export function endOfWeek(value: Date): Date {
  const date = startOfWeek(value);
  date.setDate(date.getDate() + 6);
  return date;
}

export function isSameDay(value: unknown, now = new Date()): boolean {
  const date = toDate(value);
  return !!date && toDateKey(date) === toDateKey(now);
}

export function isThisWeek(value: unknown, now = new Date()): boolean {
  const date = toDate(value);
  if (!date) return false;
  return date >= startOfWeek(now) && date <= endOfWeek(now);
}

export function isThisMonth(value: unknown, now = new Date()): boolean {
  const date = toDate(value);
  return !!date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function isLastMonth(value: unknown, now = new Date()): boolean {
  const date = toDate(value);
  if (!date) return false;
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth();
}

export function isWithinNextDays(value: unknown, days: number, now = new Date()): boolean {
  const date = toDate(value);
  if (!date) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today);
  end.setDate(end.getDate() + days);
  return date >= today && date <= end;
}

export function normalizeRevenueStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function statusMatches(value: unknown, keywords: string[]): boolean {
  const status = normalizeRevenueStatus(value);
  if (!status) return false;
  return keywords.some((keyword) => status.includes(keyword));
}

export function isCompletedStatus(value: unknown): boolean {
  return statusMatches(value, [
    "completed",
    "complete",
    "approved",
    "sanctioned",
    "received",
    "disbursed",
    "done",
  ]);
}

export function isRejectedStatus(value: unknown): boolean {
  return statusMatches(value, ["rejected", "cancelled", "canceled", "declined"]);
}

/** Confirms actual receipt — stricter than isCompletedStatus, which also
 *  accepts "approved"/"sanctioned" (commitments, not payments). */
function isReceiptConfirmed(value: unknown): boolean {
  return statusMatches(value, RECEIPT_CONFIRMING_STATUSES);
}

export function delayDays(dueValue: unknown, actualValue: unknown, now = new Date()): number {
  const due = toDate(dueValue);
  if (!due) return 0;
  const actual = toDate(actualValue) || now;
  const days = daysBetween(due, actual) ?? 0;
  return Math.max(days, 0);
}

export function getForecastMonth(value: unknown): string | null {
  const date = toDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getForecastWeek(value: unknown): string | null {
  const date = toDate(value);
  if (!date) return null;
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - firstDay.getTime()) / 86_400_000);
  const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function getSdrDueDate(record: Record<string, any>): string | null {
  if (record.sdr_due_date) return toDateKey(record.sdr_due_date);
  const due = addDays(record.booking_date || record.application_date || record.created_at, 15);
  return toDateKey(due);
}

/* ═════════════════════════ RECEIPT LEDGER ═════════════════════════ */

export type ReceiptLine = {
  key: string;
  label: string;
  amount: number;
  /** true only when there's evidence the money arrived */
  received: boolean;
  receivedOn: string | null;
  /** collected for the government — excluded from developer revenue */
  isGovernment: boolean;
  /** suppressed to avoid double-counting under current config */
  suppressed: boolean;
  suppressedReason?: string;
};

/**
 * Sums only tranches that have actually been disbursed.
 * Falls back to the booking's rolled-up `disbursement_amount`.
 */
function disbursementReceipt(record: Record<string, any>): { amount: number; received: boolean; date: string | null } {
  const tranches = Array.isArray(record.disbursement_tranches) ? record.disbursement_tranches : null;

  if (tranches && tranches.length > 0) {
    let total = 0;
    let latest: string | null = null;
    for (const tranche of tranches) {
      const date = tranche.disbursed_date || tranche.actual_disbursement_date || tranche.received_date;
      const confirmed = !!toDate(date) || isReceiptConfirmed(tranche.status);
      if (!confirmed) continue;
      total += parseRevenueAmount(tranche.amount ?? tranche.disbursement_amount);
      const key = toDateKey(date);
      if (key && (!latest || key > latest)) latest = key;
    }
    return { amount: total, received: total > 0, date: latest };
  }

  const amount = parseRevenueAmount(record.disbursement_amount);
  const date = toDateKey(record.actual_disbursement_date);
  const received = amount > 0 && (!!date || isReceiptConfirmed(record.disbursement_status));
  return { amount, received, date };
}

/**
 * Every money line on a booking, with receipt status resolved.
 * This is the single place receipt recognition happens.
 */
export function buildReceiptLines(record: Record<string, any>): ReceiptLine[] {
  const lines: ReceiptLine[] = [];

  // Booking-time receipts. No dedicated date columns exist, so the booking's
  // own date is the receipt date — a booking record cannot exist without the
  // deposit having been taken.
  const bookingDateKey = toDateKey(
    record.booking_date || record.application_date || record.created_at
  );

  const tokenAmount = parseRevenueAmount(record.token_amount);
  lines.push({
    key: "token_amount",
    label: "Token / earnest money",
    amount: tokenAmount,
    received: tokenAmount > 0 && !!bookingDateKey,
    receivedOn: toDateKey(record.token_received_date) || bookingDateKey,
    isGovernment: false,
    suppressed: BOOKING_AMOUNT_INCLUDES_TOKEN && tokenAmount > 0,
    suppressedReason: BOOKING_AMOUNT_INCLUDES_TOKEN
      ? "Token is adjusted into the booking amount (BOOKING_AMOUNT_INCLUDES_TOKEN)"
      : undefined,
  });

  const bookingAmount = parseRevenueAmount(record.booking_amount);
  lines.push({
    key: "booking_amount",
    label: "Booking amount",
    amount: bookingAmount,
    received: bookingAmount > 0 && !!bookingDateKey,
    receivedOn: toDateKey(record.booking_amount_received_date) || bookingDateKey,
    isGovernment: false,
    suppressed: OCR_INCLUDES_BOOKING_AMOUNT && bookingAmount > 0,
    suppressedReason: OCR_INCLUDES_BOOKING_AMOUNT
      ? "Booking amount is already inside OCR (OCR_INCLUDES_BOOKING_AMOUNT)"
      : undefined,
  });

  // Own contribution instalments
  const ocrAmount = parseRevenueAmount(record.ocr_amount);
  const ocrDate = toDateKey(record.ocr_received_date);
  lines.push({
    key: "ocr_amount",
    label: "OCR (own contribution)",
    amount: ocrAmount,
    received: ocrAmount > 0 && (!!ocrDate || isReceiptConfirmed(record.ocr_status)),
    receivedOn: ocrDate,
    isGovernment: false,
    suppressed: false,
  });

  const cashAmount = parseRevenueAmount(record.cash_component);
  const cashDate = toDateKey(record.cash_component_date);
  lines.push({
    key: "cash_component",
    label: "Cash component",
    amount: cashAmount,
    received: cashAmount > 0 && (!!cashDate || isReceiptConfirmed(record.cash_component_status)),
    receivedOn: cashDate,
    isGovernment: false,
    suppressed: false,
  });

  // Bank loan — disbursed only, never sanctioned
  const disbursement = disbursementReceipt(record);
  lines.push({
    key: "disbursement_amount",
    label: "Loan disbursement",
    amount: disbursement.amount,
    received: disbursement.received,
    receivedOn: disbursement.date,
    isGovernment: false,
    suppressed: false,
  });

  // Government charges — collected, but never developer revenue
  const sdrAmount = parseRevenueAmount(record.sdr_amount);
  const sdrDate = toDateKey(record.sdr_payment_date);
  lines.push({
    key: "sdr_amount",
    label: "SDR (stamp duty + registration)",
    amount: sdrAmount,
    received: sdrAmount > 0 && (!!sdrDate || isReceiptConfirmed(record.sdr_status)),
    receivedOn: sdrDate,
    isGovernment: true,
    suppressed: false,
  });

  const gstAmount = parseRevenueAmount(record.gst_amount);
  lines.push({
    key: "gst_amount",
    label: "GST",
    amount: gstAmount,
    received: gstAmount > 0 && (!!toDateKey(record.gst_payment_date) || isReceiptConfirmed(record.gst_status)),
    receivedOn: toDateKey(record.gst_payment_date),
    isGovernment: true,
    suppressed: false,
  });

  const otherGovt = parseRevenueAmount(record.other_government_charges);
  lines.push({
    key: "other_government_charges",
    label: "Other statutory charges",
    amount: otherGovt,
    received: otherGovt > 0 && !!toDateKey(record.other_government_charges_date),
    receivedOn: toDateKey(record.other_government_charges_date),
    isGovernment: true,
    suppressed: false,
  });

  return lines.filter((line) => line.amount > 0 || line.received);
}

export function calculateExpectedRevenue(record: Record<string, any>): number {
  return parseRevenueAmount(record.agreement_value);
}

/**
 * Developer Revenue Received — CASH BASIS.
 *
 * Counts: token + booking amount + OCR + cash component + actual disbursement,
 *         each only when receipt is confirmed by date or status.
 *
 * Excludes: SDR / GST / statutory charges (government's money),
 *           loan_amount, sanction_amount, expected_disbursement_amount
 *           (commitments, not receipts).
 *
 * SINGLE SOURCE OF TRUTH for revenue received. All KPI cards, tables, exports
 * and charts must use this helper.
 */
export function calculateDeveloperRevenue(record: Record<string, any>): number {
  return buildReceiptLines(record)
    .filter((line) => line.received && !line.isGovernment && !line.suppressed)
    .reduce((total, line) => total + line.amount, 0);
}

/** Money recorded on the booking that has NOT yet been confirmed as received. */
export function calculateUnconfirmedRevenue(record: Record<string, any>): number {
  return buildReceiptLines(record)
    .filter((line) => !line.received && !line.isGovernment && !line.suppressed)
    .reduce((total, line) => total + line.amount, 0);
}

/** Government charges actually collected — pass-through, not revenue. */
export function calculateGovernmentCharges(record: Record<string, any>): number {
  return buildReceiptLines(record)
    .filter((line) => line.received && line.isGovernment)
    .reduce((total, line) => total + line.amount, 0);
}

/** @deprecated Use calculateDeveloperRevenue instead */
export function calculateActualRevenue(record: Record<string, any>): number {
  return calculateDeveloperRevenue(record);
}

/* ═══════════════════════════ STAGES ═══════════════════════════
   Stage detection stays amount-OR-date (a stage is reached when the event
   happens), unlike revenue, which requires confirmed receipt.
   ═══════════════════════════════════════════════════════════════ */

export function recordReachesStage(record: Record<string, any>, stage: RevenueStageId): boolean {
  const loanApplied =
    record.loan_required === true ||
    record.loan_required === "true" ||
    !!record.bank_name ||
    parseRevenueAmount(record.loan_amount) > 0;
  const loanSanctioned =
    !!record.sanction_date ||
    parseRevenueAmount(record.sanction_amount) > 0 ||
    isCompletedStatus(record.sanction_status) ||
    statusMatches(record.loan_status, ["approved", "sanctioned"]);
  const ocrCompleted = !!record.ocr_received_date || parseRevenueAmount(record.ocr_amount) > 0;
  const sdrPaid =
    !!record.sdr_payment_date ||
    parseRevenueAmount(record.sdr_amount) > 0 ||
    isCompletedStatus(record.sdr_status);
  const registrationCompleted =
    !!record.actual_registration_date ||
    !!record.registration_number ||
    isCompletedStatus(record.registration_status);
  const disbursed =
    !!record.actual_disbursement_date ||
    parseRevenueAmount(record.disbursement_amount) > 0 ||
    statusMatches(record.disbursement_status, ["received", "disbursed", "completed"]);

  switch (stage) {
    case "booking":
      return true;
    case "loan_applied":
      return loanApplied;
    case "loan_sanctioned":
      return loanSanctioned;
    case "ocr_completed":
      return ocrCompleted;
    case "sdr_paid":
      return sdrPaid;
    case "registration":
      return registrationCompleted;
    case "disbursement":
      return disbursed;
    case "completed":
      return registrationCompleted && disbursed;
    default:
      return false;
  }
}

export function deriveRevenueStage(record: Record<string, any>): RevenueStageId {
  const ordered: RevenueStageId[] = [
    "completed",
    "disbursement",
    "registration",
    "sdr_paid",
    "ocr_completed",
    "loan_sanctioned",
    "loan_applied",
    "booking",
  ];
  return ordered.find((stage) => recordReachesStage(record, stage)) || "booking";
}

/* ═══════════════════════════ ENRICHMENT ═══════════════════════════ */

export type RevenueRecord = Record<string, any> & {
  agreement_value_number: number;
  expected_revenue: number;

  /** CANONICAL: confirmed developer revenue, cash basis */
  developer_revenue_received: number;
  /** Alias of developer_revenue_received, kept for existing consumers */
  actual_revenue: number;
  /** Recorded but not yet confirmed as received */
  unconfirmed_revenue: number;
  /** Government charges actually collected (pass-through, not revenue) */
  government_charges_received: number;
  /** developer_revenue_received + government_charges_received */
  gross_collection_received: number;
  /** agreement_value − developer_revenue_received, floored at 0 */
  balance_receivable: number;
  /** @deprecated alias of balance_receivable */
  pending_revenue: number;

  /** Value handed over by the ledger view, for drift comparison only */
  ledger_developer_revenue: number | null;
  ledger_drift: number;

  receipt_lines: ReceiptLine[];
  has_unconfirmed_amounts: boolean;
  is_overpaid: boolean;

  collection_efficiency: number;
  booking_completion_percentage: number;
  days_to_registration: number | null;
  days_to_disbursement: number | null;
  days_delayed: number;
  forecast_month: string | null;
  forecast_week: string | null;
  derived_stage: RevenueStageId;
  derived_stage_label: string;
  registration_delay_days: number;
  loan_delay_days: number;
  ocr_delay_days: number;
  sdr_delay_days: number;
  disbursement_delay_days: number;
  sdr_due_date: string | null;
};

export function enrichRevenueRecord(record: Record<string, any>, now = new Date()): RevenueRecord {
  const agreementValue = parseRevenueAmount(record.agreement_value);
  const expectedRevenue = calculateExpectedRevenue(record);

  const receiptLines = buildReceiptLines(record);
  const developerRevenue = receiptLines
    .filter((line) => line.received && !line.isGovernment && !line.suppressed)
    .reduce((total, line) => total + line.amount, 0);
  const unconfirmedRevenue = receiptLines
    .filter((line) => !line.received && !line.isGovernment && !line.suppressed)
    .reduce((total, line) => total + line.amount, 0);
  const governmentCharges = receiptLines
    .filter((line) => line.received && line.isGovernment)
    .reduce((total, line) => total + line.amount, 0);

  const balanceReceivable = Math.max(agreementValue - developerRevenue, 0);
  const isOverpaid = agreementValue > 0 && developerRevenue > agreementValue;

  if (isOverpaid) {
    console.warn(
      `[Revenue] Overpayment on booking ${record.booking_number || record.booking_id}: ` +
      `received ₹${developerRevenue} exceeds agreement ₹${agreementValue}`
    );
  }

  // Config sanity check: both token and booking amount present while token is
  // being suppressed means either a real double-count or lost revenue.
  const tokenLine = receiptLines.find((line) => line.key === "token_amount");
  if (tokenLine?.suppressed && tokenLine.amount > 0) {
    console.warn(
      `[Revenue] Booking ${record.booking_number || record.booking_id} has token_amount ` +
      `₹${tokenLine.amount} excluded by BOOKING_AMOUNT_INCLUDES_TOKEN. ` +
      `Verify the token is genuinely adjusted into booking_amount.`
    );
  }

  // Compare against the ledger view without trusting it.
  const ledgerDeveloperRevenue =
    record.developer_revenue === undefined || record.developer_revenue === null
      ? null
      : parseRevenueAmount(record.developer_revenue);
  const ledgerDrift = ledgerDeveloperRevenue === null ? 0 : ledgerDeveloperRevenue - developerRevenue;

  if (ledgerDeveloperRevenue !== null && Math.abs(ledgerDrift) > 1) {
    console.warn(
      `[Revenue] Ledger drift on booking ${record.booking_number || record.booking_id}: ` +
      `ledger ₹${ledgerDeveloperRevenue} vs computed ₹${developerRevenue} (Δ ₹${ledgerDrift}). ` +
      `The ledger honours reversals; investigate before trusting either figure.`
    );
  }

  const collectionEfficiency =
    agreementValue > 0 ? Math.round((developerRevenue / agreementValue) * 100) : 0;
  const reachedStages = REVENUE_STAGES.filter((stage) => recordReachesStage(record, stage.id)).length;
  const derivedStage = deriveRevenueStage(record);
  const stageLabel = REVENUE_STAGES.find((stage) => stage.id === derivedStage)?.label || "Booking";
  const sdrDueDate = getSdrDueDate(record);
  const bookingDate = record.booking_date || record.application_date || record.created_at;
  const loanTargetDate = addDays(bookingDate, 14);
  const ocrTargetDate = addDays(bookingDate, 7);

  const registrationDelayDays = delayDays(
    record.expected_registration_date,
    record.actual_registration_date,
    now
  );
  const loanDelayDays = recordReachesStage(record, "loan_applied")
    ? delayDays(loanTargetDate, record.sanction_date, now)
    : 0;
  const ocrDelayDays = delayDays(ocrTargetDate, record.ocr_received_date, now);
  const sdrDelayDays = delayDays(sdrDueDate, record.sdr_payment_date, now);
  const disbursementDelayDays = delayDays(
    record.expected_disbursement_date,
    record.actual_disbursement_date,
    now
  );

  return {
    ...record,

    agreement_value_number: agreementValue,
    expected_revenue: expectedRevenue,

    developer_revenue_received: developerRevenue,
    actual_revenue: developerRevenue,
    unconfirmed_revenue: unconfirmedRevenue,
    government_charges_received: governmentCharges,
    gross_collection_received: developerRevenue + governmentCharges,
    balance_receivable: balanceReceivable,
    pending_revenue: balanceReceivable,

    ledger_developer_revenue: ledgerDeveloperRevenue,
    ledger_drift: ledgerDrift,

    receipt_lines: receiptLines,
    has_unconfirmed_amounts: unconfirmedRevenue > 0,
    is_overpaid: isOverpaid,

    collection_efficiency: collectionEfficiency,
    booking_completion_percentage: Math.round((reachedStages / REVENUE_STAGES.length) * 100),
    days_to_registration: daysBetween(bookingDate, record.actual_registration_date),
    days_to_disbursement: daysBetween(bookingDate, record.actual_disbursement_date),
    days_delayed: Math.max(
      registrationDelayDays,
      loanDelayDays,
      ocrDelayDays,
      sdrDelayDays,
      disbursementDelayDays
    ),
    forecast_month: getForecastMonth(record.expected_disbursement_date),
    forecast_week: getForecastWeek(record.expected_disbursement_date),
    derived_stage: derivedStage,
    derived_stage_label: stageLabel,
    registration_delay_days: registrationDelayDays,
    loan_delay_days: loanDelayDays,
    ocr_delay_days: ocrDelayDays,
    sdr_delay_days: sdrDelayDays,
    disbursement_delay_days: disbursementDelayDays,
    sdr_due_date: sdrDueDate,
  };
}

/* ═══════════════════════════ AGGREGATION ═══════════════════════════ */

function average(values: number[]): number {
  const positive = values.filter((value) => value > 0);
  if (!positive.length) return 0;
  return Math.round(positive.reduce((sum, value) => sum + value, 0) / positive.length);
}

function sum(records: RevenueRecord[], selector: (record: RevenueRecord) => number): number {
  return records.reduce((total, record) => total + selector(record), 0);
}

function count(records: RevenueRecord[], predicate: (record: RevenueRecord) => boolean): number {
  return records.reduce((total, record) => total + (predicate(record) ? 1 : 0), 0);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = keyFn(item) || "Unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

function topRecords(
  records: RevenueRecord[],
  predicate: (record: RevenueRecord) => boolean,
  limit = 8
): RevenueRecord[] {
  return records
    .filter(predicate)
    .sort((a, b) =>
      String(a.expected_disbursement_date || a.expected_registration_date || "").localeCompare(
        String(b.expected_disbursement_date || b.expected_registration_date || "")
      )
    )
    .slice(0, limit);
}

/**
 * Cash expected by a future date. Prefers the bank's expected disbursement
 * figure; falls back to the outstanding balance.
 *
 * Note the `??`-safe logic: a fully-collected booking forecasts ZERO, it does
 * not fall through to its full agreement value.
 */
function forecastAmount(record: RevenueRecord): number {
  const expected = parseRevenueAmount(record.expected_disbursement_amount);
  if (expected > 0) return Math.min(expected, record.balance_receivable);
  return record.balance_receivable;
}

export function buildRevenueAnalytics(rawRecords: Record<string, any>[], now = new Date()) {
  const records = rawRecords.map((record) => enrichRevenueRecord(record, now));

  const totalAgreementValue = sum(records, (record) => record.agreement_value_number);
  const revenueReceived = sum(records, (record) => record.developer_revenue_received);
  const unconfirmedRevenue = sum(records, (record) => record.unconfirmed_revenue);
  const governmentChargesReceived = sum(records, (record) => record.government_charges_received);

  // Summed per-record so the KPI card reconciles with the table. Subtracting
  // aggregates would let one overpaid booking mask another's shortfall.
  const balanceReceivable = sum(records, (record) => record.balance_receivable);

  const collectionEfficiency =
    totalAgreementValue > 0 ? Math.round((revenueReceived / totalAgreementValue) * 100) : 0;

  const overpaidBookings = count(records, (record) => record.is_overpaid);
  if (overpaidBookings > 0) {
    console.warn(
      `[Revenue Summary] ${overpaidBookings} booking(s) show receipts exceeding agreement value.`
    );
  }

  const indicators = {
    booking: {
      today: count(records, (record) => isSameDay(record.booking_date || record.created_at, now)),
      this_week: count(records, (record) => isThisWeek(record.booking_date || record.created_at, now)),
      this_month: count(records, (record) => isThisMonth(record.booking_date || record.created_at, now)),
      last_month: count(records, (record) => isLastMonth(record.booking_date || record.created_at, now)),
    },
    registration: {
      due_this_week: count(
        records,
        (record) => !record.actual_registration_date && isThisWeek(record.expected_registration_date, now)
      ),
      completed_this_week: count(records, (record) => isThisWeek(record.actual_registration_date, now)),
      pending: count(
        records,
        (record) => !record.actual_registration_date && !isCompletedStatus(record.registration_status)
      ),
      delayed: count(
        records,
        (record) => !record.actual_registration_date && record.registration_delay_days > 0
      ),
    },
    loan_sanction: {
      pending: count(
        records,
        (record) =>
          recordReachesStage(record, "loan_applied") &&
          !recordReachesStage(record, "loan_sanctioned") &&
          !isRejectedStatus(record.loan_status)
      ),
      approved: count(records, (record) => recordReachesStage(record, "loan_sanctioned")),
      rejected: count(
        records,
        (record) => isRejectedStatus(record.loan_status) || isRejectedStatus(record.sanction_status)
      ),
      processing: count(records, (record) => statusMatches(record.loan_status, ["processing", "in process"])),
    },
    ocr: {
      pending: count(records, (record) => !record.ocr_received_date && parseRevenueAmount(record.ocr_amount) <= 0),
      received: count(records, (record) => recordReachesStage(record, "ocr_completed")),
      this_week: count(records, (record) => isThisWeek(record.ocr_received_date, now)),
      this_month: count(records, (record) => isThisMonth(record.ocr_received_date, now)),
    },
    sdr: {
      pending: count(records, (record) => !recordReachesStage(record, "sdr_paid")),
      completed: count(records, (record) => recordReachesStage(record, "sdr_paid")),
      due_this_week: count(
        records,
        (record) => !recordReachesStage(record, "sdr_paid") && isThisWeek(record.sdr_due_date, now)
      ),
    },
    disbursement: {
      due_this_week: count(
        records,
        (record) => !record.actual_disbursement_date && isThisWeek(record.expected_disbursement_date, now)
      ),
      due_this_month: count(
        records,
        (record) => !record.actual_disbursement_date && isThisMonth(record.expected_disbursement_date, now)
      ),
      received: count(records, (record) => recordReachesStage(record, "disbursement")),
      delayed: count(
        records,
        (record) => !record.actual_disbursement_date && record.disbursement_delay_days > 0
      ),
    },
    cash_component: {
      pending: count(
        records,
        (record) => parseRevenueAmount(record.cash_component) > 0 && !record.cash_component_date
      ),
      received: count(
        records,
        (record) => parseRevenueAmount(record.cash_component) > 0 && !!record.cash_component_date
      ),
      outstanding: sum(records, (record) =>
        record.cash_component_date ? 0 : parseRevenueAmount(record.cash_component)
      ),
    },
    revenue_quality: {
      bookings_with_unconfirmed_amounts: count(records, (record) => record.has_unconfirmed_amounts),
      unconfirmed_revenue: unconfirmedRevenue,
      overpaid_bookings: overpaidBookings,
      bookings_with_ledger_drift: count(records, (record) => Math.abs(record.ledger_drift) > 1),
    },
  };

  const notYetDisbursed = records.filter((record) => !recordReachesStage(record, "disbursement"));

  const forecast = {
    next_7_days: sum(
      notYetDisbursed.filter((record) => isWithinNextDays(record.expected_disbursement_date, 7, now)),
      forecastAmount
    ),
    next_15_days: sum(
      notYetDisbursed.filter((record) => isWithinNextDays(record.expected_disbursement_date, 15, now)),
      forecastAmount
    ),
    next_30_days: sum(
      notYetDisbursed.filter((record) => isWithinNextDays(record.expected_disbursement_date, 30, now)),
      forecastAmount
    ),
    next_90_days: sum(
      notYetDisbursed.filter((record) => isWithinNextDays(record.expected_disbursement_date, 90, now)),
      forecastAmount
    ),
  };

  const pipeline = REVENUE_STAGES.map((stage) => ({
    ...stage,
    count: count(records, (record) => recordReachesStage(record, stage.id)),
    value: sum(
      records.filter((record) => recordReachesStage(record, stage.id)),
      (record) => record.agreement_value_number
    ),
  }));

  const salesManagers = Object.entries(
    groupBy(records, (record) => String(record.sales_manager || record.created_by || "Unassigned"))
  ).map(([name, managerRecords]) => ({
    name,
    bookings: managerRecords.length,
    agreement_value: sum(managerRecords, (record) => record.agreement_value_number),
    revenue_received: sum(managerRecords, (record) => record.developer_revenue_received),
    pending: sum(managerRecords, (record) => record.balance_receivable),
  }));

  const projects = Object.entries(
    groupBy(records, (record) => String(record.project || record.preferred_project || "Unassigned"))
  ).map(([name, projectRecords]) => {
    const uniqueFlats = new Set(
      projectRecords.map(
        (record) => `${record.wing || ""}-${record.floor || record.floor_number || ""}-${record.flat_number || ""}`
      )
    );
    return {
      name,
      total_flats: uniqueFlats.size,
      booked: projectRecords.length,
      available: Math.max(uniqueFlats.size - projectRecords.length, 0),
      registration_pending: count(projectRecords, (record) => !record.actual_registration_date),
      disbursement_pending: count(projectRecords, (record) => !record.actual_disbursement_date),
      revenue_generated: sum(projectRecords, (record) => record.developer_revenue_received),
    };
  });

  const banks = Object.entries(
    groupBy(records.filter((record) => record.bank_name), (record) => String(record.bank_name))
  ).map(([name, bankRecords]) => ({
    name,
    loan_count: bankRecords.length,
    approved: count(bankRecords, (record) => recordReachesStage(record, "loan_sanctioned")),
    pending: count(
      bankRecords,
      (record) => !recordReachesStage(record, "loan_sanctioned") && !isRejectedStatus(record.loan_status)
    ),
    rejected: count(
      bankRecords,
      (record) => isRejectedStatus(record.loan_status) || isRejectedStatus(record.sanction_status)
    ),
    disbursed: count(bankRecords, (record) => recordReachesStage(record, "disbursement")),
    amount_disbursed: sum(bankRecords, (record) => {
      const line = record.receipt_lines.find((l: ReceiptLine) => l.key === "disbursement_amount");
      return line?.received ? line.amount : 0;
    }),
  }));

  const delays = {
    registration_delay: average(records.map((record) => record.registration_delay_days)),
    loan_delay: average(records.map((record) => record.loan_delay_days)),
    ocr_delay: average(records.map((record) => record.ocr_delay_days)),
    sdr_delay: average(records.map((record) => record.sdr_delay_days)),
    disbursement_delay: average(records.map((record) => record.disbursement_delay_days)),
  };

  const upcoming = {
    registration_due: topRecords(
      records,
      (record) => !record.actual_registration_date && isWithinNextDays(record.expected_registration_date, 7, now)
    ),
    loan_followup: topRecords(
      records,
      (record) => recordReachesStage(record, "loan_applied") && !recordReachesStage(record, "loan_sanctioned")
    ),
    ocr_pending: topRecords(records, (record) => !recordReachesStage(record, "ocr_completed")),
    sdr_pending: topRecords(records, (record) => !recordReachesStage(record, "sdr_paid")),
    disbursement_due: topRecords(
      records,
      (record) => !record.actual_disbursement_date && isWithinNextDays(record.expected_disbursement_date, 7, now)
    ),
  };

  const alerts = records
    .flatMap((record) => {
      const items: Array<{
        type: "danger" | "warning" | "success";
        title: string;
        booking_id: number;
        booking_number: string;
        customer_name: string;
        days: number;
      }> = [];
      const bookingNumber = String(record.booking_number || record.booking_id || "");
      const customerName = String(record.customer_name || record.primary_name || "");
      const base = { booking_id: record.booking_id, booking_number: bookingNumber, customer_name: customerName };

      if (!record.actual_registration_date && record.registration_delay_days > 0) {
        items.push({
          type: "danger",
          title: `Registration overdue by ${record.registration_delay_days} days`,
          days: record.registration_delay_days,
          ...base,
        });
      }
      if (!recordReachesStage(record, "ocr_completed") && record.ocr_delay_days > 0) {
        items.push({
          type: "warning",
          title: `OCR pending for ${record.ocr_delay_days} days`,
          days: record.ocr_delay_days,
          ...base,
        });
      }
      if (isSameDay(record.sanction_date, now)) {
        items.push({ type: "success", title: "Loan sanctioned today", days: 0, ...base });
      }
      if (!record.actual_disbursement_date && record.disbursement_delay_days > 0) {
        items.push({
          type: "danger",
          title: `Disbursement delayed by ${record.disbursement_delay_days} days`,
          days: record.disbursement_delay_days,
          ...base,
        });
      }
      if (record.has_unconfirmed_amounts) {
        items.push({
          type: "warning",
          title: `${formatRevenueAmount(record.unconfirmed_revenue)} recorded without a receipt date`,
          days: 0,
          ...base,
        });
      }
      if (record.is_overpaid) {
        items.push({
          type: "danger",
          title: `Receipts exceed agreement value by ${formatRevenueAmount(
            record.developer_revenue_received - record.agreement_value_number
          )}`,
          days: 0,
          ...base,
        });
      }
      return items;
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 20);

  return {
    records,
    summary: {
      total_agreement_value: totalAgreementValue,
      expected_revenue: totalAgreementValue,
      revenue_received: revenueReceived,
      unconfirmed_revenue: unconfirmedRevenue,
      government_charges_received: governmentChargesReceived,
      gross_collection_received: revenueReceived + governmentChargesReceived,
      balance_receivable: balanceReceivable,
      /** @deprecated alias of balance_receivable */
      pending_revenue: balanceReceivable,
      collection_efficiency: collectionEfficiency,
      overpaid_bookings: overpaidBookings,
    },
    indicators,
    forecast,
    pipeline,
    sales_managers: salesManagers,
    delays,
    upcoming,
    projects,
    banks,
    alerts,
  };
}