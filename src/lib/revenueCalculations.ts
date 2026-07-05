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

export type RevenueRecord = Record<string, any> & {
  agreement_value_number: number;
  expected_revenue: number;
  actual_revenue: number;
  pending_revenue: number;
  gross_collection: number;
  developer_revenue: number;
  government_charges: number;
  net_collection: number;
  outstanding_balance: number;
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
  const start = startOfWeek(now);
  const end = endOfWeek(now);
  return date >= start && date <= end;
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
  return keywords.some((keyword) => status.includes(keyword));
}

export function isCompletedStatus(value: unknown): boolean {
  return statusMatches(value, ["completed", "complete", "approved", "sanctioned", "received", "disbursed", "done"]);
}

export function isRejectedStatus(value: unknown): boolean {
  return statusMatches(value, ["rejected", "cancelled", "canceled", "declined"]);
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

export function calculateExpectedRevenue(record: Record<string, any>): number {
  const expectedDisbursement = parseRevenueAmount(record.expected_disbursement_amount);
  if (expectedDisbursement > 0) return expectedDisbursement;

  const sanctionAmount = parseRevenueAmount(record.sanction_amount);
  if (sanctionAmount > 0) return sanctionAmount;

  const loanAmount = parseRevenueAmount(record.loan_amount);
  if (loanAmount > 0) return loanAmount;

  const agreementValue = parseRevenueAmount(record.agreement_value);
  const bookingAmount = parseRevenueAmount(record.booking_amount);
  return Math.max(agreementValue - bookingAmount, 0);
}

export function calculateActualRevenue(record: Record<string, any>): number {
  return parseRevenueAmount(record.disbursement_amount);
}

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

export function enrichRevenueRecord(record: Record<string, any>, now = new Date()): RevenueRecord {
  const agreementValue = parseRevenueAmount(record.agreement_value);
  const expectedRevenue = calculateExpectedRevenue(record);
  const actualRevenue = record.developer_revenue !== undefined ? parseRevenueAmount(record.developer_revenue) : calculateActualRevenue(record);
  const pendingRevenue = record.outstanding_balance !== undefined ? parseRevenueAmount(record.outstanding_balance) : Math.max(expectedRevenue - actualRevenue, 0);
  
  const gross_collection = parseRevenueAmount(record.gross_collection);
  const developer_revenue = parseRevenueAmount(record.developer_revenue);
  const government_charges = parseRevenueAmount(record.government_charges);
  const net_collection = parseRevenueAmount(record.net_collection);
  const outstanding_balance = parseRevenueAmount(record.outstanding_balance);
  
  const collectionEfficiency = agreementValue > 0 ? Math.round((actualRevenue / agreementValue) * 100) : 0;
  const reachedStages = REVENUE_STAGES.filter((stage) => recordReachesStage(record, stage.id)).length;
  const derivedStage = deriveRevenueStage(record);
  const stageLabel = REVENUE_STAGES.find((stage) => stage.id === derivedStage)?.label || "Booking";
  const sdrDueDate = getSdrDueDate(record);
  const bookingDate = record.booking_date || record.application_date || record.created_at;
  const loanTargetDate = addDays(bookingDate, 14);
  const ocrTargetDate = addDays(bookingDate, 7);

  const registrationDelayDays = delayDays(record.expected_registration_date, record.actual_registration_date, now);
  const loanDelayDays = recordReachesStage(record, "loan_applied") ? delayDays(loanTargetDate, record.sanction_date, now) : 0;
  const ocrDelayDays = delayDays(ocrTargetDate, record.ocr_received_date, now);
  const sdrDelayDays = delayDays(sdrDueDate, record.sdr_payment_date, now);
  const disbursementDelayDays = delayDays(record.expected_disbursement_date, record.actual_disbursement_date, now);

  return {
    ...record,
    agreement_value_number: agreementValue,
    expected_revenue: expectedRevenue,
    actual_revenue: actualRevenue,
    pending_revenue: pendingRevenue,
    gross_collection,
    developer_revenue,
    government_charges,
    net_collection,
    outstanding_balance,
    collection_efficiency: collectionEfficiency,
    booking_completion_percentage: Math.round((reachedStages / REVENUE_STAGES.length) * 100),
    days_to_registration: daysBetween(bookingDate, record.actual_registration_date),
    days_to_disbursement: daysBetween(bookingDate, record.actual_disbursement_date),
    days_delayed: Math.max(registrationDelayDays, loanDelayDays, ocrDelayDays, sdrDelayDays, disbursementDelayDays),
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

function topRecords(records: RevenueRecord[], predicate: (record: RevenueRecord) => boolean, limit = 8): RevenueRecord[] {
  return records
    .filter(predicate)
    .sort((a, b) => String(a.expected_disbursement_date || a.expected_registration_date || "").localeCompare(String(b.expected_disbursement_date || b.expected_registration_date || "")))
    .slice(0, limit);
}

export function buildRevenueAnalytics(rawRecords: Record<string, any>[], now = new Date()) {
  const records = rawRecords.map((record) => enrichRevenueRecord(record, now));

  const totalAgreementValue = sum(records, (record) => record.agreement_value_number);
  const recordsDueThisMonth = records.filter((record) => isThisMonth(record.expected_disbursement_date, now));
  const expectedRevenue = sum(recordsDueThisMonth, (record) => record.expected_revenue);
  const revenueReceived = sum(recordsDueThisMonth, (record) => record.actual_revenue);
  const pendingRevenue = Math.max(expectedRevenue - revenueReceived, 0);
  const collectionEfficiency = expectedRevenue > 0 ? Math.round((revenueReceived / expectedRevenue) * 100) : 0;

  const indicators = {
    booking: {
      today: count(records, (record) => isSameDay(record.booking_date || record.created_at, now)),
      this_week: count(records, (record) => isThisWeek(record.booking_date || record.created_at, now)),
      this_month: count(records, (record) => isThisMonth(record.booking_date || record.created_at, now)),
      last_month: count(records, (record) => isLastMonth(record.booking_date || record.created_at, now)),
    },
    registration: {
      due_this_week: count(records, (record) => !record.actual_registration_date && isThisWeek(record.expected_registration_date, now)),
      completed_this_week: count(records, (record) => isThisWeek(record.actual_registration_date, now)),
      pending: count(records, (record) => !record.actual_registration_date && !isCompletedStatus(record.registration_status)),
      delayed: count(records, (record) => !record.actual_registration_date && record.registration_delay_days > 0),
    },
    loan_sanction: {
      pending: count(records, (record) => recordReachesStage(record, "loan_applied") && !recordReachesStage(record, "loan_sanctioned") && !isRejectedStatus(record.loan_status)),
      approved: count(records, (record) => recordReachesStage(record, "loan_sanctioned")),
      rejected: count(records, (record) => isRejectedStatus(record.loan_status) || isRejectedStatus(record.sanction_status)),
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
      due_this_week: count(records, (record) => !recordReachesStage(record, "sdr_paid") && isThisWeek(record.sdr_due_date, now)),
    },
    disbursement: {
      due_this_week: count(records, (record) => !record.actual_disbursement_date && isThisWeek(record.expected_disbursement_date, now)),
      due_this_month: count(records, (record) => !record.actual_disbursement_date && isThisMonth(record.expected_disbursement_date, now)),
      received: count(records, (record) => recordReachesStage(record, "disbursement")),
      delayed: count(records, (record) => !record.actual_disbursement_date && record.disbursement_delay_days > 0),
    },
    cash_component: {
      pending: count(records, (record) => parseRevenueAmount(record.cash_component) > 0 && !record.cash_component_date),
      received: count(records, (record) => parseRevenueAmount(record.cash_component) > 0 && !!record.cash_component_date),
      outstanding: sum(records, (record) => (record.cash_component_date ? 0 : parseRevenueAmount(record.cash_component))),
    },
  };

  const forecast = {
    next_7_days: sum(records.filter((record) => !record.actual_disbursement_date && isWithinNextDays(record.expected_disbursement_date, 7, now)), (record) => record.pending_revenue || record.expected_revenue),
    next_15_days: sum(records.filter((record) => !record.actual_disbursement_date && isWithinNextDays(record.expected_disbursement_date, 15, now)), (record) => record.pending_revenue || record.expected_revenue),
    next_30_days: sum(records.filter((record) => !record.actual_disbursement_date && isWithinNextDays(record.expected_disbursement_date, 30, now)), (record) => record.pending_revenue || record.expected_revenue),
    next_90_days: sum(records.filter((record) => !record.actual_disbursement_date && isWithinNextDays(record.expected_disbursement_date, 90, now)), (record) => record.pending_revenue || record.expected_revenue),
  };

  const pipeline = REVENUE_STAGES.map((stage) => ({
    ...stage,
    count: count(records, (record) => recordReachesStage(record, stage.id)),
    value: sum(records.filter((record) => recordReachesStage(record, stage.id)), (record) => record.agreement_value_number),
  }));

  const salesManagers = Object.entries(groupBy(records, (record) => String(record.sales_manager || record.created_by || "Unassigned"))).map(([name, managerRecords]) => ({
    name,
    bookings: managerRecords.length,
    agreement_value: sum(managerRecords, (record) => record.agreement_value_number),
    revenue_received: sum(managerRecords, (record) => record.actual_revenue),
    pending: sum(managerRecords, (record) => record.pending_revenue),
  }));

  const projects = Object.entries(groupBy(records, (record) => String(record.project || record.preferred_project || "Unassigned"))).map(([name, projectRecords]) => {
    const uniqueFlats = new Set(projectRecords.map((record) => `${record.wing || ""}-${record.floor || record.floor_number || ""}-${record.flat_number || ""}`));
    return {
      name,
      total_flats: uniqueFlats.size,
      booked: projectRecords.length,
      available: Math.max(uniqueFlats.size - projectRecords.length, 0),
      registration_pending: count(projectRecords, (record) => !record.actual_registration_date),
      disbursement_pending: count(projectRecords, (record) => !record.actual_disbursement_date),
      revenue_generated: sum(projectRecords, (record) => record.actual_revenue),
    };
  });

  const banks = Object.entries(groupBy(records.filter((record) => record.bank_name), (record) => String(record.bank_name))).map(([name, bankRecords]) => ({
    name,
    loan_count: bankRecords.length,
    approved: count(bankRecords, (record) => recordReachesStage(record, "loan_sanctioned")),
    pending: count(bankRecords, (record) => !recordReachesStage(record, "loan_sanctioned") && !isRejectedStatus(record.loan_status)),
    rejected: count(bankRecords, (record) => isRejectedStatus(record.loan_status) || isRejectedStatus(record.sanction_status)),
    disbursed: count(bankRecords, (record) => recordReachesStage(record, "disbursement")),
  }));

  const delays = {
    registration_delay: average(records.map((record) => record.registration_delay_days)),
    loan_delay: average(records.map((record) => record.loan_delay_days)),
    ocr_delay: average(records.map((record) => record.ocr_delay_days)),
    sdr_delay: average(records.map((record) => record.sdr_delay_days)),
    disbursement_delay: average(records.map((record) => record.disbursement_delay_days)),
  };

  const upcoming = {
    registration_due: topRecords(records, (record) => !record.actual_registration_date && isWithinNextDays(record.expected_registration_date, 7, now)),
    loan_followup: topRecords(records, (record) => recordReachesStage(record, "loan_applied") && !recordReachesStage(record, "loan_sanctioned")),
    ocr_pending: topRecords(records, (record) => !recordReachesStage(record, "ocr_completed")),
    sdr_pending: topRecords(records, (record) => !recordReachesStage(record, "sdr_paid")),
    disbursement_due: topRecords(records, (record) => !record.actual_disbursement_date && isWithinNextDays(record.expected_disbursement_date, 7, now)),
  };

  const alerts = records
    .flatMap((record) => {
      const items: Array<{ type: "danger" | "warning" | "success"; title: string; booking_id: number; booking_number: string; customer_name: string; days: number }> = [];
      const bookingNumber = String(record.booking_number || record.booking_id || "");
      const customerName = String(record.customer_name || record.primary_name || "");

      if (!record.actual_registration_date && record.registration_delay_days > 0) {
        items.push({ type: "danger", title: `Registration overdue by ${record.registration_delay_days} days`, booking_id: record.booking_id, booking_number: bookingNumber, customer_name: customerName, days: record.registration_delay_days });
      }
      if (!recordReachesStage(record, "ocr_completed") && record.ocr_delay_days > 0) {
        items.push({ type: "warning", title: `OCR pending for ${record.ocr_delay_days} days`, booking_id: record.booking_id, booking_number: bookingNumber, customer_name: customerName, days: record.ocr_delay_days });
      }
      if (isSameDay(record.sanction_date, now)) {
        items.push({ type: "success", title: "Loan sanctioned today", booking_id: record.booking_id, booking_number: bookingNumber, customer_name: customerName, days: 0 });
      }
      if (!record.actual_disbursement_date && record.disbursement_delay_days > 0) {
        items.push({ type: "danger", title: `Disbursement delayed by ${record.disbursement_delay_days} days`, booking_id: record.booking_id, booking_number: bookingNumber, customer_name: customerName, days: record.disbursement_delay_days });
      }
      return items;
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 20);

  return {
    records,
    summary: {
      total_agreement_value: totalAgreementValue,
      expected_revenue: expectedRevenue,
      revenue_received: revenueReceived,
      pending_revenue: pendingRevenue,
      collection_efficiency: collectionEfficiency,
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
