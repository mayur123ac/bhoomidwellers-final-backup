// bookingQuery.ts — the one definition of "a booking, fully populated".
//
// Why this exists: GET /api/booking-applications joined walkin_enquiries,
// booking_financials, booking_loan_details and booking_registration_details to
// build the shape the UI reads (lead_name, lead_phone, token_amount, ocr_amount,
// stamp_duty_amount, …). POST and PUT returned `SELECT * FROM
// booking_applications` instead — the base table only.
//
// So a booking fetched by GET rendered correctly, and the *same* booking handed
// straight back from a save rendered every joined field as "—", because those
// keys were absent rather than null. sales/page.tsx does
// `setBookingData(booking)` with the save response, which is exactly how a
// freshly saved booking ended up showing a customer's own details as blank.
//
// Both paths now build their response from this module, so the two shapes cannot
// drift apart again.

import { query } from "./db";

/**
 * Everything the booking views read, in one SELECT.
 *
 * `b.*` first so the base columns are always present; the joined aliases follow.
 * Dates are TO_CHAR'd to YYYY-MM-DD because <input type="date"> cannot display a
 * full ISO timestamp — the same normalisation BookingFormModal expects.
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
    LEFT JOIN walkin_enquiries w ON w.id = b.lead_id
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
 */
export async function fetchBookingById(id: number | string): Promise<any | null> {
  const rows = await query(`${BOOKING_SELECT_SQL} WHERE b.id = $1 LIMIT 1`, [Number(id)]);
  return rows[0] ?? null;
}
