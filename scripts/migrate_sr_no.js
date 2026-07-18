const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
const dbUrlMatch = envContent.match(/DATABASE_URL="?([^"\n]+)"?/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1] : process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: dbUrl,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Adding sr_no column...");
    await client.query("ALTER TABLE walkin_enquiries ADD COLUMN IF NOT EXISTS sr_no INT;");
    
    console.log("Dropping lead_number column...");
    await client.query("ALTER TABLE walkin_enquiries DROP COLUMN IF EXISTS lead_number;");
    
    console.log("Dropping sequence walkin_enquiries_lead_number_seq...");
    await client.query("DROP SEQUENCE IF EXISTS walkin_enquiries_lead_number_seq;");
    
    console.log("Populating sr_no dynamically...");
    await client.query(`
      WITH sorted_leads AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY enquiry_date ASC, created_at ASC, id ASC) as new_sr_no 
        FROM walkin_enquiries
      )
      UPDATE walkin_enquiries
      SET sr_no = sorted_leads.new_sr_no
      FROM sorted_leads
      WHERE walkin_enquiries.id = sorted_leads.id;
    `);

    await client.query("COMMIT");
    console.log("Migration successful.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
