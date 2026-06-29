import { getPool } from "./src/lib/db.ts";

async function runMigration() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Checking if lead_number column exists...");
    
    const checkRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='walkin_enquiries' AND column_name='lead_number';
    `);
    
    if (checkRes.rows.length === 0) {
      console.log("Adding lead_number column...");
      await client.query("ALTER TABLE walkin_enquiries ADD COLUMN lead_number INT;");
    } else {
      console.log("lead_number column already exists.");
    }
    
    console.log("Recalculating lead_number for existing records...");
    const updateRes = await client.query(`
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY enquiry_date ASC, created_at ASC, id ASC) as new_lead_number
        FROM walkin_enquiries
      )
      UPDATE walkin_enquiries
      SET lead_number = numbered.new_lead_number
      FROM numbered
      WHERE walkin_enquiries.id = numbered.id
      AND (walkin_enquiries.lead_number IS DISTINCT FROM numbered.new_lead_number);
    `);
    console.log(`Updated ${updateRes.rowCount} rows.`);
    
    await client.query("COMMIT");
    console.log("Migration completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error);
  } finally {
    client.release();
    // pool.end();
    process.exit(0);
  }
}

runMigration();
