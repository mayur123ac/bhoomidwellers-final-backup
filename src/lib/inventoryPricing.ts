// lib/inventoryPricing.ts — Sell.Do-style layered pricing for inventory units.
//
// Sell.Do prices a unit as a stack, not a single number: a base rate per sqft,
// plus a floor-rise premium that grows with height, plus positional premiums
// (corner, park-facing), then parking, then the society charges, then the
// statutory ones (GST, stamp duty, registration). This module is the single
// place that stack is evaluated.
//
// SCOPE NOTE: this is inventory-only. It deliberately does NOT touch
// lib/revenueFormula.ts or lib/gst.ts, which own the *booking's* money. A cost
// sheet here is a quotation for a unit that may never be booked; once a booking
// exists, the booking's own figures are authoritative. Keeping the two apart is
// what stops a quote silently rewriting a signed agreement value.
//
// Every amount is computed in paise-precision decimal via Number and rounded
// only at the end of each line, matching how the figures are displayed.

export interface PriceRule {
  id?: number;
  base_rate_per_sqft: number | string;
  floor_rise_per_sqft: number | string;
  floor_rise_from_floor: number | string;
  floor_rise_max_per_sqft?: number | string | null;
  corner_premium_pct: number | string;
  park_facing_premium_pct: number | string;
  club_fee: number | string;
  corpus_fund: number | string;
  legal_charges: number | string;
  maintenance_deposit: number | string;
  parking_charge_per_slot: number | string;
  gst_rate: number | string;
  stamp_duty_rate: number | string;
  registration_fee: number | string;
}

export interface PricingUnit {
  carpet_area_sqft: number | string | null;
  floor: number | string;
  is_corner?: boolean | null;
  is_park_facing?: boolean | null;
  parking_slots?: number | string | null;
  /** Overrides the rule's base rate when the unit carries its own. */
  rate_per_sqft?: number | string | null;
}

export interface CostSheetLine {
  key: string;
  label: string;
  detail?: string;
  amount: number;
  /** Grouping for the rendered sheet. */
  group: "agreement" | "other" | "statutory" | "discount" | "total";
}

export interface CostSheet {
  carpet_area_sqft: number;
  base_rate_per_sqft: number;
  base_amount: number;
  floor_rise_amount: number;
  corner_premium: number;
  park_premium: number;
  parking_charge: number;
  /** Base + floor rise + premiums + parking. The figure stamp duty and GST apply to. */
  agreement_value: number;

  club_fee: number;
  corpus_fund: number;
  legal_charges: number;
  maintenance_deposit: number;
  other_charges_total: number;

  gst_rate: number;
  gst_amount: number;
  stamp_duty_rate: number;
  stamp_duty_amount: number;
  registration_fee: number;

  discount_amount: number;
  discount_pct: number;
  /** All-in, after discount. */
  total_amount: number;

  lines: CostSheetLine[];
}

const n = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

// Money is rounded to whole rupees per line. Rounding once at the end instead
// would make the printed lines fail to add up to the printed total, which is the
// first thing a customer checks.
const r2 = (v: number): number => Math.round(v * 100) / 100;
const rupee = (v: number): number => Math.round(v);

/**
 * Floor rise, per sqft, for a given floor.
 *
 * Charged only for floors ABOVE `floor_rise_from_floor` — the base rate already
 * covers everything up to it, so charging from floor 0 would double-count the
 * podium levels. Capped when the rule sets a ceiling (towers commonly stop
 * escalating past a certain height).
 */
export function floorRisePerSqft(rule: PriceRule, floor: number): number {
  const per = n(rule.floor_rise_per_sqft);
  if (per <= 0) return 0;
  const from = n(rule.floor_rise_from_floor);
  const above = Math.max(0, floor - from);
  const raw = per * above;
  const cap = rule.floor_rise_max_per_sqft == null ? null : n(rule.floor_rise_max_per_sqft);
  return cap != null && cap > 0 ? Math.min(raw, cap) : raw;
}

/**
 * Build a full cost sheet for a unit under a rule.
 *
 * `discount` is applied to the all-in total, not the agreement value, because a
 * negotiated concession is a reduction in what the customer actually pays. GST
 * and stamp duty are statutory and are computed BEFORE it — discounting them
 * would be misreporting tax.
 */
export function buildCostSheet(
  unit: PricingUnit,
  rule: PriceRule,
  opts?: { discount_amount?: number | string; discount_pct?: number | string },
): CostSheet {
  const carpet = n(unit.carpet_area_sqft);
  const floor = n(unit.floor);

  // A unit's own rate wins over the rule's: bulk stock shares a rule, but a
  // specific flat can be repriced without forking a rule for it.
  const ruleRate = n(rule.base_rate_per_sqft);
  const unitRate = n(unit.rate_per_sqft);
  const baseRate = unitRate > 0 ? unitRate : ruleRate;

  const base_amount = rupee(carpet * baseRate);

  const risePerSqft = floorRisePerSqft(rule, floor);
  const floor_rise_amount = rupee(carpet * risePerSqft);

  // Premiums are a percentage OF the base — not of base+floor-rise — so that
  // raising the floor-rise never silently inflates the corner premium too.
  const corner_premium = unit.is_corner ? rupee(base_amount * (n(rule.corner_premium_pct) / 100)) : 0;
  const park_premium = unit.is_park_facing ? rupee(base_amount * (n(rule.park_facing_premium_pct) / 100)) : 0;

  const slots = n(unit.parking_slots);
  const parking_charge = rupee(slots * n(rule.parking_charge_per_slot));

  const agreement_value = base_amount + floor_rise_amount + corner_premium + park_premium + parking_charge;

  const club_fee = rupee(n(rule.club_fee));
  const corpus_fund = rupee(n(rule.corpus_fund));
  const legal_charges = rupee(n(rule.legal_charges));
  const maintenance_deposit = rupee(n(rule.maintenance_deposit));
  const other_charges_total = club_fee + corpus_fund + legal_charges + maintenance_deposit;

  const gst_rate = n(rule.gst_rate);
  const gst_amount = rupee(agreement_value * (gst_rate / 100));
  const stamp_duty_rate = n(rule.stamp_duty_rate);
  const stamp_duty_amount = rupee(agreement_value * (stamp_duty_rate / 100));
  const registration_fee = rupee(n(rule.registration_fee));

  const grossTotal =
    agreement_value + other_charges_total + gst_amount + stamp_duty_amount + registration_fee;

  // Percentage and absolute discounts are both supported; an explicit amount
  // wins, since that is what a negotiation actually agrees on.
  let discount_amount = rupee(n(opts?.discount_amount));
  const pctIn = n(opts?.discount_pct);
  if (!discount_amount && pctIn > 0) discount_amount = rupee(grossTotal * (pctIn / 100));
  if (discount_amount < 0) discount_amount = 0;
  if (discount_amount > grossTotal) discount_amount = grossTotal;

  const discount_pct = grossTotal > 0 ? r2((discount_amount / grossTotal) * 100) : 0;
  const total_amount = grossTotal - discount_amount;

  const lines: CostSheetLine[] = [
    { key: "base", label: "Base Price", detail: `${carpet.toLocaleString("en-IN")} sq.ft. × ₹${baseRate.toLocaleString("en-IN")}`, amount: base_amount, group: "agreement" },
  ];
  if (floor_rise_amount) lines.push({ key: "floor_rise", label: "Floor Rise", detail: `Floor ${floor} · ₹${risePerSqft.toLocaleString("en-IN")}/sq.ft.`, amount: floor_rise_amount, group: "agreement" });
  if (corner_premium) lines.push({ key: "corner", label: "Corner Premium", detail: `${n(rule.corner_premium_pct)}% of base`, amount: corner_premium, group: "agreement" });
  if (park_premium) lines.push({ key: "park", label: "Park Facing Premium", detail: `${n(rule.park_facing_premium_pct)}% of base`, amount: park_premium, group: "agreement" });
  if (parking_charge) lines.push({ key: "parking", label: "Parking", detail: `${slots} slot${slots === 1 ? "" : "s"}`, amount: parking_charge, group: "agreement" });
  lines.push({ key: "agreement_value", label: "Agreement Value", amount: agreement_value, group: "agreement" });

  if (club_fee) lines.push({ key: "club_fee", label: "Club Membership", amount: club_fee, group: "other" });
  if (corpus_fund) lines.push({ key: "corpus_fund", label: "Corpus Fund", amount: corpus_fund, group: "other" });
  if (legal_charges) lines.push({ key: "legal_charges", label: "Legal Charges", amount: legal_charges, group: "other" });
  if (maintenance_deposit) lines.push({ key: "maintenance_deposit", label: "Maintenance Deposit", amount: maintenance_deposit, group: "other" });

  if (gst_amount) lines.push({ key: "gst", label: "GST", detail: `${gst_rate}% of agreement value`, amount: gst_amount, group: "statutory" });
  if (stamp_duty_amount) lines.push({ key: "stamp_duty", label: "Stamp Duty", detail: `${stamp_duty_rate}% of agreement value`, amount: stamp_duty_amount, group: "statutory" });
  if (registration_fee) lines.push({ key: "registration_fee", label: "Registration Fee", amount: registration_fee, group: "statutory" });

  if (discount_amount) lines.push({ key: "discount", label: "Discount", detail: `${discount_pct}%`, amount: -discount_amount, group: "discount" });
  lines.push({ key: "total", label: "Total Payable", amount: total_amount, group: "total" });

  return {
    carpet_area_sqft: carpet,
    base_rate_per_sqft: baseRate,
    base_amount,
    floor_rise_amount,
    corner_premium,
    park_premium,
    parking_charge,
    agreement_value,
    club_fee,
    corpus_fund,
    legal_charges,
    maintenance_deposit,
    other_charges_total,
    gst_rate,
    gst_amount,
    stamp_duty_rate,
    stamp_duty_amount,
    registration_fee,
    discount_amount,
    discount_pct,
    total_amount,
    lines,
  };
}

/**
 * Which role must sign off a discount of this size.
 *
 * Bands are half-open on the low side (min, max] so an exact 2% lands in the
 * 0-2% band rather than straddling two. Returns null when no band matches, which
 * the caller must treat as "refuse", never as "no approval needed".
 */
export interface DiscountBand {
  id?: number;
  min_discount_pct: number | string;
  max_discount_pct: number | string;
  approver_role: string;
  label?: string | null;
}

export function resolveApprovalBand(bands: DiscountBand[], discountPct: number): DiscountBand | null {
  if (!(discountPct > 0)) return null;
  const sorted = [...bands].sort((a, b) => n(a.max_discount_pct) - n(b.max_discount_pct));
  for (const b of sorted) {
    if (discountPct > n(b.min_discount_pct) && discountPct <= n(b.max_discount_pct)) return b;
  }
  return null;
}
