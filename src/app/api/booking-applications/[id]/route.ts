// app/api/booking-applications/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { uploadBufferToR2 } from "@/lib/r2";

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
      `SELECT b.*, w.name AS lead_name, w.phone AS lead_phone, w.email AS lead_email,
              w.address AS lead_address, w.budget AS lead_budget,
              w.configuration AS lead_configuration, w.purpose AS lead_purpose,
              w.source AS lead_source, w.assigned_to AS lead_assigned_to,
              w.assigned_receptionist AS lead_receptionist,
              w.overseeing_site_head AS lead_site_head,
              w.created_at AS lead_created_at, w.enquiry_date AS lead_enquiry_date,
              w.alt_phone AS lead_alt_phone, w.sr_no AS lead_sr_no,
              f.token_amount, f.ocr_amount, f.ocr_received_date, f.ocr_payment_mode, f.ocr_remarks,
              f.sdr_amount, f.sdr_payment_date, f.sdr_status, f.sdr_remarks,
              f.cash_component, f.cash_component_date, f.cash_component_remarks,
              l.loan_required, l.bank_name, l.loan_executive, l.loan_type, l.loan_reference_no,
              l.loan_amount, l.sanction_amount, l.sanction_date, l.sanction_status, l.loan_status,
              l.expected_disbursement_date, l.actual_disbursement_date,
              l.expected_disbursement_amount, l.disbursement_amount, l.disbursement_status,
              r.expected_registration_date, r.actual_registration_date, r.registration_status,
              r.registration_number, r.registration_remarks,
              COALESCE(
                (SELECT json_agg(json_build_object('charge_name', cc.charge_name, 'amount', cc.amount, 'remarks', cc.remarks))
                 FROM booking_custom_charges cc WHERE cc.booking_id = b.id),
                '[]'
              ) AS custom_charges,
              json_build_object(
               'agreement_value', clv.agreement_value,
               'gross_collection', clv.gross_collection,
               'developer_revenue', clv.developer_revenue,
               'government_charges', clv.government_charges,
               'refunds', clv.refunds,
               'net_collection', clv.net_collection,
               'outstanding_balance', clv.outstanding_balance
             ) AS financial_summary
       FROM booking_applications b
       LEFT JOIN walkin_enquiries w ON w.id = b.lead_id
       LEFT JOIN booking_financials f ON f.booking_id = b.id
       LEFT JOIN booking_loan_details l ON l.booking_id = b.id
       LEFT JOIN booking_registration_details r ON r.booking_id = b.id
       LEFT JOIN customer_ledger_view clv ON clv.booking_id = b.id
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
<<<<<<< HEAD

=======
    
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
    const getStr = (key: string) => (formData.get(key) as string) || "";
    const cleanNum = (val: string) => (val ? parseFloat(val.replace(/,/g, "")) : 0);

    const user_role = getStr("user_role");
    const user_name = getStr("user_name");

    if (!user_role || !user_name) {
<<<<<<< HEAD
      return NextResponse.json({ success: false, message: "user_role and user_name are required" }, { status: 400 });
    }
    if (user_role === "receptionist") {
      return NextResponse.json({ success: false, message: "Receptionists cannot edit bookings." }, { status: 403 });
=======
       return NextResponse.json({ success: false, message: "user_role and user_name are required" }, { status: 400 });
    }
    if (user_role === "receptionist") {
       return NextResponse.json({ success: false, message: "Receptionists cannot edit bookings." }, { status: 403 });
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
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
              TO_CHAR(r.expected_registration_date, 'YYYY-MM-DD') AS expected_registration_date, TO_CHAR(r.actual_registration_date, 'YYYY-MM-DD') AS actual_registration_date, r.registration_status,
              r.registration_number, r.registration_remarks,
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
<<<<<<< HEAD

=======
    
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
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
<<<<<<< HEAD
      apartment_name: getStr("apartment_name"),
      project_name: getStr("project_name"),
      tower: getStr("tower"),
      wing: getStr("wing"),
=======
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
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
      agreement_value: cleanNum(getStr("agreement_value")),
      booking_amount: cleanNum(getStr("booking_amount")),
      booking_remarks: getStr("booking_remarks"),
      internal_notes: getStr("internal_notes"),
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
    };

    const regFields = {
      expected_registration_date: getStr("expected_registration_date") || null,
      actual_registration_date: getStr("actual_registration_date") || null,
      registration_status: getStr("registration_status") || 'Pending',
      registration_number: getStr("registration_number"),
      registration_remarks: getStr("registration_remarks"),
    };

    const changed_fields: Record<string, any> = {};

    function diff(group: any, data: any) {
      for (const [key, newVal] of Object.entries(group)) {
        let oldVal = data[key];
        // handle date formatting to YYYY-MM-DD for comparison if it's a date string
        if (oldVal instanceof Date) {
<<<<<<< HEAD
          oldVal = oldVal.toISOString().split('T')[0];
        } else if (typeof oldVal === 'string' && oldVal.match(/^\d{4}-\d{2}-\d{2}T/)) {
          oldVal = oldVal.split('T')[0];
=======
            oldVal = oldVal.toISOString().split('T')[0];
        } else if (typeof oldVal === 'string' && oldVal.match(/^\d{4}-\d{2}-\d{2}T/)) {
            oldVal = oldVal.split('T')[0];
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
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
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
