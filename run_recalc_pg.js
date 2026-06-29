const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const envContent = fs.readFileSync(path.join(__dirname, ".env.local"), "utf-8");
const dbUrlMatch = envContent.match(/DATABASE_URL="?([^"\n]+)"?/);
const pool = new Pool({ connectionString: dbUrlMatch[1] });

async function run() {
  const client = await pool.connect();
  try {
    const settingRows = await client.query("SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = 1");
    const backdatedMode = settingRows.rows?.[0]?.lead_number_sorting_enabled === true;

    const orderClause = backdatedMode
      ? `CASE
           WHEN auto_date_enabled = false AND enquiry_date IS NOT NULL
           THEN enquiry_date
           ELSE created_at
         END ASC, created_at ASC, id ASC`
      : `created_at ASC, id ASC`;

    const queryText = `
      WITH sorted_leads AS (
        SELECT id,
          ROW_NUMBER() OVER (ORDER BY ${orderClause}) AS new_sr_no
        FROM walkin_enquiries
      )
      UPDATE walkin_enquiries
      SET sr_no = sorted_leads.new_sr_no
      FROM sorted_leads
      WHERE walkin_enquiries.id = sorted_leads.id
      AND walkin_enquiries.sr_no IS DISTINCT FROM sorted_leads.new_sr_no;
    `;
    await client.query(queryText);
    console.log("Recalculated successfully with OFF logic.");
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}
run();
