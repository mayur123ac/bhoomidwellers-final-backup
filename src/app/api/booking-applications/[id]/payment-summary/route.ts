// app/api/booking-applications/[id]/payment-summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const LEDGER_TYPE_LABELS: Record<string, string> = {
  token: "Token",
  booking_amount: "Booking Amount",
  ocr: "OCR / Installment",
  cash_component: "Cash Component",
  sdr: "Stamp Duty & Registration (Legacy)",
};

// ─── GET — complete payment picture for a booking ─────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const bookingRows = await query<any>(
      `SELECT
         b.id, b.lead_id, b.agreement_value::numeric AS agreement_value,
         COALESCE(b.gst_rate, 5) AS gst_rate, COALESCE(b.gst_amount, 0) AS gst_amount, COALESCE(b.gst_paid, 0) AS gst_paid, COALESCE(b.gst_status, 'Pending') AS gst_status,
         COALESCE(r.stamp_duty_amount, f.sdr_amount, 0) AS stamp_duty_amount,
         COALESCE(r.stamp_duty_status, f.sdr_status, 'Pending') AS stamp_duty_status,
         COALESCE(r.stamp_duty_paid_date, f.sdr_payment_date) AS stamp_duty_paid_date,
         COALESCE(r.registration_fee_amount, 0) AS registration_fee_amount,
         COALESCE(r.registration_fee_status, 'Pending') AS registration_fee_status,
         COALESCE(l.sanction_amount, 0) AS sanction_amount,
         COALESCE(tcv.total_cost_to_customer, 0) AS total_cost_to_customer,
         COALESCE(tcv.required_own_contribution, 0) AS required_own_contribution,
         COALESCE(tcv.actual_own_contribution, 0) AS actual_own_contribution,
         COALESCE(tcv.total_loan_disbursed, 0) AS total_loan_disbursed,
         COALESCE(clv.outstanding_balance, 0) AS balance_receivable
       FROM booking_applications b
       LEFT JOIN booking_financials f ON f.booking_id = b.id
       LEFT JOIN booking_loan_details l ON l.booking_id = b.id
       LEFT JOIN booking_registration_details r ON r.booking_id = b.id
       LEFT JOIN booking_total_cost_view tcv ON tcv.booking_id = b.id
       LEFT JOIN customer_ledger_view clv ON clv.booking_id = b.id
       WHERE b.id = $1`,
      [Number(id)]
    );
    if (!bookingRows.length) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }
    const b = bookingRows[0];

    const milestoneRows = await query<any>(
      `SELECT milestone_name, demand_amount, paid_amount, status
       FROM booking_payment_milestones WHERE booking_id = $1 ORDER BY milestone_order ASC`,
      [Number(id)]
    );

    const tdsRows = await query<{ total: string }>(
      `SELECT COALESCE(SUM(tds_amount), 0) AS total FROM booking_tds_records WHERE booking_id = $1`,
      [Number(id)]
    );

    const breakdownRows = await query<any>(
      `SELECT fl.transaction_type, fl.amount, fl.transaction_date
       FROM financial_ledger fl
       JOIN financial_accounts fa ON fa.id = fl.account_id
       WHERE fa.booking_id = $1
         AND fl.transaction_direction = 'CREDIT'
         AND fl.status = 'Received'
         AND fl.received_from = 'Customer'
         AND fl.amount > 0
       ORDER BY fl.transaction_date ASC NULLS LAST`,
      [Number(id)]
    );

    let tranches: any[] = [];
    if (b.lead_id) {
      const trancheRows = await query<any>(
        `SELECT t.amount, t.receiving_date, t.status, pm.milestone_name
         FROM disbursement_tranches t
         LEFT JOIN booking_payment_milestones pm ON pm.id = t.milestone_id
         WHERE t.lead_id = $1
         ORDER BY t.created_at ASC`,
        [Number(b.lead_id)]
      );
      tranches = trancheRows.map((t, i) => ({
        tranche: i + 1,
        amount: Number(t.amount) || 0,
        date: t.receiving_date,
        status: t.status,
        milestone: t.milestone_name || null,
      }));
    }

    const gstAmount = Number(b.gst_amount) || 0;
    const gstPaid = Number(b.gst_paid) || 0;
    const requiredOwn = Number(b.required_own_contribution) || 0;
    const paidOwn = Number(b.actual_own_contribution) || 0;
    const sanctioned = Number(b.sanction_amount) || 0;
    const disbursed = Number(b.total_loan_disbursed) || 0;

    return NextResponse.json({
      success: true,
      data: {
        agreement_value: Number(b.agreement_value) || 0,
        gst: {
          rate: Number(b.gst_rate) || 0,
          amount: gstAmount,
          paid: gstPaid,
          pending: gstAmount - gstPaid,
        },
        stamp_duty: {
          amount: Number(b.stamp_duty_amount) || 0,
          status: b.stamp_duty_status,
          paid_date: b.stamp_duty_paid_date,
        },
        registration_fee: {
          amount: Number(b.registration_fee_amount) || 0,
          status: b.registration_fee_status,
        },
        total_cost_to_customer: Number(b.total_cost_to_customer) || 0,
        own_contribution: {
          required: requiredOwn,
          paid: paidOwn,
          pending: requiredOwn - paidOwn,
          breakdown: breakdownRows.map((r) => ({
            type: LEDGER_TYPE_LABELS[r.transaction_type] || r.transaction_type,
            amount: Number(r.amount) || 0,
            date: r.transaction_date,
          })),
        },
        loan: {
          sanctioned,
          disbursed,
          pending_disbursement: sanctioned - disbursed,
          tranches,
        },
        milestones: milestoneRows.map((m) => ({
          name: m.milestone_name,
          demand: Number(m.demand_amount) || 0,
          paid: Number(m.paid_amount) || 0,
          status: m.status,
        })),
        tds_total_deducted: Number(tdsRows[0]?.total) || 0,
        balance_receivable: Number(b.balance_receivable) || 0,
      },
    });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]/payment-summary]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
