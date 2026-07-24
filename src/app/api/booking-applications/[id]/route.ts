// app/api/booking-applications/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { uploadBufferToR2 } from "@/lib/r2";
import { syncBookingUnit, releaseUnitForBooking, flatIdentityChanged, parseFloor } from "@/lib/inventorySync";

export const dynamic = "force-dynamic";

// Ensure history table exists
async function ensureHistoryTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS booking_history (
        id SERIAL PRIMARY KEY,
        booking_id INT REFERENCES booking_applications(id) ON DELETE CASCADE,
        updated_by VARCHAR(255) NOT NULL,
        user_role VARCHAR(100) NOT NULL,
        changed_fields JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ─── GET — fetch single booking ───────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rows = await query(
      `SELECT b.*,
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
              f.token_amount, f.ocr_amount, TO_CHAR(f.ocr_received_date, 'YYYY-MM-DD') AS ocr_received_date, f.ocr_payment_mode, f.ocr_remarks,
              f.sdr_amount, TO_CHAR(f.sdr_payment_date, 'YYYY-MM-DD') AS sdr_payment_date, f.sdr_status, f.sdr_remarks,
              f.cash_component, TO_CHAR(f.cash_component_date, 'YYYY-MM-DD') AS cash_component_date, f.cash_component_remarks,
              l.loan_required, l.bank_name, l.loan_executive, l.loan_type, l.loan_reference_no,
              l.loan_amount, l.sanction_amount, TO_CHAR(l.sanction_date, 'YYYY-MM-DD') AS sanction_date, l.sanction_status, l.loan_status,
              TO_CHAR(l.expected_disbursement_date, 'YYYY-MM-DD') AS expected_disbursement_date, TO_CHAR(l.actual_disbursement_date, 'YYYY-MM-DD') AS actual_disbursement_date,
              l.expected_disbursement_amount, l.disbursement_amount, l.disbursement_status,
              l.interest_rate, l.loan_tenure_months, TO_CHAR(l.emi_start_date, 'YYYY-MM-DD') AS emi_start_date, l.payment_type, l.pre_emi_amount, l.emi_amount,
              TO_CHAR(r.expected_registration_date, 'YYYY-MM-DD') AS expected_registration_date, TO_CHAR(r.actual_registration_date, 'YYYY-MM-DD') AS actual_registration_date, r.registration_status,
              r.registration_number, r.registration_remarks,
              r.stamp_duty_amount, TO_CHAR(r.stamp_duty_paid_date, 'YYYY-MM-DD') AS stamp_duty_paid_date, r.stamp_duty_status, r.stamp_duty_payment_mode, r.stamp_duty_receipt_no,
              r.registration_fee_amount, TO_CHAR(r.registration_fee_paid_date, 'YYYY-MM-DD') AS registration_fee_paid_date, r.registration_fee_status, r.registration_fee_payment_mode,
              COALESCE(
                (SELECT json_agg(json_build_object('charge_name', cc.charge_name, 'amount', cc.amount, 'remarks', cc.remarks))
                 FROM booking_custom_charges cc WHERE cc.booking_id = b.id),
                '[]'
              ) AS custom_charges,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', pm.id, 'milestone_name', pm.milestone_name, 'milestone_order', pm.milestone_order,
                  'percentage', pm.percentage, 'demand_amount', pm.demand_amount, 'demand_date', pm.demand_date,
                  'due_date', pm.due_date, 'paid_amount', pm.paid_amount, 'paid_date', pm.paid_date,
                  'status', pm.status, 'remarks', pm.remarks
                ) ORDER BY pm.milestone_order)
                 FROM booking_payment_milestones pm WHERE pm.booking_id = b.id),
                '[]'
              ) AS payment_milestones,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', t.id, 'payment_id', t.payment_id, 'tds_amount', t.tds_amount, 'tds_rate', t.tds_rate,
                  'form_26qb_filed', t.form_26qb_filed, 'form_26qb_date', t.form_26qb_date,
                  'acknowledgement_no', t.acknowledgement_no, 'financial_year', t.financial_year, 'quarter', t.quarter
                ) ORDER BY t.created_at)
                 FROM booking_tds_records t WHERE t.booking_id = b.id),
                '[]'
              ) AS tds_records,
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
               'gst_amount', tcv.gst_amount,
               'required_own_contribution', tcv.required_own_contribution,
               'actual_own_contribution', tcv.actual_own_contribution,
               'total_loan_disbursed', tcv.total_loan_disbursed
             ) AS financial_summary
       FROM booking_applications b
       LEFT JOIN walkin_enquiries w ON w.id = b.lead_id
       LEFT JOIN booking_financials f ON f.booking_id = b.id
       LEFT JOIN booking_loan_details l ON l.booking_id = b.id
       LEFT JOIN booking_registration_details r ON r.booking_id = b.id
       LEFT JOIN customer_ledger_view clv ON clv.booking_id = b.id
       LEFT JOIN booking_total_cost_view tcv ON tcv.booking_id = b.id
       WHERE b.id = $1`,
      [Number(id)]
    );
    if (!rows.length) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications/[id]]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── PUT — update booking ─────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await ensureHistoryTable();
    const formData = await req.formData();

    const getStr = (key: string) => (formData.get(key) as string) || "";
    const cleanNum = (val: string) => (val ? parseFloat(val.replace(/,/g, "")) : 0);

    const user_role = getStr("user_role");
    const user_name = getStr("user_name");

    if (!user_role || !user_name) {
      return NextResponse.json({ success: false, message: "user_role and user_name are required" }, { status: 400 });
    }
    if (user_role === "receptionist") {
      return NextResponse.json({ success: false, message: "Receptionists cannot edit bookings." }, { status: 403 });
    }

    // Check current booking and ownership
    const existing = await query(
      `SELECT b.*, w.assigned_to,
              f.token_amount, f.ocr_amount, TO_CHAR(f.ocr_received_date, 'YYYY-MM-DD') AS ocr_received_date, f.ocr_payment_mode, f.ocr_remarks,
              f.sdr_amount, TO_CHAR(f.sdr_payment_date, 'YYYY-MM-DD') AS sdr_payment_date, f.sdr_status, f.sdr_remarks,
              f.cash_component, TO_CHAR(f.cash_component_date, 'YYYY-MM-DD') AS cash_component_date, f.cash_component_remarks,
              l.loan_required, l.bank_name, l.loan_executive, l.loan_type, l.loan_reference_no,
              l.loan_amount, l.sanction_amount, TO_CHAR(l.sanction_date, 'YYYY-MM-DD') AS sanction_date, l.sanction_status, l.loan_status,
              TO_CHAR(l.expected_disbursement_date, 'YYYY-MM-DD') AS expected_disbursement_date, TO_CHAR(l.actual_disbursement_date, 'YYYY-MM-DD') AS actual_disbursement_date,
              l.expected_disbursement_amount, l.disbursement_amount, l.disbursement_status,
              l.interest_rate, l.loan_tenure_months, TO_CHAR(l.emi_start_date, 'YYYY-MM-DD') AS emi_start_date, l.payment_type, l.pre_emi_amount, l.emi_amount,
              TO_CHAR(r.expected_registration_date, 'YYYY-MM-DD') AS expected_registration_date, TO_CHAR(r.actual_registration_date, 'YYYY-MM-DD') AS actual_registration_date, r.registration_status,
              r.registration_number, r.registration_remarks,
              r.stamp_duty_amount, TO_CHAR(r.stamp_duty_paid_date, 'YYYY-MM-DD') AS stamp_duty_paid_date, r.stamp_duty_status, r.stamp_duty_payment_mode, r.stamp_duty_receipt_no,
              r.registration_fee_amount, TO_CHAR(r.registration_fee_paid_date, 'YYYY-MM-DD') AS registration_fee_paid_date, r.registration_fee_status, r.registration_fee_payment_mode,
              TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date,
              TO_CHAR(b.application_date, 'YYYY-MM-DD') AS application_date
       FROM booking_applications b
       LEFT JOIN walkin_enquiries w ON b.lead_id = w.id
       LEFT JOIN booking_financials f ON f.booking_id = b.id
       LEFT JOIN booking_loan_details l ON l.booking_id = b.id
       LEFT JOIN booking_registration_details r ON r.booking_id = b.id
       WHERE b.id = $1`,
      [Number(id)]
    );
    if (!existing.length) {
      return NextResponse.json({ success: false, message: "Booking not found" }, { status: 404 });
    }

    const currentData = existing[0];
    const currentStatus = currentData.booking_status;

    if (user_role === "sales") {
      if (currentStatus === "Approved") {
        return NextResponse.json(
          { success: false, message: "Booking has been approved and is read-only." },
          { status: 403 }
        );
      }
      if (currentData.assigned_to !== user_name) {
        return NextResponse.json(
          { success: false, message: "Only the assigned Sales Manager can edit this booking." },
          { status: 403 }
        );
      }
    }

    // Helper to upload file if exists
    async function handleUpload(key: string, existingUrl: string) {
      const file = formData.get(key) as File | null;
      if (file && file.size > 0 && typeof file !== "string") {
        const ext = file.name.split('.').pop();
        const buffer = Buffer.from(await file.arrayBuffer());
        return await uploadBufferToR2(`bookings/${id}/${key}_${Date.now()}.${ext}`, buffer, file.type);
      }
      return existingUrl;
    }

    const primary_aadhaar_front_url = await handleUpload("primary_aadhaar_front_file", currentData.primary_aadhaar_front_url);
    const primary_aadhaar_back_url = await handleUpload("primary_aadhaar_back_file", currentData.primary_aadhaar_back_url);
    const primary_pan_url = await handleUpload("primary_pan_file", currentData.primary_pan_url);

    let joint_applicants: any[] = [];
    try { joint_applicants = JSON.parse(getStr("joint_applicants") || "[]"); } catch { }
    let current_joint: any[] = [];
    try { current_joint = typeof currentData.joint_applicants === 'string' ? JSON.parse(currentData.joint_applicants) : currentData.joint_applicants || []; } catch { }

    for (let i = 0; i < joint_applicants.length; i++) {
      const existingJoint = current_joint[i] || {};
      joint_applicants[i].pan_url = await handleUpload(`joint_${i}_pan_file`, existingJoint.pan_url);
      joint_applicants[i].aadhaar_front_url = await handleUpload(`joint_${i}_aadhaar_front_file`, existingJoint.aadhaar_front_url);
      joint_applicants[i].aadhaar_back_url = await handleUpload(`joint_${i}_aadhaar_back_file`, existingJoint.aadhaar_back_url);
    }

    let payment_details: any[] = [];
    try { payment_details = JSON.parse(getStr("payment_details") || "[]"); } catch { }
    let current_payment: any[] = [];
    try { current_payment = typeof currentData.payment_details === 'string' ? JSON.parse(currentData.payment_details) : currentData.payment_details || []; } catch { }

    for (let i = 0; i < payment_details.length; i++) {
      const existingPayment = current_payment[i] || {};
      payment_details[i].attachment_url = await handleUpload(`payment_${i}_attachment_file`, existingPayment.attachment_url);
    }

    // Derived financials — recomputed on every save so they never drift from agreement_value.
    // Explicit client overrides (non-zero) win; otherwise Maharashtra defaults apply.
    const agreementValue = cleanNum(getStr("agreement_value"));
    const gstRate = getStr("gst_rate") ? cleanNum(getStr("gst_rate")) : (Number(currentData.gst_rate) || 5);
    const gstAmount = agreementValue * gstRate / 100;
    const stampDutyInput = cleanNum(getStr("stamp_duty_amount"));
    const stampDutyAmount = stampDutyInput > 0 ? stampDutyInput : agreementValue * 0.05;
    const registrationFeeInput = cleanNum(getStr("registration_fee_amount"));
    const registrationFeeAmount = registrationFeeInput > 0 ? registrationFeeInput : Math.min(agreementValue * 0.01, 30000);

    // Extract all strings
    const fields = {
      primary_name: getStr("primary_name"),
      primary_email: getStr("primary_email"),
      primary_mobile: getStr("primary_mobile"),
      primary_pan: getStr("primary_pan"),
      primary_aadhaar: getStr("primary_aadhaar"),
      primary_occupation: getStr("primary_occupation"),
      primary_nationality: getStr("primary_nationality") || "Indian",
      address: getStr("address"),
      pin: getStr("pin"),
      state: getStr("state"),
      country: getStr("country") || "India",
      apartment_name: getStr("apartment_name"),
      project_name: getStr("project_name"),
      tower: getStr("tower"),
      wing: getStr("wing"),
      property_type: getStr("property_type"),
      floor_number: getStr("floor_number"),
      flat_number: getStr("flat_number"),
      carpet_area: getStr("carpet_area"),
      consideration_value: getStr("consideration_value"),
      consideration_value_words: getStr("consideration_value_words"),
      parking_details: getStr("parking_details"),
      witness_name: getStr("witness_name"),
      witness_aadhaar: getStr("witness_aadhaar"),
      booking_source: getStr("booking_source") || "Direct",
      direct_source: getStr("direct_source"),
      channel_partner_name: getStr("channel_partner_name"),
      channel_partner_contact: getStr("channel_partner_contact"),
      unit_cost: getStr("unit_cost"),
      sdr: getStr("sdr"),
      gst: getStr("gst"),
      booking_date: getStr("booking_date") || null,
      agreement_value: agreementValue,
      booking_amount: cleanNum(getStr("booking_amount")),
      booking_remarks: getStr("booking_remarks"),
      internal_notes: getStr("internal_notes"),
      revenue_include_ocr: getStr("revenue_include_ocr") === "true",
      revenue_include_sdr: getStr("revenue_include_sdr") === "true",
      revenue_include_cash: getStr("revenue_include_cash") === "true",
      revenue_include_sanction: getStr("revenue_include_sanction") === "true",
      revenue_include_disbursement: getStr("revenue_include_disbursement") === "true",
      expected_possession_date: getStr("expected_possession_date") || null,
      actual_possession_date: getStr("actual_possession_date") || null,
      possession_status: getStr("possession_status") || currentData.possession_status || 'Pre-Construction',
      oc_cc_status: getStr("oc_cc_status") || currentData.oc_cc_status || 'Pending',
      oc_cc_date: getStr("oc_cc_date") || null,
      possession_charges: cleanNum(getStr("possession_charges")),
      maintenance_deposit: cleanNum(getStr("maintenance_deposit")),
      legal_charges: cleanNum(getStr("legal_charges")),
      gst_rate: gstRate,
      gst_amount: gstAmount,
      gst_paid: cleanNum(getStr("gst_paid")),
      gst_status: getStr("gst_status") || currentData.gst_status || 'Pending',
      primary_aadhaar_front_url,
      primary_aadhaar_back_url,
      primary_pan_url,
      joint_applicants: JSON.stringify(joint_applicants),
      payment_details: JSON.stringify(payment_details)
    };

    const finFields = {
      token_amount: cleanNum(getStr("token_amount")),
      ocr_amount: cleanNum(getStr("ocr_amount")),
      ocr_received_date: getStr("ocr_received_date") || null,
      ocr_payment_mode: getStr("ocr_payment_mode"),
      ocr_remarks: getStr("ocr_remarks"),
      sdr_amount: cleanNum(getStr("sdr_amount")),
      sdr_payment_date: getStr("sdr_payment_date") || null,
      sdr_status: getStr("sdr_status") || 'Pending',
      sdr_remarks: getStr("sdr_remarks"),
      cash_component: cleanNum(getStr("cash_component")),
      cash_component_date: getStr("cash_component_date") || null,
      cash_component_remarks: getStr("cash_component_remarks"),
    };

    const loanFields = {
      loan_required: getStr("loan_required") === "true",
      bank_name: getStr("bank_name"),
      loan_executive: getStr("loan_executive"),
      loan_type: getStr("loan_type"),
      loan_reference_no: getStr("loan_reference_no"),
      loan_amount: cleanNum(getStr("loan_amount")),
      sanction_amount: cleanNum(getStr("sanction_amount")),
      sanction_date: getStr("sanction_date") || null,
      sanction_status: getStr("sanction_status") || 'Pending',
      loan_status: getStr("loan_status") || 'Pending',
      expected_disbursement_date: getStr("expected_disbursement_date") || null,
      actual_disbursement_date: getStr("actual_disbursement_date") || null,
      expected_disbursement_amount: cleanNum(getStr("expected_disbursement_amount")),
      disbursement_amount: cleanNum(getStr("disbursement_amount")),
      disbursement_status: getStr("disbursement_status") || 'Pending',
      interest_rate: cleanNum(getStr("interest_rate")),
      loan_tenure_months: cleanNum(getStr("loan_tenure_months")),
      emi_start_date: getStr("emi_start_date") || null,
      payment_type: getStr("payment_type") || 'Pre-EMI',
      pre_emi_amount: cleanNum(getStr("pre_emi_amount")),
      emi_amount: cleanNum(getStr("emi_amount")),
    };

    const regFields = {
      expected_registration_date: getStr("expected_registration_date") || null,
      actual_registration_date: getStr("actual_registration_date") || null,
      registration_status: getStr("registration_status") || 'Pending',
      registration_number: getStr("registration_number"),
      registration_remarks: getStr("registration_remarks"),
      stamp_duty_amount: stampDutyAmount,
      stamp_duty_paid_date: getStr("stamp_duty_paid_date") || null,
      stamp_duty_status: getStr("stamp_duty_status") || currentData.stamp_duty_status || 'Pending',
      stamp_duty_payment_mode: getStr("stamp_duty_payment_mode"),
      stamp_duty_receipt_no: getStr("stamp_duty_receipt_no"),
      registration_fee_amount: registrationFeeAmount,
      registration_fee_paid_date: getStr("registration_fee_paid_date") || null,
      registration_fee_status: getStr("registration_fee_status") || currentData.registration_fee_status || 'Pending',
      registration_fee_payment_mode: getStr("registration_fee_payment_mode"),
    };

    const changed_fields: Record<string, any> = {};

    function diff(group: any, data: any) {
      for (const [key, newVal] of Object.entries(group)) {
        let oldVal = data[key];
        // handle date formatting to YYYY-MM-DD for comparison if it's a date string
        if (oldVal instanceof Date) {
          oldVal = oldVal.toISOString().split('T')[0];
        } else if (typeof oldVal === 'string' && oldVal.match(/^\d{4}-\d{2}-\d{2}T/)) {
          oldVal = oldVal.split('T')[0];
        }

        if (typeof newVal === 'object' && newVal !== null) {
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changed_fields[key] = { old_value: oldVal, new_value: newVal };
          }
        } else {
          // Compare strings for loose equality to handle null vs empty string
          if (String(oldVal || "") !== String(newVal || "")) {
            changed_fields[key] = { old_value: oldVal, new_value: newVal };
          }
        }
      }
    }

    diff(fields, currentData);
    diff(finFields, currentData);
    diff(loanFields, currentData);
    diff(regFields, currentData);

    const updatedRow = await transaction(async (client) => {
      // ── Cancellation short-circuit ──
      // A cancel action sends only booking_status; running the normal full-form update
      // below would blank every field the client didn't resend (plus the financial / loan
      // / registration tables). So when a booking is being cancelled we ONLY flip the
      // status and release its inventory unit, then return — skipping the destructive
      // writes. Same transaction, so the release rolls back with the status change.
      const cancelStatus = getStr("booking_status");
      const editCancellation = getStr("edit_cancellation") === "true";
      const cur = currentData.booking_status;
      const isCancelAction = (cancelStatus === "Cancelled" && cur !== "Cancelled");
      const isReactivate = (cancelStatus === "Confirmed" && cur === "Cancelled");
      const isEditCancel = (editCancellation && cur === "Cancelled");

      // Cancellation management (cancel / reactivate / edit-details) is admin-only,
      // enforced here regardless of what the UI shows.
      if ((isCancelAction || isReactivate || isEditCancel) && (user_role || "").trim().toLowerCase() !== "admin") {
        throw Object.assign(new Error("Only Admin can manage booking cancellations."), { httpStatus: 403 });
      }

      // ── (A) Cancel: → Cancelled. Capture reason/remarks + who/when, release the flat.
      // Short-circuit so the destructive full-form update below never runs on a bare cancel.
      if (isCancelAction) {
        const reason = getStr("cancellation_reason") || null;
        const remarks = getStr("cancellation_remarks") || null;
        await client.query(
          `UPDATE booking_applications SET booking_status='Cancelled', cancellation_reason=$2,
             cancellation_remarks=$3, cancelled_by=$4, cancelled_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [Number(id), reason, remarks, user_name],
        );
        await releaseUnitForBooking(client, Number(id), `booking #${id} cancelled`, user_name);
        await client.query(
          `INSERT INTO booking_history (booking_id, updated_by, user_role, changed_fields)
           VALUES ($1, $2, $3, $4)`,
          [Number(id), user_name, user_role, JSON.stringify({ booking_status: { from: cur, to: "Cancelled" }, cancellation_reason: reason })],
        );
        return (await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)])).rows[0];
      }

      // ── (B) Reactivate: Cancelled → Confirmed. Re-book the flat (block if another
      // booking has since taken it), then clear the cancellation metadata.
      if (isReactivate) {
        const p = String(currentData.project_name || "").trim();
        const tw = String(currentData.tower || "").trim();
        const flat = String(currentData.flat_number || "").trim();
        const wg = currentData.wing ? String(currentData.wing).trim() : null;
        const fl = parseFloor(currentData.floor_number);
        if (p && tw && flat && fl !== null) {
          const held = await client.query(
            `SELECT booking_id FROM inventory_units
              WHERE project_name=$1 AND tower=$2 AND COALESCE(wing,'')=COALESCE($3,'')
                AND floor=$4 AND flat_no=$5 AND deleted_at IS NULL LIMIT 1`,
            [p, tw, wg, fl, flat],
          );
          const held0 = held.rows[0];
          if (held0 && held0.booking_id != null && Number(held0.booking_id) !== Number(id)) {
            throw Object.assign(new Error(`Flat ${flat} is now held by booking #${held0.booking_id}. Release that booking before reactivating this one.`), { httpStatus: 409 });
          }
        }
        await syncBookingUnit(client, {
          bookingId: Number(id), leadId: currentData.lead_id, actor: user_name,
          apartment_name: currentData.apartment_name, project_name: currentData.project_name,
          tower: currentData.tower, wing: currentData.wing, property_type: currentData.property_type,
          floor_number: currentData.floor_number, flat_number: currentData.flat_number, carpet_area: currentData.carpet_area,
        });
        await client.query(
          `UPDATE booking_applications SET booking_status='Confirmed', cancellation_reason=NULL,
             cancellation_remarks=NULL, cancelled_by=NULL, cancelled_at=NULL, updated_at=NOW() WHERE id=$1`,
          [Number(id)],
        );
        await client.query(
          `INSERT INTO booking_history (booking_id, updated_by, user_role, changed_fields)
           VALUES ($1, $2, $3, $4)`,
          [Number(id), user_name, user_role, JSON.stringify({ booking_status: { from: "Cancelled", to: "Confirmed" }, action: "reactivated" })],
        );
        return (await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)])).rows[0];
      }

      // ── (C) Edit cancellation metadata (stays Cancelled) ──
      if (isEditCancel) {
        const reason = getStr("cancellation_reason") || null;
        const remarks = getStr("cancellation_remarks") || null;
        await client.query(
          `UPDATE booking_applications SET cancellation_reason=$2, cancellation_remarks=$3, updated_at=NOW() WHERE id=$1`,
          [Number(id), reason, remarks],
        );
        return (await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)])).rows[0];
      }

      // 1. Update Booking Applications
      const baSet: string[] = [];
      const baVals: any[] = [];
      for (const [k, v] of Object.entries(fields)) {
        baVals.push(v);
        baSet.push(`${k} = $${baVals.length}`);
      }
      baSet.push(`updated_at = NOW()`);
      baVals.push(Number(id));
      await client.query(`UPDATE booking_applications SET ${baSet.join(", ")} WHERE id = $${baVals.length}`, baVals);

      // ── Inventory sync: on a flat change, release the previously linked unit and book
      // the newly chosen one (same transaction as the booking write). Cancellation is
      // handled by the short-circuit at the top of this transaction.
      if (flatIdentityChanged(currentData, fields)) {
        await releaseUnitForBooking(client, Number(id), `flat changed on booking #${id}`, user_name);
        await syncBookingUnit(client, {
          bookingId: Number(id),
          leadId: currentData.lead_id,
          actor: user_name,
          apartment_name: fields.apartment_name,
          project_name: fields.project_name,
          tower: fields.tower,
          wing: fields.wing,
          property_type: fields.property_type,
          floor_number: fields.floor_number,
          flat_number: fields.flat_number,
          carpet_area: fields.carpet_area,
        });
      }

      // 2. Update Financials
      const fSet: string[] = [];
      const fVals: any[] = [];
      for (const [k, v] of Object.entries(finFields)) {
        fVals.push(v);
        fSet.push(`${k} = $${fVals.length}`);
      }
      fSet.push(`updated_at = NOW()`);
      fVals.push(Number(id));
      const fRes = await client.query(`UPDATE booking_financials SET ${fSet.join(", ")} WHERE booking_id = $${fVals.length}`, fVals);
      if (fRes.rowCount === 0) {
        const cols = Object.keys(finFields);
        const vals = Object.values(finFields);
        const placeholders = vals.map((_, i) => `$${i + 2}`);
        await client.query(`INSERT INTO booking_financials (booking_id, ${cols.join(", ")}) VALUES ($1, ${placeholders.join(", ")})`, [Number(id), ...vals]);
      }

      // 3. Update Loan Details
      const lSet: string[] = [];
      const lVals: any[] = [];
      for (const [k, v] of Object.entries(loanFields)) {
        lVals.push(v);
        lSet.push(`${k} = $${lVals.length}`);
      }
      lSet.push(`updated_at = NOW()`);
      lVals.push(Number(id));
      const lRes = await client.query(`UPDATE booking_loan_details SET ${lSet.join(", ")} WHERE booking_id = $${lVals.length}`, lVals);
      if (lRes.rowCount === 0) {
        const cols = Object.keys(loanFields);
        const vals = Object.values(loanFields);
        const placeholders = vals.map((_, i) => `$${i + 2}`);
        await client.query(`INSERT INTO booking_loan_details (booking_id, ${cols.join(", ")}) VALUES ($1, ${placeholders.join(", ")})`, [Number(id), ...vals]);
      }

      // 4. Update Registration Details
      const rSet: string[] = [];
      const rVals: any[] = [];
      for (const [k, v] of Object.entries(regFields)) {
        rVals.push(v);
        rSet.push(`${k} = $${rVals.length}`);
      }
      rSet.push(`updated_at = NOW()`);
      rVals.push(Number(id));
      const rRes = await client.query(`UPDATE booking_registration_details SET ${rSet.join(", ")} WHERE booking_id = $${rVals.length}`, rVals);
      if (rRes.rowCount === 0) {
        const cols = Object.keys(regFields);
        const vals = Object.values(regFields);
        const placeholders = vals.map((_, i) => `$${i + 2}`);
        await client.query(`INSERT INTO booking_registration_details (booking_id, ${cols.join(", ")}) VALUES ($1, ${placeholders.join(", ")})`, [Number(id), ...vals]);
      }

      // 4b. Sync to Financial Ledger
      const accountQuery = await client.query(`SELECT id FROM financial_accounts WHERE booking_id = $1`, [Number(id)]);
      let account_id;
      if (accountQuery.rows.length > 0) {
        account_id = accountQuery.rows[0].id;
      } else {
        const accInsert = await client.query(`INSERT INTO financial_accounts (booking_id) VALUES ($1) RETURNING id`, [Number(id)]);
        account_id = accInsert.rows[0].id;
      }

      const upsertLedger = async (type: string, direction: string, amount: number, date: any, affectsRevenue: string, receivedFrom: string, bankName: string | null = null, paymentMode: string | null = null, remarks: string | null = null) => {
        if (amount > 0) {
          await client.query(`
            INSERT INTO financial_ledger (account_id, transaction_type, transaction_direction, amount, transaction_date, status, affects_revenue, received_from, transaction_source, bank_name, payment_mode, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, 'Received', $6, $7, 'UI_Update', $8, $9, $10, $11)
            ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE 
            SET amount = EXCLUDED.amount, transaction_date = EXCLUDED.transaction_date, bank_name = EXCLUDED.bank_name, payment_mode = EXCLUDED.payment_mode, notes = EXCLUDED.notes
          `, [account_id, type, direction, amount, date || new Date(), affectsRevenue, receivedFrom, bankName, paymentMode, remarks, user_name]);
        }
      };

      await upsertLedger('token', 'CREDIT', finFields.token_amount, fields.booking_date, 'NO', 'Customer', null, null, null);
      await upsertLedger('booking_amount', 'CREDIT', fields.booking_amount, fields.booking_date, 'NO', 'Customer', null, null, fields.booking_remarks);
      await upsertLedger('ocr', 'CREDIT', finFields.ocr_amount, finFields.ocr_received_date, 'YES', 'Customer', null, finFields.ocr_payment_mode, finFields.ocr_remarks);
      await upsertLedger('sdr', 'CREDIT', finFields.sdr_amount, finFields.sdr_payment_date, 'NO', 'Customer', null, null, finFields.sdr_remarks);
      await upsertLedger('cash_component', 'CREDIT', finFields.cash_component, finFields.cash_component_date, 'YES', 'Customer', null, null, finFields.cash_component_remarks);
      await upsertLedger('loan_disbursement', 'CREDIT', loanFields.disbursement_amount, loanFields.actual_disbursement_date, 'YES', 'Bank', loanFields.bank_name, null, null);

      // 5. Update Custom Charges
      let custom_charges: any[] = [];
      try { custom_charges = JSON.parse(getStr("custom_charges") || "[]"); } catch { }
      if (custom_charges && custom_charges.length > 0) {
        // Simple replace for custom charges
        await client.query(`DELETE FROM booking_custom_charges WHERE booking_id = $1`, [Number(id)]);
        for (const charge of custom_charges) {
          await client.query(`
            INSERT INTO booking_custom_charges (booking_id, charge_name, amount, remarks)
            VALUES ($1, $2, $3, $4)
          `, [Number(id), charge.charge_name, charge.amount || 0, charge.remarks]);
        }
      }

      if (Object.keys(changed_fields).length > 0) {
        await client.query(
          `INSERT INTO booking_history (booking_id, updated_by, user_role, changed_fields)
           VALUES ($1, $2, $3, $4)`,
          [Number(id), user_name, user_role, JSON.stringify(changed_fields)]
        );
      }

      const rows = await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)]);
      return rows.rows[0];
    });

    return NextResponse.json({ success: true, data: updatedRow }, { status: 200 });
  } catch (err: any) {
    console.error("[PUT /api/booking-applications/[id]]", err);
    // Cancellation-management guards throw with an httpStatus (403 non-admin, 409 flat taken).
    return NextResponse.json({ success: false, message: err.message }, { status: err?.httpStatus || 500 });
  }
}
