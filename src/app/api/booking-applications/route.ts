// app/api/booking-applications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query, transaction } from "@/lib/db";
import { uploadBufferToR2 } from "@/lib/r2";
import { syncBookingUnit } from "@/lib/inventorySync";

export const dynamic = "force-dynamic";

// ─── Auto-create table ────────────────────────────────────────────────────────
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS booking_applications (
      id                        SERIAL PRIMARY KEY,
      booking_number            VARCHAR(30) UNIQUE,
      lead_id                   INTEGER NOT NULL,

      -- Primary Applicant
      primary_name              TEXT,
      primary_email             TEXT,
      primary_mobile            TEXT,
      primary_pan               TEXT,
      primary_aadhaar           TEXT,
      primary_aadhaar_front_url TEXT,
      primary_aadhaar_back_url  TEXT,
      primary_pan_url           TEXT,
      primary_occupation        TEXT,
      primary_nationality       TEXT DEFAULT 'Indian',

      -- Joint Applicant (Legacy fields kept for backward compatibility)
      joint_name                TEXT,
      joint_email               TEXT,
      joint_mobile              TEXT,
      joint_pan                 TEXT,
      joint_occupation          TEXT,
      joint_nationality         TEXT,

      -- Dynamic Joint Applicants array
      joint_applicants          JSONB DEFAULT '[]',

      -- Residence
      address                   TEXT,
      pin                       TEXT,
      state                     TEXT,
      country                   TEXT DEFAULT 'India',

      -- Unit
      property_type             TEXT,
      floor_number              TEXT,
      flat_number               TEXT,
      carpet_area               TEXT,
      consideration_value       TEXT,
      consideration_value_words TEXT,
      parking_details           TEXT,

      -- Payments (JSON array)
      payment_details           JSONB DEFAULT '[]',

      -- Witness
      witness_name              TEXT,
      witness_aadhaar           TEXT,

      -- Booking Source
      booking_source            TEXT DEFAULT 'Direct',
      direct_source             TEXT,
      channel_partner_name      TEXT,
      channel_partner_contact   TEXT,

      -- Unit Summary
      unit_cost                 TEXT,
      sdr                       TEXT,
      gst                       TEXT,

      -- Declaration
      declaration_accepted      BOOLEAN DEFAULT false,
      terms_accepted            BOOLEAN DEFAULT false,
      consent_accepted          BOOLEAN DEFAULT false,

      -- Signature (base64 or URL)
      signature_data            TEXT,

      -- Meta
      application_date          DATE DEFAULT CURRENT_DATE,
      booking_status            TEXT DEFAULT 'Pending',
      created_by                TEXT,
      created_role              TEXT,
      created_at                TIMESTAMPTZ DEFAULT NOW(),
      updated_at                TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Alter booking_applications for new fields
  await query(`
    ALTER TABLE booking_applications 
    ADD COLUMN IF NOT EXISTS booking_date DATE,
    ADD COLUMN IF NOT EXISTS agreement_value NUMERIC,
    ADD COLUMN IF NOT EXISTS booking_amount NUMERIC,
    ADD COLUMN IF NOT EXISTS booking_remarks TEXT,
    ADD COLUMN IF NOT EXISTS internal_notes TEXT;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS booking_financials (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
      token_amount NUMERIC,
      ocr_amount NUMERIC,
      ocr_received_date DATE,
      sdr_amount NUMERIC,
      sdr_payment_date DATE,
      cash_component NUMERIC,
      cash_component_remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE booking_financials
      ADD COLUMN IF NOT EXISTS ocr_payment_mode TEXT,
      ADD COLUMN IF NOT EXISTS ocr_remarks TEXT,
      ADD COLUMN IF NOT EXISTS sdr_status TEXT DEFAULT 'Pending',
      ADD COLUMN IF NOT EXISTS sdr_remarks TEXT,
      ADD COLUMN IF NOT EXISTS cash_component_date DATE;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS booking_loan_details (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
      loan_required BOOLEAN DEFAULT false,
      bank_name TEXT,
      loan_executive TEXT,
      loan_amount NUMERIC,
      sanction_amount NUMERIC,
      sanction_date DATE,
      loan_status TEXT DEFAULT 'Pending',
      expected_disbursement_date DATE,
      actual_disbursement_date DATE,
      expected_disbursement_amount NUMERIC,
      disbursement_amount NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE booking_loan_details
      ADD COLUMN IF NOT EXISTS loan_type TEXT,
      ADD COLUMN IF NOT EXISTS loan_reference_no TEXT,
      ADD COLUMN IF NOT EXISTS sanction_status TEXT DEFAULT 'Pending',
      ADD COLUMN IF NOT EXISTS disbursement_status TEXT DEFAULT 'Pending';
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS booking_registration_details (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
      expected_registration_date DATE,
      actual_registration_date DATE,
      registration_number TEXT,
      registration_remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE booking_registration_details
      ADD COLUMN IF NOT EXISTS registration_status TEXT DEFAULT 'Pending';
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS booking_custom_charges (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
      charge_name TEXT,
      amount NUMERIC,
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS booking_pipeline (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER UNIQUE REFERENCES booking_applications(id) ON DELETE CASCADE,
      current_stage TEXT DEFAULT 'Booking',
      status TEXT DEFAULT 'Active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS booking_stage_history (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER REFERENCES booking_applications(id) ON DELETE CASCADE,
      stage_name TEXT,
      employee_name TEXT,
      remarks TEXT,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS financial_accounts (
      id SERIAL PRIMARY KEY,
      booking_id INT UNIQUE REFERENCES booking_applications(id) ON DELETE CASCADE,
      account_type VARCHAR(50) DEFAULT 'customer_receivable',
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS financial_ledger (
      id SERIAL PRIMARY KEY,
      account_id INT REFERENCES financial_accounts(id) ON DELETE CASCADE,
      transaction_type VARCHAR(100),
      transaction_direction VARCHAR(20),
      amount NUMERIC,
      transaction_date TIMESTAMP,
      bank_name VARCHAR(255),
      payment_mode VARCHAR(100),
      reference_number VARCHAR(255),
      status VARCHAR(50),
      affects_revenue VARCHAR(10),
      received_from VARCHAR(100),
      transaction_source VARCHAR(100),
      notes TEXT,
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (account_id, transaction_type, transaction_source)
    );
  `);

  await query(`
    CREATE OR REPLACE VIEW customer_ledger_view AS
    SELECT 
      fa.booking_id,
      fa.id as account_id,
      ba.agreement_value::numeric AS agreement_value,
      COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received'), 0) AS gross_collection,
      COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received' AND fl.affects_revenue = 'YES'), 0) AS developer_revenue,
      COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received' AND fl.affects_revenue = 'NO'), 0) AS government_charges,
      COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'DEBIT' AND fl.transaction_type = 'refund' AND fl.status = 'Refunded'), 0) AS refunds,
      (
        COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received'), 0) 
        - 
        COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'DEBIT' AND fl.transaction_type = 'refund' AND fl.status = 'Refunded'), 0)
      ) AS net_collection,
      (
        ba.agreement_value::numeric 
        - 
        COALESCE(SUM(fl.amount) FILTER (WHERE fl.transaction_direction = 'CREDIT' AND fl.status = 'Received' AND fl.affects_revenue = 'YES'), 0)
      ) AS outstanding_balance
    FROM financial_accounts fa
    JOIN booking_applications ba ON ba.id = fa.booking_id
    LEFT JOIN financial_ledger fl ON fl.account_id = fa.id
    GROUP BY fa.booking_id, fa.id, ba.agreement_value;
  `);
}


// ─── GET — fetch bookings ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("lead_id");
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);

    let sql = `
      SELECT b.*, w.name AS lead_name, w.phone AS lead_phone, w.email AS lead_email,
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
             l.interest_rate, l.loan_tenure_months, TO_CHAR(l.emi_start_date, 'YYYY-MM-DD') AS emi_start_date,
             l.payment_type, l.pre_emi_amount, l.emi_amount,
             r.expected_registration_date, r.actual_registration_date, r.registration_status,
             r.registration_number, r.registration_remarks,
             r.stamp_duty_amount, r.stamp_duty_status, r.stamp_duty_paid_date,
             r.registration_fee_amount, r.registration_fee_status, r.registration_fee_paid_date,
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
    const params: any[] = [];
    if (leadId) {
      sql += ` WHERE b.lead_id = $1`;
      params.push(Number(leadId));
    }
    sql += ` ORDER BY b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const rows = await query(sql, params);
    return NextResponse.json({ success: true, data: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/booking-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ─── POST — create booking ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const formData = await req.formData();
    const getStr = (key: string) => (formData.get(key) as string) || null;
    const getFile = (key: string) => (formData.get(key) as File) || null;

    const lead_id = getStr("lead_id");
    if (!lead_id) return NextResponse.json({ success: false, message: "lead_id is required" }, { status: 400 });

    // Strip commas/₹ before inserting into NUMERIC columns (form sends "50,00,000" style strings)
    const cleanNum = (val: string | null): number => {
      if (!val) return 0;
      const n = parseFloat(val.replace(/[₹,\s]/g, ""));
      return isNaN(n) ? 0 : n;
    };

    const primary_name = getStr("primary_name");
    const primary_email = getStr("primary_email");
    const primary_mobile = getStr("primary_mobile");
    const primary_pan = getStr("primary_pan");
    const primary_aadhaar = getStr("primary_aadhaar");
    const primary_occupation = getStr("primary_occupation");
    const primary_nationality = getStr("primary_nationality");

    const address = getStr("address");
    const pin = getStr("pin");
    const state = getStr("state");
    const country = getStr("country");

    const apartment_name = getStr("apartment_name");
    const project_name = getStr("project_name");
    const tower = getStr("tower");
    const wing = getStr("wing");
    const property_type = getStr("property_type");
    const floor_number = getStr("floor_number");
    const flat_number = getStr("flat_number");
    const carpet_area = getStr("carpet_area");
    const consideration_value = getStr("consideration_value");
    const consideration_value_words = getStr("consideration_value_words");
    const parking_details = getStr("parking_details");

    const witness_name = getStr("witness_name");
    const witness_aadhaar = getStr("witness_aadhaar");

    const booking_source = getStr("booking_source");
    const direct_source = getStr("direct_source");
    const channel_partner_name = getStr("channel_partner_name");
    const channel_partner_contact = getStr("channel_partner_contact");

    const unit_cost = getStr("unit_cost");
    const sdr = getStr("sdr");
    const gst = getStr("gst");

    const declaration_accepted = getStr("declaration_accepted") === "true";
    const terms_accepted = getStr("terms_accepted") === "true";
    const consent_accepted = getStr("consent_accepted") === "true";

    const application_date = getStr("application_date") || new Date().toISOString().split("T")[0];
    const created_by = getStr("created_by");
    const created_role = getStr("created_role");

    // New Fields
    const booking_date = getStr("booking_date");
    const agreement_value = getStr("agreement_value");
    const booking_amount = getStr("booking_amount");
    const booking_remarks = getStr("booking_remarks");
    const internal_notes = getStr("internal_notes");

    // Revenue recognition flags (which items management counts as revenue)
    const revenue_include_ocr = getStr("revenue_include_ocr") === "true";
    const revenue_include_sdr = getStr("revenue_include_sdr") === "true";
    const revenue_include_cash = getStr("revenue_include_cash") === "true";
    const revenue_include_sanction = getStr("revenue_include_sanction") === "true";
    const revenue_include_disbursement = getStr("revenue_include_disbursement") === "true";

    const token_amount = getStr("token_amount");
    const ocr_amount = getStr("ocr_amount");
    const ocr_received_date = getStr("ocr_received_date");
    const ocr_payment_mode = getStr("ocr_payment_mode");
    const ocr_remarks = getStr("ocr_remarks");
    // DEPRECATED (Phase 6): sdr_amount / sdr_payment_date / sdr_status are no longer read
    // for new bookings — replaced by the stamp_duty_* / registration_fee_* split. Only
    // sdr_remarks is still persisted (not part of the deprecation set).
    const sdr_remarks = getStr("sdr_remarks");
    const cash_component = getStr("cash_component");
    const cash_component_date = getStr("cash_component_date");
    const cash_component_remarks = getStr("cash_component_remarks");

    const expected_registration_date = getStr("expected_registration_date");
    const actual_registration_date = getStr("actual_registration_date");
    const registration_status = getStr("registration_status");
    const registration_number = getStr("registration_number");
    const registration_remarks = getStr("registration_remarks");

    const loan_required = getStr("loan_required") === "true";
    const bank_name = getStr("bank_name");
    const loan_executive = getStr("loan_executive");
    const loan_type = getStr("loan_type");
    const loan_reference_no = getStr("loan_reference_no");
    const loan_amount = getStr("loan_amount");
    const sanction_amount = getStr("sanction_amount");
    const sanction_date = getStr("sanction_date");
    const sanction_status = getStr("sanction_status");
    const loan_status = getStr("loan_status");
    const expected_disbursement_date = getStr("expected_disbursement_date");
    const actual_disbursement_date = getStr("actual_disbursement_date");
    const expected_disbursement_amount = getStr("expected_disbursement_amount");
    const disbursement_amount = getStr("disbursement_amount");
    const disbursement_status = getStr("disbursement_status");

    // EMI details
    const interest_rate = getStr("interest_rate");
    const loan_tenure_months = getStr("loan_tenure_months");
    const emi_start_date = getStr("emi_start_date");
    const payment_type = getStr("payment_type");
    const pre_emi_amount = getStr("pre_emi_amount");
    const emi_amount = getStr("emi_amount");

    // Possession tracking (optional — defaults apply if the client doesn't send these yet)
    const expected_possession_date = getStr("expected_possession_date");
    const actual_possession_date = getStr("actual_possession_date");
    const possession_status = getStr("possession_status");
    const oc_cc_status = getStr("oc_cc_status");
    const oc_cc_date = getStr("oc_cc_date");
    const possession_charges = getStr("possession_charges");
    const maintenance_deposit = getStr("maintenance_deposit");
    const legal_charges = getStr("legal_charges");

    // GST — rate is client-overridable, amount is always server-computed from agreement_value
    const gst_rate_input = getStr("gst_rate");

    // Stamp Duty & Registration Fee — client-overridable, else Maharashtra defaults apply
    const stamp_duty_amount_input = getStr("stamp_duty_amount");
    const stamp_duty_paid_date = getStr("stamp_duty_paid_date");
    const stamp_duty_status = getStr("stamp_duty_status");
    const stamp_duty_payment_mode = getStr("stamp_duty_payment_mode");
    const stamp_duty_receipt_no = getStr("stamp_duty_receipt_no");
    const registration_fee_amount_input = getStr("registration_fee_amount");
    const registration_fee_paid_date = getStr("registration_fee_paid_date");
    const registration_fee_status = getStr("registration_fee_status");
    const registration_fee_payment_mode = getStr("registration_fee_payment_mode");

    let custom_charges: any[] = [];
    try { custom_charges = JSON.parse(getStr("custom_charges") || "[]"); } catch { }

    // Parse JSON arrays
    let joint_applicants: any[] = [];
    try { joint_applicants = JSON.parse(getStr("joint_applicants") || "[]"); } catch { }

    // payment_details JSONB is deprecated as of the ledger-as-source-of-truth model.
    // New bookings write nothing to it; financial_ledger is authoritative going forward.
    // (Legacy bookings created before this change keep their payment_details intact.)

    // We will do everything inside a transaction
    const result = await transaction(async (client) => {
      // 1. Insert DB record to get ID
      const insertRes = await client.query(
        `INSERT INTO booking_applications (
          lead_id, primary_name, primary_email, primary_mobile, primary_pan, primary_aadhaar,
          primary_occupation, primary_nationality,
          joint_applicants,
          address, pin, state, country,
          property_type, floor_number, flat_number, carpet_area,
          consideration_value, consideration_value_words, parking_details,
          payment_details, witness_name, witness_aadhaar,
          booking_source, direct_source, channel_partner_name, channel_partner_contact,
          unit_cost, sdr, gst, declaration_accepted, terms_accepted, consent_accepted,
          application_date, created_by, created_role, booking_status,
          booking_date, agreement_value, booking_amount, booking_remarks, internal_notes,
          apartment_name, project_name, tower, wing,
          revenue_include_ocr, revenue_include_sdr, revenue_include_cash, revenue_include_sanction, revenue_include_disbursement
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,'Pending',
          $37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50
        ) RETURNING id`,
        [
          lead_id, primary_name, primary_email, primary_mobile, primary_pan, primary_aadhaar,
          primary_occupation, primary_nationality || "Indian",
          JSON.stringify(joint_applicants),
          address, pin, state, country || "India",
          property_type, floor_number, flat_number, carpet_area,
          consideration_value, consideration_value_words, parking_details,
          '[]', witness_name, witness_aadhaar,
          booking_source || "Direct", direct_source, channel_partner_name, channel_partner_contact,
          unit_cost, sdr, gst, declaration_accepted, terms_accepted, consent_accepted,
          application_date, created_by, created_role,
          booking_date || null, cleanNum(agreement_value), cleanNum(booking_amount), booking_remarks, internal_notes,
          apartment_name, project_name, tower, wing,
          revenue_include_ocr, revenue_include_sdr, revenue_include_cash, revenue_include_sanction, revenue_include_disbursement
        ]
      );
      const newId = insertRes.rows[0].id;

      const dateParts = application_date.split("-");
      const bookingNumber = `BK-${dateParts[0]}-${dateParts[1]}-${dateParts[2]}-${String(newId).padStart(5, "0")}`;

      await client.query(`UPDATE booking_applications SET booking_number = $1 WHERE id = $2`, [bookingNumber, newId]);

      // 1a-2. Auto-compute GST and Stamp Duty / Registration Fee (Maharashtra defaults; overridable by client)
      const agreementVal = cleanNum(agreement_value);
      const gstRate = gst_rate_input ? cleanNum(gst_rate_input) : 5;
      const gstAmount = agreementVal * gstRate / 100;
      const stampDutyAmount = stamp_duty_amount_input ? cleanNum(stamp_duty_amount_input) : agreementVal * 0.05;
      const registrationFeeAmount = registration_fee_amount_input ? cleanNum(registration_fee_amount_input) : Math.min(agreementVal * 0.01, 30000);

      await client.query(`
        UPDATE booking_applications SET
          gst_rate = $1, gst_amount = $2,
          expected_possession_date = $3, actual_possession_date = $4, possession_status = COALESCE($5, possession_status),
          oc_cc_status = COALESCE($6, oc_cc_status), oc_cc_date = $7,
          possession_charges = $8, maintenance_deposit = $9, legal_charges = $10
        WHERE id = $11
      `, [gstRate, gstAmount, expected_possession_date || null, actual_possession_date || null, possession_status || null,
          oc_cc_status || null, oc_cc_date || null,
          cleanNum(possession_charges), cleanNum(maintenance_deposit), cleanNum(legal_charges), newId]);

      // 1b. Insert Financials
      // DEPRECATED (Phase 6): sdr_amount / sdr_payment_date / sdr_status are no longer
      // written for new bookings — the split stamp_duty_* / registration_fee_* columns on
      // booking_registration_details are authoritative (inserted in step 1d below). The old
      // columns are left NULL so legacy rows keep their data and fallback reads still work.
      // (ocr_amount is intentionally still written: it feeds the financial_ledger 'ocr' line,
      // which has no derived replacement yet — see deferred pipeline notes.)
      await client.query(`
        INSERT INTO booking_financials (booking_id, token_amount, ocr_amount, ocr_received_date, ocr_payment_mode, ocr_remarks, sdr_amount, sdr_payment_date, sdr_status, sdr_remarks, cash_component, cash_component_date, cash_component_remarks)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [newId, cleanNum(token_amount), cleanNum(ocr_amount), ocr_received_date || null, ocr_payment_mode, ocr_remarks, null, null, null, sdr_remarks, cleanNum(cash_component), cash_component_date || null, cash_component_remarks]);

      // 1c. Insert Loan Details (incl. EMI fields)
      await client.query(`
        INSERT INTO booking_loan_details (booking_id, loan_required, bank_name, loan_executive, loan_type, loan_reference_no, loan_amount, sanction_amount, sanction_date, sanction_status, loan_status, expected_disbursement_date, actual_disbursement_date, expected_disbursement_amount, disbursement_amount, disbursement_status, interest_rate, loan_tenure_months, emi_start_date, payment_type, pre_emi_amount, emi_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      `, [newId, loan_required, bank_name, loan_executive, loan_type, loan_reference_no, cleanNum(loan_amount), cleanNum(sanction_amount), sanction_date || null, sanction_status || 'Pending', loan_status || 'Pending', expected_disbursement_date || null, actual_disbursement_date || null, cleanNum(expected_disbursement_amount), cleanNum(disbursement_amount), disbursement_status || 'Pending', cleanNum(interest_rate), cleanNum(loan_tenure_months), emi_start_date || null, payment_type || 'Pre-EMI', cleanNum(pre_emi_amount), cleanNum(emi_amount)]);

      // 1d. Insert Registration Details (with split Stamp Duty / Registration Fee)
      await client.query(`
        INSERT INTO booking_registration_details (
          booking_id, expected_registration_date, actual_registration_date, registration_status, registration_number, registration_remarks,
          stamp_duty_amount, stamp_duty_paid_date, stamp_duty_status, stamp_duty_payment_mode, stamp_duty_receipt_no,
          registration_fee_amount, registration_fee_paid_date, registration_fee_status, registration_fee_payment_mode
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [newId, expected_registration_date || null, actual_registration_date || null, registration_status || 'Pending', registration_number, registration_remarks,
          stampDutyAmount, stamp_duty_paid_date || null, stamp_duty_status || 'Pending', stamp_duty_payment_mode, stamp_duty_receipt_no,
          registrationFeeAmount, registration_fee_paid_date || null, registration_fee_status || 'Pending', registration_fee_payment_mode]);

      // 1e. Insert Custom Charges
      for (const charge of custom_charges) {
        await client.query(`
          INSERT INTO booking_custom_charges (booking_id, charge_name, amount, remarks)
          VALUES ($1, $2, $3, $4)
        `, [newId, charge.charge_name, charge.amount || 0, charge.remarks]);
      }

      // 1f. Insert into Revenue Pipeline
      await client.query(`
        INSERT INTO booking_pipeline (booking_id, current_stage, status)
        VALUES ($1, 'Booking', 'Active')
      `, [newId]);

      // 1f-2. Initialize Financial Account & Ledger
      const accInsert = await client.query(`INSERT INTO financial_accounts (booking_id) VALUES ($1) RETURNING id`, [newId]);
      const account_id = accInsert.rows[0].id;

      const upsertLedger = async (type: string, direction: string, amount: number, date: any, affectsRevenue: string, receivedFrom: string, bankName: string | null = null, paymentMode: string | null = null, remarks: string | null = null) => {
        if (amount > 0) {
          await client.query(`
            INSERT INTO financial_ledger (account_id, transaction_type, transaction_direction, amount, transaction_date, status, affects_revenue, received_from, transaction_source, bank_name, payment_mode, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, 'Received', $6, $7, 'UI_Update', $8, $9, $10, $11)
            ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE 
            SET amount = EXCLUDED.amount, transaction_date = EXCLUDED.transaction_date, bank_name = EXCLUDED.bank_name, payment_mode = EXCLUDED.payment_mode, notes = EXCLUDED.notes
          `, [account_id, type, direction, amount, date || new Date(), affectsRevenue, receivedFrom, bankName, paymentMode, remarks, created_by || 'System']);
        }
      };

      await upsertLedger('token', 'CREDIT', cleanNum(token_amount), booking_date, 'NO', 'Customer', null, null, null);
      await upsertLedger('booking_amount', 'CREDIT', cleanNum(booking_amount), booking_date, 'NO', 'Customer', null, null, booking_remarks);
      await upsertLedger('ocr', 'CREDIT', cleanNum(ocr_amount), ocr_received_date, 'YES', 'Customer', null, ocr_payment_mode, ocr_remarks);
      // DEPRECATED (Phase 6): the single 'sdr' government-charge ledger line is retired.
      // Recording stamp_duty / registration_fee as pass-through ledger entries (so
      // customer_ledger_view.government_charges reflects the split) is part of the
      // deferred revenue-pipeline pass — the split amounts persist on
      // booking_registration_details and surface via booking_total_cost_view today.
      await upsertLedger('cash_component', 'CREDIT', cleanNum(cash_component), cash_component_date, 'YES', 'Customer', null, null, cash_component_remarks);
      await upsertLedger('loan_disbursement', 'CREDIT', cleanNum(disbursement_amount), actual_disbursement_date, 'YES', 'Bank', bank_name, null, null);

      // 1f-3. Default Payment Milestones (standard under-construction demand schedule)
      // Token is chronologically first (Booking milestone); the larger Booking Amount
      // (up to the RERA 10% cap) is typically settled just before Agreement execution.
      const defaultMilestones = [
        { name: 'Booking', order: 1, percentage: 10, paid: cleanNum(token_amount), paidDate: booking_date },
        { name: 'Agreement', order: 2, percentage: 10, paid: cleanNum(booking_amount), paidDate: booking_date },
        { name: 'Plinth', order: 3, percentage: 10, paid: 0, paidDate: null },
        { name: 'Slab Completion (1-5)', order: 4, percentage: 15, paid: 0, paidDate: null },
        { name: 'Slab Completion (6-10)', order: 5, percentage: 15, paid: 0, paidDate: null },
        { name: 'Brickwork', order: 6, percentage: 10, paid: 0, paidDate: null },
        { name: 'Plaster & Flooring', order: 7, percentage: 10, paid: 0, paidDate: null },
        { name: 'Finishing', order: 8, percentage: 10, paid: 0, paidDate: null },
        { name: 'Possession', order: 9, percentage: 10, paid: 0, paidDate: null },
      ];
      for (const ms of defaultMilestones) {
        const demandAmount = agreementVal * ms.percentage / 100;
        const status = ms.paid <= 0 ? 'Upcoming' : ms.paid >= demandAmount ? 'Paid' : 'Partially Paid';
        await client.query(`
          INSERT INTO booking_payment_milestones (booking_id, milestone_name, milestone_order, percentage, demand_amount, paid_amount, paid_date, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [newId, ms.name, ms.order, ms.percentage, demandAmount, ms.paid, ms.paidDate || null, status]);
      }

      // 1g. Insert initial stage history
      await client.query(`
        INSERT INTO booking_stage_history (booking_id, stage_name, employee_name, remarks)
        VALUES ($1, 'Booking Submitted', $2, 'Initial booking form submitted.')
      `, [newId, created_by || 'System']);

      // 1h. Phase B5: migrate the lead's multi-bank loan applications to this booking.
      // The lead-level draft (loan_tracking_info.loan_application_ids) references
      // loan_applications rows; on booking creation they become booking-scoped so the
      // shopping history follows the booking. Best-effort — never fails the booking.
      try {
        const leadDraftRes = await client.query(`SELECT loan_tracking_info FROM walkin_enquiries WHERE id = $1`, [lead_id]);
        const draftRaw = leadDraftRes.rows[0]?.loan_tracking_info;
        const draft = typeof draftRaw === "string" ? JSON.parse(draftRaw) : (draftRaw || {});
        const ids = Array.isArray(draft?.loan_application_ids)
          ? draft.loan_application_ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
          : [];
        if (ids.length > 0) {
          await client.query(
            `UPDATE loan_applications SET booking_id = $1, updated_at = NOW() WHERE id = ANY($2::int[])`,
            [newId, ids]
          );
        }
      } catch (e) {
        console.warn("[POST booking-applications] loan_application_ids migration skipped:", (e as any)?.message);
      }

      // 2. Upload Files to R2

      const fileToBuffer = async (file: any) => {
        if (!file || typeof file === 'string' || !file.arrayBuffer) return Buffer.from([]);
        return Buffer.from(await file.arrayBuffer());
      };
      const toBase64 = async (file: any) => {
        if (!file || typeof file === 'string' || !file.type) return null;
        const buf = await fileToBuffer(file);
        if (buf.length === 0) return null;
        return "data:" + file.type + ";base64," + buf.toString("base64");
      };

      const imagesForPdf: Record<string, string | null> = {};
      const updatesForDb: Record<string, string | null> = {};

      const uploadDoc = async (file: any, docType: string, appType: string, pathSegment: string) => {
        if (!file || typeof file === 'string' || !file.name) return null;
        let ext = ".jpg";
        if (file.name.lastIndexOf(".") !== -1) {
          ext = file.name.substring(file.name.lastIndexOf("."));
        } else if (file.type === "application/pdf") ext = ".pdf";

        const key = `bookings/${bookingNumber}/${pathSegment}/${docType}${ext}`;
        await uploadBufferToR2(key, await fileToBuffer(file), file.type);

        await client.query(`
          INSERT INTO booking_documents (booking_id, lead_id, booking_number, document_type, applicant_type, file_name, object_key, mime_type, file_size, uploaded_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [newId, lead_id, bookingNumber, docType, appType, file.name, key, file.type, file.size, created_by]);

        return key;
      };

      // Primary
      const pPanFile = getFile("primary_pan_file");
      if (pPanFile) {
        updatesForDb.primary_pan_url = await uploadDoc(pPanFile, "PAN_CARD", "PRIMARY", "primary");
        imagesForPdf.primary_pan = await toBase64(pPanFile);
      }
      const pAadhaarFront = getFile("primary_aadhaar_front_file");
      if (pAadhaarFront) {
        updatesForDb.primary_aadhaar_front_url = await uploadDoc(pAadhaarFront, "AADHAAR_FRONT", "PRIMARY", "primary");
        imagesForPdf.primary_aadhaar_front = await toBase64(pAadhaarFront);
      }
      const pAadhaarBack = getFile("primary_aadhaar_back_file");
      if (pAadhaarBack) {
        updatesForDb.primary_aadhaar_back_url = await uploadDoc(pAadhaarBack, "AADHAAR_BACK", "PRIMARY", "primary");
      }

      // Joint
      for (let i = 0; i < joint_applicants.length; i++) {
        const jPan = getFile(`joint_${i}_pan_file`);
        if (jPan) {
          joint_applicants[i].pan_url = await uploadDoc(jPan, "PAN_CARD", `JOINT_${i + 1}`, `joint_${i + 1}`);
          imagesForPdf[`joint_${i}_pan`] = await toBase64(jPan);
        }
        const jAFront = getFile(`joint_${i}_aadhaar_front_file`);
        if (jAFront) {
          joint_applicants[i].aadhaar_front_url = await uploadDoc(jAFront, "AADHAAR_FRONT", `JOINT_${i + 1}`, `joint_${i + 1}`);
          imagesForPdf[`joint_${i}_aadhaar_front`] = await toBase64(jAFront);
        }
        const jABack = getFile(`joint_${i}_aadhaar_back_file`);
        if (jABack) {
          joint_applicants[i].aadhaar_back_url = await uploadDoc(jABack, "AADHAAR_BACK", `JOINT_${i + 1}`, `joint_${i + 1}`);
        }
      }

      // Signature
      const sigData = getStr("signature_data");
      if (sigData && sigData.startsWith("data:image")) {
        const base64Data = sigData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const key = `bookings/${bookingNumber}/primary/signature.png`;
        await uploadBufferToR2(key, buffer, "image/png");
        updatesForDb.signature_data = key;

        await client.query(`INSERT INTO booking_documents (booking_id, lead_id, booking_number, document_type, applicant_type, file_name, object_key, mime_type, file_size, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [newId, lead_id, bookingNumber, "SIGNATURE", "PRIMARY", "signature.png", key, "image/png", buffer.length, created_by]);
      }

      // Re-update the booking applications record with the URLs
      await client.query(`
        UPDATE booking_applications SET
          primary_pan_url = $1, primary_aadhaar_front_url = $2, primary_aadhaar_back_url = $3,
          joint_applicants = $4, signature_data = $5
        WHERE id = $6
      `, [updatesForDb.primary_pan_url || null, updatesForDb.primary_aadhaar_front_url || null, updatesForDb.primary_aadhaar_back_url || null, JSON.stringify(joint_applicants), updatesForDb.signature_data || null, newId]);

      // ── Inventory sync: mark the booked unit (create it if the bulk generator
      // never did). Runs inside this transaction, so a sync failure rolls the whole
      // booking back — no booking succeeds while its inventory link silently fails.
      await syncBookingUnit(client, {
        bookingId: newId,
        leadId: lead_id,
        actor: created_by,
        apartment_name, project_name, tower, wing,
        property_type, floor_number, flat_number, carpet_area,
      });

      // Return the saved booking row — PDF generation is intentionally decoupled and done on-demand
      const fetchBooking = await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [newId]);
      return fetchBooking.rows[0];
    });

    // Mark booking as Confirmed and Lead as Closed now that the full transaction succeeded
    await query(`UPDATE booking_applications SET booking_status = 'Confirmed' WHERE id = $1`, [result.id]);
    await query(`UPDATE walkin_enquiries SET status = 'Closed' WHERE id = $1`, [lead_id]);

    return NextResponse.json({ success: true, data: { ...result, booking_status: 'Confirmed' } }, { status: 201 });
  } catch (err: any) {
    console.error("[POST /api/booking-applications]", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
