// bookingQuery.ts — the read models for a booking.
//
// There are two, and the difference matters:
//
//   BOOKING_LIST_SQL   — summary. Explicit columns, no view joins, no JSON
//                        aggregation. For "which bookings exist" and "does this
//                        lead already have one".
//   BOOKING_SELECT_SQL — detail. The complete booking aggregate. For the screens
//                        that actually render every field.
//
// Why the full one exists at all: GET /api/booking-applications joined
// walkin_enquiries, booking_financials, booking_loan_details and
// booking_registration_details to build the shape the UI reads (lead_name,
// lead_phone, token_amount, ocr_amount, stamp_duty_amount, …). POST and PUT
// returned `SELECT * FROM booking_applications` instead — the base table only.
// So a booking fetched by GET rendered correctly, and the *same* booking handed
// straight back from a save rendered every joined field as "—", because those
// keys were absent rather than null. Both paths build their response from this
// module, so the two shapes cannot drift apart again.
//
// ── What the measurements actually said (2026-08-23, production, 11 bookings) ─
// The heavy joins were NOT the bottleneck, and it is worth writing down so the
// next person does not go hunting in the wrong place:
//
//     round trip to Neon ap-southeast-1 ....... 82 ms
//     BOOKING_SELECT_SQL execution (detail) ... 0.4 ms   (EXPLAIN ANALYZE)
//     BOOKING_SELECT_SQL execution (list, 50) . 0.8 ms
//
// Every query in this file executes in under a millisecond. What cost seconds
// was the NUMBER of round trips per request — chiefly ensureTable(), which ran
// 15 no-op DDL statements before the query even started. The list/detail split
// below is therefore about payload size and about not doing pointless work as
// the table grows; it is not what fixed the 2.7 s load.

import { query } from "./db";

/* ════════════════════════════════════════════════════════════════════════════
   SUMMARY READ MODEL
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * The columns a booking summary needs, and nothing else.
 *
 * Explicit rather than `b.*`: booking_applications has 121 columns, including
 * primary_pan, primary_aadhaar, signature_data and the document URLs. A summary
 * has no business carrying identity documents across the wire.
 *
 * One join only — walkin_enquiries, for the customer's name and phone, which
 * every booking row is labelled with. It keeps the
 * `w.organization_id = b.organization_id` predicate from the full query: the
 * join must not be able to reach across tenants even though the outer WHERE
 * already scopes b.
 *
 * Deliberately absent: loan details, registration details, financial details,
 * customer_ledger_view, booking_total_cost_view, and the custom-charges JSON
 * aggregation. Nothing that consumes the summary reads any of them.
 */
export const BOOKING_LIST_SQL = `
  SELECT b.id,
         b.booking_number,
         b.lead_id,
         b.booking_status,
         TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
         TO_CHAR(b.application_date, 'YYYY-MM-DD') AS application_date,
         b.agreement_value,
         b.booking_amount,
         b.project_name,
         b.apartment_name,
         b.tower,
         b.wing,
         b.property_type,
         b.floor_number,
         b.flat_number,
         b.carpet_area,
         b.primary_name,
         b.primary_mobile,
         b.booking_source,
         b.created_by,
         b.created_at,
         b.updated_at,
         w.name  AS lead_name,
         w.phone AS lead_phone,
         w.sr_no AS lead_sr_no
    FROM booking_applications b
    LEFT JOIN walkin_enquiries w
           ON w.id = b.lead_id AND w.organization_id = b.organization_id
`;

/* ════════════════════════════════════════════════════════════════════════════
   DETAIL READ MODEL
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the booking detail views read, in one SELECT.
 *
 * `b.*` first so the base columns are always present; the joined aliases follow.
 * Dates are TO_CHAR'd to YYYY-MM-DD because <input type="date"> cannot display a
 * full ISO timestamp — the same normalisation BookingFormModal expects.
 *
 * `b.*` is kept HERE, against the general rule, and the reason is worth stating:
 * BookingFormModal is a form over essentially the whole row, and the fields it
 * touches are spread across all 121 columns. Enumerating them would trade a
 * measured cost of zero — this query returns one row, and its execution time is
 * 0.4 ms whether it projects 121 columns or 40 — for a real risk of silently
 * dropping a field the form writes back as undefined. The summary model above is
 * where the explicit column list earns its keep.
 */
export const BOOKING_SELECT_SQL = `
  SELECT b.*,
         TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
         TO_CHAR(b.application_date, 'YYYY-MM-DD') AS application_date,
         TO_CHAR(b.expected_possession_date, 'YYYY-MM-DD') AS expected_possession_date,
         TO_CHAR(b.actual_possession_date, 'YYYY-MM-DD') AS actual_possession_date,
         TO_CHAR(b.oc_cc_date, 'YYYY-MM-DD') AS oc_cc_date,
         w.name AS lead_name, w.phone AS lead_phone, w.email AS lead_email,
         w.address AS lead_address, w.budget AS lead_budget,
         w.configuration AS lead_configuration, w.purpose AS lead_purpose,
         w.source AS lead_source, w.assigned_to AS lead_assigned_to,
         w.assigned_receptionist AS lead_receptionist,
         w.overseeing_site_head AS lead_site_head,
         w.created_at AS lead_created_at, w.enquiry_date AS lead_enquiry_date,
         w.alt_phone AS lead_alt_phone, w.sr_no AS lead_sr_no,
         f.token_amount, f.ocr_amount, TO_CHAR(f.ocr_received_date, 'YYYY-MM-DD') AS ocr_received_date,
         f.ocr_payment_mode, f.ocr_remarks,
         f.sdr_amount, TO_CHAR(f.sdr_payment_date, 'YYYY-MM-DD') AS sdr_payment_date, f.sdr_status, f.sdr_remarks,
         f.cash_component, TO_CHAR(f.cash_component_date, 'YYYY-MM-DD') AS cash_component_date, f.cash_component_remarks,
         l.loan_required, l.bank_name, l.loan_executive, l.loan_type, l.loan_reference_no,
         l.loan_amount, l.sanction_amount, TO_CHAR(l.sanction_date, 'YYYY-MM-DD') AS sanction_date,
         l.sanction_status, l.loan_status,
         TO_CHAR(l.expected_disbursement_date, 'YYYY-MM-DD') AS expected_disbursement_date,
         TO_CHAR(l.actual_disbursement_date, 'YYYY-MM-DD') AS actual_disbursement_date,
         l.expected_disbursement_amount, l.disbursement_amount, l.disbursement_status,
         l.interest_rate, l.loan_tenure_months, TO_CHAR(l.emi_start_date, 'YYYY-MM-DD') AS emi_start_date,
         l.payment_type, l.pre_emi_amount, l.emi_amount,
         TO_CHAR(r.expected_registration_date, 'YYYY-MM-DD') AS expected_registration_date,
         TO_CHAR(r.actual_registration_date, 'YYYY-MM-DD') AS actual_registration_date,
         r.registration_status, r.registration_number, r.registration_remarks,
         r.stamp_duty_rate, r.registration_fee_rate,
         r.stamp_duty_amount, r.stamp_duty_status, TO_CHAR(r.stamp_duty_paid_date, 'YYYY-MM-DD') AS stamp_duty_paid_date,
         r.registration_fee_amount, r.registration_fee_status,
         TO_CHAR(r.registration_fee_paid_date, 'YYYY-MM-DD') AS registration_fee_paid_date,
         COALESCE(
           (SELECT json_agg(json_build_object('charge_name', cc.charge_name, 'amount', cc.amount, 'remarks', cc.remarks))
              FROM booking_custom_charges cc WHERE cc.booking_id = b.id),
           '[]'
         ) AS custom_charges,
         clv.gross_collection AS total_received,
         clv.outstanding_balance AS balance_receivable,
         json_build_object(
           'agreement_value', clv.agreement_value,
           'gross_collection', clv.gross_collection,
           'developer_revenue', clv.developer_revenue,
           'government_charges', clv.government_charges,
           'refunds', clv.refunds,
           'net_collection', clv.net_collection,
           'outstanding_balance', clv.outstanding_balance,
           'total_cost_to_customer', tcv.total_cost_to_customer,
           'stamp_duty', tcv.stamp_duty,
           'registration_fee', tcv.registration_fee,
           'gst_amount', tcv.gst_amount
         ) AS financial_summary
    FROM booking_applications b
    LEFT JOIN walkin_enquiries w
           ON w.id = b.lead_id AND w.organization_id = b.organization_id
    LEFT JOIN booking_financials f ON f.booking_id = b.id
    LEFT JOIN booking_loan_details l ON l.booking_id = b.id
    LEFT JOIN booking_registration_details r ON r.booking_id = b.id
    LEFT JOIN customer_ledger_view clv ON clv.booking_id = b.id
    LEFT JOIN booking_total_cost_view tcv ON tcv.booking_id = b.id
`;

/**
 * One fully-populated booking, or null.
 *
 * Called AFTER the write transaction commits, never inside it: the joined views
 * (customer_ledger_view, booking_total_cost_view) aggregate rows the same
 * transaction has just written, and reading them mid-transaction would return
 * figures that are correct but confusing to reason about. Post-commit it is
 * simply the same read any subsequent GET would perform.
 *
 * @param organizationId pass the caller's already-resolved organization to save
 *        a round trip. Omit it and the tenant is resolved here — correct either
 *        way, but every write path has it in hand already, and at 82 ms per trip
 *        to Neon a redundant resolve is not free.
 */
export async function fetchBookingById(
  id: number | string,
  organizationId?: string,
): Promise<any | null> {
  // The tenant predicate is part of the WHERE, so a booking id from another
  // organization simply matches no row and callers 404 as they would for a
  // nonexistent id. It is NOT optional and never comes from the request.
  const orgId = organizationId ?? (await (await import("./tenantContext")).getOrganizationId());
  const rows = await query(
    `${BOOKING_SELECT_SQL} WHERE b.id = $1 AND b.organization_id = $2 LIMIT 1`,
    [Number(id), orgId],
  );
  return rows[0] ?? null;
}

/**
 * One booking summary, or null. Same tenant rule as above.
 *
 * For callers that need to know a booking EXISTS and what state it is in —
 * duplicate detection, "open the existing booking" links — without paying for
 * the full aggregate.
 */
export async function fetchBookingSummaryById(
  id: number | string,
  organizationId: string,
): Promise<any | null> {
  const rows = await query(
    `${BOOKING_LIST_SQL} WHERE b.id = $1 AND b.organization_id = $2 LIMIT 1`,
    [Number(id), organizationId],
  );
  return rows[0] ?? null;
}
