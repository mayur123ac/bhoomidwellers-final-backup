import { getPool } from "./src/lib/db.ts";

async function runMigration() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Creating lead_number_seq...");
    
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS walkin_enquiries_lead_number_seq;
    `);
    
    const maxRes = await client.query(`
      SELECT COALESCE(MAX(lead_number), 1) as max_val FROM walkin_enquiries;
    `);
    const maxVal = maxRes.rows[0].max_val;
    
    await client.query(`
      SELECT setval('walkin_enquiries_lead_number_seq', $1);
    `, [maxVal]);
    
    console.log(`Sequence created and set to ${maxVal}.`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error);
  } finally {
    client.release();
    process.exit(0);
  }
}

runMigration();
