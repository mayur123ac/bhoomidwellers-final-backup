/* ══════════════════════════════════════════════════════════════════════════
   cpPayout.ts — channel partner commission as seen from Revenue Intelligence.

   Deliberately NOT part of revenueFormula.ts. Commission is an OUTFLOW: it is
   what the developer spends to acquire the sale, not money received. Folding it
   into the Revenue Received formula would let someone accidentally net it off
   revenue, which would misstate both figures.

   ── Which number is "spent"? ────────────────────────────────────────────────
   GROSS is the cost. Of it, NET goes to the partner and TDS is withheld and
   remitted to the government on the partner's behalf — so gross = net + tds is
   what actually leaves the developer either way.

   ── Cash basis, matching the rest of the dashboard ──────────────────────────
   Only 'paid' commissions count as spent. 'accrued' and 'due' are committed —
   real obligations, but the money has not moved, so they are reported
   separately rather than inflating spend. 'reversed' rows never reach here;
   the API filters them out.
   ══════════════════════════════════════════════════════════════════════════ */

import { parseRevenueAmount } from "./revenueCalculations";

/** Statuses whose money has actually left the business. */
const PAID_STATUSES = ["paid"];
/** Owed but not yet paid. */
const COMMITTED_STATUSES = ["accrued", "due"];

function status(record: any): string {
  return String(record?.cp_commission_status || "").trim().toLowerCase();
}

export function hasCommission(record: any): boolean {
  return !!status(record) && parseRevenueAmount(record?.cp_commission_gross) > 0;
}

export function isCommissionPaid(record: any): boolean {
  return PAID_STATUSES.includes(status(record));
}

export function isCommissionCommitted(record: any): boolean {
  return COMMITTED_STATUSES.includes(status(record));
}

export function commissionGross(record: any): number {
  return parseRevenueAmount(record?.cp_commission_gross);
}

export function commissionNet(record: any): number {
  return parseRevenueAmount(record?.cp_commission_net);
}

export function commissionTds(record: any): number {
  return parseRevenueAmount(record?.cp_commission_tds);
}

const sum = (records: any[], fn: (r: any) => number) =>
  (records || []).reduce((total, record) => total + fn(record), 0);

/** Gross commission on commissions actually paid — the headline spend figure. */
export function sumCommissionPaid(records: any[]): number {
  return sum(records, (r) => (isCommissionPaid(r) ? commissionGross(r) : 0));
}

/** Gross commission accrued or due — owed, but not yet paid out. */
export function sumCommissionCommitted(records: any[]): number {
  return sum(records, (r) => (isCommissionCommitted(r) ? commissionGross(r) : 0));
}

/** Everything not reversed, paid or not. */
export function sumCommissionTotal(records: any[]): number {
  return sum(records, (r) => (hasCommission(r) ? commissionGross(r) : 0));
}

/** Cash that reached partners (gross minus the TDS withheld). */
export function sumCommissionNetPaid(records: any[]): number {
  return sum(records, (r) => (isCommissionPaid(r) ? commissionNet(r) : 0));
}

/** TDS withheld on paid commissions — remitted to the government, not the partner. */
export function sumCommissionTdsPaid(records: any[]): number {
  return sum(records, (r) => (isCommissionPaid(r) ? commissionTds(r) : 0));
}

export function commissionBookingCount(records: any[]): number {
  return (records || []).filter(hasCommission).length;
}

/**
 * Commission as a percentage of revenue actually received.
 *
 * Against REVENUE, not agreement value: it answers "of the money we have
 * collected, how much went to acquiring the sale". Agreement value would
 * understate it early in a booking's life, when little has been collected but
 * the commission may already be paid.
 */
export function commissionCostRatio(commissionSpent: number, revenueReceived: number): number {
  if (revenueReceived <= 0) return 0;
  return Math.round((commissionSpent / revenueReceived) * 1000) / 10;
}

/** Per-partner rollup for the drill-down. */
export function groupCommissionByPartner(records: any[]) {
  const grouped = new Map<string, { name: string; bookings: number; paid: number; committed: number; total: number }>();
  (records || []).filter(hasCommission).forEach((record) => {
    const name = String(record.channel_partner_name || "Unattributed");
    if (!grouped.has(name)) grouped.set(name, { name, bookings: 0, paid: 0, committed: 0, total: 0 });
    const row = grouped.get(name)!;
    row.bookings += 1;
    row.total += commissionGross(record);
    if (isCommissionPaid(record)) row.paid += commissionGross(record);
    if (isCommissionCommitted(record)) row.committed += commissionGross(record);
  });
  return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
}
