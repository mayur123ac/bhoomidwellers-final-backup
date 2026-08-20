// lib/revenueDigest.ts
// Facts the client cannot know, computed once per minute and handed to the
// assistant as settled numbers.
//
// The chat route already receives the filtered booking rows from the browser —
// that covers per-customer questions. This file covers the two things those rows
// can't answer:
//
//   1. MONTHLY REVENUE. A booking row carries one disbursement date, but a
//      booking collects money across many dated receipts. Bucketing by the
//      booking's date would misattribute every instalment to a single month.
//      So months are built from financial_ledger and disbursement_tranches,
//      where each receipt has its own date. Cash basis: undated rows excluded.
//
//   2. CHANNEL PARTNER PAYOUT. A cost, not revenue, and org-wide rather than
//      per-booking. Reversed commissions are excluded, matching the partial
//      unique index on cp_commissions.
//
// ⚠ VERIFY THE MARKED COLUMN NAMES against your DDL before first run. The
// financial_ledger and disbursement_tranches columns are confirmed from the
// payment-summary route; the cp_commissions ones are the likely names and may
// differ in your schema.
import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";

const MONTHS_BACK = 18;
const CACHE_MS = 60_000;

let cache: { at: number; text: string } | null = null;

const n = (v: any) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};

const inr = (v: any) => `₹${Math.round(n(v)).toLocaleString("en-IN")}`;

const monthLabel = (key: string) => {
    const [y, m] = String(key || "").split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

/** Indian financial year containing the given date: April through March. */
function fyOf(date: Date) {
    const y = date.getFullYear();
    const startYear = date.getMonth() + 1 >= 4 ? y : y - 1;
    return { label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`, startYear };
}

function fyOfMonthKey(key: string) {
    const [y, m] = key.split("-").map(Number);
    const startYear = m >= 4 ? y : y - 1;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export async function buildServerDigest(): Promise<string> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.text;

    /* ── monthly customer receipts (OCR stream) ── */
    const ocrMonths = await query<any>(
        `SELECT to_char(fl.transaction_date, 'YYYY-MM') AS month,
            SUM(fl.amount)                          AS amount,
            COUNT(*)                                AS receipts
     FROM financial_ledger fl
     JOIN financial_accounts fa ON fa.id = fl.account_id
     WHERE fl.transaction_direction = 'CREDIT'
       AND fl.status = 'Received'
       AND fl.received_from = 'Customer'
       AND fl.transaction_date IS NOT NULL
       AND fl.transaction_date >= (CURRENT_DATE - INTERVAL '${MONTHS_BACK} months')
     GROUP BY 1
     ORDER BY 1`
    );

    /* ── monthly loan disbursement (bank stream) ── */
    const disbMonths = await query<any>(
        `SELECT to_char(t.receiving_date, 'YYYY-MM') AS month,
            SUM(t.amount)                        AS amount,
            COUNT(*)                             AS tranches
     FROM disbursement_tranches t
     WHERE LOWER(t.status) IN ('completed', 'received')
       AND t.receiving_date IS NOT NULL
       AND t.receiving_date >= (CURRENT_DATE - INTERVAL '${MONTHS_BACK} months')
     GROUP BY 1
     ORDER BY 1`
    );

    /* ── government charges collected (never revenue) ── */
    // ⚠ VERIFY: booking_registration_details column names.
    const govRows = await query<any>(
        `SELECT
       COALESCE(SUM(CASE WHEN r.stamp_duty_status = 'Paid' THEN r.stamp_duty_amount ELSE 0 END), 0)          AS stamp_duty,
       COALESCE(SUM(CASE WHEN r.registration_fee_status = 'Paid' THEN r.registration_fee_amount ELSE 0 END), 0) AS registration_fee,
       COALESCE(SUM(b.gst_paid), 0)                                                                          AS gst
     FROM booking_applications b
     LEFT JOIN booking_registration_details r ON r.booking_id = b.id`
    );

    /* ── channel partner payout, by partner ── */
    // ⚠ VERIFY: cp_commissions column names (gross_commission_amount / tds_amount /
    // net_payable_amount / status / channel_partner_id) and channel_partners.name.
    const cpRows = await query<any>(
        `SELECT COALESCE(cp.name, 'Unattributed')                                                        AS partner,
            COUNT(*)                                                                                 AS bookings,
            COALESCE(SUM(c.gross_commission_amount), 0)                                                    AS gross,
            COALESCE(SUM(c.tds_amount), 0)                                                           AS tds,
            COALESCE(SUM(c.net_payable_amount), 0)                                                           AS net,
            COALESCE(SUM(CASE WHEN LOWER(c.status) = 'paid' THEN c.gross_commission_amount ELSE 0 END), 0)  AS paid,
            COALESCE(SUM(CASE WHEN LOWER(c.status) <> 'paid' THEN c.gross_commission_amount ELSE 0 END), 0) AS committed
     FROM cp_commissions c
     LEFT JOIN channel_partners cp
            ON cp.id = c.channel_partner_id AND cp.organization_id = c.organization_id
     WHERE LOWER(COALESCE(c.status, '')) <> 'reversed'
       AND c.organization_id = $1
     GROUP BY 1
     ORDER BY gross DESC`,
      [await getOrganizationId()]
    );

    /* ── merge the two monthly streams ── */
    const months = new Map<string, { ocr: number; receipts: number; disb: number; tranches: number }>();
    const touch = (k: string) =>
        months.get(k) || months.set(k, { ocr: 0, receipts: 0, disb: 0, tranches: 0 }).get(k)!;

    for (const r of ocrMonths) {
        const m = touch(r.month);
        m.ocr += n(r.amount);
        m.receipts += n(r.receipts);
    }
    for (const r of disbMonths) {
        const m = touch(r.month);
        m.disb += n(r.amount);
        m.tranches += n(r.tranches);
    }

    const ordered = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    /* ── financial-year rollups ── */
    const byFy = new Map<string, { ocr: number; disb: number }>();
    for (const [key, v] of ordered) {
        const fy = fyOfMonthKey(key);
        const acc = byFy.get(fy) || { ocr: 0, disb: 0 };
        acc.ocr += v.ocr;
        acc.disb += v.disb;
        byFy.set(fy, acc);
    }

    const currentFy = fyOf(new Date()).label;
    const thisMonthKey = new Date().toISOString().slice(0, 7);
    const lifetimeOcr = ordered.reduce((s, [, v]) => s + v.ocr, 0);
    const lifetimeDisb = ordered.reduce((s, [, v]) => s + v.disb, 0);

    const gov = govRows[0] || {};
    const govTotal = n(gov.stamp_duty) + n(gov.registration_fee) + n(gov.gst);

    const cpGross = cpRows.reduce((s, r) => s + n(r.gross), 0);
    const cpPaid = cpRows.reduce((s, r) => s + n(r.paid), 0);
    const cpCommitted = cpRows.reduce((s, r) => s + n(r.committed), 0);
    const cpTds = cpRows.reduce((s, r) => s + n(r.tds), 0);
    const cpNet = cpRows.reduce((s, r) => s + n(r.net), 0);

    /* ── render ── */
    const L: string[] = [];

    L.push("MONTHLY COLLECTION — every figure below is already summed from dated receipts. Quote, never recompute.");
    L.push("Two streams: OCR is the buyer's own contribution, disbursement is the bank's. Revenue for a month is the two added.");
    L.push("");
    L.push("  Month | OCR received | Loan disbursed | Total revenue | receipts / tranches");
    for (const [key, v] of ordered) {
        const flag = key === thisMonthKey ? "  ← current month, still open" : "";
        L.push(
            `  ${monthLabel(key)} | ${inr(v.ocr)} | ${inr(v.disb)} | ${inr(v.ocr + v.disb)} | ${v.receipts} / ${v.tranches}${flag}`
        );
    }
    if (!ordered.length) L.push("  (no dated receipts in the last 18 months)");

    L.push("");
    L.push("BY FINANCIAL YEAR (April–March):");
    for (const [fy, v] of [...byFy.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        L.push(
            `  FY ${fy}: OCR ${inr(v.ocr)} + disbursed ${inr(v.disb)} = ${inr(v.ocr + v.disb)}${fy === currentFy ? "  ← current FY, in progress" : ""
            }`
        );
    }
    L.push(`  Last ${MONTHS_BACK} months combined: ${inr(lifetimeOcr + lifetimeDisb)} (OCR ${inr(lifetimeOcr)}, disbursed ${inr(lifetimeDisb)})`);

    L.push("");
    L.push("GOVERNMENT CHARGES COLLECTED — held on the government's behalf, NOT developer revenue. Never add these to a revenue figure:");
    L.push(`  Stamp duty paid: ${inr(gov.stamp_duty)}`);
    L.push(`  Registration fee paid: ${inr(gov.registration_fee)}`);
    L.push(`  GST collected: ${inr(gov.gst)}`);
    L.push(`  Total passed through: ${inr(govTotal)}`);

    L.push("");
    L.push("CHANNEL PARTNER PAYOUT — a cost of sale, deducted from nothing above. Reversed commissions excluded. TDS is Section 194H at 2%, remitted to the government, so net is what reaches the partner:");
    L.push(`  Total commission: ${inr(cpGross)}  (paid out ${inr(cpPaid)}, still committed ${inr(cpCommitted)})`);
    L.push(`  Of the paid amount: ${inr(cpNet)} to partners, ${inr(cpTds)} TDS`);
    L.push(
        `  As a share of collection: ${lifetimeOcr + lifetimeDisb > 0 ? `${((cpPaid / (lifetimeOcr + lifetimeDisb)) * 100).toFixed(1)}%` : "n/a"
        } of the last ${MONTHS_BACK} months' revenue`
    );
    L.push("  Per partner (partner | bookings | gross | paid | committed | TDS):");
    for (const r of cpRows) {
        L.push(
            `    ${r.partner} | ${n(r.bookings)} | ${inr(r.gross)} | ${inr(r.paid)} | ${inr(r.committed)} | ${inr(r.tds)}`
        );
    }
    if (!cpRows.length) L.push("    (no commissions recorded)");

    const text = L.join("\n");
    cache = { at: Date.now(), text };
    return text;
}

/** Call after recording a receipt or commission so the next question sees it. */
export function invalidateServerDigest() {
    cache = null;
}