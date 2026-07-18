const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// simple dotenv parse
const envPaths = [
  path.join(__dirname, ".env.local"),
  path.join(__dirname, "..", ".env.local")
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    envContent.split("\n").forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Creating financial_accounts table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_accounts (
        id SERIAL PRIMARY KEY,
        booking_id INT UNIQUE REFERENCES booking_applications(id) ON DELETE CASCADE,
        account_type VARCHAR(50) DEFAULT 'customer_receivable',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Creating financial_ledger table...");
    await client.query(`
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_migration_ledger UNIQUE(account_id, transaction_type, transaction_source)
      );
    `);

    console.log("Populating financial_accounts for existing bookings...");
    await client.query(`
      INSERT INTO financial_accounts (booking_id)
      SELECT id FROM booking_applications
      ON CONFLICT (booking_id) DO NOTHING;
    `);

    console.log("Populating financial_ledger with existing flat data...");
    
    // Process Token Amount (booking_amount)
    await client.query(`
      INSERT INTO financial_ledger (
        account_id, transaction_type, transaction_direction, amount, 
        transaction_date, status, affects_revenue, received_from, transaction_source
      )
      SELECT 
        fa.id, 'booking_amount', 'CREDIT', ba.booking_amount::numeric, 
        ba.booking_date, 'Received', 'YES', 'Customer', 'Migration'
      FROM booking_applications ba
      JOIN financial_accounts fa ON fa.booking_id = ba.id
      WHERE ba.booking_amount IS NOT NULL AND ba.booking_amount::numeric > 0
      ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE 
      SET amount = EXCLUDED.amount;
    `);

    // Process OCR Amount
    await client.query(`
      INSERT INTO financial_ledger (
        account_id, transaction_type, transaction_direction, amount, 
        transaction_date, status, affects_revenue, received_from, transaction_source
      )
      SELECT 
        fa.id, 'ocr', 'CREDIT', bf.ocr_amount::numeric, 
        COALESCE(bf.ocr_received_date, CURRENT_TIMESTAMP), 'Received', 'YES', 'Customer', 'Migration'
      FROM booking_financials bf
      JOIN financial_accounts fa ON fa.booking_id = bf.booking_id
      WHERE bf.ocr_amount IS NOT NULL AND bf.ocr_amount::numeric > 0
      ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE 
      SET amount = EXCLUDED.amount;
    `);

    // Process SDR Amount
    await client.query(`
      INSERT INTO financial_ledger (
        account_id, transaction_type, transaction_direction, amount, 
        transaction_date, status, affects_revenue, received_from, transaction_source
      )
      SELECT 
        fa.id, 'sdr', 'CREDIT', bf.sdr_amount::numeric, 
        COALESCE(bf.sdr_payment_date, CURRENT_TIMESTAMP), 'Received', 'NO', 'Customer', 'Migration'
      FROM booking_financials bf
      JOIN financial_accounts fa ON fa.booking_id = bf.booking_id
      WHERE bf.sdr_amount IS NOT NULL AND bf.sdr_amount::numeric > 0
      ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE 
      SET amount = EXCLUDED.amount;
    `);

    // Process Cash Component
    await client.query(`
      INSERT INTO financial_ledger (
        account_id, transaction_type, transaction_direction, amount, 
        transaction_date, status, affects_revenue, received_from, transaction_source
      )
      SELECT 
        fa.id, 'cash_component', 'CREDIT', bf.cash_component::numeric, 
        COALESCE(bf.cash_component_date, CURRENT_TIMESTAMP), 'Received', 'YES', 'Customer', 'Migration'
      FROM booking_financials bf
      JOIN financial_accounts fa ON fa.booking_id = bf.booking_id
      WHERE bf.cash_component IS NOT NULL AND bf.cash_component::numeric > 0
      ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE 
      SET amount = EXCLUDED.amount;
    `);

    // Process Loan Disbursement
    await client.query(`
      INSERT INTO financial_ledger (
        account_id, transaction_type, transaction_direction, amount, 
        transaction_date, status, affects_revenue, received_from, transaction_source, bank_name
      )
      SELECT 
        fa.id, 'loan_disbursement', 'CREDIT', l.disbursement_amount::numeric, 
        COALESCE(l.actual_disbursement_date, CURRENT_TIMESTAMP), 'Received', 'YES', 'Bank', 'Migration', l.bank_name
      FROM booking_loan_details l
      JOIN financial_accounts fa ON fa.booking_id = l.booking_id
      WHERE l.disbursement_amount IS NOT NULL AND l.disbursement_amount::numeric > 0
      ON CONFLICT (account_id, transaction_type, transaction_source) DO UPDATE 
      SET amount = EXCLUDED.amount, bank_name = EXCLUDED.bank_name;
    `);

    console.log("Creating customer_ledger_view...");
    await client.query(`DROP VIEW IF EXISTS customer_ledger_view CASCADE;`);
    await client.query(`
      CREATE VIEW customer_ledger_view AS
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

    await client.query("COMMIT");
    console.log("Migration completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error);
  } finally {
    client.release();
    pool.end();
  }
}

runMigration();
