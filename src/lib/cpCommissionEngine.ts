// lib/cpCommissionEngine.ts
// Phase 1b — channel partner identity resolution (find-or-create).
//
// Two live intake paths write CP data with different field coverage, so matching
// has to branch on what is actually present rather than assume a phone exists:
//
//   receptionist form  -> source = 'Channel Partner', cp_name + cp_company + cp_phone
//   bulk Excel import  -> source = 'CP',              cp_name only (no phone/company)
//
// Phone is the high-confidence key. Normalized name is the fallback for the bulk
// path and is deliberately lower confidence — see MATCHED_BY logging below, which
// exists so the Phase 1c merge tool can tell the two apart.
//
// Historical free-text CP names are NOT backfilled by anything here; rows written
// before this phase keep channel_partner_id = NULL.

import type { PoolClient } from "pg";

/** Source values that carry real partner identity in cp_name/cp_company/cp_phone. */
const CP_SOURCE_VALUES = ["Channel Partner", "CP"] as const;

/**
 * Every other source (Outdoor, Digital, Reference, ...) also populates cp_name via
 * the bulk sheet importer, but there it holds a sub-source label ("Hoarding",
 * "Social Media", "Customer Ref (Godke)") — not a partner. Those must never reach
 * findOrCreateChannelPartner.
 */
export function isChannelPartnerSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return (CP_SOURCE_VALUES as readonly string[]).includes(source.trim());
}

/**
 * Matching key for partner names. Never used to overwrite a stored display name —
 * the stored name keeps whatever casing/punctuation it was first created with.
 *
 * "Brave Willow Estate.."  -> "brave willow estate"
 * "  SL   HOMES "          -> "sl homes"
 */
export function normalizePartnerName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[!-\/:-@\[-`{-~]+$/, "")
    .trim();
}

/**
 * Normalized names that are field labels or filler, not partner identities.
 *
 * Real case from the sheet data: lead id 112 ("Chittaranjan Panigrahi") had its CP
 * column filled with the literal text "Channel Partner" — the column's own label
 * rather than a partner name. That is operator entry, not a parser header leak
 * (parseLeadSheet already skips row 0), so it has to be rejected here.
 *
 * Matched on the fully normalized key and only exactly, so real names that merely
 * contain a label survive — "NITIN CP" normalizes to "nitin cp" and is kept.
 */
const NON_IDENTIFYING_NAMES = new Set([
  "channel partner",
  "cp",
  "n/a",
  "na",
  "none",
  "nil",
  "-",
  "--",
]);

function isNonIdentifyingName(normalized: string): boolean {
  return NON_IDENTIFYING_NAMES.has(normalized);
}

/**
 * Digits-only, last 10. Returns null below 10 digits so we never force-match on a
 * partial number — legacy data has "+91 8369787919", "8369787919", and junk alike.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}


export interface CommissionPreview {
  bookingId: number;
  channelPartnerId: number;
  cpName: string;
  agreementValue: string;
  commissionRatePercent: string | null;
  gross: string;
  priorCumulative: string;
  cumulativeAfter: string;
  crossed: boolean;
  tdsPercent: number;
  tdsAmount: string;
  netPayable: string;
}

export interface ComputeOptions {
  source?: "auto" | "manual";
  overrideGross?: number | string;
  overrideReason?: string;
}

/**
 * Shared validation + calculation core for both preview and commit paths.
 * Runs every check the original computeCPCommission ran (booking exists, CP
 * attributed, rate set unless overriding, no active duplicate, CP not
 * inactive) so a preview can never show numbers that commit would reject.
 *
 * overrideGross bypasses the agreement_value * rate calc and the
 * CP_RATE_NOT_SET guard — the typed number becomes gross directly. Everything
 * downstream (FY cumulative sum, threshold check, TDS split) runs unchanged,
 * which is the point: an override still counts toward the same partner's FY
 * total as any auto commission would.
 */
async function evaluateCommission(
  client: PoolClient,
  bookingId: number,
  overrideGross?: number | string
): Promise<CommissionPreview> {
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    throw new CPCommissionError(`Invalid booking id: ${bookingId}`, "INVALID_BOOKING_ID", 400);
  }

  const bookingRes = await client.query(
    `SELECT id, booking_number, agreement_value, sourced_by_channel_partner_id
       FROM booking_applications WHERE id = $1`,
    [bookingId]
  );
  if (bookingRes.rows.length === 0) {
    throw new CPCommissionError(`Booking ${bookingId} not found.`, "BOOKING_NOT_FOUND", 404);
  }
  const booking = bookingRes.rows[0];

  if (booking.sourced_by_channel_partner_id === null) {
    throw new CPCommissionError(
      `No CP attributed to this booking — booking ${bookingId} has no sourced_by_channel_partner_id.`,
      "NO_CP_ATTRIBUTED", 400
    );
  }

  if (overrideGross === undefined && (booking.agreement_value === null || Number(booking.agreement_value) <= 0)) {
    throw new CPCommissionError(`Booking ${bookingId} has no agreement value set.`, "NO_AGREEMENT_VALUE", 400);
  }

  const existing = await client.query(
    `SELECT id, status FROM cp_commissions WHERE booking_id = $1 AND status <> 'reversed' ORDER BY id DESC LIMIT 1`,
    [bookingId]
  );
  if (existing.rows.length > 0) {
    throw new CPCommissionError(
      `An active commission already exists for booking ${bookingId} (commission #${existing.rows[0].id}, status "${existing.rows[0].status}"). Reverse it before recomputing.`,
      "COMMISSION_EXISTS", 409
    );
  }

  const cpId = booking.sourced_by_channel_partner_id as number;
  const cpRes = await client.query(
    `SELECT id, name, status, default_commission_rate FROM channel_partners WHERE id = $1`,
    [cpId]
  );
  if (cpRes.rows.length === 0) {
    throw new CPCommissionError(`Channel partner ${cpId} attributed to booking ${bookingId} no longer exists.`, "CP_NOT_FOUND", 404);
  }
  const cp = cpRes.rows[0];

  if (cp.status === "inactive") {
    throw new CPCommissionError(`Channel partner "${cp.name}" (#${cpId}) is inactive.`, "CP_INACTIVE", 400);
  }

  if (overrideGross === undefined && cp.default_commission_rate === null) {
    throw new CPCommissionError(
      `Channel partner has no commission rate set. ("${cp.name}", partner #${cpId}.)`,
      "CP_RATE_NOT_SET", 400
    );
  }

  const grossRes = overrideGross !== undefined
    ? await client.query(`SELECT ROUND($1::numeric, 2) AS gross`, [overrideGross])
    : await client.query(
      `SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS gross`,
      [booking.agreement_value, cp.default_commission_rate]
    );
  const gross: string = grossRes.rows[0].gross;

  // Unchanged from before: sums gross regardless of source, never filtered by
  // commission_source — an override still pushes the partner toward threshold.
  const fy = getFinancialYearWindow();
  const priorRes = await client.query(
    `SELECT COALESCE(SUM(gross_commission_amount), 0) AS prior
       FROM cp_commissions
      WHERE channel_partner_id = $1 AND status <> 'reversed'
        AND created_at >= $2::timestamp AND created_at < $3::timestamp`,
    [cpId, fy.start, fy.end]
  );
  const prior: string = priorRes.rows[0].prior;

  const crossedRes = await client.query(
    `SELECT ($1::numeric + $2::numeric) > $3::numeric AS crossed, ($1::numeric + $2::numeric) AS cumulative`,
    [prior, gross, TDS_THRESHOLD_INR]
  );
  const crossed: boolean = crossedRes.rows[0].crossed;
  const cumulative: string = crossedRes.rows[0].cumulative;
  const tdsPercent = crossed ? TDS_RATE_PERCENT : 0;

  const tdsRes = await client.query(
    `SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS tds,
            $1::numeric - ROUND($1::numeric * $2::numeric / 100, 2) AS net`,
    [gross, tdsPercent]
  );

  return {
    bookingId, channelPartnerId: cpId, cpName: cp.name,
    agreementValue: booking.agreement_value, commissionRatePercent: cp.default_commission_rate,
    gross, priorCumulative: prior, cumulativeAfter: cumulative, crossed,
    tdsPercent, tdsAmount: tdsRes.rows[0].tds, netPayable: tdsRes.rows[0].net,
  };
}

/** Read-only dry run — identical checks and numbers as commit, no INSERT. */
export async function previewCPCommission(
  client: PoolClient, bookingId: number, overrideGross?: number | string
): Promise<CommissionPreview> {
  return evaluateCommission(client, bookingId, overrideGross);
}

/**
 * Preview for a booking that does not exist yet — the booking form needs to show
 * the commission while the user is still filling the form in.
 *
 * Same arithmetic and the same FY threshold query as the commit path, so what the
 * form shows is what gets accrued on save. The booking-specific checks
 * (BOOKING_NOT_FOUND, NO_CP_ATTRIBUTED, COMMISSION_EXISTS) are skipped because
 * there is no booking to check yet — evaluateCommission re-runs all of them for
 * real once the row exists.
 *
 * Gross is still computed by NUMERIC rather than in JS: the form must not show a
 * figure the DB would then round differently.
 */
export async function previewCommissionForPartner(
  client: PoolClient,
  channelPartnerId: number,
  agreementValue: number | string | null,
  overrideGross?: number | string
): Promise<CommissionPreview> {
  const cpRes = await client.query(
    `SELECT id, name, status, default_commission_rate FROM channel_partners WHERE id = $1`,
    [channelPartnerId]
  );
  if (cpRes.rows.length === 0) {
    throw new CPCommissionError(`Channel partner ${channelPartnerId} not found.`, "CP_NOT_FOUND", 404);
  }
  const cp = cpRes.rows[0];

  if (cp.status === "inactive") {
    throw new CPCommissionError(
      `Channel partner "${cp.name}" (#${channelPartnerId}) is inactive.`,
      "CP_INACTIVE", 400
    );
  }

  if (overrideGross === undefined) {
    if (cp.default_commission_rate === null) {
      throw new CPCommissionError(
        `Channel partner has no commission rate set — add one before computing commission. ("${cp.name}", partner #${channelPartnerId}.)`,
        "CP_RATE_NOT_SET", 400
      );
    }
    if (agreementValue === null || Number(agreementValue) <= 0) {
      throw new CPCommissionError(
        `Enter an agreement value to calculate commission.`,
        "NO_AGREEMENT_VALUE", 400
      );
    }
  }

  const grossRes = overrideGross !== undefined
    ? await client.query(`SELECT ROUND($1::numeric, 2) AS gross`, [overrideGross])
    : await client.query(
      `SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS gross`,
      [agreementValue, cp.default_commission_rate]
    );
  const gross: string = grossRes.rows[0].gross;

  // Same FY query as everywhere else — all sources, reversed excluded.
  const fy = getFinancialYearWindow();
  const priorRes = await client.query(
    `SELECT COALESCE(SUM(gross_commission_amount), 0) AS prior
       FROM cp_commissions
      WHERE channel_partner_id = $1 AND status <> 'reversed'
        AND created_at >= $2::timestamp AND created_at < $3::timestamp`,
    [channelPartnerId, fy.start, fy.end]
  );
  const prior: string = priorRes.rows[0].prior;

  const crossedRes = await client.query(
    `SELECT ($1::numeric + $2::numeric) > $3::numeric AS crossed, ($1::numeric + $2::numeric) AS cumulative`,
    [prior, gross, TDS_THRESHOLD_INR]
  );
  const crossed: boolean = crossedRes.rows[0].crossed;
  const tdsPercent = crossed ? TDS_RATE_PERCENT : 0;

  const tdsRes = await client.query(
    `SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS tds,
            $1::numeric - ROUND($1::numeric * $2::numeric / 100, 2) AS net`,
    [gross, tdsPercent]
  );

  return {
    bookingId: 0, // no booking yet
    channelPartnerId, cpName: cp.name,
    agreementValue: agreementValue === null ? null as any : String(agreementValue),
    commissionRatePercent: cp.default_commission_rate,
    gross, priorCumulative: prior, cumulativeAfter: crossedRes.rows[0].cumulative, crossed,
    tdsPercent, tdsAmount: tdsRes.rows[0].tds, netPayable: tdsRes.rows[0].net,
  };
}

export async function computeCPCommission(
  client: PoolClient,
  bookingId: number,
  createdBy: string,
  opts: ComputeOptions = {}
): Promise<CpCommissionRow> {
  const { source = "auto", overrideGross, overrideReason } = opts;

  if (overrideGross !== undefined && !(overrideReason || "").trim()) {
    throw new CPCommissionError(
      "An override reason is required when overriding the gross amount.",
      "OVERRIDE_REASON_REQUIRED", 400
    );
  }

  const p = await evaluateCommission(client, bookingId, overrideGross);

  console.info(
    `[CP] commission booking=${bookingId} cp=${p.channelPartnerId} gross=${p.gross} prior=${p.priorCumulative} cumulative=${p.cumulativeAfter} tds=${p.tdsPercent}% source=${source} override=${overrideGross !== undefined}`
  );

  const inserted = await client.query(
    `INSERT INTO cp_commissions (
        booking_id, channel_partner_id,
        agreement_value, commission_rate_percent, gross_commission_amount,
        tds_percent, tds_amount, net_payable_amount,
        status, due_date, created_by, updated_by,
        commission_source, is_override, override_reason
     ) VALUES (
        $1, $2, $3::numeric, $4::numeric, $5::numeric,
        $6::numeric, $7::numeric, $8::numeric,
        'accrued', NULL, $9, $9,
        $10, $11, $12
     ) RETURNING *`,
    [
      bookingId, p.channelPartnerId,
      // agreement_value and commission_rate_percent are NOT NULL, but the override
      // path deliberately skips the NO_AGREEMENT_VALUE and CP_RATE_NOT_SET guards —
      // so on an override either can legitimately be null here (and is, for every
      // partner that has never had a rate set). Coalescing to 0 records "no rate
      // was used", which is what an override means; passing null through would fail
      // the not-null constraint at INSERT, after validation had already passed.
      p.agreementValue ?? 0,
      p.commissionRatePercent ?? 0,
      p.gross,
      p.tdsPercent, p.tdsAmount, p.netPayable,
      createdBy, source, overrideGross !== undefined, overrideReason?.trim() || null,
    ]
  );

  return inserted.rows[0] as CpCommissionRow;
}
// SQL mirrors of the two normalizers above, applied to the stored column so that
// matching sees rows inserted earlier in the same transaction (important for bulk
// batches, where 26 "Soni Empire" rows must collapse to one partner).
//
// These must stay behaviourally identical to the JS versions. `[[:punct:]]` is the
// Postgres equivalent of the JS trailing-punctuation class used above.
const SQL_NORMALIZED_NAME = `
  btrim(
    regexp_replace(
      lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')),
      '[[:punct:]]+$', ''
    )
  )
`;

const SQL_NORMALIZED_PHONE = `right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10)`;

export type CpMatchedBy = "phone" | "name" | "created";

export interface CpIdentityInput {
  cp_name?: string | null;
  cp_company?: string | null;
  cp_phone?: string | null;
  source?: string | null;
}

export interface CpResolution {
  channelPartnerId: number;
  matchedBy: CpMatchedBy;
  /** How the row was keyed when created — phone-keyed rows are high confidence. */
  createdVia?: "phone" | "name";
}

/**
 * Resolve an enquiry's CP fields to a channel_partners.id, creating the partner if
 * it isn't already known.
 *
 * Returns null (creating nothing) when the source isn't a CP source or when there
 * is neither a usable phone nor a usable name — a partner row with no key at all
 * could never be matched again and would just accumulate as junk.
 *
 * Never overwrites name/company_name on an existing match: the phone is the source
 * of truth for identity, so a later lead carrying a typo or nickname must not
 * silently rewrite the master record.
 *
 * Must be called with the same client/transaction as the enquiry insert.
 */
export async function findOrCreateChannelPartner(
  client: PoolClient,
  input: CpIdentityInput,
  createdBy: string
): Promise<CpResolution | null> {
  // Defence in depth — callers gate on this too, but a mis-wired caller must not
  // be able to turn "Hoarding (KAKA)" into a channel partner.
  if (!isChannelPartnerSource(input.source)) return null;

  const name = (input.cp_name ?? "").trim();
  const company = (input.cp_company ?? "").trim();
  const phoneRaw = (input.cp_phone ?? "").trim();

  const normalizedPhone = normalizePhone(phoneRaw);
  const normalizedName = normalizePartnerName(name);

  // ── Branch 1: usable phone → high-confidence match ────────────────────────
  if (normalizedPhone) {
    const hit = await client.query(
      `SELECT id FROM channel_partners
        WHERE ${SQL_NORMALIZED_PHONE} = $1
        ORDER BY id ASC
        LIMIT 1`,
      [normalizedPhone]
    );

    if (hit.rows.length > 0) {
      const id = hit.rows[0].id as number;
      console.info(`[CP] matched_by=phone id=${id} phone=${normalizedPhone}`);
      return { channelPartnerId: id, matchedBy: "phone" };
    }

    // Phone is the identity here, so a junk name doesn't block creation — but the
    // label must not be stored as if it were the partner's name.
    const displayName = isNonIdentifyingName(normalizedName)
      ? company || "Unnamed CP"
      : name || company || "Unnamed CP";
    if (isNonIdentifyingName(normalizedName)) {
      console.warn(`[CP] non-identifying name "${name}" ignored; storing "${displayName}" (phone-keyed)`);
    }

    const created = await client.query(
      `INSERT INTO channel_partners
         (name, company_name, phone, default_commission_rate, created_by, updated_by)
       VALUES ($1, $2, $3, NULL, $4, $4)
       RETURNING id`,
      [displayName, company || null, phoneRaw || null, createdBy]
    );
    const id = created.rows[0].id as number;
    console.info(`[CP] created id=${id} keyed_by=phone phone=${normalizedPhone} name="${name}"`);
    return { channelPartnerId: id, matchedBy: "created", createdVia: "phone" };
  }

  // ── Branch 2: no usable phone (bulk path) → normalized-name match ─────────
  // With no phone to fall back on, a label like "Channel Partner" is not an
  // identity — creating a partner from it would merge unrelated leads under one
  // meaningless row. Leave channel_partner_id null and let a human attribute it.
  if (!normalizedName || isNonIdentifyingName(normalizedName)) {
    console.warn(
      `[CP] skipped: source="${input.source}" name="${name}" is not a usable partner identity; channel_partner_id left null`
    );
    return null;
  }

  const nameHit = await client.query(
    `SELECT id FROM channel_partners
      WHERE ${SQL_NORMALIZED_NAME} = $1
      ORDER BY id ASC
      LIMIT 1`,
    [normalizedName]
  );

  if (nameHit.rows.length > 0) {
    const id = nameHit.rows[0].id as number;
    console.info(`[CP] matched_by=name id=${id} key="${normalizedName}"`);
    return { channelPartnerId: id, matchedBy: "name" };
  }

  const created = await client.query(
    `INSERT INTO channel_partners
       (name, company_name, phone, default_commission_rate, created_by, updated_by)
     VALUES ($1, $2, NULL, NULL, $3, $3)
     RETURNING id`,
    [name, company || null, createdBy]
  );
  const id = created.rows[0].id as number;
  console.info(`[CP] created id=${id} keyed_by=name key="${normalizedName}" name="${name}"`);
  return { channelPartnerId: id, matchedBy: "created", createdVia: "name" };
}

/**
 * Convenience wrapper for the two enquiry write paths: resolves and returns just
 * the id (or null), swallowing nothing — a DB error still aborts the transaction.
 */
export async function resolveChannelPartnerId(
  client: PoolClient,
  input: CpIdentityInput,
  createdBy: string
): Promise<number | null> {
  const res = await findOrCreateChannelPartner(client, input, createdBy);
  return res ? res.channelPartnerId : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   PHASE 2 — COMMISSION CALCULATION

   Every function below runs inside the caller's existing DB transaction (it
   takes the PoolClient), so a commission write commits or rolls back atomically
   with whatever else the caller is doing.

   ALL MONEY ARITHMETIC IS DONE IN POSTGRES, deliberately. cp_commissions carries
   a CHECK constraint asserting

       tds_amount        = ROUND(gross * tds_percent / 100, 2)
       net_payable_amount = gross - tds_amount

   Computing those in JavaScript means float arithmetic has to agree exactly with
   Postgres NUMERIC arithmetic on every input, forever. It won't — 12345.675 is
   not representable in binary floating point, so JS rounds it down where NUMERIC
   rounds it up, and the INSERT dies on the CHECK. Passing the operands and
   letting NUMERIC do the maths makes the constraint unfailable by construction.
   ══════════════════════════════════════════════════════════════════════════ */

/** Section 194H TDS threshold: no TDS until cumulative FY commission exceeds this. */
export const TDS_THRESHOLD_INR = 20000;

/** TDS rate applied once the FY threshold is crossed. */
export const TDS_RATE_PERCENT = 2;

/** Thrown for every expected business-rule rejection; `status` maps to HTTP. */
export class CPCommissionError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "CPCommissionError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Indian financial year (1 April – 31 March) containing `on`.
 *
 * Returned as plain date strings rather than Date objects on purpose:
 * cp_commissions.created_at is `timestamp without time zone`, so comparing it
 * against a JS Date would drag the server's timezone offset into the boundary
 * and could put an early-April or late-March commission in the wrong FY.
 */
export function getFinancialYearWindow(on: Date = new Date()): {
  start: string;
  end: string;
  label: string;
} {
  const year = on.getFullYear();
  const month = on.getMonth() + 1; // 1-12
  const startYear = month >= 4 ? year : year - 1;
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-04-01`, // exclusive
    label: `FY${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
  };
}

export interface CpCommissionRow {
  id: number;
  booking_id: number;
  channel_partner_id: number;
  agreement_value: string;
  commission_rate_percent: string;
  gross_commission_amount: string;
  tds_percent: string;
  tds_amount: string;
  net_payable_amount: string;
  status: string;
  due_date: string | null;
  paid_date: string | null;
  payment_reference: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecalcOptions {
  /** Recompute from agreement_value at this rate. */
  ratePercent?: number | string;
  /** Or set the gross directly, recorded as an override. */
  grossAmount?: number | string;
  reason?: string;
}

/**
 * Correct an existing commission — an admin fixing a rate a sales manager got
 * wrong, either by re-applying a percentage or by typing the amount outright.
 *
 * Only 'accrued' and 'due' rows can be corrected:
 *   • 'paid'     — the money has already gone out. Silently changing the recorded
 *                  amount would make the ledger disagree with the bank. Needs a
 *                  reversal and a fresh entry, which leaves a trail.
 *   • 'reversed' — history. Rewriting it would erase what was actually reversed.
 *
 * TDS is recomputed against the partner's FY total EXCLUDING this row, so the
 * amount being replaced does not inflate its own threshold check. Other rows are
 * left alone: TDS already charged on earlier commissions is not retroactive, the
 * same rule the accrual path follows.
 */
export async function recalculateCommission(
  client: PoolClient,
  commissionId: number,
  opts: RecalcOptions,
  updatedBy: string
): Promise<CpCommissionRow> {
  const { ratePercent, grossAmount, reason } = opts;

  const hasRate = ratePercent !== undefined && ratePercent !== null && String(ratePercent).trim() !== "";
  const hasAmount = grossAmount !== undefined && grossAmount !== null && String(grossAmount).trim() !== "";

  if (hasRate === hasAmount) {
    throw new CPCommissionError(
      "Provide either a commission rate or a direct amount — not both, and not neither.",
      "INVALID_RECALC_INPUT", 400
    );
  }
  if (hasRate && (Number(ratePercent) < 0 || Number(ratePercent) > 100)) {
    throw new CPCommissionError("Commission rate must be between 0 and 100.", "INVALID_RATE", 400);
  }
  if (hasAmount && Number(grossAmount) < 0) {
    throw new CPCommissionError("Commission amount cannot be negative.", "INVALID_AMOUNT", 400);
  }

  const res = await client.query(
    `SELECT c.*, b.agreement_value AS booking_agreement_value
       FROM cp_commissions c
       LEFT JOIN booking_applications b ON b.id = c.booking_id
      WHERE c.id = $1`,
    [commissionId]
  );
  if (res.rows.length === 0) {
    throw new CPCommissionError(`Commission ${commissionId} not found.`, "COMMISSION_NOT_FOUND", 404);
  }
  const row = res.rows[0];

  if (row.status === "paid") {
    throw new CPCommissionError(
      `Commission #${commissionId} is already paid and cannot be edited — reverse it and record a corrected entry instead.`,
      "ALREADY_PAID", 409
    );
  }
  if (row.status === "reversed") {
    throw new CPCommissionError(
      `Commission #${commissionId} is reversed and is part of the audit trail.`,
      "IS_REVERSED", 409
    );
  }

  // Prefer the booking's current agreement value; fall back to what was stored.
  const agreementValue = row.booking_agreement_value ?? row.agreement_value;
  if (hasRate && (agreementValue === null || Number(agreementValue) <= 0)) {
    throw new CPCommissionError(
      `Booking ${row.booking_id} has no agreement value, so a percentage cannot be applied. Enter the amount directly instead.`,
      "NO_AGREEMENT_VALUE", 400
    );
  }

  const grossRes = hasAmount
    ? await client.query(`SELECT ROUND($1::numeric, 2) AS gross`, [grossAmount])
    : await client.query(
      `SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS gross`,
      [agreementValue, ratePercent]
    );
  const gross: string = grossRes.rows[0].gross;

  // FY cumulative excluding THIS row — otherwise the old amount would count
  // against the new one. Still unfiltered by commission_source.
  const fy = getFinancialYearWindow();
  const priorRes = await client.query(
    `SELECT COALESCE(SUM(gross_commission_amount), 0) AS prior
       FROM cp_commissions
      WHERE channel_partner_id = $1 AND status <> 'reversed' AND id <> $2
        AND created_at >= $3::timestamp AND created_at < $4::timestamp`,
    [row.channel_partner_id, commissionId, fy.start, fy.end]
  );
  const prior: string = priorRes.rows[0].prior;

  const crossedRes = await client.query(
    `SELECT ($1::numeric + $2::numeric) > $3::numeric AS crossed`,
    [prior, gross, TDS_THRESHOLD_INR]
  );
  const tdsPercent = crossedRes.rows[0].crossed ? TDS_RATE_PERCENT : 0;

  console.info(
    `[CP] recalculated commission #${commissionId} ${row.gross_commission_amount} -> ${gross} (${hasRate ? `${ratePercent}%` : "direct amount"}) tds=${tdsPercent}% by ${updatedBy}`
  );

  const updated = await client.query(
    `UPDATE cp_commissions SET
        agreement_value = $2::numeric,
        commission_rate_percent = $3::numeric,
        gross_commission_amount = $4::numeric,
        tds_percent = $5::numeric,
        tds_amount = ROUND($4::numeric * $5::numeric / 100, 2),
        net_payable_amount = $4::numeric - ROUND($4::numeric * $5::numeric / 100, 2),
        is_override = $6,
        override_reason = COALESCE($7, override_reason),
        updated_by = $8
      WHERE id = $1
      RETURNING *`,
    [
      commissionId,
      agreementValue ?? 0,
      hasRate ? ratePercent : (row.commission_rate_percent ?? 0),
      gross,
      tdsPercent,
      hasAmount,
      (reason || "").trim() || null,
      updatedBy,
    ]
  );

  return updated.rows[0] as CpCommissionRow;
}

/**
 * Reverse an accrued/due commission. Never deletes and never writes a second row —
 * the original row is marked reversed so the audit trail stays intact.
 */
export async function reverseCPCommission(
  client: PoolClient,
  bookingId: number,
  reason: string,
  updatedBy: string
): Promise<CpCommissionRow> {
  const trimmedReason = (reason || "").trim();
  if (!trimmedReason) {
    throw new CPCommissionError("A reversal reason is required.", "REASON_REQUIRED", 400);
  }

  // A booking can now hold a whole history of reversed rows plus at most one
  // active one (idx_cp_commissions_booking_active). Target the active row
  // explicitly — selecting by booking_id alone would pick an arbitrary row.
  const res = await client.query(
    `SELECT id, status FROM cp_commissions
      WHERE booking_id = $1 AND status <> 'reversed'
      ORDER BY id DESC
      LIMIT 1`,
    [bookingId]
  );

  if (res.rows.length === 0) {
    // Distinguish "never had one" from "had one, already reversed".
    const anyRow = await client.query(
      `SELECT id FROM cp_commissions WHERE booking_id = $1 ORDER BY id DESC LIMIT 1`,
      [bookingId]
    );
    if (anyRow.rows.length === 0) {
      throw new CPCommissionError(
        `No commission found for booking ${bookingId}.`,
        "COMMISSION_NOT_FOUND",
        404
      );
    }
    throw new CPCommissionError(
      `Commission #${anyRow.rows[0].id} is already reversed.`,
      "ALREADY_REVERSED",
      409
    );
  }

  const current = res.rows[0];

  // A paid commission means money has left the building; auto-reversing it would
  // misstate the ledger against a payment that actually happened.
  if (current.status === "paid") {
    throw new CPCommissionError(
      `Commission #${current.id} is already paid and cannot be auto-reversed — this needs a manual correction entry.`,
      "ALREADY_PAID",
      409
    );
  }

  // Scoped to the single row id, NOT to booking_id: reversing by booking_id would
  // rewrite reversal_reason/reversed_at on every historical reversal too, erasing
  // why each earlier attempt was cancelled.
  const updated = await client.query(
    `UPDATE cp_commissions
        SET status = 'reversed',
            reversal_reason = $2,
            reversed_at = now(),
            updated_by = $3
      WHERE id = $1
      RETURNING *`,
    [current.id, trimmedReason, updatedBy]
  );

  console.info(`[CP] reversed commission #${current.id} booking=${bookingId} reason="${trimmedReason}"`);
  return updated.rows[0] as CpCommissionRow;
}
