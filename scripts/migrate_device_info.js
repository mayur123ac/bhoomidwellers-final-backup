const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrateDatabase() {
  const client = await pool.connect();
  try {
    console.log("Adding device_info to employee_sessions...");
    await client.query(`
      ALTER TABLE employee_sessions 
      ADD COLUMN IF NOT EXISTS device_info VARCHAR(255);
    `);
    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

migrateDatabase();
